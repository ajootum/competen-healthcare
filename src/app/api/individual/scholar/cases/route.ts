// Allow up to 60s for AI generation.
export const maxDuration = 60;

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { chunkMappings, getPassage, insertQuestions, storedStepCase } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk, routingVersion } from "@/lib/individual/scholar/http";
import { runCase } from "@/lib/individual/scholar/generation";
import { leadingCompetency } from "@/lib/competency/mapping";
import { CASE_MAX_STEPS, CASE_MIN_STEPS, PROMPT_VERSIONS } from "@/lib/individual/scholar/config";
import { REPEAT_REJECTED, caseReadiness } from "@/lib/individual/scholar/sufficiency";
import { noCalls, recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { materialKey, priorRejection } from "@/lib/ai/outcomes";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/cases -- COMPETEN-SCHOLAR-01 S4, an interactive practice case.
//
// Body { chunkId, fresh?, attemptAnyway? }. One multi-step case from ONE passage of the person's own notes: linked
// questions that follow a single scenario, each held to every rule a single question is (generation.ts runCase),
// stored with one case_id and its steps in order, and tied to the section's leading competency (accepted first,
// never a rejected one). Educational and NOT clinically reviewed -- every surface that plays it says so.
// Needs migration 388 (case_id): where it is absent the insert fails and nothing is stored.
//
// SCHOLAR-AI-OPT-01, before any model is paid (none of it changes a check on what IS written):
//   reuse      a case already written from this section at this prompt version is offered (`fresh` writes anew)
//   readiness  sufficiency.ts: notes that describe no presentation and no action are not sent; notes that support a
//              case question better are offered one first (`attemptAnyway` is the learner's governed attempt)
//   no repeat  exactly this section, under the same prompt, configuration and routing, already rejected: not sent
// Every action, sent or redirected, leaves one plat_ai_outcomes row (codes and counts only).

const OPERATION = "individual_scholar_case_steps";
const CONFIG = `steps:${CASE_MIN_STEPS}-${CASE_MAX_STEPS}`;

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const passage = await getPassage(ctx.admin, ctx.userId, body?.chunkId);
  if (!passage) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
  const promptVersion = `${PROMPT_VERSIONS.caseSteps}+${PROMPT_VERSIONS.verify}`;

  if (body?.fresh !== true) {
    const stored = await storedStepCase(ctx.admin, ctx.userId, passage.chunkId, promptVersion);
    if (stored) return NextResponse.json({
      created: 0, reused: true, caseId: stored.caseId, title: stored.title,
      message: `You already have a step-by-step case from this section ("${stored.title}"). It is in your questions below. Ask for a new one if you want another.`,
    });
  }

  const readiness = caseReadiness([passage.content], "case_steps");
  const configVersion = `${CONFIG};${await routingVersion(ctx.admin)}`;
  const key = materialKey({ userId: ctx.userId, activity: "case_steps", versions: [promptVersion, configVersion], contents: [passage.content] });
  const redirect = async (sufficiency: typeof readiness.outcome, reason: string, payload: Record<string, unknown>) => {
    await recordScholarOutcome(ctx.admin, noCalls(randomUUID()), {
      operation: OPERATION, outputKind: "case", outcome: "redirected", reasons: [reason], sufficiency, promptVersion, configVersion, materialKey: key,
    });
    return NextResponse.json({ created: 0, ...payload }, { status: 422 });
  };
  if (readiness.outcome === "insufficient" || (readiness.outcome === "simpler" && body?.attemptAnyway !== true))
    return redirect(readiness.outcome, `sufficiency_${readiness.outcome}`, {
      sufficiency: { outcome: readiness.outcome, message: readiness.message, alternative: readiness.alternative, missing: readiness.missing, canAttempt: readiness.outcome === "simpler" },
    });
  if (await priorRejection(ctx.admin, key))
    return redirect(readiness.outcome, "repeat_rejected", { repeat: true, message: REPEAT_REJECTED, sufficiency: { outcome: readiness.outcome, alternative: "case_question", message: REPEAT_REJECTED, canAttempt: false } });

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  // AI-FAIR-USE-01: every call through the Holdings allowance (activity case_steps). A refusal is shown as the
  // engine words it, and nothing was sent, so nothing is audited as an AI query.
  const ai = scholarAiRunner(ctx, req, "case_steps", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }));
  const r = await runCase(ctx.userId, passage, ai.run);
  const refused = meteredRefusal(ai.refusal());
  if (refused) return refused;
  const outcome = { operation: OPERATION, outputKind: "case" as const, sufficiency: readiness.outcome, promptVersion, configVersion, materialKey: key };
  if (!r.ok) {
    await recordScholarOutcome(ctx.admin, ai, { ...outcome, outcome: "error", reasons: [`error_${r.error}`] });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, null, { chunk_id: passage.chunkId, outcome: `error:${r.error}` });
    return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });
  }
  const competencyId = leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, passage.chunkId));
  const caseId = r.steps.length ? randomUUID() : null;
  const saved = await insertQuestions(ctx.admin, ctx.userId, {
    passage, kind: "case", drafts: r.steps, model: r.model, provider: r.provider, promptVersion: r.promptVersion,
    competencyId, caseId, caseTitle: r.title,
  });
  const kept = saved.ok && saved.ids.length > 0;
  await recordScholarOutcome(ctx.admin, ai, {
    ...outcome, outcome: kept ? "accepted" : "rejected", accepted: kept ? 1 : 0, rejected: kept ? 0 : 1,
    reasons: [...(r.declaredInsufficient ? ["source_insufficient"] : []), ...r.dropped.map(d => d.reason), ...(saved.ok ? [] : ["save_failed"])],
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, OPERATION, caseId, {
    chunk_id: passage.chunkId, steps: saved.ids.length, dropped: r.dropped.map(d => d.reason),
    model: r.model, prompt_version: r.promptVersion, saved: saved.ok, attempts: r.attempts, competency_id: competencyId,
    sufficiency: readiness.outcome, declared_insufficient: r.declaredInsufficient, action_id: ai.actionId,
  });
  if (!saved.ok) return NextResponse.json({ error: "The case could not be saved. Try again shortly." }, { status: 500 });
  if (!saved.ids.length)
    return NextResponse.json({
      created: 0, dropped: r.dropped.length, sufficiency: { outcome: readiness.outcome, alternative: "case_question", canAttempt: false },
      message: r.declaredInsufficient
        ? "This section does not describe enough of a patient's care for a step-by-step case, so none was written. A case question from the same section may work."
        : "No case could be written from this section that stayed within your notes. Try a case question from it, or a section that describes a condition, its assessment or its care.",
    });
  return NextResponse.json({ created: saved.ids.length, caseId, title: r.title, dropped: r.dropped.length, actionId: ai.actionId });
}
