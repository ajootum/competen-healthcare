// Allow up to 60s: a short answer may be evaluated by AI.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getPassage, getQuestion, getRevisionSession, recordRevisionAttempt, updateRevisionSession, isUuid } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runEvaluate } from "@/lib/individual/scholar/generation";
import { keyOf, markResponse, parseResponse, storedResponse } from "@/lib/individual/scholar/revision";
import { citationOf, feedbackView } from "@/lib/individual/scholar/revision-view";
import { MARKING_LABEL } from "@/lib/individual/scholar/config";

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

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const q = await getQuestion(ctx.admin, ctx.userId, body?.questionId);
  if (!q || !keyOf(q)) return NextResponse.json({ error: "That question could not be found." }, { status: 404 });

  // ── the session, if any: the question must be in it, and answered once ──
  let sessionId: string | null = null, feedbackMode: "immediate" | "end" = "immediate", answeredCount = 0;
  if (isUuid(body?.sessionId)) {
    const s = await getRevisionSession(ctx.admin, ctx.userId, body.sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your revision session could not be read just now." }, { status: 503 });
    if (!s.data || !s.data.questionIds.includes(q.id)) return NextResponse.json({ error: "That question is not in this session." }, { status: 404 });
    if (s.data.attempts.some(a => a.questionId === q.id)) return NextResponse.json({ error: "You have already answered this one in this session." }, { status: 409 });
    sessionId = s.data.session.id; feedbackMode = s.data.session.feedback; answeredCount = s.data.attempts.length;
  }

  // ── a flashcard's back, to grade recall against. Not an answer, so nothing is recorded ──
  if (body?.reveal === true) {
    if (q.kind !== "flashcard") return NextResponse.json({ error: "Only a flashcard is revealed before answering." }, { status: 400 });
    return NextResponse.json({ back: feedbackView(q, { correct: true, score: null, marking: "self_graded" }).answer, source: { quote: q.sourceQuote, citation: citationOf(q), materialId: q.materialId, chunkId: q.chunkId } });
  }

  const r = parseResponse(q, body?.response);
  if (!r) return NextResponse.json({ error: "Answer the question first." }, { status: 400 });
  if (r.kind === "text" && findPatientIdentifiers(r.text).length)
    return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);
  const srs = { masteryReps: policy.scholarSrsMasteryReps, masteryDays: policy.scholarSrsMasteryDays, maxIntervalDays: policy.scholarSrsMaxIntervalDays, harderIntervalPercent: policy.scholarSrsHarderIntervalPercent };

  // ── marking: code, then (a short answer only) AI evaluation or the student's own judgement ──
  let mark = markResponse(q, r);
  let evaluation: string | null = null, evaluator: { model: string; promptVersion: string } | null = null;
  if ("needsJudgement" in mark && r.kind === "text") {
    const accepted = (keyOf(q) as { answers: string[] }).answers;
    if (typeof body?.selfGrade === "boolean") mark = { correct: body.selfGrade, score: body.selfGrade ? 1 : 0, marking: "self_graded" };
    else {
      let why = "This answer does not match the stored answer word for word, so compare it yourself.";
      if (policy.scholarShortAnswerMarking === "ai_then_self") {
        const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate");
        const pre = standing.available ? await aiPreflight(ctx) : null;
        const passage = standing.available && !pre ? await getPassage(ctx.admin, ctx.userId, q.chunkId) : null;
        if (!standing.available) why = `${standing.message ?? "AI evaluation is not available right now."} Compare your answer yourself.`;
        else if (passage) {
          const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text: `${q.stem}\n${r.text}`, passages: [passage] }));
          const e = await runEvaluate(ctx.userId, { question: q.stem, accepted, answer: r.text, passage }, ai.run);
          const refused = ai.refusal();
          await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_evaluate", sessionId, {
            question_id: q.id, outcome: refused ? `refused:${refused.error}` : !e.ok ? `error:${e.error}` : e.evaluation.ok ? `shown:${e.evaluation.verdict}` : `withheld:${e.evaluation.reason}`,
            model: e.ok ? e.model : null, prompt_version: e.ok ? e.promptVersion : null,
          });
          if (!refused && e.ok && e.evaluation.ok) {
            // Recorded as ai_evaluation below, with the evaluator model and prompt version.
            mark = { correct: e.evaluation.verdict === "correct", score: e.evaluation.score, marking: "deterministic" };
            evaluation = e.evaluation.feedback; evaluator = { model: e.model, promptVersion: e.promptVersion };
          } else why = refused ? "AI evaluation is not available for this right now, so compare your answer yourself." : "The AI could not judge this answer against your notes, so compare it yourself.";
        }
      }
      if (!evaluator) return NextResponse.json({ needsSelfGrade: true, accepted, reason: why, label: MARKING_LABEL.self_graded });
    }
  }
  if ("needsJudgement" in mark) return NextResponse.json({ error: "This answer could not be marked." }, { status: 400 });
  const marking = evaluator ? "ai_evaluation" as const : mark.marking;

  // ── the record: an attempt naming its session; the card reviewed, made or reset ──
  const stored = storedResponse(r);
  const saved = await recordRevisionAttempt(ctx.admin, ctx.userId, q, {
    chosenIndex: stored.chosenIndex, response: stored.response, correct: mark.correct, score: mark.score, marking, evaluator, sessionId,
    quality: r.kind === "recall" ? r.quality : null, srs,
  });
  if (!saved.ok) return NextResponse.json({ error: "Your answer could not be saved. Try again shortly." }, { status: 500 });
  if (sessionId) await updateRevisionSession(ctx.admin, ctx.userId, sessionId, { position: answeredCount + 1 });

  if (feedbackMode === "end") return NextResponse.json({ recorded: true, held: true });
  return NextResponse.json({
    recorded: true,
    feedback: feedbackView(q, { correct: mark.correct, score: mark.score, marking, evaluation, card: saved.card, nextReviewAt: saved.nextReviewAt ?? null }),
  });
}
