import { generate, type GenerateArgs, type GenerateResult } from "@/lib/ai/client";
import { parseJsonArray, textGroundingViolations, type PhrasingViolation } from "@/lib/ai/grounding";
import { proposeMappings, type MappingFraming, type MappingSubject } from "@/lib/competency/mapping";
import { CONTEXT_PREAMBLE } from "./learner-context";
import { CASE_MAX_STEPS, CASE_MIN_STEPS, PROMPT_VERSIONS, QUESTIONS_PER_REQUEST, type CheckVerdict, type ExplanationDepth, type LearnAction } from "./config";
import { citeChunk, findPatientIdentifiers } from "./extract";
import { structureLabel, type CatalogueCompetency } from "./catalogue";
import {
  REVISION_VERIFY_SYSTEM, VERIFY_SYSTEM, applyRevisionVerification, applyVerification, passageVocabulary, qualityProblems, revisionVerificationPrompt, verificationPrompt,
  type QualityReason, type RevisionVerifyItem,
} from "./question-quality";
import {
  FEEDBACK_FORMAT, NO_CONTEXT, RUBRIC_RULE, difficultyFits, difficultyOf, feedbackText, generationContextBlock, parseFeedbackSections, parseRubric, referenceGrounding, stemKey,
  type FeedbackParts, type GenerationContext, type Rubric,
} from "./question-intel";
import { checkRevisionDraft, type RevisionDraft } from "./revision";
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
  | { ok: true; text: string; cited: number[] }
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
export function checkBackgroundText(text: string): SupplementaryCheck {
  const t = text.trim();
  if (t.length > 900) return { ok: false, reason: "too_long" };
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
  "5. rationale explains in one or two sentences why the correct option is right, in the passage's own terms.",
  "6. Never include a name, NHS number, date of birth or any detail that could identify a real person.",
  "",
  'Reply with JSON ONLY, no prose and no code fence: [{"stem": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "rationale": "...", "sourceQuote": "...", "level": "understanding", "objective": "...", "keyPoints": ["..."], "misconceptions": ["..."], "references": []}]',
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

/** What a generator is checked against besides its passage (question-intel.ts). Optional throughout. */
export type GenerationOptions = { context?: GenerationContext; existing?: ReadonlySet<string> };

export function questionUserPrompt(passage: Passage): string {
  return `PASSAGE (${passageCitation(passage)}):\n${passage.content}\n\n`
    + "OPTION VOCABULARY. Every option, right or wrong, may use only these content words (plus small words like 'the', 'by', 'of'), "
    + `in any order or form: ${passageVocabulary(passage.content).join(", ")}`;
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();


export type DropReason = "malformed" | "quote_not_in_passage" | "ungrounded" | QualityReason | "failed_verification" | "verification_unavailable" | "repeat" | "off_difficulty";

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
    seen.add(key);
    out.kept.push({ ...draft, difficulty, rubric: parseRubric(q, [passage.content], { expectedAnswer: options[ci], difficulty }) });
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
const BACKGROUND_ACTIONS: readonly LearnAction[] = ["teach", "deeper", "examples"];
/** COMPETEN-RESEARCH-01: the actions that may carry a research part. A check question and a clarification never do. */
export const RESEARCH_ACTIONS: readonly (LearnAction | "check" | "clarify")[] = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask"];

const LEARN_INSTRUCTION: Record<LearnAction | "check" | "clarify", string> = {
  teach: "MODE: TEACH ME, one step of a guided lesson. First INTRODUCE the idea of these passages in one or two sentences: what it is and why it matters, from the passages. Then EXPLAIN it clearly, building from simple to more detailed, citing as you go. Teach, do not just list.",
  explain: "MODE: EXPLAIN THIS. Explain the passages clearly, as a good tutor would, citing as you go.",
  simplify: "MODE: SIMPLIFY. Explain as simply as you can, for someone meeting the topic for the first time: short sentences and everyday words. Keep every technical term exactly and say what it means using the passages. Keep the passages' own names for things -- write 'the right and left main bronchi', never 'two tubes': simpler words, never a count instead of the names. Notes only.",
  deeper: "MODE: GO DEEPER. Explain how the ideas in the passages connect, the reasoning and mechanisms behind them, and what a student should understand rather than memorise, citing as you go. If a point is not in the passages, it does not belong here.",
  examples: "MODE: GIVE EXAMPLES. Give up to three short practical situations that show the ideas of the passages at work, each one or two sentences about 'a patient' or 'the person caring for them', using ONLY what the passages say: their signs, actions and reasons. Cite the passage each example rests on. No names, ages, numbers, drugs or findings the passages do not contain.",
  summary: "MODE: SUMMARISE. List the important learning points of the passages, each line starting '- ' and ending with its citation. Notes only.",
  ask: "MODE: ASK SCHOLAR. Answer the student's question from the passages, citing as you go. If they do not answer it, reply with exactly NOT_IN_NOTES.",
  check: "MODE: CHECK UNDERSTANDING. Write ONE short open question that checks whether the student understood the main idea of the passages -- a question they could answer in a sentence or two from the passages, asking them to explain, not to recall a number. Never ask how many of anything. Reply with exactly one line: 'QUESTION: ' followed by the question. Nothing else.",
  clarify: "MODE: CLARIFY. You asked the student a check question and they answered. Judge their answer ONLY against the passages. Your first line is exactly one of 'VERDICT: understood', 'VERDICT: partly' or 'VERDICT: not_yet'. Then, briefly and kindly: say what they got right, then correct or complete it from the passages, citing as you go. Do not judge anything the passages do not cover.",
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

/** The system prompt for one learning action: EXPLAIN_SYSTEM's rules, the action, the depth, and what may follow. */
export function learnSystem(action: LearnAction | "check" | "clarify", opts: { depth: ExplanationDepth; background: boolean; references: boolean; research?: boolean }): string {
  const parts = [EXPLAIN_SYSTEM, "", LEARN_INSTRUCTION[action]];
  if (action !== "check") parts.push(`Keep the part from the notes under ${DEPTH_WORDS[opts.depth]} words${opts.depth === "brief" ? ", and keep it short" : ""}.`);
  // v2: the staging journey saw Simplify withheld twice for "two" -- a count the notes did not contain. Said last,
  // where it is read just before writing.
  if (action !== "check") parts.push("LAST, before you reply: if any sentence says how many of something there are (two, three, both, a couple, a few), rewrite it without the count, unless the passages themselves give that number.");
  if (opts.references && action !== "check")
    parts.push("GOVERNED REFERENCES, tagged [R1], [R2] ...: competencies and learning outcomes from the student's programme catalogue that these passages are linked to. You may cite one as [R n] only to say what the student is working towards. Never use them as a source of clinical facts.");
  if (opts.background && BACKGROUND_ACTIONS.includes(action as LearnAction))
    parts.push(`Optional: general background that is NOT in the passages, after a line that reads exactly ${SUPPLEMENTARY_MARKER} -- under 100 words, general principles only, with no numbers, units, doses, drug names, values or thresholds, no citation tags, and no advice about any patient.`);
  if (action !== "check")
    parts.push(`Optional, last: if a passage says something that contradicts another passage, or that looks unclear, outdated or possibly unsafe to act on, add a line that reads exactly ${FLAG_MARKER} and then one line per concern starting '- ', citing the passage concerned. Do not correct it with outside facts: say only what to check, against their course materials or with a supervisor. Leave this out when there is nothing to flag.`);
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

export function learnUserPrompt(question: string, passages: Passage[], references: GovernedReference[], history: TutorTurn[], learnerContext: string | null, research: readonly ResearchEvidence[] = []): string {
  const about = learnerContext ? `${CONTEXT_PREAMBLE}\n${learnerContext}\n\n` : "";
  const blocks = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`);
  const refs = references.length ? `\n\nGOVERNED REFERENCES:\n${references.map((r, i) => `[R${i + 1}] ${r.code ? `${r.code} ` : ""}${r.title}${r.outcome ? ` -- outcome: ${r.outcome}` : ""} (${r.status})`).join("\n")}` : "";
  const ext = research.length ? `\n\nEXTERNAL RESEARCH (published abstracts, not my notes):\n\n${research.map((e, i) => `[E${i + 1}] ${e.title}${e.journal ? `. ${e.journal}` : ""}${e.year ? ` (${e.year})` : ""}\nAbstract: ${e.abstract}`).join("\n\n")}` : "";
  const convo = history.length ? `\n\nOUR CONVERSATION SO FAR:\n\n${history.map(t => `${t.speaker === "tutor" ? "SCHOLAR" : "STUDENT"}: ${t.text}`).join("\n\n")}` : "";
  const both = research.length ? `\n\n(Research & Explain: part one from my notes, then ${RESEARCH_MARKER} and part two from the research, cited [E n].)` : "";
  return `${about}PASSAGES FROM MY NOTES:\n\n${blocks.join("\n\n")}${refs}${ext}${convo}\n\n${history.length ? "MY REPLY" : "MY REQUEST"}: ${question}${both}`;
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
  const prose = text.replace(/\[[SR]\d+\]/g, " ");
  const grounding = [...passages.map(p => `${passageCitation(p)}\n${p.content}`), ...references.map(x => `${x.code ?? ""} ${x.title} ${x.outcome ?? ""}`), asked];
  const violations = groundingViolations(prose, grounding);
  if (violations.length) return { ok: false, reason: "ungrounded", violations };
  return { ok: true, text, cited: [...new Set(s)].sort((a, b) => a - b) };
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

export const learnPromptVersion = (action: LearnAction | "check" | "clarify") => `${PROMPT_VERSIONS.learn}:${action}`;

export type LearnResult = AiFailure | {
  ok: true; action: LearnAction | "check" | "clarify"; model: string; provider: string; promptVersion: string;
  check: ExplainCheck; background: SupplementaryCheck | null; flags: { kept: LearnFlag[]; dropped: number };
  verdict: CheckVerdict | null; question: CheckQuestionResult | null;
  /** COMPETEN-RESEARCH-01: the research part, checked; null when no research was given or none was written. */
  research: ResearchCheck | null;
};

/** COMPETEN-RESEARCH-01: a Research & Explain answer carries its own prompt version, so a saved one is never reused as notes-only. */
export const RESEARCH_PROMPT_SUFFIX = "+research-v2";
export const learnResearchPromptVersion = (action: LearnAction | "check" | "clarify") => `${learnPromptVersion(action)}${RESEARCH_PROMPT_SUFFIX}`;
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
}, run: AiRun = direct): Promise<LearnResult> {
  const research = args.research?.length && RESEARCH_ACTIONS.includes(args.action) ? args.research : [];
  const r = await run({
    system: learnSystem(args.action, { depth: args.depth, background: args.background, references: args.references.length > 0, research: research.length > 0 }),
    user: learnUserPrompt(args.question, args.passages, args.references, args.history, args.learnerContext, research),
    tier: "reasoning",
    maxTokens: args.action === "check" ? 200 : (args.depth === "detailed" ? 1100 : 800) + (research.length ? 500 : 0),
    context: { userId, attribution: { scope: "person" }, operation: research.length ? LEARN_RESEARCH_OPERATION : "individual_scholar_learn" },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const base = { ok: true as const, action: args.action, model: r.model, provider: r.provider, promptVersion: research.length ? learnResearchPromptVersion(args.action) : learnPromptVersion(args.action) };
  if (args.action === "check") {
    const question = checkCheckQuestion(r.text, args.passages);
    return { ...base, check: { ok: false, reason: "not_in_notes" }, background: null, flags: { kept: [], dropped: 0 }, verdict: null, question, research: null };
  }
  const { verdict, rest } = args.action === "clarify" ? parseVerdict(r.text) : { verdict: null, rest: r.text };
  const split = splitLearnAnswer(rest);
  const asked = [args.question, ...args.history.map(t => t.text)].join("\n");
  const mayBackground = args.background && BACKGROUND_ACTIONS.includes(args.action as LearnAction);
  return {
    ...base,
    check: checkLearnMain(split.main, asked, args.passages, args.references),
    background: split.background === null ? null : mayBackground ? checkBackgroundText(split.background) : { ok: false, reason: "not_this_mode" },
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
export const REVISION_SYSTEM: Record<"mrq" | "short" | "flashcard" | "match" | "sequence" | "structured", string> = {
  mrq: [...REVISION_COMMON, 'Each item: {"stem": "a question ending with ? that says to choose all that apply", "options": [4 to 6 short options built only from the passage\'s words, each a plausible answer, never "all of the above"], "correct": [the indexes of EVERY option the passage supports, at least one and not all], "rationale": "...", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}'].join("\n"),
  short: [...REVISION_COMMON, 'Each item: {"stem": "a question ending with ? whose answer is a few words from the passage", "accepted": [1 to 4 short answers the passage supports, in its own words], "rationale": "...", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}'].join("\n"),
  flashcard: [...REVISION_COMMON, 'Each item: {"front": "a short question ending with ?, or a single term (a few words) to recall -- never a sentence or a statement", "back": "its answer or meaning, in the passage\'s words", "sourceQuote": "...", "difficulty": 1, "level": "recall", "objective": "...", "keyPoints": ["..."], "misconceptions": [], "references": []}'].join("\n"),
  match: [...REVISION_COMMON, 'Each item: {"stem": "what to match, e.g. Match each term to its meaning", "pairs": [{"left": "...", "right": "..."}, {"left": "...", "right": "..."}, {"left": "...", "right": "..."}], "rationale": "...", "sourceQuote": "...", "difficulty": 1}. Three to six pairs, each stated by the passage, every left and every right different. Only write one when the passage states at least three such pairs.'].join("\n"),
  sequence: [...REVISION_COMMON, 'Each item: {"stem": "what to put in order, ending with ?", "steps": [3 to 6 steps IN THE ORDER THE PASSAGE GIVES THEM], "rationale": "...", "sourceQuote": "...", "difficulty": 1}. Only write one when the passage itself gives an order.'].join("\n"),
  // SCHOLAR-SQIE-CLOSE-01 (structured v1, migration 710): a lead-in and two to four parts, each its own question with
  // whole practice marks and its own rubric. Marked part by part by code or by the evaluator (activity evaluate).
  structured: [...REVISION_COMMON,
    'Each item: {"stem": "a short lead-in from the passage that sets up the parts (a statement is allowed here)", "parts": [{"prompt": "part (a): a question ending with ?", "marks": 1, "accepted": [1 to 4 short answers the passage supports, in its own words], "keyPoints": ["..."], "misconceptions": []}, {"prompt": "part (b): a different question ending with ?", "marks": 2, "accepted": ["..."], "keyPoints": ["..."], "misconceptions": []}], "rationale": "...", "sourceQuote": "...", "difficulty": 2, "level": "understanding", "objective": "...", "references": []}.',
    "Two to four parts. Each part asks something DIFFERENT that the passage answers, building from recall to understanding or application where the passage allows. marks is a whole number from 1 to 5: more for a part that needs more of the passage. Write at most one item.",
  ].join("\n"),
};

/** The revision kinds the blind check fits (question-quality.ts REVISION_VERIFY_SYSTEM). */
export const REVISION_VERIFIED_KINDS: readonly (keyof typeof REVISION_SYSTEM)[] = ["mrq", "short"];
export const revisionPromptVersion = (kind: keyof typeof REVISION_SYSTEM) =>
  kind === "structured" ? PROMPT_VERSIONS.structured
    : `${PROMPT_VERSIONS.revision}:${kind}${REVISION_VERIFIED_KINDS.includes(kind) ? `+${PROMPT_VERSIONS.verifyRevision}` : ""}`;
/** The prompt version prefix a stored question of a format was written at: what "already written at this version" reads. */
export const formatPromptVersion = (kind: string): string =>
  kind === "mcq" ? PROMPT_VERSIONS.mcq : kind === "structured" ? PROMPT_VERSIONS.structured : `${PROMPT_VERSIONS.revision}:${kind}`;

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
  for (let attempt = 1; attempt <= 2 && !kept.length; attempt++) {
    calls++;
    const r = await run({
      system: REVISION_SYSTEM[kind],
      user: `${questionUserPrompt(passage)}${generationContextBlock(context ?? NO_CONTEXT, kind === "structured" ? 1 : Math.min(3, Math.max(1, limit)))}`,
      tier: "reasoning",
      maxTokens: 1800,
      context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_revision_${kind}` },
    }, attempt === 1 ? "main" : "retry");
    if (!r.ok) return { ok: false as const, error: r.error };
    model = r.model; provider = r.provider;
    // A repeat of a stored stem, or of one kept earlier in this reply, is not stored again.
    const seen = new Set(opts.existing ?? []);
    let batch: RevisionDraft[] = [];
    // A structured question is one substantial item a call (its prompt asks for at most one).
    for (const raw of (parseJsonArray(r.text) ?? []).slice(0, kind === "structured" ? 1 : limit)) {
      const c = checkRevisionDraft(kind, raw, passage, { existing: seen, difficulty: context?.difficulty ?? null, references: refs });
      if (c.ok) { batch.push(c.draft); seen.add(stemKey(c.draft.stem)); } else dropped.push(c.reason);
    }
    if (batch.length && REVISION_VERIFIED_KINDS.includes(kind)) {
      calls++;
      const items: RevisionVerifyItem[] = batch.map(d => ({ stem: d.stem, options: d.options, keyed: kind === "mrq" ? (d.answer.correct as number[]) : null }));
      const v = await run({
        system: REVISION_VERIFY_SYSTEM,
        user: revisionVerificationPrompt(verifyPassage, items),
        tier: "reasoning",
        maxTokens: 600,
        context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_revision_${kind}_verify` },
      }, attempt === 1 ? "verify" : "retry-verify");
      if (!v.ok) { dropped.push(...batch.map(() => "verification_unavailable")); batch = []; }
      else {
        const outcome = applyRevisionVerification(items, v.text);
        dropped.push(...outcome.rejected.map(() => "failed_verification"));
        batch = outcome.kept.map(i => batch[i]);
      }
    }
    kept = batch.slice(0, limit);
  }
  return { ok: true as const, kept, dropped, model, provider, calls, promptVersion: revisionPromptVersion(kind) };
}

// SCHOLAR-QUESTION-INTELLIGENCE-01 (evaluate v2): five labelled parts after the verdict (question-intel.ts
// FEEDBACK_FORMAT), judged against the rubric's key points and misconceptions where the question has them, clinically
// equivalent wording accepted, and NOT_IN_NOTES when it cannot judge reliably. No marks: the verdict is the mark.
export const EVALUATE_SYSTEM = [
  "You give formative feedback on a healthcare student's short answer to a revision question, for their own study.",
  "Judge the answer ONLY against the passage from their notes, the accepted answers and the key points given. Do not use outside knowledge.",
  "Accept an answer that says the same thing in other words, including clinically equivalent wording. Do not reward an answer for things the passage does not say.",
  "Your first line is exactly one of 'VERDICT: correct', 'VERDICT: partly' or 'VERDICT: incorrect'.",
  FEEDBACK_FORMAT,
  "Where common misconceptions are listed, say whether the answer shows one. Never give a mark, a score or a percentage.",
  "No new facts, numbers, doses, drugs or advice. No patient names. If the passage does not let you judge reliably, reply with exactly NOT_IN_NOTES.",
].join("\n");

export type EvaluateVerdict = "correct" | "partly" | "incorrect";
export type ShortAnswerEvaluation =
  | { ok: true; verdict: EvaluateVerdict; score: number; feedback: string; parts?: FeedbackParts }
  | { ok: false; reason: "malformed" | "not_in_notes" | "ungrounded" | "identifier" };
const VERDICT_SCORE: Record<EvaluateVerdict, number> = { correct: 1, partly: 0.5, incorrect: 0 };

/**
 * Pure. The evaluator's reply, checked: a verdict, and feedback that adds nothing the grounding does not hold. The five
 * labelled parts where it wrote them (parts, and feedback as their readable text); the v1 free text otherwise.
 */
export function parseEvaluation(raw: string, grounding: readonly string[]): ShortAnswerEvaluation {
  const text = raw.trim();
  if (text.replace(/[^A-Z_]/g, "") === NOT_IN_NOTES) return { ok: false, reason: "not_in_notes" };
  const m = /^\s*\**VERDICT:\s*(correct|partly|incorrect)\**\s*$/im.exec(text);
  if (!m) return { ok: false, reason: "malformed" };
  const body = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  const parts = parseFeedbackSections(body);
  const feedback = parts ? feedbackText(parts) : body;
  if (!feedback || feedback.length > (parts ? 2000 : 800)) return { ok: false, reason: "malformed" };
  if (findPatientIdentifiers(feedback).length) return { ok: false, reason: "identifier" };
  if (groundingViolations(feedback, [...grounding]).length) return { ok: false, reason: "ungrounded" };
  const verdict = m[1].toLowerCase() as EvaluateVerdict;
  return { ok: true, verdict, score: VERDICT_SCORE[verdict], feedback, ...(parts ? { parts } : {}) };
}

/** AI evaluation of one short answer. `run` is the metered runner (activity `evaluate`); the caller screened the answer. */
export async function runEvaluate(userId: string, input: { question: string; accepted: readonly string[]; answer: string; passage: Passage; rubric?: Rubric | null }, run: AiRun = direct) {
  const rubric = input.rubric;
  const r = await run({
    system: EVALUATE_SYSTEM,
    user: [
      `PASSAGE FROM MY NOTES (${passageCitation(input.passage)}):\n${input.passage.content}`,
      `QUESTION: ${input.question}\nACCEPTED ANSWERS: ${input.accepted.join(" | ")}`,
      rubric?.keyPoints.length ? `KEY POINTS: ${rubric.keyPoints.join(" | ")}` : null,
      rubric?.misconceptions.length ? `COMMON MISCONCEPTIONS: ${rubric.misconceptions.join(" | ")}` : null,
      `MY ANSWER: ${input.answer}`,
    ].filter(Boolean).join("\n\n"),
    tier: "reasoning",
    maxTokens: 600,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_evaluate" },
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  return { ok: true as const, model: r.model, provider: r.provider, promptVersion: PROMPT_VERSIONS.evaluate,
    evaluation: parseEvaluation(r.text, [input.passage.content, ...input.accepted, ...(rubric?.keyPoints ?? []), ...(rubric?.misconceptions ?? []), input.answer, input.question]) };
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
  "If the passages cannot support a case, reply {\"stages\": []}.",
  'Reply with JSON ONLY: {"title": "...", "intro": "the opening a student reads, from the passages", "stages": ["...", "..."], "facts": [{"ref": "F1", "kind": "observation", "label": "...", "value": "...", "shown": "start", "safetyCritical": false}], "decisions": [{"stage": 1, "prompt": "...", "kind": "single", "dimension": "recognition", "options": [{"text": "...", "correct": true}, {"text": "...", "correct": false}], "rationale": "...", "canAskFor": ["F2"], "sources": ["S1"], "safety": null}, {"stage": 2, "prompt": "...", "kind": "free_text", "dimension": "escalation", "options": [], "expectedResponse": "what a good answer contains, from the passages", "rationale": "...", "canAskFor": [], "sources": ["S1"], "safety": null}], "objectives": [{"text": "...", "competencies": ["C1"]}]}',
].join("\n");

const list0 = (v: unknown) => (Array.isArray(v) ? v.length : 0);

export function caseBlueprintPrompt(passages: readonly Passage[], competencies: readonly { title: string; outcomes?: string[] }[], context: string): string {
  const blocks = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`).join("\n\n");
  const comps = competencies.length ? `\n\nCOMPETENCIES these notes are linked to:\n${competencies.map((c, i) => `[C${i + 1}] ${c.title}${c.outcomes?.length ? ` -- ${c.outcomes.slice(0, 2).join("; ")}` : ""}`).join("\n")}` : "";
  return `CLINICAL CONTEXT: ${context}\n\nPASSAGES FROM MY NOTES:\n\n${blocks}${comps}`;
}

/** One private case from some passages: drafted, made a blueprint and checked, with one retry on its reasons. */
export async function runCaseBlueprint(userId: string, input: {
  passages: Passage[]; competencies: { id: string; title: string; outcomes?: string[] }[]; context: string; dimensions: readonly string[]; asked?: string | null;
}, run: AiRun = direct) {
  let feedback = "";
  let model = "", provider = "";
  const problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await run({
      system: CASE_BLUEPRINT_SYSTEM,
      user: caseBlueprintPrompt(input.passages, input.competencies, input.context) + (feedback ? `\n\nA previous attempt was rejected for: ${feedback}. Write the case again without these problems.` : ""),
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
  // SCHOLAR-QUESTION-INTELLIGENCE-01 (case reasoning v2): the same five parts as a revision answer's feedback.
  FEEDBACK_FORMAT.replace("the passage's own words", "the passages' own words"),
  "Never give a mark, a score or a percentage.",
  "No new facts, numbers, doses, drugs or advice. No patient names. If the material does not let you judge reliably, reply with exactly NOT_IN_NOTES.",
].join("\n");

/** AI feedback on one written decision (activity `evaluate`). Checked like any evaluation; labelled where shown. */
export async function runCaseReasoning(userId: string, input: { prompt: string; expected: string; facts: string[]; answer: string; passages: Passage[] }, run: AiRun = direct) {
  const r = await run({
    system: CASE_REASONING_SYSTEM,
    user: `CASE FACTS:\n${input.facts.join("\n")}\n\nPASSAGES:\n${input.passages.map((p, i) => `[${passageTag(i)}] ${p.content}`).join("\n\n")}\n\nDECISION: ${input.prompt}\nEXPECTED ANSWER: ${input.expected}\nMY ANSWER: ${input.answer}`,
    tier: "reasoning",
    maxTokens: 500,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_reasoning" },
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  return { ok: true as const, model: r.model, provider: r.provider, promptVersion: PROMPT_VERSIONS.caseReasoning,
    evaluation: parseEvaluation(r.text, [...input.passages.map(p => p.content), input.expected, ...input.facts, input.answer, input.prompt]) };
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

export async function runCase(userId: string, passage: Passage, run: AiRun = direct) {
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
    if (check.kept.length >= CASE_MIN_STEPS) {
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
    if (check.kept.length) {
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
