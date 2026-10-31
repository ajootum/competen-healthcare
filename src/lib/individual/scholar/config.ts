// ── COMPETEN SCHOLAR LEARNING -- THE FIXED FACTS ── COMPETEN-IND-004, COMPETEN-IND-002 s3.2-s3.3 ─────────
//
// Every limit, prompt version, label and notice the Scholar journey uses, in one file that imports
// nothing, so the routes, the pages, the unit tests and scripts/scholar-learning-harness.ts all read the
// same values. Migration 372 restates the two that the schema also enforces (the 10 MB cap and the two
// MIME types). The harness checks the two agree.

// Owner GO 2026-10-24 (upload limits): the CEILING for one file is 25 MB (migration 413 raises the DB CHECK and the
// bucket to it). What a student may upload is the Individual policy scholar_upload_max_mb, which stays at
// DEFAULT_UPLOAD_MB until HQ raises it -- and can never go above this ceiling.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_UPLOAD_MB = 10;
/** An upload session: the files one upload action sends, and on the server the files kept within this window. */
export const UPLOAD_SESSION_MINUTES = 60;
export const MAX_SESSION_FILES = 10;
export const MAX_SESSION_MB = 100;
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
export function uploadRules(policy: { scholarUploadFormats: readonly string[]; scholarUploadMaxMb: number; scholarUploadSessionFiles?: number; scholarUploadSessionMb?: number }) {
  const mimes = ALLOWED_MIME.filter(m => policy.scholarUploadFormats.includes(FORMAT_OF[m]));
  const maxBytes = Math.min(MAX_UPLOAD_BYTES, Math.max(1, Math.floor(policy.scholarUploadMaxMb)) * 1024 * 1024);
  const names = mimes.map(m => FORMAT_LABEL[FORMAT_OF[m]]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "nothing";
  // The session limits: never above the fixed maxima, and a session always holds at least one file of the limit.
  const sessionFiles = Math.min(MAX_SESSION_FILES, Math.max(1, Math.floor(policy.scholarUploadSessionFiles ?? MAX_SESSION_FILES)));
  const sessionBytes = Math.max(maxBytes, Math.min(MAX_SESSION_MB, Math.floor(policy.scholarUploadSessionMb ?? MAX_SESSION_MB)) * 1024 * 1024);
  return { mimes, maxBytes, maxMb: maxBytes / 1024 / 1024, text: mimes.includes(TEXT_MIME), describe: list, sessionFiles, sessionBytes, sessionMb: sessionBytes / 1024 / 1024 };
}

/**
 * Pure. Whether one more file of `size` bytes fits this upload session: the files the person kept within the last
 * UPLOAD_SESSION_MINUTES, plus this one, against the session limits. The sentence a refusal shows, or null.
 */
export function sessionRefusal(rules: { sessionFiles: number; sessionBytes: number; sessionMb: number }, recent: { count: number; bytes: number }, size: number): string | null {
  if (recent.count + 1 > rules.sessionFiles)
    return `You have uploaded ${recent.count} file${recent.count === 1 ? "" : "s"} in the last hour, the most one upload session takes. Try again a little later.`;
  if (recent.bytes + size > rules.sessionBytes)
    return `This file would take your uploads in the last hour over ${rules.sessionMb} MB, the most one upload session takes. Try again a little later, or upload a smaller file.`;
  return null;
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
  // v4 (SCHOLAR-QUESTION-INTELLIGENCE-01): the rubric fields, a spread of cognitive levels, and the guidance block
  // (concepts, competency, level, difficulty, count, references) after the passage. case moves with it.
  mcq: "scholar-mcq-v4",
  case: "scholar-case-v4",
  verify: "scholar-verify-v1",
  // SCHOLAR-QUESTION-INTELLIGENCE-01: the same blind check for mrq and short revision items (question-quality.ts).
  verifyRevision: "scholar-verify-revision-v1",
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
  // system prompt and checks as explain (generation.ts). v2: a last no-counting reminder (staging, Simplify).
  // v3: Simplify keeps the passages' own names rather than counting them ("two tubes" for "right and left").
  learn: "scholar-learn-v3",
  // SCHOLAR-SESSION-AI-02 slice C (owner D4): an ask in a connected study session carries the study-session block
  // (study-session-context.ts) beside the learner context. Its own suffix ("scholar-learn-v3:ask+scholar-study-session-v1"),
  // so a request with the block is always told apart from one without; an ask is never a saved artefact.
  studySession: "scholar-study-session-v1",
  // SCHOLAR-LEARN-FIX-01 L-B: Teach Me is a STRUCTURED lesson -- overview, cited key points, an example only where the
  // passages support one, and a one-or-two question understanding check (teach-format.ts). Teach carries this on top of
  // `learn` (generation.ts learnPromptVersion), so a Teach Me answer saved in the old free-text form is never reused.
  // v2 (SCHOLAR-GUIDED-LEARNING-01): no unsupported counts ("two types") unless the passages give them. A saved v1
  // lesson is still opened, with no AI call (LEARN_TEACH_LEGACY): its structure and checks are the same.
  learnTeach: "scholar-learn-teach-v2",
  // COMPETEN-SCHOLAR-REVISION-01 R4: AI evaluation of a short answer (Holdings activity `evaluate`).
  // v2 (SCHOLAR-QUESTION-INTELLIGENCE-01): five labelled feedback parts, judged against the rubric where there is one.
  evaluate: "scholar-evaluate-v2",
  // COMPETEN-SCHOLAR-REVISION-01 R2: revision questions of the 416 kinds, one prompt per kind, on the question rules.
  // v2: answers and rationale in the passage's own words; [] when a kind does not fit; a matching item only with three pairs.
  // v3 (SCHOLAR-QUESTION-INTELLIGENCE-01): every item asks (never a statement as a flashcard front), the rubric fields,
  // the guidance block; mrq and short carry +verifyRevision (generation.ts revisionPromptVersion).
  revision: "scholar-revision-v3",
  // v2 (staging acceptance notes): a concise one-concept back, a short explanation, a topic, a learner-voice objective.
  // SCHOLAR-FLASHCARDS-QA-01: flashcards are written to a configured mix of recall, understanding, application and
  // clinical reasoning (policy scholar_flashcard_level_mix), only at the levels the passage can support. A flashcard
  // is therefore written at "scholar-revision-v3:flashcard+scholar-flashcard-mix-v2" (generation.ts revisionPromptVersion).
  flashcardMix: "scholar-flashcard-mix-v2",
  // SCHOLAR-SQIE-CLOSE-01 (710): a structured question -- a lead-in and two to four parts, each with its marks and its
  // rubric -- on the revision rules (generation.ts REVISION_SYSTEM.structured). Its own version: a new prompt.
  structured: "scholar-structured-v1",
  // COMPETEN-SCHOLAR-CLINICAL-REASONING-01: a private case drafted from the notes, and AI feedback on written reasoning.
  // v2: no counting, and no state or change words the passages do not use (the staging runs' refusal reasons).
  // v3 (SCHOLAR-AI-OPT-01 P2): the reply example shows expectedResponse on a free-text decision and says one decision per
  // stage -- the acceptance run's other refused draft had a free-text decision with no expected response.
  caseBlueprint: "scholar-case-blueprint-v3",
  // v2 (SCHOLAR-QUESTION-INTELLIGENCE-01): the five feedback parts, clinically equivalent wording accepted.
  caseReasoning: "scholar-case-reasoning-v2",
} as const;

// ── STAGE 4: REVISION ── COMPETEN-SCHOLAR-REVISION-01 (owner GO 2026-10-24) ─────────────────────────────────────
// Formative revision from the student's own notes. Never assessment, never competence, never Passport evidence as
// such. Every AI-written question is private_formative (migration 416 makes nothing else storable).
// SCHOLAR-SQIE-CLOSE-01: structured (multi-part) is stored only where migration 710 is applied (store.ts sqieSchema).
// Where it is absent it is never offered, whatever the policy says.
export const REVISION_FORMATS = ["mcq", "mrq", "short", "flashcard", "match", "sequence", "structured"] as const;
export type RevisionFormat = (typeof REVISION_FORMATS)[number];
export const REVISION_FORMAT_LABEL: Record<RevisionFormat, string> = {
  mcq: "Multiple choice", mrq: "Multiple response", short: "Short answer", flashcard: "Flashcards", match: "Matching", sequence: "Sequencing",
  structured: "Structured (multi-part)",
};
/** SCHOLAR-GUIDED-LEARNING-01: earlier Teach Me versions whose saved lessons are still opened (same structure and checks). */
export const LEARN_TEACH_LEGACY: readonly string[] = ["scholar-learn-teach-v1"];
/** SCHOLAR-SQIE-CLOSE-01: a structured question has 2 to 4 parts of 1 to 5 marks each (migration 710 CHECK). */
export const STRUCTURED_PARTS_MIN = 2;
export const STRUCTURED_PARTS_MAX = 4;
export const STRUCTURED_PART_MARKS_MAX = 5;
/** The total of a structured question's part marks, as the learner sees it: formative, never an assessment. */
export const PRACTICE_MARKS_LABEL = "Practice marks (formative): not an assessment and not a grade";
export const REVISION_MODES = ["today", "quick", "spaced", "weak", "mock", "flashcards", "custom"] as const;
export type RevisionMode = (typeof REVISION_MODES)[number];
export const REVISION_MODE_LABEL: Record<RevisionMode, string> = {
  today: "Today's revision", quick: "Quick practice", spaced: "Spaced revision", weak: "Weak areas", mock: "Mock practice", flashcards: "Flashcards", custom: "Saved revision set",
};
export const REVISION_MODE_HELP: Record<RevisionMode, string> = {
  today: "What is due, what you found hard, and something new, in one session.",
  quick: "A short mix of questions from what you choose.",
  spaced: "The cards that are due today, on your schedule.",
  weak: "Questions you got wrong, most-missed first.",
  mock: "A longer mixed set with the answers at the end. Practice only: not an assessment.",
  flashcards: "Recall and grade yourself, card by card.",
  custom: "Replay a set you saved. No new AI is used.",
};
export const REVISION_DIFFICULTIES = ["any", "easy", "standard", "harder"] as const;
export type RevisionDifficulty = (typeof REVISION_DIFFICULTIES)[number];
export const REVISION_QUANTITY_MAX = 50;
/** Most AI generation calls one revision session may make to fill its shortfall. */
export const REVISION_GENERATION_CALLS_MAX = 8;
// ── ADAPTIVE EXAMS ── SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026) ─────────────────────────────────────────────
// A formative practice exam on the revision engine whose next question's difficulty follows a stated rule on the
// student's own answers. Transparent rule-based adaptation only: no item calibration, no ability estimate, no score
// on any scale. Never an examination, never verification, never competence.
/** The formats an adaptive exam may use. Flashcards are self-graded recall, not an exam answer, so they are not offered. */
export const ADAPTIVE_FORMATS = ["mcq", "mrq", "short", "match", "sequence", "structured"] as const satisfies readonly RevisionFormat[];
export type AdaptiveFormat = (typeof ADAPTIVE_FORMATS)[number];
/** Questions in one adaptive exam: at least five (the rule needs answers to act on), at most 417's session cap. */
export const ADAPTIVE_LENGTH_MIN = 5;
export const ADAPTIVE_LENGTH_MAX = 50;
/** An optional time limit, in minutes. */
export const ADAPTIVE_TIME_LIMITS = [10, 15, 20, 30, 45, 60, 90] as const;
/** Most generation calls one adaptive exam may make for questions at the difficulty it needs. */
export const ADAPTIVE_GENERATION_CALLS_MAX = REVISION_GENERATION_CALLS_MAX;
export const ADAPTIVE_TITLE = "Adaptive exam";
export const ADAPTIVE_HELP = "A practice exam that gets harder or easier as you answer, by a simple stated rule. Formative practice: not an examination.";
/** The rule, in the words the student sees beside the exam. It is question-intel.ts adaptDifficulty, applied as adaptive.ts says. */
export const ADAPTIVE_RULE = "Harder after 3 correct in a row; easier after 2 of the last 3 missed. The count starts again after each change, and an answer that waits for your own marking at the end does not move it.";
/** Said on every report and result of an adaptive exam (owner instruction: no calibrated-testing claim). */
export const ADAPTIVE_REPORT_LABEL = "Practice estimate from rule-based adaptation — not a calibrated exam score, not a formal examination result, and not verified competence.";
/** Where migration 720 is absent the exam is kept as a mock-practice session marked adaptive, and its report says so. */
export const ADAPTIVE_FALLBACK_NOTE = "Kept as a mock-practice session marked adaptive: this environment does not yet record adaptive exams as their own kind. The questions, the rule and this report are the same.";
// ── STAGE 5A: CLINICAL REASONING ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (owner GO 2026-10-25) ───────────────────
export const CASE_CONTEXTS = ["general", "medical", "surgical", "paediatric", "maternal", "emergency", "critical_care"] as const;
export type CaseContext = (typeof CASE_CONTEXTS)[number];
export const CASE_CONTEXT_LABEL: Record<CaseContext, string> = {
  general: "General", medical: "Medical", surgical: "Surgical", paediatric: "Paediatric", maternal: "Maternal health", emergency: "Emergency", critical_care: "Critical care",
};
export const CASE_ENTRIES = ["notes", "competency", "library", "surprise"] as const;
export type CaseEntry = (typeof CASE_ENTRIES)[number];
export const CASE_ENTRY_LABEL: Record<CaseEntry, string> = {
  notes: "Generate a case from my notes", competency: "Practise a competency", library: "Choose an existing case", surprise: "Surprise me",
};
export const CASE_DIMENSION_LABEL: Record<string, string> = {
  recognition: "Recognition", interpretation: "Interpretation", prioritisation: "Prioritisation", decision: "Decision-making", reassessment: "Reassessment", escalation: "Communication and escalation",
};
export const PRIVATE_CASE_LABEL = "Practice case written by AI from your notes · formative simulation, not a clinically reviewed case";
export const LIBRARY_CASE_LABEL = "Governed library case · clinically approved for this exact version · formative simulation";
export const MOCK_LABEL = "Mock practice from your own notes: formative revision, not an assessment, and never evidence of competence.";
export const REVISION_LABEL = "Revision from your notes · formative practice, not an assessment";
/** SCHOLAR-SQIE-CLOSE-01 C: a question reused from the governed Competen library (442, published and clinically approved). */
/** SCHOLAR-FLASHCARDS-01 (730): what a hand-written card is bound to. Any other model or provider is AI-written or library. */
export const LEARNER_CARD = { model: "learner", provider: "learner", promptVersion: "learner:v1" } as const;
/** SCHOLAR-FLASHCARDS-01: how a hand-written card is labelled wherever it is shown. Never clinically reviewed. */
export const LEARNER_CARD_LABEL = "Your card · written by you, not clinically reviewed";
export const LIBRARY_QUESTION_LABEL = "From the Competen library (clinically reviewed)";
export const LIBRARY_REVISION_LABEL = `${LIBRARY_QUESTION_LABEL} · formative practice, not an assessment`;
/** SCHOLAR-SQIE-01: what a generated question rests on (question-intel.ts rubric.source), in words. */
export const GROUNDING_LABEL = { notes: "From your notes", references: "From your notes + approved references" } as const;
/** SCHOLAR-QUESTION-INTELLIGENCE-01: the five parts of formative feedback (question-intel.ts FeedbackParts). */
export const FEEDBACK_HEADINGS = {
  right: "What you got right", missing: "Missing concepts", misconceptions: "Misconceptions", why: "Why the answer holds", next: "What to revise next",
} as const;

/** Owner D3: the shared personal AI, reached from Learn. Never a Learn answer: shown apart, under these words. */
export const PERSONAL_AI_LABEL = "Personal AI assistant — general explanation, not checked against your notes, not clinically reviewed";

// ── REVISION-01 R4: HOW AN ANSWER WAS MARKED ── always said beside the result (migration 416 `marking`) ──
// Deterministic marking and AI evaluation are never presented alike. Where AI evaluation is unavailable (metering
// refuses it, e.g. not_eligible, or AI is off), a short answer falls back to the stored accepted answers: matched by
// code where it can be, otherwise the student compares and says -- labelled as what it is.
export const MARKING_LABEL = {
  deterministic: "Marked against the stored answer",
  self_graded: "Your own judgement, against the stored answer",
  ai_evaluation: "AI evaluation: an AI judged your answer against your notes. Not verified.",
} as const;
export type Marking = keyof typeof MARKING_LABEL;

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

// ── EVALUATION-01 (Stage 6): what an evaluation is called, and how each part of it reads ──
export const EVALUATION_LABEL = "Formative self-evaluation of your own learning · not an assessment, and never verified clinical competence";
export const EVALUATION_DIMENSION_LABEL = {
  knowledge: { title: "Knowledge", what: "How your structured questions went, marked by their key." },
  retention: { title: "Retention", what: "What you recalled after a gap of a day or more." },
  application: { title: "Application", what: "Scenario and case-step questions: using what you know in a situation." },
  reasoning: { title: "Clinical reasoning", what: "Decisions in your clinical cases, by reasoning dimension, with safety points." },
  coverage: { title: "Coverage", what: "Which sections and learning outcomes you have worked on. Not what you know." },
  confidence: { title: "Evidence confidence", what: "How far this evidence can be relied on: amount, breadth, recency and how it was marked." },
} as const;
export const EVALUATION_BAND_LABEL = { strong: "A strength", developing: "Developing", needs_work: "A learning gap" } as const;
export const EVALUATION_CONFIDENCE_LABEL = { strong: "Strong evidence", moderate: "Moderate evidence", limited: "Limited evidence", insufficient: "Too little evidence to say" } as const;
export const EVALUATION_METHOD_LABEL = { existing: "From your existing evidence", fresh: "A fresh knowledge check", combined: "Existing evidence and a fresh check" } as const;
/** The four kinds of content an answer may hold, said where each appears (owner GO s7). */
/** Stage 3 acceptance item 3: an AI flag is the AI's, for the student to check -- never clinical review. */
export const FLAG_HEADING = "Flagged by AI for you to check";
export const FLAG_NOTE = "The AI thinks these may be contradictory, unclear or unsafe in your notes. They are not verified and not clinical review: check them against your course materials or with a supervisor.";
export const SOURCE_KIND_LABEL = {
  notes: "From your notes",
  reference: "Governed reference: what you are working towards. Clinically reviewed only where marked approved",
  interpretation: "AI explanation beyond your notes: general background, not from your notes and not verified",
  flag: `${FLAG_HEADING}: possibly contradictory, unclear or unsafe in your notes. Not verified.`,
  /** COMPETEN-RESEARCH-01: matched from the governed Competen library by topic. */
  library: "Competen library: governed competencies and outcomes. Clinically reviewed only where marked approved",
  /** COMPETEN-RESEARCH-01: Research & Explain, apart from the notes. */
  research: "External research: from published abstracts Competen found (PubMed, OpenAlex). Not from your notes and not clinically reviewed. Open the source before relying on it",
} as const;
/** SCHOLAR-LEARN-FIX-01 L-B: a partly grounded lesson -- taught from what the notes support, then the gaps, named. */
export const LEARN_NOT_COVERED_LABEL = "Not covered in your notes";
export const LEARN_NOT_COVERED_NOTE = "The explanation above uses only what your notes support. Scholar did not explain these.";
export const LEARN_WIDER_LABEL = "Explore wider sources";
/** COMPETEN-RESEARCH-01: the three Learn modes, as the learner sees them. */
export const LEARN_MODE_LABEL = { notes: "My notes only", library: "My notes + Competen library", research: "Research & Explain" } as const;

/** SCHOLAR-SQIE-02 s7: evidence recovery, as the learner sees it. No internal activity names, no eligibility terms. */
export const RECOVERY_PROMPT = "Your notes do not contain enough information to fully explain this topic. Would you like to explore additional learning resources?";
export const RECOVERY_ACTION_LABEL = {
  find_resources: "Find learning resources",
  explain_with_references: "Explain using approved references",
  continue_with_notes: "Continue with my notes",
} as const;
export const RECOVERY_ORIGIN_LABEL = { notes: "Your notes", library: "Competen library", external: "External reference", ai: "AI explanation" } as const;
/** What was retrieved for an external reference. "full text" only if full text was retrieved: never today. */
export const RECOVERY_RETRIEVED_LABEL = { metadata: "details only", abstract: "abstract only", full_text: "full text" } as const;
/** SCHOLAR-SOURCE-QUALITY-01: why a published source found is reading only, never used to explain. */
export const RECOVERY_NOT_USED_LABEL = {
  not_indexed: "not indexed in PubMed",
  type_unknown: "publication type not known",
  type_excluded: "not a review, guideline or trial",
  off_topic: "its title does not name this topic",
} as const;
/** Learn Research & Explain: research was found, but none of it met the source rules, so nothing from it explains. */
export const RESEARCH_READING_ONLY = "The research found did not meet the source rules for explaining (PubMed-indexed reviews, guidelines or trials naming this topic), so it is listed as reading only.";
export const RECOVERY_UNANSWERED_LABEL = "Not found in any of these sources yet";
/** An explanation written from recovered evidence, by the same checked AI the learner was using. */
export const RECOVERY_EXPLANATION_LABEL = "AI explanation from your notes + approved references";
export const RECOVERY_STILL_WITHHELD = "Scholar still could not explain this fully from your notes and the approved references, so nothing unsupported was shown.";

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
/**
 * COMPETEN INDIVIDUAL CROSS-EXPERIENCE PERSONAL AI CONTEXT (owner decision, approved subject to explicit consent,
 * 29 Oct 2026, migration 700). OFF until the person turns it on, revocable at any time, and only for a person who also
 * has Professional. What it shares is exactly what the notice says. Do not edit a word without a new version.
 */
export const CROSS_EXPERIENCE_FEATURE = "ai_cross_experience_context";
export const CROSS_EXPERIENCE_NOTICE_VERSION = "cross-experience-ai-notice-v1";
export const CROSS_EXPERIENCE_NOTICE = {
  heading: "Let your Scholar assistant use your Professional development plan",
  shares: [
    "The development needs you recorded in Professional",
    "The goals in your Professional development plan",
  ],
  never: [
    "Anything an employer, a workplace or another person recorded about you",
    "Your reflections, documents or private notes",
    "Anyone else's information",
  ],
  how: "Your Scholar assistant reads them, as you recorded them, only when you ask it something, to suggest how your studies can help. It never changes them, and its suggestions are labelled as suggestions, never as your goals.",
  off: "You can turn this off at any time. Your assistant stops reading them straight away. Nothing is deleted.",
} as const;
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
// ── STAGE 3 ACCEPTANCE ITEM 4: AN ANSWER WITHHELD AS UNSUPPORTED ── said plainly, with notes-only next steps ──
// Nothing here is clinical content: the reason, the student's own nearest sections, a rephrase, and -- only where
// policy allows and it passed its own checks -- the labelled background the same request produced.
export const NOT_IN_NOTES_LABEL = "This isn't in your notes.";
export const WITHHELD_WHY: Record<"not_in_notes" | "no_citation" | "bad_citation" | "ungrounded", string> = {
  not_in_notes: "Scholar answers only from your notes, and could not find this in them. It will not fill the gap with clinical information from anywhere else.",
  no_citation: "Scholar's answer did not show which part of your notes it came from, so it was not shown. Scholar only shows what it can point to in your notes.",
  bad_citation: "Scholar's answer pointed to a part of your notes it was not given, so it was not shown.",
  ungrounded: "Scholar's answer included details that are not in your notes, so it was not shown. Scholar will not show clinical information your notes do not support.",
};
/** How many of the student's own sections a withheld answer offers to read instead. */
export const WITHHELD_NEAREST_MAX = 3;

/** A saved reference whose outcome its competency's current content no longer holds (learn.ts referenceStatus). */
export const REFERENCE_CHANGED_LABEL = "Changed since: not clinically reviewed";
/** Shown where the policy floor offers only approved content and the programme has none yet. */
export const NO_APPROVED_COMPETENCIES = "No clinically approved competencies yet.";

// ── SCHOLAR-EDU-AI-01 (owner, 30 Oct 2026, s3, s4, s6): WHAT A STUDENT IS TOLD ABOUT SCHOLAR'S AI ─────────────
// Scholar is an AI-supported EDUCATION product, not clinical decision support. Every student-facing sentence about
// that -- the persistent notice, the full disclaimer, the formative label on AI feedback, and what an unavailable AI
// action says -- lives here, so wording changes in one place. Change a word: change the version with it.
// The governance reason HQ reads (allowance.ts NOT_ELIGIBLE_REASON) is untouched: students get these words instead.
export const SCHOLAR_EDU_AI = {
  version: "scholar-edu-ai-v1",
  /** s3: one line, shown once in the Scholar shell (never per answer). */
  notice: "For learning only — AI can be incomplete or wrong. Check against your course materials and current local guidelines.",
  disclaimerLabel: "Full disclaimer",
  disclaimerHeading: "Using Competen Scholar's AI",
  disclaimer: [
    "Competen Scholar is for education. It helps you study; it is not a clinical tool.",
    "AI-generated content may be incomplete or inaccurate. Verify it against your course materials, recognised references and current local clinical guidelines.",
    "Scholar is not intended for real-time patient management, prescribing or treatment decisions. In a real clinical situation, follow local policy and your clinical team.",
    "AI feedback is formative. It is not a formal examination result or a verified competency.",
  ],
  /** s4: once per block of AI feedback on a student's answer or knowledge check. */
  formative: "Practice feedback from AI — not a formal exam result or a verified competency.",
  /** s4, Evaluate: the results are computed from the student's own evidence (AI-judged answers shown apart), not written by AI. */
  formativeEvaluation: "Practice feedback on your own learning — not a formal exam result or a verified competency.",
  /** s6: what an AI action that is not available says to the student, before or after a click. */
  unavailable: {
    general: "AI help isn't available for this yet. Nothing you have written or saved is lost — you can carry on with your notes and try AI help again later.",
    /** The examination-paper "Check my attempt" / suggested answer (activity `deeper`). `saved`: a suggested answer is already kept. */
    paper: (saved: boolean) =>
      `AI feedback isn't available for this question yet. Your answer stays here — you can compare it with ${saved ? "the suggested answer you saved" : "your notes or the original paper"}, and try AI feedback again later.`,
  },
} as const;
