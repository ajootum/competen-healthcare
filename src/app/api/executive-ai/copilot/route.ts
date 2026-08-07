export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadExecutiveDashboard } from "@/lib/executive-data";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// HEX-002/010 Executive Intelligence copilot — real AI Runtime Gateway (generate()), grounded in the
// cross-domain executive scorecard. Logs to plat_ai_requests (operation "executive_intelligence").

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
  if (!roles.some(r => ["super_admin", "hospital_admin"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the executive copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me an executive briefing: organisational readiness, the top enterprise risks, what needs leadership attention, and the 3 highest-priority actions.";

  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (qq: any) => (isSuper ? qq : qq.eq("hospital_id", hid ?? NONE));
  const d = await loadExecutiveDashboard(admin, hid, isSuper);
  const ctx: string[] = [];
  ctx.push(`ORGANISATIONAL READINESS: ${d.readinessIndex != null ? d.readinessIndex + "%" : "n/a"} (composite of the scorecard below).`);
  ctx.push(`SCORECARD: ${d.scorecard.map((s: any) => `${s.name} ${s.score != null ? s.score + "%" : "—"}`).join("; ")}.`);
  ctx.push(`WORKFORCE: ${d.hr.headcount.total} staff, establishment ${d.hr.positions.filled}/${d.hr.positions.establishment} filled, ${d.hr.positions.vacant} vacancies; competency currency ${d.hr.competency.coverage}%, learning compliance ${d.hr.learning.compliance}%.`);
  ctx.push(`QUALITY: mean audit compliance ${d.quality.complianceScore != null ? d.quality.complianceScore + "%" : "n/a"}, ${d.quality.findings.critical ?? "unknown"} critical findings, ${d.quality.capa.open ?? "unknown"} open corrective actions (${d.quality.capa.overdue ?? "unknown"} overdue).`);

  // ⚠ THE MODEL MUST NOT BE TOLD A NUMBER NOBODY HAS. A null count reaching this template would render the
  // string "null" (or, before the null existed, a confident 0) and the advisor would reason about an
  // enterprise risk position that had never been read. "unknown" is the only honest token here.
  const n = (v: number | null) => (v == null ? "unknown" : String(v));
  ctx.push(`ENTERPRISE RISK ITEMS: ${n(d.riskTotal)} open, ${n(d.riskHigh)} high-severity. Breakdown: ${d.risk.map((r: any) => `${r.label} ${n(r.count)}`).join("; ")}. Any "unknown" means that source could not be read — do NOT treat it as zero or as reassurance.`);
  try { const { data } = await scope(admin.from("gov_risks").select("likelihood, impact, status, title, category").limit(4000)); const risks = ((data ?? []) as any[]).filter(r => r.status !== "closed"); const high = risks.filter(r => Number(r.likelihood) * Number(r.impact) >= 10); ctx.push(`RISK REGISTER: ${risks.length} active, ${high.length} high/extreme. Top: ${[...high].sort((a, b) => (Number(b.likelihood) * Number(b.impact)) - (Number(a.likelihood) * Number(a.impact))).slice(0, 4).map(r => `${r.title} (${(r.category || "").replace(/_/g, " ")})`).join("; ") || "none"}.`); } catch { /* optional */ }
  try { const { data } = await scope(admin.from("op_ops_snapshots").select("occupancy_pct, avg_los, safe_staffing_score, period_type, period").eq("period_type", "day").order("period", { ascending: false }).limit(1)); const s = (data ?? [])[0]; if (s) ctx.push(`OPERATIONS (latest): bed occupancy ${Math.round(Number(s.occupancy_pct || 0))}%, average LOS ${Number(s.avg_los || 0)} days, safe-staffing score ${Math.round(Number(s.safe_staffing_score || 0))}.`); } catch { /* optional */ }

  const system = [
    "You are the Competen Executive Intelligence copilot for hospital leadership (CEO/CMO/CNO/COO/CFO).",
    "Answer ONLY from the governed cross-domain executive data provided. Do NOT invent metrics, risks, or facts.",
    "You provide executive decision-support (readiness, risk, quality, workforce, operations, strategy). You do NOT make clinical or final governance decisions — those require the accountable executives. Order recommendations by enterprise impact and reference the underlying numbers.",
    "Be concise, board-ready and structured. If the data doesn't support an answer, say so.",
  ].join("\n");

  const result = await generate({ system, user: `Executive data (live, tenant-scoped):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1200, context: { userId: user.id, tenantId: hid, operation: "executive_intelligence" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "hex_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
