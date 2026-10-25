// ── THE PROFESSIONAL PROFILE VOCABULARY ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, migration 450 ─────────
//
// The words and fixed lists the registration form, the profile sections, the HQ configuration and the
// harnesses share, so no two surfaces describe the same record differently.
//
// ⚠ THIS MODULE IMPORTS NOTHING (the constants-file rule access-doors.ts records). policy.ts, pages, API
// routes, the unit tests and scripts/professional-profile-harness.ts all read it.
//
// ⚠ DEFAULTS, NOT A CONTEXT. The lists below are what the form offers when HQ has published nothing. None
// of them names a country or a profession: jurisdictions default to the full country list, professions
// and specialties to free text with the shared vocabulary as suggestions (migration 013). Uganda and
// nursing are data a configuration may add, never an assumption of the code (GO s8).

/** Every table migration 450 creates. The harness pins RLS and the absence of scope and verified columns. */
export const PROFILE_TABLES = ["individual_professional_profile_context", "individual_professional_profile_item"] as const;

// ── THE REGISTRATION FORM (GO s3) ──────────────────────────────────────────────────────────────────────

/** Always required, and the schema agrees (450 individual_professional_profile_registration_complete). */
export const REQUIRED_FIELDS = ["profession", "jurisdiction", "status"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** Asked at registration only when configuration says so, and skippable unless configuration requires them. */
export const OPTIONAL_FIELDS = ["specialty", "title", "years", "setting", "role"] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];
export type RegistrationField = RequiredField | OptionalField;

export const FIELD_LABEL: Record<RegistrationField, string> = {
  profession: "Profession",
  jurisdiction: "Country or jurisdiction where you practise",
  status: "Current professional status",
  specialty: "Primary specialty or practice area",
  title: "Professional title",
  years: "Years of experience",
  setting: "Practice setting",
  role: "Current role",
};

/** Never asked at onboarding, and never configurable into the form (GO s3). Named so the harness can pin it. */
export const NEVER_AT_ONBOARDING = ["registration number", "licence", "employment record", "uploaded qualification"] as const;

/** The form's steps, in order. The first holds the required facts. Saving any step saves and continues later. */
export const REGISTRATION_STEPS = ["profession", "practice", "review"] as const;
export type RegistrationStep = (typeof REGISTRATION_STEPS)[number];
export const STEP_LABEL: Record<RegistrationStep, string> = {
  profession: "Your profession",
  practice: "Your practice (optional)",
  review: "Review and enter",
};

export const YEARS_MAX = 70;

// ── THE PROFILE SECTIONS (GO s4) ───────────────────────────────────────────────────────────────────────

export const PROFILE_SECTIONS = ["overview", "qualifications", "registrations", "employment", "specialties", "aspirations"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export const SECTION_LABEL: Record<ProfileSection, string> = {
  overview: "Professional overview",
  qualifications: "Qualifications and education",
  registrations: "Registration and licensing",
  employment: "Practice and employment history",
  specialties: "Specialties and professional interests",
  aspirations: "Career aspirations",
};

/** migration 450 individual_professional_profile_item.section, and which page section shows it. */
export const ITEM_KINDS = ["qualification", "registration", "employment", "specialty", "interest", "aspiration"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_SECTION: Record<ItemKind, ProfileSection> = {
  qualification: "qualifications",
  registration: "registrations",
  employment: "employment",
  specialty: "specialties",
  interest: "specialties",
  aspiration: "aspirations",
};
export const ITEM_LABEL: Record<ItemKind, string> = {
  qualification: "qualification",
  registration: "registration or licence",
  employment: "role or employment period",
  specialty: "specialty",
  interest: "professional interest",
  aspiration: "career aspiration",
};

/** Kinds a supporting document may be attached to (the 450 section_shape CHECK). */
export const DOCUMENT_KINDS: readonly ItemKind[] = ["qualification", "registration", "employment"];

/** A withdrawal says why (450 lifecycle CHECK). Nothing is ever deleted by the person. */
export const WITHDRAW_REASONS = [
  ["recorded_in_error", "Recorded in error"],
  ["no_longer_held", "No longer held"],
] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number][0];

/** Registration standing: a fixed list, because what each word means must not drift (stored code and label). */
export const REGISTRATION_STANDING = [
  { code: "active", label: "Active" },
  { code: "provisional", label: "Provisional or temporary" },
  { code: "lapsed", label: "Lapsed" },
  { code: "suspended", label: "Suspended" },
  { code: "retired", label: "Retired or voluntarily removed" },
] as const;

// ── DEFAULT OPTIONS, used only while HQ has published none ───────────────────────────────────────────────

export type Option = { code: string; label: string };

export const DEFAULT_STATUSES: readonly Option[] = [
  { code: "practising", label: "Practising" },
  { code: "practising-part-time", label: "Practising part time" },
  { code: "newly-qualified", label: "Newly qualified" },
  { code: "awaiting-registration", label: "Qualified, awaiting registration" },
  { code: "career-break", label: "On a career break" },
  { code: "not-practising", label: "Not currently practising" },
  { code: "retired", label: "Retired" },
];

export const DEFAULT_QUALIFICATION_TYPES: readonly Option[] = [
  { code: "certificate", label: "Certificate" },
  { code: "diploma", label: "Diploma" },
  { code: "bachelors", label: "Bachelor's degree" },
  { code: "postgraduate-diploma", label: "Postgraduate diploma or certificate" },
  { code: "masters", label: "Master's degree" },
  { code: "doctorate", label: "Doctorate" },
  { code: "fellowship", label: "Fellowship or specialist qualification" },
  { code: "other", label: "Other" },
];

export const DEFAULT_PRACTICE_SETTINGS: readonly Option[] = [
  { code: "hospital", label: "Hospital" },
  { code: "primary-care", label: "Primary care or clinic" },
  { code: "community", label: "Community or home care" },
  { code: "private-practice", label: "Private practice" },
  { code: "education", label: "Education or training" },
  { code: "research", label: "Research" },
  { code: "management", label: "Management or administration" },
  { code: "other", label: "Other" },
];

// ── VERIFICATION STATES (GO s5) ─────────────────────────────────────────────────────────────────────────
//
// What a profile record can be, in words. The first two come from 450's GENERATED evidence_class. Nothing
// a person records can reach "independently verified": that state belongs to records an organisation
// verified, read through the Passport, and the profile shows them apart and read-only.

export const RECORD_STATES = ["self_declared", "document_supported", "expired", "superseded", "withdrawn"] as const;
export type RecordState = (typeof RECORD_STATES)[number];
export const RECORD_STATE_LABEL: Record<RecordState, string> = {
  self_declared: "Self-declared, not verified",
  document_supported: "Document attached, not verified",
  expired: "Expired",
  superseded: "Earlier version",
  withdrawn: "Withdrawn",
};
export const RECORD_STATE_DETAIL: Record<RecordState, string> = {
  self_declared: "You recorded this. Nobody has checked it.",
  document_supported: "You recorded this and attached a document. Attaching a document does not verify it.",
  expired: "The expiry date you recorded has passed.",
  superseded: "You changed this record. The earlier version is kept as it was.",
  withdrawn: "You withdrew this record. It is kept in your history and no longer shown as current.",
};
