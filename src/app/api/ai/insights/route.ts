// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadAnalytics, passRateOf, avgScoreOf, competencyProfile, riskBuckets } from "@/lib/analytics";

// AI & Intelligence — scoped narrative insights. The server computes REAL
// figures from live records and hands only those to Claude for a narrative +
// recommendations; the model is told not to invent numbers. Scopes power the
// Assessment Insights, Competency Intelligence, Predictive Risk Engine and
// Simulation Intelligence modules.
// Body: { scope: "overview" | "competency" | "risk" | "simulation" }

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;
  const admin = createAdminClient();
  const { data: me0 } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", userId).single();
  const roles: string[] = me0?.roles?.length ? me0.roles : [me0?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const hospitalId = me0?.hospital_id ?? null;
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  const quota = await checkAiQuota(admin, userId);
  if (!quota.ok) return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });

  const { scope } = await req.json().catch(() => ({}));
  if (!["overview", "competency", "risk", "simulation"].includes(scope)) {
    return NextResponse.json({ error: "scope must be overview, competency, risk or simulation" }, { status: 400 });
  }

  const ctx = await loadAnalytics(admin, hospitalId);
  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const cur = ctx.assess.filter(a => a.assessed_at >= d30);
  const prev = ctx.assess.filter(a => a.assessed_at < d30);
  const comps = competencyProfile(ctx.latest);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const pending = ctx.entries.filter(e => e.status === "pending").length;
  const overdue = ctx.sched.filter(s => s.status === "scheduled" && s.scheduled_for < new Date(now).toISOString()).length;

  const lines: string[] = [];
  lines.push(`Learners: ${ctx.nurses.length}. Assessments last 30 days: ${cur.length} (pass rate ${passRateOf(cur) ?? "n/a"}%, avg score ${avgScoreOf(cur) ?? "n/a"}); previous 4-8 week window: ${prev.length} (pass rate ${passRateOf(prev) ?? "n/a"}%).`);
  if (scope === "overview") {
    lines.push(`Evidence backlog: ${pending} pending. Overdue scheduled sessions: ${overdue}. Risk: ${risk.high} high, ${risk.medium} medium, ${risk.low} low.`);
    const weak = [...comps].filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 3);
    if (weak.length) lines.push(`Weakest competencies: ${weak.map(c => `${c.name} ${c.pct}% of ${c.total}`).join("; ")}.`);
  }
  if (scope === "competency") {
    const sorted = [...comps].filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct);
    lines.push(`Competencies with decisions: ${comps.length}. Below 60% pass: ${comps.filter(c => c.pct < 60).length}. Expiring in 90 days: ${comps.reduce((s, c) => s + c.expSoon, 0)}.`);
    if (sorted.length) lines.push(`Weakest: ${sorted.slice(0, 5).map(c => `${c.name} ${c.pct}% (${c.total})`).join("; ")}. Strongest: ${sorted.slice(-3).map(c => `${c.name} ${c.pct}%`).join("; ")}.`);
  }
  if (scope === "risk") {
    lines.push(`Risk buckets (derived from decision records, not prediction): ${risk.high} learners with critical failures, ${risk.medium} with failed or expired competencies, ${risk.low} clear.`);
    lines.push(`Expired competencies now: ${ctx.latest.filter(d => d.expired).length}. Overdue sessions: ${overdue}. Evidence backlog: ${pending}.`);
  }
  if (scope === "simulation") {
    const sims = ctx.assess.filter(a => a.method === "simulation");
    const simFails = new Map<string, number>();
    for (const a of sims) if (a.score < 3 && a.competency_id) {
      const name = ctx.latest.find(l => l.competency_id === a.competency_id)?.name ?? "competency";
      simFails.set(name, (simFails.get(name) ?? 0) + 1);
    }
    lines.push(`Simulation assessments (8 weeks): ${sims.length}, pass rate ${passRateOf(sims) ?? "n/a"}%, avg ${avgScoreOf(sims) ?? "n/a"}.`);
    const worst = [...simFails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (worst.length) lines.push(`Most failed in simulation: ${worst.map(([n, f]) => `${n} (${f} fails)`).join("; ")}.`);
  }

  const system = [
    "You are the Competen assessment-intelligence analyst writing for a senior clinical assessor.",
    "Use ONLY the figures provided — never invent numbers, names, trends or causes. If data is thin, say so plainly.",
    "Write: 1) a 3-5 sentence narrative of what the figures show; 2) exactly three prioritised, actionable recommendations tied to the figures.",
    "You support assessor judgement; you do not make competency decisions. British clinical English, no hype.",
  ].join("\n");

  const result = await generate({ system, user: `Scope: ${scope}\n\nFigures:\n${lines.join("\n")}\n\nWrite the insight narrative and recommendations.`, tier: "reasoning", maxTokens: 700 });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The analyst declined this request." : `Insights error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me?.full_name ?? null,
    action: "ai_insights", entity_type: "ai", entity_id: null,
    new_value: { scope, model: result.model, tokens: result.usage },
  });
  return NextResponse.json({ answer: result.text, model: result.model });
}
