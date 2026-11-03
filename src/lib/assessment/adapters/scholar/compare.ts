import { DEFAULT_MASTERY_THRESHOLDS } from "@/lib/individual/scholar/mastery";
import { experienceHref } from "@/lib/individual/experiences";
import { withStudy } from "@/lib/individual/scholar/study-carry";

// ── SELF-RATING AGAINST DEMONSTRATED PRACTICE ── Checklist Studio S3, owner addendum 5 ───────────────────────────────
//
// Pure. COMPARE puts a competency's latest SELF rating beside what the learner's linked practice shows, in three bands each,
// and says in fixed, non-clinical words whether they point the same way.
//
//   self band      the rating as a share of the scale: 0-1 lower, 2-3 middle, 4-6 higher on a 0-6 scale. Cut points are the thirds of the
//                  scale, so any scale works, and no profession or framework is named.
//   evidence band  the latest practice accuracy against the SAME thresholds Progress uses for "needs work" and "going well"
//                  (DEFAULT_MASTERY_THRESHOLDS: below 50 lower, 50 to 79 middle, 80 or more higher), and only with enough answered
//                  questions (the same minimum Progress asks before it says "going well").
//
// ⚠ NEVER ALTERS A SELF RATING. Nothing here returns, stores or suggests a different rating: a difference is words and links.
// ⚠ NOT A JUDGEMENT OF COMPETENCE. Practice accuracy on a learner's own notes is formative, and the wording says "practice results".

export type Band = "lower" | "middle" | "higher";
export const BAND_ORDER: readonly Band[] = ["lower", "middle", "higher"];
export const BAND_LABEL: Record<Band, string> = { lower: "Lower", middle: "Middle", higher: "Higher" };

/** The band of a self rating on a scale whose highest ordinal is `max`. Null when there is no rating or no scale. */
export function selfBand(rating: number | null, max: number | null): Band | null {
  if (rating === null || max === null || max <= 0) return null;
  const share = Math.max(0, Math.min(1, rating / max));
  return share < 1 / 3 - 1e-9 ? "lower" : share < 2 / 3 - 1e-9 ? "middle" : "higher";
}

export type PracticeEvidence = { latestAccuracy: number | null; answered: number; sectionsAccepted: number };

/** The band of the linked practice, or null when there is too little to say anything. */
export function evidenceBand(e: PracticeEvidence | null, t = DEFAULT_MASTERY_THRESHOLDS): Band | null {
  if (!e || e.latestAccuracy === null || e.answered < t.secureMinEvidence) return null;
  return e.latestAccuracy < t.developingPercent ? "lower" : e.latestAccuracy < t.securePercent ? "middle" : "higher";
}

export type CompareState = "no_self" | "no_evidence" | "aligned" | "self_higher" | "evidence_higher";

export function compareBands(self: Band | null, evidence: Band | null): CompareState {
  if (self === null) return "no_self";
  if (evidence === null) return "no_evidence";
  const d = BAND_ORDER.indexOf(self) - BAND_ORDER.indexOf(evidence);
  return d === 0 ? "aligned" : d > 0 ? "self_higher" : "evidence_higher";
}

/** The fixed wording for each state. `title` is the competency. Nothing clinical, nothing about the person beyond their own two figures. */
export function feedbackText(state: CompareState, title: string): string {
  switch (state) {
    case "self_higher": return `Your self-rating is higher than your recent practice results suggest. Practising ${title} may help you confirm it.`;
    case "evidence_higher": return `Your recent practice results are higher than your self-rating. Repeating your self-assessment after more practice may show where you stand now.`;
    case "aligned": return "Your self-rating and your recent practice results point the same way.";
    case "no_evidence": return `There is not enough practice linked to ${title} to compare with yet. Linking sections of your notes to it, and answering practice questions, lets your practice count here.`;
    case "no_self": return `You have not rated yourself on ${title} yet. A self-assessment lets you compare your own view with your practice.`;
  }
}

/** Whether the two views differ (the words that matter most are shown first when they do). */
export const differs = (s: CompareState): boolean => s === "self_higher" || s === "evidence_higher";

export type ActionLink = { key: "learn" | "revise" | "apply" | "evaluate"; label: string; href: string };

/** The existing My Learning functions a competency leads to. Learn takes the competency; the others open their space. Carries ?study= when a session is open. */
export function learningLinks(competencyId: string, study: string | null | undefined): ActionLink[] {
  const to = (seg: string) => withStudy(experienceHref("scholar", `study/${seg}`), study);
  return [
    { key: "learn", label: "Learn", href: withStudy(experienceHref("scholar", `study/learn?competency=${encodeURIComponent(competencyId)}`), study) },
    { key: "revise", label: "Revise", href: to("revise") },
    { key: "apply", label: "Apply", href: to("apply") },
    { key: "evaluate", label: "Evaluate", href: to("evaluate") },
  ];
}
