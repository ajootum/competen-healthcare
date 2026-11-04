// Allow up to 60s: a written answer may get AI reasoning feedback.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getPassage, getPrivateCase, getPrivateCaseSession } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { REASONING_CAPS } from "@/lib/cases/categories";
import { HANDOVER_SECTIONS, composeHandover } from "@/lib/cases/handover";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, scholarAiRunner, scholarRequestId, scholarRisk } from "@/lib/individual/scholar/http";
import { caseCriteria, libraryReasonFeedback, libraryReasoningFeedback, recordedFeedbackText } from "@/lib/individual/scholar/clinical-library-feedback";
import { capForSafety, criteriaMarks, unsafeStatement } from "@/lib/individual/scholar/scoring-rules";
import { MARKING_LABEL } from "@/lib/individual/scholar/config";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runCaseReasoning } from "@/lib/individual/scholar/generation";
import { answerPlay, finishPlay, isPlayKind } from "@/lib/individual/scholar/clinical-routes";
import { handoverFeedbackNote } from "@/lib/individual/scholar/case-talk";
import type { ReasoningJudge } from "@/lib/individual/scholar/clinical-play";
import { answerSpelling, vocabularyOf } from "@/lib/individual/scholar/spelling";
import { parseSpellingVariant } from "@/lib/individual/scholar/spelling-variant";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/clinical/sessions/[kind]/[id]/answer { decisionToken, optionTokens?, text? }
// CR2-CR4. A choice is marked by its key and checked against the case's safety criteria, by code. A WRITTEN answer
// (screened for patient identifiers first) gets AI reasoning feedback through the Holdings allowance (activity
// evaluate, with its risk) where policy and the student's AI allow and the feedback passes its check -- labelled as AI
// evaluation -- or else the student reviews it against what a good answer contains (self-graded). Nothing is guessed.
// The decision is recorded as made (append-only), and the case moves on by its own progression. When the case is
// finished, its record is kept once (810, SCHOLAR-CASE-INTEGRITY-01), after everything about the last answer is recorded.

export async function POST(req: Request, ctx2: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { kind, id } = await ctx2.params;
  if (!isPlayKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.decisionToken !== "string" || body.decisionToken.length > 64) return NextResponse.json({ error: "Answer one of the decisions shown." }, { status: 400 });
  const optionTokens = Array.isArray(body?.optionTokens) ? (body.optionTokens as unknown[]).filter((t): t is string => typeof t === "string" && t.length <= 64).slice(0, 20) : undefined;
  // CE-04: an SBAR handover arrives as four boxes and is kept as ONE composed written answer (marked by code first).
  const hv = body?.handover && typeof body.handover === "object" ? (body.handover as Record<string, unknown>) : null;
  const text = hv
    ? composeHandover(Object.fromEntries(HANDOVER_SECTIONS.map(k => [k, typeof hv[k] === "string" ? (hv[k] as string) : ""])))
    : typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : null;
  if (hv && !HANDOVER_SECTIONS.some(k => typeof hv[k] === "string" && (hv[k] as string).trim())) return NextResponse.json({ error: "Write your handover in the four boxes." }, { status: 400 });
  if (text && findPatientIdentifiers(text).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  // "Explain your choice" (decision.askReason): kept beside the choice (screened for patient identifiers like any text) --
  // a LIBRARY play on its answer (423), a PRIVATE play in its own row beside the 435 answer (810: 435 holds a choice or a
  // written answer on a row, never both, and that CHECK is unchanged). Without 810 a private reason stays in the
  // learner's browser for the debrief, with no error. Marking is on the choice either way.
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, REASONING_CAPS.reason) : null;
  if (reason && findPatientIdentifiers(reason).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);
  // SCHOLAR-LEARN-GAPS-02 item 3: how the written answer was read (display only, spelling.ts, no AI). What is marked and recorded is
  // `text` exactly as typed; the risk classification reads the typed and the corrected reading (the more cautious).
  const understood = text ? answerSpelling(text, { variant: parseSpellingVariant(body?.spellingVariant), vocabulary: vocabularyOf([reason]) }) : {};

  // AI reasoning feedback on a written answer, for a private case: or the student's own review.
  const judge: ReasoningJudge = async d => {
    if (policy.scholarCaseReasoningFeedback !== "ai_then_self" || kind !== "private") return { kind: "self" };
    if (!activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate").available || (await aiPreflight(ctx))) return { kind: "self" };
    const s = await getPrivateCaseSession(ctx.admin, ctx.userId, id);
    const c = s ? await getPrivateCase(ctx.admin, ctx.userId, s.session.caseId) : null;
    const passages = c ? (await Promise.all(c.chunkIds.map(cid => getPassage(ctx.admin, ctx.userId, cid)))).filter((p): p is NonNullable<typeof p> => !!p) : [];
    if (!passages.length) return { kind: "self" };
    const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text: `${d.prompt}\n${d.answer}`, passages, competencyIds: c?.competencyIds }));
    // Owner item 5: where it was answered (the case and its decision), so a study answer is read as study; framing only.
    Object.assign(ai.risk, { intentContext: { surface: "apply" as const, lessonTitle: c?.title ?? null, objective: d.prompt.slice(0, 300), materialTopics: ai.risk.topicTerms ?? [] } });
    // SQIE-CLOSE-2026-11 WS-B: the decision's weighted criteria, where it has them, and the UNSAFE line (always) are scored by code.
    const criteria = caseCriteria(d.criteria ?? []);
    const e = await runCaseReasoning(ctx.userId, { prompt: d.prompt, expected: d.expected, facts: d.facts, answer: d.answer, passages, criteria }, ai.run);
    const refused = ai.refusal();
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_reasoning", id, {
      outcome: refused ? `refused:${refused.error}` : !e.ok ? `error:${e.error}` : e.evaluation.ok ? `shown:${e.evaluation.verdict}` : `withheld:${e.evaluation.reason}`,
      model: e.ok ? e.model : null, prompt_version: e.ok ? e.promptVersion : null,
      unsafe: e.ok && e.evaluation.ok ? e.evaluation.unsafe?.length ?? 0 : null, // SQIE-CLOSE-2026-11 WS-B: a count only
    });
    if (refused || !e.ok || !e.evaluation.ok) return { kind: "self" };
    const unsafe = unsafeStatement(e.evaluation.unsafe);
    // Against criteria the score is their weighted share. The rules-v3 caps apply AT THIS DECISION only where scholar_clinical_scoring_caps
    // is on (unsafe at most half, a missed safety-critical criterion nothing); the flag is in the recorded feedback either way.
    const caps = { capsActive: policy.scholarClinicalScoringCaps === "on" };
    const marks = criteria && e.evaluation.matched ? criteriaMarks(criteria, e.evaluation.matched, !!unsafe, caps) : null;
    const decided = marks ?? capForSafety({ correct: e.evaluation.verdict === "correct", score: e.evaluation.score }, unsafe ? "unsafe" : "safe", caps);
    const correct = decided.correct, score = decided.score;
    return { kind: "ai", correct, score, feedback: recordedFeedbackText(e.evaluation.feedback, criteria, marks, unsafe), evaluator: { model: e.model, promptVersion: e.promptVersion } };
  };

  const r = await answerPlay(ctx.admin, ctx.userId, kind, id, { decisionToken: body.decisionToken, optionTokens, text, reason }, judge, body?.hints === true);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: (r as { status?: number }).status ?? 400 });
  // CE-04: a handover is marked by code (above). Where policy and the student's AI allow, a labelled AI comment is kept beside it
  // (it never changes the marks), BEFORE the finished play keeps its record so the kept attempt carries it.
  const handoverNote = hv ? await handoverFeedbackNote(ctx, req, kind, id, body.decisionToken, text) : null;
  // A written decision in a LIBRARY case: live AI feedback on the student's own budget (case.live_with_stored), from the
  // narrow server-side context library.ts gives (never the blueprint), recorded by the shared delivery (424). Where it
  // is not given, the student reviews their answer themselves.
  if (kind === "library" && text && policy.scholarCaseReasoningFeedback === "ai_then_self"
    && activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate").available && !(await aiPreflight(ctx))) {
    const f = await libraryReasoningFeedback(ctx.admin, { userId: ctx.userId, sessionId: id, decisionToken: body.decisionToken, requestId: `${scholarRequestId(ctx, req)}:feedback`, capsActive: policy.scholarClinicalScoringCaps === "on" });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_reasoning", id, { kind, outcome: f.ok ? "recorded" : f.reason, model: f.ok ? f.model : null });
    if (f.ok) return NextResponse.json({ ...r, ...understood, handoverNote, play: await finishPlay(ctx.admin, ctx.userId, kind, id, r.play), feedback: { ...r.feedback, marking: "ai_evaluation", markingLabel: MARKING_LABEL.ai_evaluation, aiFeedback: f.text } });
  }
  // SQIE-CLOSE-2026-11 WS-C: a REASON given for a choice in a library case whose decision defines rubric criteria is scored against them
  // (formative, labelled, recorded by the shared delivery like any AI feedback). The choice's own marking is unchanged.
  if (kind === "library" && !text && reason && policy.scholarCaseReasoningFeedback === "ai_then_self"
    && activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate").available && !(await aiPreflight(ctx))) {
    const f = await libraryReasonFeedback(ctx.admin, { userId: ctx.userId, sessionId: id, decisionToken: body.decisionToken, requestId: `${scholarRequestId(ctx, req)}:reason`, capsActive: policy.scholarClinicalScoringCaps === "on" });
    if (f.ok || (f.reason !== "no_rubric" && f.reason !== "no_reason")) await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_reason", id, { kind, outcome: f.ok ? "recorded" : f.reason, model: f.ok ? f.model : null });
    if (f.ok) return NextResponse.json({ ...r, ...understood, handoverNote, play: await finishPlay(ctx.admin, ctx.userId, kind, id, r.play),
      feedback: { ...r.feedback, reasonFeedback: { text: f.text, label: MARKING_LABEL.ai_evaluation, marks: f.marks ? { awarded: f.marks.awarded, total: f.marks.total, outcome: f.marks.outcome } : null } } });
  }
  return NextResponse.json({ ...r, ...understood, handoverNote, play: await finishPlay(ctx.admin, ctx.userId, kind, id, r.play) });
}
