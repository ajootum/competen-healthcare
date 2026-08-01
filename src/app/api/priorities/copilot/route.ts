export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { fetchFramework, effectiveWeight } from "@/lib/priorities/engine";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// PPE-007 AI Priority Orchestrator — wired to the real AI Runtime Gateway (generate()), grounded in the live priority
// framework. Calls log to plat_ai_requests (operation "priority_orchestration") → AIS-011 Observability / AIS-008.

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the orchestrator." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a strategic priority briefing: conflicts, objectives at risk, and the top 3 orchestration actions.";

  const f = await fetchFramework(admin);
  const ctx: string[] = [];
  if (f.provisioned) {
    const pub = f.objectives.filter((o: any) => o.status === "published");
    const atRisk = pub.filter((o: any) => Number(o.progress_pct) < 50).map((o: any) => `${o.title} (${Math.round(Number(o.progress_pct))}%)`);
    ctx.push(`OBJECTIVES: ${f.objectives.length} total, ${pub.length} published, avg progress ${pub.length ? Math.round(pub.reduce((a: number, o: any) => a + Number(o.progress_pct || 0), 0) / pub.length) : 0}%. At risk (<50%): ${atRisk.slice(0, 6).join("; ") || "none"}.`);
    const pubP = f.priorities.filter((p: any) => p.status === "published");
    ctx.push(`PRIORITIES: ${pubP.length} published, ${pubP.filter((p: any) => p.mandatory).length} mandatory. Top by weight: ${[...pubP].sort((a: any, b: any) => effectiveWeight(b) - effectiveWeight(a)).slice(0, 5).map((p: any) => `${p.title} (w${effectiveWeight(p)}, ${p.urgency})`).join("; ")}.`);
    // Conflict signal: multiple high-weight priorities per theme.
    const conflicts = f.themes.map((t: any) => ({ theme: t.name, n: pubP.filter((p: any) => p.theme_id === t.id && effectiveWeight(p) >= 120).length })).filter((x: any) => x.n >= 2);
    if (conflicts.length) ctx.push(`POTENTIAL CONFLICTS: ${conflicts.map((c: any) => `${c.theme} (${c.n} competing high-weight priorities)`).join("; ")}.`);
    ctx.push(`GOVERNANCE: ${f.approvals.filter((a: any) => a.state === "pending").length} approvals pending. CAMPAIGNS: ${f.campaigns.filter((c: any) => c.status === "active").length} active.`);
    const noKr = f.objectives.filter((o: any) => o.status === "published" && !f.keyResults.some((k: any) => k.objective_id === o.id));
    if (noKr.length) ctx.push(`UNMEASURABLE: ${noKr.length} published objectives have no key results.`);
  } else ctx.push("Priority framework not provisioned.");

  const system = [
    "You are the Competen Priority Orchestration copilot for the platform's strategic Priority & Execution Framework.",
    "Answer ONLY from the governed strategy data provided. Do NOT invent objectives, priorities, weights or facts.",
    "You provide orchestration intelligence (conflicts, drift, alignment, capacity). Recommendations must reference the underlying numbers and be ordered by impact. Human approval is required for any high-impact change.",
    "Be concise and structured. If the data doesn't support an answer, say so.",
  ].join("\n");

  const result = await generate({ system, user: `Priority framework data (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, operation: "priority_orchestration" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The orchestrator declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "ppe_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
