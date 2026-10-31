import {
  DEFAULT_CONTENT_REVIEW, DEFAULT_MARKERS, reviewMatches, reviewOutcome,
  type ContentReviewPolicy, type ReviewAction,
} from "@/lib/ai/content-review";

// ── SCHOLAR FLASHCARDS: CLINICALLY SENSITIVE CONTENT, FLAGGED ── SCHOLAR-FLASHCARDS-QA-01 (owner, 31 Oct 2026) ─────────
//
// Pure, deterministic, no AI and no I/O. A card's own words (front, back, explanation, key points) and its topic are
// read against the CLINICAL EDUCATIONAL CONTENT REVIEW RULES (src/lib/ai/content-review.ts): HQ-configurable on the
// AI Fair Use page (platform / ai_content_review, path ai.content_review.scholar, published and rolled back through
// CONFIG-002), the built-in defaults where nothing is published. The caller passes the published policy and the
// learner's programme professions (flashcard-service.ts applyContentReview); without them, the defaults apply to all.
//
// A card that matches is FLAGGED -- never rewritten, never withheld, never judged correct or incorrect: a visible
// marker on the card in every download and in the study view (none for a "note only" rule), and a line in the
// revision guide's "Points to Verify". A Competen library card keeps its clinically reviewed standing in the marker.
//
// The defaults (content-review.ts DEFAULT_CONTENT_REVIEW) are the rules this file held as a constant before:
//   paediatric_rr      a child term AND a respiratory-rate term
//   oxygen_target      an oxygen-saturation term AND a percentage or a range
//   emergency_resp     an emergency or escalation term AND a respiratory term
//   copd_deterioration a COPD term AND a deterioration term
//   numeric_value      any numeric clinical value: a number with a clinical unit, a percentage, a range, a comparison
//                      ("above 5", ">= 88"). Ages and durations are not; nor is the 2 of SpO2.

/** The default rules, as the guide and the tests name them. */
export const CLINICAL_SENSITIVITY_RULES = DEFAULT_CONTENT_REVIEW.rules;
export const SENSITIVE_MARKER = DEFAULT_MARKERS.flag;

export type SensitiveFlag = {
  codes: string[];
  labels: string[];
  /** The card's own words that carry a value, at most four, as written. */
  values: string[];
  /** A Competen library card: clinically approved content, flagged less strongly. */
  reviewed: boolean;
  /** The strongest review action of the rules matched. */
  action: ReviewAction;
  /** The learner-facing marker on the card; null for a "note only" rule (listed in Points to Verify only). */
  marker: string | null;
};

export type SensitiveInput = {
  front: string; back: string; explanation?: string | null; keyPoints?: readonly string[]; topic?: string | null;
  origin: "notes" | "library" | "learner"; reviewedAt?: string | null;
};
export type SensitiveOptions = {
  /** The published rules (default: the built-in ones). */
  policy?: ContentReviewPolicy;
  /** The learner's programme professions; null or absent: not known, every rule applies. */
  professions?: readonly string[] | null;
  formatDate?: (iso: string) => string;
};

/**
 * Pure. Whether a card states something clinically sensitive, and what to mark it with -- or null. Flags only: the
 * card's words are unchanged. Library cards keep their clinically reviewed standing in the marker.
 */
export function sensitiveFlag(c: SensitiveInput, o: SensitiveOptions = {}): SensitiveFlag | null {
  const policy = o.policy ?? DEFAULT_CONTENT_REVIEW;
  const text = [c.front, c.back, c.explanation ?? "", ...(c.keyPoints ?? [])].join("\n");
  const hits = reviewMatches(policy, { text, topic: c.topic ?? null }, o.professions ?? null);
  const reviewed = c.origin === "library";
  const out = reviewOutcome(policy, hits, reviewed ? (c.reviewedAt ? (o.formatDate ?? (iso => iso.slice(0, 10)))(c.reviewedAt) : null) : false);
  if (!out) return null;
  const values = [...new Set(hits.flatMap(h => h.values))].slice(0, 4);
  return { codes: hits.map(h => h.rule.id), labels: hits.map(h => h.rule.label), values, reviewed, action: out.action, marker: out.marker };
}

/** Pure. sensitiveFlag of a card as the surfaces hold it (flashcards.ts FlashcardView): its library source's date, if any. */
export const cardSensitiveFlag = (c: SensitiveInput & { sources?: readonly { reference?: { reviewedAt?: string | null } | null }[] }, o: SensitiveOptions = {}) =>
  sensitiveFlag({ ...c, reviewedAt: c.reviewedAt ?? c.sources?.find(s => s.reference?.reviewedAt)?.reference?.reviewedAt ?? null }, o);
