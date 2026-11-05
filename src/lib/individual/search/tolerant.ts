import { TERM_GROUPS } from "../scholar/term-match";
import { normaliseSearch, oneSlip, searchWords } from "./match";

// COMPETEN UNIVERSAL SEARCH STANDARD, stage 2: spelling and synonyms for the two server searches (Learn and Saved learning). Pure, no AI.
// It works at the call sites and never inside retrieval.ts, whose terms are shared with grounding.
//
//   expandText       the query with the other members of each closed TERM_GROUPS entry added, for a search whose terms are ORed.
//   expandWebsearch  the same as alternatives joined with "or", for the saved-library search, where words are ANDed.
//   correctQuery     a word nobody in the learner's own vocabulary has is changed to the one word they do have that is ONE slip away.
//
// ⚠ ONE SLIP, NEVER TWO, and never a guess between two: hypotension is two edits from hypertension, so it is left alone. A word that
// has two possible corrections is left alone too. A correction only ever uses words from the learner's own topics and material titles.

const MAX = 200;
const synonymsOf = (phrase: string): string[] => TERM_GROUPS.find(g => g.includes(phrase))?.filter(m => m !== phrase) ?? [];

/** Pure. Each phrase of the query that the closed list knows (the whole query, then each word) with its synonyms. */
function knownPhrases(q: string): { phrase: string; synonyms: string[] }[] {
  const words = searchWords(q);
  const whole = words.join(" ");
  const out: { phrase: string; synonyms: string[] }[] = [];
  for (const p of new Set([whole, ...words])) {
    const synonyms = synonymsOf(p);
    if (synonyms.length) out.push({ phrase: p, synonyms });
  }
  return out;
}

/** Pure. The query, then the synonyms of what it says (never removing a word). The same text when the list knows nothing in it. */
export function expandText(q: string): string {
  const extra = knownPhrases(q).flatMap(k => k.synonyms);
  if (!extra.length) return q;
  return `${q} ${extra.join(" ")}`.slice(0, MAX);
}

/** Pure. For a websearch query: the original, then one alternative per synonym, joined with "or". A query the learner shaped (quotes, OR, a minus) is left as typed. */
export function expandWebsearch(q: string): string {
  if (/["]|(^|\s)-\S|\bor\b/i.test(q)) return q;
  const words = searchWords(q);
  const whole = words.join(" ");
  const variants: string[] = [];
  for (const s of synonymsOf(whole)) variants.push(s);
  words.forEach((w, i) => { for (const s of synonymsOf(w)) variants.push(words.map((x, j) => (j === i ? s : x)).join(" ")); });
  if (!variants.length) return q;
  let out = q;
  for (const v of [...new Set(variants)].slice(0, 6)) {
    const next = `${out} or ${v}`;
    if (next.length > MAX) break;
    out = next;
  }
  return out;
}

/** Pure. Every word of the learner's own topic names and material titles, tidied. */
export function vocabularyOf(texts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of searchWords(t)) out.add(w);
  return out;
}

export type Correction = { text: string; changed: boolean };

/** Pure. A word of five letters or more that the vocabulary does not hold (not even the start of a word) becomes the one vocabulary word a single slip away. */
export function correctQuery(q: string, vocabulary: ReadonlySet<string>): Correction {
  const words = searchWords(q);
  let changed = false;
  const fixed = words.map(w => {
    if (w.length < 5 || vocabulary.has(w)) return w;
    const list = [...vocabulary];
    if (list.some(v => v.startsWith(w))) return w;
    const candidates = list.filter(v => v !== w && oneSlip(w, v));
    if (candidates.length !== 1) return w;
    changed = true;
    return candidates[0];
  });
  return { text: normaliseSearch(fixed.join(" ")), changed };
}
