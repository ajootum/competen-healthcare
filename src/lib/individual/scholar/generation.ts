import { generate } from "@/lib/ai/client";
import { parseJsonArray, textGroundingViolations, type PhrasingViolation } from "@/lib/ai/grounding";
import { proposeMappings, type MappingFraming, type MappingSubject } from "@/lib/competency/mapping";
import { CONTEXT_PREAMBLE } from "./learner-context";
import { CASE_MAX_STEPS, CASE_MIN_STEPS, PROMPT_VERSIONS, QUESTIONS_PER_REQUEST } from "./config";
import { citeChunk, findPatientIdentifiers } from "./extract";
import { structureLabel, type CatalogueCompetency } from "./catalogue";
import { VERIFY_SYSTEM, applyVerification, passageVocabulary, qualityProblems, verificationPrompt, type QualityReason } from "./question-quality";

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
};

/** The label the model and the person both see for passage i: [S1], [S2] ... */
export const passageTag = (i: number) => `S${i + 1}`;

export function passageCitation(p: Pick<Passage, "materialTitle" | "ordinal" | "pageFrom" | "pageTo">): string {
  return `${p.materialTitle}, ${citeChunk(p)}`;
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
  "3. Keep every number, unit and clinical term exactly as the passages write it. Do not introduce clinical descriptors (such as normal, significant, raised, reduced, positive, stable) that the passages do not use.",
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
  'Reply with JSON ONLY, no prose and no code fence: [{"stem": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "rationale": "...", "sourceQuote": "..."}]',
];

export const QUESTION_SYSTEM: Record<QuestionKind, string> = {
  mcq: [
    "You write multiple-choice revision questions for a healthcare student, from ONE passage of their own study notes.",
    `Write up to ${QUESTIONS_PER_REQUEST} questions that test understanding of the passage, not trivia.`,
    "",
    ...QUESTION_RULES,
  ].join("\n"),
  case: [
    "You write short case-style application questions for a healthcare student, from ONE passage of their own study notes.",
    `Write up to ${QUESTIONS_PER_REQUEST} questions. Each stem is a brief educational scenario about 'a patient' (no name, no age, no numbers unless the passage gives them) followed by a question asking the student to APPLY the passage to the scenario.`,
    "The scenario may only describe things the passage itself mentions. If the passage cannot support a scenario, return [].",
    "",
    ...QUESTION_RULES,
  ].join("\n"),
};

export function questionUserPrompt(passage: Passage): string {
  return `PASSAGE (${passageCitation(passage)}):\n${passage.content}\n\n`
    + "OPTION VOCABULARY. Every option, right or wrong, may use only these content words (plus small words like 'the', 'by', 'of'), "
    + `in any order or form: ${passageVocabulary(passage.content).join(", ")}`;
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();


export type DropReason = "malformed" | "quote_not_in_passage" | "ungrounded" | QualityReason | "failed_verification" | "verification_unavailable";

export type QuestionCheck = {
  kept: DraftQuestion[];
  dropped: { reason: DropReason; violations?: PhrasingViolation[]; detail?: string }[];
};

/**
 * Pure. Model reply → the questions that may be stored, and why each other one was not. `limit` is the
 * Individual policy value (COMPETEN-CONFIG-002), never above QUESTIONS_PER_REQUEST: it narrows how many are
 * KEPT and leaves the versioned prompt (PROMPT_VERSIONS) untouched.
 */
export function checkQuestions(raw: string, passage: Passage, limit: number = QUESTIONS_PER_REQUEST, cap: number = QUESTIONS_PER_REQUEST): QuestionCheck {
  const out: QuestionCheck = { kept: [], dropped: [] };
  const arr = parseJsonArray(raw);
  if (!arr) { out.dropped.push({ reason: "malformed" }); return out; }
  const source = squash(passage.content);
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
    out.kept.push(draft);
  }
  return out;
}

// ── THE CALLS ── generate(), person attribution, nothing else ──────────────────────────────────────

export type AiFailure = { ok: false; error: "not_configured" | "refusal" | "failed" };

/**
 * S3: one answer in the chosen mode. The notes-based part is checked by checkExplanation, with the
 * question and the earlier tutor turns as grounding (the person typed or was already shown them). The part
 * beyond the notes, if any, is split off first and checked by its own rules -- it never reaches
 * checkExplanation, and never grounds anything.
 */
/** Stage 3: added to the system prompt when the policy has background beyond the notes switched off. */
export const NOTES_ONLY = "BACKGROUND IS OFF: do not add any section beyond the passages and do not write the line BEYOND THE NOTES. Answer from the passages only.";

export async function runExplain(userId: string, question: string, passages: Passage[], mode: ExplainMode = "explain", history: TutorTurn[] = [], learnerContext: string | null = null, allowBackground: boolean = true) {
  const notesOnly = !allowBackground && SUPPLEMENTARY_MODES.includes(mode);
  const r = await generate({
    system: notesOnly ? `${explainSystem(mode)}\n\n${NOTES_ONLY}` : explainSystem(mode),
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
    // Background off: anything after the marker is dropped unseen, whatever the model did.
    supplementary: split.extra === null || notesOnly ? null : checkSupplementary(split.extra, mode),
    model: r.model, provider: r.provider, promptVersion: notesOnly ? `${explainPromptVersion(mode)}:notes-only` : explainPromptVersion(mode),
  };
}

/** S2 framing for the Holdings mapping engine. It names no profession: the programme's catalogue does that. */
export const SCHOLAR_MAPPING_FRAMING: MappingFraming = { person: "a healthcare student", subjects: "sections of their own study notes" };

/**
 * S2: concepts and PROPOSED competency mappings for a few sections at once, through the Holdings engine
 * (src/lib/competency/mapping.ts). The model sees tags, never ids. Person attribution, the Scholar operation,
 * and Scholar's patient-identifier screen.
 */
export async function runAnalysis(userId: string, sections: MappingSubject[], competencies: CatalogueCompetency[]) {
  return proposeMappings({
    subjects: sections,
    candidates: competencies.map(c => ({ competencyId: c.id, layer: c.layer, code: c.code, title: c.title, outcomes: c.outcomes, context: structureLabel(c) })),
    framing: SCHOLAR_MAPPING_FRAMING,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_map" },
    screen: findPatientIdentifiers,
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

export async function runCase(userId: string, passage: Passage) {
  const dropped: QuestionCheck["dropped"] = [];
  let steps: DraftQuestion[] = [];
  let title = CASE_FALLBACK_TITLE;
  let model = "", provider = "";
  let attempts = 0;
  let feedback = "";
  while (attempts < 2 && steps.length < CASE_MIN_STEPS) {
    attempts++;
    const r = await generate({
      system: CASE_SYSTEM,
      user: questionUserPrompt(passage) + (feedback ? `\n\nA previous attempt was rejected for: ${feedback}. Write a new case that avoids these problems.` : ""),
      tier: "reasoning",
      maxTokens: 2200,
      context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_steps" },
    });
    if (!r.ok) return { ok: false, error: r.error } as AiFailure;
    model = r.model; provider = r.provider;
    const parsed = parseCase(r.text);
    if (!parsed) { dropped.push({ reason: "malformed" }); feedback = "malformed"; continue; }
    const check = checkQuestions(JSON.stringify(parsed.steps), passage, CASE_MAX_STEPS, CASE_MAX_STEPS);
    dropped.push(...check.dropped);
    if (check.kept.length >= CASE_MIN_STEPS) {
      const v = await generate({
        system: VERIFY_SYSTEM,
        user: verificationPrompt(passage.content, check.kept),
        tier: "reasoning",
        maxTokens: 700,
        context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_case_steps_verify" },
      });
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
    ok: true as const, title, steps, dropped, model, provider, attempts,
    promptVersion: `${PROMPT_VERSIONS.caseSteps}+${PROMPT_VERSIONS.verify}`,
  };
}

/**
 * Owner review P0.1: generate, check every part of every question, then have a second, blind reader confirm
 * that the passage supports exactly the keyed option. If nothing survives, regenerate ONCE on the same
 * provider, telling it what was rejected. A grounding failure is never sent to another vendor (client.ts).
 */
export async function runQuestions(userId: string, kind: QuestionKind, passage: Passage, limit: number = QUESTIONS_PER_REQUEST) {
  const dropped: QuestionCheck["dropped"] = [];
  let kept: DraftQuestion[] = [];
  let model = "", provider = "";
  let attempts = 0;
  let feedback = "";
  while (attempts < 2 && kept.length === 0) {
    attempts++;
    const r = await generate({
      system: QUESTION_SYSTEM[kind],
      user: questionUserPrompt(passage) + (feedback ? `

A previous attempt was rejected for: ${feedback}. Write new questions that avoid these problems.` : ""),
      tier: "reasoning",
      maxTokens: 1400,
      context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_${kind}` },
    });
    if (!r.ok) return { ok: false, error: r.error } as AiFailure;
    model = r.model; provider = r.provider;
    const check = checkQuestions(r.text, passage, limit);
    dropped.push(...check.dropped);
    if (check.kept.length) {
      const v = await generate({
        system: VERIFY_SYSTEM,
        user: verificationPrompt(passage.content, check.kept),
        tier: "reasoning",
        maxTokens: 600,
        context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_${kind}_verify` },
      });
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
    ok: true as const, check: { kept, dropped }, model, provider, attempts,
    promptVersion: `${PROMPT_VERSIONS[kind]}+${PROMPT_VERSIONS.verify}`,
  };
}
