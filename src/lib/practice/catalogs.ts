// The controlled vocabularies a Practice provisioning request draws on (CPR-PROV-001 s11).
//
// ONE COPY, because there are now two callers: the public signup form and the super-admin operator
// console. Two lists of professions drift the first time one of them gains an entry, and the drift is
// invisible -- both forms keep working, they simply offer different worlds.
//
// PROV-001 s11 calls professionCode a "controlled professional taxonomy" and defaultPracticeType an
// enumeration. Only the second is enforced by the database: practice_workspace.default_practice_type has
// a CHECK, profession_code does not, and there is no taxonomy TABLE for professions or specialties. So
// this module is the taxonomy today, and that is a gap worth naming rather than papering over: a real
// taxonomy is governed, versioned and translatable, and this is a TypeScript array. It is enough for
// signup and honest about what it is.

/** Enforced by practice_workspace.default_practice_type's CHECK (migration 191). */
export const PRACTICE_TYPES = [
  ["independent", "Independent practice"],
  ["clinic", "Clinic"],
  ["hospital_based", "Hospital-based"],
  ["outreach", "Outreach or community"],
  ["teleconsultation", "Teleconsultation"],
  ["mixed", "Mixed"],
] as const;

/** NOT enforced by the database. See the note above. */
export const PROFESSIONS = [
  ["medical_doctor", "Medical doctor"],
  ["dentist", "Dentist"],
  ["nurse", "Nurse"],
  ["midwife", "Midwife"],
  ["clinical_officer", "Clinical officer"],
  ["pharmacist", "Pharmacist"],
  ["physiotherapist", "Physiotherapist"],
  ["psychologist", "Psychologist"],
  ["allied_health", "Other allied health"],
] as const;

export const isPracticeType = (v: string) => PRACTICE_TYPES.some(([k]) => k === v);
export const isProfession = (v: string) => PROFESSIONS.some(([k]) => k === v);

/**
 * The legal versions a signup records as accepted (PROV-001 s11: "Accepted current legal version",
 * "Acknowledged current privacy notice").
 *
 * CONSTANTS, NOT RECORDS, and that is a known gap. A version string is only meaningful if the DOCUMENT it
 * names is retrievable and immutable; today these are two strings and there are no published terms behind
 * them. Storing what was accepted is still worth doing -- it is the field a future governed document set
 * joins to -- but nobody should read a stored "practice-terms-2026-08" as proof a person saw a specific
 * text. Raising them is a deliberate act: bump here, and every new signup records the new version while
 * existing workspaces keep what they actually accepted.
 */
export const LEGAL_VERSIONS = {
  terms: "practice-terms-2026-08",
  privacy: "practice-privacy-2026-08",
} as const;
