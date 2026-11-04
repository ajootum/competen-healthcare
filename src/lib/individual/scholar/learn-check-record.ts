// LEARNING-CLOSE-2026-11 WS01 (owner decision D01, 4 Nov 2026): CYU-01 where a lesson's checks are shown, CYU-03 the kept answer,
// CYU-04 the history. Pure and client-safe: no server imports. learn-check.ts holds the feedback parser and the self-review;
// this module holds what is STORED and READ BACK (416 individual_scholar_attempt.response) and the placement rule.
//
// ⚠ REUSE. A check question is an individual_scholar_question (416 kind short, extended format: the lesson's key learning points
// are its key). An answer is an individual_scholar_attempt: `response` holds the typed text and the judgement under `check`, and,
// where an AI judged it, the same feedback in the written-feedback form (`response.formative`, written-feedback.ts) so the study
// session and the Personal AI read it as they read every other written answer. The lesson, step and session are the clarify
// learning event (414) that references the attempt (950). No second table, engine or history.
// ⚠ FORMATIVE. A kept check is a learning record for the learner: never assessment, never verified competence, never a Passport record.

import type { CheckFeedbackParts } from "./learn-check";
import { adaptiveForStorage, isStatedConfidence, parseAdaptiveRecord, type AdaptiveRecord, type StatedConfidence } from "./learning-need";

// ── CYU-01: PLACEMENT ──

/** Policy scholar_learn_check_placement: the first check after the teaching, the rest at the lesson's end, or all at the end. */
export type CheckPlacement = "distributed" | "lesson_end";
/** A lesson shorter than this (words of its teaching paragraphs) keeps its checks together at the end. */
export const CHECK_DISTRIBUTE_MIN_WORDS = 160;

/**
 * Pure. WHERE a lesson's check questions are shown. They follow the teaching sequence and never interrupt it:
 *   - a lesson with two questions whose teaching is substantial (CHECK_DISTRIBUTE_MIN_WORDS words in at least two paragraphs)
 *     shows the first after the teaching paragraphs (before the key points) and the second after the lesson;
 *   - a single question, a short lesson, an older (v1/v2) lesson without teaching paragraphs, or the lesson_end policy keeps
 *     every question at the end, as before.
 * Never one per paragraph, never one per slide: at most the lesson's own questions (teach-format.ts TEACH_MAX_QUESTIONS), each optional.
 */
export function placeChecks(parts: { understanding?: readonly string[] | null; questions: readonly string[] }, policy: { placement: CheckPlacement; minWords?: number }): { mid: number[]; end: number[] } {
  const all = parts.questions.map((_, i) => i);
  const paras = (parts.understanding ?? []).filter(p => p.trim());
  const words = paras.reduce((n, p) => n + p.replace(/\[[SRE]\d+\]/g, " ").split(/\s+/).filter(Boolean).length, 0);
  const min = Math.max(0, policy.minWords ?? CHECK_DISTRIBUTE_MIN_WORDS);
  if (policy.placement !== "distributed" || all.length < 2 || paras.length < 2 || words < min) return { mid: [], end: all };
  return { mid: [0], end: all.slice(1) };
}

// ── CYU-03: THE KEPT ANSWER ──

export type CheckVerdictValue = "understood" | "partly" | "not_yet";
/** The learner's own grading of their answer against the key points (self-review, no AI). Never a verdict. */
export type SelfGrade = "covered" | "partly" | "missed";
export const SELF_GRADE_LABEL: Record<SelfGrade, string> = { covered: "I covered the key points", partly: "I covered some of them", missed: "I missed most of them" };
export const SELF_GRADE_SAID: Record<SelfGrade, string> = { covered: "You said you covered the key points", partly: "You said you covered some of the key points", missed: "You said you missed most of the key points" };
export const VERDICT_SCORE: Record<CheckVerdictValue, number> = { understood: 1, partly: 0.5, not_yet: 0 };
export const SELF_GRADE_SCORE: Record<SelfGrade, number> = { covered: 1, partly: 0.5, missed: 0 };
export const isCheckVerdict = (v: unknown): v is CheckVerdictValue => v === "understood" || v === "partly" || v === "not_yet";
export const isSelfGrade = (v: unknown): v is SelfGrade => v === "covered" || v === "partly" || v === "missed";

export type CheckResponse = {
  kind: "check";
  /** The answer as typed (bounded by the route), and the question as shown. */
  text: string; question: string;
  verdict: CheckVerdictValue | null; selfGrade: SelfGrade | null;
  /** The AI judgement's parts, or its free text where it wrote none. */
  feedback: CheckFeedbackParts | null; summary: string | null;
  /** SALE-2026-11 R1: how sure the learner said they were (optional, never evidence of understanding). */
  confidence?: StatedConfidence | null;
  /** SALE-2026-11 R1 (SALE-06/07): the next-step decision made for this answer, with its reason (learning-need.ts). */
  adaptive?: AdaptiveRecord | null;
};
/** The response is kept under this many bytes of JSON (416 allows 8000; the formative copy shares the row). */
export const CHECK_RESPONSE_BUDGET = 6000;
const bytesOf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** Pure. The response object to store: the answer always, the feedback where it fits (points dropped from the end, longest part first). */
export function checkResponse(input: { text: string; question: string; verdict?: CheckVerdictValue | null; selfGrade?: SelfGrade | null; feedback?: CheckFeedbackParts | null; summary?: string | null; confidence?: StatedConfidence | null; adaptive?: AdaptiveRecord | null }): Record<string, unknown> {
  const base: CheckResponse = {
    kind: "check", text: cut(input.text.trim(), 3000), question: cut(input.question.trim(), 400),
    verdict: input.verdict ?? null, selfGrade: input.selfGrade ?? null,
    feedback: input.feedback ? { right: [...input.feedback.right], missing: [...input.feedback.missing], misconceptions: [...input.feedback.misconceptions], keyPoints: [...input.feedback.keyPoints], next: input.feedback.next } : null,
    summary: input.feedback ? null : input.summary ? cut(input.summary.trim(), 1200) : null,
    // SALE-2026-11 R1: kept beside the answer (no new column); the decision is bounded by adaptiveForStorage.
    ...(input.confidence ? { confidence: input.confidence } : {}),
    ...(input.adaptive ? { adaptive: adaptiveForStorage(input.adaptive) as unknown as AdaptiveRecord } : {}),
  };
  const lists: (keyof Omit<CheckFeedbackParts, "next">)[] = ["right", "missing", "misconceptions", "keyPoints"];
  while (bytesOf(base) > CHECK_RESPONSE_BUDGET) {
    const fb = base.feedback;
    if (!fb) {
      if (base.summary) base.summary = base.summary.length > 40 ? cut(base.summary, Math.floor(base.summary.length / 2)) : null;
      else base.text = cut(base.text, Math.floor(base.text.length / 2));
      continue;
    }
    const longest = lists.reduce((a, b) => (fb[b].length > fb[a].length ? b : a));
    if (fb[longest].length) fb[longest].pop(); else if (fb.next) fb.next = null; else base.feedback = null;
  }
  return base as unknown as Record<string, unknown>;
}

/** Pure. A stored response read back, or null where it is not a kept check answer. */
export function parseCheckResponse(raw: unknown): CheckResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "check" || typeof r.text !== "string" || !r.text.trim()) return null;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, n) : []);
  const fb = r.feedback && typeof r.feedback === "object" ? (r.feedback as Record<string, unknown>) : null;
  const feedback: CheckFeedbackParts | null = fb ? { right: strs(fb.right, 6), missing: strs(fb.missing, 6), misconceptions: strs(fb.misconceptions, 6), keyPoints: strs(fb.keyPoints, 8), next: typeof fb.next === "string" && fb.next.trim() ? fb.next : null } : null;
  return {
    kind: "check", text: r.text, question: typeof r.question === "string" ? r.question : "",
    verdict: isCheckVerdict(r.verdict) ? r.verdict : null, selfGrade: isSelfGrade(r.selfGrade) ? r.selfGrade : null,
    feedback: feedback && (feedback.right.length || feedback.missing.length || feedback.misconceptions.length || feedback.keyPoints.length || feedback.next) ? feedback : null,
    summary: typeof r.summary === "string" && r.summary.trim() ? r.summary : null,
    confidence: isStatedConfidence(r.confidence) ? r.confidence : null,
    adaptive: parseAdaptiveRecord(r.adaptive),
  };
}

/** Pure. The check feedback as the five written-feedback parts (question-intel.ts FeedbackParts): the key points become "why the answer holds". */
export function asFeedbackParts(f: CheckFeedbackParts): { right: string[]; missing: string[]; misconceptions: string[]; why: string | null; next: string | null } {
  return { right: f.right.slice(0, 4), missing: f.missing.slice(0, 4), misconceptions: f.misconceptions.slice(0, 3), why: f.keyPoints.length ? f.keyPoints.join(" ") : null, next: f.next };
}

/** How an attempt was marked (416 marking, 950 adds unmarked). */
export type CheckMarking = "ai_evaluation" | "self_graded" | "unmarked" | "deterministic";
export const CHECK_MARKING_LABEL: Record<CheckMarking, string> = {
  ai_evaluation: "Judged by AI against your notes. Formative, not verified.",
  self_graded: "Your own judgement against the key points. Formative.",
  unmarked: "Kept without a mark.",
  deterministic: "Marked against the stored answer.",
};

// ── CYU-04: THE HISTORY ──

/** One kept check, as the lesson, the Saved learning page and the study session read it (store.ts listCheckAttempts). */
export type CheckHistoryItem = {
  attemptId: string; questionId: string; answeredAt: string;
  question: string; response: CheckResponse; marking: CheckMarking; correct: boolean; score: number | null;
  model: string | null; promptVersion: string | null; contentVersion: number | null;
  sessionId: string | null; step: number | null; chunkId: string; materialId: string;
};

/** Pure. The kept checks of a lesson as the TAUGHT SO FAR prior checks (learn-context.ts PriorCheck), oldest first, at most `max` (the newest). */
export function historyToPriorChecks(items: readonly CheckHistoryItem[], max: number): { question: string; answer: string | null; verdict: CheckVerdictValue | null; feedback: string | null }[] {
  return [...items].sort((a, b) => (a.answeredAt < b.answeredAt ? -1 : a.answeredAt > b.answeredAt ? 1 : 0)).slice(-max)
    .map(i => ({ question: i.question, answer: i.response.text, verdict: i.response.verdict, feedback: i.response.feedback ? [...i.response.feedback.right, ...i.response.feedback.missing, ...i.response.feedback.misconceptions].join(" ") || null : i.response.summary }));
}

/** Pure. What a kept check says it was: the verdict, the learner's own grade, or that it is unmarked. */
export function checkOutcomeLabel(i: Pick<CheckHistoryItem, "marking" | "response">, verdictLabel: Record<CheckVerdictValue, string>): string {
  if (i.marking === "ai_evaluation" && i.response.verdict) return verdictLabel[i.response.verdict];
  if (i.marking === "self_graded" && i.response.selfGrade) return SELF_GRADE_SAID[i.response.selfGrade];
  return "Not marked";
}
export const CHECK_SAVED_NOTE = "Saved to your learning record. You can revisit it from this lesson and from Saved learning. It is not an assessment.";
export const CHECK_NOT_SAVED_NOTE = "This answer could not be saved to your learning record just now. It stays on this page.";
