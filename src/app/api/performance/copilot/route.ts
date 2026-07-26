export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { fetchPerformance } from "@/lib/analytics/performance";
/* eslint-disable @typescript-eslint/no-explicit-any */

// PA-007 Predictive Performance copilot — wired to the real AI Runtime Gateway (generate()), grounded in the live
// balanced scorecard. Calls log to plat_ai_requests (operation "performance_intelligence") → AIS-011 / AIS-008.

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
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the performance copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a performance briefing: where are we off target, what's trending down, and the top 3 improvement priorities.";

  const isSuper = roles.includes("super_admin");
  const p = await fetchPerformance(admin, profile?.hospital_id ?? null, isSuper);
  const ctx: string[] = [];
  if (!p.provisioned) ctx.push("Performance analytics not provisioned.");
  else if (!p.hasData) ctx.push("Performance framework provisioned but no KPIs configured yet.");
  else {
    ctx.push(`BALANCED SCORECARD: overall ${p.overall}%. Perspectives — ${p.scorecard.map((s: any) => `${s.name} ${s.score}% (${s.status})`).join("; ")}.`);
    const red = p.kpis.filter((k: any) => k.status === "red").map((k: any) => `${k.name ?? k.code} = ${k.value}${k.unit ? k.unit : ""} (achievement ${Math.round(k.achievement)}%, ${k.perspectiveName ?? "—"})`);
    const amber = p.kpis.filter((k: any) => k.status === "amber").map((k: any) => `${k.name ?? k.code}`);
    ctx.push(`KPIs: ${p.kpis.length} tracked, ${p.kpis.filter((k: any) => k.status === "green").length} green, ${amber.length} amber, ${red.length} red.`);
    if (red.length) ctx.push(`OFF TARGET (red): ${red.slice(0, 8).join("; ")}.`);
    if (amber.length) ctx.push(`WATCH (amber): ${amber.slice(0, 8).join("; ")}.`);
    const declining = p.kpis.filter((k: any) => k.deltaUp === false).map((k: any) => `${k.name ?? k.code}${k.deltaPct != null ? ` (${k.deltaPct}%)` : ""}`);
    if (declining.length) ctx.push(`TRENDING WORSE: ${declining.slice(0, 8).join("; ")}.`);
    if (p.projects?.length) ctx.push(`IMPROVEMENT PROJECTS: ${p.projects.length} active — ${p.projects.slice(0, 5).map((x: any) => `${x.title ?? x.name}${x.status ? ` (${x.status})` : ""}`).join("; ")}.`);
    if (p.predictions?.length) ctx.push(`EXISTING FORECASTS: ${p.predictions.slice(0, 5).map((x: any) => x.title ?? x.metric ?? x.summary ?? "forecast").join("; ")}.`);
  }

  const system = [
    "You are the Competen Predictive Performance copilot for a healthcare unit's balanced scorecard.",
    "Answer ONLY from the performance data provided. Do NOT invent KPIs, values, targets or trends.",
    "You provide performance intelligence (risk, trajectory, improvement prioritisation). Reference the underlying numbers and order recommendations by impact. Predictions are decision-support, not guarantees.",
    "Be concise and structured. If the data doesn't support an answer, say so.",
  ].join("\n");

  const result = await generate({ system, user: `Performance data (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "performance_intelligence" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ actor_id: user.id, actor_name: profile?.full_name ?? null, action: "pa_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
