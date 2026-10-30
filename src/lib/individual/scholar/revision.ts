// ── STAGE 4: REVISION -- THE RULES ── COMPETEN-SCHOLAR-REVISION-01 (owner GO 2026-10-24) ─────────────────────────
//
// Pure: no I/O and no clock of its own, so every rule here is tested by being run. The store reads and writes the
// rows (migrations 372, 388, 391, 416, 417), generation.ts writes questions, and the routes put them together.
//
// ⚠ REUSE, NOT DUPLICATION. A revision question IS an individual_scholar_question; an answer IS an attempt; spaced
// review IS the 372 card on the shared SM-2 (src/lib/delivery/reinforcement.ts) with the 391 review log. Nothing here
// is a second question bank, scheduler or history.
// ⚠ ANSWERS STAY ON THE SERVER. learnerItem() is the only projection of a question a browser receives before it is
// answered: no key, no rationale, no source quote. feedbackOf() is what it receives after.
// ⚠ MARKED BY CODE WHERE CODE CAN. Every kind but a short answer that matches no accepted answer is marked
// deterministically. That one is AI evaluation (labelled) or the student's own judgement (labelled), never guessed.
// ⚠ FORMATIVE. Nothing here is assessment, mastery or competence. Mock practice is practice.

import { createHash } from "node:crypto";
import { sm2 } from "@/lib/delivery/reinforcement";
import type { Insufficient, NotMeasured } from "@/lib/competency/progress-model";
import { REVISION_GENERATION_CALLS_MAX, type RevisionDifficulty, type RevisionFormat, type RevisionMode } from "./config";
import { findPatientIdentifiers } from "./extract";
import { textGroundingViolations } from "@/lib/ai/grounding";
import type { Passage } from "./generation";
import {
  asksQuestion, difficultyFits, difficultyOf, distractorProblem, flashcardFrontAsks, keyConsistent, parseRubric, referenceGrounding, stemKey,
  type GenerationDifficulty, type PromptReference,
} from "./question-intel";

const groundingViolations = textGroundingViolations;
const normaliseAnswer = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Pure. A short answer marked by code: true on a match with an accepted answer (normalised), null when code cannot
 * tell. Never false: a short answer can be right in other words, so "no match" is not "wrong".
 */
export function markShortAnswer(answer: string, accepted: readonly string[]): true | null {
  const a = normaliseAnswer(answer);
  return a && accepted.some(x => normaliseAnswer(x) === a) ? true : null;
}

export type RevisionKind = RevisionFormat | "case";

/** The parts of a stored question the rules need. QuestionRow (store.ts) is one. */
export type RevisionQuestion = {
  id: string; kind: RevisionKind; stem: string; options: string[]; correctIndex: number | null; answer: unknown;
  rationale: string; difficulty: number | null;
};

// ── THE KEY OF EACH KIND (migration 416 `answer`) ──

export type Key =
  | { kind: "choice"; index: number } | { kind: "set"; indexes: number[] } | { kind: "accepted"; answers: string[] }
  | { kind: "back"; text: string } | { kind: "matches"; matches: string[] } | { kind: "order"; order: number[] };

const nums = (v: unknown): number[] | null => (Array.isArray(v) && v.every(n => Number.isInteger(n)) ? (v as number[]) : null);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every(s => typeof s === "string") ? (v as string[]) : null);

/** Pure. A question's key, or null when the stored row does not carry a sound one (it is then not offered). */
export function keyOf(q: RevisionQuestion): Key | null {
  const a = (q.answer ?? {}) as Record<string, unknown>;
  switch (q.kind) {
    case "mcq": case "case": return q.correctIndex !== null && q.correctIndex >= 0 && q.correctIndex < q.options.length ? { kind: "choice", index: q.correctIndex } : null;
    case "mrq": { const c = nums(a.correct); return c && c.length && c.every(i => i >= 0 && i < q.options.length) ? { kind: "set", indexes: [...new Set(c)].sort() } : null; }
    case "short": { const c = strs(a.accepted); return c && c.length ? { kind: "accepted", answers: c } : null; }
    case "flashcard": return typeof a.back === "string" && a.back ? { kind: "back", text: a.back } : null;
    case "match": { const c = strs(a.matches); return c && c.length === q.options.length ? { kind: "matches", matches: c } : null; }
    case "sequence": { const c = nums(a.order); return c && c.length === q.options.length && new Set(c).size === c.length && c.every(i => i >= 0 && i < c.length) ? { kind: "order", order: c } : null; }
  }
}

/** Pure. The key in words, for the reveal after answering and for a review card. */
export function answerText(q: RevisionQuestion): string {
  const k = keyOf(q);
  if (!k) return "";
  switch (k.kind) {
    case "choice": return q.options[k.index];
    case "set": return k.indexes.map(i => q.options[i]).join("; ");
    case "accepted": return k.answers.length > 1 ? `${k.answers[0]} (also accepted: ${k.answers.slice(1).join("; ")})` : k.answers[0];
    case "back": return k.text;
    case "matches": return q.options.map((p, i) => `${p} → ${k.matches[i]}`).join("; ");
    case "order": return k.order.map(i => q.options[i]).join(" → ");
  }
}

// ── WHAT A BROWSER SEES ──

export type LearnerItem = {
  id: string; kind: RevisionKind; stem: string; difficulty: number | null;
  /** mcq, case, mrq: the options. sequence: the steps, in the stored (shuffled) order. match: the prompts. */
  options: string[];
  /** match only: the items to match, shuffled. */
  choices?: string[];
};

/** A deterministic shuffle by seed. Stable for one question, so a resumed session shows the same order. */
export function seededOrder(n: number, seed: string): number[] {
  const idx = [...Array(n).keys()];
  const h = createHash("sha256").update(seed).digest();
  for (let i = n - 1; i > 0; i--) { const j = h[i % h.length] % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  // Never the identity for three or more (it would give the order away): rotate by one.
  return n >= 3 && idx.every((v, i) => v === i) ? [...idx.slice(1), idx[0]] : idx;
}

/** Pure. The only projection of an unanswered question a browser receives: no key, rationale or source quote. */
export function learnerItem(q: RevisionQuestion): LearnerItem {
  const base = { id: q.id, kind: q.kind, stem: q.stem, difficulty: q.difficulty, options: ["mcq", "case", "mrq", "match", "sequence"].includes(q.kind) ? [...q.options] : [] };
  if (q.kind === "match") {
    const k = keyOf(q);
    const m = k?.kind === "matches" ? k.matches : [];
    return { ...base, choices: seededOrder(m.length, `${q.id}:choices`).map(i => m[i]) };
  }
  return base;
}

// ── AN ANSWER, AND HOW IT IS MARKED ──

export type Response =
  | { kind: "choice"; index: number } | { kind: "set"; indexes: number[] } | { kind: "text"; text: string }
  | { kind: "recall"; quality: number } | { kind: "matches"; matches: string[] } | { kind: "order"; order: number[] };

/** Pure. The answer a body carries for this question's kind, bounded, or null. */
export function parseResponse(q: RevisionQuestion, raw: unknown): Response | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = q.options.length;
  switch (q.kind) {
    case "mcq": case "case": return Number.isInteger(r.index) && (r.index as number) >= 0 && (r.index as number) < n ? { kind: "choice", index: r.index as number } : null;
    case "mrq": { const c = nums(r.indexes); return c && c.length <= n && c.every(i => i >= 0 && i < n) ? { kind: "set", indexes: [...new Set(c)].sort() } : null; }
    case "short": return typeof r.text === "string" && r.text.trim() && r.text.length <= 1000 ? { kind: "text", text: r.text.trim() } : null;
    case "flashcard": return Number.isInteger(r.quality) && (r.quality as number) >= 0 && (r.quality as number) <= 5 ? { kind: "recall", quality: r.quality as number } : null;
    case "match": { const c = strs(r.matches); return c && c.length === n && c.every(s => s.length <= 500) ? { kind: "matches", matches: c } : null; }
    case "sequence": { const c = nums(r.order); return c && c.length === n && new Set(c).size === n && c.every(i => i >= 0 && i < n) ? { kind: "order", order: c } : null; }
  }
}

export type Mark = { correct: boolean; score: number; marking: "deterministic" | "self_graded" } | { needsJudgement: true };

/**
 * Pure. Deterministic marking. A short answer that matches no accepted answer is not marked here: code cannot tell,
 * so it needs AI evaluation or the student's own judgement. A flashcard is the student's own recall grade.
 */
export function markResponse(q: RevisionQuestion, r: Response): Mark {
  const k = keyOf(q);
  if (!k) return { correct: false, score: 0, marking: "deterministic" };
  if (k.kind === "choice" && r.kind === "choice") return { correct: r.index === k.index, score: r.index === k.index ? 1 : 0, marking: "deterministic" };
  if (k.kind === "set" && r.kind === "set") {
    const hits = r.indexes.filter(i => k.indexes.includes(i)).length, wrong = r.indexes.length - hits;
    const correct = hits === k.indexes.length && wrong === 0;
    return { correct, score: Math.max(0, (hits - wrong) / k.indexes.length), marking: "deterministic" };
  }
  if (k.kind === "accepted" && r.kind === "text") return markShortAnswer(r.text, k.answers) ? { correct: true, score: 1, marking: "deterministic" } : { needsJudgement: true };
  if (k.kind === "back" && r.kind === "recall") return { correct: r.quality >= 3, score: r.quality / 5, marking: "self_graded" };
  if (k.kind === "matches" && r.kind === "matches") {
    const right = r.matches.filter((m, i) => m === k.matches[i]).length;
    return { correct: right === k.matches.length, score: right / k.matches.length, marking: "deterministic" };
  }
  if (k.kind === "order" && r.kind === "order") {
    const right = r.order.filter((v, i) => v === k.order[i]).length;
    return { correct: right === k.order.length, score: right / k.order.length, marking: "deterministic" };
  }
  return { correct: false, score: 0, marking: "deterministic" };
}

/** Pure. What an answer is stored as (migration 416): a single choice in chosen_index, everything else in response. */
export function storedResponse(r: Response): { chosenIndex: number | null; response: Record<string, unknown> | null } {
  if (r.kind === "choice") return { chosenIndex: r.index, response: null };
  const { kind, ...rest } = r;
  return { chosenIndex: null, response: { kind, ...rest } };
}

// ── NEW QUESTIONS FROM A PASSAGE: THE CHECKS (generation.ts writes them) ──

export type RevisionDraft = { stem: string; options: string[]; answer: Record<string, unknown>; rationale: string; sourceQuote: string; difficulty: 1 | 2 | 3 };
export type DraftReason =
  | "malformed" | "quote_not_in_passage" | "ungrounded" | "identifier" | "duplicate"
  // SCHOLAR-QUESTION-INTELLIGENCE-01: it asks nothing, repeats a stored question, has give-away options, its key and
  // explanation disagree, or it is not the difficulty asked for.
  | "not_a_question" | "repeat" | "weak_distractors" | "inconsistent" | "off_difficulty";

/** What a revision item is checked against besides its passage. All optional: none is the 416 check exactly. */
export type DraftChecks = {
  /** stemKey of the questions already stored for this material: a repeat is not stored again. */
  existing?: ReadonlySet<string>;
  /** The difficulty asked for. */
  difficulty?: GenerationDifficulty | null;
  /** Mode notes_and_references: the references the item may draw on, and their text as extra grounding. */
  references?: readonly PromptReference[];
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/**
 * Pure. One AI-written item checked like a practice question: well formed for its kind, its quote really in the
 * passage, and nothing anywhere in it -- stem, options, key, rationale -- that the passage does not hold, and nothing
 * that identifies a patient. A sequence is stored shuffled, with the order as its key.
 * SCHOLAR-QUESTION-INTELLIGENCE-01: then it must ask (a flashcard front a question or a short term, never a
 * statement), not repeat a stored stem, have real distractors, a key its explanation supports, and the difficulty
 * asked for. Its rubric (question-intel.ts) is stored with its key.
 */
export function checkRevisionDraft(kind: Exclude<RevisionFormat, "mcq">, raw: unknown, passage: Passage, checks: DraftChecks = {}): { ok: true; draft: RevisionDraft } | { ok: false; reason: DraftReason } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const quote = text(r.sourceQuote, 500);
  const difficulty = difficultyOf(r);
  let d: RevisionDraft | null = null;
  if (kind === "mrq") {
    const stem = text(r.stem, 400), options = strs(r.options)?.map(o => o.trim()), correct = nums(r.correct), rationale = text(r.rationale, 1200);
    if (stem && options && options.length >= 4 && options.length <= 6 && options.every(o => o && o.length <= 200) && correct && correct.length >= 1
      && correct.length < options.length && correct.every(i => i >= 0 && i < options.length) && rationale && quote) {
      if (new Set(options.map(norm)).size !== options.length) return { ok: false, reason: "duplicate" };
      d = { stem, options, answer: { correct: [...new Set(correct)].sort() }, rationale, sourceQuote: quote, difficulty };
    }
  } else if (kind === "short") {
    const stem = text(r.stem, 400), accepted = strs(r.accepted)?.map(a => a.trim()).filter(Boolean), rationale = text(r.rationale, 1200);
    if (stem && accepted && accepted.length >= 1 && accepted.length <= 8 && accepted.every(a => a.length <= 200) && rationale && quote)
      d = { stem, options: [], answer: { accepted: [...new Set(accepted)] }, rationale, sourceQuote: quote, difficulty };
  } else if (kind === "flashcard") {
    const front = text(r.front, 300), back = text(r.back, 600);
    if (front && back && quote) d = { stem: front, options: [], answer: { back }, rationale: text(r.rationale, 1200) ?? back, sourceQuote: quote, difficulty };
  } else if (kind === "match") {
    const stem = text(r.stem, 400), rationale = text(r.rationale, 1200);
    const pairs = Array.isArray(r.pairs) ? (r.pairs as unknown[]).map(p => { const x = (p ?? {}) as Record<string, unknown>; return { left: text(x.left, 200), right: text(x.right, 200) }; }) : null;
    if (stem && rationale && quote && pairs && pairs.length >= 3 && pairs.length <= 6 && pairs.every(p => p.left && p.right)) {
      if (new Set(pairs.map(p => norm(p.left!))).size !== pairs.length || new Set(pairs.map(p => norm(p.right!))).size !== pairs.length) return { ok: false, reason: "duplicate" };
      d = { stem, options: pairs.map(p => p.left!), answer: { matches: pairs.map(p => p.right!) }, rationale, sourceQuote: quote, difficulty };
    }
  } else if (kind === "sequence") {
    const stem = text(r.stem, 400), rationale = text(r.rationale, 1200), steps = strs(r.steps)?.map(s => s.trim());
    if (stem && rationale && quote && steps && steps.length >= 3 && steps.length <= 6 && steps.every(s => s && s.length <= 200)) {
      if (new Set(steps.map(norm)).size !== steps.length) return { ok: false, reason: "duplicate" };
      // Stored shuffled: options[order[k]] is the k-th step.
      const shown = seededOrder(steps.length, `${stem}:${steps.join("|")}`);
      const options = shown.map(i => steps[i]);
      d = { stem, options, answer: { order: steps.map(s => options.indexOf(s)) }, rationale, sourceQuote: quote, difficulty };
    }
  }
  if (!d) return { ok: false, reason: "malformed" };
  if (!norm(passage.content).includes(norm(d.sourceQuote))) return { ok: false, reason: "quote_not_in_passage" };
  const all = [d.stem, ...d.options, ...Object.values(d.answer).flatMap(v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : typeof v === "string" ? [v] : [])), d.rationale].join("\n");
  if (findPatientIdentifiers(all).length) return { ok: false, reason: "identifier" };
  const grounding = [passage.content, ...referenceGrounding(checks.references ?? [])];
  if (groundingViolations(all, grounding).length) return { ok: false, reason: "ungrounded" };

  // ── SCHOLAR-QUESTION-INTELLIGENCE-01: the item asks, is new, has real distractors, agrees with itself ──
  if (kind === "flashcard" ? !flashcardFrontAsks(d.stem) : kind !== "match" && !asksQuestion(d.stem)) return { ok: false, reason: "not_a_question" };
  if (checks.existing?.has(stemKey(d.stem))) return { ok: false, reason: "repeat" };
  if (kind === "mrq" && distractorProblem(d.options)) return { ok: false, reason: "weak_distractors" };
  const expected = expectedOf(kind, d);
  if (kind !== "match" && kind !== "sequence" && !keyConsistent(expected, `${d.rationale}\n${d.stem}`, d.sourceQuote)) return { ok: false, reason: "inconsistent" };
  if (!difficultyFits(d.difficulty, checks.difficulty ?? null)) return { ok: false, reason: "off_difficulty" };
  const rubric = parseRubric(r, grounding, {
    expectedAnswer: expected || null, accepted: kind === "short" ? (d.answer.accepted as string[]) : [], difficulty: d.difficulty, references: checks.references,
  });
  return { ok: true, draft: { ...d, answer: { ...d.answer, rubric } } };
}

/** The answer an item expects, in words: what its rubric records and its consistency check reads. */
function expectedOf(kind: Exclude<RevisionFormat, "mcq">, d: RevisionDraft): string {
  const a = d.answer as Record<string, unknown>;
  if (kind === "short") return String((a.accepted as string[])[0] ?? "");
  if (kind === "flashcard") return String(a.back ?? "");
  if (kind === "mrq") return (a.correct as number[]).map(i => d.options[i]).join("; ");
  if (kind === "match") return d.options.map((o, i) => `${o}: ${(a.matches as string[])[i]}`).join("; ");
  return (a.order as number[]).map(i => d.options[i]).join("; ");
}

// ── WHICH QUESTIONS A SESSION OFFERS ──

export type PoolItem = {
  id: string; kind: RevisionKind; difficulty: number | null; chunkId: string; createdAt: string;
  latestCorrect: boolean | null; misses: number; lastAnsweredAt: string | null; due: boolean;
};

const DIFFICULTY_LEVEL: Record<Exclude<RevisionDifficulty, "any">, number> = { easy: 1, standard: 2, harder: 3 };
/** The modes that may write new questions for a shortfall. Spaced, weak and a saved set never do. */
export const GENERATING_MODES: readonly RevisionMode[] = ["today", "quick", "mock", "flashcards"];

/** Pure. Items interleaved by format, in their given order within a format, the format seen first leading. */
const byFormat = (xs: readonly PoolItem[]): PoolItem[] => {
  const lanes = [...new Set(xs.map(p => p.kind))].map(k => xs.filter(p => p.kind === k));
  const out: PoolItem[] = [];
  for (let i = 0; lanes.some(l => i < l.length); i++) for (const l of lanes) if (i < l.length) out.push(l[i]);
  return out;
};

/**
 * Pure. The questions a session offers, in order, and how many it is short. Deterministic for a seed. Questions of a
 * format the session does not offer are left out; a difficulty is preferred, then filled from the rest.
 */
export function pickQuestions(input: { mode: RevisionMode; pool: readonly PoolItem[]; quantity: number; formats: readonly RevisionKind[]; difficulty: RevisionDifficulty; seed: string }): { ids: string[]; shortfall: number } {
  const formats = input.mode === "flashcards" ? ["flashcard"] : input.formats;
  let pool = input.pool.filter(p => formats.includes(p.kind));
  const level = input.difficulty === "any" ? null : DIFFICULTY_LEVEL[input.difficulty];
  const fits = (p: PoolItem) => level === null || (p.difficulty ?? 2) === level;
  const stable = (xs: PoolItem[]) => [...xs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const weak = (p: PoolItem) => p.latestCorrect === false || p.misses > 0;
  let ordered: PoolItem[];
  switch (input.mode) {
    case "spaced": ordered = stable(pool.filter(p => p.due)); break;
    case "weak": ordered = [...pool.filter(weak)].sort((a, b) => b.misses - a.misses || Number(a.latestCorrect) - Number(b.latestCorrect) || a.id.localeCompare(b.id)); break;
    case "flashcards": ordered = [...stable(pool.filter(p => p.due)), ...stable(pool.filter(p => !p.due && p.lastAnsweredAt === null)), ...stable(pool.filter(p => !p.due && p.lastAnsweredAt !== null))]; break;
    case "today": {
      // SQIE fix D-6: new questions interleaved by format (oldest format first), so a session asked for two formats
      // is not filled by whichever format happened to be written first.
      const due = stable(pool.filter(p => p.due)), hard = stable(pool.filter(p => !p.due && weak(p))), fresh = byFormat(stable(pool.filter(p => !p.due && !weak(p) && p.lastAnsweredAt === null)));
      const rest = [...pool.filter(p => !p.due && !weak(p) && p.lastAnsweredAt !== null)].sort((a, b) => (a.lastAnsweredAt ?? "").localeCompare(b.lastAnsweredAt ?? ""));
      ordered = [...due, ...hard, ...fresh, ...rest]; break;
    }
    default: {
      // quick, mock, custom: what has not been seen first, then what was seen longest ago, the formats interleaved.
      const byAge = [...stable(pool.filter(p => p.lastAnsweredAt === null)), ...[...pool.filter(p => p.lastAnsweredAt !== null)].sort((a, b) => (a.lastAnsweredAt ?? "").localeCompare(b.lastAnsweredAt ?? ""))];
      const lanes = formats.map(f => byAge.filter(p => p.kind === f)).filter(l => l.length);
      ordered = [];
      for (let i = 0; lanes.some(l => i < l.length); i++) for (const l of lanes) if (i < l.length) ordered.push(l[i]);
      if (input.mode === "mock") ordered = seededOrder(ordered.length, input.seed).map(i => ordered[i]);
    }
  }
  pool = ordered;
  const preferred = [...pool.filter(fits), ...pool.filter(p => !fits(p))];
  const ids = preferred.slice(0, input.quantity).map(p => p.id);
  return { ids, shortfall: GENERATING_MODES.includes(input.mode) ? Math.max(0, input.quantity - ids.length) : 0 };
}

/**
 * Pure. Which new questions to write for a shortfall: round-robin over the scope's sections and the formats, at most
 * three items a call and REVISION_GENERATION_CALLS_MAX calls, never a section and format that already has questions
 * at this prompt version (identical content is not written twice).
 */
export function planGeneration(input: { shortfall: number; chunkIds: readonly string[]; formats: readonly RevisionFormat[]; existing: ReadonlySet<string>; perCall?: number }): { chunkId: string; kind: RevisionFormat; count: number }[] {
  const per = input.perCall ?? 3;
  // Every section and format once, interleaved so consecutive calls differ in both.
  const pairs: { chunkId: string; kind: RevisionFormat }[] = [];
  const n = input.chunkIds.length;
  for (let c = 0; c < n; c++) for (let f = 0; f < input.formats.length; f++) pairs.push({ chunkId: input.chunkIds[(c + f) % n], kind: input.formats[f] });
  const fresh = pairs.filter(p => !input.existing.has(`${p.chunkId}|${p.kind}`));
  const out: { chunkId: string; kind: RevisionFormat; count: number }[] = [];
  let left = input.shortfall;
  // SQIE fix D-6: the shortfall is SHARED across the asked formats. Before, the first format took the whole of a
  // small shortfall (three items), so "short answer and multiple choice" for three questions never wrote a multiple
  // choice item at all. A format with no call yet takes only its share of what is left.
  const planned = new Set<RevisionFormat>();
  for (const p of fresh) {
    if (left <= 0 || out.length >= REVISION_GENERATION_CALLS_MAX) break;
    const waiting = new Set(fresh.filter(x => !planned.has(x.kind)).map(x => x.kind)).size;
    const share = planned.has(p.kind) ? left : Math.ceil(left / Math.max(1, waiting));
    const count = Math.min(per, left, share);
    out.push({ ...p, count }); left -= count; planned.add(p.kind);
  }
  return out;
}

// ── SPACED REVIEW: THE SHARED SM-2, WITH THE POLICY'S BOUNDS ──

export type SrsParams = { masteryReps: number; masteryDays: number; maxIntervalDays: number; harderIntervalPercent: number };
export const SRS_DEFAULTS: SrsParams = { masteryReps: 5, masteryDays: 60, maxIntervalDays: 3650, harderIntervalPercent: 100 };

/** Pure. SM-2 itself, then the policy's bounds: a harder question's interval shortened, the longest interval capped. */
export function scheduleReview(prev: { ease: number; interval: number; reps: number }, quality: number, difficulty: number | null, p: SrsParams) {
  const next = sm2(prev, quality);
  const scaled = difficulty === 3 ? Math.max(1, Math.round(next.interval * p.harderIntervalPercent / 100)) : next.interval;
  const interval = Math.min(p.maxIntervalDays, scaled);
  return { ...next, interval, status: next.reps >= p.masteryReps && interval >= p.masteryDays ? ("mastered" as const) : ("active" as const) };
}

// ── R5: REVISION INTELLIGENCE ── measured, or why not; never a competence ──

export type RAttempt = { questionId: string; correct: boolean; answeredAt: string; marking: string; sessionId: string | null };
export type RQuestion = { id: string; stem: string; kind: RevisionKind; chunkId: string; materialId: string; competencyId: string | null };
export type RReview = { quality: number; reviewedAt: string; materialId: string };
export type RCard = { nextReviewAt: string; status: "active" | "mastered" };

export type RevisionInsights = {
  due: number; upcoming7: number;
  completedReviews: { state: "measured"; reviews: number; windowDays: number } | NotMeasured;
  recall: { state: "measured"; reviews: number; recalledShare: number; windowDays: number } | Insufficient | NotMeasured;
  retention: { state: "measured"; weeks: { weekStart: string; reviews: number; recalledShare: number | null }[] } | Insufficient | NotMeasured;
  repeatedDifficulties: { questionId: string; stem: string; misses: number; chunkId: string; materialId: string }[];
  coverage: { revised: number; of: number; untouched: { id: string; title: string }[] };
  competencyActivity: { competencyId: string; answered: number }[];
  /** Answers in revision sessions, and how many were marked by code, by self-grading and by AI evaluation. */
  marking: { deterministic: number; self_graded: number; ai_evaluation: number };
  recommendations: { id: string; title: string; reason: string; action: { mode: RevisionMode } | { learnSection: string } }[];
};

const weekStart = (day: string) => { const d = new Date(`${day}T00:00:00Z`); const wd = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - wd * 864e5).toISOString().slice(0, 10); };

/**
 * Pure. Tracked separately, never blended: what is due, reviews done, recall over time (391), questions missed again
 * and again, which materials revision has touched, revision activity per competency (practised, never achieved), and
 * how answers were marked. Recommendations come from those figures only, each with its reason.
 */
export function buildRevisionInsights(input: {
  today: string; windowDays: number; minAnswers: number;
  attempts: readonly RAttempt[]; questions: readonly RQuestion[]; reviews: readonly RReview[] | null; cards: readonly RCard[];
  materials: readonly { id: string; title: string }[];
}): RevisionInsights {
  const { today } = input;
  const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const active = input.cards.filter(c => c.status === "active");
  const due = active.filter(c => c.nextReviewAt <= today).length;
  const upcoming7 = active.filter(c => c.nextReviewAt > today && c.nextReviewAt <= plus(7)).length;
  const since = plus(-input.windowDays);
  let completedReviews: RevisionInsights["completedReviews"], recall: RevisionInsights["recall"], retention: RevisionInsights["retention"];
  if (input.reviews === null) {
    const why: NotMeasured = { state: "not_measured", reason: "The review history is not installed on this environment." };
    completedReviews = why; recall = why; retention = why;
  } else {
    const inWindow = input.reviews.filter(r => r.reviewedAt.slice(0, 10) > since);
    completedReviews = { state: "measured", reviews: inWindow.length, windowDays: input.windowDays };
    recall = inWindow.length >= input.minAnswers
      ? { state: "measured", reviews: inWindow.length, recalledShare: Math.round((inWindow.filter(r => r.quality >= 3).length / inWindow.length) * 100), windowDays: input.windowDays }
      : inWindow.length ? { state: "insufficient", have: inWindow.length, need: input.minAnswers, reason: "Too few reviews in the window to say how recall is going." }
        : { state: "not_measured", reason: "No reviews in the window yet." };
    const weeks = [...Array(6).keys()].map(i => weekStart(plus(-7 * (5 - i))));
    const byWeek = weeks.map(w => { const rs = input.reviews!.filter(r => weekStart(r.reviewedAt.slice(0, 10)) === w); return { weekStart: w, reviews: rs.length, recalledShare: rs.length ? Math.round((rs.filter(r => r.quality >= 3).length / rs.length) * 100) : null }; });
    const total = byWeek.reduce((n, w) => n + w.reviews, 0);
    retention = total >= input.minAnswers ? { state: "measured", weeks: byWeek }
      : total ? { state: "insufficient", have: total, need: input.minAnswers, reason: "Too few reviews over six weeks to show a trend." }
        : { state: "not_measured", reason: "No reviews in the last six weeks." };
  }
  const q = new Map(input.questions.map(x => [x.id, x]));
  const misses = new Map<string, number>();
  for (const a of input.attempts) if (!a.correct) misses.set(a.questionId, (misses.get(a.questionId) ?? 0) + 1);
  const repeatedDifficulties = [...misses].filter(([id, n]) => n >= 2 && q.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ questionId: id, stem: q.get(id)!.stem, misses: n, chunkId: q.get(id)!.chunkId, materialId: q.get(id)!.materialId }));
  const revisedMaterials = new Set(input.attempts.map(a => q.get(a.questionId)?.materialId).filter((x): x is string => !!x));
  for (const r of input.reviews ?? []) revisedMaterials.add(r.materialId);
  const untouched = input.materials.filter(m => !revisedMaterials.has(m.id));
  const perComp = new Map<string, number>();
  for (const a of input.attempts) { const c = q.get(a.questionId)?.competencyId; if (c) perComp.set(c, (perComp.get(c) ?? 0) + 1); }
  const marking = { deterministic: 0, self_graded: 0, ai_evaluation: 0 };
  for (const a of input.attempts) if (a.sessionId && a.marking in marking) marking[a.marking as keyof typeof marking]++;
  const recommendations: RevisionInsights["recommendations"] = [];
  if (due) recommendations.push({ id: "due", title: `Review the ${due} card${due === 1 ? "" : "s"} due today`, reason: "Reviewing on time is what keeps them in memory.", action: { mode: "spaced" } });
  if (repeatedDifficulties[0]) recommendations.push({ id: "difficult", title: "Go over what you keep missing", reason: `You have missed "${repeatedDifficulties[0].stem.slice(0, 80)}" ${repeatedDifficulties[0].misses} times. Teach me goes through that part of your notes again.`, action: { learnSection: repeatedDifficulties[0].chunkId } });
  if (misses.size) recommendations.push({ id: "weak", title: "Practise your weak areas", reason: `${misses.size} question${misses.size === 1 ? "" : "s"} you answered wrongly at least once.`, action: { mode: "weak" } });
  if (untouched.length && input.materials.length) recommendations.push({ id: "untouched", title: `Revise ${untouched[0].title}`, reason: `${untouched.length} of your ${input.materials.length} materials have not been revised yet.`, action: { mode: "quick" } });
  return {
    due, upcoming7, completedReviews, recall, retention, repeatedDifficulties,
    coverage: { revised: input.materials.length - untouched.length, of: input.materials.length, untouched: untouched.slice(0, 5) },
    competencyActivity: [...perComp].map(([competencyId, answered]) => ({ competencyId, answered })).sort((a, b) => b.answered - a.answered),
    marking, recommendations,
  };
}
