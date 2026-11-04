// ── SALE-2026-11 R1 / SALE-04: THE LEARNER'S LEARNING STATE, PER TOPIC ── pure, client-safe, NO AI ───────────────────────────
//
// A LOGICAL view over records that already exist -- learning events (414, 920 read), attempts (416: lesson checks 950, practice
// questions, spaced reviews 372, OSCE runs 720) and what the learner said on a check. It is NOT a profile and it is NOT stored:
// learning-state-data.ts reads the rows each time and this module derives, per topic, nine dimensions of evidence:
//
//   exposure, understanding demonstrated, misconceptions, independent recall, delayed recall, application and reasoning,
//   learner-stated confidence, activity history, evidence quality and recency.
//
// ⚠ NO NUMBER THAT LOOKS CALIBRATED. Each dimension is a WORD (no evidence yet / not enough evidence / some evidence / stronger
//   evidence) with its counts in plain words and the rule that gave it. There is no percentage and no overall score, and no
//   single answer sets anything: one right answer is "not enough evidence"; different questions are needed for more.
// ⚠ NEVER COMPETENCE. Learning evidence on the learner's own practice: never verified competence, never a competency stage,
//   never a Passport record. Stated confidence is shown beside the answers and never counts as evidence of understanding.
// ⚠ TRANSPARENT RULES. Every threshold is an HQ policy key with a code default (policy.ts scholar_learning_state_*).

import type { MasteryLevel } from "./mastery";

export type StateMarking = "code" | "ai_evaluation" | "self" | "unmarked";
/** SALE-2026-11 R4: "case" is a completed clinical case made from the learner's notes (810), only where scholar_application_evidence is on. */
export type StateSource = "check" | "practice" | "review" | "osce" | "case";
/** One answer, already joined to its topic (learning-state-data.ts uses the same join as Progress by topic). */
export type StateEvidence = {
  itemId: string; attemptId: string | null; topicKey: string; chunkId: string | null; materialId: string;
  source: StateSource; level: MasteryLevel;
  /** 0..1, null when kept without a mark. */
  outcome: number | null; marking: StateMarking; at: string;
  confidence: "sure" | "unsure" | "guess" | null;
  /** Misconceptions the judgement named, or the rubric tags of a missed question. */
  misconceptions: readonly string[];
};
/** One learning action on a section (teach, explain, read, ...): exposure, not understanding. */
export type ExposureRow = { topicKey: string; chunkId: string; action: string; at: string };
export type StateTopic = { key: string; label: string; materialId: string | null; chunkIds: readonly string[] };

export type StateThresholds = {
  /** Marked answers' worth of evidence (app-marked 1, AI-evaluated 0.5, self-rated 0.35) below which a topic has not enough evidence. */
  minEvidence: number;
  /** Different questions answered well before understanding has "some evidence". */
  distinctQuestions: number;
  /** Days between first meeting a topic (or the last answer on a question) and a right answer for it to count as delayed recall. */
  delayDays: number;
  /** Evidence older than this many days is called not recent. */
  staleDays: number;
};
export const DEFAULT_STATE_THRESHOLDS: StateThresholds = { minEvidence: 2, distinctQuestions: 2, delayDays: 3, staleDays: 30 };
export const STATE_MARKING_WEIGHT: Record<StateMarking, number> = { code: 1, ai_evaluation: 0.5, self: 0.35, unmarked: 0 };

export const DIMENSION_KEYS = ["exposure", "understanding", "misconceptions", "recall", "delayed", "application", "confidence", "activity", "quality"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];
export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  exposure: "Met in your learning", understanding: "Understanding shown", misconceptions: "Possible misconceptions", recall: "Recall on your own",
  delayed: "Recall after time has passed", application: "Applying it", confidence: "What you said about your confidence", activity: "Activity", quality: "How strong and recent the evidence is",
};
export type EvidenceWord = "none" | "thin" | "some" | "stronger";
export const EVIDENCE_WORD_LABEL: Record<EvidenceWord, string> = { none: "No evidence yet", thin: "Not enough evidence", some: "Some evidence", stronger: "Stronger evidence" };

export type Dimension = { key: DimensionKey; label: string; word: EvidenceWord; summary: string; rule: string };
export type TopicLearningState = {
  key: string; label: string; materialId: string | null; chunkIds: string[];
  /** False when the marked evidence is below minEvidence: the summary then says so, and nothing is concluded. */
  enough: boolean;
  headline: string;
  dimensions: Dimension[];
  /** The answers behind it, newest first (at most 12), for "see the evidence". */
  evidence: { at: string; source: StateSource; outcome: "right" | "partly" | "not yet" | "not marked"; marking: StateMarking; itemId: string; chunkId: string | null; confidence: StateEvidence["confidence"] }[];
  lastAt: string | null;
  /** SALE-2026-11 R3: the misconception named on two or more DIFFERENT questions (rule M1 "stronger"), else null. Read by next-best-action.ts. */
  repeatedMisconception?: string | null;
};
export const LEARNING_STATE_NOTE = "Learning evidence from your own practice, not verified competence. No single answer decides it, and it is never a competency stage.";

const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const right = (e: StateEvidence) => e.outcome !== null && e.outcome >= 0.75;
const partly = (e: StateEvidence) => e.outcome !== null && e.outcome >= 0.25 && e.outcome < 0.75;
const marked = (e: StateEvidence) => e.outcome !== null && e.marking !== "unmarked";
const SOURCE_WORD: Record<StateSource, string> = { check: "lesson check", practice: "practice question", review: "card review", osce: "OSCE practice", case: "clinical case" };
const MARK_WORD: Record<StateMarking, string> = { code: "marked by the app", ai_evaluation: "AI-evaluated", self: "self-rated", unmarked: "not marked" };
const TEACHING = new Set(["teach", "explain", "simplify", "deeper", "examples", "summary", "read", "revisit", "resume", "check", "clarify"]);

/** Pure. Distinct items whose LATEST marked answer in `rows` was right. */
function distinctRight(rows: readonly StateEvidence[]): string[] {
  const latest = new Map<string, StateEvidence>();
  for (const r of rows) if (marked(r)) { const l = latest.get(r.itemId); if (!l || r.at > l.at) latest.set(r.itemId, r); }
  return [...latest.values()].filter(right).map(r => r.itemId);
}
function wordFor(distinct: number, weight: number, T: StateThresholds, any: boolean): EvidenceWord {
  if (!any) return "none";
  if (distinct < T.distinctQuestions) return "thin";
  return weight >= 2 * T.minEvidence && distinct > T.distinctQuestions ? "stronger" : "some";
}

/** Pure. One topic's learning state from its rows. */
export function topicLearningState(topic: StateTopic, rows: readonly StateEvidence[], exposure: readonly ExposureRow[], now: string, thresholds?: Partial<StateThresholds>): TopicLearningState {
  const T = { ...DEFAULT_STATE_THRESHOLDS, ...thresholds };
  const nowMs = Date.parse(now);
  const answers = [...rows].sort((a, b) => b.at.localeCompare(a.at));
  const markedRows = answers.filter(marked);
  const weight = markedRows.reduce((n, r) => n + STATE_MARKING_WEIGHT[r.marking], 0);
  const enough = weight >= T.minEvidence;
  const dims: Dimension[] = [];

  // exposure
  const seen = exposure.filter(e => TEACHING.has(e.action));
  const firstSeenAt = [...seen.map(e => e.at), ...answers.map(a => a.at)].sort()[0] ?? null;
  dims.push({ key: "exposure", label: DIMENSION_LABEL.exposure, word: seen.length ? "some" : "none", rule: "E1",
    summary: seen.length ? `${plural(seen.length, "learning action")} on these sections (lessons, explanations, reading). Meeting a topic is not the same as understanding it.` : "No lessons or reading recorded on these sections yet." });

  // understanding demonstrated: lesson checks and practice questions
  const und = markedRows.filter(r => r.source === "check" || r.source === "practice");
  const undRight = distinctRight(und);
  const undW = und.filter(right).reduce((n, r) => n + STATE_MARKING_WEIGHT[r.marking], 0);
  const lastUnd = und[0];
  dims.push({ key: "understanding", label: DIMENSION_LABEL.understanding, word: wordFor(undRight.length, undW, T, und.length > 0), rule: "U1",
    summary: !und.length ? "No marked lesson checks or practice answers yet."
      : `${plural(undRight.length, "different question")} answered well out of ${plural(new Set(und.map(r => r.itemId)).size, "question")} tried.`
        + (undRight.length < T.distinctQuestions ? ` One right answer is limited evidence: about ${T.distinctQuestions} different questions answered well are needed.` : "")
        + (lastUnd && !right(lastUnd) ? " Your latest answer here was not fully right yet." : "") });

  // misconceptions
  const missed = answers.filter(r => marked(r) && !right(r));
  const tags = new Map<string, Set<string>>();
  for (const r of missed) for (const m of r.misconceptions) { const k = m.trim(); if (k) tags.set(k, (tags.get(k) ?? new Set()).add(r.itemId)); }
  const repeated = [...tags.entries()].filter(([, s]) => s.size >= 2);
  const named = [...tags.keys()];
  const missedItems = new Set(missed.map(r => r.itemId)).size;
  dims.push({ key: "misconceptions", label: DIMENSION_LABEL.misconceptions, word: repeated.length ? "stronger" : named.length ? "some" : missedItems >= 2 ? "thin" : "none", rule: "M1",
    summary: repeated.length ? `"${repeated[0][0]}" came up on ${repeated[0][1].size} different questions: a likely misconception to correct.`
      : named.length ? `Feedback named a possible misconception: "${named[0]}". Once is not a pattern.`
        : missedItems >= 2 ? `${plural(missedItems, "different question")} not answered well yet, with no named misconception.` : "None seen in your answers." });

  // independent recall: card reviews and practice questions (outside the lesson), at recall or understanding level
  const rec = markedRows.filter(r => r.source === "review" || (r.source === "practice" && (r.level === "recall" || r.level === "understanding" || r.level === "unknown")));
  const recRight = distinctRight(rec);
  dims.push({ key: "recall", label: DIMENSION_LABEL.recall, word: wordFor(recRight.length, rec.filter(right).reduce((n, r) => n + STATE_MARKING_WEIGHT[r.marking], 0), T, rec.length > 0), rule: "R1",
    summary: rec.length ? `${plural(recRight.length, "card or question")} recalled well on your own, away from the lesson, out of ${new Set(rec.map(r => r.itemId)).size}.` : "No card reviews or practice questions on this topic yet." });

  // delayed recall: right at least delayDays after the topic was first met, or after the previous answer on the same item
  const byItem = new Map<string, StateEvidence[]>();
  for (const r of [...markedRows].reverse()) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const delayedItems = new Set<string>();
  for (const [item, list] of byItem) list.forEach((r, i) => {
    if (!right(r)) return;
    const since = i > 0 ? list[i - 1].at : firstSeenAt;
    if (since && Date.parse(r.at) - Date.parse(since) >= T.delayDays * DAY) delayedItems.add(item);
  });
  dims.push({ key: "delayed", label: DIMENSION_LABEL.delayed, word: delayedItems.size === 0 ? (markedRows.length ? "thin" : "none") : delayedItems.size >= T.distinctQuestions ? "some" : "thin", rule: "D1",
    summary: delayedItems.size ? `${plural(delayedItems.size, "question")} answered well ${T.delayDays} or more days after you first met ${delayedItems.size === 1 ? "it" : "them"}: this supports retention.` : `No right answer yet ${T.delayDays} or more days after first meeting this topic.` });

  // application and reasoning
  const app = markedRows.filter(r => r.level === "application" || r.level === "reasoning" || r.source === "osce" || r.source === "case");
  const appRight = distinctRight(app);
  dims.push({ key: "application", label: DIMENSION_LABEL.application, word: wordFor(appRight.length, app.filter(right).reduce((n, r) => n + STATE_MARKING_WEIGHT[r.marking], 0), T, app.length > 0), rule: "A1",
    summary: app.length ? `${plural(appRight.length, "application or reasoning task")} done well out of ${new Set(app.map(r => r.itemId)).size}.` : "No application, reasoning or case practice on this topic yet." });

  // stated confidence
  const conf = answers.filter(r => r.confidence);
  const sureWrong = conf.filter(r => r.confidence === "sure" && marked(r) && !right(r)).length;
  dims.push({ key: "confidence", label: DIMENSION_LABEL.confidence, word: conf.length ? "some" : "none", rule: "C1",
    summary: conf.length ? `You said how sure you were on ${plural(conf.length, "answer")}${sureWrong ? `; ${sureWrong} you were sure of ${sureWrong === 1 ? "was" : "were"} not fully right` : ""}. Confidence is shown beside your answers and never counts as understanding.`
      : "You have not said how sure you were on any answer here. It is optional." });

  // activity history
  const lastAt = [...answers.map(a => a.at), ...exposure.map(e => e.at)].sort().pop() ?? null;
  const days = new Set([...answers.map(a => a.at.slice(0, 10)), ...exposure.map(e => e.at.slice(0, 10))]).size;
  dims.push({ key: "activity", label: DIMENSION_LABEL.activity, word: answers.length || exposure.length ? "some" : "none", rule: "H1",
    summary: answers.length || exposure.length ? `${plural(answers.length, "answer")} and ${plural(exposure.length, "learning action")} over ${plural(days, "day")}${lastAt ? `, most recently on ${lastAt.slice(0, 10)}` : ""}.` : "Nothing recorded yet." });

  // evidence quality and recency
  const counts = (["code", "ai_evaluation", "self", "unmarked"] as const).map(m => [m, answers.filter(a => a.marking === m).length] as const).filter(([, n]) => n > 0);
  const newest = markedRows[0]?.at ?? null;
  const stale = newest ? nowMs - Date.parse(newest) > T.staleDays * DAY : false;
  const appMarked = markedRows.filter(r => r.marking === "code").length;
  dims.push({ key: "quality", label: DIMENSION_LABEL.quality, word: !markedRows.length ? "none" : !enough || stale ? "thin" : appMarked >= T.minEvidence ? "stronger" : "some", rule: "Q1",
    summary: !answers.length ? "No answers yet."
      : `${counts.map(([m, n]) => `${n} ${MARK_WORD[m]}`).join(", ")}. App-marked answers count in full; AI-evaluated and self-rated ones count less; unmarked ones do not count.`
        + (stale ? ` The newest marked answer is more than ${T.staleDays} days old.` : "") });

  const und0 = dims.find(d => d.key === "understanding")!;
  const mis0 = dims.find(d => d.key === "misconceptions")!;
  const headline = !enough
    ? (answers.length ? "Not enough evidence yet to say how this topic is going. Answer a few different questions on it." : "No answers on this topic yet, so Scholar draws no conclusion.")
    : [`Understanding: ${EVIDENCE_WORD_LABEL[und0.word].toLowerCase()}`, mis0.word === "stronger" ? "a likely misconception to correct" : mis0.word === "some" ? "a possible misconception" : null,
      `recall after time: ${EVIDENCE_WORD_LABEL[dims.find(d => d.key === "delayed")!.word].toLowerCase()}`, `applying it: ${EVIDENCE_WORD_LABEL[dims.find(d => d.key === "application")!.word].toLowerCase()}`]
      .filter(Boolean).join("; ") + ".";

  return {
    key: topic.key, label: topic.label, materialId: topic.materialId, chunkIds: [...topic.chunkIds], enough, headline, dimensions: dims, lastAt, repeatedMisconception: repeated[0]?.[0] ?? null,
    evidence: answers.slice(0, 12).map(a => ({ at: a.at, source: a.source, outcome: !marked(a) ? "not marked" : right(a) ? "right" : partly(a) ? "partly" : "not yet", marking: a.marking, itemId: a.itemId, chunkId: a.chunkId, confidence: a.confidence })),
  };
}

/** Pure. Every topic's learning state, the topics with the most recent evidence first. */
export function buildLearningState(input: { topics: readonly StateTopic[]; evidence: readonly StateEvidence[]; exposure: readonly ExposureRow[]; now: string; thresholds?: Partial<StateThresholds> }): TopicLearningState[] {
  const rows = new Map<string, StateEvidence[]>();
  for (const e of input.evidence) rows.set(e.topicKey, [...(rows.get(e.topicKey) ?? []), e]);
  const exp = new Map<string, ExposureRow[]>();
  for (const e of input.exposure) exp.set(e.topicKey, [...(exp.get(e.topicKey) ?? []), e]);
  return input.topics.map(t => topicLearningState(t, rows.get(t.key) ?? [], exp.get(t.key) ?? [], input.now, input.thresholds))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.label.localeCompare(b.label));
}

export const evidenceLine = (e: TopicLearningState["evidence"][number]): string =>
  `${e.at.slice(0, 10)} · ${SOURCE_WORD[e.source]} · ${e.outcome} (${MARK_WORD[e.marking]})${e.confidence ? ` · you said: ${e.confidence === "sure" ? "sure" : e.confidence === "unsure" ? "not sure" : "guessing"}` : ""}`;
