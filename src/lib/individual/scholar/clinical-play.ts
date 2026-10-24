/* eslint-disable @typescript-eslint/no-explicit-any */
// ── STAGE 5A: PLAYING A PRIVATE CASE ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR2, CR3, CR5 ──────────────────────────
//
// SERVER-ONLY. A student's private case (435, 436) played on THE SAME ENGINE as a library case: blueprint.ts
// (learnerView, answeredView, resolveToken, resolveOptions) and library.ts applyAnswer. The only difference is where
// the session is kept -- here for a private case, case_library_session (library.ts) for a library one.
//
// ⚠ THE BROWSER SEES learnerView AND answeredView ONLY. Tokens, never ids; the salt never leaves the server.
// ⚠ A DECISION IS KEPT AS MADE. Each answer is an append-only row (435). Progress is what applyAnswer says.

import { randomBytes } from "node:crypto";
import { answeredView, learnerView, resolveOptions, resolveToken, viewToken, type Blueprint, type LearnerView } from "@/lib/cases/blueprint";
import { applyAnswer } from "@/lib/cases/library";
import { brokenSafety, caseDebrief, markDecision, type Debrief } from "./clinical";
import {
  createPrivateCaseSession, getPrivateCase, getPrivateCaseSession, insertCaseAnswer, updatePrivateCaseSession,
  type CaseAnswerRow, type CaseSessionRow, type PrivateCaseRow,
} from "./store";
import { MARKING_LABEL } from "./config";

export const newViewSalt = () => randomBytes(24).toString("base64url");

export type DecisionFeedback = {
  token: string; correct: boolean | null; marking: keyof typeof MARKING_LABEL; markingLabel: string;
  answered: ReturnType<typeof answeredView>;
  /** A written decision: what a good answer contains, shown only after answering. */
  expected: string | null;
  /** AI reasoning feedback, labelled; null when none was given. */
  aiFeedback: string | null;
  safety: string[];
  /** The student's own sections to go back to (private cases only). */
  chunkIds: string[];
};
export type PlayView = {
  kind: "private"; sessionId: string; caseId: string; title: string; status: "active" | "completed"; mode: "guided" | "independent";
  view: LearnerView; answered: string[]; feedback: DecisionFeedback[]; debrief: Debrief | null; materialId: string;
};

const asState = (s: CaseSessionRow, answers: CaseAnswerRow[]) => ({
  reached_stage_ids: s.reachedStageIds, revealed_fact_ids: s.revealedFactIds,
  answers: answers.map(a => ({ decisionPointId: a.decisionPointId, chosen: a.chosen, ...(a.reasoning ? { text: a.reasoning } : {}), at: a.createdAt, safety: a.safety.length })),
});

function feedbackOf(b: Blueprint, s: CaseSessionRow, a: CaseAnswerRow): DecisionFeedback {
  const d = b.decisionPoints.find(x => x.id === a.decisionPointId);
  return {
    token: viewToken(s.viewSalt, "decision", a.decisionPointId), correct: a.correct, marking: a.marking as keyof typeof MARKING_LABEL,
    markingLabel: MARKING_LABEL[a.marking as keyof typeof MARKING_LABEL] ?? a.marking, answered: answeredView(b, a.decisionPointId, a.chosen, s.viewSalt),
    expected: d?.kind === "free_text" ? d.expectedResponse ?? null : null, aiFeedback: a.aiFeedback,
    safety: a.safety.map(id => b.safetyCriteria.find(c => c.id === id)?.text).filter((x): x is string => !!x),
    chunkIds: d?.sourceRefs ?? [],
  };
}

function playView(c: PrivateCaseRow, s: CaseSessionRow, answers: CaseAnswerRow[]): PlayView {
  const b = c.blueprint as Blueprint;
  return {
    kind: "private", sessionId: s.id, caseId: c.id, title: b.title, status: s.status, mode: s.mode, materialId: c.materialId,
    view: learnerView(b, { reachedStageIds: s.reachedStageIds, revealedFactIds: s.revealedFactIds }, s.viewSalt, { hints: s.mode === "guided" }),
    answered: answers.map(a => viewToken(s.viewSalt, "decision", a.decisionPointId)),
    feedback: answers.map(a => feedbackOf(b, s, a)), debrief: s.debrief ?? null,
  };
}

async function load(admin: any, userId: string, sessionId: string) {
  const x = await getPrivateCaseSession(admin, userId, sessionId);
  if (!x) return null;
  const c = await getPrivateCase(admin, userId, x.session.caseId);
  return c ? { ...x, c, b: c.blueprint as Blueprint } : null;
}

/** Start playing one of the student's own private cases. No AI. */
export async function startPrivatePlay(admin: any, userId: string, caseId: string, mode: "guided" | "independent"): Promise<PlayView | { error: string; status: number }> {
  const c = await getPrivateCase(admin, userId, caseId);
  if (!c) return { error: "That case could not be found.", status: 404 };
  const first = (c.blueprint as Blueprint).stages?.[0]?.id;
  if (!first) return { error: "This case has no stages.", status: 422 };
  const made = await createPrivateCaseSession(admin, userId, { caseId, mode, viewSalt: newViewSalt(), firstStageId: first });
  if (!made.ok) return { error: made.notProvisioned ? "Clinical reasoning is not available on this environment yet." : "The case could not be started just now.", status: made.notProvisioned ? 409 : 500 };
  const x = await load(admin, userId, made.id);
  return x ? playView(x.c, x.session, x.answers) : { error: "The case could not be started just now.", status: 500 };
}

/** The student's own view of a private session, where they left it. */
export async function privatePlayView(admin: any, userId: string, sessionId: string): Promise<PlayView | null> {
  const x = await load(admin, userId, sessionId);
  if (!x) return null;
  await updatePrivateCaseSession(admin, userId, sessionId, {});
  return playView(x.c, x.session, x.answers);
}

/** Ask for a finding. Only one a decision on the CURRENT stage permits -- library.ts revealInSession's rule. */
export async function revealPrivate(admin: any, userId: string, sessionId: string, factToken: string): Promise<PlayView | { error: string; status: number }> {
  const x = await load(admin, userId, sessionId);
  if (!x) return { error: "No such session.", status: 404 };
  if (x.session.status !== "active") return { error: "This case is finished.", status: 409 };
  const factId = resolveToken(x.b, x.session.viewSalt, "fact", factToken);
  const stage = x.session.reachedStageIds[x.session.reachedStageIds.length - 1];
  const permitted = x.b.decisionPoints.filter(d => d.stageId === stage && !x.answers.some(a => a.decisionPointId === d.id)).flatMap(d => d.permittedReveals);
  if (!factId || !permitted.includes(factId)) return { error: "That cannot be asked for here.", status: 400 };
  if (!x.session.revealedFactIds.includes(factId)) {
    const revealed = [...x.session.revealedFactIds, factId];
    if (!(await updatePrivateCaseSession(admin, userId, sessionId, { revealed }))) return { error: "That could not be recorded just now.", status: 500 };
    x.session.revealedFactIds = revealed;
  }
  return playView(x.c, x.session, x.answers);
}

export type ReasoningJudge = (d: { prompt: string; expected: string; facts: string[]; answer: string }) =>
  Promise<{ kind: "ai"; correct: boolean; score: number; feedback: string; evaluator: { model: string; promptVersion: string } } | { kind: "self" }>;

/**
 * Answer a decision. Choices are marked by their key and checked against the safety criteria (code). A written decision
 * is judged by `judge` -- AI reasoning feedback (labelled), or, where that is unavailable, the student reviews it
 * against the expected answer themselves (self-graded, nothing guessed). Then applyAnswer moves the case on.
 */
export async function answerPrivate(admin: any, userId: string, sessionId: string, args: { decisionToken: string; optionTokens?: string[]; text?: string | null }, judge: ReasoningJudge)
  : Promise<{ feedback: DecisionFeedback; play: PlayView } | { error: string; status: number }> {
  const x = await load(admin, userId, sessionId);
  if (!x) return { error: "No such session.", status: 404 };
  if (x.session.status !== "active") return { error: "This case is finished.", status: 409 };
  const dpId = resolveToken(x.b, x.session.viewSalt, "decision", args.decisionToken);
  if (!dpId) return { error: "No such decision.", status: 400 };
  const d = x.b.decisionPoints.find(p => p.id === dpId)!;
  const chosen = d.kind === "free_text" ? [] : resolveOptions(x.b, x.session.viewSalt, dpId, args.optionTokens ?? []);
  if (chosen === null) return { error: "Choose from this decision's options.", status: 400 };
  const text = d.kind === "free_text" ? (args.text ?? "").trim().slice(0, 4000) : null;
  const r = applyAnswer(x.b, asState(x.session, x.answers), dpId, chosen, text, new Date().toISOString());
  if ("error" in r) return { error: r.error, status: 400 };

  let mark: { correct: boolean | null; score: number | null } = markDecision(x.b, dpId, chosen);
  let marking: "deterministic" | "self_graded" | "ai_evaluation" = "deterministic", aiFeedback: string | null = null, evaluator: { model: string; promptVersion: string } | null = null;
  if (d.kind === "free_text") {
    const visible = x.b.facts.filter(f => f.revealedAt === "start" || x.session.reachedStageIds.includes(f.revealedAt) || x.session.revealedFactIds.includes(f.id));
    const j = await judge({ prompt: d.prompt, expected: d.expectedResponse ?? "", facts: visible.map(f => `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`), answer: text! });
    if (j.kind === "ai") { mark = { correct: j.correct, score: j.score }; marking = "ai_evaluation"; aiFeedback = j.feedback; evaluator = j.evaluator; }
    else { mark = { correct: null, score: null }; marking = "self_graded"; }
  }
  const safety = d.kind === "free_text" ? [] : brokenSafety(x.b, dpId, chosen);
  const saved = await insertCaseAnswer(admin, userId, sessionId, {
    decisionPointId: dpId, chosen: d.kind === "free_text" ? null : chosen, reasoning: text, marking, correct: mark.correct, score: mark.score, safety, aiFeedback, evaluator,
  });
  if (!saved) return { error: "Your answer could not be recorded just now.", status: 500 };
  const answers: CaseAnswerRow[] = [...x.answers, { decisionPointId: dpId, chosen, reasoning: text, marking, correct: mark.correct, score: mark.score, safety, aiFeedback, evaluatorModel: evaluator?.model ?? null, createdAt: new Date().toISOString() }];
  const current = r.completed ? x.session.reachedStageIds[x.session.reachedStageIds.length - 1] : r.reached[r.reached.length - 1];
  const debrief = r.completed ? caseDebrief(x.b, answers.map(a => ({ decisionPointId: a.decisionPointId, chosen: a.chosen, text: a.reasoning, correct: a.correct, safety: a.safety, marking: a.marking })), r.revealed, r.reached) : undefined;
  await updatePrivateCaseSession(admin, userId, sessionId, { reached: r.reached, revealed: r.revealed, current, completed: r.completed, ...(debrief ? { debrief } : {}) });
  const session: CaseSessionRow = { ...x.session, reachedStageIds: r.reached, revealedFactIds: r.revealed, currentStageId: current, status: r.completed ? "completed" : "active", debrief: debrief ?? x.session.debrief };
  return { feedback: feedbackOf(x.b, session, answers[answers.length - 1]), play: playView(x.c, session, answers) };
}
