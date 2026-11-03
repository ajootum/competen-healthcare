// SCHOLAR-UNDERSTANDING-CHECKS-01 (owner instruction 3 Nov 2026): THE UNDERSTANDING CHECK'S FEEDBACK. Pure and client-safe:
// no server imports, so the Learn workspace reads the same parser the engine (generation.ts LEARN_INSTRUCTION.clarify) writes with.
//
// A clarification (the judgement of the learner's written answer to a check question) is written in labelled parts after its
// VERDICT line, each line starting with its label, in the same plain form as a Teach Me answer (teach-format.ts):
//   RIGHT:           what the answer got right, cited
//   MISSING:         the important points of the passages the answer left out, cited
//   MISCONCEPTIONS:  each mistaken idea or step of reasoning, corrected from the passages, cited
//   KEY POINTS:      the key learning points a complete answer gives -- a model answer from the passages, cited
//   NEXT:            one short thing to revise or try next, from the passages, cited
// A clarification written before the structure (PROMPT_VERSIONS.learnClarify) carries none of the labels: parseCheckFeedback
// returns null and the feedback is shown as it was written.
//
// TWO PATHWAYS, both formative and neither competence: (b) the AI judgement above, where the standing, the allowance and the
// clinical-risk gate allow it; (a) SELF-REVIEW with no AI call -- the saved lesson's own key points (the reference answer) and the
// sections the question cites, which the learner compares their answer against. A written answer in the learner's own words is
// never marked by code: the copy says so (CHECK_SELF_REVIEW_NOTE), and nothing records a verdict for a self-review.

import { citedTags } from "./teach-format";

export type CheckFeedbackParts = { right: string[]; missing: string[]; misconceptions: string[]; keyPoints: string[]; next: string | null };

export const CHECK_LABEL = { right: "RIGHT:", missing: "MISSING:", misconceptions: "MISCONCEPTIONS:", keyPoints: "KEY POINTS:", next: "NEXT:" } as const;
/** How each part is headed where it is shown. */
export const CHECK_FEEDBACK_HEADING: Record<keyof CheckFeedbackParts, string> = {
  right: "What you got right", missing: "What was missing", misconceptions: "Misconceptions or incorrect reasoning",
  keyPoints: "Key learning points: a model answer from your notes", next: "What to revise next",
};

type Part = keyof CheckFeedbackParts;
// A label at the start of a line, tolerating the markdown a model adds anyway (**, #, >, -) and any case.
const LABEL_RE: Record<Part, RegExp> = {
  right: /^[\s*_#>-]*right\s*:[\s*_]*/i,
  missing: /^[\s*_#>-]*missing\s*:[\s*_]*/i,
  misconceptions: /^[\s*_#>-]*misconceptions?\s*:[\s*_]*/i,
  keyPoints: /^[\s*_#>-]*key\s+(?:learning\s+)?points\s*:[\s*_]*/i,
  next: /^[\s*_#>-]*next\s*:[\s*_]*/i,
};
const PARTS = Object.keys(LABEL_RE) as Part[];
const bullet = (l: string) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l);
/** "None spotted.", "Nothing to correct.", "Nothing important missing.", "none": a part with nothing in it. */
export const isNonePoint = (s: string) => /^\s*(?:none|nothing|n\/a|-)(?:\s+(?:spotted|to correct|important missing|missing|to add|wrong))?\s*[.!]?\s*$/i.test(s);

/** Pure. The bullets of one part: a bullet line starts a point; a line that is not one carries the point before it on (a wrapped line). */
function pointsOf(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    if (isBullet(l) || !out.length) out.push(bullet(l)); else out[out.length - 1] = `${out[out.length - 1]} ${l.trim()}`;
  }
  return out.filter(p => p && !isNonePoint(p));
}

/** Pure. The labelled parts of a clarification (its VERDICT line already taken off), or null when it carries no label (an older one). */
export function parseCheckFeedback(text: string): CheckFeedbackParts | null {
  const buckets: Record<Part, string[]> = { right: [], missing: [], misconceptions: [], keyPoints: [], next: [] };
  let at: Part | null = null, seen = false;
  for (const line of text.split("\n")) {
    const hit = PARTS.find(p => LABEL_RE[p].test(line));
    if (hit) { at = hit; seen = true; const rest = line.replace(LABEL_RE[hit], "").trim(); if (rest) buckets[hit].push(rest); continue; }
    if (at) buckets[at].push(line);
  }
  if (!seen) return null;
  const next = buckets.next.map(l => bullet(l)).filter(Boolean).join(" ").trim();
  return { right: pointsOf(buckets.right), missing: pointsOf(buckets.missing), misconceptions: pointsOf(buckets.misconceptions), keyPoints: pointsOf(buckets.keyPoints), next: next && !isNonePoint(next) ? next : null };
}

/** A reply's source, as the Learn workspace holds it (the fields the self-review needs). */
export type CheckSource = { tag: string; chunkId: string; materialId: string; citation: string; excerpt?: string };

/**
 * Pure. THE REFERENCE ANSWER for self-review (no AI): the saved lesson's key points, and the sections the question cites (its own
 * [S n] tags), or every section the lesson rests on when the question cites none. `rawQuestion` is the question as the engine
 * wrote it, tags included; the display form (teach-format.ts questionText) has none.
 */
export function referenceAnswer(input: { rawQuestion: string | null | undefined; lessonPoints: readonly string[]; sources: readonly CheckSource[] }): { points: string[]; sources: CheckSource[] } {
  const tags = new Set(citedTags(input.rawQuestion ?? "").map(n => `S${n}`));
  const cited = input.sources.filter(s => tags.has(s.tag));
  return { points: input.lessonPoints.filter(p => p.trim()), sources: cited.length ? cited : [...input.sources] };
}

// ── THE WORDS ──

/** While the answer is being judged (a live region beneath the answer, where the learner is). */
export const CHECK_PROCESSING = "Scholar is reading your answer against your notes…";
/** Why the AI judgement is not shown, by what happened. Every case leads to the self-review, so the learner is never left without a response. */
export const CHECK_NO_AI_WHY = {
  unavailable: "Scholar cannot judge this answer with AI just now.",
  withheld: "Scholar wrote a judgement but it was not shown, because it did not stay within your notes.",
  continuity: "No new AI judgement right now.",
  error: "Scholar could not judge your answer just now.",
  clarify: "Scholar needs to know what this answer is for before it judges it, or you can compare it with your notes yourself.",
} as const;
export type CheckNoAiReason = keyof typeof CHECK_NO_AI_WHY;
/** The honest words of the self-review (pathway a): nothing marks a written answer by code. */
export const CHECK_SELF_REVIEW_NOTE = "A written answer in your own words cannot be marked by code. Compare it with the key points from your notes and decide for yourself what you covered and what you missed. Nothing is recorded as a result.";
export const CHECK_SELF_REVIEW_LABEL = "Compare with your notes";
export const CHECK_BUTTON = { again: "Try again", source: "Review source", continue: "Continue learning", skip: "Skip the check", submit: "Check my answer", submitting: "Checking…" } as const;
