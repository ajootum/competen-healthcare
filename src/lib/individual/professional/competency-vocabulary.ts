// ── COMPETENCIES, SELF-ASSESSMENT AND EVIDENCE VOCABULARY ── COMPETEN-PROFESSIONAL-COMPETENCY-01, Stage 5, migration 520 ──
//
// ⚠ THIS MODULE IMPORTS NOTHING (the constants-file rule). policy.ts, pages, routes, tests and harnesses read it.
//
// ⚠ FOUR THINGS THAT ARE NEVER THE SAME (owner GO s1): what is EXPECTED (the catalogue), what the person ASSESSES
// themselves at (self-reported), what EVIDENCE supports it, and what an independent assessor VERIFIED (C5 only).
// Every word below keeps them apart. No default names a profession, a country, an assessment method or a scale.

export const ASPECT_TEXT = {
  expected: "Expected in the catalogue",
  self: "Your self-assessment (self-reported)",
  evidence: "Supporting evidence (not verification)",
  verified: "Independently verified (by an appointed assessor)",
} as const;

/** The one label every self-assessment carries, wherever it is shown or shared. */
export const SELF_REPORTED = "Self-reported";

/** Kinds of entry (520 my_competency.kind). */
export const ENTRY_KINDS = ["catalogue", "personal"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type Option = { code: string; label: string };

/** How entries are grouped. Catalogue entries take their catalogue layer, personal entries the category chosen. */
export const DEFAULT_COMPETENCY_CATEGORIES: readonly Option[] = [
  { code: "foundational", label: "Foundational" },
  { code: "profession", label: "Profession-specific" },
  { code: "specialty", label: "Specialty and advanced" },
  { code: "leadership", label: "Leadership and management" },
  { code: "education", label: "Education" },
  { code: "quality", label: "Quality and safety" },
  { code: "research", label: "Research" },
  { code: "interest", label: "A personal development interest" },
];
export const LAYER_CATEGORY: Record<string, string> = {
  foundational: "foundational", profession: "profession", advanced: "specialty", specialty: "specialty", context: "specialty",
};

/** How sure a person is of their own assessment. Words, never a score. */
export const DEFAULT_CONFIDENCE: readonly Option[] = [
  { code: "very-sure", label: "Very sure" },
  { code: "fairly-sure", label: "Fairly sure" },
  { code: "unsure", label: "Not sure yet" },
];

/** Kinds of additional evidence recorded in the 373 evidence record (520 evidence_type). */
export const DEFAULT_EVIDENCE_TYPES: readonly Option[] = [
  { code: "observation", label: "Practical observation" },
  { code: "mentor-feedback", label: "Mentor or colleague feedback" },
  { code: "assessment", label: "An assessment result" },
  { code: "experience", label: "Professional experience" },
  { code: "teaching", label: "Teaching" },
  { code: "research", label: "Research" },
  { code: "quality-improvement", label: "Quality improvement" },
  { code: "other", label: "Other supporting evidence" },
];

/** What a piece of evidence supports (owner GO C4). "verification" means it supported an independent verification. */
export const DEFAULT_RELATIONS: readonly Option[] = [
  { code: "knowledge", label: "Knowledge" },
  { code: "application", label: "Application" },
  { code: "practical", label: "Practical performance" },
  { code: "experience", label: "Professional experience" },
  { code: "verification", label: "Independent verification" },
];

/** The records a portfolio item can be. Each is a reference to its own authoritative record, never a copy. */
export const PORTFOLIO_KINDS = ["cpd", "learning_record", "evidence", "profile_item", "reflection", "study_achievement"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];
export const PORTFOLIO_KIND_LABEL: Record<PortfolioKind, string> = {
  cpd: "CPD entry",
  learning_record: "Competen Learning",
  evidence: "Evidence or credential",
  profile_item: "Professional profile record",
  reflection: "Private reflection",
  study_achievement: "Study (from Competen Scholar)",
};
/** The 520 column each kind is linked by. */
export const PORTFOLIO_COLUMN: Record<PortfolioKind, string> = {
  cpd: "cpd_id", learning_record: "learning_record_id", evidence: "evidence_id", profile_item: "profile_item_id",
  reflection: "reflection_id", study_achievement: "study_achievement_id",
};
/** Kinds that may ever leave the person: shared on a Passport link or sent for verification. Reflections never do. */
export const SHAREABLE_KINDS: readonly PortfolioKind[] = ["cpd", "learning_record", "evidence", "profile_item", "study_achievement"];

/** Trust classes, as each source record holds them. A portfolio never raises one. */
export const CLASS_TEXT: Record<string, string> = {
  self_declared: "Self-declared",
  source_linked: "Document-supported",
  platform_recorded: "Recorded by Competen Learning",
  self_reported: "Self-reported",
  educational: "Educational, formative (not a verified competency)",
  private: "Private to you",
};

/** Parts of a competency a person may carry on a Passport link (520 share_competency). */
export const SHARE_PARTS = ["self_assessment", "evidence", "assessed_outcomes"] as const;
export type SharePart = (typeof SHARE_PARTS)[number];
export const SHARE_PART_LABEL: Record<SharePart, string> = {
  self_assessment: "My latest self-assessment, labelled self-reported",
  evidence: "The evidence I linked (never reflections)",
  assessed_outcomes: "Independent verification outcomes, as the assessor recorded them",
};

/** Every table 520 creates. */
export const COMPETENCY_TABLES = ["individual_professional_my_competency", "individual_professional_my_competency_history",
  "individual_professional_self_assessment", "individual_professional_competency_evidence", "individual_professional_share_competency"] as const;
