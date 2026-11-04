/* eslint-disable @typescript-eslint/no-explicit-any */
// ── STAGE 5A (CR4): AI FEEDBACK ON A WRITTEN DECISION IN A LIBRARY CASE ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 ──────
//
// SERVER-ONLY (case-intelligence K12: only server src/lib code may name the feedback context). A governed library case
// is played and kept by the shared delivery (library.ts); its AI feedback is recorded there too (recordSessionFeedback,
// migration 424), never by Scholar. Scholar's part is the live AI, which is the student's own learning:
//   1. the narrow context for ONE answered written decision, from library.ts sessionFeedbackContext (#76) -- its prompt,
//      expected answer and rubric, the student's own text, the findings they had SEEN, the competencies. Never the
//      blueprint (K7), never an option key, never a fact they had not seen.
//   2. the owner resolved by rule for the workflow case.live_with_stored (the Individual budget -- the browser never
//      chooses it), and the call through runOwnedAi, counted against caseSessionRecord(sessionId), with its risk.
//   3. the feedback checked like any evaluation (generation.ts parseEvaluation, through runCaseReasoning).
//   4. recorded through library.ts recordSessionFeedback. Labelled AI evaluation wherever it is shown.

import { resolveOwner } from "@/lib/ai/consumption";
import { caseSessionRecord, recordSessionFeedback, sessionFeedbackContext, sessionReasonContext } from "@/lib/cases/library";
import { runCaseReasoning } from "./generation";
import { scholarOwnedRunner } from "./http";
import { CRITERION_WEIGHT_MAX, SAFETY_LABEL, criteriaMarks, criteriaOf, unsafeStatement, type CriteriaMarks, type Criterion } from "./scoring-rules";

/** SQIE-CLOSE-2026-11 WS-B: the weighted criteria of a case rubric (its stored weight and safety flag), or null where none is sound. */
export function caseCriteria(rubric: readonly { criterion: string; weight?: number; safetyCritical?: boolean }[]): Criterion[] | null {
  return criteriaOf(rubric.map(c => ({ text: c.criterion, weight: Number.isInteger(c.weight) ? Math.min(CRITERION_WEIGHT_MAX, Math.max(1, c.weight as number)) : 1, safetyCritical: c.safetyCritical === true })));
}

/**
 * Pure (WS-B, rules v2). The lines recorded after the AI feedback on an answer marked against weighted criteria: the practice marks
 * from the weights, which criteria were met, and what was unsafe or missed. Kept in the recorded text (424 keeps text), so it is read
 * back exactly as it was shown.
 */
export function criteriaMarksLine(criteria: readonly Criterion[], m: CriteriaMarks, unsafe: string | null): string {
  const met = m.matched.map(i => criteria[i].text);
  return [
    `Practice marks (formative, from the case's weighted criteria): ${m.awarded} of ${m.total}.`,
    met.length ? `Criteria met: ${met.join("; ")}.` : "No criterion met.",
    m.outcome === "unsafe" ? `${SAFETY_LABEL.unsafe}: "${unsafe ?? ""}". It earns no marks.` : null,
    m.outcome === "critical_missed" ? `${SAFETY_LABEL.critical_missed}: ${m.missedCritical.join("; ")}.` : null,
  ].filter(Boolean).join("\n");
}

/** Pure. The text recorded for one evaluation: the feedback, then the weighted marks or the unsafe statement where there is one. */
export function recordedFeedbackText(feedback: string, criteria: readonly Criterion[] | null, marks: CriteriaMarks | null, unsafe: string | null): string {
  if (marks && criteria) return `${feedback}\n${criteriaMarksLine(criteria, marks, unsafe)}`;
  return unsafe ? `${feedback}\n${SAFETY_LABEL.unsafe}: "${unsafe}".` : feedback;
}

type Recorded = { ok: true; text: string; model: string; marks: CriteriaMarks | null; unsafe: string | null } | { ok: false; reason: string };

/** AI feedback on one answered written decision of the caller's library session, recorded by the shared delivery. */
export async function libraryReasoningFeedback(admin: any, args: { userId: string; sessionId: string; decisionToken: string; requestId: string })
  : Promise<Recorded> {
  const ctx = await sessionFeedbackContext(admin, args.userId, args.sessionId, args.decisionToken);
  if ("error" in ctx) return { ok: false, reason: ctx.error };
  const expected = [ctx.expectedResponse, ...ctx.rubric.map(r => r.criterion)].filter(Boolean).join("\n");
  // SQIE-CLOSE-2026-11 WS-B: the rubric's stored weights and safety flags are scored (the evaluator lists the criteria met; code weighs them).
  return evaluateOwned(admin, args, ctx, { prompt: ctx.prompt, expected, criteria: caseCriteria(ctx.rubric) });
}

/**
 * SQIE-CLOSE-2026-11 WS-C. The learner's REASON for a choice ("Explain your choice", decision.askReason) in a library case, scored against
 * the decision's own weighted rubric criteria where the case defines them: rubric-based partial credit and the five-part feedback, by the
 * same evaluator, formative and labelled. The choice's marking is unchanged (it stays on the key). No criteria: nothing is scored.
 */
export async function libraryReasonFeedback(admin: any, args: { userId: string; sessionId: string; decisionToken: string; requestId: string }): Promise<Recorded> {
  const reason = await sessionReasonContext(admin, args.userId, args.sessionId, args.decisionToken);
  if ("error" in reason) return { ok: false, reason: reason.error };
  const criteria = caseCriteria(reason.rubric);
  if (!criteria) return { ok: false, reason: "no_rubric" };
  return evaluateOwned(admin, args, reason, {
    prompt: `${reason.prompt}\nThe student chose: ${reason.chosen.join("; ")}. Judge the REASON they gave for that choice.`, expected: reason.expectedResponse, criteria,
  });
}

/**
 * The ONE owned evaluation path for a library case (a written answer, or a reason): the owner resolved by rule, the spend counted against
 * the session, the reply checked, weighed and recorded only through the shared delivery (424).
 */
async function evaluateOwned(admin: any, args: { userId: string; sessionId: string; decisionToken: string; requestId: string },
  ctx: { prompt: string; answer: string; competencyIds: string[]; visibleFacts: { label: string; value: string; unit: string | null }[] },
  input: { prompt: string; expected: string; criteria: Criterion[] | null }): Promise<Recorded> {
  const owner = await resolveOwner(admin, "case.live_with_stored", "scholar", { userId: args.userId });
  if ("refused" in owner) return { ok: false, reason: owner.refused };
  const ai = scholarOwnedRunner(admin, {
    owner, activity: "evaluate", requestId: args.requestId,
    risk: { text: `${ctx.prompt}\n${ctx.answer}`, competencyIds: ctx.competencyIds }, record: caseSessionRecord(args.sessionId),
  });
  const criteria = input.criteria;
  const e = await runCaseReasoning(args.userId, {
    prompt: input.prompt, expected: input.expected, facts: ctx.visibleFacts.map(f => `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`), answer: ctx.answer, passages: [], criteria,
  }, ai.run);
  const refused = ai.refusal();
  if (refused) return { ok: false, reason: `refused:${refused}` };
  if (!e.ok) return { ok: false, reason: `error:${e.error}` };
  if (!e.evaluation.ok) return { ok: false, reason: `withheld:${e.evaluation.reason}` };
  const unsafe = unsafeStatement(e.evaluation.unsafe);
  const marks = criteria && e.evaluation.matched ? criteriaMarks(criteria, e.evaluation.matched, !!unsafe) : null;
  const text = recordedFeedbackText(e.evaluation.feedback, criteria, marks, unsafe);
  const saved = await recordSessionFeedback(admin, args.userId, args.sessionId, args.decisionToken,
    { provider: e.provider, model: e.model, requestId: args.requestId, policyVersion: e.promptVersion, text });
  if ("error" in saved) return { ok: false, reason: `not_recorded:${saved.error}` };
  return { ok: true, text, model: e.model, marks, unsafe };
}
