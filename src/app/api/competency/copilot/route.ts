// Pro plan: allow up to 60s for AI generation.
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { fetchCmoSuite, daysLeft } from "@/lib/competency/cmo-suite";
/* eslint-disable @typescript-eslint/no-explicit-any */

// CMO-017 AI Competency Intelligence — wired to the real AI Runtime Gateway (src/lib/ai/client.ts generate()).
// Grounded in live competency data; every call is logged to plat_ai_requests (operation "competency_intelligence")
// so it surfaces in the AI Services Platform (AIS-011 Observability, AIS-008 Governance).

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
  if (!roles.some(r => ["super_admin", "hospital_admin", "educator"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour). Try again later.` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the competency copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a concise competency-intelligence briefing: the top risks, what needs attention, and the 3 highest-priority actions.";

  // ── Ground in live competency data ──
  const isSuper = roles.includes("super_admin");
  const d = await fetchCmoSuite(admin, profile?.hospital_id ?? null, isSuper);
  const passing = (o: any) => /competent|pass|achiev|met|proficient/i.test(String(o));
  const ctx: string[] = [];
  const certsExpiring = d.certifications.filter((c: any) => { const n = daysLeft(c.expiry_date); return n != null && n >= 0 && n <= 60; });
  ctx.push(`CERTIFICATIONS: ${d.certifications.length} tracked, ${d.certifications.filter((c: any) => c.status === "active").length} active, ${certsExpiring.length} expiring ≤60d, ${d.certifications.filter((c: any) => c.status === "expired").length} expired.`);
  ctx.push(`PRIVILEGES: ${d.privileges.length} granted, ${d.privileges.filter((p: any) => p.status === "under_review").length} under review, ${d.privileges.filter((p: any) => !p.prerequisites_met).length} with lapsed prerequisites.`);
  ctx.push(`ASSIGNMENTS: ${d.assignments.length} active, ${d.assignments.filter((a: any) => a.status === "overdue").length} overdue, ${d.assignments.filter((a: any) => a.status === "completed").length} completed.`);
  const hi = d.forecasts.filter((f: any) => f.risk === "high").map((f: any) => `${f.competency} (gap ${f.gap})`);
  if (hi.length) ctx.push(`FORECAST high-risk competencies: ${hi.join("; ")}.`);
  const accrGaps = d.accreditations.filter((a: any) => ["gap", "not_mapped"].includes(a.compliance_status)).map((a: any) => `${a.standard}: ${a.requirement}`);
  if (accrGaps.length) ctx.push(`ACCREDITATION gaps: ${accrGaps.slice(0, 6).join("; ")}.`);
  const snap = d.readiness[0];
  if (snap) ctx.push(`READINESS snapshot: readiness ${Math.round(Number(snap.readiness_score || 0))}%, compliance ${Math.round(Number(snap.compliance_score || 0))}%, at-risk units ${snap.at_risk_units ?? 0}, evidence pending ${snap.evidence_pending ?? 0}.`);
  if (d.decisions.length) ctx.push(`DECISIONS: ${d.decisions.length} on record, ${d.decisions.filter((x: any) => x.outcome && !passing(x.outcome)).length} non-passing.`);
  if (d.aiRecs.length) ctx.push(`EXISTING FLAGGED SIGNALS: ${d.aiRecs.slice(0, 6).map((r: any) => `${r.title} (${r.impact})`).join("; ")}.`);

  const context = ctx.join("\n");
  const system = [
    "You are the Competen Competency Intelligence copilot for a healthcare Competency Office.",
    "Answer ONLY from the governed competency data provided in the user message. This is a clinical governance tool — accuracy and traceability are mandatory (explainable, transparent AI).",
    "Rules:",
    "- Ground every statement in the provided data. Do NOT invent staff, competencies, scores, certifications or facts not in the context.",
    "- You provide competency-management intelligence (risk, readiness, compliance, planning). You do NOT make competency decisions or give individual clinical advice — those require human assessors.",
    "- Be concise and structured. When recommending actions, order them by impact and reference the underlying numbers.",
    "- If the data does not support an answer, say so plainly.",
  ].join("\n");
  const userMsg = `Competency Office data (live):\n${context}\n\nRequest: ${q}`;

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "competency_intelligence" } });

  if (!result.ok) {
    const msg = result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined to answer that request." : `Copilot error: ${result.detail ?? "failed"}`;
    return NextResponse.json({ error: msg }, { status: result.error === "not_configured" ? 503 : 500 });
  }

  await admin.from("audit_log").insert({ actor_id: user.id, actor_name: profile?.full_name ?? null, action: "cmo_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});

  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
