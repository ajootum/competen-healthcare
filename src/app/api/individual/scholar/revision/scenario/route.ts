// Allow up to 60s: a short stage may be evaluated by AI.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getPassage, getQuestion, getRevisionSession, recordRevisionAttempt, updateRevisionSession, isUuid } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runEvaluate } from "@/lib/individual/scholar/generation";
import { feedbackView } from "@/lib/individual/scholar/revision-view";
import { questionLinks } from "@/lib/individual/scholar/revision-links";
import { MARKING_LABEL } from "@/lib/individual/scholar/config";
import { rubricOf, type FeedbackParts, type Rubric } from "@/lib/individual/scholar/question-intel";
import { answerOutcome, recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { formativeFeedback, withFormative } from "@/lib/individual/scholar/written-feedback";
import { rubricSnapshotOf, withRubricSnapshot } from "@/lib/individual/scholar/rubric-snapshot";
import { keepAttemptSnapshot } from "@/lib/individual/scholar/attempt-integrity";
import { aiMarkingAllowed } from "@/lib/individual/scholar/library-format";
import { isScenarioQuestion } from "@/lib/individual/scholar/formats";
import {
  answerSummary, markStageByCode, parseStageAnswer, readProgress, scenarioMarking, scenarioMarks, scenarioSpecOf, signProgress, stageView, storedStages, tokenKey, verdictScore,
  type Progress, type ScenarioStage, type StageResult,
} from "@/lib/individual/scholar/scenario";

// Request-time only: it reads the session and the learner's policy, and signs with a server-only secret.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/revision/scenario -- SCHOLAR-CE-2026 CE-05. One STAGE of an evolving scenario.
//
// Body { questionId, sessionId?, token?, response, selfGrade? }.
//   token      absent for the first stage; for every later stage the one the previous reply carried.
//   response   the answer for THIS stage's kind (scenario.ts parseStageAnswer).
//   selfGrade  a short stage the code could not mark, judged by the learner against the stage's accepted answers.
//
// REVEAL IS A SERVER RULE. The reply to a stage carries the NEXT stage's new information and question, never before: a stage is sent only
// in reply to a valid answer to the one before it, under a token the browser cannot alter (scenario.ts readProgress: signed over the
// learner, the question, its marking guide and the results so far). The first reply to an unanswered scenario is the session's own
// learner view (stage 1 only). The last stage's reply records ONE attempt for the whole scenario.
//
// MARKED BY CODE WHERE CODE CAN (mcq, mrq, cloze, and a short answer that matches), otherwise by the same formative evaluation as a short
// answer (activity `evaluate`, one metered call per stage, the policy's ai_then_self), otherwise by the learner. Each stage's score is
// 0 to 1 (an evaluation: correct 1, partly one half, incorrect 0); the practice marks are the stage scores summed with the stage weights.
// Nothing is guessed, and everything is formative.

const NO_STANDING = { available: false, insufficient: false, message: "This Competen library question is marked against its key, not by AI." };
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const q = await getQuestion(ctx.admin, ctx.userId, body?.questionId);
  const spec = q && isScenarioQuestion(q) ? scenarioSpecOf(q.answer) : null;
  if (!q || !spec) return NextResponse.json({ error: "That scenario could not be found." }, { status: 404 });
  if (!secret()) return NextResponse.json({ error: "Scenario practice is not available on this environment." }, { status: 503 });
  const key = tokenKey(secret());

  // ── the session, if any: the question must be in it, answered once, and with feedback after each answer ──
  let sessionId: string | null = null, answeredCount = 0;
  if (isUuid(body?.sessionId)) {
    const s = await getRevisionSession(ctx.admin, ctx.userId, body.sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your revision session could not be read just now." }, { status: 503 });
    if (!s.data || !s.data.questionIds.includes(q.id)) return NextResponse.json({ error: "That question is not in this session." }, { status: 404 });
    if (s.data.attempts.some(a => a.questionId === q.id)) return NextResponse.json({ error: "You have already answered this one in this session." }, { status: 409 });
    if (s.data.session.feedback !== "immediate") return NextResponse.json({ error: "A scenario is answered in sessions with feedback after each answer." }, { status: 409 });
    sessionId = s.data.session.id; answeredCount = s.data.attempts.length + s.data.held.length;
  }

  // ── where the learner stands: the first stage, or the one the token says ──
  const now = Date.now();
  let progress: Progress = { next: 0, results: [], evaluator: null };
  if (body?.token !== undefined && body?.token !== null) {
    const p = readProgress(key, body.token, { userId: ctx.userId, questionId: q.id, answer: q.answer }, now);
    if (!p || p.next >= spec.stages.length) return NextResponse.json({ error: "This scenario has timed out or changed. Start it again from the first stage." , restart: true }, { status: 409 });
    progress = p;
  }
  const n = progress.next, stage = spec.stages[n];

  const a = parseStageAnswer(stage, body?.response);
  if (!a) return NextResponse.json({ error: "Answer this stage first." }, { status: 400 });
  if (a.kind === "text" && findPatientIdentifiers(a.text).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });

  // ── this stage's mark: code, then (a short stage only) AI evaluation or the learner's own judgement ──
  let result: StageResult | null = null;
  let evaluator = progress.evaluator;
  const coded = markStageByCode(stage, a);
  if (coded) result = { score: coded.score, by: "code", answer: answerSummary(stage, a) };
  else if (a.kind === "text") {
    if (typeof body?.selfGrade === "boolean") result = { score: body.selfGrade ? 1 : 0, by: "self", answer: answerSummary(stage, a) };
    else {
      const judged = await judgeShort(ctx, req, q, stage, n, a.text, sessionId);
      if (judged.ok) { result = { score: verdictScore(judged.verdict), by: "ai", answer: answerSummary(stage, a), feedback: judged.feedback, parts: judged.parts }; evaluator = judged.evaluator; }
      else return NextResponse.json({ needsSelfGrade: true, stage: n, accepted: stage.accepted, reason: judged.why, label: MARKING_LABEL.self_graded });
    }
  }
  if (!result) return NextResponse.json({ error: "This answer could not be marked." }, { status: 400 });
  const results = [...progress.results, result];

  // ── a later stage is still to come: its reveal is this reply, and nothing of the key goes with it ──
  if (n + 1 < spec.stages.length) {
    const next = stageView(spec, n + 1)!;
    const token = signProgress(key, { userId: ctx.userId, questionId: q.id, answer: q.answer }, { next: n + 1, results, evaluator }, now);
    return NextResponse.json({ recorded: false, stage: { index: n, score: result.score, by: result.by }, next, token });
  }

  // ── the last stage: ONE attempt for the whole scenario, with every stage as it was marked ──
  const policy = await loadIndividualPolicy(ctx.admin);
  const srs = { masteryReps: policy.scholarSrsMasteryReps, masteryDays: policy.scholarSrsMasteryDays, maxIntervalDays: policy.scholarSrsMaxIntervalDays, harderIntervalPercent: policy.scholarSrsHarderIntervalPercent };
  const m = scenarioMarks(spec, results);
  const marking = scenarioMarking(results);
  // SQIE WS-D: each AI-judged stage keeps its five parts (right, missing, misconceptions, why, next), not only the summary.
  const formative = marking === "ai_evaluation" ? formativeFeedback(results.flatMap((r, i) => (r.by === "ai" ? [{ part: i + 1, feedback: r.feedback ?? null, parts: r.parts ?? null }] : [])), evaluator) : null;
  const kept = withFormative(withRubricSnapshot(storedStages(results), rubricSnapshotOf(q)), formative);
  const saved = await recordRevisionAttempt(ctx.admin, ctx.userId, q, {
    chosenIndex: null, response: kept, correct: m.correct, score: m.score, marking, evaluator: marking === "ai_evaluation" ? evaluator : null, sessionId, srs,
  });
  if (!saved.ok) return NextResponse.json({ error: "Your answer could not be saved. Try again shortly." }, { status: 500 });
  // SCHOLAR-CONTINUITY-01 (791): what this scenario was assessed against, stage by stage. Never fails the answer.
  await keepAttemptSnapshot(ctx, q, { attempt: saved.attempt, chosenIndex: null, response: kept, correct: m.correct, score: m.score, marking });
  if (sessionId) await updateRevisionSession(ctx.admin, ctx.userId, sessionId, { position: answeredCount + 1 });
  return NextResponse.json({
    recorded: true, stage: { index: n, score: result.score, by: result.by },
    feedback: feedbackView(q, {
      correct: m.correct, score: m.score, marking, scenario: results, justMarked: true, card: saved.card, nextReviewAt: saved.nextReviewAt ?? null,
      link: (await questionLinks(ctx.admin, ctx.userId, [q])).get(q.id) ?? null,
    }),
  });
}

/**
 * One short stage the code could not mark: the formative evaluation (policy ai_then_self, the learner's AI standing, consent, the metered
 * runner), against THIS stage's question, accepted answers and key point. ok:false says why, and the learner then marks it themselves.
 */
async function judgeShort(
  ctx: Parameters<typeof aiPreflight>[0], req: Request, q: NonNullable<Awaited<ReturnType<typeof getQuestion>>>, stage: ScenarioStage, n: number, text: string, sessionId: string | null,
): Promise<{ ok: true; verdict: "correct" | "partly" | "incorrect"; feedback: string; parts: FeedbackParts | null; evaluator: { model: string; promptVersion: string } } | { ok: false; why: string }> {
  const own = "This answer does not match the stored answer word for word, so compare it yourself.";
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarShortAnswerMarking !== "ai_then_self") return { ok: false, why: own };
  // SQIE-LIBRARY-EXPANSION-01: a governed library copy is AI-marked only where its version says so (a scenario is never one, but the rule is one rule).
  const standing = aiMarkingAllowed(q) ? activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate") : NO_STANDING;
  if (!standing.available) return { ok: false, why: `${standing.message ?? "AI evaluation is not available right now."} Compare your answer yourself.` };
  const pre = await aiPreflight(ctx);
  const passage = pre ? null : await getPassage(ctx.admin, ctx.userId, q.chunkId);
  if (!passage) return { ok: false, why: own };
  const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text: `${q.stem}\n${stage.reveal}\n${stage.prompt}\n${text}`, passages: [passage] }), `s${n + 1}`);
  Object.assign(ai.risk, { intentContext: { surface: "revise" as const, lessonTitle: q.stem.slice(0, 200), objective: null, materialTopics: ai.risk.topicTerms ?? [] } });
  const item = rubricOf(q.answer);
  const rubric: Rubric = {
    objective: null, level: item?.level ?? "understanding", expectedAnswer: stage.accepted[0] ?? null, keyPoints: [stage.keyPoint], acceptedAlternatives: stage.accepted,
    misconceptions: item?.misconceptions ?? [], source: item?.source ?? "notes", referenceIds: [],
  };
  const e = await runEvaluate(ctx.userId, { question: `${q.stem}\n${stage.reveal}\n${stage.prompt}`.trim(), accepted: stage.accepted, answer: text, passage, rubric }, ai.run);
  const refused = ai.refusal();
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_evaluate", sessionId, {
    question_id: q.id, stage: n + 1, outcome: refused ? `refused:${refused.error}` : !e.ok ? `error:${e.error}` : e.evaluation.ok ? `shown:${e.evaluation.verdict}` : `withheld:${e.evaluation.reason}`,
    model: e.ok ? e.model : null, prompt_version: e.ok ? e.promptVersion : null,
  });
  if (!refused && e.ok) {
    const o = answerOutcome(e.evaluation.ok ? null : e.evaluation.reason);
    await recordScholarOutcome(ctx.admin, ai, { operation: "individual_scholar_evaluate", outputKind: "other", outcome: o.outcome, reasons: o.reasons, promptVersion: e.promptVersion });
  }
  if (!refused && e.ok && e.evaluation.ok) return { ok: true, verdict: e.evaluation.verdict, feedback: e.evaluation.feedback, parts: e.evaluation.parts ?? null, evaluator: { model: e.model, promptVersion: e.promptVersion } };
  return { ok: false, why: refused ? "AI evaluation is not available for this right now, so compare your answer yourself." : "The AI could not judge this answer against your notes, so compare it yourself." };
}
