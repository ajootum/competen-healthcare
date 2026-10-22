import { generate } from "@/lib/ai/client";
import { verifyGrounded, type PhrasingViolation } from "@/lib/practice/document-phrasing";
import { PROMPT_VERSIONS, QUESTIONS_PER_REQUEST } from "./config";
import { citeChunk } from "./extract";

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
// verifyGrounded's own rules, with one adjustment, stated here: its month check treats the word "may" as
// the month May. In study prose "may" is almost always the modal verb, so that one token is excused. Every
// other number, month and finding-word rule applies as written. The fact_missing rule cannot fire,
// because no structured facts are passed -- the passages are grounding TEXT (verifyGrounded's `typed`).
export function groundingViolations(output: string, grounding: string[]): PhrasingViolation[] {
  return verifyGrounded(output, [], grounding)
    .filter(v => !(v.kind === "ungrounded_month" && v.token === "may"));
}

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
  "3. sourceQuote is ONE sentence copied EXACTLY, character for character, from the passage, that shows the correct answer.",
  "4. Exactly four options, one correct. correctIndex is 0, 1, 2 or 3.",
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
  return `PASSAGE (${passageCitation(passage)}):\n${passage.content}`;
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Pure. Pulls the first JSON array out of a model reply. */
export function parseJsonArray(raw: string): unknown[] | null {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export type QuestionCheck = {
  kept: DraftQuestion[];
  dropped: { reason: "malformed" | "quote_not_in_passage" | "ungrounded"; violations?: PhrasingViolation[] }[];
};

/** Pure. Model reply → the questions that may be stored, and why each other one was not. */
export function checkQuestions(raw: string, passage: Passage): QuestionCheck {
  const out: QuestionCheck = { kept: [], dropped: [] };
  const arr = parseJsonArray(raw);
  if (!arr) { out.dropped.push({ reason: "malformed" }); return out; }
  const source = squash(passage.content);
  for (const item of arr.slice(0, QUESTIONS_PER_REQUEST)) {
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
    out.kept.push({ stem, options: options as DraftQuestion["options"], correctIndex: ci, rationale, sourceQuote: quote });
  }
  return out;
}

// ── THE CALLS ── generate(), person attribution, nothing else ──────────────────────────────────────

export type AiFailure = { ok: false; error: "not_configured" | "refusal" | "failed" };

export async function runExplain(userId: string, question: string, passages: Passage[]) {
  const r = await generate({
    system: EXPLAIN_SYSTEM,
    user: explainUserPrompt(question, passages),
    tier: "reasoning",
    maxTokens: 700,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_explain" },
  });
  if (!r.ok) return { ok: false, error: r.error } as AiFailure;
  return { ok: true as const, check: checkExplanation(r.text, question, passages), model: r.model, provider: r.provider, promptVersion: PROMPT_VERSIONS.explain };
}

export async function runQuestions(userId: string, kind: QuestionKind, passage: Passage) {
  const r = await generate({
    system: QUESTION_SYSTEM[kind],
    user: questionUserPrompt(passage),
    tier: "reasoning",
    maxTokens: 1400,
    context: { userId, attribution: { scope: "person" }, operation: `individual_scholar_${kind}` },
  });
  if (!r.ok) return { ok: false, error: r.error } as AiFailure;
  return { ok: true as const, check: checkQuestions(r.text, passage), model: r.model, provider: r.provider, promptVersion: PROMPT_VERSIONS[kind] };
}
