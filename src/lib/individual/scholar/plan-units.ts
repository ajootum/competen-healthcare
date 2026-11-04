// Client-safe: no server imports (the review step runs it in the browser after a merge or a split). The builder that reads the
// material's text and runs the Learn planner is plan-units-build.ts (server).

/** learn.ts LESSON_THIN_CHARS, repeated here so this file stays client-safe: a section below this many characters is a sparse slide. */
export const THIN_CHARS = 160;

// ── LEARNING UNITS ── SCHOLAR-PLAN-UNITS-01 (owner, 3 Nov 2026) ─────────────────────────────────────────────────────────
//
// Pure, no AI, deterministic. A DOCUMENT SECTION is one chunk of the learner's notes (one slide or page part: the unit of
// citation, of Learn and Revise navigation, of questions). A LEARNING UNIT is a contiguous run of sections of one material
// that teaches one thing. It is what My Plan schedules: the learner studies a unit over one or more STUDY SESSIONS (the
// 15-30 minute activities of study-plan.ts), revises it at +1, +3 and +7 days and practises questions on it. The
// SUBTOPICS of a unit (its headings and topics) are listed for the learner but never scheduled on their own.
//
// The grouping is the Learn workspace's own lesson planner (learn.ts planSteps, SCHOLAR-LEARN-FIX-01): thin slides join a
// neighbour and the material is cut where headings and topics change most. No second engine. The titles are the lesson
// titles (lessonOutline). The sections themselves, their citations and the material page are untouched: a unit only
// names which sections it holds, by their ordinals.
//
// THE WORKLOAD ESTIMATE, per unit, from metadata Scholar already holds (section text size, headings, topics, and the
// material's extraction quality: picture-only slides, slides read by AI from a picture):
//   reading    the words of the unit at READ_WPM words a minute, plus IMAGE_SLIDE_MINUTES for every image-based slide
//              (a picture-only slide, a slide read from its picture by AI, a sparse slide of under LESSON_THIN_CHARS);
//   learning   working through the lesson and its inline checks: reading x a complexity factor read from the text
//              (long words and numbers: plain 1.0, moderate 1.3, dense 1.6);
//   revision   REVISION_REVIEWS short reviews (the +1, +3, +7 day revision points), each about REVISION_SHARE of reading;
//   practice   questions and a scenario: PRACTICE_PER_SECTION minutes a section, PRACTICE_MIN to PRACTICE_MAX a unit.
// Every figure is approximate and the basis is shown with it (estimateBasis). A unit whose text could not be read is
// sized at UNREAD_WORDS words a section and says so.
//
// ⚠ A unit says nothing about how well the learner knows the material. It is a suggestion about TIME and ORDER.

export const READ_WPM = 150;
export const IMAGE_SLIDE_MINUTES = 1.5;
export const REVISION_REVIEWS = 3;
export const REVISION_SHARE = 0.25;
export const PRACTICE_PER_SECTION = 2;
export const PRACTICE_MIN = 5;
export const PRACTICE_MAX = 20;
/** The size a unit aims at: about seven minutes of reading. A material is cut into about chars / UNIT_TARGET_CHARS units. */
export const UNIT_TARGET_CHARS = 3000;
export const MAX_UNITS = 40;
/** A cut between alike neighbours (the same chapter heading) costs this much more than Learn's lessons weigh it: units follow the headings before size. */
export const UNIT_CUT_WEIGHT = 6;
/** A unit may run longer than a lesson: up to this many sections and characters (one section larger than that is a unit alone). */
export const UNIT_MAX_SECTIONS = 12;
export const UNIT_MAX_CHARS = 7200;
/** A heading stem on at least this share of a material's substantive headings (and at least COMMON_STEM_MIN of them) says nothing about where a unit ends: "care" in a nursing deck. */
export const COMMON_STEM_SHARE = 0.4;
export const COMMON_STEM_MIN = 3;
/** A section whose text was not read is sized at this many words. */
export const UNREAD_WORDS = 100;
const CHARS_PER_WORD = 5.5;
export const COMPLEXITY_FACTOR = { plain: 1.0, moderate: 1.3, dense: 1.6 } as const;
export type Complexity = keyof typeof COMPLEXITY_FACTOR;
const LONG_WORD = 10;

/** One section as the unit builder and the review step read it: its place, heading, topics and the facts of its text. */
export type UnitSection = {
  chunkId: string; ordinal: number;
  /** The slide or page it is on (null for a Word or text file). */
  page: number | null;
  heading: string | null;
  topics: string[];
  /** Characters of text (null: the text could not be read). */
  chars: number | null;
  words: number; longWords: number; numeric: number;
  /** A sparse slide (under LESSON_THIN_CHARS): a picture with a caption, a divider. */
  sparse: boolean;
  /** Its text was read by AI from the slide picture. */
  aiRead: boolean;
  started: boolean;
};
export type UnitEstimate = {
  reading: number; learning: number; revision: number; practice: number; total: number;
  complexity: Complexity; words: number; imageSlides: number;
  /** Sections whose text could not be read (sized at UNREAD_WORDS each). */
  unread: number;
};
export type ProposedUnit = {
  /** Stable within one proposal ("u3"): a key for the review step. */
  id: string;
  title: string;
  objective: string;
  /** The subtopics it holds (headings and topics), for the learner to read, never scheduled apart. */
  covers: string[];
  parts: UnitSection[];
  /** Picture-only slides (no section at all) inside the unit's slide span. */
  pictureOnly: number[];
  /** "slides 14-23" / "pages 3-4" / "sections 2-5": how the learner finds it in the material. */
  cite: string;
  estimate: UnitEstimate;
  excluded: boolean;
  priority: boolean;
};
export type UnitTotals = { units: number; planned: number; excluded: number; sections: number; reading: number; learning: number; revision: number; practice: number; total: number };

// ── the facts of a section's text ──
/** Pure. Words, long words and numeric tokens of a section's text (the speaker-notes marker aside). */
export function textFacts(content: string): { words: number; longWords: number; numeric: number } {
  const tokens = content.replace(/\n*Speaker notes:\n*/i, " ").split(/\s+/).map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "")).filter(Boolean);
  let longWords = 0, numeric = 0;
  for (const t of tokens) { if (/\p{N}/u.test(t)) numeric++; else if (t.length >= LONG_WORD) longWords++; }
  return { words: tokens.length, longWords, numeric };
}

/** learn.ts SectionProfile, as this file needs it. */
export type UnitProfile = { heading: string | null; chars: number; content?: string };
export type UnitInput = {
  materialId: string; title: string; unit: "page" | "slide" | "section";
  sections: readonly { chunkId: string; ordinal: number; pageFrom?: number | null; pageTo?: number | null; topics: readonly string[]; started?: boolean }[];
  profiles: ReadonlyMap<string, UnitProfile>;
  /** extract.ts ExtractionQuality: the picture-only slides and the slides read by AI from a picture. */
  quality: { emptyUnits: readonly number[]; aiReadUnits?: readonly number[] } | null;
};

/** Pure. Each section with the facts the unit builder and the review step need. In document order. */
export function unitSections(o: UnitInput): UnitSection[] {
  const ai = new Set(o.quality?.aiReadUnits ?? []);
  return o.sections.slice().sort((a, b) => a.ordinal - b.ordinal).map(s => {
    const p = o.profiles.get(s.chunkId);
    const f = p?.content !== undefined ? textFacts(p.content) : { words: p ? Math.max(1, Math.round(p.chars / CHARS_PER_WORD)) : UNREAD_WORDS, longWords: 0, numeric: 0 };
    const page = s.pageFrom ?? null;
    return {
      chunkId: s.chunkId, ordinal: s.ordinal, page, heading: p?.heading ?? null, topics: s.topics.map(t => t.trim()).filter(Boolean),
      chars: p ? p.chars : null, ...f, sparse: p ? p.chars < THIN_CHARS : false, aiRead: page !== null && ai.has(page), started: !!s.started,
    };
  });
}

/** Pure. How many units a material of this size is cut into: about one per UNIT_TARGET_CHARS, within the lesson caps, at most MAX_UNITS. */
export function unitCount(parts: readonly UnitSection[]): number {
  const chars = parts.reduce((t, p) => t + (p.chars ?? UNREAD_WORDS * CHARS_PER_WORD), 0);
  const want = Math.max(Math.round(chars / UNIT_TARGET_CHARS), Math.ceil(parts.length / UNIT_MAX_SECTIONS), Math.ceil(chars / UNIT_MAX_CHARS));
  return Math.min(MAX_UNITS, Math.max(1, want));
}

const complexityOf = (words: number, longWords: number, numeric: number): Complexity => {
  if (words <= 0) return "moderate";
  const score = (longWords / words) * 2.5 + (numeric / words) * 2;
  return score < 0.25 ? "plain" : score < 0.5 ? "moderate" : "dense";
};

/** Pure. The workload of one unit from its sections and the picture-only slides inside it. */
export function estimateUnit(parts: readonly UnitSection[], pictureOnly: number): UnitEstimate {
  const words = parts.reduce((t, p) => t + p.words, 0);
  const longWords = parts.reduce((t, p) => t + p.longWords, 0);
  const numeric = parts.reduce((t, p) => t + p.numeric, 0);
  const unread = parts.filter(p => p.chars === null).length;
  const imageSlides = parts.filter(p => p.sparse || p.aiRead).length + pictureOnly;
  const reading = Math.max(2, Math.ceil(words / READ_WPM + imageSlides * IMAGE_SLIDE_MINUTES));
  const complexity = complexityOf(words, longWords, numeric);
  const learning = Math.max(3, Math.ceil(reading * COMPLEXITY_FACTOR[complexity]));
  const revision = REVISION_REVIEWS * Math.max(3, Math.round(reading * REVISION_SHARE));
  const practice = Math.min(PRACTICE_MAX, Math.max(PRACTICE_MIN, PRACTICE_PER_SECTION * parts.length));
  return { reading, learning, revision, practice, total: reading + learning + revision + practice, complexity, words, imageSlides, unread };
}

/** Pure. "slides 14-23", "page 3", "sections 2-5". */
export function citeUnit(parts: readonly UnitSection[], unit: "page" | "slide" | "section"): string {
  if (!parts.length) return "";
  const pages = parts.map(p => p.page).filter((n): n is number => n !== null);
  const word = unit === "section" || !pages.length ? "section" : unit;
  const nums = word === "section" ? parts.map(p => p.ordinal) : pages;
  const a = Math.min(...nums), b = Math.max(...nums);
  return a === b ? `${word} ${a}` : `${word}s ${a}-${b}`;
}

/** Pure. The picture-only slides (no section at all) that lie inside a unit's slide span: the learner still looks at them. */
export function pictureOnlyWithin(parts: readonly UnitSection[], emptyUnits: readonly number[]): number[] {
  const pages = parts.map(p => p.page).filter((n): n is number => n !== null);
  if (!pages.length) return [];
  const a = Math.min(...pages), b = Math.max(...pages);
  return emptyUnits.filter(n => n > a && n < b).sort((x, y) => x - y);
}

const GENERIC = /^(objectives?|learning objectives?|learning outcomes?|aims?|agenda|outline|contents?|overview|introduction|intro|summary|conclusions?|references?|bibliography|questions?|any questions\??|thank you|thanks|notes?|appendix)$/i;
const stemsOf = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length >= 3).map(w => w.slice(0, 5));

/**
 * Pure. A unit's title and subtopics from its own parts alone (no section text): the heading carrying most of the unit's
 * text, then the headings and topics that add words. The review step uses it after a merge or a split, where the lesson
 * outline (which reads the text) is not at hand. Deterministic.
 */
export function titleFromParts(parts: readonly UnitSection[], unit: "page" | "slide" | "section"): { title: string; covers: string[] } {
  const groups = new Map<string, { heading: string; chars: number; first: number }>();
  parts.forEach((p, i) => {
    if (!p.heading || GENERIC.test(p.heading.replace(/[?!.:]+$/, "").trim())) return;
    const key = stemsOf(p.heading).join(" ") || p.heading.toLowerCase();
    const g = groups.get(key) ?? { heading: p.heading, chars: 0, first: i };
    g.chars += p.chars ?? 0;
    groups.set(key, g);
  });
  const ranked = [...groups.values()].sort((a, b) => b.chars - a.chars || a.first - b.first);
  const topics: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) for (const t of p.topics) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); topics.push(t); } }
  const title = ranked[0]?.heading ?? topics[0] ?? `${citeUnit(parts, unit).replace(/^./, c => c.toUpperCase())}`;
  return { title: title.slice(0, 80), covers: coversOf(title, [...ranked.slice(1).map(g => g.heading), ...topics]) };
}
/** Pure. Up to six subtopics that add words the title and the ones before them do not already say. */
export function coversOf(title: string, candidates: readonly string[]): string[] {
  const said = new Set(stemsOf(title));
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= 6) break;
    const w = stemsOf(c);
    if (!w.length || w.every(x => said.has(x))) continue;
    out.push(c.replace(/[?!.]+$/, "").trim()); w.forEach(x => said.add(x));
  }
  return out;
}

/** Pure. A unit from its parts: title and covers from `outline` where given (the lesson outline), else from the parts. */
export function unitFrom(id: string, parts: readonly UnitSection[], o: { unit: "page" | "slide" | "section"; emptyUnits: readonly number[]; outline?: { title: string; objective: string; focus: string[] } | null; excluded?: boolean; priority?: boolean }): ProposedUnit {
  const sorted = parts.slice().sort((a, b) => a.ordinal - b.ordinal);
  const pictureOnly = pictureOnlyWithin(sorted, o.emptyUnits);
  const own = titleFromParts(sorted, o.unit);
  const title = o.outline?.title ?? own.title;
  const covers = o.outline ? coversOf(title, [...o.outline.focus.slice(1), ...sorted.flatMap(p => p.topics)]) : own.covers;
  const objective = o.outline?.objective ?? objectiveOf(title, covers);
  return { id, title, objective, covers, parts: sorted, pictureOnly, cite: citeUnit(sorted, o.unit), estimate: estimateUnit(sorted, pictureOnly.length), excluded: !!o.excluded, priority: !!o.priority };
}

// ── the learner's review: merge, split, exclude, prioritise ── all pure, all re-estimated, ids renumbered in document order ──
const renumber = (units: ProposedUnit[]) => units.sort((a, b) => a.parts[0].ordinal - b.parts[0].ordinal).map((u, i) => ({ ...u, id: `u${i + 1}` }));
type Ctx = { unit: "page" | "slide" | "section"; emptyUnits: readonly number[] };

/** Pure. Unit `index` and the one after it become one unit (titled from their parts). Priority or exclusion of either is kept. */
export function mergeUnits(units: readonly ProposedUnit[], index: number, ctx: Ctx): ProposedUnit[] {
  if (index < 0 || index >= units.length - 1) return [...units];
  const a = units[index], b = units[index + 1];
  const merged = unitFrom(a.id, [...a.parts, ...b.parts], { ...ctx, excluded: a.excluded && b.excluded, priority: a.priority || b.priority });
  // Two units joined keep both names ("Eye care and Oral care") unless one already says the other.
  const title = joinTitles(a.title, b.title);
  const covers = coversOf(title, [...a.covers, ...b.covers]);
  return renumber([...units.slice(0, index), { ...merged, title, covers, objective: objectiveOf(title, covers) }, ...units.slice(index + 2)]);
}
/** Pure. "Explain <title>, including <the first two covers>." */
export const objectiveOf = (title: string, covers: readonly string[]) => `Explain ${title.replace(/[?!.]+$/, "")}${covers.length ? `, including ${covers.slice(0, 2).join(" and ")}` : ""}.`;
/** Pure. "A and B", at most 80 characters, unless one title already says the other. */
export function joinTitles(a: string, b: string): string {
  const sa = new Set(stemsOf(a)), sb = stemsOf(b);
  if (sb.length && sb.every(w => sa.has(w))) return a;
  if (sa.size && [...sa].every(w => sb.includes(w))) return b;
  const joined = `${a} and ${b[0] ? b[0].toLowerCase() + b.slice(1) : b}`;
  return joined.length <= 80 ? joined : a;
}
/** Pure. Unit `index` becomes two: the parts before `beforeOrdinal` and the rest. Both keep its priority and exclusion. */
export function splitUnit(units: readonly ProposedUnit[], index: number, beforeOrdinal: number, ctx: Ctx): ProposedUnit[] {
  const u = units[index];
  if (!u) return [...units];
  const head = u.parts.filter(p => p.ordinal < beforeOrdinal), tail = u.parts.filter(p => p.ordinal >= beforeOrdinal);
  if (!head.length || !tail.length) return [...units];
  const flags = { ...ctx, excluded: u.excluded, priority: u.priority };
  return renumber([...units.slice(0, index), unitFrom(u.id, head, flags), unitFrom(`${u.id}b`, tail, flags), ...units.slice(index + 1)]);
}
export function toggleExcluded(units: readonly ProposedUnit[], index: number): ProposedUnit[] {
  return units.map((u, i) => (i === index ? { ...u, excluded: !u.excluded, priority: u.excluded ? u.priority : false } : u));
}
export function togglePriority(units: readonly ProposedUnit[], index: number): ProposedUnit[] {
  return units.map((u, i) => (i === index ? { ...u, priority: !u.priority, excluded: u.priority ? u.excluded : false } : u));
}

/** Pure. The totals over the units that are planned (not excluded). */
export function unitTotals(units: readonly ProposedUnit[]): UnitTotals {
  const planned = units.filter(u => !u.excluded);
  const sum = (k: "reading" | "learning" | "revision" | "practice" | "total") => planned.reduce((t, u) => t + u.estimate[k], 0);
  return { units: units.length, planned: planned.length, excluded: units.length - planned.length, sections: planned.reduce((t, u) => t + u.parts.length, 0), reading: sum("reading"), learning: sum("learning"), revision: sum("revision"), practice: sum("practice"), total: sum("total") };
}

/** Pure. The planned units in the order My Plan takes them: the ones the learner put first (document order), then the rest. */
export function plannedOrder(units: readonly ProposedUnit[]): ProposedUnit[] {
  const planned = units.filter(u => !u.excluded);
  return [...planned.filter(u => u.priority), ...planned.filter(u => !u.priority)];
}

/** Pure. The plain-words basis of the estimates, for the screen. */
export function estimateBasis(t: UnitTotals, o: { unread: number; imageSlides: number; unit: "page" | "slide" | "section" }): string[] {
  const noun = o.unit === "section" ? "section" : o.unit;
  return [
    `Reading: your notes at about ${READ_WPM} words a minute, plus about ${IMAGE_SLIDE_MINUTES} minutes for each image-based ${noun} (a picture-only ${noun}, one read from its picture by AI, or one with only a caption)${o.imageSlides ? `: ${o.imageSlides} here` : ""}.`,
    `Learning: working through Scholar's lesson and its checks, reading time x ${COMPLEXITY_FACTOR.plain} for plain text, x ${COMPLEXITY_FACTOR.moderate} for moderately dense text and x ${COMPLEXITY_FACTOR.dense} for dense text (long clinical terms, numbers).`,
    `Revision: ${REVISION_REVIEWS} short reviews (the day after, 3 days after and 7 days after you first study a unit), each about a quarter of the reading time.`,
    `Practice: about ${PRACTICE_PER_SECTION} minutes of questions a section, ${PRACTICE_MIN} to ${PRACTICE_MAX} minutes a unit.`,
    ...(o.unread ? [`${o.unread} ${o.unread === 1 ? "section" : "sections"} could not be read, so ${o.unread === 1 ? "it is" : "they are"} sized at about ${UNREAD_WORDS} words each.`] : []),
    "These are approximate planning figures, not a measure of what you know. Change the units above, and the plan follows.",
  ];
}

// ── what is stored with the learner's acceptance (plan event `proposal`, value.units: no migration, within 840's 8000 bytes) ──
/** One stored unit: title, ordinal ranges (inclusive), excluded, priority, estimated minutes in all. */
export type StoredUnit = { t: string; o: [number, number][]; x?: 1; p?: 1; m?: number };
export const STORED_UNITS_BASIS = "units-v1";
export const STORED_TITLE_MAX = 60;

/** Pure. The ordinal ranges of a unit's parts (contiguous runs). */
export function rangesOf(parts: readonly UnitSection[]): [number, number][] {
  const out: [number, number][] = [];
  for (const o of parts.map(p => p.ordinal).sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && o === last[1] + 1) last[1] = o; else out.push([o, o]);
  }
  return out;
}
/** Pure. The units as they are stored with an acceptance. */
export function toStored(units: readonly ProposedUnit[]): StoredUnit[] {
  return units.map(u => ({ t: u.title.slice(0, STORED_TITLE_MAX), o: rangesOf(u.parts), ...(u.excluded ? { x: 1 as const } : {}), ...(u.priority ? { p: 1 as const } : {}), m: u.estimate.total }));
}
/**
 * Pure. Stored units read back from a plan event's value, or null where there are none or the shape is wrong. Checks
 * what the shape must be: at most MAX_UNITS, titles 1-80 characters, ranges of positive integers a <= b, no range overlapping
 * another unit's, and (when `ordinals` is given) every ordinal one of the material's.
 */
export function parseStoredUnits(value: unknown, ordinals?: ReadonlySet<number>): StoredUnit[] | null {
  const raw = (value as { units?: unknown } | null)?.units;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_UNITS) return null;
  const out: StoredUnit[] = [];
  const taken = new Set<number>();
  for (const u of raw) {
    if (!u || typeof u !== "object") return null;
    const { t, o, x, p, m } = u as Record<string, unknown>;
    if (typeof t !== "string" || !t.trim() || t.length > 80 || !Array.isArray(o) || !o.length || o.length > 20) return null;
    const ranges: [number, number][] = [];
    for (const r of o) {
      if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || !Number.isInteger(r[1]) || r[0] < 1 || r[1] < r[0] || r[1] - r[0] > 500) return null;
      for (let n = r[0]; n <= r[1]; n++) { if (taken.has(n) || (ordinals && !ordinals.has(n))) return null; taken.add(n); }
      ranges.push([r[0], r[1]]);
    }
    if ((x !== undefined && x !== 1) || (p !== undefined && p !== 1) || (m !== undefined && (!Number.isInteger(m) || (m as number) < 0 || (m as number) > 6000))) return null;
    out.push({ t: t.trim(), o: ranges, ...(x === 1 ? { x: 1 as const } : {}), ...(p === 1 ? { p: 1 as const } : {}), ...(typeof m === "number" ? { m } : {}) });
  }
  return out;
}
/** Pure. The ordinals a stored unit holds, ascending. */
export const storedOrdinals = (u: StoredUnit): number[] => u.o.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)).sort((x, y) => x - y);

// ── LEARNING-CLOSE-2026-11 D03 / LE-02: the learner names a unit, and re-reviews units already accepted ──────────────────
//
// A unit is a name over section ordinals: nothing of the learner's work hangs off it. Progress, notes, saved explanations,
// questions, flashcards, attempts and citations all belong to the SECTIONS (chunk ids), which a rename, a merge or a split
// never touches. So a re-review after acceptance is safe by construction: a new accepted `proposal` event carries the
// units as changed (plan-data.ts storedUnitsOf reads the latest), and My Plan follows. No migration.

/**
 * Pure. Unit `index` takes the learner's own name: whitespace collapsed, at most STORED_TITLE_MAX characters. An empty
 * name gives the unit back the title its parts carry. What the new name already says leaves the covers.
 */
export function renameUnit(units: readonly ProposedUnit[], index: number, title: string, ctx: Ctx): ProposedUnit[] {
  const u = units[index];
  if (!u) return [...units];
  const clean = title.replace(/\s+/g, " ").trim().slice(0, STORED_TITLE_MAX).trim();
  const own = titleFromParts(u.parts, ctx.unit);
  const t = clean || own.title;
  const covers = coversOf(t, [...u.covers, ...own.covers]);
  return units.map((x, i) => (i === index ? { ...x, title: t, covers, objective: objectiveOf(t, covers) } : x));
}

/**
 * Pure. The units as the learner accepted them (stored ranges, names and flags), laid over the sections of the material
 * as the builder read them (`fresh`: every section, in its units): what the review step shows after acceptance, so the
 * learner can rename, merge, split, leave out or put first again. Ordinals no stored unit names are left out, and a stored
 * ordinal the material no longer has is skipped. Null when nothing matches.
 */
export function applyStored(fresh: readonly ProposedUnit[], stored: readonly StoredUnit[], ctx: Ctx): ProposedUnit[] | null {
  const byOrdinal = new Map(fresh.flatMap(u => u.parts).map(p => [p.ordinal, p]));
  const out: ProposedUnit[] = [];
  stored.forEach((s, i) => {
    const parts = storedOrdinals(s).map(n => byOrdinal.get(n)).filter((p): p is UnitSection => !!p);
    if (!parts.length) return;
    const u = unitFrom(`u${i + 1}`, parts, { ...ctx, excluded: s.x === 1, priority: s.p === 1 });
    const title = s.t.trim().slice(0, 80) || u.title;
    const covers = coversOf(title, [...u.covers, ...(u.title !== title ? [u.title] : [])]);
    out.push({ ...u, title, covers, objective: objectiveOf(title, covers) });
  });
  return out.length ? renumber(out) : null;
}
