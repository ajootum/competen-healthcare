// Pro plan: allow up to 60s for AI generation.
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// COMP-025 Competency Workflow AI Assistant — the WORKER-FACING copilot. Unlike the admin/educator
// copilots, this is gated only to the authenticated user and grounded strictly in THEIR OWN competency
// record (competency_decisions for nurse_id = caller). Answers the doc's canonical learner questions
// ("why am I not ready / what evidence do I need / what's expiring"). Advisory only — it never makes a
// competency decision. Runs the real AI gateway; logged to plat_ai_requests + audit_log.

const nameOf = (row: any) => {
  const fc = row?.framework_competencies;
  return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? "a competency";
};

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour). Try again later.` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable your competency coach." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Give me a short, plain-language summary of my competency readiness: what I'm current on, what needs attention, and my next best action.";

  // ── Ground in the caller's OWN competency record ──
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: rows } = await admin.from("competency_decisions").select("competency_id, outcome, expiry_date, created_at, framework_competencies(name)").eq("nurse_id", user.id).order("created_at", { ascending: false }).limit(2000);
  const decisions = (rows ?? []) as any[];
  // Latest decision per competency.
  const latest = new Map<string, any>();
  decisions.forEach(d => { if (d.competency_id && !latest.has(d.competency_id)) latest.set(d.competency_id, d); });
  const mine = [...latest.values()];

  const expired = mine.filter(d => d.outcome === "expired" || (d.expiry_date && d.expiry_date < today));
  const remediation = mine.filter(d => ["requires_remediation", "not_yet_competent"].includes(d.outcome));
  const restricted = mine.filter(d => ["suspended", "competent_with_conditions"].includes(d.outcome));
  const expiring = mine.filter(d => d.outcome === "competent" && d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon);
  const current = mine.filter(d => d.outcome === "competent" && (!d.expiry_date || d.expiry_date > soon));

  const ctx: string[] = [];
  ctx.push(`YOUR COMPETENCY RECORD: ${mine.length} competencies on record — ${current.length} current & competent, ${expiring.length} expiring within 30 days, ${expired.length} expired, ${remediation.length} needing remediation, ${restricted.length} with conditions/restrictions.`);
  const listOf = (arr: any[]) => arr.slice(0, 8).map(d => `${nameOf(d)}${d.expiry_date ? ` (expires ${d.expiry_date})` : ""}`).join("; ");
  if (expired.length) ctx.push(`EXPIRED: ${listOf(expired)}.`);
  if (remediation.length) ctx.push(`NEEDS REMEDIATION / NOT YET COMPETENT: ${listOf(remediation)}.`);
  if (expiring.length) ctx.push(`EXPIRING SOON: ${listOf(expiring)}.`);
  if (restricted.length) ctx.push(`CONDITIONS/RESTRICTIONS: ${listOf(restricted)}.`);
  if (!mine.length) ctx.push("You have no competency decisions on record yet.");

  const context = ctx.join("\n");
  const system = [
    "You are the Competen Competency Coach — a supportive, plain-language assistant for a single healthcare worker about THEIR OWN competency record.",
    "Answer ONLY from the worker's data provided in the user message. Do NOT invent competencies, dates or outcomes that are not in the context.",
    "Rules:",
    "- Be encouraging, concrete and brief. Speak directly to the worker ('you').",
    "- You explain readiness, gaps, expiry and what to do next (e.g. gather evidence, book an assessment/reassessment, complete assigned learning). You do NOT make or change competency decisions — only an assessor can, after reviewing evidence.",
    "- When asked 'why am I not ready' or 'what do I need', tie the answer to the specific competencies in the data and the most useful next step.",
    "- If the data shows they are fully current, say so and reassure them.",
    "- This is guidance, not clinical advice; for a deteriorating patient, escalate to a clinical lead — do not use this tool.",
  ].join("\n");
  const userMsg = `My competency data (live):\n${context}\n\nMy question: ${q}`;

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 900, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "worker_competency_copilot" } });
  if (!result.ok) {
    const msg = result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The coach declined to answer that request." : `Coach error: ${result.detail ?? "failed"}`;
    return NextResponse.json({ error: msg }, { status: result.error === "not_configured" ? 503 : 500 });
  }

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "worker_competency_copilot", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
