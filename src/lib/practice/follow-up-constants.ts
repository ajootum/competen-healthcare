// CPR-140's state table, in a module with NO server imports so the board derives its buttons from the
// same source the engine enforces -- the split encounter-constants.ts and document-constants.ts exist
// for, applied to the third object with a lifecycle.
//
// THERE IS NO OVERDUE STATE HERE, AND THAT IS THE POINT. Overdue is derived from the due date against
// the practice's clock every time it is read (see follow-ups.ts and migration 196's header). A status
// value would need something to run to set it, and the thing it needs is exactly what a neglected
// practice does not do.
//
// MISSED IS REVERSIBLE, deliberately. A patient who was given up on in March and walks in in June has
// not made the March judgement wrong -- but the obligation is live again, and a record that could not
// say so would force somebody to raise a duplicate and lose the history.

export const FOLLOW_UP_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"],
  SCHEDULED: ["OPEN", "COMPLETED", "MISSED", "CANCELLED"],
  COMPLETED: [],
  MISSED: ["OPEN"],
  CANCELLED: [],
};

/** Closed = no longer owed. Stamps closed_at / closed_by. */
export const CLOSED_FOLLOW_UP_STATUSES = ["COMPLETED", "MISSED", "CANCELLED"];

export const FOLLOW_UP_KINDS = [
  ["review", "Clinical review"],
  ["investigation_result", "Investigation result"],
  ["treatment_response", "Response to treatment"],
  ["referral_outcome", "Referral outcome"],
  ["monitoring", "Ongoing monitoring"],
  ["immunisation", "Immunisation"],
  ["other", "Other"],
] as const;

export const FOLLOW_UP_PRIORITIES = ["routine", "soon", "urgent"] as const;

/**
 * CPR-140's outcome taxonomy (migration 206). Fixed, because the point of it is COUNTING -- "how did the
 * last thirty post-op reviews turn out" is not answerable over free text.
 *
 * THE WORDS ARE STILL REQUIRED ALONGSIDE. A code that replaced the sentence would turn "much better,
 * discharged to the GP with a note about the rash" into "improved", and the rash would leave the record.
 *
 * The second element is whether the code counts as a GOOD outcome. Deliberately absent for `referred`
 * and `other`: a referral is neither, and calling it one would be this product making a clinical
 * judgement it has no basis for.
 */
export const FOLLOW_UP_OUTCOMES = [
  ["improved", "Improved", true],
  ["no_change", "No change", false],
  ["worsened", "Worsened", false],
  ["referred", "Referred on", null],
  ["other", "Other", null],
] as const;

/** The API's action vocabulary, one name per target status. */
export const FOLLOW_UP_ACTIONS: Record<string, string> = {
  complete: "COMPLETED", missed: "MISSED", cancel: "CANCELLED", reopen: "OPEN",
};

export function followUpLabelFor(to: string): string {
  return ({
    OPEN: "Reopen",
    SCHEDULED: "Book a visit for this",
    COMPLETED: "Close as done",
    MISSED: "Mark missed",
    CANCELLED: "No longer needed",
  } as Record<string, string>)[to] ?? to;
}
