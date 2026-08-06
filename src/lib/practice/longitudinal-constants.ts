// CPR-ENC-003's longitudinal vocabulary, in a module with NO SERVER IMPORTS.
//
// The three-state readers below are PURE FUNCTIONS on purpose. They are the sentences a prescriber
// reads, they are shared by a server page and a client panel, and they are the only part of this build
// where getting it wrong is a clinical harm rather than an inconvenience -- so they are testable without
// a database, and the harness tests them directly.

/** CPR-ENC-003 s6's eight examples, plus `other`. Mirrors migration 238's CHECK exactly. */
export const MILESTONE_KINDS: [string, string][] = [
  ["first_consultation", "First consultation"],
  ["diagnosis_confirmed", "Diagnosis confirmed"],
  ["surgery_performed", "Surgery performed"],
  ["long_term_treatment_started", "Long-term treatment started"],
  ["significant_improvement", "Significant improvement"],
  ["relapse", "Relapse"],
  ["transition_to_adult_care", "Transition to adult care"],
  ["discharged_from_follow_up", "Discharged from follow-up"],
  ["other", "Other"],
];

export const MILESTONE_KIND_CODES = MILESTONE_KINDS.map(([k]) => k);

/**
 * ⚠ NOTHING IN THIS PRODUCT MAY DERIVE A MILESTONE.
 *
 * `significant_improvement` and `relapse` are clinical judgements. A timeline can be walked, a pattern
 * can be spotted, and a plausible milestone can be computed from either -- and the moment one is, the
 * record contains a clinical claim with nobody's name on it. This is the same refusal as the
 * "Stable / Improving / Monitor" chip that was rejected on the Patients screen, and it is recorded here
 * as a constant so that a future engine that wants to infer one has to delete this sentence first.
 *
 * The rule is enforced structurally: recordMilestone is the ONLY writer of practice_patient_milestone,
 * it takes kind, label, date and actor from its caller, and no other function in longitudinal.ts writes
 * that table. The harness asserts a full encounter lifecycle produces zero milestone rows.
 */
export const MILESTONES_ARE_NEVER_DERIVED = true;

/** migration 238's three allergy states. */
export const ALLERGY_STATUSES: [string, string][] = [
  ["not_recorded", "Not recorded"],
  ["none_known", "No known allergies"],
  ["recorded", "Allergies recorded"],
];

export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe", "anaphylaxis"] as const;
export const ALLERGY_CERTAINTIES = ["suspected", "confirmed", "refuted"] as const;

export const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;

export type SafetyLine = {
  /** The sentence to print. Never invent a safer one than this. */
  text: string;
  /** unknown = nobody asked · none = somebody said none · present = there are some · unreadable = the read failed. */
  tone: "unknown" | "none" | "present" | "unreadable";
  /** True only for `none`. A screen may print a reassuring sentence only when this is true. */
  safeToRead: boolean;
};

/**
 * ⚠ THE SINGLE MOST SAFETY-CRITICAL FUNCTION IN THIS BUILD.
 *
 * "No known allergies" and "nobody has asked" are different answers and the difference can kill
 * somebody. The design comp prints "No known allergies" under a heading; if that sentence were rendered
 * whenever the allergy list happened to be empty, then EVERY patient nobody had asked would read as safe
 * to prescribe for -- and it would read that way most confidently for the newest records, which are
 * exactly the patients whose history is least known.
 *
 * So the STATUS decides the sentence and the LIST never does. An empty list under `recorded` is a
 * contradiction and is reported as one rather than being quietly downgraded to reassurance.
 *
 * A FAILED READ IS ITS OWN ANSWER. `unavailable` is not "none": a screen that cannot read the allergy
 * record must say so, because the prescriber's next action differs.
 */
export function allergyLine(input: {
  status: string | null | undefined;
  count: number | null;
  unavailable: boolean;
  reviewedAt?: string | null;
}): SafetyLine {
  if (input.unavailable) {
    return { text: "Allergies could not be read", tone: "unreadable", safeToRead: false };
  }
  if (input.status === "none_known") {
    const when = input.reviewedAt ? ` (recorded ${String(input.reviewedAt).slice(0, 10)})` : "";
    return { text: `No known allergies${when}`, tone: "none", safeToRead: true };
  }
  if (input.status === "recorded") {
    const n = input.count ?? null;
    if (n === null) return { text: "Allergies recorded — the list could not be read", tone: "unreadable", safeToRead: false };
    if (n === 0) return { text: "Marked as having allergies, but none are listed", tone: "unknown", safeToRead: false };
    return { text: `${n} recorded allerg${n === 1 ? "y" : "ies"}`, tone: "present", safeToRead: false };
  }
  // not_recorded, null, or anything unrecognised. The default is the un-reassuring one on purpose.
  return { text: "Allergy status not recorded — nobody has asked", tone: "unknown", safeToRead: false };
}

/**
 * Blood group, with the same discipline: null is "not recorded", never a blank that reads as fine.
 */
export function bloodGroupLine(input: { value: string | null | undefined; unavailable: boolean }): SafetyLine {
  if (input.unavailable) return { text: "Blood group could not be read", tone: "unreadable", safeToRead: false };
  if (!input.value) return { text: "Blood group not recorded", tone: "unknown", safeToRead: false };
  return { text: input.value, tone: "present", safeToRead: false };
}

/** CPR-ENC-003 s7's journey filters. `all` first, because the whole point is the whole journey. */
export const JOURNEY_FILTERS: [string, string][] = [
  ["all", "Everything"],
  ["encounters", "Encounters"],
  ["problems", "Problems"],
  ["treatments", "Treatments"],
  ["procedures", "Procedures"],
  ["investigations", "Investigations"],
  ["referrals", "Referrals"],
  ["follow_ups", "Follow-ups"],
  ["milestones", "Milestones"],
];

export const JOURNEY_FILTER_CODES = JOURNEY_FILTERS.map(([k]) => k);

/** Timeline event glyphs. Text, so nothing needs an icon package. */
export const JOURNEY_ICON: Record<string, string> = {
  encounters: "✎",
  problems: "◈",
  treatments: "℞",
  procedures: "✚",
  investigations: "⚗",
  referrals: "⇥",
  follow_ups: "↻",
  milestones: "⚑",
};
