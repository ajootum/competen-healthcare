import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { ensureCheckQuestion, findSavedLesson, getLearningSession, getPassage, isUuid, listCheckAttempts, recordCheckAttempt, recordLearningEvent, sectionLinks } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { parseTeachAnswer, questionText } from "@/lib/individual/scholar/teach-format";
import { CHECK_NOT_SAVED_NOTE, CHECK_SAVED_NOTE, SELF_GRADE_SCORE, checkResponse, isSelfGrade, type SelfGrade } from "@/lib/individual/scholar/learn-check-record";
import { QUESTION_MAX } from "@/lib/individual/scholar/config";
import { keepCheckSnapshot } from "@/lib/individual/scholar/attempt-integrity";

import { adaptiveDecision } from "@/lib/individual/scholar/learning-need-service";
import { isStatedConfidence, parseCheckLevel } from "@/lib/individual/scholar/learning-need";
export const dynamic = "force-dynamic";

// LEARNING-CLOSE-2026-11 WS01 (owner decision D01, 4 Nov 2026): THE LEARNER'S KEPT UNDERSTANDING CHECKS.
//
//   GET  ?session=<id>[&step=<n>]   the caller's kept checks of a lesson (or a session), newest first (store.ts listCheckAttempts);
//                                   with neither, the latest overall. No AI, no allowance read.
//   POST { sessionId, step, question, answer, selfGrade?, checkCited? }
//        keeps an answer the learner judged THEMSELVES against the lesson's key points (self_graded, with their grade) or chose to
//        keep without a mark (unmarked): the self-review path, when AI did not judge it. The question must be one the lesson's
//        saved teaching wrote (teach-format.ts), the answer is screened for identifiers, and the clarify learning event
//        (verdict null: a self-grade is never a verdict) references the attempt. Nothing here calls AI.
//        SALE-2026-11 R1: optional { confidence, checkLevel, followUp, aiAvailable, applyAvailable }; a self-graded answer gets the
//        next-step decision (learning-need.ts, rule table, no AI), kept on the same attempt and returned as `adaptive`.
// A judged answer is kept by the act route itself, with its judgement (act/route.ts, the D01 block).
// FORMATIVE. A kept check is a learning record for the learner, never assessment, never competence.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const url = new URL(req.url);
  const session = url.searchParams.get("session"), stepRaw = url.searchParams.get("step");
  const step = stepRaw !== null && /^\d{1,4}$/.test(stepRaw) ? Number(stepRaw) : null;
  const r = await listCheckAttempts(ctx.admin, ctx.userId, { sessionId: session && isUuid(session) ? session : null, step, limit: session ? 100 : 30 });
  if (!r.ok) return NextResponse.json({ error: "Your kept checks could not be read just now." }, { status: 503 });
  return NextResponse.json({ items: r.data });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [body, policy] = await Promise.all([req.json().catch(() => ({})), loadIndividualPolicy(ctx.admin)]);
  if (policy.scholarCheckBehaviour === "off") return NextResponse.json({ error: "Understanding checks are not offered here." }, { status: 403 });
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max + 1) : "");
  const sessionId = isUuid(body?.sessionId) ? String(body.sessionId) : null;
  const step = Number.isInteger(body?.step) && Number(body.step) >= 0 ? Number(body.step) : null;
  const question = text(body?.question, 400), answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  const selfGrade: SelfGrade | null = isSelfGrade(body?.selfGrade) ? body.selfGrade : null;
  if (!sessionId || step === null) return NextResponse.json({ error: "Name the lesson the check belongs to." }, { status: 400 });
  if (!question || question.length > 400 || !answer || answer.length > QUESTION_MAX) return NextResponse.json({ error: "Answer the check question first." }, { status: 400 });
  if (findPatientIdentifiers(answer).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  // Not recorded here: said plainly, nothing kept (the same rule as every learning event).
  if (policy.scholarLearningHistory !== "record") return NextResponse.json({ kept: null, note: CHECK_NOT_SAVED_NOTE, reason: "history_off" });

  const s = await getLearningSession(ctx.admin, ctx.userId, sessionId);
  if (!s.ok) return NextResponse.json({ error: "Your session could not be read just now." }, { status: 503 });
  const here = s.data?.steps.find(x => x.step === step);
  if (!here || !here.sections.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The question must be one of this lesson's own (its saved teaching), so nothing typed becomes a question.
  const chunkIds = here.sections.map(x => x.chunkId);
  const saved = await findSavedLesson(ctx.admin, ctx.userId, { action: "teach", materialId: here.sections[0].materialId, chunkIds });
  const parts = saved ? parseTeachAnswer(saved.content) : null;
  const own = parts?.questions.find(q => questionText(q) === question) ?? null;
  if (!own) return NextResponse.json({ error: "That question is not one of this lesson's checks." }, { status: 400 });
  const cited = Number.isInteger(body?.checkCited) && Number(body.checkCited) >= 1 ? Number(body.checkCited) : null;
  const sectionId = (cited && saved?.sources[cited - 1]) || here.sections[0].chunkId;
  const passage = (await getPassage(ctx.admin, ctx.userId, sectionId)) ?? (await getPassage(ctx.admin, ctx.userId, here.sections[0].chunkId));
  if (!passage) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
  const links = await sectionLinks(ctx.admin, ctx.userId, [passage.chunkId]).catch(() => []);
  const q = await ensureCheckQuestion(ctx.admin, ctx.userId, {
    materialId: passage.materialId, chunkId: passage.chunkId, stem: question, keyPoints: parts?.points ?? [], modelAnswer: null, sourceQuote: passage.content.slice(0, 1500),
    competencyId: links.find(l => l.accepted)?.competencyId ?? null, model: saved?.model ?? "learner", provider: "scholar", promptVersion: saved?.promptVersion ?? "learner:check",
  });
  const adaptive = q && selfGrade ? await adaptiveDecision(ctx.admin, ctx.userId, policy, {
    sessionId, step, steps: s.data!.steps.map(x => ({ step: x.step })), chunkIds,
    current: { questionId: q.id, stem: question, verdict: null, selfGrade, feedback: null, level: parseCheckLevel(body?.checkLevel) },
    followUp: body?.followUp, aiAvailable: body?.aiAvailable === true, applyAvailable: body?.applyAvailable === true,
  }).catch(() => null) : null;
  const confidence = isStatedConfidence(body?.confidence) ? body.confidence : null;
  const attempt = q ? {
    questionId: q.id, response: checkResponse({ text: answer, question, selfGrade, confidence, adaptive }),
    correct: selfGrade === "covered", score: selfGrade ? SELF_GRADE_SCORE[selfGrade] : null, marking: selfGrade ? "self_graded" as const : "unmarked" as const,
  } : null;
  const kept = q && attempt ? await recordCheckAttempt(ctx.admin, ctx.userId, { ...attempt, contentVersion: q.contentVersion, evaluator: null, missed: selfGrade === "missed" }) : null;
  if (!kept || !attempt) return NextResponse.json({ kept: null, note: CHECK_NOT_SAVED_NOTE, reason: "not_kept" });
  // SQIE WS-D (990): the immutable 791 snapshot of this kept answer. Never fails the answer; without 990 nothing is kept, as before.
  await keepCheckSnapshot(ctx, kept, attempt);
  await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action: "clarify", verdict: null, chunkIds: [passage.chunkId], attemptId: kept.id });
  return NextResponse.json({ kept: { attemptId: kept.id, answeredAt: kept.answeredAt, questionId: q!.id, marking: selfGrade ? "self_graded" : "unmarked", chunkId: passage.chunkId, materialId: passage.materialId }, note: CHECK_SAVED_NOTE, ...(adaptive ? { adaptive } : {}) });
}
