// CPR-150's vocabularies, in a module with NO server imports so the procedure form derives its options
// from the same source the engine enforces.
//
// THERE IS NO "PLANNED" HERE. A procedure record means something happened to a person. A plan that was
// never carried out is the treatment row from migration 194 and nothing else -- see 197's header for why
// intention and act are kept apart.

export const PROCEDURE_STATUSES = [
  ["PERFORMED", "Performed"],
  ["ABANDONED", "Started and abandoned"],
] as const;

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
