// ── SCHOLAR-SQIE-LEARNER-01: TRUE/FALSE AND EXTENDED RESPONSE ── two formats of the stored `short` kind, no migration ─────
//
// Both are stored as the existing `short` kind (migrations 416/710 CHECKs: options [], correct_index null, answer.accepted of
// 1 to 8 strings), told apart by answer.format -- exactly how cloze (cloze.ts) is stored. A session offers them under their own
// names (revision.ts effectiveKind).
//
//   true_false  answer { format: 'true_false', accepted: ['true' | 'false'], statement, explanation, rubric }.
//               A statement the passage settles. Marked by code, never by a model. The two buttons are the whole answer.
//   extended    answer { format: 'extended', accepted: [modelAnswer], modelAnswer, marks, partialCredit, rubric (3 to 8 keyPoints) }.
//               Marked by the EXISTING formative evaluator against the stored key points (generation.ts runEvaluateExtended):
//               the score is the share of key points the answer makes, and the practice marks are a fixed number a point.
//               Formative only: not an assessment, not a grade, never competence.
//
// Pure: no I/O, no clock, no model.

import { EXTENDED_MARKS_MAX, EXTENDED_POINTS_MAX, EXTENDED_POINTS_MIN } from "./config";

const formatOf = (q: { kind: string; answer: unknown }): string | null =>
  q.kind === "short" && !!q.answer && typeof q.answer === "object" && typeof (q.answer as Record<string, unknown>).format === "string" ? ((q.answer as Record<string, unknown>).format as string) : null;

/** Pure. Whether a stored question is a true/false item (a short answer whose key says so). */
export const isTrueFalseQuestion = (q: { kind: string; answer: unknown }): boolean => formatOf(q) === "true_false";
/** Pure. Whether a stored question is an extended-response item. */
export const isExtendedQuestion = (q: { kind: string; answer: unknown }): boolean => formatOf(q) === "extended";

// ── TRUE / FALSE ──

/** Pure. "true" or "false" from what a browser sent (case and spaces ignored), or null. */
export const truthOf = (v: unknown): "true" | "false" | null => {
  const t = typeof v === "string" ? v.trim().toLowerCase() : typeof v === "boolean" ? String(v) : "";
  return t === "true" || t === "false" ? t : null;
};

/** Pure. A true/false answer marked by code: true on the keyed value. */
export const markTrueFalse = (answer: string, accepted: readonly string[]): boolean => {
  const a = truthOf(answer), k = truthOf(accepted[0]);
  return a !== null && a === k;
};

export type TrueFalseRaw = { statement: string; truth: boolean; explanation: string };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Pure. The fields of a generated true/false item, or null where it is not well formed. */
export function parseTrueFalseRaw(r: Record<string, unknown>): TrueFalseRaw | null {
  const statement = text(r.statement, 300), explanation = text(r.explanation ?? r.rationale, 1200);
  const t = truthOf(r.answer ?? r.truth);
  return statement && explanation && t ? { statement, truth: t === "true", explanation } : null;
}

/**
 * Pure. A batch of true/false items kept balanced: when both truths are present neither leads by more than one, and a batch
 * that is all one truth keeps at most two. Order within a truth is the given order.
 */
export function balanceTrueFalse<T extends { answer: Record<string, unknown> }>(items: readonly T[], limit: number): T[] {
  const isTrue = (d: T) => (d.answer.accepted as string[] | undefined)?.[0] === "true";
  const t = items.filter(isTrue), f = items.filter(d => !isTrue(d));
  const cap = Math.max(0, limit);
  if (!t.length || !f.length) return (t.length ? t : f).slice(0, Math.min(cap, 2));
  const out: T[] = [];
  for (let i = 0; out.length < cap && (i < t.length || i < f.length); i++) {
    if (i < t.length && out.length < cap) out.push(t[i]);
    if (i < f.length && out.length < cap) out.push(f[i]);
  }
  return out;
}

// ── EXTENDED RESPONSE ──

export type ExtendedSpec = { modelAnswer: string; keyPoints: string[]; marksPerPoint: number; marks: number };

/** Pure. The whole marks one key point is worth: the item's marks shared over its points, at least one. */
export const marksPerPointOf = (marks: number, points: number): number => Math.max(1, Math.floor(Math.min(EXTENDED_MARKS_MAX, Math.max(1, marks)) / Math.max(1, points)));

/**
 * Pure. An extended item's marking key read from a stored `answer`: the model answer, 3 to 8 key points, whole marks a point.
 * null where the row does not carry a sound one (the question is then not offered).
 */
export function extendedSpecOf(answer: unknown): ExtendedSpec | null {
  const a = (answer ?? {}) as Record<string, unknown>;
  const rubric = (a.rubric ?? {}) as Record<string, unknown>;
  const kp = Array.isArray(rubric.keyPoints) ? rubric.keyPoints.filter((x): x is string => typeof x === "string" && !!x.trim()).map(x => x.trim()) : [];
  const model = typeof a.modelAnswer === "string" ? a.modelAnswer.trim() : "";
  if (!model || kp.length < EXTENDED_POINTS_MIN || kp.length > EXTENDED_POINTS_MAX) return null;
  const pc = (a.partialCredit ?? {}) as Record<string, unknown>;
  const per = Number.isInteger(pc.marksPerPoint) && (pc.marksPerPoint as number) >= 1 ? Math.min(EXTENDED_MARKS_MAX, pc.marksPerPoint as number) : marksPerPointOf(Number.isInteger(a.marks) ? (a.marks as number) : kp.length, kp.length);
  return { modelAnswer: model, keyPoints: kp, marksPerPoint: per, marks: per * kp.length };
}

/** Pure. The practice marks of an extended answer from the key points it made (indexes, repeats and strays ignored). */
export function extendedMarks(spec: Pick<ExtendedSpec, "keyPoints" | "marksPerPoint">, matched: readonly number[]): { matched: number[]; awarded: number; total: number; score: number; correct: boolean } {
  const n = spec.keyPoints.length;
  const hit = [...new Set(matched.filter(i => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
  return { matched: hit, awarded: hit.length * spec.marksPerPoint, total: n * spec.marksPerPoint, score: n ? hit.length / n : 0, correct: n > 0 && hit.length === n };
}

export type ExtendedRaw = { stem: string; modelAnswer: string; keyPoints: string[]; marks: number };

/** Pure. The fields of a generated extended-response item, or null where it is not well formed. */
export function parseExtendedRaw(r: Record<string, unknown>): ExtendedRaw | null {
  const stem = text(r.stem, 400), modelAnswer = text(r.modelAnswer, 1200);
  const kp = Array.isArray(r.keyPoints) ? r.keyPoints.map(x => text(x, 200)) : null;
  if (!stem || !modelAnswer || !kp || kp.some(x => !x)) return null;
  const keyPoints = [...new Set(kp as string[])];
  if (keyPoints.length < EXTENDED_POINTS_MIN || keyPoints.length > EXTENDED_POINTS_MAX) return null;
  const marks = Number.isInteger(r.marks) && (r.marks as number) >= 1 && (r.marks as number) <= EXTENDED_MARKS_MAX ? (r.marks as number) : keyPoints.length;
  return { stem, modelAnswer, keyPoints, marks };
}

/**
 * Pure. The key points an AI-evaluated extended answer was found to make, read back from its attempt's `response.matched`
 * (indexes into the key points, bounded). null for a self-graded or code-marked attempt, or one that kept none.
 */
export function storedMatched(response: unknown, marking: string | null | undefined, points: number): number[] | null {
  if (marking !== "ai_evaluation" || !response || typeof response !== "object" || points < 1) return null;
  const m = (response as Record<string, unknown>).matched;
  if (!Array.isArray(m) || m.length > points || !m.every(i => Number.isInteger(i) && (i as number) >= 0 && (i as number) < points)) return null;
  return [...new Set(m as number[])].sort((a, b) => a - b);
}
