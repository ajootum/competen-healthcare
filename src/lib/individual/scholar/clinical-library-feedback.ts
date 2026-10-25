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
import { caseSessionRecord, recordSessionFeedback, sessionFeedbackContext } from "@/lib/cases/library";
import { runCaseReasoning } from "./generation";
import { scholarOwnedRunner } from "./http";

/** AI feedback on one answered written decision of the caller's library session, recorded by the shared delivery. */
export async function libraryReasoningFeedback(admin: any, args: { userId: string; sessionId: string; decisionToken: string; requestId: string })
  : Promise<{ ok: true; text: string; model: string } | { ok: false; reason: string }> {
  const ctx = await sessionFeedbackContext(admin, args.userId, args.sessionId, args.decisionToken);
  if ("error" in ctx) return { ok: false, reason: ctx.error };
  const owner = await resolveOwner(admin, "case.live_with_stored", "scholar", { userId: args.userId });
  if ("refused" in owner) return { ok: false, reason: owner.refused };
  const ai = scholarOwnedRunner(admin, {
    owner, activity: "evaluate", requestId: args.requestId,
    risk: { text: `${ctx.prompt}\n${ctx.answer}`, competencyIds: ctx.competencyIds }, record: caseSessionRecord(args.sessionId),
  });
  const expected = [ctx.expectedResponse, ...ctx.rubric.map(r => r.criterion)].filter(Boolean).join("\n");
  const e = await runCaseReasoning(args.userId, {
    prompt: ctx.prompt, expected, facts: ctx.visibleFacts.map(f => `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`), answer: ctx.answer, passages: [],
  }, ai.run);
  const refused = ai.refusal();
  if (refused) return { ok: false, reason: `refused:${refused}` };
  if (!e.ok) return { ok: false, reason: `error:${e.error}` };
  if (!e.evaluation.ok) return { ok: false, reason: `withheld:${e.evaluation.reason}` };
  const saved = await recordSessionFeedback(admin, args.userId, args.sessionId, args.decisionToken,
    { provider: e.provider, model: e.model, requestId: args.requestId, policyVersion: e.promptVersion, text: e.evaluation.feedback });
  if ("error" in saved) return { ok: false, reason: `not_recorded:${saved.error}` };
  return { ok: true, text: e.evaluation.feedback, model: e.model };
}
