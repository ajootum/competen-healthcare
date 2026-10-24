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

export type PlayKind = "private" | "library";
export const isPlayKind = (v: unknown): v is PlayKind => v === "private" || v === "library";

/** The student's view of either kind of session, labelled for what it is. null: not theirs, or not available. */
export async function viewPlay(admin: any, userId: string, kind: PlayKind, id: string, hints: boolean) {
  if (kind === "private") { const v = await privatePlayView(admin, userId, id); return v ? { ...v, label: PRIVATE_CASE_LABEL } : null; }
  const v = await caseSessionView(admin, userId, id, { hints });
  // A library session's AI feedback is the shared delivery's record (424), labelled AI evaluation.
  return v ? {
    kind: "library" as const, sessionId: v.sessionId, status: v.status === "in_progress" ? "active" : v.status, current: v.current, view: v.view, answered: v.answered,
    feedback: (v.feedback ?? []).map(f => ({ token: f.decisionToken, marking: "ai_evaluation" as const, markingLabel: MARKING_LABEL.ai_evaluation, answered: null, aiFeedback: f.text })),
    debrief: null, label: LIBRARY_CASE_LABEL,
  } : null;
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
export async function answerPlay(admin: any, userId: string, kind: PlayKind, id: string, args: { decisionToken: string; optionTokens?: string[]; text?: string | null }, judge: ReasoningJudge, hints: boolean) {
  if (kind === "private") return answerPrivate(admin, userId, id, args, judge);
  const r = await answerInSession(admin, userId, id, args);
  if ("error" in r) return { error: r.error, status: 400 };
  return { feedback: { token: args.decisionToken, answered: r.answered, marking: "deterministic" as const }, play: (await viewPlay(admin, userId, "library", id, hints))! };
}
