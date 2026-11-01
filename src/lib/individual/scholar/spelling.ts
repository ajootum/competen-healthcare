// ── SPELLING AND TERMINOLOGY NORMALISATION ── owner instruction 1 Nov 2026 item 8 (P1) ─────────────────────────────────
//
// Pure and deterministic: no model call, no dependency, nothing kept. A learner's free text is read for obvious typing
// slips in EVERYDAY words ("Expalin" -> "Explain", "managment" -> "management"), so the page can show what was understood
// and the risk classification can read the words the learner meant. It never changes what is clinically significant:
//
//   left exactly as typed   anything with a digit (5 mg, 0.9%, NEWS2), anything with / % = (mmol/L), ALL-CAPS and mixed
//                           case (UTI, COPD, SBAR, eGFR), a Capitalised word mid-sentence (a name), words under 4 letters,
//                           words with an apostrophe, medicine names (the bundled list and medicine-like endings such as
//                           -cillin, -pril, -olol), medical terms, and every word of the learner's own material.
//   corrected               only an UNKNOWN word with exactly ONE nearest known word (Damerau distance 1, or 2 for words
//                           of 8+ letters, keeping the first letter or swapping the first two) that is an everyday word --
//                           never a medicine, a medical term, a clinical value (left/right, high/low, once/twice, numbers,
//                           routes, negation) or medicine-like. A capitalised word only for a swapped, missing or extra
//                           letter (a name such as "John" is never "Join"); a replaced letter only in words of 8+ letters
//                           ("triad" is never "trial"). A few informal short forms ("giv", "wat").
//   asked, not changed      a tie, or a nearest word that is a medicine, a medical term or a clinical value
//                           ("amoxicilin" -> did you mean amoxicillin?): needsClarification, the text as typed.
//
// British and American spellings (paediatric/pediatric, aetiology/etiology, -ise/-ize ...) are both always valid. With
// `variant` set, ONLY those pairs are converted; nothing else changes because of it.
//
// Casing and punctuation are kept: a correction keeps the word's capital, and only the word itself is replaced.

import { CLINICAL_VALUE_WORDS, DRUG_NAMES, DRUG_SUFFIXES, GENERAL_WORDS, IZE_STEMS, MEDICAL_WORDS, SHORT_FORMS, VARIANT_PAIRS } from "./spelling-vocabulary";

export type SpellingVariant = "en-GB" | "en-US";
export type SpellingOptions = { variant?: SpellingVariant; vocabulary?: readonly string[] };
export type SpellingCorrection = { from: string; to: string; index: number };
export type SpellingClarification = { token: string; index: number; candidates: string[] };
export type NormalisedText = {
  /** The text with corrections applied: for display ("we read this as ...") and classification, never for marking. */
  display: string;
  /** Exactly what the learner typed. Store and mark this one. */
  original: string;
  corrections: SpellingCorrection[];
  needsClarification: SpellingClarification[];
};

const MAX_TEXT = 8000, MAX_VOCAB_WORDS = 20000, MIN_LEN = 4, MAX_LEN = 30;

// ── the lexicon, built once ───────────────────────────────────────────────────────────────────────────────────
const GENERAL = new Set(GENERAL_WORDS), MEDICAL = new Set(MEDICAL_WORDS), DRUGS = new Set(DRUG_NAMES), VALUE = new Set(CLINICAL_VALUE_WORDS);

/** Variant-insensitive key: both spellings of a pair, and every inflection, map to one key (lookup only). */
const US_FRAGMENTS: readonly [RegExp, string][] = [
  [/haem/g, "hem"], [/aem/g, "em"], [/aetiol/g, "etiol"], [/anaes/g, "anes"], [/paed/g, "ped"], [/oedem/g, "edem"], [/oesoph/g, "esoph"],
  [/oestr/g, "estr"], [/foet/g, "fet"], [/faec/g, "fec"], [/rrhoe/g, "rrhe"], [/pnoe/g, "pne"], [/gynaec/g, "gynec"],
  [/our(s?)$/, "or$1"], [/tre(s?)$/, "ter$1"], [/is(e|ed|es|ing|ation|ations)$/, "iz$1"], [/ys(e|ed|es|ing)$/, "yz$1"], [/ogue$/, "og"],
];
const usKey = (w: string) => US_FRAGMENTS.reduce((s, [re, to]) => s.replace(re, to), w);

const ALL_WORDS = [...new Set([...GENERAL_WORDS, ...MEDICAL_WORDS, ...DRUG_NAMES, ...CLINICAL_VALUE_WORDS, ...VARIANT_PAIRS.flat()])];
const KNOWN_KEYS = new Set(ALL_WORDS.map(usKey));

/** Variant conversions, both ways, with -ise/-ize inflections generated. */
const IZE_ENDINGS = [["ise", "ize"], ["ised", "ized"], ["ises", "izes"], ["ising", "izing"], ["isation", "ization"], ["isations", "izations"]] as const;
const TO_US = new Map<string, string>(), TO_GB = new Map<string, string>();
for (const [gb, us] of VARIANT_PAIRS) { TO_US.set(gb, us); TO_GB.set(us, gb); }
for (const stem of IZE_STEMS) for (const [gb, us] of IZE_ENDINGS) { TO_US.set(stem + gb, stem + us); TO_GB.set(stem + us, stem + gb); }
for (const k of [...TO_US.keys(), ...TO_GB.keys()]) KNOWN_KEYS.add(usKey(k));

/** Inflected forms reduced to the forms a list holds (plural, past, -ing, -ly, -er). */
function stems(w: string): string[] {
  const out = [w];
  const add = (s: string) => { if (s.length >= 2) out.push(s); };
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  if (w.endsWith("ed")) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) add(w.slice(0, -3)); }
  if (w.endsWith("ing")) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); if (w.length > 5 && w[w.length - 4] === w[w.length - 5]) add(w.slice(0, -4)); }
  if (w.endsWith("ly")) { add(w.slice(0, -2)); if (w.endsWith("ily")) add(w.slice(0, -3) + "y"); }
  if (w.endsWith("er")) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith("est")) add(w.slice(0, -3));
  if (w.endsWith("al")) add(w.slice(0, -2));
  if (w.endsWith("ness")) add(w.slice(0, -4));
  if (w.endsWith("ment")) add(w.slice(0, -4));
  return out;
}
const isKnown = (w: string, material: ReadonlySet<string>) => stems(w).some(s => KNOWN_KEYS.has(usKey(s)) || material.has(s));
/** A medicine name by its ending (7+ letters, so everyday words such as "done" or "spam" are never caught). */
const DRUG_LIKE = new RegExp(`(${[...DRUG_SUFFIXES].sort((a, b) => b.length - a.length).join("|")})$`);
export const isDrugLike = (w: string) => DRUGS.has(w.toLowerCase()) || (w.length >= 7 && DRUG_LIKE.test(w.toLowerCase()));
/** Shaped like a medical term: never silently corrected to an everyday word. */
const MEDICAL_SHAPE = /(itis|osis|aemia|emia|ectomy|otomy|ostomy|ology|algia|plasia|trophy|uria|pnoea|pnea|cardi|neur|nephr|hepat|gastr|pulmon|derm|haem|hyper|hypo|thromb|oma|path|scop|gram)/;

/** Damerau (optimal string alignment) distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let prev2: number[] = [], prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[m];
}

/** Pure: the learner's material words, lower case, letters only (a vocabulary for normaliseLearnerText). */
export function vocabularyOf(texts: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const w of (t ?? "").toLowerCase().match(/[a-z]{2,}/g) ?? []) { out.add(w); if (out.size >= MAX_VOCAB_WORDS) return [...out]; }
  }
  return [...out];
}

/** Same length, letters replaced rather than swapped ("john" / "join"), the shape of a different word, not a slip. */
const substitutionOnly = (a: string, b: string) => a.length === b.length && [...a].sort().join("") !== [...b].sort().join("");

const keepCase =(from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

type Decision = { kind: "keep" } | { kind: "correct"; to: string } | { kind: "ask"; candidates: string[] };

function decide(token: string, sentenceStart: boolean, material: ReadonlySet<string>, pool: readonly string[], variant: SpellingVariant | undefined): Decision {
  const short = token === token.toLowerCase() && Object.prototype.hasOwnProperty.call(SHORT_FORMS, token) ? SHORT_FORMS[token] : undefined;
  if (short && !material.has(token)) return { kind: "correct", to: short };
  if (token.length < MIN_LEN || token.length > MAX_LEN) return { kind: "keep" };
  // ALL-CAPS and mixed case (UTI, COPD, eGFR): an abbreviation or a name. A capital mid-sentence: a name.
  if (/[A-Z]/.test(token.slice(1))) return { kind: "keep" };
  if (/^[A-Z]/.test(token) && !sentenceStart) return { kind: "keep" };
  const w = token.toLowerCase();
  if (variant) {
    const to = (variant === "en-US" ? TO_US : TO_GB).get(w);
    if (to) return { kind: "correct", to };
  }
  if (isKnown(w, material) || isDrugLike(w)) return { kind: "keep" };
  // Distance 2 only for longer words; a typing slip keeps the first letter (or swaps the first two).
  const max = w.length >= 8 ? 2 : 1;
  let best = max + 1, near: string[] = [];
  for (const cand of pool) {
    if (Math.abs(cand.length - w.length) > max) continue;
    if (cand[0] !== w[0] && !(cand[0] === w[1] && cand[1] === w[0])) continue;
    const d = editDistance(w, cand, max);
    if (d < best) { best = d; near = [cand]; } else if (d === best && !near.includes(cand)) near.push(cand);
  }
  if (best > max || !near.length) return { kind: "keep" };
  const only = near.length === 1 ? near[0] : null;
  const safeTarget = !!only && GENERAL.has(only) && !MEDICAL.has(only) && !DRUGS.has(only) && !VALUE.has(only) && !isDrugLike(only);
  // A capitalised word may be a name ("John" is not "Join"): only a swapped, missing or extra letter is a slip there.
  const capital = /^[A-Z]/.test(token);
  if (safeTarget && capital && (w.length < 5 || substitutionOnly(w, only!))) return { kind: "keep" };
  // A replaced letter in a short word is as likely another real word the lists do not hold ("triad" is not "trial",
  // "older" is not "order"): only longer words are corrected for it. Swapped, missing and extra letters are slips.
  if (safeTarget && w.length < 8 && substitutionOnly(w, only!)) return { kind: "keep" };
  if (safeTarget && !MEDICAL_SHAPE.test(w)) return { kind: "correct", to: only! };
  // A medical-shaped word near only everyday words is left alone (probably a term the lists do not hold).
  if (MEDICAL_SHAPE.test(w) && near.every(c => GENERAL.has(c) && !MEDICAL.has(c) && !DRUGS.has(c))) return { kind: "keep" };
  return { kind: "ask", candidates: near.sort().slice(0, 3) };
}

/**
 * Pure: a learner's text with obvious everyday-word typing slips corrected, and near misses of clinical words asked.
 * `vocabulary`: the learner's material words (vocabularyOf), never corrected. `variant`: convert British / American
 * pairs to one spelling (nothing else changes because of it).
 */
export function normaliseLearnerText(text: string, opts: SpellingOptions = {}): NormalisedText {
  const original = typeof text === "string" ? text : "";
  const src = original.slice(0, MAX_TEXT);
  const material = new Set((opts.vocabulary ?? []).slice(0, MAX_VOCAB_WORDS).map(v => v.toLowerCase()).filter(v => /^[a-z]{2,}$/.test(v)));
  const pool = [...new Set([...ALL_WORDS, ...material])];
  const corrections: SpellingCorrection[] = [], needsClarification: SpellingClarification[] = [];
  for (const m of src.matchAll(/\S+/g)) {
    const chunk = m[0], at = m.index ?? 0;
    // A number, a dose, a unit or a value: untouched whole (5mg, 0.9%, mmol/L, NEWS2, 10:00, x=3).
    if (/[0-9%/\\=+<>@#_:;|]/.test(chunk.replace(/[:;]+$/, ""))) continue;
    const lead = chunk.match(/^[^A-Za-z]*/)![0], trail = chunk.match(/[^A-Za-z]*$/)![0];
    const core = chunk.slice(lead.length, chunk.length - trail.length);
    if (!core || /[^A-Za-z'’-]/.test(core)) continue;
    const before = src.slice(0, at).replace(/[ \t]+$/, "");
    const sentenceStart = !before.trim() || /[.!?\n]$/.test(before);
    let offset = at + lead.length;
    core.split("-").forEach((part, i) => {
      const index = offset;
      offset += part.length + 1;
      if (!part || /['’]/.test(part)) return;
      const d = decide(part, sentenceStart && i === 0, material, pool, opts.variant);
      if (d.kind === "correct" && d.to !== part.toLowerCase()) corrections.push({ from: part, to: keepCase(part, d.to), index });
      else if (d.kind === "ask") needsClarification.push({ token: part, index, candidates: d.candidates });
    });
  }
  let display = src;
  for (const c of [...corrections].sort((a, b) => b.index - a.index)) display = display.slice(0, c.index) + c.to + display.slice(c.index + c.from.length);
  return { display: display + original.slice(MAX_TEXT), original, corrections, needsClarification };
}

/**
 * Pure: the readings of a request the risk classification reads -- what was typed, the corrected reading and, where a
 * word was only asked about, a reading with its candidates beside it. The classifier takes the MORE CAUTIOUS result over
 * all of them (request-intent.ts cautiousIntentFeatures), so a correction can only ever add caution.
 */
export function classificationReadings(text: string, opts: SpellingOptions = {}): { readings: string[]; normalised: NormalisedText } {
  const n = normaliseLearnerText(text, opts);
  let probe = n.display;
  if (n.needsClarification.length) {
    // Indexes are into the original; re-find each asked token in the display, left to right.
    let from = 0;
    for (const q of n.needsClarification) {
      const i = probe.indexOf(q.token, from);
      if (i < 0) continue;
      const add = `${q.token} ${q.candidates.join(" ")}`;
      probe = probe.slice(0, i) + add + probe.slice(i + q.token.length);
      from = i + add.length;
    }
  }
  return { readings: [...new Set([n.original, n.display, probe])], normalised: n };
}

/** What a page is told about how a learner's text was read: nothing when it was read exactly as typed. Display only. */
export type SpellingNotice = { spelling?: { display: string; corrections: SpellingCorrection[]; needsClarification: SpellingClarification[] } };
export const spellingNotice = (n: NormalisedText): SpellingNotice =>
  n.corrections.length || n.needsClarification.length ? { spelling: { display: n.display, corrections: n.corrections, needsClarification: n.needsClarification } } : {};

/**
 * SCHOLAR-LEARN-GAPS-02 item 3: what an answer route tells the page about how a learner's free-text ANSWER was read:
 * { spelling: { display, original, corrections, needsClarification } }, or nothing when it was read exactly as typed.
 * Display only. The answer that is marked and stored is `original`, exactly as typed; the classification of the request
 * reads the typed and the corrected readings and takes the more cautious (request-intent.ts cautiousIntentFeatures).
 */
export type AnswerSpelling = { display: string; original: string; corrections: { from: string; to: string }[]; needsClarification: SpellingClarification[] };
export function answerSpelling(text: string, opts: SpellingOptions = {}): { spelling?: AnswerSpelling } {
  const n = normaliseLearnerText(text, opts);
  return n.corrections.length || n.needsClarification.length
    ? { spelling: { display: n.display, original: n.original, corrections: n.corrections.map(c => ({ from: c.from, to: c.to })), needsClarification: n.needsClarification } }
    : {};
}
