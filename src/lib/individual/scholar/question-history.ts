// ── SQIE-CLOSE-2026-11 WS-I: ONE QUESTION, EVERY ATTEMPT, AND WHAT EACH WAS MARKED AGAINST ────────────────────────────────
//
// Pure (it hashes through attempt-snapshot.ts / rubric-snapshot.ts, so server side). The learner's own history of one question
// across the places Scholar asks it: practice and Revise sessions, adaptive and mock exams (417/720 revision sessions), Check your
// understanding (950 kept checks), and the exam-paper answers the question was made from (570). Assembled from the existing rows
// (store.ts questionAttemptRows, historySessions, historyCheckEvents, historyExamAnswers, attemptIntegrity). NO NEW STORE.
//
// OLD ATTEMPTS STAY INTERPRETABLE. Each attempt says what it was marked against, from what it kept: the 791 snapshot (question
// version, content hash, rubric hash, the 990 framework version of each competency practised), else the 416 rubric snapshot on the
// response (its guide hash), else only that nothing was kept -- never a version or a guide it did not keep. Where the live question
// or guide has changed since, the entry says so. A correction (791) shows the effective result with the original beside it.
//
// ⚠ FORMATIVE. A history is a record of private practice: never an assessment, a stage, verified competence or a Passport record.
// An unmarked check is shown as kept without a mark, never as wrong.

import { effectiveResult, outcomeOf, questionChanged, type AttemptIntegrity, type Outcome } from "./attempt-snapshot";
import { MARKING_LABEL } from "./config";
import { CHECK_MARKING_LABEL, parseCheckResponse } from "./learn-check-record";
import { rubricChanged, snapshotOf } from "./rubric-snapshot";
import type { HistoryAttemptRow, HistoryCheckEvent, HistoryExamAnswer, HistorySessionRow, QuestionRow } from "./store";

export type HistorySource = "practice" | "revise" | "adaptive" | "mock" | "check";
export const HISTORY_SOURCE_LABEL: Record<HistorySource, string> = {
  practice: "Practice", revise: "Revise session", adaptive: "Adaptive exam", mock: "Mock exam", check: "Check your understanding",
};
export const HISTORY_NOTE = "Your own practice record. Each answer is shown with what it was marked against when you gave it. It is not an assessment and not verified competence.";
export const NO_SNAPSHOT_NOTE = "No record of the question as it was shown was kept with this answer (it was given before records were kept, or one could not be kept). It is read against the question as it is now.";
export const CHANGED_NOTE = "This question has changed since this answer. The answer is shown as it was marked then.";
export const GUIDE_CHANGED_NOTE = "The marking guide has changed since this answer.";
export const EXAM_ANSWER_LABEL = "Exam paper: an AI-suggested answer you saved, with your own attempt where you made one. Not a mark.";

export type MarkedAgainst = {
  /** own:<content version> or lib:<library version id>, from the 791 snapshot; else own:<950 content_version>; else null. */
  questionVersion: string | null;
  /** First 8 hex of the 791 content hash and of the guide hash (791, else the 416 rubric snapshot). Null where not kept. */
  contentHash: string | null; guideHash: string | null;
  /** Each competency practised, as its framework stood (990): "NMC-FN 2.1.0". Empty where not recorded. */
  frameworks: string[];
  snapshotKept: boolean; questionChangedSince: boolean; guideChangedSince: boolean;
  notes: string[];
};

export type HistoryAttemptEntry = {
  kind: "attempt"; attemptId: string; answeredAt: string; source: HistorySource; sourceLabel: string;
  marking: string; markingLabel: string;
  /** The effective result (the latest correction, else the original), or "unmarked". */
  outcome: Outcome | "unmarked"; score: number | null;
  /** Set when a correction changed the result: the original it replaced. */
  original: { outcome: Outcome; score: number | null } | null;
  answer: string | null; evaluator: { model: string; promptVersion: string } | null;
  sessionId: string | null; step: number | null; markedAgainst: MarkedAgainst;
};
export type HistoryExamEntry = { kind: "exam_answer"; id: string; answeredAt: string; source: "exam_paper"; sourceLabel: string; examQuestion: string | null; attempt: string | null; model: string; promptVersion: string; materialId: string };
export type HistoryEntry = HistoryAttemptEntry | HistoryExamEntry;
export type QuestionHistory = { questionId: string; stem: string; entries: HistoryEntry[]; bySource: Partial<Record<HistorySource | "exam_paper", number>> };

const cut = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);
const short = (h: string | null | undefined) => (h ? h.slice(0, 8) : null);

/** Pure. Where an attempt was made: a kept check, else its revision session's kind, else practice. */
export function sourceOf(a: Pick<HistoryAttemptRow, "id" | "response" | "revisionSessionId">, sessions: ReadonlyMap<string, HistorySessionRow>, checks: ReadonlyMap<string, HistoryCheckEvent>): HistorySource {
  if (checks.has(a.id) || a.response?.kind === "check") return "check";
  const s = a.revisionSessionId ? sessions.get(a.revisionSessionId) : undefined;
  if (s?.adaptive) return "adaptive";
  if (s?.mode === "mock") return "mock";
  return a.revisionSessionId ? "revise" : "practice";
}

/** Pure. The learner's answer in words: a choice as its option, a typed answer, a check's text. Bounded. */
export function answerOf(a: Pick<HistoryAttemptRow, "chosenIndex" | "response">, options: readonly string[], presentedOptions?: readonly { i: number; text: string }[]): string | null {
  if (a.chosenIndex !== null) return cut(presentedOptions?.find(o => o.i === a.chosenIndex)?.text ?? options[a.chosenIndex] ?? `Option ${a.chosenIndex + 1}`, 300);
  const r = a.response ?? {};
  const check = parseCheckResponse(r);
  if (check) return cut(check.text, 600);
  if (typeof r.text === "string") return cut(r.text, 600);
  if (Array.isArray(r.texts)) return cut((r.texts as unknown[]).filter(x => typeof x === "string").join(" / "), 600);
  if (Array.isArray(r.stages)) return cut((r.stages as { a?: unknown }[]).map(x => (typeof x?.a === "string" ? x.a : "")).filter(Boolean).join(" / "), 600);
  return null;
}

/** Pure. What one attempt was marked against, from what it kept, against the live question. */
export function markedAgainstOf(q: Pick<QuestionRow, "kind" | "stem" | "options" | "correctIndex" | "answer" | "rationale">, a: Pick<HistoryAttemptRow, "contentVersion" | "response">, integrity: AttemptIntegrity | null): MarkedAgainst {
  const s = integrity?.snapshot ?? null;
  const rubric = snapshotOf(a.response);
  const guide = s?.rubricHash ?? rubric?.hash ?? null;
  const questionChangedSince = questionChanged(q, s);
  const guideChangedSince = s?.rubricHash ? !!q.answer && rubricChanged(q, { v: 1, hash: s.rubricHash }) : rubricChanged(q, rubric);
  const frameworks = (s?.competencyProvenance ?? []).map(p => [p.frameworkCode ?? "Framework", p.frameworkVersion ? `version ${p.frameworkVersion}` : "version not recorded"].join(" "));
  const notes = [
    ...(s ? [] : [NO_SNAPSHOT_NOTE]),
    ...(questionChangedSince ? [CHANGED_NOTE] : []),
    ...(guideChangedSince && !questionChangedSince ? [GUIDE_CHANGED_NOTE] : []),
  ];
  return {
    questionVersion: s?.questionVersion ?? (a.contentVersion ? `own:${a.contentVersion}` : null),
    contentHash: short(s?.contentHash), guideHash: short(guide), frameworks, snapshotKept: !!s, questionChangedSince, guideChangedSince, notes,
  };
}

/** Pure. A question version in words: "your version 2", "Competen library version", or null. */
export function versionLabel(v: string | null): string | null {
  if (!v) return null;
  if (v.startsWith("own:")) return `your question, version ${v.slice(4)}`;
  if (v.startsWith("lib:")) return "the Competen library version you were given";
  return null;
}

const markingLabelOf = (marking: string, source: HistorySource): string =>
  source === "check" && marking in CHECK_MARKING_LABEL ? CHECK_MARKING_LABEL[marking as keyof typeof CHECK_MARKING_LABEL]
    : marking in MARKING_LABEL ? MARKING_LABEL[marking as keyof typeof MARKING_LABEL] : marking === "unmarked" ? CHECK_MARKING_LABEL.unmarked : "Marked";

/**
 * Pure. One question's history, newest first. `integrity` is attemptIntegrity's map (snapshots and corrections, 791/990); each
 * attempt is read against its own snapshot where it kept one (applyAssessedSnapshot is the feedback surface's job, not this one's).
 */
export function buildQuestionHistory(q: Pick<QuestionRow, "id" | "kind" | "stem" | "options" | "correctIndex" | "answer" | "rationale">, input: {
  attempts: readonly HistoryAttemptRow[]; sessions: ReadonlyMap<string, HistorySessionRow>; checks: ReadonlyMap<string, HistoryCheckEvent>;
  integrity: ReadonlyMap<string, AttemptIntegrity>; examAnswers?: readonly HistoryExamAnswer[];
}): QuestionHistory {
  const entries: HistoryEntry[] = input.attempts.filter(a => a.questionId === q.id).map(a => {
    const integ = input.integrity.get(a.id) ?? null;
    const source = sourceOf(a, input.sessions, input.checks);
    const unmarked = a.marking === "unmarked";
    const original = { outcome: outcomeOf(a.correct, a.score), score: a.score };
    const eff = unmarked ? null : effectiveResult(original, integ?.corrections ?? []);
    const ev = input.checks.get(a.id) ?? null;
    return {
      kind: "attempt" as const, attemptId: a.id, answeredAt: a.answeredAt, source, sourceLabel: HISTORY_SOURCE_LABEL[source],
      marking: a.marking, markingLabel: markingLabelOf(a.marking, source),
      outcome: unmarked ? "unmarked" as const : eff!.outcome, score: unmarked ? null : eff!.score,
      original: eff?.corrected ? original : null,
      answer: answerOf(a, q.options ?? [], integ?.snapshot?.presented.options),
      evaluator: a.evaluatorModel && a.evaluatorPromptVersion ? { model: a.evaluatorModel, promptVersion: a.evaluatorPromptVersion } : null,
      sessionId: ev?.sessionId ?? a.revisionSessionId, step: ev?.step ?? null,
      markedAgainst: markedAgainstOf(q, a, integ),
    };
  });
  for (const x of input.examAnswers ?? []) {
    const att = x.attempt ?? {};
    const text = [typeof att.option === "string" ? `Option ${att.option}` : null, typeof att.text === "string" ? att.text : null].filter(Boolean).join(": ");
    entries.push({ kind: "exam_answer", id: x.id, answeredAt: x.createdAt, source: "exam_paper", sourceLabel: "Exam paper", examQuestion: cut(x.examStem, 400), attempt: cut(text, 600), model: x.model, promptVersion: x.promptVersion, materialId: x.materialId });
  }
  entries.sort((x, y) => (x.answeredAt < y.answeredAt ? 1 : x.answeredAt > y.answeredAt ? -1 : 0));
  const bySource: QuestionHistory["bySource"] = {};
  for (const e of entries) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  return { questionId: q.id, stem: q.stem, entries, bySource };
}

export const OUTCOME_WORD: Record<Outcome | "unmarked", string> = { correct: "Correct", partial: "Partly right", incorrect: "Not right", unmarked: "Kept without a mark" };
