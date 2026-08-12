// CPR-IMP-001 -- the import file's columns, in one imports-nothing file.
//
// ⚠ THIS FILE MUST IMPORT NOTHING. ImportClient.tsx ("use client") needs the template header and the
// caps, and the engine (patient-import.ts, which reaches node:crypto and the registration engines)
// needs the same list for parsing. One constant imported by both is the only arrangement in which the
// template a practitioner downloads and the columns the server accepts CANNOT disagree -- the
// import-graph rule that keeps /practice/offline alive (entity-types.ts, sync-limits.ts) applies here
// unchanged: a client module that imports one value from a server-reaching module takes the whole
// module with it, and the page 500s while tsc, eslint and every harness stay green.

export const IMPORT_COLUMNS = [
  "first_name", "middle_name", "last_name",
  "date_of_birth", "estimated_age", "sex",
  "phone", "email", "national_id",
  "guardian_name", "guardian_relationship", "guardian_phone", "guardian_email",
  "reason_for_visit",
  "location", "appointment_date", "appointment_time", "appointment_type",
  "external_id",
] as const;

/**
 * THE GUIDANCE THAT TRAVELS INSIDE THE FILE (the owner, 2026-08-12: "I would like a guideline in the csv
 * (e.g. date of birth (dd-mm-yyyy))").
 *
 * ⚠ IT GOES IN THE HEADER, NOT IN A NOTE BESIDE THE DOWNLOAD BUTTON. The person filling this in is in
 * Excel, days later, on a different machine, with no browser open. Guidance on the page they downloaded
 * from is guidance they cannot see at the moment they need it -- which is precisely when a date gets
 * typed month-first.
 *
 * ⚠ NO COMMAS IN ANY HINT. This string IS a CSV header line; a comma inside a hint silently becomes a
 * column break, and the file would then present more headers than it has columns. Alternatives are
 * separated with " / ". The harness asserts it.
 *
 * ⚠ AND EVERY HINT MUST SURVIVE canon() IN patient-import.ts, which now strips a trailing parenthetical.
 * The template a practitioner downloads and the columns the server accepts cannot be allowed to
 * disagree -- that is this file's whole reason for existing -- so the harness canonicalises every
 * templated header back and asserts it lands on the machine name.
 */
export const IMPORT_COLUMN_HINTS: Record<(typeof IMPORT_COLUMNS)[number], string> = {
  first_name: "required",
  middle_name: "optional",
  last_name: "required",
  date_of_birth: "dd-mm-yyyy",
  estimated_age: "whole years - only if the date of birth is unknown",
  sex: "female / male / other / unknown",
  phone: "optional",
  email: "optional",
  national_id: "optional",
  guardian_name: "required for a child",
  guardian_relationship: "mother / father / guardian / grandparent / carer",
  guardian_phone: "optional",
  guardian_email: "optional",
  reason_for_visit: "optional",
  location: "must match a clinic name in your practice",
  appointment_date: "dd-mm-yyyy - leave blank for no appointment",
  appointment_time: "24-hour HH:MM",
  appointment_type: "new_consultation / scheduled_followup / walk_in / emergency / hospital_consultation / teleconsultation / home_visit",
  external_id: "your own reference - lets you re-run this file safely",
};

/** The header a practitioner downloads: machine name plus its hint, one cell per column. */
export const IMPORT_TEMPLATE_HEADER =
  IMPORT_COLUMNS.map(c => `${c} (${IMPORT_COLUMN_HINTS[c]})`).join(",");

/** Hard caps: a file over these is refused before any row is read closely. */
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 1_000_000;
