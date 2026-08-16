export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadOutcomeCorrelation } from "@/lib/performance/outcome-correlation";
import { fetchPerformance } from "@/lib/analytics/performance";
import { currentTraceId } from "@/lib/trace";
import { estateRolesOf } from "@/lib/roles";
/* eslint-disable @typescript-eslint/no-explicit-any */

// CAPM-010 — AI Performance Intelligence copilot. Wired to the real AI Runtime Gateway (generate()), grounded in
// the enterprise performance picture: the balanced scorecard (pa_* / fetchPerformance) AND the CAPM-005
// competency-to-outcome correlation — the unique CAPM signal. Super-admin only. Calls log to plat_ai_requests
// (operation "performance_intelligence_capm"). Distinct from /api/performance/copilot (the unit PA predictive copilot).

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
  const roles: string[] = estateRolesOf(profile);
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the performance copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a performance-intelligence briefing: where is performance off target, does competency correlate with better outcomes, and the top 3 priorities.";

  const [corr, perf]: any[] = await Promise.all([
    loadOutcomeCorrelation(admin, profile?.hospital_id ?? null, true).catch(() => ({ provisioned: false })),
    fetchPerformance(admin, profile?.hospital_id ?? null, true).catch(() => ({ provisioned: false })),
  ]);
  const ctx: string[] = [];
  if (perf?.provisioned && perf?.hasData) {
    ctx.push(`BALANCED SCORECARD: overall ${perf.overall}%. Perspectives — ${(perf.scorecard ?? []).map((s: any) => `${s.name} ${s.score}% (${s.status})`).join("; ")}.`);
    const red = (perf.kpis ?? []).filter((k: any) => k.status === "red").map((k: any) => `${k.name ?? k.code} (achievement ${Math.round(k.achievement)}%)`);
    const declining = (perf.kpis ?? []).filter((k: any) => k.deltaUp === false).map((k: any) => k.name ?? k.code);
    if (red.length) ctx.push(`OFF TARGET (red): ${red.slice(0, 8).join("; ")}.`);
    if (declining.length) ctx.push(`TRENDING WORSE: ${declining.slice(0, 8).join("; ")}.`);
  } else ctx.push("Balanced scorecard: not provisioned / no KPI data.");

  if (corr?.provisioned && !corr?.empty && !corr?.insufficient) {
    ctx.push(`COMPETENCY→OUTCOME CORRELATION across ${corr.kpis.departments} departments: compliance r=${corr.complianceCorr?.r} (${corr.complianceCorr?.label}); escalation r=${corr.escalationCorr?.r} (${corr.escalationCorr?.label}). Avg department competency ${corr.kpis.avgCompetency}%, avg observation compliance ${corr.kpis.avgCompliance}%. NOTE: ecological correlation over department aggregates — directional, not causal.`);
  } else ctx.push("Competency-to-outcome correlation: insufficient department data to compute.");

  const system = [
    "You are the Competen Performance Intelligence copilot for a healthcare enterprise's super-admin (the CAPM platform).",
    "Answer ONLY from the performance data provided. Do NOT invent KPIs, scores, correlations, departments or numbers.",
    "You synthesise competency-performance signals — the balanced scorecard and the competency-to-outcome correlation — into clear, prioritised guidance. The correlation is ECOLOGICAL (department aggregates, not per-nurse causal): treat it as directional evidence about whether competency is translating into outcomes, and NEVER claim causation. Order recommendations by patient-safety and strategic impact; reference the underlying numbers.",
    "Be concise and structured. If the data doesn't support an answer, say so plainly.",
  ].join("\n");

  const result = await generate({ system, user: `Enterprise performance (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "performance_intelligence_capm" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "capm_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
