import { TERM_GROUPS } from "../scholar/term-match";

// COMPETEN UNIVERSAL SEARCH STANDARD: one way a search box decides a match, for a list already read. Pure, no AI.
//
//   1. part of a word counts ("deterio" finds "deterioration");
//   2. a curated synonym counts: the closed TERM_GROUPS list, for example "sbar" and its expansion, or paediatric and pediatric;
//   3. one slip of the keyboard counts, in a word of five letters or more, starting with the same letter.
//
// ⚠ ONE SLIP, NEVER TWO. hypertension and hypotension are two edits apart, and so are hyperkalaemia and hypokalaemia, so a search
// for one must not bring back the other. Every word typed must match, so adding a word narrows the list.

export const normaliseSearch = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export const searchWords = (q: string | null | undefined) => normaliseSearch(q ?? "").split(" ").filter(Boolean);

/** One insertion, deletion, substitution or swap of neighbours between two words of five letters or more, with the same first letter. */
export function oneSlip(typed: string, word: string): boolean {
  if (typed === word) return true;
  if (typed.length < 5 || word.length < 5 || typed[0] !== word[0]) return false;
  const gap = Math.abs(typed.length - word.length);
  if (gap > 1) return false;
  let i = 0;
  while (i < typed.length && i < word.length && typed[i] === word[i]) i++;
  if (gap === 1) {
    const [short, long] = typed.length < word.length ? [typed, word] : [word, typed];
    return short.slice(i) === long.slice(i + 1);
  }
  if (typed.slice(i + 1) === word.slice(i + 1)) return true;
  return typed[i] === word[i + 1] && typed[i + 1] === word[i] && typed.slice(i + 2) === word.slice(i + 2);
}

const synonymsOf = (phrase: string): readonly string[] => TERM_GROUPS.find(g => g.includes(phrase))?.filter(m => m !== phrase) ?? [];

/** Does this text answer the search? An empty search matches everything. */
export function matchesSearch(text: string | readonly string[], q: string | null | undefined): boolean {
  const words = searchWords(q);
  if (!words.length) return true;
  const hay = normaliseSearch(typeof text === "string" ? text : text.join(" "));
  const whole = words.join(" ");
  if (hay.includes(whole) || synonymsOf(whole).some(s => hay.includes(s))) return true;
  const hayWords = hay.split(" ");
  return words.every(w => hay.includes(w) || synonymsOf(w).some(s => hay.includes(s)) || hayWords.some(h => oneSlip(w, h)));
}
