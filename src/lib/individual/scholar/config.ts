// ── COMPETEN SCHOLAR LEARNING -- THE FIXED FACTS ── COMPETEN-IND-004, COMPETEN-IND-002 s3.2-s3.3 ─────────
//
// Every limit, prompt version, label and notice the Scholar journey uses, in one file that imports
// nothing, so the routes, the pages, the unit tests and scripts/scholar-learning-harness.ts all read the
// same values. Migration 372 restates the two that the schema also enforces (the 10 MB cap and the two
// MIME types). The harness checks the two agree.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
/** Total extracted characters kept from one file. Beyond this the upload is refused, not truncated. */
export const MAX_MATERIAL_CHARS = 600_000;
export const MAX_MATERIALS_PER_PERSON = 50;

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ALLOWED_MIME = [PDF_MIME, DOCX_MIME] as const;
export type MaterialMime = (typeof ALLOWED_MIME)[number];

export const BUCKET = "individual-scholar-materials";

/** Chunk sizing, in characters. A chunk never spans two PDF pages, so every citation is one page. */
export const CHUNK_TARGET = 1200;
export const CHUNK_MAX = 1800;

/** How many chunks one explanation may read. */
export const RETRIEVAL_LIMIT = 5;
export const QUESTION_MAX = 600;
export const QUESTIONS_PER_REQUEST = 3;

// ── PROVENANCE ── COMPETEN-IND-002 s3.3: "Every AI artefact stores its source chunk ids, model and prompt
// version. Prompts are inline strings today, so a prompt version constant is needed." Change a prompt in
// generation.ts and its version here changes with it, so a stored question always says which prompt
// produced it.
export const PROMPT_VERSIONS = {
  explain: "scholar-explain-v2",
  mcq: "scholar-mcq-v3",
  case: "scholar-case-v3",
  verify: "scholar-verify-v1",
} as const;

// ── LABELS THAT MUST NOT DRIFT ── the harness pins each of these to the surface that must show it ─────
export const AI_LABEL = "AI-generated from your notes, not clinically reviewed";
/**
 * Owner review P0.2. A source-derived answer says what the person's notes say. It is not independently
 * verified clinical guidance, and the notes themselves may be out of date or wrong. Shown under every
 * explanation, every piece of answer feedback and every revision answer.
 */
export const SOURCE_NOTICE =
  "This comes from your own notes, not from verified clinical guidance. Your notes may be incomplete or out of date. Check against current guidelines and your course materials, and never use it to make decisions about a real patient.";
/** How a marked answer is described: right or wrong against the notes, not against clinical truth. */
export const MARKED_AGAINST_NOTES = "Marked against your notes, not against clinical guidelines.";
/** Owner review P0.5: a personal practice case is never mistaken for a clinically reviewed one. */
export const PERSONAL_CASE_LABEL = "Practice scenario from your notes · not a clinically reviewed case";
export const SELF_DIRECTED_LABEL = "Self-directed study. Nothing here is verified or assessed by an organisation.";

// ── CONSENT ── the migration-215 per-feature switch, per person ──────────────────────────────────────
//
// What the person is shown when they turn AI processing on. Its version is stored with the grant
// (individual_scholar_consent.notice_version), so what was agreed to can be shown later. A product
// notice, not legal text: the Terms and Privacy Notice the person accepted on entry (owner ruling D2)
// remain the legal documents, and this notice must be reviewed alongside them (COMPETEN-LEGAL-001).
export const CONSENT_FEATURE = "ai_processing_uploads";
export const CONSENT_NOTICE_VERSION = "scholar-ai-uploads-notice-v2";
/**
 * The owner-approved wording (owner GO, 2026-10-23), VERBATIM, subject to legal review (COMPETEN-LEGAL-001).
 * Do not edit a word without a new approval and a new version: the version is stored with every grant.
 * scripts/scholar-learning-harness.ts pins the separation sentences.
 */
export const CONSENT_NOTICE = {
  heading: "AI-assisted learning and your information",
  paragraphs: [
    "Competen Scholar uses artificial intelligence to help you study, understand learning materials, generate practice questions and clinical cases, and receive personalised explanations and feedback.",
    "AI-generated information may be incomplete or incorrect. It is intended to support learning and does not replace approved clinical guidance, professional supervision or independently verified competency assessment.",
    "When you use AI features, relevant information you provide may be processed by Competen and its authorised technology providers to deliver those features. Your private uploads are not automatically shared with other learners or added to Competen's verified learning library.",
    "With your separate, optional permission, eligible materials may be submitted for review and possible inclusion in a shared learning library. Submission does not guarantee publication. Permission to contribute materials is separate from any permission to use data for training AI models.",
    "Please do not upload identifiable patient information or material you do not have permission to use.",
  ],
  review: "You can review the applicable Privacy Notice and Terms of Service before continuing.",
  statement: "I understand how AI-assisted learning works and agree to the processing necessary to provide the AI features, as described in the Privacy Notice.",
} as const;

export const PII_WARNING =
  "Do not upload anything that identifies a patient: no names with clinical details, NHS or hospital numbers, dates of birth or addresses. Use your own notes, lecture slides and published guidance.";
