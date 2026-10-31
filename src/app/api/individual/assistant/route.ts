// Allow up to 60s for AI generation -- the same ceiling /api/me/copilot uses.
import { professionalLegacyQuotaApplies } from "@/lib/individual/professional/ai-quota";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { meteredRefusalBody, requestIdFor } from "@/lib/ai/allowance";
import type { AssistantMode } from "@/lib/ai/personal-assistant";
import { runIndividualAssistant } from "@/lib/individual/personal-ai";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { individualAiQuota, individualQuotaRefusal, loadIndividualPolicy } from "@/lib/individual/policy";
import { individualPlanAiLimit } from "@/lib/individual/commerce";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isExperienceKey } from "@/lib/individual/experiences";
import { cleanQuestion, QUESTION_MAX } from "@/lib/individual/assistant";
import { pilotQuotaRefusal, purposeFrom } from "@/lib/individual/pilot-ai";
import { parseDepth, parseFollowUp } from "@/lib/individual/personal-ai-options";
import { personalAiFlight, personalAiResponse } from "@/lib/individual/personal-ai-stream";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/assistant -- COMPETEN-IND-003 s2(6), the personal AI entry point.
//
// Body: { experience, question, mode?, purpose? }. `purpose: "education"` is the learner's answer to a clarify question
// (AI operating modes; anything else is ignored). The engine is the Holdings Personal AI (src/lib/ai/personal-assistant.ts,
// owner D3): one persona, one engine, no memory, with each product's modes and authorised data as no-code policy.
// Scholar opens in Teach Me, Professional in professional-development assistance. An unoffered mode is refused.
//
// Gate 3 first (requireIndividualContext, never getCaller -- see src/lib/individual/guard.ts), and the
// experience named in the body must be LIVE for this person. Then the estate's existing AI controls, in
// the order /api/me/copilot applies them: quota, configuration, generate() through the gateway (which
// writes plat_ai_requests), and an audit row.
//
// ⚠ THE AUDIT ACTION IS `ai_assistant_query` SO THE QUOTA COUNTS IT. checkAiQuota counts audit_log rows
// by action. A new action name would be an AI route the hourly limit cannot see. entity_type says which
// assistant it was.
//
// ⚠ ATTRIBUTION IS `person` (AI-LOG-001's AiAttribution, src/lib/ai/gateway.ts). A person in Competen
// Individual has no tenant and no workspace, so the usage row records the actor alone. Passing some other
// id as a tenant (a hospital, a workspace) is the foreign-key mismatch COMPETEN-IND-002 s2.7 found -- the
// insert fails and the usage row is silently lost.

// No GET: the assistant page reads aiStatus() on the server, and an unguarded GET would be an Individual
// entry point that answered while the release gate is off.
//
// SCHOLAR-PAI-EXPERIENCE-01 (Scholar only; Professional is unchanged and its options are ignored):
//   { depth?: "quick" | "standard" | "deep" } -- default standard. Changes length and the output ceiling, nothing else.
//   { followUp?: { kind: "simplify" | "expand" | "practise", previousQuestion, previousAnswer } } -- the earlier question
//     is the request's question (screened, quota-counted and risk-classified exactly as a fresh one); the earlier answer
//     is quoted model text, screened for identifiers and never classified.
//   { stream: true } -- the answer as NDJSON once it is being written (personal-ai-stream.ts). Every refusal before the
//     first text, the clarify 409 and the restricted 422 included, is the same JSON as without it.
// The audit row gains depth, follow_up and timing_ms { gate, context, ttft, total } (no text).

export async function POST(req: Request) {
  const flight = personalAiFlight();
  const body = await req.json().catch(() => ({}));
  const experience = body?.experience;
  const known = isExperienceKey(experience);

  // The guard (release gate, then gate 3) runs BEFORE any input validation, so a disabled Individual
  // answers 404 to every request rather than revealing which inputs it would have accepted.
  const ctx = await requireIndividualContext(known ? experience : undefined);
  if (isGuardRefusal(ctx)) return ctx;
  if (!known) return NextResponse.json({ error: "Unknown experience" }, { status: 400 });

  const scholar = experience === "scholar";
  flight.want(scholar && body?.stream === true);
  const depth = scholar ? parseDepth(body) : "standard";
  const followUp = scholar ? parseFollowUp(body) : undefined;
  if (!depth) return NextResponse.json({ error: "Choose quick, standard or deep." }, { status: 400 });
  if (followUp === null) return NextResponse.json({ error: "That follow-up could not be read. Ask your question again." }, { status: 400 });
  const question = cleanQuestion(followUp ? followUp.previousQuestion : body?.question);
  const purpose = purposeFrom(body);
  if (!question) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });

  // The estate limit (quota.ts, unchanged) and the Individual policy limit, whichever is tighter (CONFIG-002).
  // For Professional, ONE limit at a time (owner, 25 October 2026): with metering ON the metered allowance governs
  // instead. Scholar's arrangement is unchanged.
  if (experience !== "professional" || (await professionalLegacyQuotaApplies(ctx.admin))) {
    const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId));
    // Fails CLOSED: an unreadable count is a 503 refusal, never a free pass (individualAiQuota).
    const refusal = await pilotQuotaRefusal(ctx.admin, experience, ctx.userId, quota, individualQuotaRefusal(quota, "questions"), "questions");
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }
  if (!aiStatus().configured) return NextResponse.json({ error: "Personal AI is not available yet." }, { status: 503 });

  const requestId = requestIdFor(ctx.userId, req.headers.get("x-request-id"));
  type Out = Awaited<ReturnType<typeof runIndividualAssistant>>;
  const failure = (out: Extract<Out, { ok: false; kind: "generation" }>) => ({
    status: out.result.error === "not_configured" ? 503 : 502,
    error: out.result.error === "refusal" ? "The assistant declined to answer that question." : "The assistant could not answer just now. Try again shortly.",
  });
  const recordAnswer = async (out: Extract<Out, { ok: true }>) => {
    await ctx.admin.from("audit_log").insert({
      trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
      action: "ai_assistant_query", entity_type: "individual_assistant", entity_id: null,
      new_value: { experience, mode: out.mode, question_chars: question.length, model: out.model, purpose, scopes_read: out.scopesRead,
        ...(scholar ? { depth, follow_up: followUp?.kind ?? null, streamed: flight.streamed } : {}), timing_ms: flight.timing() },
    }).then((r: unknown) => r, () => {});
  };

  return personalAiResponse(flight, async () => await runIndividualAssistant(ctx.admin, {
    userId: ctx.userId, fullName: ctx.profile.fullName, live: ctx.live, experience,
    mode: typeof body?.mode === "string" ? body.mode as AssistantMode : null, question,
    requestId, purpose, depth, followUp, hooks: flight.hooks,
  }), {
    json: async out => {
      if (!out.ok && out.kind === "invalid") return NextResponse.json({ error: out.error }, { status: out.status });
      if (!out.ok && out.kind === "metered") { const m = meteredRefusalBody(out.refusal); return NextResponse.json(m.body, { status: m.status }); }
      if (!out.ok) { const f = failure(out); return NextResponse.json({ error: f.error }, { status: f.status }); }
      await recordAnswer(out);
      return NextResponse.json({ answer: out.answer, mode: out.mode });
    },
    // Text was already sent: the answer ended (audited as before), or failed after it began (the browser discards it).
    finish: async out => {
      if (out.ok) { await recordAnswer(out); return { type: "done", mode: out.mode, timing: flight.timing() }; }
      if (out.kind === "generation") return { type: "error", code: out.result.error, message: failure(out).error };
      return { type: "error", code: "failed", message: "The assistant could not answer just now. Try again shortly." };
    },
  });
}
