import { TERM_GROUPS } from "../scholar/term-match";

// COMPETEN UNIVERSAL SEARCH STANDARD: one way a search box decides a match, for a list already read. Pure, no AI.
//
//   1. part of a word counts ("deterio" finds "deterioration");
//   2. a curated synonym counts, as whole words: the closed TERM_GROUPS list, for example "uti" and its expansion;
//   3. one slip of the keyboard counts, in a word of five letters or more: a letter missed, doubled or swapped with its neighbour.
//
// ⚠ A SLIP MUST NEVER TURN ONE CLINICAL TERM INTO ANOTHER. A different letter is not a slip: abduction and adduction, dysphagia
// and dysphasia, perineal and peroneal and ileum and ilium each differ by one letter and mean different things, so a replaced
// letter never counts. Words starting "hyp" never get a slip at all, because a typo there can sit one step from both opposites
// ("hypetension" from hypertension and hypotension). CONFUSABLE holds the pairs one missed letter apart. An honest "nothing
// matches" is better than the wrong term. Every word typed must match, so adding a word narrows the list.

/** Different meanings, one missed letter apart. Closed. Neither ever stands in for the other. */
const CONFUSABLE: readonly (readonly [string, string])[] = [["prostate", "prostrate"], ["colic", "cholic"], ["insulin", "inulin"]];

export const normaliseSearch = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export const searchWords = (q: string | null | undefined) => normaliseSearch(q ?? "").split(" ").filter(Boolean);

/** One letter missed, added or swapped with its neighbour, between two words of five letters or more with the same first letter. Never a replaced letter, never a "hyp" word, never a confusable pair. */
export function oneSlip(typed: string, word: string): boolean {
  if (typed === word) return true;
  if (typed.length < 5 || word.length < 5 || typed[0] !== word[0]) return false;
  if (typed.startsWith("hyp") || word.startsWith("hyp")) return false;
  if (CONFUSABLE.some(([a, b]) => (typed === a && word === b) || (typed === b && word === a))) return false;
  const gap = Math.abs(typed.length - word.length);
  if (gap > 1) return false;
  let i = 0;
  while (i < typed.length && i < word.length && typed[i] === word[i]) i++;
  if (gap === 1) {
    const [short, long] = typed.length < word.length ? [typed, word] : [word, typed];
    return short.slice(i) === long.slice(i + 1);
  }
  return typed[i] === word[i + 1] && typed[i + 1] === word[i] && typed.slice(i + 2) === word.slice(i + 2);
}

const synonymsOf = (phrase: string): readonly string[] => TERM_GROUPS.find(g => g.includes(phrase))?.filter(m => m !== phrase) ?? [];

/** Does this text answer the search? An empty search matches everything. */
export function matchesSearch(text: string | readonly string[], q: string | null | undefined): boolean {
  const words = searchWords(q);
  if (!words.length) return true;
  const hay = normaliseSearch(typeof text === "string" ? text : text.join(" "));
  // A synonym counts as whole words: "uti" must not find "solution", nor "ppe" find "appendicitis".
  const bounded = ` ${hay} `;
  const hasSynonym = (phrase: string) => synonymsOf(phrase).some(s => bounded.includes(` ${s} `));
  const whole = words.join(" ");
  if (hay.includes(whole) || hasSynonym(whole)) return true;
  const hayWords = hay.split(" ");
  return words.every(w => hay.includes(w) || hasSynonym(w) || hayWords.some(h => oneSlip(w, h)));
}
