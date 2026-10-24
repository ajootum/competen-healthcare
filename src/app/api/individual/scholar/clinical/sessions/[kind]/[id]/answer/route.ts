// Allow up to 60s: a written answer may get AI reasoning feedback.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getPassage, getPrivateCase, getPrivateCaseSession } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runCaseReasoning } from "@/lib/individual/scholar/generation";
import { answerPlay, isPlayKind } from "@/lib/individual/scholar/clinical-routes";
import type { ReasoningJudge } from "@/lib/individual/scholar/clinical-play";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/clinical/sessions/[kind]/[id]/answer { decisionToken, optionTokens?, text? }
// CR2-CR4. A choice is marked by its key and checked against the case's safety criteria, by code. A WRITTEN answer
// (screened for patient identifiers first) gets AI reasoning feedback through the Holdings allowance (activity
// evaluate, with its risk) where policy and the student's AI allow and the feedback passes its check -- labelled as AI
// evaluation -- or else the student reviews it against what a good answer contains (self-graded). Nothing is guessed.
// The decision is recorded as made (append-only), and the case moves on by its own progression.

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

  const r = await answerPlay(ctx.admin, ctx.userId, kind, id, { decisionToken: body.decisionToken, optionTokens, text }, judge, body?.hints === true);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: (r as { status?: number }).status ?? 400 });
  return NextResponse.json(r);
}
