// Allow up to 60s: a written answer may get AI reasoning feedback.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getPassage, getPrivateCase, getPrivateCaseSession } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { REASONING_CAPS } from "@/lib/cases/categories";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, scholarAiRunner, scholarRequestId, scholarRisk } from "@/lib/individual/scholar/http";
import { libraryReasoningFeedback } from "@/lib/individual/scholar/clinical-library-feedback";
import { MARKING_LABEL } from "@/lib/individual/scholar/config";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runCaseReasoning } from "@/lib/individual/scholar/generation";
import { answerPlay, finishPlay, isPlayKind } from "@/lib/individual/scholar/clinical-routes";
import type { ReasoningJudge } from "@/lib/individual/scholar/clinical-play";

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
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : null;
  if (text && findPatientIdentifiers(text).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  // "Explain your choice" (decision.askReason): kept beside the choice (screened for patient identifiers like any text) --
  // a LIBRARY play on its answer (423), a PRIVATE play in its own row beside the 435 answer (810: 435 holds a choice or a
  // written answer on a row, never both, and that CHECK is unchanged). Without 810 a private reason stays in the
  // learner's browser for the debrief, with no error. Marking is on the choice either way.
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, REASONING_CAPS.reason) : null;
  if (reason && findPatientIdentifiers(reason).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);

  // AI reasoning feedback on a written answer, for a private case: or the student's own review.
  const judge: ReasoningJudge = async d => {
    if (policy.scholarCaseReasoningFeedback !== "ai_then_self" || kind !== "private") return { kind: "self" };
    if (!activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate").available || (await aiPreflight(ctx))) return { kind: "self" };
    const s = await getPrivateCaseSession(ctx.admin, ctx.userId, id);
    const c = s ? await getPrivateCase(ctx.admin, ctx.userId, s.session.caseId) : null;
    const passages = c ? (await Promise.all(c.chunkIds.map(cid => getPassage(ctx.admin, ctx.userId, cid)))).filter((p): p is NonNullable<typeof p> => !!p) : [];
    if (!passages.length) return { kind: "self" };
    const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, { text: `${d.prompt}\n${d.answer}`, passages, competencyIds: c?.competencyIds }));
    const e = await runCaseReasoning(ctx.userId, { ...d, passages }, ai.run);
    const refused = ai.refusal();
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_reasoning", id, {
      outcome: refused ? `refused:${refused.error}` : !e.ok ? `error:${e.error}` : e.evaluation.ok ? `shown:${e.evaluation.verdict}` : `withheld:${e.evaluation.reason}`,
      model: e.ok ? e.model : null, prompt_version: e.ok ? e.promptVersion : null,
    });
    if (refused || !e.ok || !e.evaluation.ok) return { kind: "self" };
    return { kind: "ai", correct: e.evaluation.verdict === "correct", score: e.evaluation.score, feedback: e.evaluation.feedback, evaluator: { model: e.model, promptVersion: e.promptVersion } };
  };

  const r = await answerPlay(ctx.admin, ctx.userId, kind, id, { decisionToken: body.decisionToken, optionTokens, text, reason }, judge, body?.hints === true);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: (r as { status?: number }).status ?? 400 });
  // A written decision in a LIBRARY case: live AI feedback on the student's own budget (case.live_with_stored), from the
  // narrow server-side context library.ts gives (never the blueprint), recorded by the shared delivery (424). Where it
  // is not given, the student reviews their answer themselves.
  if (kind === "library" && text && policy.scholarCaseReasoningFeedback === "ai_then_self"
    && activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate").available && !(await aiPreflight(ctx))) {
    const f = await libraryReasoningFeedback(ctx.admin, { userId: ctx.userId, sessionId: id, decisionToken: body.decisionToken, requestId: `${scholarRequestId(ctx, req)}:feedback` });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_reasoning", id, { kind, outcome: f.ok ? "recorded" : f.reason, model: f.ok ? f.model : null });
    if (f.ok) return NextResponse.json({ ...r, play: await finishPlay(ctx.admin, ctx.userId, kind, id, r.play), feedback: { ...r.feedback, marking: "ai_evaluation", markingLabel: MARKING_LABEL.ai_evaluation, aiFeedback: f.text } });
  }
  return NextResponse.json({ ...r, play: await finishPlay(ctx.admin, ctx.userId, kind, id, r.play) });
}
