// ── COMPETEN SCHOLAR LEARNING -- THE FIXED FACTS ── COMPETEN-IND-004, COMPETEN-IND-002 s3.2-s3.3 ─────────
//
// Every limit, prompt version, label and notice the Scholar journey uses, in one file that imports
// nothing, so the routes, the pages, the unit tests and scripts/scholar-learning-harness.ts all read the
// same values. Migration 372 restates the two that the schema also enforces (the 10 MB cap and the two
// MIME types). The harness checks the two agree.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
/** UPLOAD-01 U1: the most slides one PowerPoint material may hold (the policy can only lower it). */
export const MAX_PPTX_SLIDES = 300;
/** Total extracted characters kept from one file. Beyond this the upload is refused, not truncated. */
export const MAX_MATERIAL_CHARS = 600_000;
export const MAX_MATERIALS_PER_PERSON = 50;

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** COMPETEN-SCHOLAR-UPLOAD (Stage 2): plain text -- a .txt file, or text pasted into the page and kept as one. Migration 405. */
export const TEXT_MIME = "text/plain";
/** COMPETEN-SCHOLAR-UPLOAD-01 U1: a PowerPoint lecture, read slide by slide with its speaker notes. Migration 406. */
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const ALLOWED_MIME = [PDF_MIME, DOCX_MIME, PPTX_MIME, TEXT_MIME] as const;
export type UploadFormat = "pdf" | "docx" | "pptx" | "text";
/** The format a policy names (scholar_upload_formats), for each MIME type. */
export const FORMAT_OF: Record<(typeof ALLOWED_MIME)[number], UploadFormat> = { [PDF_MIME]: "pdf", [DOCX_MIME]: "docx", [PPTX_MIME]: "pptx", [TEXT_MIME]: "text" };
export const FORMAT_LABEL: Record<UploadFormat, string> = { pdf: "PDF", docx: "Word (.docx)", pptx: "PowerPoint (.pptx)", text: "Plain text (.txt or pasted)" };
/** What one citable unit of a material is called: a PDF has pages, a PowerPoint has slides, the rest have sections. */
export const UNIT_OF = (mime: string): "page" | "slide" | "section" => (mime === PDF_MIME ? "page" : mime === PPTX_MIME ? "slide" : "section");

/**
 * Pure. What may be uploaded now, from the Individual policy (scholar_upload_formats, scholar_upload_max_mb):
 * the MIME types, the byte limit, and the sentence a refusal or the upload panel shows. The routes check it on
 * the way in AND when processing, so a format switched off between the two steps is still refused.
 */
export function uploadRules(policy: { scholarUploadFormats: readonly string[]; scholarUploadMaxMb: number }) {
  const mimes = ALLOWED_MIME.filter(m => policy.scholarUploadFormats.includes(FORMAT_OF[m]));
  const maxBytes = Math.min(MAX_UPLOAD_BYTES, Math.max(1, Math.floor(policy.scholarUploadMaxMb)) * 1024 * 1024);
  const names = mimes.map(m => FORMAT_LABEL[FORMAT_OF[m]]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "nothing";
  return { mimes, maxBytes, maxMb: maxBytes / 1024 / 1024, text: mimes.includes(TEXT_MIME), describe: list };
}
export type MaterialMime = (typeof ALLOWED_MIME)[number];

export const BUCKET = "individual-scholar-materials";

/** Chunk sizing, in characters. A chunk never spans two PDF pages, so every citation is one page. */
export const CHUNK_TARGET = 1200;
export const CHUNK_MAX = 1800;

/** How many chunks one explanation may read. */
export const RETRIEVAL_LIMIT = 5;
export const QUESTION_MAX = 600;
export const QUESTIONS_PER_REQUEST = 3;
// Learning Intelligence (COMPETEN-SCHOLAR-01 S5) defaults. Governed by Individual policy (policy.ts), which
// clamps them: answers needed before a figure is shown, and the engagement window in days.
export const INSIGHT_MIN_ANSWERS = 5;
export const INSIGHT_WINDOW_DAYS = 28;

// ── PROVENANCE ── COMPETEN-IND-002 s3.3: "Every AI artefact stores its source chunk ids, model and prompt
// version. Prompts are inline strings today, so a prompt version constant is needed." Change a prompt in
// generation.ts and its version here changes with it, so a stored question always says which prompt
// produced it.
export const PROMPT_VERSIONS = {
  // v3 (Stage 3, carried from the parked Learn branch): rule 3 also forbids counting what a passage lists -- the
  // cause of every withheld plain explanation in a staging run. Every mode builds on it, so they move too.
  explain: "scholar-explain-v3",
  mcq: "scholar-mcq-v3",
  case: "scholar-case-v3",
  verify: "scholar-verify-v1",
  // COMPETEN-SCHOLAR-01. explain (above) is unchanged. The other modes add an instruction to the same
  // system prompt, so they carry their own version. A case is several linked steps from one passage.
  // v2: "go deeper" is two explicit parts, after the staging acceptance run saw part one drift past the notes
  // (it was withheld by the check, as it should be). Summary, simplify and tutor are unchanged.
  // v3: go deeper also told not to count things ("three signs") or use "significant" -- the two causes of every
  // withheld answer in a staging diagnostic. caseSteps v2: progression only in the passage's own words.
  // v4: the tutor gets the same no-counting rule (the cause of every withheld tutor turn in a diagnostic).
  // v5: the tutor may receive the student's own study context (P1, learner-context.ts) ahead of the passages.
  explainModes: "scholar-explain-modes-v6",
  // UPLOAD-01 U3: Scholar opts in to outcome-level mapping -- the Holdings engine's MAPPING_PROMPT_VERSION_OUTCOMES
  // (src/lib/competency/mapping.ts), pinned equal by a unit test.
  map: "competency-map-v3-outcomes",
  caseSteps: "scholar-case-steps-v2",
  // COMPETEN-SCHOLAR-LEARN-01: the learning actions, the informal check and the clarification, on the same
  // system prompt and checks as explain (generation.ts). v1.
  learn: "scholar-learn-v1",
} as const;

/** S4: a multi-step practice case has this many steps at most (migration 388 allows 1 to 5). */
export const CASE_MAX_STEPS = 4;
export const CASE_MIN_STEPS = 2;
/** S3: tutor turns the browser may send back. Nothing is stored (owner ruling D10). */
export const TUTOR_MAX_TURNS = 6;

// ── STAGE 3: LEARN ── COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24) ─────────────────────────────────────
//
// The student-facing learning actions, in the order the workspace offers them. Teach Me is the default. Each is
// one way of using the SAME engine (generation.ts): the student's own sections as passages, cited, checked.
// "check" and "clarify" are the informal understanding check -- never a practice question, never assessment.
export const LEARN_ACTIONS = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask"] as const;
export type LearnAction = (typeof LEARN_ACTIONS)[number];
export const LEARN_ACTION_LABEL: Record<LearnAction, string> = {
  teach: "Teach me", explain: "Explain this", simplify: "Simplify", deeper: "Go deeper", examples: "Give examples", summary: "Summarise", ask: "Ask Scholar",
};
export const isLearnAction = (v: unknown): v is LearnAction => typeof v === "string" && (LEARN_ACTIONS as readonly string[]).includes(v);
export const EXPLANATION_DEPTHS = ["brief", "standard", "detailed"] as const;
export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number];
export const CHECK_VERDICTS = ["understood", "partly", "not_yet"] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];
export const CHECK_VERDICT_LABEL: Record<CheckVerdict, string> = { understood: "Understood", partly: "Partly understood", not_yet: "Not yet" };
/** Sections one learning step teaches together, at most. */
export const STEP_MAX_SECTIONS = 3;
export const SESSION_MAX_STEPS = 20;
/**
 * The informal check is the student's own formative signal. Said wherever a verdict is shown, so it is never
 * read as an assessment result or as competence.
 */
export const INFORMAL_CHECK_LABEL = "A quick check for your own learning. It is not an assessment and does not count towards any competency.";
/** Learning activity shown against a competency (Progress) is activity, not evidence. */
export const NOT_COMPETENCE_LABEL = "Learning activity, not evidence of competence.";
/** The four kinds of content an answer may hold, said where each appears (owner GO s7). */
export const SOURCE_KIND_LABEL = {
  notes: "From your notes",
  reference: "Governed reference: your programme's competency catalogue",
  interpretation: "AI explanation beyond your notes: general background, not from your notes and not verified",
  flag: "Flagged by AI for you to check: possibly contradictory, unclear or unsafe in your notes. Not verified.",
} as const;

/**
 * S3: background the AI adds beyond the notes is shown APART from the notes-based answer, under this
 * label, and never counts as coming from them. The notes-only modes (summary, simplify) never show it.
 */
export const SUPPLEMENTARY_LABEL = "Beyond your notes: general background from the AI. It is not from your notes and has not been verified. Check it against your course materials.";
/** S2: a proposed competency link is a suggestion until the person accepts it. */
export const MAPPING_LABEL = "Suggested by AI from your notes. Accept the ones that fit and reject the rest. Every choice is kept as a record.";

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
export const CONSENT_NOTICE_VERSION = "scholar-ai-uploads-notice-v3";
/**
 * v3 (owner GO, 2026-10-23): the owner-approved v2 wording with the seven consistency corrections from
 * build record s10. Subject to legal review (COMPETEN-LEGAL-001). Do not edit a word without a new
 * approval and a new version: the version is stored with every grant, and a grant counts only for the
 * CURRENT version (consentIsCurrent), so a v2 grant is kept as a record but asked again.
 * scripts/scholar-learning-harness.ts pins the separation sentences.
 */
export const CONSENT_NOTICE = {
  heading: "AI-assisted learning and your information",
  paragraphs: [
    "Competen Scholar uses artificial intelligence to help you study, understand learning materials, generate practice questions and clinical cases, and receive personalised explanations, and feedback on practice questions drawn from your notes.",
    "AI-generated information may be incomplete or incorrect. It is intended to support learning and does not replace approved clinical guidance, professional supervision or independently verified competency assessment.",
    "When you use AI features, relevant information you provide may be processed by Competen and its authorised technology providers to deliver those features. Your private uploads are not shared with other learners, and Competen does not use them to train AI models.",
    "Please do not upload identifiable patient information or material you do not have permission to use.",
  ],
  /** Consistency item 7: the operational facts, all true of the code today. */
  howItWorks: [
    "Only the passages of your notes that you ask about are sent to the AI.",
    "Explanations are shown to you and not saved.",
    "Practice questions are saved with the passage they came from, so you can check them.",
    "Turning AI help off stops new AI requests. It deletes nothing: your notes, questions and progress stay until you delete them.",
  ],
  review: "You can review the applicable Privacy Notice and Terms of Use before continuing.",
  statement: "I understand how AI-assisted learning works and agree to the processing necessary to provide the AI features, as described in the Privacy Notice.",
} as const;

/** Shown instead of the agreement while the documents the notice relies on are not yet published. */
export const CONSENT_AWAITING_LEGAL = "AI help will be available once our Privacy Notice and Terms of Use are published.";
/** Shown to a person whose recorded agreement is to an earlier version of the notice. */
export const CONSENT_UPDATED = "We have updated how we describe AI help. Please review the notice and agree again to keep using it.";

/** Consistency item 2: one attestation, one timestamp (pii_attested_at), covering both. */
export const UPLOAD_ATTESTATION = "I confirm this file contains no identifiable patient information, and I have permission to upload and use it.";
export const UPLOAD_ATTESTATION_REQUIRED = "Confirm the file contains no identifiable patient information and that you have permission to upload and use it.";

export const PII_WARNING =
  "Do not upload anything that identifies a patient: no names with clinical details, NHS or hospital numbers, dates of birth or addresses. Only upload material you have permission to use, such as your own notes, lecture slides and published guidance.";

/**
 * COMPETEN-SCHOLAR-01, owner ruling 2026-10-24: a competency's content status is LABELLED wherever it appears, never
 * hidden silently. "Clinically approved" is said only where the catalogue entry says so (S1, migration 394).
 */
export const CONTENT_STATUS_LABEL: Record<"approved" | "draft" | "unreviewed", string> = {
  approved: "Clinically approved",
  draft: "Draft content",
  unreviewed: "Not clinically reviewed",
};
/** Shown where the policy floor offers only approved content and the programme has none yet. */
export const NO_APPROVED_COMPETENCIES = "No clinically approved competencies yet.";
