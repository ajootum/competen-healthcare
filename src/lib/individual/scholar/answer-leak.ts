// ── ANSWER LEAKAGE ── one rule for "the question gives its own answer away" ─────────────────────────────────────────
//
// SQIE-CLOSE-2026-11 WS-H (owner GO SALE-2026-11, 4 Nov 2026; quality requirement 4: "avoid revealing the answer in the question
// stem or preceding scenario"). The rule CE-05 wrote for evolving scenarios (`scenario.ts` scenarioFlaw, "answer_leaked"),
// moved here unchanged so every format uses the same one: an answer of two or more content words leaks when its words appear,
// in order and all together, in the text shown before it is answered. Normalised (lower case, letters and digits), articles and
// the like dropped, NO synonyms. A single-word answer is not held to the rule: one word ("sepsis") is often just the topic.
//
// Pure and dependency-free.

const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "is", "are", "was", "were", "and", "or", "for", "with", "by", "as", "it", "its", "this", "that", "be", "from", "than", "then"]);
const words = (t: string): string[] => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const contentWords = (t: string): string[] => words(t).filter(w => !STOP.has(w));

/** Pure. Whether the words of `answer` appear, in order and all together, in `text`. A one-word answer never does (see above). */
export function containsAnswer(text: string, answer: string): boolean {
  const need = contentWords(answer);
  if (need.length < 2) return false; // a single word is not held to this rule
  const have = contentWords(text);
  for (let i = 0; i + need.length <= have.length; i++) if (need.every((w, k) => have[i + k] === w)) return true;
  return false;
}

/**
 * Pure. A choice question (single best answer, case or multiple response) whose stem gives its key away: EVERY keyed option is
 * in the stem and NO other option is. A stem that names two options to choose between ("oral or intravenous antibiotics?")
 * names a wrong one too, so it is not a leak.
 */
export function choiceLeaks(stem: string, options: readonly string[], keyed: readonly number[]): boolean {
  if (!keyed.length) return false;
  const inStem = options.map(o => containsAnswer(stem, o));
  return keyed.every(i => inStem[i]) && !options.some((_, i) => !keyed.includes(i) && inStem[i]);
}

/** Pure. A written answer (short answer, or one part of a structured item) given away by the text shown with it: any accepted answer in it. */
export const writtenLeaks = (shown: string, accepted: readonly string[]): boolean => accepted.some(a => containsAnswer(shown, a));
