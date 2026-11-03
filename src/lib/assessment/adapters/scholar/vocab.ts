// ── THE SCHOLAR ADAPTER'S FIXED WORDS ── Checklist Studio S3 ─────────────────────────────────────────────────────────
//
// Every sentence the Scholar surface says about what a self-assessment IS, in one place, so a page cannot soften it. Pure.
//
// ⚠ A SELF-ASSESSMENT IS THE LEARNER'S OWN WORD. It is never described as verified, assessed, competent or certified, and
//   nothing here is a decision about competence. Verification is a separate class with its own line.

/** The delivery mode that makes "Start Self-Assessment" the primary action (owner addendum 4). */
export const MODE_SELF = "self_assessment";
/** An instance's own mode, not an authorization role: whether the learner rated themselves (the other values are an assessor or auditor). */
const INSTANCE_ROLE_SELF = "self";
export const isSelfAssessment = (i: { role: string }): boolean => i.role === INSTANCE_ROLE_SELF;
export const MODE_ASSESSOR = "assessor_led";
export const MODE_AI = "ai_assisted_formative";

export const MODE_LABEL: Record<string, string> = {
  [MODE_SELF]: "Self-assessment",
  [MODE_ASSESSOR]: "Assessor-led",
  [MODE_AI]: "AI-assisted formative",
};

/** The context a Scholar instance is recorded under: the Individual product line (plat_product_line has no separate Scholar row, Scholar is an experience of Individual). */
export const CONTEXT_PRODUCT_LINE = "individual";
/** The only attestation a Scholar learner's own instance can ever carry (also a database CHECK). */
export const SELF_ATTESTATION = "self_reported" as const;

export const SELF_CLASS_LABEL = "Self-reported - Not independently verified";
export const SELF_BANNER = "Self-reported, not verified competence";
export const SELF_ATTESTATION_LABEL = "Self-reported, not verified";
export const SELF_NOTICE = "This is your own rating of yourself. It is not an assessment by anyone else, it is not verified, and it never changes your evidence-supported stage.";
export const ASSESSOR_NOTICE = "Assessor-led assessments are recorded by an authorised assessor. They are not formal verification.";
export const NOT_VERIFIED_LINE = "Verified competency: Not yet verified";
export const VERIFICATION_UNREADABLE = "Verified competency: status could not be read just now";
export const EVIDENCE_CLASS_LABEL = "What my learning evidence shows";
export const COMPARE_CLASS_LABEL = "Compare";
export const NO_SELF_RATING = "No self-assessment yet";
export const NO_MAPPED_EVIDENCE = "No learning evidence is linked to this competency yet";

/** The unsaid default: "Unable to judge" is a state, never zero; "Not answered" is its own thing. */
export const UNABLE_TO_JUDGE_LABEL = "Unable to judge";
export const NOT_ANSWERED_LABEL = "Not answered";

export const GAP_KIND_LABEL = {
  met: "At or above the expected level",
  below_expected: "Below the expected level",
  not_satisfactory: "Not yet satisfactory",
  unable_to_judge: UNABLE_TO_JUDGE_LABEL,
  unable_to_demonstrate: "Unable to demonstrate",
  not_answered: NOT_ANSWERED_LABEL,
} as const;
export type FindingKind = keyof typeof GAP_KIND_LABEL;

// ── EVIDENCE-SUPPORTED STAGE (progression) ── fixed words. It is worked out from assessor-led assessments only; a self-assessment never changes it. ──
export const EVIDENCE_SUPPORTED_NOTE = "Evidence-supported, not formally verified";
export const STAGE_FROM_ASSESSORS = "from assessor-led assessments";
export const STAGE_UNASSESSED = "No assessor-led evidence yet";
export const STAGE_NOT_STAGED = "Not staged yet";
export const STAGE_BLOCK_TITLE = "Evidence-supported stage";
export const STAGE_STALE_NOTE = "The evidence this rests on is older than the rules window, so a later assessment may change it.";
