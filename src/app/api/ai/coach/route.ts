// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, assertProfileScope } from "@/lib/api-auth";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// POST — AI Competency Coach: turns a worker's gap decisions into an explained,
// prioritised learning plan grounded in their pathway + governed resources.
// Body: { nurse_id? }  — staff may coach any worker; a worker may coach self.
export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  if (!aiStatus().configured) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const admin = c.admin;
  const quota = await checkAiQuota(admin, c.userId);
  if (!quota.ok) {
    return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });
  }
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { nurse_id } = await req.json().catch(() => ({}));

  // Authorisation: staff coach anyone in their hospital; a worker coaches self.
  const staff = isStaff(c);
  const targetId = (staff && nurse_id) ? nurse_id : c.userId;
  if (!staff && nurse_id && nurse_id !== c.userId) return forbidden();
  // Tenant scope: coaching another worker's record is limited to the caller's
  // hospital (staff cannot pull a nurse from another tenant).
  if (targetId !== c.userId) {
    const scopeErr = await assertProfileScope(c, targetId);
    if (scopeErr) return scopeErr;
  }

  const { data: target } = await admin.from("profiles").select("full_name").eq("id", targetId).single();

  // Latest decision per competency; keep the gaps.
  const { data: decisions } = await admin
    .from("competency_decisions")
    .select("competency_id, outcome, expiry_date, created_at, framework_competencies(name, framework_domains(name))")
    .eq("nurse_id", targetId)
    .order("created_at", { ascending: false });

  const seen = new Set<string>();
  const gaps: { name: string; domain: string; reason: string }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const expired = d.expiry_date && new Date(d.expiry_date).getTime() < Date.now();
    if (passing && !expired) continue;
    const comp = d.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
    gaps.push({
      name: comp?.name ?? "Competency",
      domain: comp?.framework_domains?.name ?? "—",
      reason: expired ? "Expired — reassessment due" : (OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.label ?? "Gap"),
    });
  }

  if (!gaps.length) {
    return NextResponse.json({ answer: "No current competency gaps — this worker is fully competent and up to date. Keep evidence current for the next reassessment cycle." });
  }

  // Linked learning resources for the gapped competencies
  const compIds = [...seen];
  const { data: links } = await admin
    .from("resource_competencies")
    .select("competency_id, learning_resources(title, resource_type, is_active)")
    .in("competency_id", compIds);
  const resources: string[] = [];
  for (const l of links ?? []) {
    const r = l.learning_resources as unknown as { title: string; resource_type: string; is_active: boolean } | null;
    if (r?.is_active) resources.push(`${r.title} (${r.resource_type})`);
  }

  const system = [
    "You are the Competen Competency Coach. You help a healthcare worker close their competency gaps (Book IV Ch.12).",
    "Ground your plan ONLY in the gaps and available learning resources provided. Do not invent competencies, resources, or clinical facts, and do not give individualised medical advice.",
    "Produce a short, encouraging, prioritised development plan:",
    "- Order gaps by clinical risk and urgency (expired/remediation first).",
    "- For each, suggest a concrete next step, referencing an available resource by name where one exists; if none is listed, say the educator should attach learning material.",
    "- Explain briefly why each step matters. Keep it motivating, not punitive (assessment exists to improve practice).",
  ].join("\n");

  const userMsg = [
    `Worker: ${target?.full_name ?? "the worker"}`,
    `Competency gaps:\n${gaps.map(g => `- ${g.name} (domain: ${g.domain}) — ${g.reason}`).join("\n")}`,
    `Available learning resources: ${resources.length ? resources.join("; ") : "(none linked yet)"}`,
    "Write the personalised development plan.",
  ].join("\n\n");

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 1200 });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The coach declined this request." : `Coach error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "ai_coach", entity_type: "worker", entity_id: targetId,
    new_value: { gaps: gaps.length, model: result.model, tokens: result.usage },
  });

  return NextResponse.json({ answer: result.text, gaps: gaps.length, model: result.model });
}
