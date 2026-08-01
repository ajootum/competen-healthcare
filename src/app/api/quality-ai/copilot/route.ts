export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// QAW-012 Quality Intelligence copilot — wired to the real AI Runtime Gateway (generate()), grounded in
// live quality/accreditation data. Calls log to plat_ai_requests (operation "quality_intelligence") →
// surfaces in the AI Services Platform (AIS-011 Observability / AIS-008 Governance).

const NONE = "00000000-0000-0000-0000-000000000000";

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["super_admin", "hospital_admin", "assessor"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the quality copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a quality & accreditation intelligence briefing: the top risks, what threatens accreditation readiness, and the 3 highest-priority actions.";

  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (qq: any) => (isSuper ? qq : qq.eq("hospital_id", hid ?? NONE));
  const d = await loadQualityDashboard(admin, hid, isSuper);
  const ctx: string[] = [];
  ctx.push(`AUDITS: ${d.audits.total} total (${d.audits.completed} completed, ${d.audits.inProgress + d.audits.planned} open), mean compliance ${d.complianceScore != null ? d.complianceScore + "%" : "n/a"}.`);
  ctx.push(`FINDINGS: ${d.findings.open} open, ${d.findings.critical} critical.`);
  ctx.push(`CORRECTIVE ACTIONS: ${d.capa.open} open, ${d.capa.overdue} overdue, ${d.capa.critical} high-priority.`);
  ctx.push(`IMPROVEMENT: ${d.improvements.active} active projects of ${d.improvements.total}.`);
  ctx.push(`STANDARDS: ${d.standards} catalogued, ${d.indicators} active indicators. Accreditation readiness (audit-derived): ${d.accreditationReadiness != null ? d.accreditationReadiness + "%" : "n/a"}.`);
  try { const { data } = await scope(admin.from("gov_risks").select("likelihood, impact, status").limit(4000)); const risks = (data ?? []) as any[]; const high = risks.filter(r => Number(r.likelihood) * Number(r.impact) >= 10 && r.status !== "closed").length; ctx.push(`RISK REGISTER: ${risks.length} risks, ${high} high/extreme open.`); } catch { /* optional */ }
  try { const { data } = await scope(admin.from("gov_obligations").select("status").limit(4000)); const obs = (data ?? []) as any[]; ctx.push(`COMPLIANCE: ${obs.filter(o => o.status === "non_compliant").length} non-compliant, ${obs.filter(o => o.status === "at_risk").length} at-risk obligations of ${obs.length}.`); } catch { /* optional */ }
  try { const { data } = await scope(admin.from("op_incidents").select("severity, near_miss, status").limit(6000)); const inc = (data ?? []) as any[]; ctx.push(`SAFETY: ${inc.length} incidents, ${inc.filter(i => i.severity === "critical").length} critical, ${inc.filter(i => i.near_miss).length} near-misses, ${inc.filter(i => ["investigating", "awaiting_action"].includes(i.status)).length} under investigation.`); } catch { /* optional */ }

  const system = [
    "You are the Competen Quality & Accreditation Intelligence copilot for a healthcare quality office.",
    "Answer ONLY from the governed quality data provided. This is a clinical-governance tool — accuracy and traceability are mandatory.",
    "Do NOT invent audits, standards, risks, incidents, scores or facts not in the context. You provide quality-management intelligence (risk, readiness, compliance, improvement prioritisation); you do NOT make accreditation or clinical decisions — those require human quality leads.",
    "Be concise and structured; order recommendations by impact and reference the underlying numbers. If the data doesn't support an answer, say so.",
  ].join("\n");

  const result = await generate({ system, user: `Quality & accreditation data (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: hid, operation: "quality_intelligence" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "qaw_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
