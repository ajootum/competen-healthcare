// CPR-150's vocabularies, in a module with NO server imports so the procedure form derives its options
// from the same source the engine enforces.
//
// ⚠ THIS FILE USED TO SAY "THERE IS NO PLANNED HERE", and that position is now superseded. Migration
// 197 argued that a procedure record means something happened to a person, so a plan never carried out
// was the treatment row and nothing else. CPR-TRT-PROC-003 s9 disagrees deliberately: "Plan for suturing
// later" is a procedure with a lifecycle, not a treatment plan, because the object being tracked has a
// status somebody has to move. The owner ruled the newer specification the source of truth, and
// migration 294 widened the constraint to match.
//
// The distinction 197 was protecting still holds and is now carried by the WORDS rather than by absence:
// ORDERED and SCHEDULED are states of a procedure, whereas "wound dressing daily for five days" remains
// a treatment plan. s9 draws that line by what the practitioner is recording, not by the name of the act.
//
// ⚠ ABANDONED IS NOT OFFERED HERE ANY MORE, and migration 294 still ACCEPTS it. It and ATTEMPTED are the
// same clinical fact under two names. The database keeps the old value so that applying 294 before this
// code shipped could not break procedure recording mid-consultation; this list is the narrowing half.
// Nothing writes ABANDONED once this is deployed, and a later migration can drop it.

export const PROCEDURE_STATUSES = [
  ["ORDERED", "Ordered"],
  ["SCHEDULED", "Scheduled"],
  ["PERFORMED", "Performed"],
  ["ATTEMPTED", "Attempted, not completed"],
  ["CANCELLED", "Cancelled"],
  ["DECLINED", "Declined by the patient"],
] as const;

/** The statuses that mean the procedure has NOT happened, so nothing may claim a performance time. */
export const PROCEDURE_STATUSES_NOT_DONE = ["ORDERED", "SCHEDULED", "CANCELLED", "DECLINED"] as const;

/**
 * The statuses that require the practitioner to say why in their own words.
 *
 * ⚠ ATTEMPTED INHERITS THIS FROM ABANDONED. "Started and did not finish" is the one outcome a reader
 * cannot interpret without a reason, and it was already required before the rename. CANCELLED and
 * DECLINED are added because "this did not happen" is a clinical fact whose value is entirely in why.
 */
export const PROCEDURE_STATUSES_NEEDING_REASON = ["ATTEMPTED", "CANCELLED", "DECLINED"] as const;

export const PROCEDURE_CATEGORIES = [
  ["minor_surgery", "Minor surgery"],
  ["injection", "Injection"],
  ["wound_care", "Wound care"],
  ["diagnostic", "Diagnostic"],
  ["obstetric", "Obstetric"],
  ["dental", "Dental"],
  ["dressing", "Dressing"],
  ["physical", "Physical therapy"],
  ["other", "Other"],
] as const;

/**
 * The sides. `not_applicable` is offered because most procedures have none -- and it is REFUSED on a
 * catalogue entry marked sided, because it is exactly the value somebody picks to get past a required
 * field. See follow-ups in 197's header: wrong-site is the canonical never-event.
 */
export const LATERALITIES = [
  ["not_applicable", "Not sided"],
  ["left", "Left"],
  ["right", "Right"],
  ["bilateral", "Bilateral"],
] as const;

export const SIDED_LATERALITIES = ["left", "right", "bilateral"];

/**
 * CONSENT NEVER DEFAULTS TO OBTAINED. `not_recorded` is first because it is the honest state of a form
 * nobody has filled in, and the engine refuses it where the catalogue says consent is required.
 */
export const CONSENT_STATUSES = [
  ["not_recorded", "Not recorded"],
  ["obtained", "Obtained"],
  ["not_required", "Not required"],
  ["refused", "Refused"],
] as const;

export const OUTCOME_TYPES = [
  ["healing", "Healing as expected"],
  ["complication", "Complication"],
  ["failure", "Did not achieve its purpose"],
  ["resolution", "Resolved"],
  ["note", "Note"],
] as const;

export const OUTCOME_SEVERITIES = ["mild", "moderate", "severe"] as const;

/** Severity belongs to a complication and to nothing else -- the engine enforces both directions. */
export const SEVERITY_REQUIRED_FOR = ["complication"];
