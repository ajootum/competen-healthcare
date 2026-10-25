// ── THE PASSPORT VOCABULARY ── COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7) ─────────────────────────────────────────
//
// ⚠ THIS MODULE IMPORTS NOTHING (the constants-file rule). policy.ts, the Passport read, pages, routes and harnesses
// read it.
//
// ⚠ TRUST AND MEANING ARE FIXED BENEATH CONFIGURATION. Administrators may order sections, choose which kinds may be
// shared, name purposes and choose how much provenance is shown. They cannot rename "self-declared" into "verified":
// the trust classes and their words are the platform's, because a recipient relies on them.

export const PASSPORT_CATEGORIES = ["institution", "profile", "learning", "competency", "cpd", "evidence", "evaluation", "study"] as const;
export type PassportCategory = (typeof PASSPORT_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<PassportCategory, string> = {
  institution: "Issued or verified by organisations",
  profile: "Qualifications, registrations and roles",
  learning: "Competen Learning",
  cpd: "Continuing professional development",
  evidence: "Credentials and supporting evidence",
  competency: "Competencies",
  evaluation: "Formative evaluations",
  study: "Scholar study",
};

export type Trust = "self_declared" | "document_supported" | "platform_recorded" | "educational" | "assessed" | "independently_verified";
export const TRUST_LABEL: Record<Trust, string> = {
  self_declared: "Self-declared, not verified",
  document_supported: "Self-declared with a document attached (the document was not checked and is not shared)",
  platform_recorded: "Recorded by Competen Learning",
  educational: "Educational and formative, not a verified competency",
  assessed: "Assessed or issued by an organisation",
  independently_verified: "Independently verified",
};

export type Validity = "current" | "expired" | "superseded" | "revoked" | "not_applicable";
export const VALIDITY_LABEL: Record<Validity, string> = {
  current: "Current", expired: "Expired", superseded: "Superseded", revoked: "Revoked", not_applicable: "No expiry",
};
export const lapsed = (v: Validity) => v === "expired" || v === "superseded" || v === "revoked";

export type Option = { code: string; label: string };
/** Why a person shares a view. Neutral across professions and countries. */
export const DEFAULT_PURPOSES: readonly Option[] = [
  { code: "job-application", label: "A job application" },
  { code: "registration", label: "Registration or licence renewal" },
  { code: "education", label: "An education or course application" },
  { code: "supervision", label: "Mentorship, supervision or appraisal" },
  { code: "other", label: "Another purpose" },
];
