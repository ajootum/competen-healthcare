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
//   provenanceOf           SQIE WS-D (990): per competency id, the competency_content_hash, the framework and its version
//                          at answer time (framework_competencies rows are edited in place, so an id alone pins nothing).
//
// ⚠ FORMATIVE. A snapshot or a correction is a record of a private practice attempt, never competence or a Passport record.
// ⚠ The 416 CHECK is unchanged: a choice attempt keeps chosen_index, and its snapshot is a separate row.

import { compactSnapshot, rubricHash, rubricSnapshotOf, type RubricSnapshot } from "./rubric-snapshot";
import { keyOf, learnerItem } from "./revision";
import { scenarioSpecOf } from "./scenario";
import type { QuestionRow } from "./store";

export const SNAPSHOT_TOTAL_MAX_BYTES = 16384;
export type Outcome = "correct" | "partial" | "incorrect";
/** A snapshot's outcome: 990 adds unmarked (an understanding check kept without a judgement). Never a correction outcome. */
export type SnapshotOutcome = Outcome | "unmarked";
/** SQIE WS-D (990): what one competency said when the answer was given. A part the server could not read is null, never guessed. */
export type CompetencyProvenance = { id: string; content_hash: string | null; framework_id: string | null; framework_version: string | null };
export type CorrectionBasis = "rubric_error" | "key_error" | "marking_error" | "other";
export const CORRECTION_BASES: readonly CorrectionBasis[] = ["rubric_error", "key_error", "marking_error", "other"];
export const CORRECTION_BASIS_LABEL: Record<CorrectionBasis, string> = {
  rubric_error: "The marking guide was wrong", key_error: "The answer key was wrong", marking_error: "The answer was marked wrongly", other: "Corrected",
};
export const QUESTION_CHANGED_NOTE = "This question has changed since you answered. What is shown here is the question, the options and the answer as they were when you answered.";

type Opt = { i: number; text: string };
export type Presented = { stem: string; options: Opt[]; choices?: Opt[]; parts?: string[] };
export type AttemptSnapshotRow = {
  attemptId: string; questionId: string; questionVersion: string; contentHash: string;
  presented: Presented; response: Record<string, unknown>; answerKey: Record<string, unknown>;
  rubric: RubricSnapshot | null; rubricHash: string | null; score: number | null; outcome: SnapshotOutcome; marking: string;
  feedback: Record<string, unknown> | null; competencyIds: string[]; assessedAt: string;
  /** 990: one entry per competencyIds entry, in order. Absent where it was not recorded (before 990, or 990 not applied). */
  competencyProvenance?: CompetencyProvenance[];
};
export type CorrectionRow = {
  id: string; attemptId: string; previousScore: number | null; previousOutcome: Outcome; correctedScore: number | null; correctedOutcome: Outcome;
  reason: string; basis: CorrectionBasis; correctedByKind: "hq_actor" | "system_rule"; createdAt: string;
};

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).length;
const cut = (s: unknown, n: number) => { const x = typeof s === "string" ? s : ""; return x.length > n ? x.slice(0, n) : x; };

/** Pure. The result as an outcome word: the same rule as migration 791's correction guard. */
export const outcomeOf = (correct: boolean, score: number | null): Outcome => (correct ? "correct" : (score ?? 0) > 0 ? "partial" : "incorrect");

/** Pure. A snapshot's outcome: an unmarked answer is unmarked (990 binds the two), never "incorrect". */
export const snapshotOutcomeOf = (marking: string, correct: boolean, score: number | null): SnapshotOutcome => (marking === "unmarked" ? "unmarked" : outcomeOf(correct, score));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MD5 = /^[0-9a-f]{32}$/;

/**
 * Pure. The 990 provenance of each competency id, in order: its competency_content_hash (32 hex), its framework and that
 * framework's version label (major.minor.revision), as read at answer time. Anything unreadable or malformed is null. At most 20.
 */
export function provenanceOf(ids: readonly string[], read: {
  hashes: ReadonlyMap<string, string>; frameworkOf: ReadonlyMap<string, string>; versionOf: ReadonlyMap<string, { major: unknown; minor: unknown; revision: unknown }>;
}): CompetencyProvenance[] {
  const part = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9999 ? String(v) : null);
  return ids.filter(id => UUID.test(id)).slice(0, 20).map(id => {
    const h = read.hashes.get(id)?.toLowerCase() ?? null, fw = read.frameworkOf.get(id) ?? null;
    const v = fw ? read.versionOf.get(fw) : undefined;
    const label = v ? [part(v.major ?? 1), part(v.minor ?? 0), part(v.revision ?? 0)] : null;
    return {
      id, content_hash: h && MD5.test(h) ? h : null, framework_id: fw && UUID.test(fw) ? fw : null,
      framework_version: fw && UUID.test(fw) && label && label.every(x => x !== null) ? label.join(".") : null,
    };
  });
}

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
  /** 990: the provenance of the question's competency (provenanceOf). Undefined: not recorded (990 absent). */
  provenance?: CompetencyProvenance[];
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
    score: a.marking === "unmarked" || a.score === null || !Number.isFinite(a.score) ? null : Math.max(0, Math.min(1, a.score)),
    outcome: snapshotOutcomeOf(a.marking, a.correct, a.score), marking: a.marking,
    feedback: formative && typeof formative === "object" && !Array.isArray(formative) ? formative as Record<string, unknown> : null,
    competencyIds: q.competencyId ? [q.competencyId] : [], assessedAt: a.answeredAt,
  };
  // 990: the provenance names exactly the snapshot's competency ids, in order (the 990 CHECK refuses anything else).
  if (a.provenance) row.competencyProvenance = row.competencyIds.map(id => a.provenance!.find(p => p.id === id) ?? { id, content_hash: null, framework_id: null, framework_version: null });
  return fitSnapshot(row);
}

const jsonBytes = (r: AttemptSnapshotRow) => bytes(r.presented) + bytes(r.response) + bytes(r.answerKey) + (r.rubric ? bytes(r.rubric) : 0) + (r.feedback ? bytes(r.feedback) : 0);

/** Pure. Within the 791 size CHECK: the feedback goes first, then the rubric detail (compact, then gone: its hash stays), then long text is cut. */
export function fitSnapshot(row: AttemptSnapshotRow): AttemptSnapshotRow | null {
  const r: AttemptSnapshotRow = { ...row, presented: { ...row.presented }, response: { ...row.response }, answerKey: { ...row.answerKey } };
  const steps: (() => void)[] = [
    () => { r.feedback = null; },
    // SQIE WS-D: the full rubric is cut to its compact form before it goes (its hash stays in rubric_hash either way).
    () => { if (r.rubric) r.rubric = compactSnapshot(r.rubric); },
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
  ...(s.competencyProvenance ? { competency_provenance: s.competencyProvenance } : {}),
});

const OUTCOMES: readonly Outcome[] = ["correct", "partial", "incorrect"];
const SNAPSHOT_OUTCOMES: readonly SnapshotOutcome[] = [...OUTCOMES, "unmarked"];
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
    score: num(x.score), outcome: SNAPSHOT_OUTCOMES.includes(x.outcome as SnapshotOutcome) ? x.outcome as SnapshotOutcome : "incorrect", marking: String(x.marking ?? "deterministic"),
    feedback: (x.feedback && typeof x.feedback === "object" ? x.feedback : null) as Record<string, unknown> | null,
    competencyIds: Array.isArray(x.competency_ids) ? (x.competency_ids as unknown[]).filter((s): s is string => typeof s === "string") : [], assessedAt: String(x.assessed_at ?? ""),
    ...(Array.isArray(x.competency_provenance) ? { competencyProvenance: (x.competency_provenance as unknown[]).filter((p): p is CompetencyProvenance => !!p && typeof (p as CompetencyProvenance).id === "string")
      .map(p => ({ id: p.id, content_hash: p.content_hash ?? null, framework_id: p.framework_id ?? null, framework_version: p.framework_version ?? null })) } : {}),
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
