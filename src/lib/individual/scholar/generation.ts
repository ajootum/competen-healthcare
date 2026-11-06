import { generate, type GenerateArgs, type GenerateResult } from "@/lib/ai/client";
import { ASSERTION_MARKERS, SAFETY_CONTEXT, parseJsonArray, textGroundingViolations, type PhrasingViolation } from "@/lib/ai/grounding";
import { proposeMappings, type MappingFraming, type MappingSubject } from "@/lib/competency/mapping";
import { CONTEXT_PREAMBLE } from "./learner-context";
import { VERIFY_FORMATS_DEFAULT } from "./question-formats";
import { SCENARIO_SCOPE_LINE } from "./scenario";
import { CASE_MAX_STEPS, CASE_MIN_STEPS, EXTENDED_POINTS_MAX, EXTENDED_POINTS_MIN, FEEDBACK_HEADINGS, LEARN_TEACH_LEGACY, PROMPT_VERSIONS, QUESTIONS_PER_REQUEST, isTeachingAction, type CheckVerdict, type ClassicLearnAction, type ExplanationDepth, type LearnAction, type TeachingAction } from "./config";
import { CHECK_LABEL } from "./learn-check";
import { DEPTH_REACHED, parseDepthReached } from "./learn-context";
import { DEEPER_MAX_OPTIONS, DEEPER_MAX_QUESTIONS, DEEPER_MAX_SECTIONS, DEEPER_MAX_TAKEAWAYS, composeDeeperAnswer, deeperNotesOnlyText, deeperSectionText, parseDeeperAnswer, type DeeperBlock, type DeeperParts, type DeeperQuestion, type DeeperSection } from "./deeper-format";
import { DEEPER_MAX_TOKENS, SCHOLAR_SECTION_CHARS, deeperInstruction, notesClaimViolations, notesSectionSupported, scholarClaimViolations, sentenceSupported, sentencesOf } from "./deeper-prompt";
import { examClaimViolations, highYieldWords, normaliseTeachingMarkdown, teachingBase, teachingInstruction, teachingMaxTokens, type ExamEvidence, type HintLevel } from "./learn-teaching";
import type { CognitiveLevel } from "./question-intel";
import { DEPTH_RULE, SUBJECT_RULE, aboutTheDocument } from "./revision-depth";
import { citeChunk, findPatientIdentifiers } from "./extract";
import { TEACH_LABEL, TEACH_MAX_QUESTIONS, citedTags, composeTeachAnswer, parseTeachAnswer, questionText, type TeachParts } from "./teach-format";
import { structureLabel, type CatalogueCompetency } from "./catalogue";
import {
  REVISION_VERIFY_SYSTEM, VERIFY_SYSTEM, applyRevisionVerification, applyVerification, passageVocabulary, qualityProblems, revisionVerificationPrompt, verificationPrompt,
  type QualityReason, type RevisionVerifyItem,
} from "./question-quality";
import {
  FEEDBACK_FORMAT, NO_CONTEXT, RUBRIC_RULE, UNSAFE_RULE, capCardLevel, difficultyFits, difficultyOf, feedbackText, generationContextBlock, levelMixLine, parseFeedbackSections,
  parseRubric, planCardLevels, referenceGrounding, stemKey,
  type FeedbackParts, type GenerationContext, type LevelMix, type LevelPlan, type Rubric,
} from "./question-intel";
import { checkRevisionDraft, objectiveKey, type RevisionDraft } from "./revision";
import { BLIND_SOLVE_SYSTEM, applyBlindVerification, blindItemOf, blindSolvePrompt, isBlindFormat } from "./blind-verify";
import { balanceTrueFalse } from "./formats";
import { EVALUATE_CRITERIA_RULE, type Criterion } from "./scoring-rules";
import { blueprintFromDraft, checkPrivateCase } from "./clinical";
import {
  OSCE_FEEDBACK_SYSTEM, OSCE_PROMPT_VERSIONS, checkOsceDraft, feedbackGroundingCheck, feedbackGroundingText, osceFeedbackPrompt, osceStationPrompt, osceStationSystem, parseOsceFeedback,
  type OsceGuidance, type OsceItem, type OscePassage,
} from "./osce";

// ── SOURCE-GROUNDED AI FOR SCHOLAR ── COMPETEN-IND-004 s2, s3 and s5 ───────────────────────────────────
//
// ⚠ NOT A NEW AI SERVICE. Every call goes through generate() (src/lib/ai/client.ts) with
// attribution { scope: "person" } (AI-LOG-001), so plat_ai_requests records usage and cost. The route
// that calls this checks the hourly quota and writes the audit row the quota counts.
//
// ⚠ GROUNDED IN THE PERSON'S OWN PASSAGES, AND CHECKED AFTERWARDS. The prompt says "only from these
// passages", and a prompt is a request, not a control. The control is verifyGrounded
// (src/lib/practice/document-phrasing.ts), the Practice document-phrasing check, applied with the
// passages as the grounding text: a number, a month or a clinical finding-word in the output that the
// passages do not contain fails it. A failed explanation is WITHHELD, not shown with a warning. A failed
// question is DROPPED, not stored. Nothing is retried, on this vendor or another (the hard rule in
// client.ts: a grounding failure is an answer, not an outage).
//
// ⚠ NOTHING HERE IS CLINICALLY REVIEWED, and every surface that shows it says so (AI_LABEL).

export type Passage = {
  chunkId: string;
  materialId: string;
  materialTitle: string;
  ordinal: number;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
  /** UPLOAD-01: what the material's unit is called -- a PowerPoint cites "slide 4", not "page 4". Absent: page. */
  unit?: "page" | "slide" | "section";
};

/** The label the model and the person both see for passage i: [S1], [S2] ... */
export const passageTag = (i: number) => `S${i + 1}`;

export function passageCitation(p: Pick<Passage, "materialTitle" | "ordinal" | "pageFrom" | "pageTo" | "unit">): string {
  return `${p.materialTitle}, ${citeChunk(p, p.unit)}`;
}

// ── THE GROUNDING CHECK ─────────────────────────────────────────────────────────────────────────────
//
// The Holdings verifier (src/lib/ai/grounding.ts, lifted from Practice under COMPETEN-HOLDINGS-SHARED-ENGINES-01)
// with the person's passages as grounding TEXT, and its one stated adjustment: the modal verb "may" is not the
// month May. Every other number, month and finding-word rule applies as written.
export const groundingViolations = textGroundingViolations;
export { parseJsonArray };

export function describeViolations(vs: PhrasingViolation[]): string {
  const parts = vs.slice(0, 4).map(v =>
    v.kind === "ungrounded_number" ? `the number ${v.token}`
      : v.kind === "ungrounded_month" ? `the month ${v.token}`
        : v.kind === "asserted_finding" ? `the term "${v.token}"`
          : v.kind === "empty" ? "an empty answer" : "a missing fact");
  return parts.join(", ");
}

// ── UNDERSTAND: EXPLAIN FROM THE PERSON'S PASSAGES ──────────────────────────────────────────────────

export const NOT_IN_NOTES = "NOT_IN_NOTES";

export const EXPLAIN_SYSTEM = [
  "You are the study companion in Competen Scholar. You explain a healthcare student's OWN study notes back to them.",
  "You are given numbered passages from their notes, tagged [S1], [S2] and so on, and a question.",
  "",
  "RULES, in order of importance:",
  "1. Use ONLY the passages. Do not add any fact, number, dose, value, date, finding or recommendation that is not in them, even if you know it to be true.",
  "2. After every sentence that uses a passage, cite it with its tag in square brackets, for example [S2]. Cite only tags you were given.",
  "3. Keep every number, unit and clinical term exactly as the passages write it. Do not introduce clinical descriptors (such as normal, raised, reduced, positive, stable) that the passages do not use.",
  "   Never write a number, in digits or in words, that the passages do not contain. That includes counting: write 'by creatinine and by urine output', not 'in two ways'.",
  "   Never count or number the things a passage lists: write 'the signs it describes', never 'three signs', and never number your own points ('first', 'second' are fine, 'three steps' is not).",
  `4. If the passages do not answer the question, reply with exactly ${NOT_IN_NOTES} and nothing else.`,
  "5. Explain clearly and simply, as a good tutor would: short paragraphs, or a simple list with lines starting '- '. No markdown headings, bold, tables or emoji.",
  "6. Do not give advice about a real patient. This is study, not clinical guidance.",
  "Keep it under 250 words.",
].join("\n");

export function explainUserPrompt(question: string, passages: Passage[]): string {
  const blocks = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`);
  return `PASSAGES FROM MY NOTES:\n\n${blocks.join("\n\n")}\n\nMY QUESTION: ${question}`;
}

export type ExplainCheck =
  | { ok: true; text: string; cited: number[]; salvaged?: TeachSalvage }
  | { ok: false; reason: "not_in_notes" | "no_citation" | "bad_citation" | "ungrounded"; violations?: PhrasingViolation[] };

/** Pure. What the model returned → shown, or withheld with the reason. */
export function checkExplanation(raw: string, question: string, passages: Passage[]): ExplainCheck {
  const text = raw.trim();
  if (!text || text.replace(/[^A-Z_]/g, "") === NOT_IN_NOTES || text.startsWith(NOT_IN_NOTES)) return { ok: false, reason: "not_in_notes" };
  const tags = [...text.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1]));
  if (!tags.length) return { ok: false, reason: "no_citation" };
  if (tags.some(t => t < 1 || t > passages.length)) return { ok: false, reason: "bad_citation" };
  // The tags themselves ([S1]) and the question the person typed are not claims, so neither is checked
  // against the passages: the question counts as grounding, the way verifyGrounded's `typed` text does.
  const prose = text.replace(/\[S\d+\]/g, " ");
  // The citation lines ("Cardiology notes, page 4") are grounding too: the model was shown them.
  const violations = groundingViolations(prose, [...passages.map(p => `${passageCitation(p)}\n${p.content}`), question]);
  if (violations.length) return { ok: false, reason: "ungrounded", violations };
  return { ok: true, text, cited: [...new Set(tags)].sort((a, b) => a - b) };
}

export const EXPLAIN_REFUSAL: Record<Exclude<ExplainCheck, { ok: true }>["reason"], string> = {
  not_in_notes: "Your notes do not seem to cover that. Try different words, or upload material that covers it.",
  no_citation: "The explanation did not say which part of your notes it came from, so it was not shown.",
  bad_citation: "The explanation cited a passage it was not given, so it was not shown.",
  ungrounded: "The explanation included details that are not in your notes, so it was not shown.",
};

// ── S3: WAYS OF LEARNING FROM THE SAME PASSAGES ── COMPETEN-SCHOLAR-01 ────────────────────────────────
//
// Every mode keeps EXPLAIN_SYSTEM's rules and its check: the notes-based answer must cite its passages and
// pass checkExplanation, or it is withheld. "explain" is the unchanged v2 prompt. The other modes append
// one instruction, and carry their own prompt version.
//
// ⚠ BEYOND THE NOTES IS SEPARATE. "Go deeper" and "Tutor me" may add general background after a marker
// line. That part is never mixed into the answer: it is split off, checked by its own rules below, and
// shown under SUPPLEMENTARY_LABEL. It may not carry a figure, a unit, dosing language, a citation tag or an
// identifier -- a background paragraph is not where a student should learn a dose. Failing that, it is
// withheld and the answer from the notes is still shown. Summary and Simplify are notes only.

export const EXPLAIN_MODES = ["explain", "summary", "simplify", "deeper", "tutor"] as const;
export type ExplainMode = (typeof EXPLAIN_MODES)[number];
export const isExplainMode = (v: unknown): v is ExplainMode => typeof v === "string" && (EXPLAIN_MODES as readonly string[]).includes(v);
export const SUPPLEMENTARY_MODES: readonly ExplainMode[] = ["deeper", "tutor"];
export const SUPPLEMENTARY_MARKER = "BEYOND THE NOTES:";

const MODE_INSTRUCTION: Record<Exclude<ExplainMode, "explain">, string> = {
  summary: "MODE: SUMMARY. Instead of an explanation, summarise the passages as a short list of their key points, each line starting '- ' and ending with its citation. Under 150 words. Notes only: add nothing beyond the passages.",
  simplify: "MODE: SIMPLIFY. Explain as simply as you can, for someone meeting the topic for the first time: short sentences and everyday words. When the passages use a technical term, keep the term exactly and say what it means using the passages. Under 200 words. Notes only: add nothing beyond the passages.",
  deeper: `MODE: GO DEEPER. In two parts. PART ONE, from the passages only: explain in depth how the ideas in the passages connect, the reasoning behind them, and what a student should understand rather than memorise, citing as before. Every rule above applies to part one in full: if a point is not in the passages, it does not belong in part one. Do not use clinical descriptors (such as normal, significant, raised, reduced, stable) the passages do not use. Never count or number things in part one: write "the signs it lists", never "three signs" or "two ways". PART TWO, optional: general background that is NOT in the passages, after a line that reads exactly ${SUPPLEMENTARY_MARKER} -- under 120 words, general principles only, with no numbers, units, doses, drug names, values or thresholds, no citation tags, and no advice about any patient. Anything you know that the passages do not say goes in part two or nowhere.`,
  tutor: `MODE: TUTOR. Teach one small step at a time. If the student has replied, first say briefly whether their reply matches the passages, and correct it from the passages if it does not. Then explain the next idea, citing as before, and end with ONE short question for the student on its own line starting 'Your turn:'. Never count or number things: write "the signs it lists", never "three signs" -- and never ask the student how many there are. Under 180 words. Optional background beyond the passages goes after a line that reads exactly ${SUPPLEMENTARY_MARKER} -- under 80 words, with no numbers, units, doses, drug names or thresholds and no citation tags.`,
};

export function explainSystem(mode: ExplainMode): string {
  return mode === "explain" ? EXPLAIN_SYSTEM : `${EXPLAIN_SYSTEM}\n\n${MODE_INSTRUCTION[mode]}`;
}
export const explainPromptVersion = (mode: ExplainMode) =>
  mode === "explain" ? PROMPT_VERSIONS.explain : `${PROMPT_VERSIONS.explainModes}:${mode}`;

export type TutorTurn = { speaker: "tutor" | "student"; text: string };

/**
 * The user prompt. `learnerContext` (P1, learner-context.ts) is the tutor's view of the student, framed so the
 * model uses it for emphasis only. It is NOT grounding: runExplain never passes it to checkExplanation.
 */
export function modeUserPrompt(question: string, passages: Passage[], history: TutorTurn[], learnerContext: string | null = null): string {
  const about = learnerContext ? `${CONTEXT_PREAMBLE}\n${learnerContext}\n\n` : "";
  if (!history.length) return about + explainUserPrompt(question, passages);
  const blocks = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`);
  const convo = history.map(t => `${t.speaker === "tutor" ? "TUTOR" : "STUDENT"}: ${t.text}`).join("\n\n");
  return `${about}PASSAGES FROM MY NOTES:\n\n${blocks.join("\n\n")}\n\nOUR CONVERSATION SO FAR:\n\n${convo}\n\nMY REPLY: ${question}`;
}

/** Pure. The notes-based answer, and the part after the marker line (null when there is none). */
export function splitSupplementary(raw: string): { main: string; extra: string | null } {
  const m = /^[\s*_#>-]*BEYOND THE NOTES:?[\s*_]*/im.exec(raw);
  if (!m) return { main: raw, extra: null };
  const extra = raw.slice(m.index + m[0].length).trim();
  return { main: raw.slice(0, m.index).trim(), extra: extra || null };
}

export type SupplementaryReason = "not_this_mode" | "figures" | "dosing" | "citation" | "identifier" | "too_long";
export type SupplementaryCheck = { ok: true; text: string } | { ok: false; reason: SupplementaryReason };

const FIGURE = /\d|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|quarter|twice|triple)\b/i;
const UNIT_OR_DOSE = /%|\b(mg|mcg|micrograms?|milligrams?|kg|ml|millilitres?|milliliters?|mmol|mmhg|percent|per cent|dose[sd]?|dosage|dosing|prescrib\w*|titrat\w*|bolus)\b/i;

/** Pure. Background beyond the notes, or why it is withheld. */
export function checkSupplementary(text: string, mode: ExplainMode): SupplementaryCheck {
  if (!SUPPLEMENTARY_MODES.includes(mode)) return { ok: false, reason: "not_this_mode" };
  return checkBackgroundText(text);
}

/** Pure. The background rules themselves, whatever asked for it: general principles only, no figures or doses. */
export function checkBackgroundText(text: string, maxChars: number = 900): SupplementaryCheck {
  const t = text.trim();
  if (t.length > maxChars) return { ok: false, reason: "too_long" };
  if (/\[S\d+\]/.test(t)) return { ok: false, reason: "citation" };
  if (findPatientIdentifiers(t).length) return { ok: false, reason: "identifier" };
  if (UNIT_OR_DOSE.test(t)) return { ok: false, reason: "dosing" };
  if (FIGURE.test(t)) return { ok: false, reason: "figures" };
  return { ok: true, text: t };
}

export const SUPPLEMENTARY_WITHHELD: Record<Exclude<SupplementaryReason, "not_this_mode">, string> = {
  figures: "The AI's extra background mentioned figures, so it was not shown. Your notes and course materials are the place for numbers.",
  dosing: "The AI's extra background mentioned doses or units, so it was not shown.",
  citation: "The AI's extra background claimed to come from your notes, so it was not shown.",
  identifier: "The AI's extra background contained something that looked like a personal identifier, so it was not shown.",
  too_long: "The AI's extra background was too long, so it was not shown.",
};

// ── ASSESS AND APPLY: QUESTIONS FROM ONE PASSAGE ────────────────────────────────────────────────────

export type QuestionKind = "mcq" | "case";

export type DraftQuestion = {
  stem: string;
  options: [string, string, string, string];
  correctIndex: number;
  rationale: string;
  sourceQuote: string;
  /** SCHOLAR-QUESTION-INTELLIGENCE-01: its rubric and difficulty, stored in 416's `answer` and `difficulty`. */
  rubric?: Rubric;
  difficulty?: 1 | 2 | 3;
};

const QUESTION_RULES = [
  "RULES, in order of importance:",
  "1. Every question must be answerable from the passage ALONE. Do not test anything the passage does not state.",
  "2. Do not add any number, dose, value, date, finding or term that is not in the passage. Wrong options may rearrange or misapply what the passage says, but must not invent new clinical facts.",
  "   Wrong options must be built ONLY from words, terms and numbers that appear in the passage. Never invent a threshold, multiple, range or reference value for a wrong option.",
  "   Never write a number, in digits or in words, that the passage does not contain. That includes counting: ask 'Which parameters...', not 'Which two parameters...'.",
  "   Do not use clinical descriptors (such as normal, raised, reduced, positive, stable) unless the passage uses them.",
  "3. sourceQuote is ONE sentence copied EXACTLY, character for character, from the passage, that shows the correct answer.",
  "4. Exactly four options, one correct. correctIndex is 0, 1, 2 or 3.",
  "   The stem is a question ending with '?'. Avoid negative stems; if you must use one, write NOT or EXCEPT in capitals.",
  "   Never use 'all of the above', 'none of the above' or 'both'. No option may contain another option's wording.",
  "   Exactly ONE option may be supported by the passage. Every wrong option must be clearly contradicted or unsupported by it.",
  "   Each wrong option must tempt someone who has not understood: a related term from the passage misapplied, a true statement about something else in the passage, or the right idea in the wrong situation. Never a silly or obviously wrong option.",
  "   All four options are alike in length and form, so the correct one does not stand out.",
  "   Where the passage allows, ask the student to interpret, apply or prioritise rather than repeat a sentence. Items in one reply each test a DIFFERENT fact.",
  "5. rationale explains in one or two sentences why the correct option is right, in the passage's own terms.",
  "6. Never include a name, NHS number, date of birth or any detail that could identify a real person.",
  "",
  'Reply with JSON ONLY, no prose and no code fence: [{"stem": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "rationale": "...", "sourceQuote": "...", "level": "understanding", "depth": "interpret", "objective": "...", "keyPoints": ["..."], "misconceptions": ["..."], "references": []}]',
  DEPTH_RULE,
  SUBJECT_RULE,
];

// SCHOLAR-QUESTION-INTELLIGENCE-01 (mcq v4, case v4): the rubric fields, a spread of cognitive levels, and the
// guidance block (concepts, competency, level, difficulty, count) after the passage -- generationContextBlock.
export const QUESTION_SYSTEM: Record<QuestionKind, string> = {
  mcq: [
    "You write multiple-choice revision questions for a healthcare student, from ONE passage of their own study notes.",
    `Write up to ${QUESTIONS_PER_REQUEST} questions that test understanding of the passage, not trivia: where the passage allows, include questions that ask the student to explain, apply or reason with it, not only to recall it.`,
    "",
    ...QUESTION_RULES.slice(0, -1),
    RUBRIC_RULE,
    "",
    ...QUESTION_RULES.slice(-1),
  ].join("\n"),
  case: [
    "You write short case-style application questions for a healthcare student, from ONE passage of their own study notes.",
    `Write up to ${QUESTIONS_PER_REQUEST} questions. Each stem is a brief educational scenario about 'a patient' (no name, no age, no numbers unless the passage gives them) followed by a question asking the student to APPLY the passage to the scenario.`,
    "The scenario may only describe things the passage itself mentions. If the passage cannot support a scenario, return [].",
    "",
    ...QUESTION_RULES.slice(0, -1),
    RUBRIC_RULE,
    "",
    ...QUESTION_RULES.slice(-1),
  ].join("\n"),
};

/**
 * What a generator is checked against besides its passage (question-intel.ts). Optional throughout. `levelMix`
 * (flashcards only, SCHOLAR-FLASHCARDS-QA-01): the cognitive-level mix to write to, narrowed to what the passage supports.
 */
export type GenerationOptions = {
  context?: GenerationContext; existing?: ReadonlySet<string>; levelMix?: LevelMix;
  /**
   * SCHOLAR-SQIE-LEARNER-01 (policy scholar_verify_formats): the formats a blind check is run on before an item is stored. Absent: the
   * behaviour from before the policy (mcq, case, mrq, short). A format not in it is stored on its deterministic checks alone.
   */
  verifyFormats?: readonly string[];
  /** SCHOLAR-SQIE-LEARNER-01: objectiveKey of the objectives this section already tests in this format; a draft that repeats one is not stored. */
  existingObjectives?: ReadonlySet<string>;
};
/** SCHOLAR-SQIE-LEARNER-01: the formats that were always blind-checked: what an absent policy means. */
export const VERIFY_DEFAULT: readonly string[] = VERIFY_FORMATS_DEFAULT;

export function questionUserPrompt(passage: Passage): string {
  return `PASSAGE (${passageCitation(passage)}):\n${passage.content}\n\n`
    + "OPTION VOCABULARY. Every option, right or wrong, may use only these content words (plus small words like 'the', 'by', 'of'), "
    + `in any order or form: ${passageVocabulary(passage.content).join(", ")}`;
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();


export type DropReason = "malformed" | "quote_not_in_passage" | "ungrounded" | QualityReason | "failed_verification" | "verification_unavailable" | "repeat" | "off_difficulty" | "about_the_notes"
  // SQIE-CLOSE-2026-11 WS-H: a generated question or case item that names a person (the revision formats already refuse it).
  | "identifier";

/**
 * Pure. SCHOLAR-AI-OPT-01 P2: the words the vocabulary rule refused (unsupported_term), for the audit row. The acceptance
 * run's commonest drop reason, recorded until now as a bare code, so no prompt change could be based on it. Single words
 * the MODEL used that the passage does not -- never the passage, the stem or an answer. At most 12.
 */
export function refusedTerms(dropped: QuestionCheck["dropped"]): string[] {
  const out = new Set<string>();
  for (const d of dropped) if ((d.reason === "unsupported_term" || d.reason === "correct_not_supported") && d.detail)
    for (const t of d.detail.split(/,s*/)) { const w = t.trim().toLowerCase().slice(0, 30); if (/^[a-z][a-z'-]*$/.test(w)) out.add(w); }
  return [...out].slice(0, 12);
}

export type QuestionCheck = {
  kept: DraftQuestion[];
  dropped: { reason: DropReason; violations?: PhrasingViolation[]; detail?: string }[];
};

/**
 * Pure. Model reply → the questions that may be stored, and why each other one was not. `limit` is the
 * Individual policy value (COMPETEN-CONFIG-002), never above QUESTIONS_PER_REQUEST: it narrows how many are
 * KEPT and leaves the versioned prompt (PROMPT_VERSIONS) untouched.
 */
export function checkQuestions(raw: string, passage: Passage, limit: number = QUESTIONS_PER_REQUEST, cap: number = QUESTIONS_PER_REQUEST, opts: GenerationOptions = {}): QuestionCheck {
  const out: QuestionCheck = { kept: [], dropped: [] };
  const arr = parseJsonArray(raw);
  if (!arr) { out.dropped.push({ reason: "malformed" }); return out; }
  const source = squash(passage.content);
  // Notes only: an mcq or case question cannot record a reference (416 keeps their `answer` null), so source mode
  // notes_and_references is never applied here -- the passage alone grounds it, exactly as before.
  const seen = new Set(opts.existing ?? []);
  const objectives = new Set(opts.existingObjectives ?? []);
  for (const item of arr.slice(0, Math.min(cap, Math.max(1, Math.floor(limit))))) {
    const q = item as Record<string, unknown>;
    const options = Array.isArray(q?.options) ? (q.options as unknown[]).map(o => (typeof o === "string" ? o.trim() : "")) : [];
    const ci = typeof q?.correctIndex === "number" ? q.correctIndex : -1;
    const stem = typeof q?.stem === "string" ? q.stem.trim() : "";
    const rationale = typeof q?.rationale === "string" ? q.rationale.trim() : "";
    const quote = typeof q?.sourceQuote === "string" ? q.sourceQuote.trim() : "";
    if (!stem || options.length !== 4 || options.some(o => !o) || new Set(options.map(squash)).size !== 4
      || !Number.isInteger(ci) || ci < 0 || ci > 3 || !rationale || !quote || stem.length > 1200) {
      out.dropped.push({ reason: "malformed" });
      continue;
    }
    // SQIE-CLOSE-2026-11 WS-H: every word the model wrote is screened for a patient identifier, as every revision format is
    // (revision.ts checkRevisionDraft). The passage was screened at upload; the model's own stem, options and rationale were not.
    if (findPatientIdentifiers([stem, ...options, rationale].join("\n")).length) { out.dropped.push({ reason: "identifier" }); continue; }
    if (aboutTheDocument(stem)) { out.dropped.push({ reason: "about_the_notes" }); continue; }
    const quoteKey = squash(quote).replace(/[.\s]+$/, "");
    if (quoteKey.length < 12 || !source.includes(quoteKey)) { out.dropped.push({ reason: "quote_not_in_passage" }); continue; }
    const violations = groundingViolations([stem, ...options, rationale].join("\n"), [passage.content]);
    if (violations.length) { out.dropped.push({ reason: "ungrounded", violations }); continue; }
    const draft: DraftQuestion = { stem, options: options as DraftQuestion["options"], correctIndex: ci, rationale, sourceQuote: quote };
    const problems = qualityProblems(draft, passage.content);
    if (problems.length) { out.dropped.push({ reason: problems[0].reason, detail: problems.map(p => p.detail ? `${p.reason} (${p.detail})` : p.reason).join("; ") }); continue; }
    // SCHOLAR-QUESTION-INTELLIGENCE-01: not a repeat of a stored (or an earlier) stem, the difficulty asked for, a rubric.
    const key = stemKey(stem);
    if (seen.has(key)) { out.dropped.push({ reason: "repeat" }); continue; }
    const difficulty = difficultyOf(q);
    if (!difficultyFits(difficulty, opts.context?.difficulty ?? null)) { out.dropped.push({ reason: "off_difficulty", detail: String(difficulty) }); continue; }
    const rubric = parseRubric(q, [passage.content], { expectedAnswer: options[ci], difficulty });
    // SCHOLAR-SQIE-LEARNER-01: not the same learning objective as one this section already tests in this format.
    if (rubric.objective && objectives.has(objectiveKey(rubric.objective))) { out.dropped.push({ reason: "repeat" }); continue; }
    seen.add(key);
    if (rubric.objective) objectives.add(objectiveKey(rubric.objective));
    out.kept.push({ ...draft, difficulty, rubric });
  }
  return out;
}

// ── THE CALLS ── generate(), person attribution, nothing else ──────────────────────────────────────

export type AiFailure = { ok: false; error: "not_configured" | "refusal" | "failed" };

/**
 * AI-FAIR-USE-01: how a generator makes its AI calls. The route passes Scholar's metered runner (scholar/http.ts
 * scholarAiRunner: runMeteredAi with the activity code and a request id per `part`); with none, generate() exactly as
 * before. `part` names the call within one student action ("main", "verify", "retry", "retry-verify").
 */
export type AiRun = (g: GenerateArgs, part?: string) => Promise<GenerateResult>;
const direct: AiRun = g => generate(g);

/**
 * S3: one answer in the chosen mode. The notes-based part is checked by checkExplanation, with the
 * question and the earlier tutor turns as grounding (the person typed or was already shown them). The part
 * beyond the notes, if any, is split off first and checked by its own rules -- it never reaches
 * checkExplanation, and never grounds anything.
 */
export async function runExplain(userId: string, question: string, passages: Passage[], mode: ExplainMode = "explain", history: TutorTurn[] = [], learnerContext: string | null = null, run: AiRun = direct) {
  const r = await run({
    system: explainSystem(mode),
    user: modeUserPrompt(question, passages, history, mode === "tutor" ? learnerContext : null),
    tier: "reasoning",
    maxTokens: mode === "explain" ? 700 : 900,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_explain" },
  });
  if (!r.ok) return { ok: false, error: r.error } as AiFailure;
  const split = splitSupplementary(r.text);
  const asked = [question, ...history.map(t => t.text)].join("\n");
  return {
    ok: true as const,
    check: checkExplanation(split.main, asked, passages),
    supplementary: split.extra === null ? null : checkSupplementary(split.extra, mode),
    model: r.model, provider: r.provider, promptVersion: explainPromptVersion(mode),
  };
}

// ── STAGE 3: LEARN ── COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24) ───────────────────────────────────
//
// The learning actions run on THIS engine: EXPLAIN_SYSTEM's rules, generate() with person attribution, the
// Holdings grounding check. Not a second engine. What Stage 3 adds:
//   - more actions (teach, examples, ask) and the informal check (check, then clarify with a verdict);
//   - a depth (brief, standard, detailed);
//   - GOVERNED REFERENCES: the competencies and learning outcomes of the student's programme catalogue that the
//     sections are linked to, tagged [R1] ... and labelled with their review state. They may be cited only to say
//     what the student is working towards. They ground nothing clinical beyond their own words.
//   - FOUR KINDS OF CONTENT, kept apart (owner GO s7): from the notes ([S n], checked), governed reference
//     ([R n]), AI background beyond the notes (after BEYOND THE NOTES:, checked by the background rules, only
//     where policy allows), and AI flags (after CHECK THIS:) -- statements in the notes the model thinks
//     contradict another passage or look unclear or unsafe. Each flag must cite the passage it concerns, and is
//     shown as the AI's flag for the student to check, never as a correction. Nothing invents a citation: a tag
//     outside the ones given withholds the answer.

/** `approved`: 395 approved this exact content (learn.ts referenceStatus). Absent, as on older saved answers, is not approved. */
/** `library` (COMPETEN-RESEARCH-01): matched from the Competen library by topic, not linked to the sections. */
export type GovernedReference = { title: string; code: string | null; outcome: string | null; status: string; competencyId?: string; approved?: boolean; library?: boolean };
export const FLAG_MARKER = "CHECK THIS:";
const DEPTH_WORDS: Record<ExplanationDepth, number> = { brief: 120, standard: 220, detailed: 350 };
/**
 * SCHOLAR-CUMULATIVE-TEACHING-01: a LESSON (Teach me, and Go deeper which extends it) is comprehensive from the first request
 * (spec s1: concepts, mechanisms, relationships, why and how, application, examples, limits), so it is given room: the owner's
 * acceptance lesson was 273 words of bullets under the 220-word cap. Explain / Simplify / Summarise keep DEPTH_WORDS.
 */
export const LESSON_WORDS: Record<ExplanationDepth, number> = { brief: 240, standard: 520, detailed: 760 };
const LESSON_MAX_TOKENS: Record<ExplanationDepth, number> = { brief: 1000, standard: 1900, detailed: 2600 };
/** The actions written as a structured lesson (teach-format.ts parts) and checked part by part. */
const LESSON_ACTIONS: readonly (LearnAction | "check" | "clarify")[] = ["teach", "deeper"];
/** Where the notes state something without explaining it, the background part may say so and give the general principle, within these words. */
const BACKGROUND_WORDS: Record<ExplanationDepth, number> = { brief: 100, standard: 170, detailed: 220 };
const BACKGROUND_ACTIONS: readonly LearnAction[] = ["teach", "deeper", "examples"];
/** COMPETEN-RESEARCH-01: the actions that may carry a research part. A check question and a clarification never do. */
export const RESEARCH_ACTIONS: readonly (LearnAction | "check" | "clarify")[] = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask"];

// SCHOLAR-CUMULATIVE-TEACHING-01 (PROMPT_VERSIONS.learnTeach v3): the lesson's parts, shared by Teach me and Go deeper. The
// UNDERSTANDING part is the teaching itself -- connected paragraphs, not a list (spec s6) -- and the key points are for revision.
const LESSON_PARTS = [
  `${TEACH_LABEL.overview} two or three sentences: what this lesson is about and why it matters to the patient and to the person caring for them, from the passages, cited.`,
  `${TEACH_LABEL.understanding} the teaching itself, in connected paragraphs separated by a blank line (not a list). Establish each concept clearly, explain how and why it works where the passages give the mechanism or the reason, develop the relationships between the ideas (what depends on what, what follows from what), and show what they mean in practice. Where the passages support it, reason from the patient's condition to the underlying mechanism, to what is assessed, what is decided and done, and how the result is checked. Build from simple to more detailed. Cite every sentence that uses a passage. Do not merely restate the key points.`,
  `${TEACH_LABEL.points} then the essential points for revision, one line each starting '- ', each a different idea, each ending with its citation such as [S1].`,
  `${TEACH_LABEL.example} ONLY if the passages themselves describe a situation, case or application: one or two sentences about 'a patient' or 'the person caring for them' that show an idea at work, using only what the passages say, cited. If the passages describe no such situation, leave the ${TEACH_LABEL.example} line out entirely. Never invent an example.`,
  `${TEACH_LABEL.check} then one or two short open questions, each starting '- ', that ask the student to explain, apply or reason (why, what would follow, how would you decide), never to recall a statement already given, each answerable from the passages in a few sentences, each ending with '?' and then the tag of the passage that answers it, for example 'Why is this done? [S2]'. Never ask for a number or how many of anything.`,
];
const NO_COUNT_LESSON = "Never say how many of something there are ('two types', 'three stages', 'both') unless the passages themselves give that number: name the things instead. Every statement must be one the passages support. Where the passages state something without explaining it, teach what they state and say that the reason is not in these notes; the general principle may follow the notes part only where the rules below allow.";

const LEARN_INSTRUCTION: Record<ClassicLearnAction | "check" | "clarify", string> = {
  // SCHOLAR-LEARN-FIX-01 L-B (PROMPT_VERSIONS.learnTeach): a structured lesson, parsed and checked part by part
  // (checkTeachAnswer). The labels are teach-format.ts TEACH_LABEL. v3: comprehensive from the first request.
  teach: [
    "MODE: TEACH ME, one complete lesson of a guided course, taught at the student's level. The first explanation must itself be the lesson: the student should not need to ask again to understand the ideas, how they work and what they mean in practice. Reply in exactly these labelled parts, each label at the start of its own line:",
    ...LESSON_PARTS,
    NO_COUNT_LESSON,
    "Write nothing else in the part from the notes.",
  ].join("\n"),
  explain: "MODE: EXPLAIN THIS. Explain the passages clearly, as a good tutor would, citing as you go.",
  simplify: "MODE: SIMPLIFY. Explain as simply as you can, for someone meeting the topic for the first time: short sentences and everyday words. Keep every technical term exactly and say what it means using the passages. Keep the passages' own names for things -- write 'the right and left main bronchi', never 'two tubes': simpler words, never a count instead of the names. Notes only.",
  // SCHOLAR-CUMULATIVE-TEACHING-01 (PROMPT_VERSIONS.learnDeeper): Go deeper is additive. With TAUGHT SO FAR it extends that
  // teaching (learnInstruction below); without one (no lesson yet) it is the structured lesson, taught in depth.
  deeper: [
    "MODE: GO DEEPER. Teach what a student should understand rather than memorise: how the ideas in the passages connect, the reasoning and mechanisms behind them, their limits. If a point is not in the passages, it does not belong in the part from the notes. Reply in exactly these labelled parts, each label at the start of its own line:",
    ...LESSON_PARTS,
    NO_COUNT_LESSON,
  ].join("\n"),
  examples: "MODE: GIVE EXAMPLES. Give up to three short practical situations that show the ideas of the passages at work, each one or two sentences about 'a patient' or 'the person caring for them', using ONLY what the passages say: their signs, actions and reasons. Cite the passage each example rests on. No names, ages, numbers, drugs or findings the passages do not contain.",
  summary: "MODE: SUMMARISE. List the important learning points of the passages, each line starting '- ' and ending with its citation. Notes only.",
  ask: "MODE: ASK SCHOLAR. Answer the student's question from the passages, citing as you go. If they do not answer it, reply with exactly NOT_IN_NOTES.",
  check: "MODE: CHECK UNDERSTANDING. Write ONE short open question that checks whether the student understood the main idea of the passages -- a question they could answer in a sentence or two from the passages, asking them to explain, not to recall a number. Never ask how many of anything. Reply with exactly one line: 'QUESTION: ' followed by the question. Nothing else.",
  // SCHOLAR-UNDERSTANDING-CHECKS-01 (PROMPT_VERSIONS.learnClarify): formative feedback in labelled parts (learn-check.ts), each cited,
  // so the page can show what was right, what was missing, the misconceptions and a model answer from the notes, part by part.
  clarify: [
    "MODE: CLARIFY. You asked the student a check question and they answered in their own words. Judge their answer ONLY against the passages, kindly and specifically: address what THEY wrote, not a general answer. Your first line is exactly one of 'VERDICT: understood', 'VERDICT: partly' or 'VERDICT: not_yet'. Then write exactly these parts, each starting on its own line with its label:",
    `${CHECK_LABEL.right} one '- ' line per thing their answer got right, each cited. If nothing was right, one gentle line saying so.`,
    `${CHECK_LABEL.missing} one '- ' line per important point of the passages their answer left out, each cited. If none, write 'Nothing important missing.'`,
    `${CHECK_LABEL.misconceptions} one '- ' line per mistaken idea or step of reasoning in their answer, saying why it is a natural mistake and correcting it from the passages, each cited. If none, write 'Nothing to correct.'`,
    `${CHECK_LABEL.keyPoints} the key learning points a complete answer to the check question would give -- a model answer in two to four '- ' lines, each from the passages and cited.`,
    `${CHECK_LABEL.next} one short suggestion of what to revise or try next, from the passages, cited -- and, when the answer was understood, one further question or complexity the passages support, to take their reasoning a step further.`,
    "Do not judge anything the passages do not cover. Use understood only when the main idea is right with nothing important wrong or missing.",
    // SCHOLAR-CUMULATIVE-TEACHING-01 (PROMPT_VERSIONS.learnClarify v3): a reasoning question is judged as reasoning.
    "When the check question asked the student to reason (why, what follows, compare, prioritise, justify, decide), judge the REASONING, not only the facts: whether each step follows from the passages, whether the conclusion is justified, and which consideration the passages give that the reasoning left out. Say so in the parts above.",
  ].join("\n"),
};

// ── COMPETEN-RESEARCH-01: RESEARCH & EXPLAIN ── a FIFTH kind of content, kept apart ───────────────────────────────
//
// When the learner chooses Research & Explain, the abstracts the Holdings research service returned AND verified
// (src/lib/holdings/research: an abstract and a PMID from PubMed or a DOI Crossref confirmed) are given as [E1] ...
// The model writes them up after FROM RESEARCH:, apart from the notes. That part is checked on its own:
//   every sentence cites a given [E n]; no [S n] or [R n] (the notes stay the notes); nothing the abstracts, the
//   passages and what the student typed do not contain (the same grounding check); no dosing language; no identifier.
// Failing that, it is withheld and the notes part stands or falls by its own check, unchanged. The notes part may
// never cite [E n]. The references shown come from the provider records, never from what the model wrote.

export const RESEARCH_MARKER = "FROM RESEARCH:";
/** What the model is shown of one verified external item. Evidence only: an item without an abstract never gets here. */
export type ResearchEvidence = { title: string; journal: string | null; year: number | null; abstract: string };
export type ResearchReason = "no_citation" | "bad_citation" | "mixed" | "uncited_sentence" | "identifier" | "dosing" | "ungrounded" | "too_long" | "risk_raised";
/** `dropped`: framing lines (a heading, an uncited lead-in) left out of what is shown. */
export type ResearchCheck = { ok: true; text: string; cited: number[]; dropped?: number } | { ok: false; reason: ResearchReason; violations?: PhrasingViolation[] };
// Doses, units and dose adjustment. Whether a medicine is prescribed is a fact, not a dose: medication ADVICE is judged
// by the published risk rules on what the research part wrote (withinRequestRisk, risk_raised), not by a word list.
const RESEARCH_DOSING = /\b(mg|mcg|micrograms?|milligrams?|ml|millilitres?|milliliters?|mmol|iu|units?\/kg|dose[sd]?|dosage|dosing|titrat\w*|bolus|regimen)\b/i;

export const RESEARCH_WITHHELD: Record<ResearchReason, string> = {
  no_citation: "The research summary did not say which source each point came from, so it was not shown.",
  bad_citation: "The research summary cited a source it was not given, so it was not shown.",
  mixed: "The research summary mixed in your notes, so it was not shown. External research is always kept apart from your notes.",
  uncited_sentence: "Part of the research summary did not cite a source, so it was not shown.",
  identifier: "The research summary contained something that looked like a personal identifier, so it was not shown.",
  dosing: "The research summary mentioned doses or prescribing, so it was not shown. Your course materials and supervisors are the place for that.",
  ungrounded: "The research summary included details the sources' abstracts do not contain, so it was not shown.",
  too_long: "The research summary was too long, so it was not shown.",
  risk_raised: "The research summary went into clinical detail beyond what Scholar may explain for this topic, so it was not shown.",
};

/** Pure. The research part: cited sentence by sentence, only from the given abstracts (and the notes/what was asked). */
export function checkResearchPart(raw: string, evidence: readonly ResearchEvidence[], passages: readonly Passage[], asked: string): ResearchCheck {
  const t = raw.trim();
  if (t.length > 2500) return { ok: false, reason: "too_long" };
  if (/\[[SR]\d+\]/.test(t)) return { ok: false, reason: "mixed" };
  const tags = [...t.matchAll(/\[E(\d+)\]/g)].map(m => Number(m[1]));
  if (!tags.length) return { ok: false, reason: "no_citation" };
  if (tags.some(n => n < 1 || n > evidence.length)) return { ok: false, reason: "bad_citation" };
  // A tag written after the full stop belongs to the sentence before it.
  const units = researchUnits(t);
  const uncited = units.filter(u => u.words >= 4 && !u.cited);
  // RESEARCH-02 (owner GO 28 Oct): an uncited HEADING line, or an uncited LEAD-IN (the first sentence, carrying no caveat),
  // is framing, not a claim. It is DROPPED from what is shown -- never accepted as evidence -- and every other uncited
  // sentence (a middle one, a closing synthesis such as "Together these suggest ...") still withholds the whole part.
  // A lead-in that carries a caveat is not dropped (losing it would overstate the evidence): it withholds too.
  const leadIn = units.find(u => !u.heading)?.index;
  const dropped = uncited.filter(u => u.heading || (u.index === leadIn && !RESEARCH_CAVEAT.test(u.text)));
  if (uncited.some(u => !dropped.includes(u))) return { ok: false, reason: "uncited_sentence" };
  // Every safety check runs on the FULL text, dropped framing included: dropping never lets anything else through.
  if (findPatientIdentifiers(t).length) return { ok: false, reason: "identifier" };
  if (RESEARCH_DOSING.test(t)) return { ok: false, reason: "dosing" };
  let shown = t;
  if (dropped.length) {
    shown = t.replace(/([.!?])((?:\s*\[E\d+\])+)/g, "$2$1");
    for (const u of dropped) shown = shown.replace(u.text, "");
    shown = shown.split("\n").map(l => l.replace(/^[\s*#>-]+$/, "").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (!/\[E\d+\]/.test(shown)) return { ok: false, reason: "no_citation" };
  // Grounding protects what is SHOWN, so it reads the shown text (a dropped lead-in's "Two studies ..." is never shown).
  // "A study examined whether ..." describes method, not a clinical examination: only that construction is read as
  // method. "The patient was examined" and every other clinical finding word are checked exactly as before.
  const prose = shown.replace(/\[E\d+\]/g, " ").replace(RESEARCH_METHOD_EXAMINED, "$1 looked at");
  const grounding = [...evidence.map(e => `${e.title}\n${e.journal ?? ""} ${e.year ?? ""}\n${e.abstract}`), ...passages.map(p => `${passageCitation(p)}\n${p.content}`), asked];
  const violations = groundingViolations(prose, grounding);
  if (violations.length) return { ok: false, reason: "ungrounded", violations };
  return { ok: true, text: shown, cited: [...new Set([...shown.matchAll(/\[E(\d+)\]/g)].map(m => Number(m[1])))].sort((a, b) => a - b), ...(dropped.length ? { dropped: dropped.length } : {}) };
}

/** A caveat a lead-in must keep: if the first sentence carries one, it is a claim about the evidence, never mere framing. */
const RESEARCH_CAVEAT = /\b(limited|mixed|weak|preliminary|early (?:evidence|data|stage|studies|findings|results|research)|uncertain|unclear|conflicting|inconsistent|insufficient|small|few|caution|cautious|not|no|cannot|lack|lacks|lacking|only|however)\b/i;
/** The study-method use of "examined" (the subject is the study or its authors), and only that. */
const RESEARCH_METHOD_EXAMINED = /\b(stud(?:y|ies)|trial|trials|review|reviews|analysis|analyses|audit|survey|paper|authors|researchers|investigators|it|they)\s+examined\b/gi;

/** Pure. The research part as units: one per sentence of each line, in order, with whether it cites and whether its line is a heading. */
function researchUnits(t: string): { text: string; words: number; cited: boolean; heading: boolean; index: number }[] {
  const out: { text: string; words: number; cited: boolean; heading: boolean; index: number }[] = [];
  for (const rawLine of t.replace(/([.!?])((?:\s*\[E\d+\])+)/g, "$2$1").split(/\n+/)) {
    const line = rawLine.replace(/^[\s*#>-]+/, "").replace(/[*_]+$/g, "").trim();
    if (!line) continue;
    // A heading: a short line with no sentence ending (or ending in a colon), and no citation.
    const heading = !/\[E\d+\]/.test(line) && line.split(/\s+/).length <= 12 && (!/[.!?]$/.test(line) || /:$/.test(line));
    for (const s of heading ? [line] : line.split(/(?<=[.!?])\s+/)) {
      const text = s.trim();
      if (text) out.push({ text, words: text.split(/\s+/).length, cited: /\[E\d+\]/.test(text), heading, index: out.length });
    }
  }
  return out;
}

const NO_COUNT_LAST = "LAST, before you reply: if any sentence says how many of something there are (two, three, both, a couple, a few), rewrite it without the count, unless the passages themselves give that number.";
/**
 * SCHOLAR-CUMULATIVE-TEACHING-01: the verifier's finding words (grounding.ts ASSERTION_MARKERS), named to the model. In teaching
 * prose "normal", "significant" and "again" are ordinary words, and the acceptance run lost an overview, a paragraph and two
 * Guide me turns to them. The rule (EXPLAIN_SYSTEM 3) is unchanged; this says which words it means, where it is read last.
 */
export const AVOID_WORDS_LAST = `ALSO LAST: these words are read as clinical findings and are checked against the passages, so do not write any of them unless the passages contain that word: ${[...ASSERTION_MARKERS].join(", ")}. Say "usual", "as expected", "once more", "greater", "smaller", "important" instead.`;
const REFERENCES_RULE = "GOVERNED REFERENCES, tagged [R1], [R2] ...: competencies and learning outcomes from the student's programme catalogue that these passages are linked to. You may cite one as [R n] only to say what the student is working towards. Never use them as a source of clinical facts.";
const FLAG_RULE = `Optional, last: if a passage says something that contradicts another passage, or that looks unclear, outdated or possibly unsafe to act on, add a line that reads exactly ${FLAG_MARKER} and then one line per concern starting '- ', citing the passage concerned. Do not correct it with outside facts: say only what to check, against their course materials or with a supervisor. Leave this out when there is nothing to flag.`;
/** SCHOLAR-COMPANION-01 P1: what a teaching action needs beyond the request text (learn-teaching.ts). */
export type TeachingContext = { level?: CognitiveLevel; hintLevel?: HintLevel; examEvidence?: ExamEvidence | null };

/** The system prompt for one learning action: EXPLAIN_SYSTEM's rules, the action, the depth, and what may follow. */
// SCHOLAR-CUMULATIVE-TEACHING-01: what a TAUGHT SO FAR block changes. Go deeper EXTENDS (the six questions of spec s3, and
// DEPTH_REACHED when the passages hold nothing further); Explain and Simplify become EXPLAIN AGAIN (clarify the same ground
// another way, nothing new: that is Go deeper); a check avoids what was already asked; a clarification judges in the light of
// what was taught. The two are never interchangeable (spec s3).
const TAUGHT_INSTRUCTION: Partial<Record<ClassicLearnAction | "check" | "clarify", string>> = {
  deeper: [
    "The student has ALREADY been taught this lesson: see TAUGHT SO FAR. GO DEEPER EXTENDS that teaching; it does not regenerate it. Before writing, decide from TAUGHT SO FAR and the passages: what has already been explained; which mechanisms, relationships and examples have been covered; what the student's answers show they understand or misunderstand; and what the passages hold that remains unexplored or only touched on -- a mechanism, a reason, a relationship between ideas, a distinction, an application, a limitation or uncertainty. Teach THAT: the next most valuable understanding, in depth, at the student's level.",
    "Repeat nothing from TAUGHT SO FAR beyond one sentence of continuity in the OVERVIEW: a round that teaches the same steps, mechanism or example as an earlier round, in other words, is a failure. If TAUGHT SO FAR lists ground still open or not yet taught, teach THAT first. KEY POINTS holds only points not yet given. EXAMPLE only a situation not yet used. The check question asks about the new ground. Deeper is not longer: do not restate the earlier teaching in more words, and do not invent complexity. Depth may also mean examining a fundamental idea the passages name more thoroughly.",
    `If the passages hold NOTHING of value beyond what TAUGHT SO FAR already covers, do not write a lesson: reply with exactly ${DEPTH_REACHED} on the first line, then one or two sentences, from the passages and cited, suggesting a related idea in them, or what the student could apply or practise next.`,
  ].join("\n"),
  explain: "EXPLAIN AGAIN: the student has already been taught this (TAUGHT SO FAR) and asks for it explained another way. Clarify the SAME ground with a different explanation, a different example from the passages or an analogy drawn from what they say; address anything their answers show they misunderstood. Introduce no new mechanism or topic: that is Go deeper, not this.",
  simplify: "EXPLAIN AGAIN, more simply: the student has already been taught this (TAUGHT SO FAR). Clarify the same ground in simpler words; add nothing new.",
  examples: "The student has already been taught this (TAUGHT SO FAR): give situations not yet used, showing ideas their answers suggest they have not yet grasped.",
  check: "TAUGHT SO FAR lists the questions already asked: ask a different one, on ground that has been taught, preferring what the student's answers have not yet shown they understand.",
  clarify: "TAUGHT SO FAR says what the student has been taught and how they answered before. Judge this answer in that light: build on what they already got right, and do not re-explain at length what they have already shown they understand.",
};

/** Pure. The MODE instruction for a learning action, with or without a TAUGHT SO FAR block. */
export function learnInstruction(action: ClassicLearnAction | "check" | "clarify", taught: boolean): string {
  const extra = taught ? TAUGHT_INSTRUCTION[action] : undefined;
  return extra ? `${LEARN_INSTRUCTION[action]}\n${extra}` : LEARN_INSTRUCTION[action];
}

/** The system prompt for one learning action: EXPLAIN_SYSTEM's rules, the action, the depth, and what may follow. */
export function learnSystem(action: LearnAction | "check" | "clarify", opts: { depth: ExplanationDepth; background: boolean; references: boolean; research?: boolean; teaching?: TeachingContext; taught?: boolean; deeperStructured?: boolean }): string {
  // SCHOLAR-GO-DEEPER-001 (policy scholar_go_deeper_structured, default off): a structured round. Its Scholar sections take the place of
  // the BEYOND THE NOTES part, so that part is not asked for. The research part, the flags and the last-read word rules are as for any lesson.
  if (action === "deeper" && opts.deeperStructured) {
    return [
      EXPLAIN_SYSTEM, "", deeperInstruction({ depth: opts.depth, scholar: opts.background, taught: !!opts.taught, depthReached: DEPTH_REACHED }),
      NO_COUNT_LAST, AVOID_WORDS_LAST, ...(opts.references ? [REFERENCES_RULE] : []), FLAG_RULE,
      ...(opts.research ? [researchInstruction(DEPTH_WORDS[opts.depth])] : []),
    ].join("\n");
  }
  // SCHOLAR-COMPANION-01 P1: the six teaching actions have their own wording (learn-teaching.ts) on the same rules and checks.
  if (isTeachingAction(action)) {
    const t = opts.teaching ?? {};
    const parts = [teachingBase(EXPLAIN_SYSTEM), "", teachingInstruction(action, { level: t.level, hintLevel: t.hintLevel, examEvidence: t.examEvidence ?? null, depthWords: highYieldWords(DEPTH_WORDS[opts.depth]), taught: !!opts.taught }), NO_COUNT_LAST, AVOID_WORDS_LAST];
    if (opts.references) parts.push(REFERENCES_RULE);
    // A question or a hint is not the place for a flag; a judgement or a summary may carry one.
    if (action === "mistake" || action === "teach_back" || action === "high_yield") parts.push(FLAG_RULE);
    return parts.join("\n");
  }
  const lesson = LESSON_ACTIONS.includes(action);
  const parts = [EXPLAIN_SYSTEM, "", learnInstruction(action, !!opts.taught)];
  if (action !== "check") parts.push(`Keep the part from the notes under ${(lesson ? LESSON_WORDS : DEPTH_WORDS)[opts.depth]} words${opts.depth === "brief" ? ", and keep it short" : ""}.`);
  // v2: the staging journey saw Simplify withheld twice for "two" -- a count the notes did not contain. Said last,
  // where it is read just before writing.
  if (action !== "check") parts.push(NO_COUNT_LAST, AVOID_WORDS_LAST);
  if (opts.references && action !== "check") parts.push(REFERENCES_RULE);
  if (opts.background && BACKGROUND_ACTIONS.includes(action as LearnAction))
    parts.push(lesson
      // SCHOLAR-CUMULATIVE-TEACHING-01 (spec s7): source insufficiency is named, and the AI's own explanation is kept apart and labelled.
      ? `Optional, after the part from the notes: a line that reads exactly ${SUPPLEMENTARY_MARKER} and then, under ${BACKGROUND_WORDS[opts.depth]} words, Scholar's own explanation of what these passages state but do not explain -- name the gap first ('The notes do not say why ...'), then give the general principle or mechanism behind it. General principles only: no numbers, units, doses, drug names, values or thresholds, no citation tags, no advice about any patient, and nothing presented as coming from the notes. Leave it out when the passages explain themselves.`
      : `Optional: general background that is NOT in the passages, after a line that reads exactly ${SUPPLEMENTARY_MARKER} -- under 100 words, general principles only, with no numbers, units, doses, drug names, values or thresholds, no citation tags, and no advice about any patient.`);
  if (action !== "check") parts.push(FLAG_RULE);
  // COMPETEN-RESEARCH-01: said last, where it is read just before writing. The rules above govern the notes part.
  if (opts.research && RESEARCH_ACTIONS.includes(action)) parts.push(researchInstruction(DEPTH_WORDS[opts.depth]));
  return parts.join("\n");
}

/** COMPETEN-RESEARCH-01: the student chose Research & Explain, so the research part is expected whenever an abstract is relevant. */
const researchInstruction = (words: number) => [
  "RESEARCH & EXPLAIN. The student asked for published research as well as their notes. After the passages you are given EXTERNAL RESEARCH, tagged [E1], [E2] ...: abstracts of published studies found for this topic. They are NOT the student's notes. Your reply has TWO parts.",
  `PART ONE, from the notes, under every rule above: cite [S n], never [E n]. If the passages do not cover the request, PART ONE is exactly ${NOT_IN_NOTES}.`,
  `PART TWO: a line that reads exactly ${RESEARCH_MARKER} and then, under ${words} words, what the abstracts say that helps the student understand this topic, ending EVERY sentence with the [E n] it comes from. Do not write a heading or an introduction: start with the first finding. Use only what the abstracts say: no outside facts, no figures they do not contain, no doses, drug names, regimens or advice about any patient, and never [S n] or [R n] in this part. Say plainly when the evidence is limited, early or mixed. Write PART TWO whenever any abstract is relevant to the topic, and leave it out only if none is.`,
].join("\n");

/** SCHOLAR-CUMULATIVE-TEACHING-01: what the lesson is (learn.ts lessonOutline), so a lesson is organised around its objective and its own headings, not slide by slide. */
export type LessonBrief = { title: string; objective: string; sections?: readonly string[] };
export function lessonBriefBlock(l: LessonBrief | null | undefined, opts: { oneConcept?: boolean } = {}): string {
  if (!l) return "";
  const heads = (l.sections ?? []).filter(Boolean);
  // SCHOLAR-GO-DEEPER-001: a structured round teaches one concept, so the lesson's headings are where it is, not a list it must cover.
  if (opts.oneConcept) return `THIS LESSON: ${l.title}. Objective: ${l.objective}${heads.length ? ` The passages fall under these headings: ${heads.join("; ")}.` : ""}\n\n`;
  return `THIS LESSON: ${l.title}. Objective: ${l.objective}${heads.length ? ` The passages fall under these headings, in order: ${heads.join("; ")}. Teach every one of them in turn, in proportion to what the passages say under each, and say where one leads to the next; a lesson that leaves a heading untaught is incomplete.` : ""}\n\n`;
}

export function learnUserPrompt(question: string, passages: Passage[], references: GovernedReference[], history: TutorTurn[], learnerContext: string | null, research: readonly ResearchEvidence[] = [], studyContext: string | null = null, extra: { taught?: string | null; lesson?: LessonBrief | null; oneConcept?: boolean } = {}): string {
  // SCHOLAR-SESSION-AI-02 (D4): the study-session block sits under the same preamble as the learner context -- emphasis
  // only, never grounding (checkLearnMain is never given it), never cited or quoted.
  const context = [learnerContext, studyContext].filter((x): x is string => !!x).join("\n\n");
  // SCHOLAR-CUMULATIVE-TEACHING-01: the lesson brief and the TAUGHT SO FAR block (learn-context.ts) come next, before the passages. Neither is grounding.
  const about = (context ? `${CONTEXT_PREAMBLE}\n${context}\n\n` : "") + lessonBriefBlock(extra.lesson, { oneConcept: extra.oneConcept }) + (extra.taught ? `${extra.taught}\n\n` : "");
  const blocks = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`);
  const refs = references.length ? `\n\nGOVERNED REFERENCES:\n${references.map((r, i) => `[R${i + 1}] ${r.code ? `${r.code} ` : ""}${r.title}${r.outcome ? ` -- outcome: ${r.outcome}` : ""} (${r.status})`).join("\n")}` : "";
  const ext = research.length ? `\n\nEXTERNAL RESEARCH (published abstracts, not my notes):\n\n${research.map((e, i) => `[E${i + 1}] ${e.title}${e.journal ? `. ${e.journal}` : ""}${e.year ? ` (${e.year})` : ""}\nAbstract: ${e.abstract}`).join("\n\n")}` : "";
  const convo = history.length ? `\n\nOUR CONVERSATION SO FAR:\n\n${history.map(t => `${t.speaker === "tutor" ? "SCHOLAR" : "STUDENT"}: ${t.text}`).join("\n\n")}` : "";
  const both = research.length ? `\n\n(Research & Explain: part one from my notes, then ${RESEARCH_MARKER} and part two from the research, cited [E n].)` : "";
  return `${about}PASSAGES FROM MY NOTES:\n\n${blocks.join("\n\n")}${refs}${ext}${convo}\n\n${history.length ? "MY REPLY" : "MY REQUEST"}: ${question}${both}`;
}

// ── SCHOLAR-ASK-SOURCES-01: ONE QUESTION, THE SOURCES THE LEARNER CHOSE ──────────────────────────────────
//
// The Explain engine and its modes, unchanged, with each chosen source kept in its own part: [S n] the learner's own
// (materials and saved learning, by checkExplanation), [E n] published research (by the research part's check). A tag in
// the wrong part withholds that part alone. Competen Library is never given to the model: its entries are competency
// titles and outcomes, not teaching text, and writing from them produced empty statements. They are listed as they stand.
export const ASK_ACROSS_PROMPT_SUFFIX = "+across-v1";
export const ASK_LIBRARY_LABEL = "Approved Competen Library entries that match your question. These are competency titles and outcomes, not teaching text, so Scholar lists them and does not write from them.";
export const ASK_RESEARCH_LABEL = "From published research, as abstracts only. Not your notes, and not reviewed by Competen. Check with your course and supervisors.";

/** Pure. What to write for the sources chosen. Said last, where it is read just before writing. */
export function askAcrossInstruction(has: { passages: boolean; research: boolean }): string {
  return [
    "SOURCES THE STUDENT CHOSE. Each source has its own part, in this order, and the tags of one part never appear in another. Never write the words PART ONE: start straight with the answer.",
    has.passages ? `PART ONE, from the passages, under every rule above: cite [S n]. If the passages do not cover the request, PART ONE is exactly ${NOT_IN_NOTES}.`
      : `There are no passages for this question, so PART ONE is exactly ${NOT_IN_NOTES}.`,
    ...(has.research ? [`Then a line that reads exactly ${RESEARCH_MARKER} and then, under 200 words, what the abstracts say that helps, using only those abstracts and ending EVERY sentence with the [E n] it comes from. Do not write a heading or an introduction. If they do not help, leave this part out.`] : []),
  ].join("\n");
}

export function askAcrossUserPrompt(question: string, passages: readonly Passage[], research: readonly ResearchEvidence[]): string {
  const notes = passages.length ? passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`).join("\n\n") : "(none for this question)";
  const ext = research.length ? `\n\nEXTERNAL RESEARCH (published abstracts, not my notes):\n\n${research.map((e, i) => `[E${i + 1}] ${e.title}${e.journal ? `. ${e.journal}` : ""}${e.year ? ` (${e.year})` : ""}\nAbstract: ${e.abstract}`).join("\n\n")}` : "";
  return `PASSAGES FROM MY NOTES:\n\n${notes}${ext}\n\nMY QUESTION: ${question}`;
}

/** Pure. The reply's parts, in any order. */
export function splitAskParts(raw: string): { main: string; background: string | null; research: string | null } {
  const found = ([["background", /^[\s*_#>-]*BEYOND THE NOTES:?[\s*_]*/im], ["research", /^[\s*_#>-]*FROM RESEARCH:?[\s*_]*/im]] as const)
    .map(([k, re]) => { const m = re.exec(raw); return m ? { k, at: m.index, end: m.index + m[0].length } : null; });
  const cuts = found.filter((x): x is { k: "background" | "research"; at: number; end: number } => !!x).sort((a, b) => a.at - b.at);
  // The instruction names the first part, and a model may echo the name. It is never shown.
  const main = (cuts.length ? raw.slice(0, cuts[0].at) : raw).replace(/^[\s*_#>-]*PART ONE\s*[:.\-]?[\s*_]*/, "").trim();
  const out = { main, background: null as string | null, research: null as string | null };
  cuts.forEach((c, i) => { out[c.k] = raw.slice(c.end, cuts[i + 1]?.at ?? raw.length).trim() || null; });
  return out;
}

/** Pure. A saved teaching or the learner's own note, as a passage: only its notes part, without the tags of its first answer. */
export function savedLearningPassage(row: { id: string; kind: "artefact" | "note"; materialId: string | null; createdAt: string; content: string }): Passage {
  const end = /^[\s*_#>-]*(FROM RESEARCH|BEYOND THE NOTES|CHECK THIS):?/im.exec(row.content);
  const notesPart = end ? row.content.slice(0, end.index) : row.content;
  // SCHOLAR-GO-DEEPER-001: a structured round's Scholar sections are not notes, so they never become a passage that answers rest on.
  const round = parseDeeperAnswer(notesPart);
  const body = (round ? deeperNotesOnlyText(round) : notesPart).replace(/\s*\[[SRE]\d+\]/g, "").trim();
  return {
    chunkId: row.id, materialId: row.materialId ?? "", materialTitle: `${row.kind === "note" ? "Your note" : "Saved teaching"}, ${row.createdAt.slice(0, 10)}`,
    ordinal: 0, pageFrom: null, pageTo: null, content: body.slice(0, 1800),
  };
}

export async function runAskAcross(userId: string, args: { question: string; mode: ExplainMode; passages: Passage[]; research: ResearchEvidence[] }, run: AiRun = generate) {
  const { question, mode, passages, research } = args;
  const r = await run({
    system: `${explainSystem(mode)}\n\n${askAcrossInstruction({ passages: passages.length > 0, research: research.length > 0 })}`,
    user: askAcrossUserPrompt(question, passages, research),
    tier: "reasoning",
    maxTokens: (mode === "explain" ? 700 : 900) + (research.length ? 400 : 0),
    // Research answers count towards the learner's research allowance, as Learn's do.
    context: { userId, attribution: { scope: "person" }, operation: research.length ? LEARN_RESEARCH_OPERATION : "individual_scholar_explain" },
  });
  if (!r.ok) return { ok: false, error: r.error } as AiFailure;
  const split = splitAskParts(r.text);
  const check: ExplainCheck = !passages.length ? { ok: false, reason: "not_in_notes" }
    : /\[E\d+\]/.test(split.main) ? { ok: false, reason: "ungrounded" } : checkExplanation(split.main, question, passages);
  return {
    ok: true as const, check,
    research: research.length && split.research ? checkResearchPart(split.research, research, passages, question) : null,
    model: r.model, provider: r.provider, promptVersion: `${explainPromptVersion(mode)}${ASK_ACROSS_PROMPT_SUFFIX}`,
  };
}

/** Pure. The answer, its background (BEYOND THE NOTES:), its research part (FROM RESEARCH:) and its flags (CHECK THIS:), in any order. */
export function splitLearnAnswer(raw: string): { main: string; background: string | null; flags: string | null; research: string | null } {
  const found = ([["background", /^[\s*_#>-]*BEYOND THE NOTES:?[\s*_]*/im], ["flags", /^[\s*_#>-]*CHECK THIS:?[\s*_]*/im], ["research", /^[\s*_#>-]*FROM RESEARCH:?[\s*_]*/im]] as const)
    .map(([k, re]) => { const m = re.exec(raw); return m ? { k, at: m.index, end: m.index + m[0].length } : null; });
  const cuts = found.filter((x): x is { k: "background" | "flags" | "research"; at: number; end: number } => !!x).sort((a, b) => a.at - b.at);
  const out = { main: (cuts.length ? raw.slice(0, cuts[0].at) : raw).trim(), background: null as string | null, flags: null as string | null, research: null as string | null };
  cuts.forEach((c, i) => { const text = raw.slice(c.end, cuts[i + 1]?.at ?? raw.length).trim(); out[c.k] = text || null; });
  return out;
}

/**
 * Pure. The notes-based part of a learning answer: every [S n] and [R n] must be one that was given, there must be
 * at least one [S n], and nothing may be added that the passages, the governed references (their own words) and
 * what the student typed do not contain.
 */
export function checkLearnMain(main: string, asked: string, passages: Passage[], references: GovernedReference[]): ExplainCheck {
  const text = main.trim();
  if (!text || text.replace(/[^A-Z_]/g, "") === NOT_IN_NOTES || text.startsWith(NOT_IN_NOTES)) return { ok: false, reason: "not_in_notes" };
  const s = [...text.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1])), r = [...text.matchAll(/\[R(\d+)\]/g)].map(m => Number(m[1]));
  if (!s.length) return { ok: false, reason: "no_citation" };
  if (s.some(t => t < 1 || t > passages.length) || r.some(t => t < 1 || t > references.length)) return { ok: false, reason: "bad_citation" };
  // COMPETEN-RESEARCH-01: external research is never cited in the part from the notes.
  if (/\[E\d+\]/.test(text)) return { ok: false, reason: "bad_citation" };
  const prose = scholarNamedTerms(text.replace(/\[[SR]\d+\]/g, " "));
  const grounding = [...passages.map(p => `${passageCitation(p)}\n${p.content}`), ...references.map(x => `${x.code ?? ""} ${x.title} ${x.outcome ?? ""}`), asked];
  const violations = groundingViolations(prose, grounding);
  if (violations.length) return { ok: false, reason: "ungrounded", violations };
  return { ok: true, text, cited: [...new Set(s)].sort((a, b) => a - b) };
}

/**
 * SCHOLAR-CUMULATIVE-TEACHING-01: NAMED TERMS whose first word is a finding marker but which name a therapy, not a test
 * result. "Positive pressure ventilation", "positive end-expiratory pressure" and "positive airway pressure" are the
 * mechanical ventilation terms the notes abbreviate (PPV, PEEP, CPAP); the acceptance run withheld three answers in a row
 * for "the term positive" when the model wrote the name out. The list is closed and exact, as the Holdings verifier's
 * own named terms are (grounding.ts NAMED_TERMS); "positive" alone, and every other marker, is checked exactly as before.
 */
const SCHOLAR_NAMED_TERMS = /\bpositive(?=[\s-]+(?:pressure|end[\s-]*expiratory|airway|inspiratory|expiratory))/gi;
/**
 * "again" is the verifier's recurrence marker (a symptom that came back). In a study companion's reply it is almost always the
 * dialogue's "once more" (try again, look again, read it again): the acceptance run withheld two Guide me turns and two
 * clarifications for it. It is excused UNLESS a word of clinical recurrence precedes it within the sentence (the pain came
 * again, the rash flared again), where it is checked exactly as before.
 */
const RECURRENCE_BEFORE_AGAIN = /\b(?:came|come|comes|returned|returns|return|recurred|recur|recurs|happened|happens|occurred|occurs|flared|flares|bled|bleeds|collapsed|deteriorated|relapsed|developed|develops|arrested|rose|fell|dropped|worsened|started|starts)\b[^.!?\n]{0,40}\bagain\b/i;
export const scholarNamedTerms = (prose: string) => prose.replace(SCHOLAR_NAMED_TERMS, "PPV-named")
  .replace(/\bagain\b/gi, (m, at: number, s: string) => (RECURRENCE_BEFORE_AGAIN.test(s.slice(Math.max(0, s.lastIndexOf(".", at) + 1), at + m.length)) ? m : "once-more"));

/**
 * Pure. Citations written as one bracket ("[S7, S8]", "[S7; 8]", "[S7-S9]") become the canonical "[S7][S8]" the parsers and the
 * grounding check read; left as written, the digits were checked as numbers and the answer withheld ("the number 8, 7, 9").
 */
export function normaliseCitations(text: string): string {
  return text.replace(/\[([SRE])\s*(\d+)((?:\s*[,;/]\s*[SRE]?\s*\d+)+|\s*[-–]\s*[SRE]?\s*\d+)\]/g, (_m, k: string, first: string, rest: string) => {
    if (/[-–]/.test(rest)) {
      const to = Number(rest.replace(/[^0-9]/g, ""));
      const from = Number(first);
      if (to > from && to - from <= 12) return Array.from({ length: to - from + 1 }, (_, i) => `[${k}${from + i}]`).join("");
      return `[${k}${first}][${k}${to}]`;
    }
    const nums = [first, ...rest.split(/[,;/]/).map(x => x.replace(/[^0-9]/g, "")).filter(Boolean)];
    return nums.map(n => `[${k}${n}]`).join("");
  });
}

/**
 * Pure. SCHOLAR-LEARN-FIX-01 L-B: the notes part of a Teach Me answer, checked PART BY PART, never more loosely:
 *   - the overview and key points are checked together by checkLearnMain exactly as any answer is;
 *   - the example is checked on its own by checkLearnMain (a given [S n], nothing the passages do not hold): failing it,
 *     the example alone is DROPPED, never shown -- so an unsupported example costs the example, not the lesson;
 *   - each check question must end with given [S n] tags, read as a question, carry no identifier, and add nothing the
 *     passages do not hold (checkCheckQuestion's rules): failing that it is DROPPED. At most TEACH_MAX_QUESTIONS.
 * SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct), SALVAGE: when the overview and key points fail ONLY as ungrounded, each is
 * checked on its own (salvageTeach): the ones the notes do not support are DROPPED and the rest is shown, when the
 * overview or at least one key point survives. Never salvaged -- the whole answer is withheld exactly as before -- on a
 * bad or missing citation, NOT_IN_NOTES, an identifier anywhere in the answer, or a dropped part that carries dosing
 * language or an invented number in a safety context (a dose, unit, rate, duration, threshold, lab value, age, score,
 * medication). What is kept passes checkLearnMain as a whole again. It carries `salvaged` (how many parts were left out,
 * and the rule each broke in its own words, never their text) and is never presented as verified.
 * What is shown is re-written in the canonical form (composeTeachAnswer). An answer with no OVERVIEW or KEY POINTS label
 * is checked as a whole, exactly as before.
 */
export type TeachSalvage = { removed: number; parts: { overview: boolean; points: number; understanding?: number; example: boolean; questions: number; sections?: number; relabelled?: number }; violations: PhrasingViolation[] };
export function checkTeachAnswer(main: string, asked: string, passages: Passage[], references: GovernedReference[]): { check: ExplainCheck; dropped: { example: boolean; questions: number } } {
  const parts = parseTeachAnswer(main.trim());
  if (!parts) return { check: checkLearnMain(main, asked, passages, references), dropped: { example: false, questions: 0 } };
  const body = composeTeachAnswer({ ...parts, example: null, questions: [] });
  // "OVERVIEW: NOT_IN_NOTES" is the model saying the passages do not cover it, in the labelled form.
  if (/\bNOT_IN_NOTES\b/.test(main) && !citedTags(body).length) return { check: { ok: false, reason: "not_in_notes" }, dropped: { example: false, questions: 0 } };
  let check = checkLearnMain(body || main, asked, passages, references);
  let kept = parts, removed: { overview: boolean; points: number; understanding: number; violations: PhrasingViolation[] } = { overview: false, points: 0, understanding: 0, violations: [] };
  if (!check.ok && check.reason === "ungrounded") {
    const s = salvageTeach(main, parts, asked, passages, references);
    if (s) ({ check, kept, removed } = s);
  }
  if (!check.ok) return { check, dropped: { example: false, questions: 0 } };
  const exampleCheck = kept.example ? checkLearnMain(kept.example, asked, passages, references) : null;
  const example = exampleCheck?.ok ? kept.example : null;
  let unsupportedQuestions = 0;
  const questions = kept.questions.filter(q => {
    const tags = citedTags(q), plain = questionText(q);
    const formed = tags.length > 0 && tags.every(t => t >= 1 && t <= passages.length) && /\?$/.test(plain) && plain.length >= 8 && plain.length <= 300 && !/\[[RE]\d+\]/.test(q);
    const supported = !findPatientIdentifiers(plain).length && !groundingViolations(plain, passages.map(p => p.content)).length;
    if (formed && !supported) unsupportedQuestions++;
    return formed && supported;
  }).slice(0, TEACH_MAX_QUESTIONS);
  const text = composeTeachAnswer({ ...kept, example, questions });
  const exampleDropped = !!kept.example && !example;
  const total = (removed.overview ? 1 : 0) + removed.points + removed.understanding + (exampleDropped ? 1 : 0) + unsupportedQuestions;
  const violations = [...removed.violations, ...(exampleCheck && !exampleCheck.ok ? exampleCheck.violations ?? [] : [])];
  return {
    check: {
      ok: true, text, cited: [...new Set([...check.cited, ...citedTags(example ?? ""), ...questions.flatMap(citedTags)])].sort((a, b) => a - b),
      ...(total ? { salvaged: { removed: total, parts: { overview: removed.overview, points: removed.points, understanding: removed.understanding, example: exampleDropped, questions: unsupportedQuestions }, violations } } : {}),
    },
    dropped: { example: exampleDropped, questions: kept.questions.length - questions.length },
  };
}

/**
 * Pure. SCHOLAR-GO-DEEPER-001: a structured round, checked section by section, and never more loosely than a lesson.
 *   - notes section: every sentence must rest on the passages it cites (deeper-prompt.ts sentenceSupported), pass the grounding verifier and
 *     add no firm conclusion or instruction. What fails MOVES to a Scholar section after it (its tags removed) and is judged as that, so
 *     "From your notes" is never a label on the model's own knowledge, and a round is not lost for one sentence of inference. What is
 *     neither is left out and counted. The whole round is withheld when what fails carries dosing language or an invented number in a
 *     safety context, as salvageTeach does.
 *   - scholar section: checkBackgroundText's rules (no tags, figures, doses, identifiers) and scholarClaimViolations (never presented as
 *     a research finding, no firm conclusion from a finding, no instruction about treating someone). A safety section is never Scholar's.
 *   - at least one notes section must survive: a round that rests on nothing the learner gave is withheld.
 *   - an identifier anywhere withholds the round. A question or a takeaway that fails is dropped on its own; a question's options that
 *     fail are dropped and the question stays open. No option is marked correct: the existing clarify judges the answer.
 * Falls back to the Teach me form when the model did not write the structured labels, so a badly formed reply is still checked, never shown raw.
 */
export function checkDeeperAnswer(main: string, asked: string, passages: Passage[], references: GovernedReference[], opts: { scholar: boolean; title?: string | null }): ExplainCheck {
  // A model's note to itself inside a tag ("[S8 is cognitive; use]") is not a citation, and its digit is not a number the lesson states.
  const clean = main.replace(/\[[SRE]\d+\s+[^\]]+\]/g, " ");
  const parts = parseDeeperAnswer(clean.trim());
  if (!parts) return checkTeachAnswer(main, asked, passages, references).check;
  if (findPatientIdentifiers(clean).length) return { ok: false, reason: "ungrounded" };
  const grounding = learnGrounding(passages, references, asked);
  const passageTexts = passages.map(p => p.content);
  const unsafe = (t: string, vs: PhrasingViolation[]) => { const plain = t.replace(/\[[SRE]\d+\]/g, " "); return RESEARCH_DOSING.test(plain) || (vs.some(v => v.kind === "ungrounded_number") && SAFETY_CONTEXT.test(plain)); };
  const scholarOk = (t: string) => opts.scholar && checkBackgroundText(t, SCHOLAR_SECTION_CHARS).ok && !scholarClaimViolations(t).length && !/\[[SRE]\d+\]/.test(t);
  const strip = (x: string) => x.replace(/\s*\[[SR]\d+\]/g, "").replace(/\s+([.,;:!?])/g, "$1").trim();
  const untag = (blocks: readonly DeeperBlock[]): DeeperBlock[] => blocks.map(b => (b.t === "p" ? { t: "p", text: strip(b.text) } : b.t === "list" ? { t: "list", items: b.items.map(strip) } : b.t === "flow" ? { t: "flow", steps: b.steps.map(strip) } : { t: "table", rows: b.rows.map(r => r.map(strip)) }));
  /** One piece of a notes section: does it rest on what it cites, and hold nothing the verifier or the claim rules refuse? */
  const holds = (t: string) => sentencesOf(t).every(x => sentenceSupported(x, passages)) && !groundingViolations(scholarNamedTerms(t.replace(/\[[SR]\d+\]/g, " ")), grounding).length && !notesClaimViolations(t, passageTexts).length;
  /** A notes section parted: what the notes hold, and what they do not. A paragraph parts sentence by sentence and a list item by item; a table or a flow moves whole. */
  const part = (s: DeeperSection) => {
    const ours: DeeperBlock[] = [], others: DeeperBlock[] = [];
    for (const b of s.blocks) {
      if (b.t === "p") {
        const sentences = sentencesOf(b.text), good = sentences.filter(holds), bad = sentences.filter(x => !holds(x));
        if (good.length) ours.push({ t: "p", text: good.join(" ") });
        if (bad.length) others.push({ t: "p", text: bad.join(" ") });
      } else if (b.t === "list") {
        const good = b.items.filter(holds), bad = b.items.filter(x => !holds(x));
        if (good.length) ours.push({ t: "list", items: good });
        if (bad.length) others.push({ t: "list", items: bad });
      } else (holds(deeperSectionText({ blocks: [b] })) ? ours : others).push(b);
    }
    return { ours, others: untag(others) };
  };
  const kept: DeeperSection[] = [], violations: PhrasingViolation[] = [];
  let removedSections = 0, relabelled = 0, firstFailure: Extract<ExplainCheck, { ok: false }> | null = null;
  for (const s of parts.sections.slice(0, DEEPER_MAX_SECTIONS)) {
    const text = deeperSectionText(s);
    if (s.source === "scholar") {
      if (s.kind !== "safety" && scholarOk(text)) kept.push(s); else removedSections++;
      continue;
    }
    const check = checkLearnMain(text, asked, passages, references);
    if (check.ok && notesSectionSupported(text, passages) && !notesClaimViolations(text, passageTexts).length) { kept.push(s); continue; }
    const vs = check.ok ? [] : check.violations ?? [];
    if (vs.length && unsafe(text, vs)) return { ok: false, reason: "ungrounded", violations: vs };
    violations.push(...vs);
    const { ours, others } = part(s);
    const oursOk = ours.length > 0 && checkLearnMain(deeperSectionText({ blocks: ours }), asked, passages, references).ok;
    if (oursOk) kept.push({ ...s, blocks: ours });
    // What the notes do not hold may still be sound general teaching, shown as what it is. A safety section never is: it stays with the notes or is left out.
    const moved = others.length > 0 && s.kind !== "safety" && scholarOk(deeperSectionText({ blocks: others }));
    // One connecting phrase beside what the notes hold is not a section of its own: it goes, without being counted as teaching left out.
    const connective = moved && oursOk && deeperSectionText({ blocks: others }).split(/\s+/).length < 15;
    if (moved && !connective) { kept.push({ ...s, source: "scholar", title: oursOk ? `${s.title}, beyond your notes` : s.title, blocks: others }); relabelled++; }
    if (!oursOk && !moved) { removedSections++; if (!check.ok && !firstFailure) firstFailure = check; }
    else if (others.length > 0 && !moved) removedSections++;
  }
  removedSections += Math.max(0, parts.sections.length - DEEPER_MAX_SECTIONS);
  if (!kept.some(s => s.source === "notes")) return firstFailure ?? { ok: false, reason: /\bNOT_IN_NOTES\b/.test(main) ? "not_in_notes" : "ungrounded", violations };
  // The focus question and its line are the round's frame: unsupported figures or terms cost the wording, never the round.
  const frameOk = (t: string) => !groundingViolations(scholarNamedTerms(t.replace(/\[[SRE]\d+\]/g, " ")), grounding).length && !scholarClaimViolations(t).length;
  const focus = /\?\s*$/.test(parts.focus) && parts.focus.length <= 200 && frameOk(parts.focus) ? parts.focus.replace(/\s*\[[SRE]\d+\]/g, "")
    : `What lies behind ${(opts.title ?? "this lesson").replace(/[?.!]+$/, "")}?`;
  const covers = parts.covers && parts.covers.length <= 240 && frameOk(parts.covers) ? parts.covers.replace(/\s*\[[SRE]\d+\]/g, "") : null;
  let unsupportedQuestions = 0;
  const questions: DeeperQuestion[] = [];
  for (const q of parts.questions) {
    const tags = citedTags(q.text), plain = questionText(q.text);
    const formed = tags.length > 0 && tags.every(t => t >= 1 && t <= passages.length) && /\?$/.test(plain) && plain.length >= 8 && plain.length <= 300 && !/\[[RE]\d+\]/.test(q.text);
    if (!formed || groundingViolations(plain, passageTexts).length) { unsupportedQuestions++; continue; }
    const options = q.options.slice(0, DEEPER_MAX_OPTIONS).map(o => o.replace(/\s*\[[SRE]\d+\]/g, "").trim());
    const optionsOk = options.length >= 2 && options.every(o => o.length <= 200 && !/\[[SRE]\d+\]/.test(o) && !groundingViolations(o, passageTexts).some(v => v.kind === "ungrounded_number") && !RESEARCH_DOSING.test(o));
    questions.push({ text: q.text, options: optionsOk ? options : [] });
  }
  const takeaways = parts.takeaways.slice(0, DEEPER_MAX_TAKEAWAYS).filter(t => (citedTags(t).length ? checkLearnMain(t, asked, passages, references).ok : scholarOk(t)));
  const droppedTakeaways = Math.min(parts.takeaways.length, DEEPER_MAX_TAKEAWAYS) - takeaways.length;
  const round: DeeperParts = { focus, covers, sections: kept, questions: questions.slice(0, DEEPER_MAX_QUESTIONS), takeaways };
  const text = composeDeeperAnswer(round);
  const total = removedSections + unsupportedQuestions + droppedTakeaways;
  return {
    ok: true, text, cited: citedTags(text).sort((a, b) => a - b),
    ...(total ? { salvaged: { removed: total, parts: { overview: false, points: droppedTakeaways, example: false, questions: unsupportedQuestions, sections: removedSections, relabelled }, violations } } : {}),
  };
}

/**
 * Pure. SCHOLAR-COMPANION-01 P1: a teaching answer is checked exactly as any Learn answer (checkLearnMain: a given [S n],
 * nothing the passages, the references and what the student typed do not hold), after numbered markers become bullets.
 * High-yield also may not claim anything about exams that the computed evidence does not allow (examClaimViolations).
 */
export function checkTeachingAnswer(action: TeachingAction, main: string, asked: string, passages: Passage[], references: GovernedReference[], examEvidence: ExamEvidence | null = null): ExplainCheck {
  const c = checkLearnMain(normaliseTeachingMarkdown(main), asked, passages, references);
  if (c.ok && action === "high_yield" && examClaimViolations(c.text, examEvidence).length) return { ok: false, reason: "ungrounded" };
  return c;
}

/** The grounding a Learn notes part is checked against: the passages, the governed references' own words, what was asked. */
const learnGrounding = (passages: Passage[], references: GovernedReference[], asked: string) =>
  [...passages.map(p => `${passageCitation(p)}\n${p.content}`), ...references.map(x => `${x.code ?? ""} ${x.title} ${x.outcome ?? ""}`), asked];

/** Pure. SCHOLAR-GUIDED-LEARNING-01: the overview and key points one by one, or null where nothing may be salvaged. */
function salvageTeach(main: string, parts: TeachParts, asked: string, passages: Passage[], references: GovernedReference[]) {
  if (findPatientIdentifiers(main).length) return null;
  const grounding = learnGrounding(passages, references, asked);
  const failing = (t: string) => groundingViolations(t.replace(/\[[SR]\d+\]/g, " "), grounding);
  const unsafe = (t: string, vs: PhrasingViolation[]) => { const plain = t.replace(/\[[SRE]\d+\]/g, " "); return RESEARCH_DOSING.test(plain) || (vs.some(v => v.kind === "ungrounded_number") && SAFETY_CONTEXT.test(plain)); };
  const ov = parts.overview.trim() ? failing(parts.overview) : [];
  const pts = parts.points.map(p => ({ p, vs: failing(p) }));
  // SCHOLAR-CUMULATIVE-TEACHING-01: each UNDERSTANDING paragraph is salvaged on its own, under the same safety rule.
  const und = (parts.understanding ?? []).map(p => ({ p, vs: failing(p) }));
  if ((ov.length && unsafe(parts.overview, ov)) || pts.some(x => x.vs.length && unsafe(x.p, x.vs)) || und.some(x => x.vs.length && unsafe(x.p, x.vs))) return null;
  const overview = ov.length ? "" : parts.overview;
  const points = pts.filter(x => !x.vs.length).map(x => x.p);
  const understanding = und.filter(x => !x.vs.length).map(x => x.p);
  if (!overview.trim() && !points.length && !understanding.length) return null;
  const check = checkLearnMain(composeTeachAnswer({ overview, understanding, points, example: null, questions: [] }), asked, passages, references);
  if (!check.ok) return null;
  return { check, kept: { ...parts, overview, understanding, points }, removed: { overview: ov.length > 0, points: pts.length - points.length, understanding: und.length - understanding.length, violations: [...ov, ...pts.flatMap(x => x.vs), ...und.flatMap(x => x.vs)] } };
}

export type LearnFlag = { text: string; cited: number[] };

/** Pure. The AI's flags: each line must cite a given passage and add nothing the passages do not hold. Others are dropped. */
export function checkFlags(raw: string | null, passages: Passage[]): { kept: LearnFlag[]; dropped: number } {
  if (!raw) return { kept: [], dropped: 0 };
  const lines = raw.split("\n").map(l => l.replace(/^[\s*-]+/, "").trim()).filter(Boolean);
  const kept: LearnFlag[] = [];
  let dropped = 0;
  for (const line of lines.slice(0, 5)) {
    const tags = [...line.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1]));
    const ok = tags.length > 0 && tags.every(t => t >= 1 && t <= passages.length) && !findPatientIdentifiers(line).length
      && !groundingViolations(line.replace(/\[S\d+\]/g, " "), passages.map(p => p.content)).length;
    if (ok) kept.push({ text: line, cited: [...new Set(tags)] }); else dropped++;
  }
  return { kept, dropped: dropped + Math.max(0, lines.length - 5) };
}

export type CheckQuestionResult = { ok: true; question: string } | { ok: false; reason: "malformed" | "ungrounded" | "identifier" };

/** Pure. The informal check question: one line, a question, nothing the passages do not hold. */
export function checkCheckQuestion(raw: string, passages: Passage[]): CheckQuestionResult {
  const m = /QUESTION:\s*(.+)/i.exec(raw.trim());
  const q = m?.[1]?.split("\n")[0].trim() ?? "";
  if (q.length < 8 || q.length > 300 || !q.endsWith("?")) return { ok: false, reason: "malformed" };
  if (findPatientIdentifiers(q).length) return { ok: false, reason: "identifier" };
  if (groundingViolations(q, passages.map(p => p.content)).length) return { ok: false, reason: "ungrounded" };
  return { ok: true, question: q };
}

/** Pure. The verdict line of a clarification, and the rest of it. */
export function parseVerdict(raw: string): { verdict: CheckVerdict | null; rest: string } {
  const m = /^\s*\**VERDICT:\s*(understood|partly|not[_ ]yet)\**\s*$/im.exec(raw);
  if (!m) return { verdict: null, rest: raw };
  const verdict = m[1].toLowerCase().replace(" ", "_") as CheckVerdict;
  return { verdict, rest: (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim() };
}

/** SCHOLAR-LEARN-FIX-01 L-B: Teach Me adds its structured-lesson version, so its saved answers key apart from the free-text ones. */
export const learnPromptVersion = (action: LearnAction | "check" | "clarify", opts: { deeperStructured?: boolean } = {}) => `${PROMPT_VERSIONS.learn}:${action}${action === "teach" ? `+${PROMPT_VERSIONS.learnTeach}` : action === "deeper" ? `+${opts.deeperStructured ? PROMPT_VERSIONS.learnDeeperStructured : PROMPT_VERSIONS.learnDeeper}` : action === "clarify" ? `+${PROMPT_VERSIONS.learnClarify}` : isTeachingAction(action) ? `+${PROMPT_VERSIONS.teaching}` : ""}`;
/** SCHOLAR-CUMULATIVE-TEACHING-01: an answer written with a TAUGHT SO FAR block carries the cumulative suffix, so it is never served as a context-free one. */
export const cumulativePromptVersion = (version: string) => `${version}+${PROMPT_VERSIONS.cumulative}`;
/** SCHOLAR-GUIDED-LEARNING-01: the earlier Teach Me versions whose saved lessons are still opened with no AI call (LEARN_TEACH_LEGACY). */
export const legacyLearnPromptVersions = (action: LearnAction | "check" | "clarify"): string[] =>
  action === "teach" ? LEARN_TEACH_LEGACY.map(v => `${PROMPT_VERSIONS.learn}:teach+${v}`) : action === "deeper" ? [`${PROMPT_VERSIONS.learn}:deeper`] : [];

export type LearnResult = AiFailure | {
  ok: true; action: LearnAction | "check" | "clarify"; model: string; provider: string; promptVersion: string;
  check: ExplainCheck; background: SupplementaryCheck | null; flags: { kept: LearnFlag[]; dropped: number };
  verdict: CheckVerdict | null; question: CheckQuestionResult | null;
  /** COMPETEN-RESEARCH-01: the research part, checked; null when no research was given or none was written. */
  research: ResearchCheck | null;
  /** SCHOLAR-CUMULATIVE-TEACHING-01: Go deeper declared the passages taught in the depth they support (learn-context.ts DEPTH_REACHED). */
  depthReached?: { suggestion: string } | null;
};

/** COMPETEN-RESEARCH-01: a Research & Explain answer carries its own prompt version, so a saved one is never reused as notes-only. */
export const RESEARCH_PROMPT_SUFFIX = "+research-v2";
export const learnResearchPromptVersion = (action: LearnAction | "check" | "clarify", opts: { deeperStructured?: boolean } = {}) => `${learnPromptVersion(action, opts)}${RESEARCH_PROMPT_SUFFIX}`;
/** Its own operation, so its spend is separable in plat_ai_requests (the per-learner cost limit, the HQ panel). */
export const LEARN_RESEARCH_OPERATION = "individual_scholar_learn_research";

/**
 * One learning action on the given passages. `asked` grounding is what the student typed (their question, their
 * answer to a check) and the check question itself -- they were shown or wrote it. Background is asked for only
 * when `background` is true and the action may carry it; it is split off and checked by the background rules.
 * `research` (COMPETEN-RESEARCH-01): verified external abstracts, given as [E n] and written up apart.
 */
export async function runLearn(userId: string, args: {
  action: LearnAction | "check" | "clarify"; question: string; passages: Passage[]; references: GovernedReference[];
  depth: ExplanationDepth; background: boolean; history: TutorTurn[]; learnerContext: string | null; research?: readonly ResearchEvidence[];
  /** SCHOLAR-SESSION-AI-02 (D4): the study-session block, for an ask in the caller's own connected session only. */
  studyContext?: string | null;
  /** SCHOLAR-COMPANION-01 P1: the rung, the hint level or the exam evidence of a teaching action. */
  teaching?: TeachingContext;
  /** SCHOLAR-CUMULATIVE-TEACHING-01: the TAUGHT SO FAR block (learn-context.ts taughtSoFarBlock), the lesson brief, and the learner's earlier check answers (grounding, as a clarify's answer is). */
  taught?: string | null;
  lesson?: LessonBrief | null;
  learnerTexts?: readonly string[];
  /** SCHOLAR-GO-DEEPER-001: this Go deeper is a structured round (policy scholar_go_deeper_structured). Evidence reaches it through `research`: an evidence pack is one more source of ResearchEvidence. */
  deeperStructured?: boolean;
}, run: AiRun = direct): Promise<LearnResult> {
  const research = args.research?.length && RESEARCH_ACTIONS.includes(args.action) ? args.research : [];
  const studyContext = args.action === "ask" ? args.studyContext ?? null : null;
  const taught = args.action === "ask" ? null : args.taught ?? null;
  const lesson = LESSON_ACTIONS.includes(args.action);
  const deeperStructured = args.action === "deeper" && !!args.deeperStructured;
  const r = await run({
    system: learnSystem(args.action, { depth: args.depth, background: args.background, references: args.references.length > 0, research: research.length > 0, teaching: args.teaching, taught: !!taught, deeperStructured }),
    user: learnUserPrompt(args.question, args.passages, args.references, args.history, args.learnerContext, research, studyContext, { taught, lesson: args.action === "ask" ? null : args.lesson, oneConcept: deeperStructured }),
    tier: "reasoning",
    // SCHOLAR-CONTINUITY-01 item 5: High-yield with exam evidence carries the learner's own past-paper count in its system text,
    // so that block is not marked for caching. Every other Learn system block is the same for every learner and stays marked.
    ...(args.teaching?.examEvidence && args.teaching.examEvidence.questions > 0 ? { cacheSystem: false } : {}),
    maxTokens: args.action === "check" ? 200 : isTeachingAction(args.action) ? teachingMaxTokens(args.action, args.depth) : (deeperStructured ? DEEPER_MAX_TOKENS[args.depth] : lesson ? LESSON_MAX_TOKENS[args.depth] : args.depth === "detailed" ? 1100 : 800) + (research.length ? 500 : 0),
    context: { userId, attribution: { scope: "person" }, operation: research.length ? LEARN_RESEARCH_OPERATION : "individual_scholar_learn" },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const version = `${research.length ? learnResearchPromptVersion(args.action, { deeperStructured }) : learnPromptVersion(args.action, { deeperStructured })}${studyContext ? `+${PROMPT_VERSIONS.studySession}` : ""}`;
  const base = { ok: true as const, action: args.action, model: r.model, provider: r.provider, promptVersion: taught ? cumulativePromptVersion(version) : version };
  if (args.action === "check") {
    const question = checkCheckQuestion(r.text, args.passages);
    return { ...base, check: { ok: false, reason: "not_in_notes" }, background: null, flags: { kept: [], dropped: 0 }, verdict: null, question, research: null };
  }
  // SCHOLAR-CUMULATIVE-TEACHING-01: Go deeper on taught ground may declare the passages exhausted instead of restating them.
  const depthReached = args.action === "deeper" && taught ? parseDepthReached(r.text) : null;
  if (depthReached) return { ...base, check: { ok: false, reason: "not_in_notes" }, background: null, flags: { kept: [], dropped: 0 }, verdict: null, question: null, research: null, depthReached };
  // SCHOLAR-CUMULATIVE-TEACHING-01: "[S7, S8]" and "[S7-S9]" become "[S7][S8]..." before anything reads the reply.
  const { verdict, rest } = args.action === "clarify" || args.action === "teach_back" ? parseVerdict(normaliseCitations(r.text)) : { verdict: null, rest: normaliseCitations(r.text) };
  const split = splitLearnAnswer(rest);
  const asked = [args.question, ...args.history.map(t => t.text), ...(args.learnerTexts ?? [])].join("\n");
  const mayBackground = args.background && BACKGROUND_ACTIONS.includes(args.action as LearnAction);
  return {
    ...base,
    check: deeperStructured ? checkDeeperAnswer(split.main, asked, args.passages, args.references, { scholar: args.background, title: args.lesson?.title ?? null })
      : lesson ? checkTeachAnswer(split.main, asked, args.passages, args.references).check
      : isTeachingAction(args.action) ? checkTeachingAnswer(args.action, split.main, asked, args.passages, args.references, args.teaching?.examEvidence ?? null)
        : checkLearnMain(split.main, asked, args.passages, args.references),
    // A lesson's explanation beyond the notes may run to BACKGROUND_WORDS (about 1600 characters); every other rule is unchanged.
    background: split.background === null ? null : mayBackground ? checkBackgroundText(split.background, lesson ? 1600 : 900) : { ok: false, reason: "not_this_mode" },
    flags: checkFlags(split.flags, args.passages),
    verdict, question: null,
    research: research.length && split.research ? checkResearchPart(split.research, research, args.passages, asked) : null,
  };
}

// ── REVISION-01 R4: A SHORT ANSWER, MARKED ── deterministic first, AI evaluation only where it adds something ──
//
// markShortAnswer is code: the student's answer against the stored accepted answers, normalised. A match is correct.
// No match is NOT "incorrect" -- a short answer can be right in other words -- so it returns null, and the caller
// asks AI evaluation (activity `evaluate`) or, where that is unavailable, the student's own judgement.
// runEvaluate judges ONLY against the passage and the accepted answers. Its feedback must add nothing they and the
// student's own answer do not hold, or it is withheld. It is labelled AI evaluation wherever it is shown.

// markShortAnswer lives with the revision rules (revision.ts), which mark every kind.
export { markShortAnswer } from "./revision";

// ── REVISION-01 R2: REVISION QUESTIONS OF THE 416 KINDS ── one passage, one kind, the question rules ───────────────
//
// mcq goes through runQuestions (its quality layer and blind verification) unchanged. The other kinds are written here
// under the same grounding rules and checked item by item by revision.ts checkRevisionDraft: well formed, the quote in
// the passage, nothing ungrounded, nothing identifying. An item that fails is dropped and counted, never stored. If
// nothing survives the first attempt, it writes again once.

// SCHOLAR-QUESTION-INTELLIGENCE-01 (revision v3): every item a real question (a flashcard front a question or a
// term, never a statement), the rubric fields, and the guidance block after the passage. mrq and short items then get
// the blind check (question-quality.ts REVISION_VERIFY_SYSTEM), on the same activity.
const REVISION_COMMON = [
  "You write revision items for a healthcare student, from ONE passage of their own study notes, for their own formative revision.",
  "RULES:",
  "1. Every item must be answerable from the passage ALONE. Do not test anything the passage does not state.",
  "2. Do not add any number, dose, value, date, finding or term that is not in the passage. Never write a number the passage does not contain, in digits or words. Do not count things.",
  "3. sourceQuote is ONE sentence copied EXACTLY from the passage that supports the answer.",
  "4. difficulty is 1 (recall a stated fact), 2 (understand or connect) or 3 (apply or distinguish). Where the passage allows, spread the items: not all recall.",
  "5. Never include a name, NHS number, date of birth or any detail that could identify a real person.",
  "6. The rationale and every answer use the passage's own words. Do not explain beyond what the passage says, and do not add any term it does not use.",
  "7. Every item ASKS something. Never copy a statement from the passage as the question: turn it into a question the statement answers.",
  RUBRIC_RULE,
  "Reply with a JSON array ONLY, no prose and no code fence. If the passage cannot support an item of this kind, reply [].",
];
// Revise engine quality (revision v4, flashcard mix v3, structured v2). Scenario and calculation keep REVISION_COMMON word for word: a stored scenario is
// served only at its current prompt version, so changing that prompt would retire every scenario a learner already has.
const REVISION_DEPTH = [...REVISION_COMMON, DEPTH_RULE, SUBJECT_RULE];
export const REVISION_SYSTEM: Record<"mrq" | "short" | "flashcard" | "match" | "sequence" | "structured" | "true_false" | "extended" | "scenario" | "calculation", string> = {
  mrq: [...REVISION_DEPTH, 'Each item: {"stem": "a question ending with ? that says to choose all that apply", "options": [4 to 6 short options built only from the passage\'s words, each a plausible answer that tempts someone who has not understood, never "all of the above"], "correct": [the indexes of EVERY option the passage supports, at least one and not all], "rationale": "...", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}'].join("\n"),
  short: [...REVISION_DEPTH, 'Each item: {"stem": "a question ending with ? that, where the passage allows, asks the student to explain why, interpret a finding or say what follows, in a phrase or a sentence; a plain fact only where that is the objective", "accepted": [1 to 4 short answers the passage supports, in its own words], "rationale": "...", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}'].join("\n"),
  // SCHOLAR-FLASHCARDS-QA-01 (flashcard v2, PROMPT_VERSIONS.flashcardMix): a concise one-concept back (never the
  // note's sentence repeated, never a second fact), a short explanation only where the passage gives a reason, a topic
  // name, and the objective in the learner's voice. Checked in code: question-intel.ts flashcardDraftProblem, parseRubric.
  flashcard: [...REVISION_DEPTH,
    "A flashcard is quick retrieval of ONE thing: a short prompt that never holds its own answer and is never a clinical scenario. Where a topic has several facts, write separate cards. Where the objective needs reasoning, it is not a flashcard: reply [].",
    'Each item: {"front": "a short question ending with ?, or a single term (a few words) to recall -- never a sentence or a statement", "back": "the answer to the front ONLY: one concept, as short as it can be (a few words, at most two short sentences), using the passage\'s terms but never repeating a passage sentence whole and never adding a second fact", "rationale": "one short sentence on why the answer holds, from the passage -- or \\"\\" when the passage gives no reason", "topic": "the topic the card belongs to, two to five words: one of the CONCEPTS given where one fits, otherwise the passage\'s own words", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}',
    'For flashcards, "objective" is written TO the learner as what they will be able to do, starting with a verb ("Explain why ...", "Recognise ...", "State ..."), never "Checks ...", "Tests ..." or "The student ...".',
  ].join("\n"),
  match: [...REVISION_DEPTH, "Matching tests a meaningful association or distinction: each right side states the function, reason, consequence or contrast the passage gives, and never repeats its left term. The right sides are alike in form, so grammar gives no clue.", 'Each item: {"stem": "what to match, e.g. Match each finding to what it suggests", "pairs": [{"left": "...", "right": "..."}, {"left": "...", "right": "..."}, {"left": "...", "right": "..."}], "rationale": "...", "sourceQuote": "...", "difficulty": 1}. Three to six pairs, each stated by the passage, every left and every right different. Only write one when the passage states at least three such pairs.'].join("\n"),
  sequence: [...REVISION_DEPTH, 'Each item: {"stem": "what to put in order, ending with ?", "steps": [3 to 6 steps IN THE ORDER THE PASSAGE GIVES THEM], "rationale": "...", "sourceQuote": "...", "difficulty": 1}. Only write one when the passage itself gives an order.'].join("\n"),
  // SCHOLAR-SQIE-CLOSE-01 (structured v1, migration 710): a lead-in and two to four parts, each its own question with
  // whole practice marks and its own rubric. Marked part by part by code or by the evaluator (activity evaluate).
  structured: [...REVISION_DEPTH,
    'Each item: {"stem": "a short lead-in from the passage that sets up the parts (a statement is allowed here)", "parts": [{"prompt": "a question ending with ?, with no part label", "marks": 1, "accepted": [1 to 4 short answers the passage supports, in its own words], "keyPoints": ["..."], "misconceptions": []}, {"prompt": "a different question ending with ?, with no part label", "marks": 2, "accepted": ["..."], "keyPoints": ["..."], "misconceptions": []}], "rationale": "...", "sourceQuote": "...", "difficulty": 2, "level": "understanding", "objective": "...", "references": []}.',
    "Two to four parts. Each part asks something DIFFERENT that the passage answers, building from recall to understanding or application where the passage allows. marks is a whole number from 1 to 5: more for a part that needs more of the passage. Write at most one item.",
  ].join("\n"),
  // SCHOLAR-SQIE-LEARNER-01: true/false -- a statement the passage settles, marked by code (formats.ts). Stored as a `short` item.
  true_false: [...REVISION_DEPTH,
    'Each item: {"statement": "ONE declarative sentence (never a question) that the passage settles, in the passage\'s own words", "answer": true, "explanation": "one or two sentences from the passage saying why the statement is true or false", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}.',
    'For true or false, rule 7 does not apply: the statement is a statement. Balance the items: about half should be false. A FALSE statement changes ONE thing the passage says (its opposite, or another term from the passage) using only words the passage uses, so the passage plainly shows it is false, and sourceQuote is the sentence that shows it. A TRUE statement is supported by sourceQuote itself. No double negatives, no "always" or "never" unless the passage says so, and never a statement the passage does not settle.',
  ].join("\n"),
  // SCHOLAR-SQIE-LEARNER-01: extended response -- a paragraph answer marked by the formative evaluator against its key points (formats.ts).
  extended: [...REVISION_DEPTH,
    `Each item: {"stem": "a question ending with ? that needs a short paragraph to answer", "modelAnswer": "a complete answer of two to four sentences, in the passage's own words", "keyPoints": [${EXTENDED_POINTS_MIN} to ${EXTENDED_POINTS_MAX} short points a full answer makes, each a DIFFERENT idea the passage states], "marks": 4, "rationale": "...", "sourceQuote": "...", "difficulty": 2, "level": "understanding", "objective": "...", "misconceptions": [], "references": []}.`,
    `For an extended response, "keyPoints" has ${EXTENDED_POINTS_MIN} to ${EXTENDED_POINTS_MAX} points (not one to four): the answer is marked by how many it makes. marks is a whole number from 1 to 10. Write at most one item.`,
  ].join("\n"),
  // SQIE-CLOSE-2026-11 WS-A (calculation v1): a calculation from the passage's own figures, answered as a number and a unit. Checked in code
  // (revision.ts checkRevisionDraft: every stem figure is in the passage, a recognised unit, no model-written tolerance) and blind-solved.
  calculation: [...REVISION_COMMON,
    'Each item: {"stem": "a calculation question ending with ? that uses ONLY figures stated in the passage and says the unit the answer is wanted in", "value": 2.5, "unit": "mL", "working": "the steps of the calculation, using the passage figures", "rationale": "one or two sentences from the passage on why this is the method", "sourceQuote": "...", "difficulty": 2, "level": "application", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}.',
    'For a calculation, rule 2 applies to the STEM: every number in it is copied from the passage (a dose, a strength, a volume, a rate, a weight, a time). value is the exact numerical answer (a number, not text); unit is a standard clinical unit (for example mg, micrograms, g, mL, L, mL/hour, mg/kg, units, mmol, drops/minute) or "" for a unitless answer. Where the answer is not a whole number, the stem says how to round it, and value is rounded that way. Only write one when the passage gives every figure the calculation needs; never invent a figure. Write at most two items.',
  ].join("\n"),
  // SCHOLAR-CE-2026 CE-05 (scenario v3): a CLINICAL situation that develops over time, and a DECISION at every stage. Stage 1 is a plausible person in practice
  // with a decision; stage 2 a meaningful CHANGE (a new finding, result or event) needing reassessment or a new decision; stage 3 further clinical judgement.
  // Every question is a decision in the situation as it stands, never plain recall. Every finding and every expected action is supported by a cited sentence of
  // the section. Checked in code (revision.ts checkRevisionDraft -> scenario.ts parseScenario, shapeScenario, scenarioFlaw, citationFlaw, scenarioGroundingFlaw):
  // well formed, a situation in practice, no answer given away earlier, no stage repeating another, every stage cited, every question situational.
  scenario: [...REVISION_COMMON,
    `Each item: {"situation": "a person in practice at the start: what is seen and what is happening, two or three sentences", "stages": [{"reveal": "", "prompt": "a decision about THIS person now, ending with ?", "kind": "mcq", "options": [exactly 4 short options built only from the passage words], "correct": [the index of the ONE right option], "weight": 1, "keyPoint": "the point from the passage this stage teaches", "source": "ONE sentence, or two consecutive sentences, copied EXACTLY from the passage that state this stage", "references": []}, {"reveal": "a NEW finding, result or event", "prompt": "a decision after this change, ending with ?", "kind": "short", "accepted": [1 to 4 short answers the passage supports], "weight": 2, "keyPoint": "...", "source": "ONE sentence copied EXACTLY from the passage", "references": []}], "rationale": "...", "sourceQuote": "...", "difficulty": 2, "level": "application", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}.`,
    "THIS IS A PATIENT-CENTRED CLINICAL SCENARIO, NOT A QUIZ ABOUT NOTES. The situation describes a fictional person (or a clinical situation) in practice as it is at the start: what is seen, measured or reported, and what is happening. It has no name, age, date, number or identifier, and it refers to staff only as the team, a colleague, a clinician or a member of staff. NEVER mention notes, a passage, a student, a learner or revising anywhere in it, and never write phrases such as According to the notes or The notes also say.",
    "THREE STAGES WHEN THE MATERIAL SUPPORTS THEM, two when it is thin. Stage 1: the person as they are at the start, and a decision about what to notice, prioritise or do first. Stage 2: a meaningful CHANGE (the first stage has an empty reveal; this one MUST reveal NEW clinical information: a changed observation, a finding, an investigation result or an event), and a decision that needs reassessment of the person or a new priority. Stage 3: a further development or finding, and a decision that needs clinical judgement (what the change suggests, how urgent it is, who to involve, what to do next). Introduce each reveal with a time-neutral phrase such as Some time later, Shortly afterwards or When the result arrives. A reveal states what is NOW seen, measured, reported or found; never what someone decides, plans, prepares or intends to do (that is the question). Do not state how many minutes or hours pass, or any number, that the passage does not contain.",
    "EVERY QUESTION IS A DECISION IN THE SITUATION AS IT STANDS and refers to the person or to what has just been found, for example: What should the team do first now? / Which finding here most needs acting on? / What does this change suggest, and what is the next step? / What is the priority for this person now? NEVER a generic recall question such as Which X is often..., What is the ..., What does X stand for, Which observations does X combine, or anything that starts According to. A question asks for application, prioritisation or reasoning about THIS person, answerable from the passage ALONE.",
    "NO LEAKAGE. Never put a stage's answer, or the facts only a later stage needs, in the situation or in any earlier stage. If a stage asks for the first sign, the situation must not name it. Clinical clues that lead the learner towards the answer are right; stating the answer is not. A later stage never repeats a question an earlier stage already asked.",
    "NOTHING INVENTED. Every finding you show, every expected action and every key point must be supported by the sentence you cite for that stage. Never add a finding, a result, a value or a management step to complete the story. Each stage carries a source: ONE sentence (or two consecutive sentences) copied EXACTLY from the passage that STATES the stage answer and its key point, so the answer and key point use only what that source says; every stage cites DIFFERENT sentences. Where an approved reference is given and a stage draws on it, list its tag in that stage's references. If the passage does not describe what a person presents with, what it means and what is done, reply [].",
    'The decision must be one that someone at MY LEVEL would properly make (see SCOPE below). "kind" is one of mcq (exactly 4 options and one right index), mrq (4 to 6 options and every right index; AT LEAST ONE option must be wrong; if every option would be right, do NOT use mrq: use short with the items as accepted answers, or an mcq) or short (accepted answers). Do not use cloze. weight is a whole number from 1 to 5: more for a stage that needs more of the passage. Write at most one item.',
  ].join("\n"),
};

/** The revision kinds the blind check fits (question-quality.ts REVISION_VERIFY_SYSTEM). */
export const REVISION_VERIFIED_KINDS: readonly (keyof typeof REVISION_SYSTEM)[] = ["mrq", "short"];
/**
 * The prompt version a new item is stored at. `verified` (default: the kinds that were always blind-checked) adds the check's own
 * version, so what is stored says whether a blind reader saw it. The version PREFIX (formatPromptVersion) does not change with it.
 */
export const revisionPromptVersion = (kind: keyof typeof REVISION_SYSTEM, verified: "default" | "blind" | "revision" | "none" = "default") => {
  const check = verified === "default" ? (REVISION_VERIFIED_KINDS.includes(kind) ? "revision" : "none") : verified;
  const suffix = check === "revision" ? `+${PROMPT_VERSIONS.verifyRevision}` : check === "blind" ? `+${PROMPT_VERSIONS.verifyBlind}` : "";
  return kind === "structured" ? `${PROMPT_VERSIONS.structured}${suffix}`
    : kind === "scenario" ? `${PROMPT_VERSIONS.scenario}${suffix}`
    : kind === "flashcard" ? `${PROMPT_VERSIONS.revision}:flashcard+${PROMPT_VERSIONS.flashcardMix}${suffix}`
    : kind === "calculation" ? `${PROMPT_VERSIONS.calculation}${suffix}`
      : `${PROMPT_VERSIONS.revision}:${kind}${suffix}`;
};
/**
 * The prompt version prefix a stored question of a format was written at: what "already written at this version" reads.
 * SCHOLAR-FLASHCARDS-QA-01: a flashcard's includes the level mix, so a section carded before the mix may be carded again
 * (the cards already there are kept, and a repeat of one is still refused by its stem).
 */
export const formatPromptVersion = (kind: string): string =>
  kind === "mcq" ? PROMPT_VERSIONS.mcq : kind === "structured" ? PROMPT_VERSIONS.structured : kind === "scenario" ? PROMPT_VERSIONS.scenario : kind === "calculation" ? PROMPT_VERSIONS.calculation
    : kind === "flashcard" ? `${PROMPT_VERSIONS.revision}:flashcard+${PROMPT_VERSIONS.flashcardMix}` : `${PROMPT_VERSIONS.revision}:${kind}`;

/**
 * One call (and one retry): revision items of one kind from one passage, each checked. `run` is the metered runner.
 * SCHOLAR-QUESTION-INTELLIGENCE-01: the guidance block after the passage, the extra checks (revision.ts
 * checkRevisionDraft), and for mrq and short the blind check -- one more call on the same activity, only when an item
 * survived. `calls` counts the model calls made (main, verify, retry, retry-verify): at most four.
 */
export async function runRevisionQuestions(userId: string, kind: keyof typeof REVISION_SYSTEM, passage: Passage, limit: number, run: AiRun = direct, opts: GenerationOptions = {}) {
  const dropped: string[] = [];
  let kept: RevisionDraft[] = [];
  let model = "", provider = "", calls = 0;
  const context = opts.context;
  const refs = context?.mode === "notes_and_references" ? context.references : [];
  const verifyPassage = [passage.content, ...referenceGrounding(refs)].join("\n");
  const asked = kind === "structured" || kind === "extended" || kind === "scenario" ? 1 : Math.min(3, Math.max(1, limit));
  // SCHOLAR-SQIE-LEARNER-01: which formats a blind check runs on (policy scholar_verify_formats), and the objectives already tested.
  // SQIE-CLOSE-2026-11 WS-A: a calculation's key is arithmetic the notes do not state, so a blind second solve ALWAYS checks it (fails closed).
  const verifyOn = kind === "calculation" || (opts.verifyFormats ?? VERIFY_DEFAULT).includes(kind);
  const seenObjectives = new Set(opts.existingObjectives ?? []);
  const objectiveOf = (d: RevisionDraft) => (d.answer.rubric as { objective?: string | null } | undefined)?.objective ?? null;
  let verifiedAny = false;
  // SCHOLAR-FLASHCARDS-QA-01: flashcards to the level mix, only at the levels this passage can support (the rest fall
  // back to recall and understanding, and why is returned for the audit row): one more line of the guidance block.
  const levelPlan: LevelPlan | null = kind === "flashcard" && opts.levelMix ? planCardLevels(opts.levelMix, asked, { difficulty: context?.difficulty ?? null, passage: passage.content }) : null;
  const mixLine = levelPlan ? levelMixLine(levelPlan) : "";
  const guidance0 = generationContextBlock(context ?? NO_CONTEXT, asked);
  // CE-05: a scenario asks decisions fit for the learner's level (the guidance already carries MY LEVEL where the study record has one).
  const guidance = kind === "scenario" ? (guidance0 ? `${guidance0}\n${SCENARIO_SCOPE_LINE}` : `\n\nGUIDANCE (do not mention it). Every item must still be answerable from the passage ALONE.\n${SCENARIO_SCOPE_LINE}`) : guidance0;
  const guidanceWithMix = !mixLine ? guidance : guidance ? `${guidance}\n${mixLine}` : `\n\nGUIDANCE (do not mention it). Every item must still be answerable from the passage ALONE.\n${mixLine}`;
  let relabelled = 0;
  for (let attempt = 1; attempt <= 2 && !kept.length; attempt++) {
    calls++;
    const r = await run({
      system: REVISION_SYSTEM[kind],
      user: `${questionUserPrompt(passage)}${guidanceWithMix}`,
      tier: "reasoning",
      maxTokens: kind === "scenario" ? 2800 : 1800,
      context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_revision_${kind}` },
    }, attempt === 1 ? "main" : "retry");
    if (!r.ok) return { ok: false as const, error: r.error };
    model = r.model; provider = r.provider;
    // A repeat of a stored stem, or of one kept earlier in this reply, is not stored again.
    const seen = new Set(opts.existing ?? []);
    const replyObjectives = new Set(seenObjectives);
    let batch: RevisionDraft[] = [];
    // A structured question is one substantial item a call (its prompt asks for at most one).
    for (const raw of (parseJsonArray(r.text) ?? []).slice(0, kind === "structured" || kind === "extended" || kind === "scenario" ? 1 : limit)) {
      const c = checkRevisionDraft(kind, raw, passage, { existing: seen, difficulty: context?.difficulty ?? null, references: refs, existingObjectives: replyObjectives });
      if (c.ok) {
        const objective = objectiveOf(c.draft);
        if (objective) replyObjectives.add(objectiveKey(objective));
        // A card claiming a level this passage cannot support is labelled for what it is (its words unchanged).
        if (levelPlan && capCardLevel(c.draft.answer, levelPlan.passage)) relabelled++;
        batch.push(c.draft); seen.add(stemKey(c.draft.stem));
      } else dropped.push(c.reason);
    }
    // true/false is kept balanced before it costs a blind check (formats.ts balanceTrueFalse).
    if (kind === "true_false") batch = balanceTrueFalse(batch, limit);
    if (batch.length && verifyOn && (REVISION_VERIFIED_KINDS.includes(kind) || isBlindFormat(kind))) {
      calls++; verifiedAny = true;
      // The same call shape for every format: the reader is given the passage and the items WITHOUT the key.
      const blind = REVISION_VERIFIED_KINDS.includes(kind) ? null : batch.map(d => blindItemOf(kind as Parameters<typeof blindItemOf>[0], d));
      const items: RevisionVerifyItem[] = blind ? [] : batch.map(d => ({ stem: d.stem, options: d.options, keyed: kind === "mrq" ? (d.answer.correct as number[]) : null }));
      const v = await run({
        system: blind ? BLIND_SOLVE_SYSTEM : REVISION_VERIFY_SYSTEM,
        user: blind ? blindSolvePrompt(verifyPassage, blind) : revisionVerificationPrompt(verifyPassage, items),
        tier: "reasoning",
        maxTokens: 600,
        context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_revision_${kind}_verify` },
      }, attempt === 1 ? "verify" : "retry-verify");
      if (!v.ok) { dropped.push(...batch.map(() => "verification_unavailable")); batch = []; }
      else {
        const outcome = blind ? applyBlindVerification(blind, v.text) : applyRevisionVerification(items, v.text);
        dropped.push(...outcome.rejected.map(() => "failed_verification"));
        batch = outcome.kept.map(i => batch[i]);
      }
    }
    kept = batch.slice(0, limit);
    // Only what survived every check counts as already tested (a draft the blind check dropped may be written again).
    for (const d of kept) { const o = objectiveOf(d); if (o) seenObjectives.add(objectiveKey(o)); }
  }
  return {
    ok: true as const, kept, dropped, model, provider, calls,
    // What is stored says whether a blind reader saw it: the version of the check that ran, or none (policy scholar_verify_formats).
    promptVersion: revisionPromptVersion(kind, !verifiedAny ? "none" : REVISION_VERIFIED_KINDS.includes(kind) ? "revision" : "blind"),
    levelPlan: levelPlan ? { levels: levelPlan.levels, fallback: levelPlan.fallback, relabelled } : null,
  };
}

// SCHOLAR-QUESTION-INTELLIGENCE-01 (evaluate v2): five labelled parts after the verdict (question-intel.ts
// FEEDBACK_FORMAT), judged against the rubric's key points and misconceptions where the question has them, clinically
// equivalent wording accepted, and NOT_IN_NOTES when it cannot judge reliably. No marks: the verdict is the mark.
export const EVALUATE_SYSTEM = [
  "You give formative feedback on a healthcare student's short answer to a revision question, for their own study.",
  "Judge the answer ONLY against the passage from their notes, the accepted answers and the key points given. Do not use outside knowledge.",
  "Judge understanding, not phrases. Accept an answer that says the same thing in other words, including clinically equivalent wording and equivalent reasoning. Do not reward an answer for things the passage does not say.",
  "'correct' means the understanding is there. 'partly' means some of it is there and something essential is missing. 'incorrect' means the reasoning is wrong or nothing essential is there.",
  "An answer that makes all the key points, in any words, is correct, and one that makes only some of them is partly correct. Where no key points are given, one accepted answer in any words is correct. Only what the accepted answers and key points require can be missing: never something else the passage also says.",
  "Your first line is exactly one of 'VERDICT: correct', 'VERDICT: partly' or 'VERDICT: incorrect'.",
  // SQIE-CLOSE-2026-11 WS-B (evaluate v3): the safety line, quoted from the answer.
  UNSAFE_RULE,
  FEEDBACK_FORMAT,
  "Where common misconceptions are listed, say whether the answer shows one. Never give a mark, a score or a percentage.",
  "No new facts, numbers, doses, drugs or advice. No patient names. If the passage does not let you judge reliably, reply with exactly NOT_IN_NOTES.",
].join("\n");

// SCHOLAR-SQIE-LEARNER-01: the same evaluator for an extended response, given the item's key points NUMBERED. It also says which of
// them the answer makes (a MATCHED line); the score is the share of key points matched (formats.ts extendedMarks), not a number
// the model wrote. Still formative, still labelled, still withheld when the passage cannot settle it.
export const EVALUATE_EXTENDED_SYSTEM = [
  EVALUATE_SYSTEM,
  "The KEY POINTS are numbered. After the VERDICT line add exactly one line 'MATCHED: ' followed by the numbers of the key points the answer makes (for example 'MATCHED: 1, 3'), or 'MATCHED: none'.",
  "A key point counts only if the answer says it, in any wording that means the same. Do not count a point the answer only hints at. This is a list of numbers, not a mark: still never give a mark, a score or a percentage.",
].join("\n");

export type EvaluateVerdict = "correct" | "partly" | "incorrect";
export type ShortAnswerEvaluation =
  | { ok: true; verdict: EvaluateVerdict; score: number; feedback: string; parts?: FeedbackParts; matched?: number[]; unsafe?: string[] }
  | { ok: false; reason: "malformed" | "not_in_notes" | "ungrounded" | "identifier" };
const VERDICT_SCORE: Record<EvaluateVerdict, number> = { correct: 1, partly: 0.5, incorrect: 0 };

// SQIE-CLOSE-2026-11 WS-B/WS-C: an answer marked against numbered weighted CRITERIA (a case rubric, a justify or interpret part) lists those
// it meets through the same MATCHED line an extended answer writes; code weighs them (scoring-rules.ts criteriaMarks).
export const EVALUATE_CRITERIA_VERSION = "scholar-evaluate-criteria-v1";

/**
 * Pure. The evaluator's reply, checked: a verdict, and feedback that adds nothing the grounding does not hold. The five
 * labelled parts where it wrote them (parts, and feedback as their readable text); the v1 free text otherwise.
 */
export function parseEvaluation(raw: string, grounding: readonly string[], opts: { keyPoints?: number; safety?: { answer: string } } = {}): ShortAnswerEvaluation {
  const text = raw.trim();
  if (text.replace(/[^A-Z_]/g, "") === NOT_IN_NOTES) return { ok: false, reason: "not_in_notes" };
  const m = /^\s*\**VERDICT:\s*(correct|partly|incorrect)\**\s*$/im.exec(text);
  if (!m) return { ok: false, reason: "malformed" };
  let rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  // An extended response: which numbered key points the answer makes. Required there, and taken out of the feedback text.
  let matched: number[] | undefined;
  if (opts.keyPoints) {
    const mm = /^\s*\**MATCHED\**\s*:\s*(.*)$/im.exec(rest);
    if (!mm) return { ok: false, reason: "malformed" };
    const nums = /^\s*(none|n\/a|-)?\s*\.?\s*$/i.test(mm[1]) ? [] : mm[1].split(/[^0-9]+/).filter(Boolean).map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 1 || n > opts.keyPoints!)) return { ok: false, reason: "malformed" };
    matched = [...new Set(nums.map(n => n - 1))].sort((a, b) => a - b);
    rest = (rest.slice(0, mm.index) + rest.slice(mm.index + mm[0].length)).trim();
  }
  // SQIE-CLOSE-2026-11 WS-B: the safety line (evaluate v3, case reasoning v3). Required where it was asked for (fail closed: a
  // reply that does not say whether the answer is unsafe is not used). Only statements quoted from the answer are kept.
  let unsafe: string[] | undefined;
  if (opts.safety) {
    const um = /^\s*\**UNSAFE\**\s*:\s*(.*)$/im.exec(rest);
    if (!um) return { ok: false, reason: "malformed" };
    unsafe = unsafeQuotes(um[1], opts.safety.answer);
    rest = (rest.slice(0, um.index) + rest.slice(um.index + um[0].length)).trim();
  }
  const body = rest;
  const sections = parseFeedbackSections(body);
  // Revise engine quality: a correct answer has nothing essential missing, so a line saying otherwise would contradict its own verdict. (An extended answer is scored by the key points it matched, so its list stays.)
  const judged = sections && !opts.keyPoints && m[1].toLowerCase() === "correct" ? { ...sections, missing: [] } : sections;
  const parts = judged && unsafe?.length ? { ...judged, unsafe } : judged;
  const feedback = parts ? feedbackText(parts) : unsafe?.length ? `${FEEDBACK_HEADINGS.unsafe}: ${unsafe.join("; ")}.\n${body}` : body;
  if (!feedback || feedback.length > (parts ? 2000 : 800)) return { ok: false, reason: "malformed" };
  if (findPatientIdentifiers(feedback).length) return { ok: false, reason: "identifier" };
  if (groundingViolations(feedback, [...grounding]).length) return { ok: false, reason: "ungrounded" };
  // SQIE-CLOSE-2026-11 WS-B, owner release decision 4 Nov 2026: an unsafe statement is a FLAG here (always detected, kept and shown); the
  // verdict stands as judged. What it does to the marks is the rules-v3 cap -- at most half of the applicable score, at the scope the rubric
  // defines -- applied by the caller (scoring-rules.ts) and only once HQ policy scholar_clinical_scoring_caps is on.
  const verdict = m[1].toLowerCase() as EvaluateVerdict;
  return { ok: true, verdict, score: VERDICT_SCORE[verdict], feedback, ...(parts ? { parts } : {}), ...(matched ? { matched } : {}), ...(unsafe?.length ? { unsafe } : {}) };
}

const flatWords = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Shown where the evaluator flagged the answer but quoted nothing it contains: the flag stands, the invented words do not. */
export const UNSAFE_UNQUOTED = "A statement in your answer";

/**
 * Pure. SQIE-CLOSE-2026-11 WS-B: the evaluator's UNSAFE line -> the statements to show, each one the answer's own words (normalised
 * match, at least three characters). "none" -> []. A flag whose quotes are not in the answer is kept as a flag (UNSAFE_UNQUOTED):
 * failing safe means the answer is still treated as unsafe, but no words the learner did not write are put in front of them.
 */
export function unsafeQuotes(line: string, answer: string): string[] {
  const body = line.trim().replace(/^["'\s]+|["'.\s]+$/g, "");
  if (!body || /^(none|nothing|n\/a|-)\.?$/i.test(body)) return [];
  const have = ` ${flatWords(answer)} `;
  const quotes = body.split(/\s*;\s*/).map(q => q.trim().replace(/^["'‘“]+|["'’”.]+$/g, "").trim()).filter(q => flatWords(q).length >= 3);
  const kept = [...new Set(quotes.filter(q => have.includes(` ${flatWords(q)} `)).map(q => q.slice(0, 300)))].slice(0, 3);
  return kept.length ? kept : [UNSAFE_UNQUOTED];
}

/**
 * AI evaluation of one short answer. `run` is the metered runner (activity `evaluate`); the caller screened the answer.
 * SQIE-CLOSE-2026-11 WS-B/WS-C: `numberedCriteria` marks the answer against weighted criteria through the same MATCHED line an extended
 * answer writes -- the marks are computed by code (scoring-rules.ts criteriaMarks). The UNSAFE line is evaluate v3's own.
 */
export async function runEvaluate(userId: string, input: { question: string; accepted: readonly string[]; answer: string; passage: Passage; rubric?: Rubric | null; numberedKeyPoints?: readonly string[]; numberedCriteria?: readonly Criterion[] }, run: AiRun = direct) {
  const rubric = input.rubric;
  const criteria = input.numberedCriteria?.length ? input.numberedCriteria : null;
  const numbered = !criteria && input.numberedKeyPoints?.length ? input.numberedKeyPoints : null;
  const r = await run({
    system: criteria ? [EVALUATE_SYSTEM, EVALUATE_CRITERIA_RULE].join("\n") : numbered ? EVALUATE_EXTENDED_SYSTEM : EVALUATE_SYSTEM,
    user: [
      `PASSAGE FROM MY NOTES (${passageCitation(input.passage)}):\n${input.passage.content}`,
      `QUESTION: ${input.question}\nACCEPTED ANSWERS: ${input.accepted.join(" | ")}`,
      criteria ? `CRITERIA (numbered):\n${criteria.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`
        : numbered ? `KEY POINTS (numbered):\n${numbered.map((k, i) => `${i + 1}. ${k}`).join("\n")}` : rubric?.keyPoints.length ? `KEY POINTS: ${rubric.keyPoints.join(" | ")}` : null,
      rubric?.misconceptions.length ? `COMMON MISCONCEPTIONS: ${rubric.misconceptions.join(" | ")}` : null,
      `MY ANSWER: ${input.answer}`,
    ].filter(Boolean).join("\n\n"),
    tier: "reasoning",
    maxTokens: 600,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_evaluate" },
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  const list = criteria ? criteria.map(c => c.text) : numbered;
  return { ok: true as const, model: r.model, provider: r.provider,
    promptVersion: numbered ? `${PROMPT_VERSIONS.evaluate}+${PROMPT_VERSIONS.evaluateExtended}` : criteria ? `${PROMPT_VERSIONS.evaluate}+${EVALUATE_CRITERIA_VERSION}` : PROMPT_VERSIONS.evaluate,
    evaluation: parseEvaluation(r.text, [input.passage.content, ...input.accepted, ...(list ?? rubric?.keyPoints ?? []), ...(rubric?.misconceptions ?? []), input.answer, input.question], { ...(list ? { keyPoints: list.length } : {}), safety: { answer: input.answer } }) };
}

// ── STAGE 5A (CR1-CR3): A PRIVATE CASE FROM THE STUDENT'S NOTES ── written as a draft, made a blueprint by code ──
//
// The model writes a small structured DRAFT -- stages, findings, decisions with their options and key, what may be
// asked for -- from the passages only. clinical.ts makes the blueprint (ids, linear progression, the boundary) and
// checks it: a valid private blueprint, nothing ungrounded, nothing identifying. If it fails, it is written again
// once with the reasons; if it fails again, nothing is stored.

export const CASE_BLUEPRINT_SYSTEM = [
  "You write ONE short, progressive clinical reasoning case for a healthcare student, for their own formative practice, from the PASSAGES of their own notes only.",
  "The case follows 'a patient' (no name, no age, no dates) through the stages the passages support: recognising the problem, interpreting findings, prioritising, deciding, and reassessing or escalating.",
  "RULES:",
  "1. Every finding, value, option, rationale and expected answer comes from the passages. Do not invent any finding, value, consequence or change in the patient. Never write a number the passages do not contain, and never count things ('two signs').",
  "   Do not use words that assert a state or a change -- improved, improving, worse, worsening, reduced, raised, increased, decreased, stable, unstable, normal, abnormal, resolved, deteriorating -- unless the passages use that exact word. Use the passages' own words for findings.",
  "2. Findings: label and value in the passages' own words. shown is 'start', a stage number, or 'request' (the student must ask for it).",
  "3. Two to four stages, each with exactly one decision (give each decision its own stage number). A decision is 'single' (one right option), 'multiple' (several right options) or 'free_text' (the student explains, and expectedResponse says what a good answer contains, from the passages -- REQUIRED for every free_text decision).",
  "4. Each option is built from the passages' words. Exactly one right option for 'single'. Give each decision a one or two sentence rationale in the passages' own words.",
  "5. canAskFor lists the refs of findings the student may ask for at that decision. sources lists the passage tags (S1, S2 ...) the decision rests on.",
  "6. dimension is one of: recognition, interpretation, prioritisation, decision, reassessment, escalation.",
  "7. If missing the right option would be unsafe in the passages' terms, set safety to one short sentence saying what must be done, in the passages' words.",
  "8. objectives: one or two learning objectives in the passages' words, each with the tags (C1 ...) of the competencies given that it serves, if any.",
  "9. Never include a name, NHS number, date of birth or any detail that could identify a real person.",
  "10. Keep it short: titles under ten words, no numbering in titles or prompts (the case numbers itself), rationales of one or two sentences.",
  "11. Optionally give a stage a category by writing it as {\"title\": \"...\", \"category\": \"...\"}. The categories, in the order a clinician usually meets them, are: presenting_complaint, history, assessment, investigations, interpretation, differentials, management, reflection. Use them in that order where the passages support it and clinically make sense; use only the ones that fit, skip the rest, and never force a stage into a category. A plain title is always fine.",
  "If the passages cannot support a case, reply {\"stages\": []}.",
  'Reply with JSON ONLY: {"title": "...", "intro": "the opening a student reads, from the passages", "stages": ["...", "..."], "facts": [{"ref": "F1", "kind": "observation", "label": "...", "value": "...", "shown": "start", "safetyCritical": false}], "decisions": [{"stage": 1, "prompt": "...", "kind": "single", "dimension": "recognition", "options": [{"text": "...", "correct": true}, {"text": "...", "correct": false}], "rationale": "...", "canAskFor": ["F2"], "sources": ["S1"], "safety": null}, {"stage": 2, "prompt": "...", "kind": "free_text", "dimension": "escalation", "options": [], "expectedResponse": "what a good answer contains, from the passages", "rationale": "...", "canAskFor": [], "sources": ["S1"], "safety": null}], "objectives": [{"text": "...", "competencies": ["C1"]}]}',
].join("\n");

const list0 = (v: unknown) => (Array.isArray(v) ? v.length : 0);

export function caseBlueprintPrompt(passages: readonly Passage[], competencies: readonly { title: string; outcomes?: string[] }[], context: string): string {
  const blocks = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`).join("\n\n");
  const comps = competencies.length ? `\n\nCOMPETENCIES these notes are linked to:\n${competencies.map((c, i) => `[C${i + 1}] ${c.title}${c.outcomes?.length ? ` -- ${c.outcomes.slice(0, 2).join("; ")}` : ""}`).join("\n")}` : "";
  return `CLINICAL CONTEXT: ${context}\n\nPASSAGES FROM MY NOTES:\n\n${blocks}${comps}`;
}

export const CASE_INTEGRATED_SUFFIX = "+connected-v1";
/** Pure. SCHOLAR-APPLY-CONNECTED-01: one patient, drawing several things studied together. The passages remain the only source of fact, under the same checks. */
export const integratedCaseLine = (areas: readonly string[]): string => `\n\nINTEGRATED PRACTICE. These passages come from different things I have studied (${areas.slice(0, 6).join("; ")}). Write ONE patient's unfolding case that needs at least two of them together. Ask me to recognise, interpret, prioritise, decide, communicate and reassess, rather than recall a fact. Every fact still comes only from the passages. If they cannot make one coherent patient, use the ones that can.`;

/** One private case from some passages: drafted, made a blueprint and checked, with one retry on its reasons. */
export async function runCaseBlueprint(userId: string, input: {
  passages: Passage[]; competencies: { id: string; title: string; outcomes?: string[] }[]; context: string; dimensions: readonly string[]; asked?: string | null;
  /** SCHOLAR-APPLY-CONNECTED-01: the areas of the learner's studied learning this one case should bring together. */
  integrated?: readonly string[] | null;
}, run: AiRun = direct) {
  let feedback = "";
  let model = "", provider = "";
  const problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await run({
      system: CASE_BLUEPRINT_SYSTEM,
      user: caseBlueprintPrompt(input.passages, input.competencies, input.context) + (input.integrated?.length ? integratedCaseLine(input.integrated) : "") + (feedback ? `\n\nA previous attempt was rejected for: ${feedback}. Write the case again without these problems.` : ""),
      tier: "reasoning",
      maxTokens: 4000,
      context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_blueprint" },
    }, attempt === 1 ? "main" : "retry");
    if (!r.ok) return { ok: false as const, error: r.error };
    model = r.model; provider = r.provider;
    const raw = (() => { const s = r.text.replace(/```(?:json)?/gi, "").trim(); const a = s.indexOf("{"), b = s.lastIndexOf("}"); try { return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null; } catch { return null; } })();
    if (!raw) { problems.push(`malformed:json (${r.text.length} chars)`); feedback = "the reply was not valid JSON -- reply with the JSON object only, and keep it short"; continue; }
    // SCHOLAR-AI-OPT-01: the prompt's own answer for passages that cannot support a case is {"stages": []}. That is the
    // model saying the notes are not enough, not a malformed reply, so it is not asked again (a retry told "the case
    // needs two to four stages" only presses it to invent). Nothing is stored, exactly as for any withheld case.
    if (Array.isArray(raw.stages) && raw.stages.length === 0) {
      problems.push("source_insufficient:declared by the model");
      return { ok: true as const, blueprint: null, model, provider, promptVersion: PROMPT_VERSIONS.caseBlueprint, problems, attempts: attempt, declaredInsufficient: true };
    }
    const blueprint = blueprintFromDraft(raw, { passages: input.passages, competencies: input.competencies, dimensions: input.dimensions });
    if (!blueprint) { problems.push(`malformed:shape (${list0(raw.stages)} stages, ${list0(raw.decisions)} decisions)`); feedback = "the case needs two to four stages, each with one decision with its options"; continue; }
    const found = checkPrivateCase(blueprint, [...input.passages.map(p => p.content), input.asked ?? ""], input.dimensions);
    if (!found.length) return { ok: true as const, blueprint, model, provider, promptVersion: PROMPT_VERSIONS.caseBlueprint, problems, attempts: attempt, declaredInsufficient: false };
    problems.push(...found.map(f => `${f.kind}:${f.detail.slice(0, 80)}`));
    feedback = [...new Set(found.map(f => `${f.kind}${f.detail ? ` (${f.detail})` : ""}`))].slice(0, 6).join("; ");
  }
  return { ok: true as const, blueprint: null, model, provider, promptVersion: PROMPT_VERSIONS.caseBlueprint, problems, attempts: 2, declaredInsufficient: false };
}

export const CASE_REASONING_SYSTEM = [
  "You give formative feedback on a healthcare student's written reasoning in a practice case from their own notes.",
  "Judge the answer ONLY against the expected answer and the case facts and passages given. Do not use outside knowledge.",
  "Accept reasoning that says the same thing in other words, including clinically equivalent wording.",
  "Your first line is exactly one of 'VERDICT: correct', 'VERDICT: partly' or 'VERDICT: incorrect'.",
  // SQIE-CLOSE-2026-11 WS-B (case reasoning v3): the same safety line as evaluate v3.
  UNSAFE_RULE,
  // SCHOLAR-QUESTION-INTELLIGENCE-01 (case reasoning v2): the same five parts as a revision answer's feedback.
  FEEDBACK_FORMAT.replace("the passage's own words", "the passages' own words"),
  "Never give a mark, a score or a percentage.",
  "No new facts, numbers, doses, drugs or advice. No patient names. If the material does not let you judge reliably, reply with exactly NOT_IN_NOTES.",
].join("\n");

/**
 * AI feedback on one written decision (activity `evaluate`). Checked like any evaluation; labelled where shown.
 * SQIE-CLOSE-2026-11: the UNSAFE line is case reasoning v3's own (WS-B). Where the decision has weighted rubric criteria they are numbered
 * and the reply lists those met (MATCHED), so code computes the weighted marks (WS-B case criteria, WS-C a reason).
 */
export async function runCaseReasoning(userId: string, input: { prompt: string; expected: string; facts: string[]; answer: string; passages: Passage[]; criteria?: readonly Criterion[] | null }, run: AiRun = direct) {
  const criteria = input.criteria?.length ? input.criteria : null;
  const r = await run({
    system: criteria ? [CASE_REASONING_SYSTEM, EVALUATE_CRITERIA_RULE].join("\n") : CASE_REASONING_SYSTEM,
    user: `CASE FACTS:\n${input.facts.join("\n")}\n\nPASSAGES:\n${input.passages.map((p, i) => `[${passageTag(i)}] ${p.content}`).join("\n\n")}\n\nDECISION: ${input.prompt}\nEXPECTED ANSWER: ${input.expected}${criteria ? `\nCRITERIA (numbered):\n${criteria.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}` : ""}\nMY ANSWER: ${input.answer}`,
    tier: "reasoning",
    maxTokens: 500,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_reasoning" },
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  return { ok: true as const, model: r.model, provider: r.provider, promptVersion: `${PROMPT_VERSIONS.caseReasoning}${criteria ? `+${EVALUATE_CRITERIA_VERSION}` : ""}`,
    evaluation: parseEvaluation(r.text, [...input.passages.map(p => p.content), input.expected, ...input.facts, ...(criteria ?? []).map(c => c.text), input.answer, input.prompt], { ...(criteria ? { keyPoints: criteria.length } : {}), safety: { answer: input.answer } }) };
}

/** S2 framing for the Holdings mapping engine. It names no profession: the programme's catalogue does that. */
export const SCHOLAR_MAPPING_FRAMING: MappingFraming = { person: "a healthcare student", subjects: "sections of their own study notes" };

/**
 * S2: concepts and PROPOSED competency mappings for a few sections at once, through the Holdings engine
 * (src/lib/competency/mapping.ts). The model sees tags, never ids. Person attribution, the Scholar operation,
 * and Scholar's patient-identifier screen.
 */
export async function runAnalysis(userId: string, sections: MappingSubject[], competencies: CatalogueCompetency[], run: AiRun = direct) {
  return proposeMappings({
    run: g => run(g),
    subjects: sections,
    candidates: competencies.map(c => ({ competencyId: c.id, layer: c.layer, code: c.code, title: c.title, outcomes: c.outcomes, context: structureLabel(c) })),
    framing: SCHOLAR_MAPPING_FRAMING,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_map" },
    screen: findPatientIdentifiers,
    // UPLOAD-01 U3: Domain > CPU > Competency > Learning Outcome -- the engine may name the outcome a section supports.
    outcomes: true,
  });
}

// ── S4: A MULTI-STEP PRACTICE CASE FROM ONE PASSAGE ── COMPETEN-SCHOLAR-01 ──────────────────────────────
//
// Several linked questions that follow one scenario. Each step is held to EVERY rule a single question is
// (checkQuestions, the quality layer, the blind verification), so a step that fails is dropped exactly as
// a question would be. A case with fewer than CASE_MIN_STEPS surviving steps is not stored at all. The
// title is checked against the passage too. Educational and unreviewed, and labelled so where it is shown
// (PERSONAL_CASE_LABEL, AI_LABEL).

export const CASE_SYSTEM = [
  "You write ONE short multi-step practice case for a healthcare student, from ONE passage of their own study notes.",
  "The case follows 'a patient' (no name, no age, no dates, no numbers unless the passage gives them) through the steps the passage supports, for example recognising the problem, assessing, prioritising, acting and evaluating.",
  "Move the scenario on only with words the passage uses. Never use the words again, improved, improving, worsened, worsening, stable, resolved or unchanged unless the passage itself uses them: they assert a change the passage does not describe.",
  `Write a short title (under 80 characters, no names) and between ${CASE_MIN_STEPS} and ${CASE_MAX_STEPS} steps, in order. Each step is one multiple-choice question that moves the scenario on and asks the student to APPLY the passage.`,
  `A step may only describe what the passage itself mentions. If the passage cannot support ${CASE_MIN_STEPS} steps, reply {"title": "", "steps": []}.`,
  "",
  ...QUESTION_RULES.slice(0, -2),
  "",
  'Reply with JSON ONLY, no prose and no code fence: {"title": "...", "steps": [{"stem": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "rationale": "...", "sourceQuote": "..."}]}',
].join("\n");

export const CASE_FALLBACK_TITLE = "Practice case";

/** Pure. The model's case object → its title and the raw steps, or null when it is not one. */
export function parseCase(raw: string): { title: string; steps: unknown[] } | null {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    if (!v || typeof v !== "object" || !Array.isArray(v.steps)) return null;
    return { title: typeof v.title === "string" ? v.title : "", steps: v.steps };
  } catch {
    return null;
  }
}

/** Pure. A title that adds nothing the passage lacks and identifies nobody, or the neutral fallback. */
export function checkCaseTitle(title: string, passage: Passage): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t || t.length > 120 || findPatientIdentifiers(t).length || groundingViolations(t, [passage.content]).length) return CASE_FALLBACK_TITLE;
  return t;
}

export async function runCase(userId: string, passage: Passage, run: AiRun = direct, opts: { verifyFormats?: readonly string[] } = {}) {
  // SCHOLAR-SQIE-LEARNER-01 (policy scholar_verify_formats): whether the case's steps are blind-checked. Absent: they always were.
  const verifyOn = (opts.verifyFormats ?? VERIFY_DEFAULT).includes("case");
  const dropped: QuestionCheck["dropped"] = [];
  let steps: DraftQuestion[] = [];
  let title = CASE_FALLBACK_TITLE;
  let model = "", provider = "";
  let attempts = 0;
  let feedback = "";
  let declaredInsufficient = false;
  while (attempts < 2 && steps.length < CASE_MIN_STEPS && !declaredInsufficient) {
    attempts++;
    const r = await run({
      system: CASE_SYSTEM,
      user: questionUserPrompt(passage) + (feedback ? `\n\nA previous attempt was rejected for: ${feedback}. Write a new case that avoids these problems.` : ""),
      tier: "reasoning",
      maxTokens: 2200,
      context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_steps" },
    }, attempts === 1 ? "main" : "retry");
    if (!r.ok) return { ok: false, error: r.error } as AiFailure;
    model = r.model; provider = r.provider;
    const parsed = parseCase(r.text);
    if (!parsed) { dropped.push({ reason: "malformed" }); feedback = "malformed"; continue; }
    // SCHOLAR-AI-OPT-01: {"steps": []} is CASE_SYSTEM's own answer for a passage that cannot support the steps. It is
    // the model saying the notes are not enough, so the same passage is not sent again.
    if (!parsed.steps.length) { declaredInsufficient = true; break; }
    const check = checkQuestions(JSON.stringify(parsed.steps), passage, CASE_MAX_STEPS, CASE_MAX_STEPS);
    dropped.push(...check.dropped);
    if (check.kept.length >= CASE_MIN_STEPS && !verifyOn) {
      steps = check.kept; title = checkCaseTitle(parsed.title, passage);
    } else if (check.kept.length >= CASE_MIN_STEPS) {
      const v = await run({
        system: VERIFY_SYSTEM,
        user: verificationPrompt(passage.content, check.kept),
        tier: "reasoning",
        maxTokens: 700,
        context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_steps_verify" },
      }, attempts === 1 ? "verify" : "retry-verify");
      if (!v.ok) {
        dropped.push(...check.kept.map(() => ({ reason: "verification_unavailable" as const })));
      } else {
        const verified = applyVerification(check.kept, v.text);
        dropped.push(...verified.rejected.map(x => ({ reason: "failed_verification" as const, detail: x.detail })));
        if (verified.kept.length >= CASE_MIN_STEPS) { steps = verified.kept; title = checkCaseTitle(parsed.title, passage); }
      }
    } else if (check.kept.length) {
      dropped.push({ reason: "malformed", detail: `only ${check.kept.length} step survived` });
    }
    feedback = [...new Set(dropped.map(d => d.detail ? `${d.reason} (${d.detail})` : d.reason))].slice(0, 6).join("; ");
  }
  return {
    ok: true as const, title, steps, dropped, model, provider, attempts, declaredInsufficient,
    promptVersion: `${PROMPT_VERSIONS.caseSteps}+${PROMPT_VERSIONS.verify}`,
  };
}

/**
 * Owner review P0.1: generate, check every part of every question, then have a second, blind reader confirm
 * that the passage supports exactly the keyed option. If nothing survives, regenerate ONCE on the same
 * provider, telling it what was rejected. A grounding failure is never sent to another vendor (client.ts).
 */
export async function runQuestions(userId: string, kind: QuestionKind, passage: Passage, limit: number = QUESTIONS_PER_REQUEST, run: AiRun = direct, opts: GenerationOptions = {}) {
  const dropped: QuestionCheck["dropped"] = [];
  let kept: DraftQuestion[] = [];
  let model = "", provider = "";
  let attempts = 0, calls = 0;
  let feedback = "";
  let declaredInsufficient = false;
  // SCHOLAR-QUESTION-INTELLIGENCE-01: the guidance block (concepts, competency, level, difficulty, count). Notes only:
  // an mcq or case question cannot record a reference, so none is ever offered here (checkQuestions).
  if (opts.context) opts = { ...opts, context: { ...opts.context, mode: "notes", references: [] } };
  // SCHOLAR-SQIE-LEARNER-01 (policy scholar_verify_formats): whether this format is blind-checked. Absent: it always was.
  const verifyOn = (opts.verifyFormats ?? VERIFY_DEFAULT).includes(kind);
  const guidance = generationContextBlock(opts.context ?? NO_CONTEXT, opts.context ? limit : null);
  while (attempts < 2 && kept.length === 0 && !declaredInsufficient) {
    attempts++;
    calls++;
    const r = await run({
      system: QUESTION_SYSTEM[kind],
      user: questionUserPrompt(passage) + guidance + (feedback ? `

A previous attempt was rejected for: ${feedback}. Write new questions that avoid these problems.` : ""),
      tier: "reasoning",
      maxTokens: 1800,
      context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_${kind}` },
    }, attempts === 1 ? "main" : "retry");
    if (!r.ok) return { ok: false, error: r.error } as AiFailure;
    model = r.model; provider = r.provider;
    const check = checkQuestions(r.text, passage, limit, QUESTIONS_PER_REQUEST, opts);
    // SCHOLAR-AI-OPT-01: for case questions, [] is the prompt's own answer for a passage that cannot support a scenario
    // (QUESTION_SYSTEM.case). Not asked again. Multiple-choice questions keep their one retry: [] is not defined there.
    if (kind === "case" && parseJsonArray(r.text)?.length === 0) { declaredInsufficient = true; break; }
    dropped.push(...check.dropped);
    if (check.kept.length && !verifyOn) {
      // Switched off by policy (scholar_verify_formats): stored on its deterministic checks alone.
      kept = check.kept;
    } else if (check.kept.length) {
      calls++;
      const v = await run({
        system: VERIFY_SYSTEM,
        user: verificationPrompt(passage.content, check.kept),
        tier: "reasoning",
        maxTokens: 600,
        context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_${kind}_verify` },
      }, attempts === 1 ? "verify" : "retry-verify");
      if (!v.ok) {
        // Unverifiable is not verified: nothing from this attempt is stored.
        dropped.push(...check.kept.map(() => ({ reason: "verification_unavailable" as const })));
      } else {
        const outcome = applyVerification(check.kept, v.text);
        kept = outcome.kept;
        dropped.push(...outcome.rejected.map(x => ({ reason: "failed_verification" as const, detail: x.detail })));
      }
    }
    feedback = [...new Set(dropped.map(d => d.detail ? `${d.reason} (${d.detail})` : d.reason))].slice(0, 6).join("; ");
  }
  return {
    ok: true as const, check: { kept, dropped }, model, provider, attempts, calls, declaredInsufficient,
    // The version names the prompt and its check as the routes look stored questions up by it (unansweredQuestions): a format
    // switched off by policy keeps it, and is told apart by its rows' own dropped reasons and the audit row.
    promptVersion: `${PROMPT_VERSIONS[kind]}+${PROMPT_VERSIONS.verify}`,
  };
}

// ── OSCE PRACTICE (SCHOLAR-PRACTICE-EXAMS-01, migration 720) ── the two calls, on this engine ──────────────────────
//
// A station from the learner's own passages (activity `questions`) and feedback on a run (activity `evaluate`). The
// prompts and checks are osce.ts, pure: checkOsceDraft quotes every item from its passage and runs the Holdings grounding
// check and findPatientIdentifiers, and parseOsceFeedback does the same for the feedback. A station that fails is
// withheld (not retried: a grounding failure is an answer, not an outage), and feedback that fails is not shown.

/** One OSCE practice station written from these passages, checked. `check` null: the call failed. */
export async function runOsceStation(userId: string, input: { passages: Passage[]; min: number; max: number }, run: AiRun = direct) {
  const passages: OscePassage[] = input.passages.map(p => ({ chunkId: p.chunkId, content: p.content, citation: passageCitation(p) }));
  const r = await run({
    system: osceStationSystem(input.min, input.max),
    user: osceStationPrompt(passages),
    tier: "reasoning",
    maxTokens: 2500,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_osce_station" },
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  return {
    ok: true as const, model: r.model, provider: r.provider, promptVersion: OSCE_PROMPT_VERSIONS.station,
    check: checkOsceDraft(r.text, passages, { min: input.min, max: input.max }, groundingViolations, findPatientIdentifiers),
  };
}

/** AI feedback on one finished run: suggested ticks and the six parts, checked against the station, its guidance and what was written. */
export async function runOsceFeedback(userId: string, input: { scenario: string; candidateInstructions: string; checklist: OsceItem[]; responses: Record<string, string>; guidance?: OsceGuidance | null; expectedActivities?: string[] }, run: AiRun = direct) {
  const r = await run({
    system: OSCE_FEEDBACK_SYSTEM,
    user: osceFeedbackPrompt(input, input.responses),
    tier: "reasoning",
    maxTokens: 1200,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_osce_feedback" },
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  // D1 (staging acceptance, 31 Oct 2026): feedback has its own grounding check (osce.ts feedbackGroundingCheck): the
  // Holdings check with three closed excusals for words that describe the writing, not a patient.
  return {
    ok: true as const, model: r.model, provider: r.provider, promptVersion: OSCE_PROMPT_VERSIONS.feedback,
    feedback: parseOsceFeedback(r.text, input.checklist, feedbackGroundingText(input), feedbackGroundingCheck(groundingViolations), findPatientIdentifiers),
  };
}
