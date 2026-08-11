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

export const IMPORT_TEMPLATE_HEADER = IMPORT_COLUMNS.join(",");

/** Hard caps: a file over these is refused before any row is read closely. */
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 1_000_000;
