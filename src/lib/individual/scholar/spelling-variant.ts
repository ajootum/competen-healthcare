// ── SCHOLAR-LEARN-GAPS-02 item 4: THE SPELLING PREFERENCE ─────────────────────────────────────────────────────────────────
//
// British, American, or leave as typed, for the corrections spelling.ts makes (normaliseLearnerText `variant`). Client-safe.
//
// WHERE IT IS KEPT: on this device (localStorage `scholar.spelling.variant`), sent with each request as `spellingVariant`.
// No migration, and no existing per-person store fits honestly: individual_scholar_learning_preference has CHECKed columns
// (depth, mode ...), and user_preferences (164) is a CHECKed catalogue whose `language` is the interface language and whose
// `notes` is free text -- storing a spelling choice there would be a hack, not a setting. It is a display preference only: it
// never changes what is stored or marked, and an unreadable value is "leave as typed".

import type { SpellingVariant } from "./spelling";

export const SPELLING_VARIANT_KEY = "scholar.spelling.variant";
export type SpellingChoice = SpellingVariant | "none";
export const SPELLING_CHOICES: readonly SpellingChoice[] = ["none", "en-GB", "en-US"];
export const SPELLING_CHOICE_LABEL: Record<SpellingChoice, string> = { none: "Leave as typed", "en-GB": "British", "en-US": "American" };

/** Pure. A request's `spellingVariant`: en-GB or en-US, else undefined (leave as typed). Never throws. */
export function parseSpellingVariant(v: unknown): SpellingVariant | undefined {
  return v === "en-GB" || v === "en-US" ? v : undefined;
}

/** Pure. The stored choice, or "none" for anything unreadable. */
export function parseSpellingChoice(raw: unknown): SpellingChoice {
  return raw === "en-GB" || raw === "en-US" ? raw : "none";
}

/** The request field for a choice: nothing for "leave as typed". */
export const spellingField = (c: SpellingChoice): { spellingVariant?: SpellingVariant } => (c === "none" ? {} : { spellingVariant: c });

/** This device's choice (browser only). */
export function readSpellingChoice(): SpellingChoice {
  try { return parseSpellingChoice(window.localStorage.getItem(SPELLING_VARIANT_KEY)); } catch { return "none"; }
}
export function writeSpellingChoice(c: SpellingChoice): void {
  try { if (c === "none") window.localStorage.removeItem(SPELLING_VARIANT_KEY); else window.localStorage.setItem(SPELLING_VARIANT_KEY, c); } catch { /* this visit only */ }
}
