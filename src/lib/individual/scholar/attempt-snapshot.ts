// ── SCHOLAR-CONTINUITY-01 item 2: WHAT AN ATTEMPT WAS ASSESSED AGAINST, AND ITS CORRECTIONS (migration 791) ──────────────
//
// Pure (server side: it hashes with node:crypto through rubric-snapshot.ts). The store writes and reads the rows; this file
// decides what goes in them and how feedback shown again reads them.
//
//   buildAttemptSnapshot   the question AS PRESENTED (stem, options in the order shown with their original indexes -- a
//                          match item's choices are shown shuffled, so their order is kept), the answer (a choice as both
//                          its presented and original index), the key and rationale, the 416 rubric snapshot and its hash,
//                          the result, and the hash of all of it (content_hash). Bounded to the 791 CHECK (16384 bytes),
//                          cut back in a fixed order; null only if even the cut-back row cannot fit (the attempt is kept).
//   questionChanged        the live question's content hash is not the snapshot's.
//   applyAssessedSnapshot  a COPY of the live row reading as it did when answered (stem, options, key, rationale).
//   effectiveResult        the latest correction, else the original. The original is never overwritten.
//
// ⚠ FORMATIVE. A snapshot or a correction is a record of a private practice attempt, never competence or a Passport record.
// ⚠ The 416 CHECK is unchanged: a choice attempt keeps chosen_index, and its snapshot is a separate row.
//
// SQIE-CLOSE-2026-11 WS-D (migration 990): an understanding check kept WITHOUT a mark (950 marking unmarked) keeps a snapshot too
// (outcome incorrect, no score: a reader shows the marking first, never "wrong"), and a snapshot names, for each competency the
// question practised, the framework version and competency content hash at the time (competency_provenance). Both fail closed
// without 990: the store retries without the column, and an unmarked snapshot 791 refuses is simply not kept.

import { rubricHash, rubricSnapshotOf, type RubricSnapshot } from "./rubric-snapshot";
import { keyOf, learnerItem } from "./revision";
import { scenarioSpecOf } from "./scenario";
import type { QuestionRow } from "./store";

export const SNAPSHOT_TOTAL_MAX_BYTES = 16384;
export type Outcome = "correct" | "partial" | "incorrect";
export type CorrectionBasis = "rubric_error" | "key_error" | "marking_error" | "other";
export const CORRECTION_BASES: readonly CorrectionBasis[] = ["rubric_error", "key_error", "marking_error", "other"];
export const CORRECTION_BASIS_LABEL: Record<CorrectionBasis, string> = {
  rubric_error: "The marking guide was wrong", key_error: "The answer key was wrong", marking_error: "The answer was marked wrongly", other: "Corrected",
};
export const QUESTION_CHANGED_NOTE = "This question has changed since you answered. What is shown here is the question, the options and the answer as they were when you answered.";

type Opt = { i: number; text: string };
export type Presented = { stem: string; options: Opt[]; choices?: Opt[]; parts?: string[] };
/** 990: one competency the question practised, as its framework stood when the attempt was marked. Null fields were not readable. */
export type CompetencyProvenance = { competencyId: string; frameworkId: string | null; frameworkCode: string | null; frameworkVersion: string | null; contentHash: string | null };
export const PROVENANCE_MAX = 20;
export type AttemptSnapshotRow = {
  attemptId: string; questionId: string; questionVersion: string; contentHash: string;
  presented: Presented; response: Record<string, unknown>; answerKey: Record<string, unknown>;
  rubric: RubricSnapshot | null; rubricHash: string | null; score: number | null; outcome: Outcome; marking: string;
  feedback: Record<string, unknown> | null; competencyIds: string[]; assessedAt: string;
  /** 990. Null: not recorded (before 990, or the framework could not be read). */
  competencyProvenance?: CompetencyProvenance[] | null;
};
export type CorrectionRow = {
  id: string; attemptId: string; previousScore: number | null; previousOutcome: Outcome; correctedScore: number | null; correctedOutcome: Outcome;
  reason: string; basis: CorrectionBasis; correctedByKind: "hq_actor" | "system_rule"; createdAt: string;
};

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).length;
const cut = (s: unknown, n: number) => { const x = typeof s === "string" ? s : ""; return x.length > n ? x.slice(0, n) : x; };

/** Pure. The result as an outcome word: the same rule as migration 791's correction guard. */
export const outcomeOf = (correct: boolean, score: number | null): Outcome => (correct ? "correct" : (score ?? 0) > 0 ? "partial" : "incorrect");

/** Pure. The hash of what is assessed: stem, options, key, marking guide and rationale, canonical. Same content, same hash. */
export function contentHashOf(q: Pick<QuestionRow, "kind" | "stem" | "options" | "correctIndex" | "answer" | "rationale">): string {
  return rubricHash({ kind: q.kind, stem: q.stem, options: q.options ?? [], correctIndex: q.correctIndex ?? null, answer: q.answer ?? null, rationale: q.rationale ?? "" });
}

/** Pure. The question as the learner saw it: options in the order shown, each with its original index. */
export function presentedOf(q: QuestionRow): Presented {
  const item = learnerItem(q);
  const options = (item.options ?? []).slice(0, 12).map((text, i) => ({ i, text: cut(text, 500) }));
  const out: Presented = { stem: cut(q.stem, 2000), options };
  // A match item's choices are shown in a seeded shuffle: keep each choice with its index in the stored key.
  if (item.choices?.length) {
    const k = keyOf(q);
    const keyed = k?.kind === "matches" ? k.matches : [];
    const used = new Set<number>();
    out.choices = item.choices.slice(0, 12).map(text => { const i = keyed.findIndex((m, j) => m === text && !used.has(j)); used.add(i); return { i, text: cut(text, 300) }; });
  }
  if (item.parts?.length) out.parts = item.parts.slice(0, 6).map(p => cut(p.prompt, 500));
  // CE-05: a scenario was presented stage by stage: keep each stage's new information and question, in order.
  const sc = scenarioSpecOf(q.answer);
  if (sc) out.parts = sc.stages.map(st => cut(st.reveal ? `${st.reveal} -- ${st.prompt}` : st.prompt, 500));
  return out;
}

/** Pure. The presented position of an original option index (the options are shown in stored order today). */
const presentedPos = (p: Presented, original: number) => p.options.findIndex(o => o.i === original);

/**
 * Pure. The snapshot row for one attempt. `response` is the stored 416 response (or null for a choice); its rubric snapshot
 * and formative feedback move to their own fields. `contentVersion`: the learner question's 730 content_version (1 if unknown).
 */
export function buildAttemptSnapshot(q: QuestionRow, a: {
  attemptId: string; answeredAt: string; chosenIndex: number | null; response: Record<string, unknown> | null;
  correct: boolean; score: number | null; marking: string; contentVersion?: number | null;
  /** 990: the framework version of each competency practised (competency-provenance.ts), or null where unread. */
  provenance?: readonly CompetencyProvenance[] | null;
}): AttemptSnapshotRow | null {
  const presented = presentedOf(q);
  const { rubric: _r, formative, ...answered } = a.response ?? {};
  void _r;
  const response: Record<string, unknown> = a.chosenIndex !== null
    ? { kind: "choice", original: a.chosenIndex, presented: presentedPos(presented, a.chosenIndex) }
    : { ...answered, ...(typeof answered.text === "string" ? { text: cut(answered.text, 4000) } : {}) };
  const k = keyOf(q);
  const answerKey: Record<string, unknown> = {
    ...(k ? (k.kind === "choice" ? { kind: "choice", original: k.index, presented: presentedPos(presented, k.index) } : k) : { kind: "none" }),
    rationale: cut(q.rationale, 2000),
  };
  // CE-05: a scenario's key is its stages (each with its own kind, key, weight and key point), as they stood when it was answered.
  const scenario = scenarioSpecOf(q.answer);
  if (scenario) answerKey.stages = scenario.stages;
  const rubric = rubricSnapshotOf(q);
  const row: AttemptSnapshotRow = {
    attemptId: a.attemptId, questionId: q.id,
    questionVersion: q.library ? `lib:${q.library.versionId}` : `own:${Math.max(1, Math.min(999999, Math.floor(a.contentVersion ?? 1)))}`,
    contentHash: contentHashOf(q), presented, response, answerKey,
    rubric, rubricHash: q.answer ? rubricHash(q.answer) : null,
    score: a.score === null || !Number.isFinite(a.score) ? null : Math.max(0, Math.min(1, a.score)),
    outcome: outcomeOf(a.correct, a.score), marking: a.marking,
    feedback: formative && typeof formative === "object" && !Array.isArray(formative) ? formative as Record<string, unknown> : null,
    competencyIds: q.competencyId ? [q.competencyId] : [], assessedAt: a.answeredAt,
    competencyProvenance: provenanceFor(q.competencyId ? [q.competencyId] : [], a.provenance ?? null),
  };
  return fitSnapshot(row);
}

const UUID = /^[0-9a-f-]{36}$/;
const bounded = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
/** Pure. The provenance kept for these competency ids: only ids the question practised, only well-formed (the 990 CHECK), at most 20. */
export function provenanceFor(competencyIds: readonly string[], read: readonly CompetencyProvenance[] | null): CompetencyProvenance[] | null {
  if (!read || !competencyIds.length) return null;
  const out = competencyIds.slice(0, PROVENANCE_MAX).flatMap(id => {
    const p = read.find(x => x.competencyId === id);
    return p && UUID.test(id) ? [{ competencyId: id, frameworkId: bounded(p.frameworkId, 36), frameworkCode: bounded(p.frameworkCode, 60), frameworkVersion: bounded(p.frameworkVersion, 40), contentHash: bounded(p.contentHash, 64) }] : [];
  });
  return out.length ? out : null;
}

const jsonBytes = (r: AttemptSnapshotRow) => bytes(r.presented) + bytes(r.response) + bytes(r.answerKey) + (r.rubric ? bytes(r.rubric) : 0) + (r.feedback ? bytes(r.feedback) : 0);

/** Pure. Within the 791 size CHECK: the feedback goes first, then the rubric detail (its hash stays), then long text is cut. */
export function fitSnapshot(row: AttemptSnapshotRow): AttemptSnapshotRow | null {
  const r: AttemptSnapshotRow = { ...row, presented: { ...row.presented }, response: { ...row.response }, answerKey: { ...row.answerKey } };
  const steps: (() => void)[] = [
    () => { r.feedback = null; },
    () => { r.rubric = null; },
    () => { if (typeof r.response.text === "string") r.response.text = cut(r.response.text, 1000); if (Array.isArray(r.response.texts)) r.response.texts = (r.response.texts as unknown[]).map(x => cut(x, 400)); },
    () => { r.answerKey.rationale = cut(r.answerKey.rationale, 300); },
    () => { r.presented.options = r.presented.options.map(o => ({ ...o, text: cut(o.text, 150) })); if (r.presented.choices) r.presented.choices = r.presented.choices.map(o => ({ ...o, text: cut(o.text, 150) })); },
    () => { r.presented.stem = cut(r.presented.stem, 600); },
  ];
  for (const s of steps) { if (jsonBytes(r) <= SNAPSHOT_TOTAL_MAX_BYTES) return r; s(); }
  return jsonBytes(r) <= SNAPSHOT_TOTAL_MAX_BYTES ? r : null;
}

/** Pure. Whether the live question is no longer the one the attempt was assessed against. */
export const questionChanged = (q: Parameters<typeof contentHashOf>[0], s: Pick<AttemptSnapshotRow, "contentHash"> | null): boolean => !!s && s.contentHash !== contentHashOf(q);

/**
 * Pure. A COPY of the live row reading as it did when answered: the stem, the options back in their original order, the key
 * of a choice question and the rationale. The 416 marking guide is laid over by rubric-snapshot.ts applySnapshot as before.
 */
export function applyAssessedSnapshot<T extends QuestionRow>(q: T, s: AttemptSnapshotRow | null): T {
  if (!s || !questionChanged(q, s)) return q;
  const opts = [...s.presented.options].sort((x, y) => x.i - y.i).map(o => o.text);
  const key = s.answerKey as { kind?: string; original?: unknown; rationale?: unknown; stages?: unknown };
  // CE-05: a scenario read as it was answered: its stages come back from the snapshot (only where they are a sound scenario).
  const stages = Array.isArray(key.stages) && scenarioSpecOf({ format: "scenario", stages: key.stages }) ? key.stages : null;
  const answer = stages && q.answer && typeof q.answer === "object" ? { ...(q.answer as Record<string, unknown>), stages } : q.answer;
  return {
    ...q, answer, stem: s.presented.stem || q.stem, options: opts.length ? opts : q.options,
    correctIndex: key.kind === "choice" && Number.isInteger(key.original) ? key.original as number : q.correctIndex,
    rationale: typeof key.rationale === "string" ? key.rationale : q.rationale,
  };
}

/** Pure. The effective result: the latest correction (created_at, then id), else the original. */
export function effectiveResult(original: { score: number | null; outcome: Outcome }, corrections: readonly CorrectionRow[]): { score: number | null; outcome: Outcome; correct: boolean; corrected: CorrectionRow | null } {
  const latest = [...corrections].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)).at(-1) ?? null;
  const r = latest ? { score: latest.correctedScore, outcome: latest.correctedOutcome } : original;
  return { ...r, correct: r.outcome === "correct", corrected: latest };
}

// ── THE ROWS (791 columns) ──

/** Pure. A snapshot as the 791 row to insert (the store adds the caller's user_id). */
export const snapshotInsertRow = (s: AttemptSnapshotRow) => ({
  attempt_id: s.attemptId, question_id: s.questionId, question_version: s.questionVersion, content_hash: s.contentHash,
  presented: s.presented, response: s.response, answer_key: s.answerKey, rubric: s.rubric, rubric_hash: s.rubricHash, score: s.score,
  outcome: s.outcome, marking: s.marking, feedback: s.feedback, competency_ids: s.competencyIds, assessed_at: s.assessedAt,
  // 990: sent only where there is one, so an environment without the column takes the 791 row exactly as before.
  ...(s.competencyProvenance?.length ? { competency_provenance: s.competencyProvenance.map(p => ({
    competency_id: p.competencyId, framework_id: p.frameworkId, framework_code: p.frameworkCode, framework_version: p.frameworkVersion, content_hash: p.contentHash,
  })) } : {}),
});

/** Pure. A stored 990 competency_provenance read back (null where absent or not an array). */
export function provenanceFromRow(v: unknown): CompetencyProvenance[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap(x => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.competency_id === "string" && UUID.test(o.competency_id)
      ? [{ competencyId: o.competency_id, frameworkId: bounded(o.framework_id, 36), frameworkCode: bounded(o.framework_code, 60), frameworkVersion: bounded(o.framework_version, 40), contentHash: bounded(o.content_hash, 64) }] : [];
  }).slice(0, PROVENANCE_MAX);
  return out.length ? out : null;
}

const OUTCOMES: readonly Outcome[] = ["correct", "partial", "incorrect"];
const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** Pure. A stored 791 snapshot row, read back, or null when it is not one. */
export function snapshotFromRow(x: Record<string, unknown> | null | undefined): AttemptSnapshotRow | null {
  if (!x || typeof x.attempt_id !== "string" || typeof x.content_hash !== "string" || !x.presented || typeof x.presented !== "object") return null;
  const p = x.presented as Record<string, unknown>;
  const opts = (v: unknown): Opt[] => Array.isArray(v) ? v.filter(o => o && typeof (o as Opt).text === "string" && Number.isInteger((o as Opt).i)).map(o => ({ i: (o as Opt).i, text: (o as Opt).text })) : [];
  return {
    attemptId: x.attempt_id, questionId: String(x.question_id ?? ""), questionVersion: String(x.question_version ?? ""), contentHash: x.content_hash,
    presented: { stem: typeof p.stem === "string" ? p.stem : "", options: opts(p.options), ...(Array.isArray(p.choices) ? { choices: opts(p.choices) } : {}), ...(Array.isArray(p.parts) ? { parts: (p.parts as unknown[]).filter((s): s is string => typeof s === "string") } : {}) },
    response: (x.response && typeof x.response === "object" ? x.response : {}) as Record<string, unknown>,
    answerKey: (x.answer_key && typeof x.answer_key === "object" ? x.answer_key : {}) as Record<string, unknown>,
    rubric: (x.rubric && typeof x.rubric === "object" ? x.rubric : null) as RubricSnapshot | null, rubricHash: typeof x.rubric_hash === "string" ? x.rubric_hash : null,
    score: num(x.score), outcome: OUTCOMES.includes(x.outcome as Outcome) ? x.outcome as Outcome : "incorrect", marking: String(x.marking ?? "deterministic"),
    feedback: (x.feedback && typeof x.feedback === "object" ? x.feedback : null) as Record<string, unknown> | null,
    competencyIds: Array.isArray(x.competency_ids) ? (x.competency_ids as unknown[]).filter((s): s is string => typeof s === "string") : [], assessedAt: String(x.assessed_at ?? ""),
    competencyProvenance: provenanceFromRow(x.competency_provenance),
  };
}

/** Pure. A stored 791 correction row, read back, or null. */
export function correctionFromRow(x: Record<string, unknown> | null | undefined): CorrectionRow | null {
  if (!x || typeof x.id !== "string" || typeof x.attempt_id !== "string" || !OUTCOMES.includes(x.corrected_outcome as Outcome)) return null;
  return {
    id: x.id, attemptId: x.attempt_id, previousScore: num(x.previous_score), previousOutcome: OUTCOMES.includes(x.previous_outcome as Outcome) ? x.previous_outcome as Outcome : "incorrect",
    correctedScore: num(x.corrected_score), correctedOutcome: x.corrected_outcome as Outcome, reason: String(x.reason ?? ""),
    basis: CORRECTION_BASES.includes(x.basis as CorrectionBasis) ? x.basis as CorrectionBasis : "other",
    correctedByKind: x.corrected_by_kind === "hq_actor" ? "hq_actor" : "system_rule", createdAt: String(x.created_at ?? ""),
  };
}

/** What feedback shown again knows about an attempt beyond its own row (791). */
export type AttemptIntegrity = { snapshot: AttemptSnapshotRow | null; corrections: CorrectionRow[] };
