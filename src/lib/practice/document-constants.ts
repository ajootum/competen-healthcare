// CPR-130's document state table, in a module with NO server imports so the document UI derives its
// buttons from the same source the engine enforces -- the split that encounter-constants.ts exists for,
// applied to the second object that has a lifecycle.
//
// FIVE STATES, and they are NOT the encounter's eight. A document has no ACTIVE or PAUSED because it is
// not a thing you are in the middle of doing; it is written, checked, issued, and then it is out in the
// world. FINAL is the state the encounter has no equivalent of: written and ready, not yet signed. It
// exists because "I have finished writing this letter" and "I am putting my name on it" are two
// decisions, and collapsing them means every draft is one misclick from being issued.
//
// AMENDED IS NOT A BUTTON. It appears here because it is a legal target, but nothing may transition into
// it directly: amending is amendDocument(), which creates the successor version and moves the original
// in one operation. A bare transition to AMENDED would leave a superseded document with no successor --
// a record that says "this was replaced" and cannot say by what.

export const DOCUMENT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["FINAL", "ENTERED_IN_ERROR"],
  FINAL: ["SIGNED", "DRAFT", "ENTERED_IN_ERROR"],
  SIGNED: ["AMENDED", "ENTERED_IN_ERROR"],
  AMENDED: ["ENTERED_IN_ERROR"],
  ENTERED_IN_ERROR: [],
};

/** After these the content is frozen; the database refuses a change even if the engine is bypassed. */
export const LOCKED_DOCUMENT_STATUSES = ["SIGNED", "AMENDED", "ENTERED_IN_ERROR"];

/** Reached through amendDocument(), never through transitionDocument(). See the note above. */
export const AMEND_ONLY_STATUSES = ["AMENDED"];

export const DOCUMENT_ACTIONS: Record<string, string> = {
  finalise: "FINAL", reopen: "DRAFT", sign: "SIGNED", entered_in_error: "ENTERED_IN_ERROR",
};

export const DOC_TYPES = [
  ["consultation_summary", "Consultation summary"],
  ["referral_letter", "Referral letter"],
  ["sick_note", "Sick note"],
  ["procedure_note", "Procedure note"],
  ["discharge_summary", "Discharge summary"],
  // CPR-DOC-AUTO-001 s5, migration 354.
  ["patient_instructions", "Patient instructions"],
  ["general", "Other document"],
] as const;

export const TEMPLATE_KINDS = [
  ["encounter_note", "Encounter note (fills the SOAP segments)"],
  ["referral_letter", "Referral letter"],
  ["sick_note", "Sick note"],
  ["consultation_summary", "Consultation summary"],
  ["procedure_note", "Procedure note"],
  ["discharge_summary", "Discharge summary"],
  ["general", "Other document"],
] as const;

/**
 * CPR-330: what a template may reference. Deliberately small -- every field here is one the product
 * actually holds, so a template cannot name something that could never be filled.
 *
 * HERE RATHER THAN IN THE ENGINE because the template designer is a client component and this module is
 * the one with no server imports. The rule these fields obey (an unresolved field renders as a visible
 * marker, never as blank) lives with the resolver in document-generation.ts.
 */
export const MERGE_FIELDS = [
  ["patient.name", "The patient's name as registered"],
  ["patient.sex", "Sex as recorded"],
  ["patient.date_of_birth", "Date of birth, if one is recorded"],
  ["patient.age", "Age in years"],
  ["patient.identifier", "The practice identifier (P-XXXXXX)"],
  ["patient.phone", "Primary phone number on the record"],
  ["encounter.date", "Date of the linked consultation"],
  ["encounter.reason", "Reason for the visit, as recorded"],
  ["encounter.diagnoses", "Diagnoses recorded at that consultation, one per line"],
  ["encounter.plan", "The plan segment of the consultation note"],
  ["practice.name", "Practice name"],
  ["practitioner.name", "The person generating the document"],
  ["today", "Today's date, in the practice's timezone"],
] as const;

export const RELEASE_CHANNELS = [
  ["printed", "Printed"],
  ["handed_over", "Handed to the patient"],
  ["emailed", "Emailed"],
  ["collected_by_relative", "Collected by a relative"],
  ["other", "Other"],
] as const;

/** How a piece of note text came to exist. Recorded per version -- see migration 195 s3. */
export const NOTE_SOURCES = ["typed", "template", "dictation", "import"] as const;

/** Which action name moves FROM a status TO a status; null when no plain transition does it. */
export function documentActionFor(from: string, to: string): string | null {
  if (to === "DRAFT") return from === "FINAL" ? "reopen" : null;
  const entry = Object.entries(DOCUMENT_ACTIONS).find(([name, target]) => target === to && name !== "reopen");
  return entry ? entry[0] : null;
}

export function documentLabelFor(from: string, to: string): string {
  if (to === "DRAFT") return "Reopen for editing";
  return ({
    FINAL: "Mark ready",
    SIGNED: "Sign and issue",
    AMENDED: "Amend",
    ENTERED_IN_ERROR: "Mark entered in error",
  } as Record<string, string>)[to] ?? to;
}
