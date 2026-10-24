/* eslint-disable @typescript-eslint/no-explicit-any */
// ── STAGE 5A (CR4): AI FEEDBACK ON A WRITTEN DECISION IN A LIBRARY CASE ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 ──────
//
// SERVER-ONLY. A governed library case is played by the shared delivery (library.ts); its AI feedback is recorded there
// too (recordSessionFeedback, migration 424), never by Scholar. Scholar's part is the live AI itself, which is the
// student's own learning: the owner is resolved for the workflow `case.live_with_stored` (the Individual budget, by
// rule -- the browser never chooses it), the call goes through runOwnedAi naming caseSessionRecord(sessionId), and the
// feedback must pass the same check as any evaluation (generation.ts parseEvaluation) before it is recorded.
// ⚠ GOVERNED FACTS ONLY. The judgement is against the case's own expected answer and the findings the student has
// seen -- the approved version's facts -- never outside knowledge. Labelled AI evaluation wherever it is shown.

import { resolveOwner } from "@/lib/ai/consumption";
import type { RiskContext } from "@/lib/ai/clinical-risk";
import { scholarOwnedRunner } from "./http";
import { caseSessionRecord, loadLibraryCase, recordSessionFeedback } from "@/lib/cases/library";
import type { LearnerView } from "@/lib/cases/blueprint";
import { runCaseReasoning } from "./generation";
import { librarySessionVersion } from "./store";

/**
 * AI feedback on one answered written decision of a library session, recorded through library.ts. Returns what was
 * recorded, or why there is none (the student then reviews it against the expected answer themselves).
 */
export async function libraryReasoningFeedback(admin: any, args: {
  userId: string; sessionId: string; decisionToken: string; answer: string; view: LearnerView; requestId: string;
}): Promise<{ ok: true; text: string; model: string } | { ok: false; reason: string }> {
  const dp = args.view.stages.flatMap(s => s.decisionPoints).find(d => d.token === args.decisionToken);
  if (!dp || dp.kind !== "free_text") return { ok: false, reason: "not_written" };
  const versionId = await librarySessionVersion(admin, args.userId, args.sessionId);
  const c = versionId ? await loadLibraryCase(admin, versionId, { resumeFor: args.userId }) : null;
  const d = c?.blueprint.decisionPoints.find(x => x.kind === "free_text" && x.prompt === dp.prompt);
  if (!c || !d?.expectedResponse) return { ok: false, reason: "no_expected_answer" };
  const owner = await resolveOwner(admin, "case.live_with_stored", "scholar", { userId: args.userId });
  if ("refused" in owner) return { ok: false, reason: owner.refused };
  const facts = args.view.facts.map(f => `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`);
  const risk: RiskContext = { text: `${dp.prompt}\n${args.answer}`, competencyIds: c.blueprint.learningObjectives.flatMap(l => l.competencyIds) };
  const ai = scholarOwnedRunner(admin, { owner, activity: "evaluate", requestId: args.requestId, risk, record: caseSessionRecord(args.sessionId) });
  const e = await runCaseReasoning(args.userId, { prompt: dp.prompt, expected: d.expectedResponse, facts, answer: args.answer, passages: [] }, ai.run);
  const refused = ai.refusal();
  if (refused) return { ok: false, reason: `refused:${refused}` };
  if (!e.ok) return { ok: false, reason: `error:${e.error}` };
  if (!e.evaluation.ok) return { ok: false, reason: `withheld:${e.evaluation.reason}` };
  const saved = await recordSessionFeedback(admin, args.userId, args.sessionId, args.decisionToken,
    { provider: e.provider, model: e.model, requestId: args.requestId, policyVersion: e.promptVersion, text: e.evaluation.feedback });
  if ("error" in saved) return { ok: false, reason: `not_recorded:${saved.error}` };
  return { ok: true, text: e.evaluation.feedback, model: e.model };
}
