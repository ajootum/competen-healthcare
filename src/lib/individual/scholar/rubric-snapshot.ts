// ── SCHOLAR-SQIE-LEARNER-01: A RUBRIC SNAPSHOT ON EVERY ATTEMPT ── versioning without a migration ───────────────────────────
//
// A question's key and rubric live in its `answer` jsonb and can change later (an edit, a regeneration, a library update). An
// attempt kept no copy, so feedback shown again later would be read against the NEW rubric. Now the attempt keeps a compact
// snapshot of what it was marked against under `response.rubric`: no new column (migration 416 `response` is an object of at
// most 8000 bytes), nothing a CHECK has to know.
//
//   { v: 1, hash, keyPoints?, accepted?, marks?, parts?: [{ marks, accepted }] }
//
// `hash` is the first 16 hex characters of the sha256 of the canonical JSON of the question's `answer` (key and rubric): the
// same hash means the same marking guide. The other fields are what feedback shows (the accepted answers, the key points, the
// practice marks), cut short. ⚠ NEVER FAILS AN ATTEMPT: the snapshot is kept small, and if it cannot fit with the answer it
// is cut to { v, hash } and, failing that, left out -- the attempt is recorded either way.
//
// ⚠ An mcq or case attempt cannot carry one: migration 416 requires exactly one of chosen_index and response, and a choice is
// stored in chosen_index. Those attempts are marked by code against a key that does not move, and keep the 416 shape.
// ⚠ FORMATIVE. A snapshot is a record of the guide, not a grade, an assessment or competence.

import { createHash } from "node:crypto";
import { EXTENDED_MARKS_MAX } from "./config";
import { extendedSpecOf, isExtendedQuestion } from "./formats";
import { RESPONSE_BUDGET } from "./written-feedback";

export const SNAPSHOT_VERSION = 1 as const;
/** The most bytes a snapshot's JSON may take before it is cut back. */
export const SNAPSHOT_MAX_BYTES = 1500;

export type SnapshotPart = { marks: number; accepted: string[] };
export type RubricSnapshot = { v: typeof SNAPSHOT_VERSION; hash: string; keyPoints?: string[]; accepted?: string[]; marks?: number; parts?: SnapshotPart[] };

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Pure. JSON with object keys sorted at every depth, so equal content is equal text. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Pure. The marking guide's hash: the question's `answer` (key and rubric), canonical. */
export const rubricHash = (answer: unknown): string => createHash("sha256").update(canonicalJson(answer ?? null)).digest("hex").slice(0, 16);

const cut = (xs: unknown, n: number, max: number): string[] =>
  Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, n).map(x => (x.length > max ? x.slice(0, max) : x)) : [];

/**
 * Pure. The snapshot of a question's marking guide, or null where the question has none (no answer and no rubric). Compact:
 * optional fields are dropped, longest first, until it is within SNAPSHOT_MAX_BYTES; at the end it is { v, hash }.
 */
export function rubricSnapshotOf(q: { kind: string; answer: unknown }): RubricSnapshot | null {
  if (!q.answer || typeof q.answer !== "object") return null;
  const a = q.answer as Record<string, unknown>;
  const rubric = (a.rubric ?? {}) as Record<string, unknown>;
  const snap: RubricSnapshot = { v: SNAPSHOT_VERSION, hash: rubricHash(q.answer) };
  const keyPoints = cut(rubric.keyPoints, 8, 160);
  if (keyPoints.length) snap.keyPoints = keyPoints;
  if (isExtendedQuestion(q)) {
    const spec = extendedSpecOf(q.answer);
    if (spec) snap.marks = spec.marks;
  } else if (Array.isArray(a.accepted)) {
    const acc = cut(a.accepted, 8, 120);
    if (acc.length) snap.accepted = acc;
  }
  if (Array.isArray(a.parts)) {
    const parts = (a.parts as Record<string, unknown>[]).map(p => ({ marks: Number.isInteger(p?.marks) ? (p.marks as number) : 1, accepted: cut(p?.accepted, 4, 120) }));
    if (parts.length && parts.every(p => p.accepted.length)) {
      snap.parts = parts; snap.marks = parts.reduce((n, p) => n + p.marks, 0);
    }
  }
  // Cut back, longest optional field first, until it fits. { v, hash } always fits.
  for (const drop of ["keyPoints", "accepted", "parts"] as const) {
    if (bytes(snap) <= SNAPSHOT_MAX_BYTES) break;
    delete snap[drop];
  }
  return bytes(snap) <= SNAPSHOT_MAX_BYTES ? snap : { v: SNAPSHOT_VERSION, hash: snap.hash };
}

/**
 * Pure. The response to store with its snapshot under `rubric`. Never throws and never loses the answer: if the snapshot does
 * not fit within the response budget (written-feedback.ts RESPONSE_BUDGET) it is cut to { v, hash }, and if even that does not
 * fit, or there is no response to put it on (a choice), the response is returned as it came.
 */
export function withRubricSnapshot(response: Record<string, unknown> | null, snap: RubricSnapshot | null): Record<string, unknown> | null {
  if (!response || !snap) return response;
  try {
    const { rubric: _old, ...rest } = response;
    void _old;
    for (const s of [snap, { v: snap.v, hash: snap.hash }]) {
      const next = { ...rest, rubric: s };
      if (bytes(next) <= RESPONSE_BUDGET) return next;
    }
  } catch { /* a snapshot is never worth a failed attempt */ }
  return response;
}

/** Pure. The snapshot kept on an attempt, read back and bounded, or null (an older attempt, or nothing valid). */
export function snapshotOf(response: unknown): RubricSnapshot | null {
  if (!response || typeof response !== "object") return null;
  const r = (response as Record<string, unknown>).rubric as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || r.v !== SNAPSHOT_VERSION || typeof r.hash !== "string" || !/^[0-9a-f]{16}$/.test(r.hash)) return null;
  const out: RubricSnapshot = { v: SNAPSHOT_VERSION, hash: r.hash };
  const keyPoints = cut(r.keyPoints, 8, 160), accepted = cut(r.accepted, 8, 120);
  if (keyPoints.length) out.keyPoints = keyPoints;
  if (accepted.length) out.accepted = accepted;
  if (Number.isInteger(r.marks) && (r.marks as number) >= 0 && (r.marks as number) <= 100) out.marks = r.marks as number;
  if (Array.isArray(r.parts)) {
    const parts = (r.parts as Record<string, unknown>[]).slice(0, 4).map(p => ({ marks: Number.isInteger(p?.marks) ? (p.marks as number) : 0, accepted: cut(p?.accepted, 4, 120) }));
    if (parts.length && parts.every(p => p.marks >= 1 && p.marks <= 5 && p.accepted.length)) out.parts = parts;
  }
  return out;
}

/**
 * Pure. The question as it read when the attempt was marked: the snapshot's accepted answers, key points and part marks
 * laid over the current row where it holds them. A copy; the row is not changed. With no snapshot it is the row itself.
 */
export function applySnapshot<T extends { kind: string; answer: unknown }>(q: T, snap: RubricSnapshot | null): T {
  if (!snap || !q.answer || typeof q.answer !== "object") return q;
  const a = { ...(q.answer as Record<string, unknown>) };
  if (snap.accepted && !isExtendedQuestion(q) && Array.isArray(a.accepted)) a.accepted = snap.accepted;
  if (snap.keyPoints) {
    const rubric = { ...((a.rubric ?? {}) as Record<string, unknown>) };
    rubric.keyPoints = snap.keyPoints;
    a.rubric = rubric;
  }
  if (isExtendedQuestion(q) && snap.marks !== undefined && snap.keyPoints?.length) {
    a.marks = Math.min(EXTENDED_MARKS_MAX, snap.marks);
    a.partialCredit = { rule: "per_key_point", marksPerPoint: Math.max(1, Math.floor(snap.marks / snap.keyPoints.length)) };
  }
  if (snap.parts && Array.isArray(a.parts) && a.parts.length === snap.parts.length)
    a.parts = (a.parts as Record<string, unknown>[]).map((p, i) => ({ ...p, marks: snap.parts![i].marks, accepted: snap.parts![i].accepted }));
  return { ...q, answer: a };
}

/** Pure. Whether the question's marking guide is no longer the one the attempt was marked against. */
export const rubricChanged = (q: { answer: unknown }, snap: RubricSnapshot | null): boolean => !!snap && !!q.answer && snap.hash !== rubricHash(q.answer);
