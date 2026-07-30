export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadAssuranceDashboard } from "@/lib/assurance/assurance-dashboard";
/* eslint-disable @typescript-eslint/no-explicit-any */

// CAPA-010 — AI Assurance Intelligence copilot. Wired to the real AI Runtime Gateway (generate()), grounded in
// the consolidated enterprise assurance picture (CAPA-009): the assurance score, per-domain breakdown and the
// ranked risk list drawn from the live engines (assessor reliability + competency drift + corrective actions +
// evidence). Super-admin only. Calls log to plat_ai_requests (operation "assurance_intelligence").

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
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the assurance copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me an assurance briefing: the overall assurance score, the domains dragging it down, and the top 3 risks to act on first.";

  const intel: any = await loadAssuranceDashboard(admin, profile?.hospital_id ?? null, true);
  const ctx: string[] = [];
  if (!intel.provisioned) ctx.push("Assurance not provisioned — no competency decisions, assessments or corrective actions yet.");
  else {
    ctx.push(`ASSURANCE SCORE: ${intel.overall} / 100 (${intel.band?.label}). Mean of ${intel.scoredCount} domains with data.`);
    ctx.push(`DOMAINS: ${intel.domains.map((d: any) => `${d.key} = ${d.score ?? "no data"} (${d.note})`).join("; ")}.`);
    ctx.push(`HEADLINE: ${intel.headline.assessed} competencies assessed, ${intel.headline.assessors} assessors profiled, ${intel.headline.actions} corrective actions, ${intel.headline.highRisk} high-risk staff.`);
    if (intel.risks.length) ctx.push(`TOP RISKS (ranked):\n${intel.risks.map((r: any, i: number) => `${i + 1}. [${r.tone}] ${r.title} — ${r.detail}`).join("\n")}`);
    else ctx.push("No open assurance risks — every signal is within tolerance.");
  }

  const system = [
    "You are the Competen Competency Assurance copilot for a healthcare enterprise's super-admin.",
    "Answer ONLY from the assurance data provided. Do NOT invent scores, domains, staff, competencies or numbers.",
    "You synthesise assurance signals (assessor reliability, competency drift, corrective actions, evidence integrity, currency) into clear, risk-prioritised guidance. Order actions by patient-safety and compliance impact, reference the underlying domain scores/risks, and explain WHY. Recommendations are decision-support for a human to act on, not automated actions.",
    "Be concise and structured. If the data doesn't support an answer, say so plainly.",
  ].join("\n");

  const result = await generate({ system, user: `Enterprise assurance (live):\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 1100, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "assurance_intelligence" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ actor_id: user.id, actor_name: profile?.full_name ?? null, action: "assurance_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
