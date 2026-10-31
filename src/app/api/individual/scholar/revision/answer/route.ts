// Allow up to 60s: a short answer may be evaluated by AI.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { clearHeldAnswer, getPassage, getQuestion, getRevisionSession, holdRevisionAnswer, recordRevisionAttempt, updateRevisionSession, isUuid, type QuestionRow } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runEvaluate } from "@/lib/individual/scholar/generation";
import { codeMarkParts, keyOf, markResponse, parseResponse, partMarks, practiceMarks, storedResponse, structuredParts, type PartResult } from "@/lib/individual/scholar/revision";
import { citationOf, feedbackView } from "@/lib/individual/scholar/revision-view";
import { questionLinks } from "@/lib/individual/scholar/revision-links";
import { MARKING_LABEL, QUESTION_MAX, RECOVERY_STILL_WITHHELD } from "@/lib/individual/scholar/config";
import { parseRecoveryRequest, recordRecoveryResult, recoveredReply, recoveryPassage, rederiveRecovery, type Rederived } from "@/lib/individual/scholar/evidence-recovery";
import { rubricOf, type FeedbackParts } from "@/lib/individual/scholar/question-intel";
import { answerOutcome, recordScholarOutcome, type Withheld } from "@/lib/individual/scholar/outcome";
import { ORIGIN_LABEL, originOf, recallCardOf } from "@/lib/individual/scholar/flashcards";
import { formativeFeedback, withFormative } from "@/lib/individual/scholar/written-feedback";
import { CLOZE_REVEALED_TEXT, isClozeQuestion } from "@/lib/individual/scholar/cloze";
import { extendedMarks, extendedSpecOf, isExtendedQuestion } from "@/lib/individual/scholar/formats";
import { rubricSnapshotOf, withRubricSnapshot } from "@/lib/individual/scholar/rubric-snapshot";
import { keepAttemptSnapshot } from "@/lib/individual/scholar/attempt-integrity";
import { aiMarkingAllowed } from "@/lib/individual/scholar/library-format";

/** SQIE-LIBRARY-EXPANSION-01: what a governed library copy whose version is not marked by AI says instead of calling it. */
const LIBRARY_SELF_MARKED = { available: false, insufficient: false, message: "This Competen library question is marked against its key, not by AI." };

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/revision/answer -- COMPETEN-SCHOLAR-REVISION-01 R2, R3, R4.
//
// Body { questionId, response, sessionId?, selfGrade?, reveal? }.
//   response   the answer for the question's kind (revision.ts parseResponse)
//   reveal     a flashcard's back, shown so the student can grade their recall. Nothing is recorded.
//   selfGrade  a short answer the code could not mark, judged by the student against the stored accepted answers
// MARKED BY CODE WHERE CODE CAN (revision.ts markResponse). A short answer that matches no accepted answer is AI
// evaluation (activity `evaluate`, metered, with its risk) where policy and the student's AI allow and it succeeds, or
// else the student's own judgement -- each labelled for what it is (MARKING_LABEL). Nothing is guessed.
// The answer is an attempt naming its session (416, 417). A due card is reviewed by it, a missed one made or reset.
// FEEDBACK: immediately, or held until the end of the session when that is the session's mode.
// SCHOLAR-SQIE-02: recovery { id, mode, question } re-runs the SAME evaluation on the question's passage plus the
// evidence that recovery found -- re-derived here from the learner's own notes and the approved library, never taken
// from the request -- under the same checks. Published abstracts are not added: the evaluation reads notes only.
// SCHOLAR-SQIE-LEARNER-01: true/false is marked by code. An EXTENDED response is marked by the same evaluator (activity `evaluate`)
// against its numbered key points: the score is the share of key points it says the answer makes, the practice marks are whole
// marks a point, all labelled formative. Where the evaluator is unavailable or cannot judge, the student marks it against the model answer.
// Every attempt that carries a `response` also keeps a compact snapshot of the rubric it was marked against under response.rubric
// (rubric-snapshot.ts), so feedback shown again is read against that guide, not whatever the question says later. A choice (mcq,
// case) is stored in chosen_index, which 416 does not allow beside a response, so those keep the 416 shape.
// SCHOLAR-SQIE-CLOSE-01 (710): a STRUCTURED question { response: { texts: [one per part] }, selfGrades? } is marked part by
// part -- blank or matching what the part accepts by code, otherwise by the same evaluation (activity `evaluate`, one
// metered call per part, the part's rubric), otherwise by the student -- and its practice marks are formative.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const found = await getQuestion(ctx.admin, ctx.userId, body?.questionId);
  if (!found || !keyOf(found)) return NextResponse.json({ error: "That question could not be found." }, { status: 404 });
  let q: QuestionRow = found;

  // ── the session, if any: the question must be in it, and answered once ──
  let sessionId: string | null = null, feedbackMode: "immediate" | "end" = "immediate", answeredCount = 0, finished = false, holding = false;
  let held: { text: string } | null = null;
  if (isUuid(body?.sessionId)) {
    const s = await getRevisionSession(ctx.admin, ctx.userId, body.sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your revision session could not be read just now." }, { status: 503 });
    if (!s.data || !s.data.questionIds.includes(q.id)) return NextResponse.json({ error: "That question is not in this session." }, { status: 404 });
    if (s.data.attempts.some(a => a.questionId === q.id)) return NextResponse.json({ error: "You have already answered this one in this session." }, { status: 409 });
    // SCHOLAR-FLASHCARDS-01: in a flashcards session every item is a card. A governed library question offered as one
    // (flashcards.ts recallCardOf) is recalled and self-graded as a card: front its stem, back its approved answer.
    if (s.data.session.mode === "flashcards") {
      const card = recallCardOf(q);
      if (!card) return NextResponse.json({ error: "That card could not be found." }, { status: 404 });
      q = card;
    }
    sessionId = s.data.session.id; feedbackMode = s.data.session.feedback; answeredCount = s.data.attempts.length + s.data.held.length;
    finished = s.data.session.status === "completed"; holding = s.data.holding;
    held = s.data.held.find(h => h.questionId === q.id)?.response ?? null;
    // Owner decision (2026-10-25, REVISION-01 R4): a short answer held in an end-of-session or Mock session is
    // graded by the student only once the session has ended -- and it is the answer they wrote that is graded.
    if (held && !(finished && typeof body?.selfGrade === "boolean")) return NextResponse.json({ error: "You have already answered this one in this session." }, { status: 409 });
    if (!held && feedbackMode === "end" && !finished && holding && typeof body?.selfGrade === "boolean")
      return NextResponse.json({ error: "You mark this yourself at the end of the session." }, { status: 409 });
  }

  // ── a flashcard's back, to grade recall against. Not an answer, so nothing is recorded ──
  if (body?.reveal === true) {
    if (q.kind !== "flashcard") return NextResponse.json({ error: "Only a flashcard is revealed before answering." }, { status: 400 });
    // SCHOLAR-FLASHCARDS-01: where the card comes from (notes, library, or the learner's own), and its explanation.
    const origin = originOf(q);
    return NextResponse.json({
      back: feedbackView(q, { correct: true, score: null, marking: "self_graded" }).answer, source: { quote: q.sourceQuote, citation: citationOf(q), materialId: q.materialId, chunkId: q.chunkId },
      card: { origin, originLabel: ORIGIN_LABEL[origin], explanation: q.rationale && q.rationale.trim() !== feedbackView(q, { correct: true, score: null, marking: "self_graded" }).answer.trim() ? q.rationale : null },
    });
  }

  // ── SCHOLAR-SQIE-CLOSE-01: a structured question, part by part ──
  if (q.kind === "structured") {
    // Offered only with feedback after each answer (sessions route): a multi-part answer is not held to the end.
    if (feedbackMode === "end" && !finished) return NextResponse.json({ error: "Structured questions are answered in sessions with feedback after each answer." }, { status: 409 });
    return answerStructured(ctx, req, body, q, sessionId, answeredCount);
  }

  // SCHOLAR-COMPANION-01 P1: a cloze item the learner chose to see the answer to is recorded as a miss, labelled as such --
  // a revealed answer is never a recalled one, and it feeds the same SM-2 lapse as any other miss.
  const gaveUp = !held && isClozeQuestion(q) && body?.giveUp === true;
  if (gaveUp) body.response = { text: CLOZE_REVEALED_TEXT };
  const r = held ? { kind: "text" as const, text: held.text } : parseResponse(q, body?.response);
  if (!r) return NextResponse.json({ error: "Answer the question first." }, { status: 400 });
  if (r.kind === "text" && findPatientIdentifiers(r.text).length)
    return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);
  const recoveryAsked = parseRecoveryRequest(body?.recovery, "notes_only", QUESTION_MAX);
  if (recoveryAsked && !recoveryAsked.ok) return NextResponse.json({ error: recoveryAsked.error }, { status: 400 });
  const recovery = recoveryAsked?.value ?? null;
  let recovered: Rederived | null = null;
  const srs = { masteryReps: policy.scholarSrsMasteryReps, masteryDays: policy.scholarSrsMasteryDays, maxIntervalDays: policy.scholarSrsMaxIntervalDays, harderIntervalPercent: policy.scholarSrsHarderIntervalPercent };

  // ── marking: code, then (a short answer only) AI evaluation or the student's own judgement ──
  let mark = markResponse(q, r);
  if (gaveUp) mark = { correct: false, score: 0, marking: "deterministic" };
  let evaluation: string | null = null, evaluator: { model: string; promptVersion: string } | null = null;
  let evaluationParts: FeedbackParts | null = null;
  const extSpec = isExtendedQuestion(q) ? extendedSpecOf(q.answer) : null;
  let extendedMatched: number[] | null = null;
  let withheld: (Withheld & { recovered?: ReturnType<typeof recoveredReply> }) | null = null;
  if ("needsJudgement" in mark && r.kind === "text") {
    const accepted = (keyOf(q) as { answers: string[] }).answers;
    if (typeof body?.selfGrade === "boolean") mark = { correct: body.selfGrade, score: body.selfGrade ? 1 : 0, marking: "self_graded" };
    else {
      let why = "This answer does not match the stored answer word for word, so compare it yourself.";
      if (policy.scholarShortAnswerMarking === "ai_then_self") {
        // SQIE-LIBRARY-EXPANSION-01: a governed library copy is AI-marked only where its version says rubric_ai_formative.
        const standing = aiMarkingAllowed(q) ? activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate") : LIBRARY_SELF_MARKED;
        const pre = standing.available ? await aiPreflight(ctx) : null;
        let passage = standing.available && !pre ? await getPassage(ctx.admin, ctx.userId, q.chunkId) : null;
        if (passage && recovery) {
          // The question's own words are what recovery searches for; the browser's are not used.
          recovered = await rederiveRecovery(ctx, policy, { ...recovery, question: q.stem.slice(0, QUESTION_MAX) }, { materialId: q.materialId, sectionId: q.chunkId });
          if (!recovered.ok && recovered.reason === "unknown") return NextResponse.json({ error: "Those learning resources could not be found. Look for them again." }, { status: 400 });
          if (!recovered.ok) return NextResponse.json({ needsSelfGrade: true, accepted, reason: RECOVERY_STILL_WITHHELD, label: MARKING_LABEL.self_graded, withheld: { reason: "no_evidence" }, questionId: q.id, attempt: r.text, recovered: recoveredReply(recovered, false) });
          passage = recoveryPassage(passage, recovered.inputs);
        }
        if (!standing.available) why = `${standing.message ?? "AI evaluation is not available right now."} Compare your answer yourself.`;
        else if (passage) {
          const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text: `${q.stem}\n${r.text}`, passages: [passage] }));
          // SCHOLAR-QUESTION-INTELLIGENCE-01: judged against the question's key points and misconceptions where it has them.
          const rubric = rubricOf(q.answer);
          const e = await runEvaluate(ctx.userId, { question: q.stem, accepted, answer: r.text, passage, rubric, ...(extSpec ? { numberedKeyPoints: extSpec.keyPoints } : {}) }, ai.run);
          const refused = ai.refusal();
          await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_evaluate", sessionId, {
            question_id: q.id, outcome: refused ? `refused:${refused.error}` : !e.ok ? `error:${e.error}` : e.evaluation.ok ? `shown:${e.evaluation.verdict}` : `withheld:${e.evaluation.reason}`,
            model: e.ok ? e.model : null, prompt_version: e.ok ? e.promptVersion : null,
          });
          // SCHOLAR-SQIE-02: a safe withhold (the evaluator could not judge it against the notes) is typed, kept with the
          // student's answer, and counted apart from an answered evaluation -- codes only, never the answer.
          if (!refused && e.ok) {
            withheld = e.evaluation.ok ? null : { reason: e.evaluation.reason };
            const o = answerOutcome(withheld?.reason ?? null);
            await recordScholarOutcome(ctx.admin, ai, { operation: "individual_scholar_evaluate", outputKind: "other", outcome: o.outcome, reasons: o.reasons, promptVersion: e.promptVersion });
            if (recovery && recovered?.ok) await recordRecoveryResult(ctx.admin, recovery.id, e.evaluation.ok);
          }
          if (!refused && e.ok && e.evaluation.ok) {
            // Recorded as ai_evaluation below, with the evaluator model and prompt version.
            if (extSpec && e.evaluation.matched) { const xm = extendedMarks(extSpec, e.evaluation.matched); extendedMatched = xm.matched; mark = { correct: xm.correct, score: xm.score, marking: "deterministic" }; }
            else mark = { correct: e.evaluation.verdict === "correct", score: e.evaluation.score, marking: "deterministic" };
            evaluation = e.evaluation.feedback; evaluationParts = e.evaluation.parts ?? null; evaluator = { model: e.model, promptVersion: e.promptVersion };
          } else why = refused ? "AI evaluation is not available for this right now, so compare your answer yourself." : "The AI could not judge this answer against your notes, so compare it yourself.";
        }
      }
      // Feedback at the end, and Mock (owner decision, R4): nothing is revealed before the end -- not the accepted
      // answer, not the explanation, not the prompt to grade it. The answer is kept, unmarked, on its session item
      // (425) and graded when the session ends. Where 425 is absent it cannot be kept, so the prompt comes now.
      if (!evaluator && sessionId && feedbackMode === "end" && !finished && holding) {
        if (!(await holdRevisionAnswer(ctx.admin, ctx.userId, sessionId, q.id, r.text))) return NextResponse.json({ error: "Your answer could not be saved. Try again shortly." }, { status: 500 });
        await updateRevisionSession(ctx.admin, ctx.userId, sessionId, { position: answeredCount + 1 });
        return NextResponse.json({ recorded: true, held: true });
      }
      // SCHOLAR-SQIE-02: after an explanation from recovered evidence that was still withheld, the withhold says so and
      // carries what remains unanswered (withheld.recovered); the student's own judgement is still what marks it.
      if (recovered && withheld) { why = RECOVERY_STILL_WITHHELD; withheld = { ...withheld, recovered: recoveredReply(recovered, false) }; }
      if (!evaluator) return NextResponse.json({ needsSelfGrade: true, accepted, reason: why, label: MARKING_LABEL.self_graded, ...(extSpec ? { extended: { modelAnswer: extSpec.modelAnswer, keyPoints: extSpec.keyPoints, marks: extSpec.marks } } : {}), ...(withheld ? { withheld, questionId: q.id, attempt: r.text } : {}) });
    }
  }
  if ("needsJudgement" in mark) return NextResponse.json({ error: "This answer could not be marked." }, { status: 400 });
  const marking = evaluator ? "ai_evaluation" as const : mark.marking;

  // ── the record: an attempt naming its session; the card reviewed, made or reset ──
  const stored = storedResponse(r);
  // SCHOLAR-WRITTEN-FEEDBACK-01: an AI-evaluated answer keeps the formative feedback it was shown, on its own response.
  const formative = marking === "ai_evaluation" ? formativeFeedback([{ part: null, feedback: evaluation, parts: evaluationParts }], evaluator) : null;
  // SCHOLAR-SQIE-LEARNER-01: the key points an extended answer made, then the rubric snapshot, then the feedback (which yields first if the size is tight).
  const answered = extendedMatched && stored.response ? { ...stored.response, matched: extendedMatched } : stored.response;
  const kept = withFormative(withRubricSnapshot(answered, rubricSnapshotOf(q)), formative);
  const saved = await recordRevisionAttempt(ctx.admin, ctx.userId, q, {
    chosenIndex: stored.chosenIndex, response: kept, correct: mark.correct, score: mark.score, marking, evaluator, sessionId,
    quality: r.kind === "recall" ? r.quality : null, srs,
  });
  if (!saved.ok) return NextResponse.json({ error: "Your answer could not be saved. Try again shortly." }, { status: 500 });
  // SCHOLAR-CONTINUITY-01 (791): what this answer was assessed against, kept beside it. Never fails the answer.
  await keepAttemptSnapshot(ctx, q, { attempt: saved.attempt, chosenIndex: stored.chosenIndex, response: kept, correct: mark.correct, score: mark.score, marking });
  if (held && sessionId) await clearHeldAnswer(ctx.admin, ctx.userId, sessionId, q.id);
  else if (sessionId) await updateRevisionSession(ctx.admin, ctx.userId, sessionId, { position: answeredCount + 1 });

  if (feedbackMode === "end" && !finished) return NextResponse.json({ recorded: true, held: true });
  return NextResponse.json({
    recorded: true,
    feedback: feedbackView(q, { correct: mark.correct, score: mark.score, marking, evaluation, evaluationParts, extendedMatched, card: saved.card, nextReviewAt: saved.nextReviewAt ?? null, link: (await questionLinks(ctx.admin, ctx.userId, [q])).get(q.id) ?? null }),
    ...(recovered?.ok && evaluator ? { recovered: recoveredReply(recovered, true) } : {}),
  });
}

/**
 * SCHOLAR-SQIE-CLOSE-01. One structured answer: each part marked by code where code can, else by AI evaluation where
 * policy and the student's AI allow (stopping at the first part it cannot judge), else by the student's own judgement
 * of every part code could not mark. One attempt, labelled for how it was marked; practice marks are formative.
 */
async function answerStructured(ctx: IndividualContext, req: Request, body: any, q: QuestionRow, sessionId: string | null, answeredCount: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const parts = structuredParts(q);
  const r = parseResponse(q, body?.response);
  if (!r || r.kind !== "parts") return NextResponse.json({ error: "Answer at least one part first." }, { status: 400 });
  if (r.texts.some(t => findPatientIdentifiers(t).length)) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);
  const srs = { masteryReps: policy.scholarSrsMasteryReps, masteryDays: policy.scholarSrsMasteryDays, maxIntervalDays: policy.scholarSrsMaxIntervalDays, harderIntervalPercent: policy.scholarSrsHarderIntervalPercent };
  const results: (PartResult | null)[] = codeMarkParts(parts, r.texts);
  let evaluator: { model: string; promptVersion: string } | null = null;
  const selfGrades: unknown[] | null = Array.isArray(body?.selfGrades) ? body.selfGrades : null;

  if (results.some(x => x === null)) {
    if (selfGrades) {
      // The student's own judgement, for every part code could not mark. Nothing the AI said earlier is kept as a mark.
      for (let i = 0; i < parts.length; i++) if (results[i] === null) {
        if (typeof selfGrades[i] !== "boolean") return NextResponse.json({ error: "Mark each part yourself first." }, { status: 400 });
        results[i] = { awarded: selfGrades[i] ? parts[i].marks : 0, by: "self" };
      }
    } else {
      let why = "Some parts do not match the stored answers word for word, so compare them yourself.";
      if (policy.scholarShortAnswerMarking === "ai_then_self") {
        // SQIE-LIBRARY-EXPANSION-01: a governed library copy is AI-marked only where its version says rubric_ai_formative.
        const standing = aiMarkingAllowed(q) ? activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate") : LIBRARY_SELF_MARKED;
        const pre = standing.available ? await aiPreflight(ctx) : null;
        const passage = standing.available && !pre ? await getPassage(ctx.admin, ctx.userId, q.chunkId) : null;
        if (!standing.available) why = `${standing.message ?? "AI evaluation is not available right now."} Compare your answers yourself.`;
        else if (passage) {
          for (let i = 0; i < parts.length; i++) {
            if (results[i] !== null) continue;
            const part = parts[i];
            const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text: `${q.stem}\n${part.prompt}\n${r.texts[i]}`, passages: [passage] }), `p${i + 1}`);
            const e = await runEvaluate(ctx.userId, { question: `${q.stem}\n${part.prompt}`, accepted: part.accepted, answer: r.texts[i], passage, rubric: part.rubric }, ai.run);
            const refused = ai.refusal();
            await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_evaluate", sessionId, {
              question_id: q.id, part: i + 1, outcome: refused ? `refused:${refused.error}` : !e.ok ? `error:${e.error}` : e.evaluation.ok ? `shown:${e.evaluation.verdict}` : `withheld:${e.evaluation.reason}`,
              model: e.ok ? e.model : null, prompt_version: e.ok ? e.promptVersion : null,
            });
            if (!refused && e.ok) {
              const o = answerOutcome(e.evaluation.ok ? null : e.evaluation.reason);
              await recordScholarOutcome(ctx.admin, ai, { operation: "individual_scholar_evaluate", outputKind: "other", outcome: o.outcome, reasons: o.reasons, promptVersion: e.promptVersion });
            }
            if (!refused && e.ok && e.evaluation.ok) {
              results[i] = { awarded: partMarks(part.marks, e.evaluation.verdict), by: "ai", feedback: e.evaluation.feedback, parts: e.evaluation.parts ?? null };
              evaluator = { model: e.model, promptVersion: e.promptVersion };
            } else {
              // No more AI is spent on the rest: the student compares every part code could not mark.
              why = refused ? "AI evaluation is not available for this right now, so compare your answers yourself." : "The AI could not judge every part against your notes, so compare them yourself.";
              break;
            }
          }
        }
      }
      if (results.some(x => x === null)) {
        return NextResponse.json({
          needsSelfGrade: true, reason: why, label: MARKING_LABEL.self_graded,
          parts: parts.map((p, i) => ({ prompt: p.prompt, marks: p.marks, accepted: p.accepted, byCode: results[i]?.by === "blank" || results[i]?.by === "code",
            ai: results[i]?.by === "ai" ? { awarded: results[i]!.awarded, feedback: results[i]!.feedback ?? null, label: MARKING_LABEL.ai_evaluation } : null })),
        });
      }
    }
  }

  const final = results as PartResult[];
  const m = practiceMarks(parts, final);
  const marking = final.some(x => x.by === "self") ? "self_graded" as const : evaluator ? "ai_evaluation" as const : "deterministic" as const;
  const stored = storedResponse(r);
  // SCHOLAR-WRITTEN-FEEDBACK-01: how each part was marked, and (AI-evaluated only) the formative feedback on each AI part.
  const formative = marking === "ai_evaluation" ? formativeFeedback(final.flatMap((x, i) => x.by === "ai" ? [{ part: i + 1, feedback: x.feedback ?? null, parts: x.parts ?? null }] : []), evaluator) : null;
  const kept = withFormative(withRubricSnapshot({ ...stored.response, awarded: final.map(x => x.awarded), by: final.map(x => x.by) }, rubricSnapshotOf(q)), formative);
  const saved = await recordRevisionAttempt(ctx.admin, ctx.userId, q, {
    chosenIndex: null, response: kept, correct: m.correct, score: m.score, marking,
    evaluator: marking === "ai_evaluation" ? evaluator : null, sessionId, srs,
  });
  if (!saved.ok) return NextResponse.json({ error: "Your answer could not be saved. Try again shortly." }, { status: 500 });
  // SCHOLAR-CONTINUITY-01 (791): what this answer was assessed against, kept beside it. Never fails the answer.
  await keepAttemptSnapshot(ctx, q, { attempt: saved.attempt, chosenIndex: null, response: kept, correct: m.correct, score: m.score, marking });
  if (sessionId) await updateRevisionSession(ctx.admin, ctx.userId, sessionId, { position: answeredCount + 1 });
  return NextResponse.json({
    recorded: true,
    feedback: feedbackView(q, { correct: m.correct, score: m.score, marking, structured: final, card: saved.card, nextReviewAt: saved.nextReviewAt ?? null, link: (await questionLinks(ctx.admin, ctx.userId, [q])).get(q.id) ?? null }),
  });
}
