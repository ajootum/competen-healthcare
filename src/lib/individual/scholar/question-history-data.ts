// ── SQIE-CLOSE-2026-11 WS-I: THE READ ── one question's history, and the list of recently answered questions ─────────────────
//
// Server only. Reuses the existing readers (store.ts getQuestion, attemptIntegrity, and the WS-I row readers beside them); the pure
// assembly is question-history.ts. Only store.ts queries individual_scholar_* (harness rule A1). No AI, no allowance read, no write.

import { buildQuestionHistory, HISTORY_SOURCE_LABEL, sourceOf, type HistorySource, type QuestionHistory } from "./question-history";
import {
  attemptIntegrity, getQuestion, historyCheckEvents, historyExamAnswers, historySessions, questionAttemptRows, questionHeads, recentlyAnsweredQuestions,
  type Admin, type Read,
} from "./store";

/** One question's history (null: not the caller's question). */
export async function loadQuestionHistory(admin: Admin, userId: string, questionId: string): Promise<Read<QuestionHistory | null>> {
  const q = await getQuestion(admin, userId, questionId);
  if (!q) return { ok: true, data: null };
  const rows = await questionAttemptRows(admin, userId, q.id);
  if (!rows.ok) return rows;
  const ids = rows.data.map(a => a.id);
  const [sessions, checks, integrity, examAnswers] = await Promise.all([
    historySessions(admin, userId, rows.data.map(a => a.revisionSessionId).filter((x): x is string => !!x)),
    historyCheckEvents(admin, userId, ids),
    attemptIntegrity(admin, userId, ids),
    historyExamAnswers(admin, userId, q.id),
  ]);
  return { ok: true, data: buildQuestionHistory(q, { attempts: rows.data, sessions, checks, integrity, examAnswers }) };
}

export type HistoryIndexItem = { questionId: string; stem: string; kind: string; lastAt: string; count: number };

/** The questions the caller answered most recently (at most 30), for the history page's list. */
export async function loadHistoryIndex(admin: Admin, userId: string): Promise<Read<HistoryIndexItem[]>> {
  const recent = await recentlyAnsweredQuestions(admin, userId, 30);
  if (!recent.ok) return recent;
  const heads = await questionHeads(admin, userId, recent.data.map(r => r.questionId));
  if (!heads.ok) return heads;
  const byId = new Map(heads.data.map(h => [h.id, h]));
  return { ok: true, data: recent.data.flatMap(r => { const h = byId.get(r.questionId); return h ? [{ questionId: r.questionId, stem: h.stem, kind: h.kind, lastAt: r.lastAt, count: r.count }] : []; }) };
}

export { HISTORY_SOURCE_LABEL, sourceOf, type HistorySource };
