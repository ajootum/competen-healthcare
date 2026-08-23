// CPR-V3-001's eight activity types, and their labels.
//
// ⚠ THEY LIVE HERE RATHER THAN IN activity.ts BECAUSE A CLIENT COMPONENT NEEDS THEM.
//
// activity.ts is a server engine: it imports metrics.ts, which imports access.ts, which imports
// `next/headers`. A "use client" component importing so much as a string constant from it drags that
// whole chain into the browser bundle and the BUILD FAILS -- which is what happened the moment
// sessionSummary started reading the metric engine for its patient figures. The dev server reported it
// as a 500 on pages that had not been touched, and only `next build` named the real import trace:
//
//   access.ts <- metrics.ts <- activity.ts <- StartYourDay.tsx [Client Component Browser]
//
// This mirrors encounter-constants.ts, which exists for exactly the same reason. The rule is worth
// stating plainly: A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE DATABASE.
// activity.ts re-exports both so server callers are unaffected and nothing has two definitions.

// ⚠ THIS LIST AND MIGRATION 237'S CHECK CONSTRAINT ARE ONE VOCABULARY IN TWO PLACES. A type here that
// the constraint rejects is a button that throws on click. A type there that is missing here draws as a
// raw database string. Neither can be caught by the compiler, so they are changed together or not at all.
export const ACTIVITY_TYPES = [
  // CPR-V3-001 s4's original eight (migration 232).
  "outpatient_clinic", "ward_round", "theatre", "emergency_consult",
  "virtual_clinic", "telephone_review", "administration", "teaching",
  // CPR-V5-005 s2 and s9 add five (migration 237). `leave` is the one that carries weight: a day with
  // no rows cannot say whether nothing is planned yet or the practitioner is deliberately not working,
  // and only a positive record tells those apart.
  "meeting", "research", "leave", "travel", "custom",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * CPR-CC-MOB-001 s8: the four the phone offers before you ask for more.
 *
 * ⚠ THIRTEEN EQUALLY WEIGHTED BUTTONS IS NOT A CHOICE, IT IS A SEARCH. MCC-02: the launcher rendered
 * every activity type at identical size in a two-column block that filled a phone screen, so finding
 * "Outpatient Clinic" cost the same as finding "Travel" and the common case paid for the rare one.
 *
 * These four are the spec's, in the spec's order. Not deleted, not hidden: s16 is explicit that no
 * activity type may be removed, so the remaining nine sit behind one More activities control -- which
 * is progressive disclosure rather than a shorter list.
 *
 * ⚠ NOT SORTED BY USAGE, and s8 says why: "Do not reorder unpredictably on every visit." A launcher
 * whose buttons move as the week goes on cannot be used without reading it, and the whole value of a
 * fixed position is that a thumb learns it. Usage-based favourites are named in s8 as a Practice Setup
 * choice -- a configured preference, applied deliberately, not a running tally rearranging the screen.
 */
export const PRIMARY_ACTIVITY_TYPES: readonly ActivityType[] = [
  "outpatient_clinic", "ward_round", "emergency_consult", "theatre",
];

/** Everything else, in ACTIVITY_TYPES order, derived so a new type cannot go missing from both lists. */
export const SECONDARY_ACTIVITY_TYPES: readonly ActivityType[] =
  ACTIVITY_TYPES.filter(t => !PRIMARY_ACTIVITY_TYPES.includes(t));

// ── CPR-CUR-001 s3/s15: WHICH ACTIVITIES INVOLVE PATIENTS ──────────────────────────────────────────
//
// "Patient-flow components are enabled only for activity types that involve patients. Non-clinical
// activities use the same session shell but do not fabricate queues or encounter controls." (s3), and
// s15 names the non-clinical seven: Administration, Teaching, Meeting, Research, Leave, Travel and
// Custom Activity.
//
// ⚠ `custom` IS NON-CLINICAL BY THE SPEC'S OWN LIST, and the escape hatch beside it -- "unless the
// configured activity explicitly supports patients" -- has NO STORAGE: no table records whether a
// custom activity supports patients, so there is nothing to read and the safe branch is the shell
// without patient controls. If that configuration ever exists, this set is where it plugs in.
export const PATIENT_FLOW_ACTIVITY_TYPES: ReadonlySet<ActivityType> = new Set<ActivityType>([
  "outpatient_clinic", "ward_round", "theatre", "emergency_consult",
  "virtual_clinic", "telephone_review",
]);

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  outpatient_clinic: "Outpatient Clinic",
  ward_round: "Ward Round",
  theatre: "Theatre",
  emergency_consult: "Emergency Consult",
  virtual_clinic: "Virtual Clinic",
  telephone_review: "Telephone Review",
  administration: "Administration",
  teaching: "Teaching",
  meeting: "Meeting",
  research: "Research",
  leave: "Leave",
  // NOT "Travel time". A travel activity is a journey somebody planned; the only other travel figure in
  // this product is practice_location.travel_buffer_minutes, an allowance a practitioner typed. Neither
  // is a measured distance and neither is labelled as though it were.
  travel: "Travel",
  // The label is the whole answer for this one -- practice_activity.title is what identifies it, and
  // migration 237 refuses the placeholder titles a form would default to.
  custom: "Custom Activity",
};
