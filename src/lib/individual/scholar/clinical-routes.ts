/* eslint-disable @typescript-eslint/no-explicit-any */
// ── STAGE 5A: THE TWO KINDS OF PLAY, BEHIND ONE SET OF ROUTES ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 ───────────────
//
// SERVER-ONLY. A route names the kind of session it acts on: "private" (the student's own case, 435/436, played by
// clinical-play.ts) or "library" (a governed case, played ONLY by src/lib/cases/library.ts on case_library_session --
// coordinator decision 2026-10-25: Scholar never writes a library session of its own). Both return the same shape for
// the browser: learnerView and, after an answer, answeredView with how it was marked.

import { answerInSession, caseSessionView, revealInSession } from "@/lib/cases/library";
import { withdrawCaseCandidate } from "@/lib/cases/candidates";
import { caseSourceKey } from "./clinical";
import { caseSourcesOf } from "./store";
import { answerPrivate, privatePlayView, revealPrivate, type ReasoningJudge } from "./clinical-play";
import { LIBRARY_CASE_LABEL, MARKING_LABEL, PRIVATE_CASE_LABEL } from "./config";
import { readCaseAttempt } from "./case-integrity";

export type PlayKind = "private" | "library";
export const isPlayKind = (v: unknown): v is PlayKind => v === "private" || v === "library";

/** The student's view of either kind of session, labelled for what it is. null: not theirs, or not available. */
export async function viewPlay(admin: any, userId: string, kind: PlayKind, id: string, hints: boolean) {
  if (kind === "private") { const v = await privatePlayView(admin, userId, id); return v ? { ...v, label: PRIVATE_CASE_LABEL } : null; }
  const v = await caseSessionView(admin, userId, id, { hints });
  if (!v) return null;
  // A library session's AI feedback is the shared delivery's record (424), labelled AI evaluation. Every answered
  // decision comes back with its answered view (the key, after answering), so a play resumed on another device shows
  // what this one showed.
  const ai = new Map((v.feedback ?? []).map(f => [f.decisionToken, f.text]));
  const answeredViews = v.answeredViews ?? {};
  return {
    kind: "library" as const, sessionId: v.sessionId, status: v.status === "in_progress" ? "active" : v.status, current: v.current, view: v.view, answered: v.answered,
    feedback: v.answered.map(t => ai.has(t)
      ? { token: t, marking: "ai_evaluation" as const, markingLabel: MARKING_LABEL.ai_evaluation, answered: answeredViews[t] ?? null, aiFeedback: ai.get(t)! }
      : { token: t, marking: "deterministic" as const, markingLabel: MARKING_LABEL.deterministic, answered: answeredViews[t] ?? null, aiFeedback: null }),
    debrief: null, label: LIBRARY_CASE_LABEL, reasons: v.reasons, closing: v.closing,
    // SCHOLAR-CASE-INTEGRITY-01: the kept record of a finished attempt (810), or null.
    attempt: v.status === "completed" ? (await readCaseAttempt(admin, userId, "library", id))?.view ?? null : null,
  };
}

/**
 * SCHOLAR-CASE-INTEGRITY-01: once a case is finished, its record is kept (810), exactly once, AFTER everything about the
 * last answer is recorded (a library written answer's AI feedback included), and the finished play carries it.
 * In progress, or 810 absent: the play unchanged.
 */
export async function finishPlay<T extends { status?: string; attempt?: unknown }>(admin: any, userId: string, kind: PlayKind, id: string, play: T): Promise<T> {
  if (play?.status !== "completed") return play;
  const a = await readCaseAttempt(admin, userId, kind, id);
  return a ? { ...play, attempt: a.view } : play;
}

/** Ask for a finding the current decision permits. */
export async function revealPlay(admin: any, userId: string, kind: PlayKind, id: string, factToken: string, hints: boolean) {
  if (kind === "private") return revealPrivate(admin, userId, id, factToken);
  const r = await revealInSession(admin, userId, id, factToken);
  if ("error" in r) return { error: r.error, status: 400 };
  return (await viewPlay(admin, userId, "library", id, hints))!;
}

/**
 * C-e: before a material (or everything) is deleted, every case written from it is withdrawn from the shared library,
 * and the database purges what was not yet taken in. Called before the deletion, because the keys come from the rows.
 * It never blocks the deletion: a student's erasure is theirs. Returns how many were withdrawn, and any that failed.
 */
export async function withdrawCasesOf(admin: any, userId: string, materialId: string | null): Promise<{ withdrawn: number; failed: number }> {
  const src = await caseSourcesOf(admin, userId, materialId);
  let withdrawn = 0, failed = 0;
  for (const [kind, ids] of [["case", src.cases], ["s4", src.s4]] as const) for (const id of ids) {
    const r = await withdrawCaseCandidate(admin, { userId, sourceKey: caseSourceKey(kind, id), reason: "source_deleted" });
    if (r.ok) withdrawn += r.withdrawn; else failed++;
  }
  return { withdrawn, failed };
}

/** Answer a decision, on that kind's engine. A library case's written answer gets its deterministic view only, for now. */
export async function answerPlay(admin: any, userId: string, kind: PlayKind, id: string, args: { decisionToken: string; optionTokens?: string[]; text?: string | null; reason?: string | null }, judge: ReasoningJudge, hints: boolean) {
  if (kind === "private") return answerPrivate(admin, userId, id, args, judge);
  const r = await answerInSession(admin, userId, id, args);
  if ("error" in r) return { error: r.error, status: 400 };
  return { feedback: { token: args.decisionToken, answered: r.answered, marking: "deterministic" as const }, play: (await viewPlay(admin, userId, "library", id, hints))! };
}
