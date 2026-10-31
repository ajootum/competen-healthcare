// ── ADAPTIVE EXAMS -- THE RULES ── SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026) ───────────────────────────────────
//
// Pure: no I/O, no clock of its own, no model. adaptive-service.ts reads and writes the rows; the routes put them
// together. An adaptive exam IS a revision session (417): its questions are individual_scholar_question rows, its
// answers attempts naming the session (marked by /revision/answer exactly as any revision answer), its missed items
// the 372 review cards. Its BLUEPRINT is kept in the `scope` jsonb of a revision set (417) the session names -- no new
// table. Where migration 720 lets a session say mode 'adaptive' it does; where 720 is absent the session is mode
// 'mock' and the set's scope.adaptive marker is what makes it adaptive (the report says so).
//
// ⚠ TRANSPARENT RULE-BASED ADAPTATION ONLY (owner instruction). The difficulty of the next question follows ONE stated
// rule on the student's own answers (question-intel.ts adaptDifficulty: three right in a row steps up, two of the last
// three missed steps down), and the count starts again after each change. No item is calibrated, nothing estimates an
// ability, and nothing here is a score on any scale. The report is a practice estimate and says so (ADAPTIVE_REPORT_LABEL).
// ⚠ ANSWERS STAY ON THE SERVER. Only revision-view.ts revisionItemView (revision.ts learnerItem) reaches a browser
// before an item is answered.
// ⚠ FORMATIVE. Never an examination, never verification, never competence, never Passport evidence as such.

import {
  ADAPTIVE_FORMATS, ADAPTIVE_LENGTH_MAX, ADAPTIVE_LENGTH_MIN, ADAPTIVE_REPORT_LABEL, ADAPTIVE_RULE, ADAPTIVE_TIME_LIMITS, ADAPTIVE_FALLBACK_NOTE,
  REVISION_FORMAT_LABEL, type AdaptiveFormat, type RevisionFormat,
} from "./config";
import {
  DIFFICULTY_RANGE, GENERATION_DIFFICULTIES, LEVEL_LABEL, adaptDifficulty, isGenerationDifficulty, isSourceMode,
  type CognitiveLevel, type GenerationDifficulty, type SourceMode,
} from "./question-intel";
import type { RevisionKind } from "./revision";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (v: unknown, n: number): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, n) : []);

/** Sections and competencies a blueprint keeps, at most (417 bounds the set scope at 4000 bytes). */
export const BLUEPRINT_SECTIONS_MAX = 30;
export const BLUEPRINT_COMPETENCIES_MAX = 20;
export const BLUEPRINT_LIBRARY_MAX = 12;

/** The difficulty a question is offered at, as 416 records it (1-3). An item with none counts as standard (2). */
export const LEVEL_OF: Record<GenerationDifficulty, 1 | 2 | 3> = { easy: 1, standard: 2, harder: 3 };
const DIFFICULTY_WORD: Record<GenerationDifficulty, string> = { easy: "Easier", standard: "Standard", harder: "Harder" };
export const difficultyWord = (d: GenerationDifficulty) => DIFFICULTY_WORD[d];
const levelOfItem = (d: number | null): 1 | 2 | 3 => (d === 1 || d === 3 ? d : 2);
const DIFF_OF_LEVEL: Record<1 | 2 | 3, GenerationDifficulty> = { 1: "easy", 2: "standard", 3: "harder" };

// ── THE BLUEPRINT ──

export type AdaptiveScope =
  | { kind: "programme" }
  | { kind: "library" }
  | { kind: "documents"; materialIds: string[] }
  | { kind: "topic"; topic: string }
  | { kind: "competencies"; competencyIds: string[] };

export type AdaptiveBlueprint = {
  v: 1;
  title: string;
  scope: AdaptiveScope;
  formats: AdaptiveFormat[];
  length: number;
  /** The difficulty the exam starts at, and where that came from. */
  start: GenerationDifficulty;
  startFrom: "chosen" | "programme" | "policy";
  feedback: "immediate" | "end";
  timeLimitMinutes: number | null;
  source: SourceMode;
  /** The sections the exam draws on (resolved at start), and the competencies they are linked to by ACCEPTED links. */
  sections: string[];
  competencyIds: string[];
  /** Governed library copies reused for this exam (their ids), wherever they were first filed. */
  libraryIds: string[];
  /** Generation calls made so far, against ADAPTIVE_GENERATION_CALLS_MAX. */
  calls: number;
  /** Why it stopped, once it has. */
  stopped?: StopReason;
  /**
   * D4 (staging acceptance, 31 Oct 2026): where each served item came from, recorded when it was chosen, one letter per
   * ordinal: l the governed library, g written by THIS exam's own generation calls, s already stored. Absent on exams
   * started before the fix (the report then falls back to the question's age against the exam's set-up).
   */
  served?: string;
  /** Questions this exam's generation calls wrote that it has not served yet (newest kept, at most PENDING_MAX). */
  pending?: string[];
};

/** At most this many written-but-not-yet-served ids are kept (the scope has a 4000-byte bound). */
export const PENDING_MAX = 12;
export type ServedSource = "library" | "generated" | "stored";
const SOURCE_LETTER: Record<ServedSource, string> = { library: "l", generated: "g", stored: "s" };
const LETTER_SOURCE: Record<string, ServedSource> = { l: "library", g: "generated", s: "stored" };

export type BlueprintRequest = Pick<AdaptiveBlueprint, "title" | "scope" | "formats" | "length" | "feedback" | "timeLimitMinutes" | "source"> & { start: GenerationDifficulty | null };
export type BlueprintLimits = { defaultLength: number; maxLength: number; formats: readonly AdaptiveFormat[]; defaultFeedback: "immediate" | "end" };

/** Pure. The policy's limits made consistent: max within 5-50, the default within 5-max, only adaptive formats. */
export function blueprintLimits(p: { length: number; maxLength: number; formats: readonly string[]; revisionFormats: readonly string[]; feedback: "immediate" | "end" }): BlueprintLimits {
  const maxLength = Math.max(ADAPTIVE_LENGTH_MIN, Math.min(ADAPTIVE_LENGTH_MAX, Math.round(p.maxLength)));
  return {
    maxLength, defaultLength: Math.max(ADAPTIVE_LENGTH_MIN, Math.min(maxLength, Math.round(p.length))),
    formats: ADAPTIVE_FORMATS.filter(f => p.formats.includes(f) && p.revisionFormats.includes(f)), defaultFeedback: p.feedback,
  };
}

/**
 * Pure. A blueprint request from a body, bounded by the limits, or the reason it was refused. Structured (multi-part)
 * needs feedback after each answer (a multi-part answer is not held to the end), so with feedback at the end it is
 * left out, as Revision does.
 */
export function parseBlueprintRequest(body: unknown, limits: BlueprintLimits): { ok: true; value: BlueprintRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = (b.scope ?? { kind: "programme" }) as Record<string, unknown>;
  let scope: AdaptiveScope;
  if (s.kind === "programme" || s.kind === "library") scope = { kind: s.kind };
  else if (s.kind === "documents") {
    const ids = uuids(s.materialIds, 10);
    if (!ids.length) return { ok: false, error: "Choose at least one material." };
    scope = { kind: "documents", materialIds: ids };
  } else if (s.kind === "topic") {
    const topic = typeof s.topic === "string" ? s.topic.replace(/\s+/g, " ").trim() : "";
    if (topic.length < 2 || topic.length > 120) return { ok: false, error: "Name a topic in a few words." };
    scope = { kind: "topic", topic };
  } else if (s.kind === "competencies") {
    const ids = uuids(s.competencyIds, BLUEPRINT_COMPETENCIES_MAX);
    if (!ids.length) return { ok: false, error: "Choose at least one competency." };
    scope = { kind: "competencies", competencyIds: ids };
  } else return { ok: false, error: "Choose what the exam covers." };

  const feedback: "immediate" | "end" = b.feedback === "end" || b.feedback === "immediate" ? b.feedback : limits.defaultFeedback;
  const asked = Array.isArray(b.formats) ? b.formats.filter((f): f is AdaptiveFormat => (ADAPTIVE_FORMATS as readonly string[]).includes(f as string)) : [];
  // Formats named but none of them adaptive (a flashcard, say) is a refusal, never a silent "all of them".
  const named = Array.isArray(b.formats) && b.formats.length > 0;
  const formats = [...new Set(named ? asked : limits.formats)].filter(f => limits.formats.includes(f) && (f !== "structured" || feedback === "immediate"));
  if (!formats.length) return { ok: false, error: "None of those question formats is offered for adaptive exams here." };
  const length = Number.isInteger(b.length) ? (b.length as number) : limits.defaultLength;
  if (length < ADAPTIVE_LENGTH_MIN || length > limits.maxLength) return { ok: false, error: `Choose between ${ADAPTIVE_LENGTH_MIN} and ${limits.maxLength} questions.` };
  const t = b.timeLimitMinutes;
  if (t !== undefined && t !== null && !(ADAPTIVE_TIME_LIMITS as readonly number[]).includes(t as number)) return { ok: false, error: "Choose one of the time limits offered, or none." };
  const start = b.start === "auto" || b.start === undefined || b.start === null ? null : isGenerationDifficulty(b.start) ? b.start : undefined;
  if (start === undefined) return { ok: false, error: "Choose a starting difficulty." };
  const title = typeof b.title === "string" && b.title.trim() ? b.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return { ok: true, value: { title, scope, formats, length, feedback, timeLimitMinutes: (t as number | null | undefined) ?? null, source: isSourceMode(b.source) ? b.source : "notes", start } };
}

/** Pure. The starting difficulty: the student's choice, else the programme level's default, else the policy's, else standard. */
export function startingDifficulty(asked: GenerationDifficulty | null, programme: GenerationDifficulty | null, policy: string | null): { start: GenerationDifficulty; from: AdaptiveBlueprint["startFrom"] } {
  if (asked) return { start: asked, from: "chosen" };
  if (programme) return { start: programme, from: "programme" };
  return { start: isGenerationDifficulty(policy) ? policy : "standard", from: "policy" };
}

/** Pure. A stored blueprint read back from a set's scope (scope.adaptive), defensively. null: not an adaptive exam. */
export function blueprintOf(scope: unknown): AdaptiveBlueprint | null {
  const a = ((scope ?? {}) as Record<string, unknown>).adaptive as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || a.v !== 1 || !isGenerationDifficulty(a.start)) return null;
  const s = (a.scope ?? {}) as Record<string, unknown>;
  const scopeOut: AdaptiveScope | null = s.kind === "programme" || s.kind === "library" ? { kind: s.kind }
    : s.kind === "documents" ? { kind: "documents", materialIds: uuids(s.materialIds, 10) }
      : s.kind === "topic" && typeof s.topic === "string" ? { kind: "topic", topic: s.topic.slice(0, 120) }
        : s.kind === "competencies" ? { kind: "competencies", competencyIds: uuids(s.competencyIds, BLUEPRINT_COMPETENCIES_MAX) } : null;
  const formats = Array.isArray(a.formats) ? a.formats.filter((f): f is AdaptiveFormat => (ADAPTIVE_FORMATS as readonly string[]).includes(f as string)) : [];
  const length = Number.isInteger(a.length) ? Math.max(1, Math.min(ADAPTIVE_LENGTH_MAX, a.length as number)) : null;
  if (!scopeOut || !formats.length || !length) return null;
  return {
    v: 1, title: typeof a.title === "string" ? a.title.slice(0, 120) : "", scope: scopeOut, formats, length,
    start: a.start, startFrom: a.startFrom === "chosen" || a.startFrom === "programme" ? a.startFrom : "policy",
    feedback: a.feedback === "end" ? "end" : "immediate",
    timeLimitMinutes: typeof a.timeLimitMinutes === "number" && a.timeLimitMinutes > 0 ? a.timeLimitMinutes : null,
    source: isSourceMode(a.source) ? a.source : "notes",
    sections: uuids(a.sections, BLUEPRINT_SECTIONS_MAX), competencyIds: uuids(a.competencyIds, BLUEPRINT_COMPETENCIES_MAX),
    libraryIds: uuids(a.libraryIds, BLUEPRINT_LIBRARY_MAX), calls: Number.isInteger(a.calls) ? Math.max(0, a.calls as number) : 0,
    ...(a.stopped === "length" || a.stopped === "time" || a.stopped === "exhausted" || a.stopped === "ended" ? { stopped: a.stopped } : {}),
    ...(typeof a.served === "string" && /^[lgs?]{0,50}$/.test(a.served) ? { served: a.served } : {}),
    ...(Array.isArray(a.pending) ? { pending: uuids(a.pending, PENDING_MAX) } : {}),
  };
}

/** Pure. The set scope that holds a blueprint, kept within 417's 4000-byte bound (sections trimmed first). */
export function blueprintScope(b: AdaptiveBlueprint): { adaptive: AdaptiveBlueprint } {
  let out = { ...b };
  // The provenance memo goes first: an unserved written id dropped here is only reported as stored if served later.
  while (JSON.stringify({ adaptive: out }).length > 3800 && out.pending?.length) out = { ...out, pending: out.pending.slice(1) };
  while (JSON.stringify({ adaptive: out }).length > 3800 && out.sections.length > 1) out = { ...out, sections: out.sections.slice(0, out.sections.length - 5) };
  return { adaptive: out };
}

// ── THE RULE ──

/**
 * Pure. The difficulty before each item and after the last (length n + 1), from the start and the outcomes in
 * order: true right, false missed, null not marked yet (held for the student's own marking at the end -- it does not
 * move the difficulty). After each answer adaptDifficulty is asked over the answers SINCE THE LAST CHANGE, so three
 * right in a row step up once, and the next step needs three more.
 */
export function difficultyTrajectory(start: GenerationDifficulty, outcomes: readonly (boolean | null)[]): GenerationDifficulty[] {
  const out: GenerationDifficulty[] = [start];
  let level = start;
  let since: boolean[] = [];
  for (const o of outcomes) {
    if (o !== null) {
      since.push(o);
      const next = adaptDifficulty(level, [...since].reverse());
      if (next !== level) { level = next; since = []; }
    }
    out.push(level);
  }
  return out;
}

/** Pure. The difficulty the next question is asked for. */
export const nextDifficulty = (start: GenerationDifficulty, outcomes: readonly (boolean | null)[]): GenerationDifficulty => difficultyTrajectory(start, outcomes).at(-1)!;

// ── THE NEXT QUESTION ──

export type Candidate = { id: string; kind: RevisionKind; difficulty: number | null; library: boolean; createdAt: string; lastAnsweredAt: string | null };
export type NextPick = { id: string; from: "library" | "stored" | "generated"; match: "exact" | "range" | "nearest"; level: 1 | 2 | 3 };

/**
 * Pure. The next unseen question at the difficulty asked for. Order: the governed library (published, clinically
 * approved copies) at that difficulty, then the student's own stored questions at it; within each, never answered
 * before first, then a different format from the last question, then the longest since answered, then oldest. When
 * neither has one, `exact` is null and the caller may write new questions at that difficulty; `nearest` is the
 * closest difficulty that does exist (library first at each distance), offered only when nothing new can be written.
 * `fresh` (ids just written for this difficulty) count as a match when their difficulty is one the request allowed.
 * A library question records no difficulty, so it counts as standard.
 */
export function selectNext(input: { target: GenerationDifficulty; pool: readonly Candidate[]; exclude: ReadonlySet<string>; formats: readonly RevisionKind[]; lastKind: RevisionKind | null; fresh?: ReadonlySet<string> }): { exact: NextPick | null; nearest: NextPick | null } {
  const want = LEVEL_OF[input.target];
  const eligible = input.pool.filter(c => !input.exclude.has(c.id) && input.formats.includes(c.kind));
  const order = (a: Candidate, b: Candidate) =>
    Number(a.lastAnsweredAt !== null) - Number(b.lastAnsweredAt !== null)
    || Number(a.kind === input.lastKind) - Number(b.kind === input.lastKind)
    || (a.lastAnsweredAt ?? "").localeCompare(b.lastAnsweredAt ?? "")
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const pick = (c: Candidate | undefined, match: NextPick["match"]): NextPick | null => c ? { id: c.id, from: c.library ? "library" : input.fresh?.has(c.id) ? "generated" : "stored", match, level: levelOfItem(c.difficulty) } : null;
  const at = (lvl: number, library: boolean) => eligible.filter(c => c.library === library && levelOfItem(c.difficulty) === lvl).sort(order)[0];
  const exact = pick(at(want, true), "exact") ?? pick(at(want, false), "exact")
    ?? pick(eligible.filter(c => input.fresh?.has(c.id) && DIFFICULTY_RANGE[input.target].includes(levelOfItem(c.difficulty))).sort(order)[0], "range");
  if (exact) return { exact, nearest: null };
  let nearest: NextPick | null = null;
  for (const d of [1, 2]) {
    for (const lvl of [want - d, want + d].filter(l => l >= 1 && l <= 3)) nearest = nearest ?? pick(at(lvl, true), "nearest");
    for (const lvl of [want - d, want + d].filter(l => l >= 1 && l <= 3)) nearest = nearest ?? pick(at(lvl, false), "nearest");
    if (nearest) break;
  }
  return { exact: null, nearest };
}

/**
 * Pure. D3 (staging acceptance, 31 Oct 2026): the section|format pairs that already have an UNUSED question at the target
 * difficulty -- not yet served in THIS exam, at the current prompt version -- which generation skips as covered. Before
 * the fix every stored question counted, so once a pair had any question (even one this exam had already asked) nothing
 * new was written, and an mcq-only exam on one section stopped at 2 of 5.
 */
export function unusedCoverage(pool: readonly { id: string; chunkId: string; kind: string; difficulty: number | null; current: boolean }[], used: ReadonlySet<string>, target: GenerationDifficulty): Set<string> {
  return new Set(pool.filter(q => q.current && !used.has(q.id) && levelOfItem(q.difficulty) === LEVEL_OF[target]).map(q => `${q.chunkId}|${q.kind}`));
}

/**
 * Pure. D4: the blueprint after item `ordinal` was served -- its source letter recorded at the moment it was chosen (library,
 * written by this exam -- now or by an earlier call of it -- or stored), and the ids this exam wrote but has not served
 * kept for the next pick. `generated` is what this pick's own generation call wrote.
 */
export function recordServed(bp: AdaptiveBlueprint, ordinal: number, pick: Pick<NextPick, "id" | "from">, generated: readonly string[] = []): AdaptiveBlueprint {
  const written = [...new Set([...(bp.pending ?? []), ...generated])];
  const source: ServedSource = pick.from === "library" ? "library" : pick.from === "generated" || written.includes(pick.id) ? "generated" : "stored";
  const at = Math.max(1, Math.min(50, ordinal));
  return {
    ...bp,
    served: (bp.served ?? "").slice(0, at - 1).padEnd(at - 1, "?") + SOURCE_LETTER[source],
    pending: written.filter(id => id !== pick.id).slice(-PENDING_MAX),
  };
}

/** Pure. Each served question's recorded source, by id, from the session's items in ordinal order. */
export function servedSources(served: string | undefined, questionIds: readonly string[]): Map<string, ServedSource> {
  const out = new Map<string, ServedSource>();
  questionIds.forEach((id, i) => { const s = LETTER_SOURCE[served?.[i] ?? ""]; if (s) out.set(id, s); });
  return out;
}

/** Pure. An item's source for the report: as recorded when served, else (an exam from before D4) its age against the set-up. */
export function itemSource(recorded: ServedSource | undefined, q: { library: boolean; createdAt: string }, setUpAt: string): ServedSource {
  if (recorded) return recorded;
  return q.library ? "library" : q.createdAt >= setUpAt ? "generated" : "stored";
}

/** Pure. The formats to write in, starting after the last question's format so consecutive questions differ. */
export function formatRotation(formats: readonly RevisionFormat[], lastKind: RevisionKind | null): RevisionFormat[] {
  const i = lastKind ? formats.indexOf(lastKind as RevisionFormat) : -1;
  return i < 0 ? [...formats] : [...formats.slice(i + 1), ...formats.slice(0, i + 1)];
}

// ── WHEN IT STOPS ──

export type StopReason = "length" | "time" | "exhausted" | "ended";

/** Pure. Whether the exam has reached its length (answers and held answers) or its time limit. null: carry on. */
export function stopReason(i: { answered: number; length: number; startedAt: string; now: number; timeLimitMinutes: number | null }): "length" | "time" | null {
  if (i.answered >= i.length) return "length";
  if (i.timeLimitMinutes && i.now >= Date.parse(i.startedAt) + i.timeLimitMinutes * 60_000) return "time";
  return null;
}

/** Pure. When the time limit runs out (ISO), or null. */
export const deadlineOf = (startedAt: string, timeLimitMinutes: number | null): string | null =>
  timeLimitMinutes ? new Date(Date.parse(startedAt) + timeLimitMinutes * 60_000).toISOString() : null;

// ── THE REPORT ──

export type ReportItem = {
  questionId: string; kind: RevisionKind; stem: string; difficulty: number | null; cognitive: CognitiveLevel;
  chunkId: string; materialId: string; materialTitle: string; topic: string | null; competencyId: string | null;
  library: boolean; generated: boolean;
  outcome: { correct: boolean; score: number | null; marking: string } | "held" | "unanswered";
  /** Marked after the exam ended (a held answer the student marked at the end): it did not move the difficulty. */
  markedAfterEnd?: boolean;
  keyPoints: string[]; misconceptions: string[];
};

/** Pure. The outcomes the rule saw, in order: right, missed, or null (held, or marked only after the exam ended). */
export const adaptationOutcomes = (items: readonly Pick<ReportItem, "outcome" | "markedAfterEnd">[]): (boolean | null)[] =>
  items.filter(i => i.outcome !== "unanswered").map(i => (typeof i.outcome === "object" && !i.markedAfterEnd ? i.outcome.correct : null));
export type ReportGroup = { key: string; label: string; marked: number; correct: number; percent: number | null };
export type Measured = { state: "measured"; percent: number; marked: number } | { state: "not_measured"; reason: string };
export type ReportGap = { label: string; chunkId: string; materialId: string; missed: number; keyPoints: string[]; misconceptions: string[] };
export type ReportRecommendation = { id: string; title: string; reason: string; action: { learnSection: string } | { revise: "weak" | "spaced" } | { grade: true } };
export type AdaptiveReport = {
  label: string; rule: string; fallback: string | null; stopped: string | null;
  of: number; answered: number; marked: number; held: number;
  score: Measured;
  byTopic: ReportGroup[]; byCompetency: ReportGroup[]; byLevel: ReportGroup[]; byFormat: ReportGroup[];
  trajectory: { n: number; asked: GenerationDifficulty; offered: GenerationDifficulty; result: "right" | "missed" | "held" | "unanswered" }[];
  start: { difficulty: GenerationDifficulty; from: AdaptiveBlueprint["startFrom"] }; finish: GenerationDifficulty;
  sources: { library: number; stored: number; generated: number };
  strengths: string[]; gaps: ReportGap[]; recommendations: ReportRecommendation[];
};

const scoreOf = (o: { correct: boolean; score: number | null }) => (o.score === null || Number.isNaN(o.score) ? (o.correct ? 1 : 0) : Math.max(0, Math.min(1, o.score)));
const STOPPED: Record<StopReason, string | null> = {
  length: null, ended: "You ended the exam before its last question.", time: "The time limit ran out before the last question.",
  exhausted: "There were no more questions to offer, and none could be written just now, so the exam stopped early.",
};

/**
 * Pure. The formative report: the practice score (the share of marked answers that matched, partial credit as each
 * answer was marked), by topic, competency, cognitive level and format; the difficulty asked for and offered at each
 * step; strengths (two or more marked, at least 80%); learning gaps (missed key points and misconceptions from each
 * missed question's rubric); and what to revise. Nothing marked is "Not measured", never zero. Held answers wait for
 * the student's own marking and count once marked.
 */
export function buildAdaptiveReport(input: {
  items: readonly ReportItem[]; length: number; start: GenerationDifficulty; startFrom: AdaptiveBlueprint["startFrom"];
  competencyNames: ReadonlyMap<string, string>; fallback: boolean; stop: StopReason | null;
}): AdaptiveReport {
  const items = input.items;
  const marked = items.filter((i): i is ReportItem & { outcome: { correct: boolean; score: number | null; marking: string } } => typeof i.outcome === "object");
  const held = items.filter(i => i.outcome === "held").length;
  const path = difficultyTrajectory(input.start, adaptationOutcomes(items));
  const sum = marked.reduce((n, i) => n + scoreOf(i.outcome), 0);
  const score: Measured = marked.length ? { state: "measured", percent: Math.round((sum / marked.length) * 100), marked: marked.length }
    : { state: "not_measured", reason: held ? "Your answers are waiting for your own marking." : "No answer has been marked yet." };

  const group = (keyOf: (i: ReportItem) => string | null, labelOf: (k: string, i: ReportItem) => string): ReportGroup[] => {
    const by = new Map<string, { label: string; marked: number; correct: number; sum: number }>();
    for (const i of marked) {
      const k = keyOf(i);
      if (!k) continue;
      const g = by.get(k) ?? { label: labelOf(k, i), marked: 0, correct: 0, sum: 0 };
      g.marked++; g.correct += i.outcome.correct ? 1 : 0; g.sum += scoreOf(i.outcome);
      by.set(k, g);
    }
    return [...by].map(([key, g]) => ({ key, label: g.label, marked: g.marked, correct: g.correct, percent: g.marked ? Math.round((g.sum / g.marked) * 100) : null }))
      .sort((a, b) => b.marked - a.marked || a.label.localeCompare(b.label));
  };
  const topicKey = (i: ReportItem) => i.topic ?? i.materialTitle;
  const byTopic = group(topicKey, k => k);
  const byCompetency = group(i => i.competencyId, k => input.competencyNames.get(k) ?? "A linked competency");
  const byLevel = group(i => i.cognitive, k => LEVEL_LABEL[k as CognitiveLevel] ?? k);
  const byFormat = group(i => i.kind, k => REVISION_FORMAT_LABEL[k as RevisionFormat] ?? "Practice case step");

  let k = 0;
  const trajectory = items.filter(i => i.outcome !== "unanswered").map((i, n) => {
    const asked = path[n];
    k++;
    return { n: k, asked, offered: DIFF_OF_LEVEL[levelOfItem(i.difficulty)], result: typeof i.outcome === "object" ? (i.outcome.correct ? "right" as const : "missed" as const) : "held" as const };
  });

  const strengths = [...byTopic, ...byCompetency].filter(g => g.marked >= 2 && (g.percent ?? 0) >= 80).map(g => g.label);
  const gapsBy = new Map<string, ReportGap>();
  for (const i of marked.filter(x => !x.outcome.correct)) {
    const label = topicKey(i);
    const g = gapsBy.get(label) ?? { label, chunkId: i.chunkId, materialId: i.materialId, missed: 0, keyPoints: [], misconceptions: [] };
    g.missed++;
    g.keyPoints = [...new Set([...g.keyPoints, ...i.keyPoints])].slice(0, 6);
    g.misconceptions = [...new Set([...g.misconceptions, ...i.misconceptions])].slice(0, 4);
    gapsBy.set(label, g);
  }
  const gaps = [...gapsBy.values()].sort((a, b) => b.missed - a.missed || a.label.localeCompare(b.label));
  const missed = marked.filter(i => !i.outcome.correct).length;
  const recommendations: ReportRecommendation[] = [];
  if (held) recommendations.push({ id: "grade", title: `Mark your ${held} held answer${held === 1 ? "" : "s"}`, reason: "They count in this report once you have compared them with your notes.", action: { grade: true } });
  for (const g of gaps.slice(0, 3))
    recommendations.push({ id: `learn:${g.chunkId}`, title: `Go over ${g.label}`, reason: `You missed ${g.missed} question${g.missed === 1 ? "" : "s"} on it. Teach me goes through that part of your notes again.`, action: { learnSection: g.chunkId } });
  if (missed) {
    recommendations.push({ id: "weak", title: "Practise your weak areas", reason: `Weak areas starts with the questions you missed, most-missed first.`, action: { revise: "weak" } });
    recommendations.push({ id: "spaced", title: "Review your cards on schedule", reason: `The ${missed} question${missed === 1 ? "" : "s"} you missed ${missed === 1 ? "is" : "are"} on your review cards, due today, so ${missed === 1 ? "it comes" : "they come"} back on the spaced schedule.`, action: { revise: "spaced" } });
  }

  return {
    label: ADAPTIVE_REPORT_LABEL, rule: ADAPTIVE_RULE, fallback: input.fallback ? ADAPTIVE_FALLBACK_NOTE : null, stopped: input.stop ? STOPPED[input.stop] : null,
    of: input.length, answered: marked.length + held, marked: marked.length, held, score,
    byTopic, byCompetency, byLevel, byFormat, trajectory,
    start: { difficulty: input.start, from: input.startFrom }, finish: path.at(-1)!,
    sources: { library: items.filter(i => i.outcome !== "unanswered" && i.library).length, generated: items.filter(i => i.outcome !== "unanswered" && !i.library && i.generated).length, stored: items.filter(i => i.outcome !== "unanswered" && !i.library && !i.generated).length },
    strengths: [...new Set(strengths)], gaps, recommendations,
  };
}

/** Pure. The cognitive level of an item: its rubric's, or else its difficulty's (1 recall, 2 understanding, 3 application). */
export const cognitiveOf = (rubricLevel: CognitiveLevel | null, difficulty: number | null): CognitiveLevel =>
  rubricLevel ?? (["recall", "understanding", "application"] as const)[levelOfItem(difficulty) - 1];

export { GENERATION_DIFFICULTIES };
