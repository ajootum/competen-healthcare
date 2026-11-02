import { PERSONAL_AI_LABEL, PERSONAL_AI_LABEL_CITED, PERSONAL_AI_LABEL_UNCITED } from "./config";
import { ASK_CHUNK_MAX } from "./ask-context";

// ── "ASK ABOUT THIS": WHAT AN ANSWER MAY SAY ABOUT ITS GROUNDING ── SCHOLAR-CE-2026 CE-01 (ask-grounding-01) ──────────────────────
//
// Pure. Production showed an answer written from the learner's notes under "general explanation, not checked against your notes":
// the label was one constant, shown whatever happened. It is now decided from two facts the server knows after the answer:
//   provided  how many of the learner's own sections were numbered and handed to the model ([S1]..[Sn])
//   cited     how many of those the answer actually cites (a tag naming a real section; an invented tag does not count)
//
//   provided 0               "none"    no section reached the model: general explanation (the original label)
//   provided > 0, cited 0    "uncited" the notes were given but the answer cites none: said so, NOT claimed as from the notes
//   provided > 0, cited > 0  "cited"   the answer draws on the sections it cites; the rest is marked General background
//
// ⚠ NEVER A CLAIM THAT DID NOT HAPPEN. An uncited answer is not relabelled "based on your notes": nothing shows which sentences came
//   from them, and the prompt's own rule is "never present an uncited claim as coming from their notes". It is also not re-asked: a
//   second metered call would double the quota, the cost and the wait for text the learner has already been shown streaming, and
//   the route's design is one AI call per question. The honest label is the cheaper, faster, consistent option.

export type Grounding = "none" | "uncited" | "cited";

export const groundingOf = (provided: number, cited: number): Grounding => (provided > 0 ? (cited > 0 ? "cited" : "uncited") : "none");

export const GROUNDING_LABELS: Record<Grounding, string> = { none: PERSONAL_AI_LABEL, uncited: PERSONAL_AI_LABEL_UNCITED, cited: PERSONAL_AI_LABEL_CITED };

/** Pure. The label an answer is shown under, from the sections given and the sections it cites. */
export const answerLabel = (provided: number, cited: number): string => GROUNDING_LABELS[groundingOf(provided, cited)];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure. The sections a saved lesson (a teaching artefact) asks about: the chunks it was taught from (its source links, in order),
 * well-formed, distinct, at most ASK_CHUNK_MAX. A saved lesson with no source link grounds nothing (the panel then says so).
 */
export function savedLessonChunkIds(sources: readonly string[] | null | undefined): string[] {
  return [...new Set((sources ?? []).filter(x => typeof x === "string" && UUID.test(x)).map(x => x.toLowerCase()))].slice(0, ASK_CHUNK_MAX);
}

/**
 * Pure. Which section ids ground an in-place question. A connected lesson's step supplies its sections (read by the server from the
 * learner's own session); when that step has none (a session whose step carries no section, or one that was not found), the panel's
 * own ids ground it instead, and are then ownership-checked like any claim. `viaClaims` says those ids are claims to be checked.
 */
export function askSectionIds(i: { hasSession: boolean; sessionIds: readonly string[]; claimedIds: readonly string[] }): { ids: string[]; viaClaims: boolean } {
  if (i.hasSession && i.sessionIds.length) return { ids: [...i.sessionIds], viaClaims: false };
  return { ids: [...i.claimedIds], viaClaims: true };
}
