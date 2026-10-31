// ── LIBRARY QUESTION SIMILARITY ── SQIE-COMPLETE-01 (owner GO 31 Oct 2026) ───────────────────────────────────────────────
//
// Pure. No database, no migration, no model. A library question (CKRI revision_question, migration 442) is reduced to the
// words that carry its meaning (lower-case, stopwords and short tokens removed) and two questions are compared by Jaccard
// overlap of those words: on the STEM, and on the KEY option (the correct answer). The score weights the stem most,
// because two questions asking the same thing in the same words are duplicates whatever their distractors are.
//
// ⚠ A MATCH IS A PROMPT TO LOOK, NEVER A VERDICT. Nothing here blocks a save. The submit action asks the educator to
// confirm they checked a LIKELY duplicate (see question-source.ts / educator.ts submitDraft), and the catalogue shows
// every pair so a person decides. Thresholds are the only tuning knobs and are exported.
// ⚠ BOUNDED WORK. Pairwise comparison over a library is quadratic; findDuplicatePairs only compares questions that
// share at least MIN_SHARED_RARE rare tokens (an inverted index over tokens that occur in few questions), caps the
// questions considered and the postings read per token, and says when it was cut (`truncated`).

export const LIKELY_DUPLICATE = 0.8;
export const SIMILAR = 0.6;
export const STEM_WEIGHT = 0.75;
export const MIN_SHARED_RARE = 2;
export const MAX_ITEMS = 600;
export const MAX_POSTINGS = 60;

const STOP = new Set((
  "a an the and or but if then else of to in on at by for with without from into onto over under about as is are was were be been being am do does did done have has had having " +
  "this that these those it its they them their he she his her we our you your i me my not no nor so than too very can could should would may might must will shall " +
  "which who whom whose what when where why how most least best following correct incorrect true false statement statements option options answer answers choose select " +
  "likely most which one all any each both either neither none above below also only just more less other another such there here per via"
).split(/\s+/));

/** Pure. The meaningful tokens of a text: lower-case words and numbers, stopwords and one-letter tokens removed. */
export function tokens(text: string): string[] {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(t => t.length >= 2 && !STOP.has(t));
}

export type QuestionFingerprint = { stem: ReadonlySet<string>; key: ReadonlySet<string> };

/** Pure. null when the content is not a four-option revision question with a readable key. */
export function questionFingerprint(content: unknown): QuestionFingerprint | null {
  const c = (content ?? {}) as Record<string, unknown>;
  if (typeof c.stem !== "string" || !Array.isArray(c.options)) return null;
  const ci = Number(c.correct_index);
  const keyText = Number.isInteger(ci) && ci >= 0 && ci < c.options.length ? c.options[ci] : null;
  const stem = new Set(tokens(c.stem));
  if (!stem.size) return null;
  return { stem, key: new Set(typeof keyText === "string" ? tokens(keyText) : []) };
}

/** Pure. Jaccard overlap of two sets; 0 when both are empty (nothing to compare is not a match). */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Pure. 0 to 1: the stem overlap weighted STEM_WEIGHT, the key-option overlap the rest. A missing key weighs on the stem alone. */
export function similarity(a: QuestionFingerprint, b: QuestionFingerprint): number {
  const stem = jaccard(a.stem, b.stem);
  if (!a.key.size || !b.key.size) return +stem.toFixed(4);
  return +(STEM_WEIGHT * stem + (1 - STEM_WEIGHT) * jaccard(a.key, b.key)).toFixed(4);
}

export type SimilarityBand = "likely_duplicate" | "similar" | "distinct";
export const bandOf = (score: number): SimilarityBand => (score >= LIKELY_DUPLICATE ? "likely_duplicate" : score >= SIMILAR ? "similar" : "distinct");
export const BAND_LABEL: Record<SimilarityBand, string> = { likely_duplicate: "Likely duplicate", similar: "Similar", distinct: "Distinct" };

export type LibraryItem = { id: string; content: unknown };
export type SimilarMatch = { id: string; score: number; band: Exclude<SimilarityBand, "distinct"> };
export type SimilarPair = { a: string; b: string; score: number; band: Exclude<SimilarityBand, "distinct"> };

type Prepared = { id: string; fp: QuestionFingerprint; all: string[] };
const prepare = (items: readonly LibraryItem[]): Prepared[] =>
  items.flatMap(i => { const fp = questionFingerprint(i.content); return fp ? [{ id: i.id, fp, all: [...new Set([...fp.stem, ...fp.key])] }] : []; });

/** Pure. The items in `pool` that resemble `target` at SIMILAR or above, best first. The target itself (same id) is skipped. */
export function findSimilar(target: unknown, pool: readonly LibraryItem[], opts: { exceptId?: string; limit?: number } = {}): SimilarMatch[] {
  const fp = questionFingerprint(target);
  if (!fp) return [];
  const out: SimilarMatch[] = [];
  for (const p of prepare(pool.slice(0, MAX_ITEMS * 4))) {
    if (p.id === opts.exceptId) continue;
    const score = similarity(fp, p.fp);
    const band = bandOf(score);
    if (band !== "distinct") out.push({ id: p.id, score, band });
  }
  return out.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, opts.limit ?? 10);
}

/**
 * Pure. Every pair in the library at SIMILAR or above. Only pairs sharing at least MIN_SHARED_RARE rare tokens are
 * compared (a rare token occurs in few questions), at most MAX_ITEMS questions are read and MAX_POSTINGS per token, so the
 * work is bounded. `truncated` is true when a cap was hit, so a caller can say the scan was partial.
 */
export function findDuplicatePairs(items: readonly LibraryItem[]): { pairs: SimilarPair[]; truncated: boolean } {
  let truncated = items.length > MAX_ITEMS;
  const prep = prepare(items.slice(0, MAX_ITEMS));
  const df = new Map<string, number>();
  for (const p of prep) for (const t of p.all) df.set(t, (df.get(t) ?? 0) + 1);
  const rareMax = Math.max(3, Math.ceil(prep.length * 0.1));
  const postings = new Map<string, number[]>();
  prep.forEach((p, i) => {
    for (const t of p.all) {
      if ((df.get(t) ?? 0) > rareMax) continue;
      const list = postings.get(t) ?? [];
      if (list.length >= MAX_POSTINGS) { truncated = true; continue; }
      list.push(i); postings.set(t, list);
    }
  });
  const shared = new Map<number, number>(); // i * MAX_ITEMS + j -> shared rare tokens
  for (const list of postings.values())
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const k = list[x] * (MAX_ITEMS + 1) + list[y];
      shared.set(k, (shared.get(k) ?? 0) + 1);
    }
  const pairs: SimilarPair[] = [];
  for (const [k, n] of shared) {
    if (n < MIN_SHARED_RARE) continue;
    const i = Math.floor(k / (MAX_ITEMS + 1)), j = k % (MAX_ITEMS + 1);
    const score = similarity(prep[i].fp, prep[j].fp);
    const band = bandOf(score);
    if (band !== "distinct") pairs.push({ a: prep[i].id, b: prep[j].id, score, band });
  }
  return { pairs: pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)), truncated };
}
