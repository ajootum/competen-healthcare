// ── QUESTION INTELLIGENCE ── SCHOLAR-QUESTION-INTELLIGENCE-01 / SCHOLAR-SQIE-01 (owner, 30 Oct 2026) ─────────────────
//
// Pure: no I/O, no clock, no model. The few rules the existing generators (generation.ts runQuestions and
// runRevisionQuestions), their checks (question-quality.ts, revision.ts checkRevisionDraft) and the evaluator
// (generation.ts runEvaluate) share, so the engine stays the one engine it was:
//
//   - WHAT A GENERATOR IS TOLD besides the passage: the section's concepts (topic finding, or the student's own
//     correction), the competency it is linked to (accepted first), the learner's level, the difficulty and count
//     asked for, and -- in source mode "notes_and_references" only -- the governed references Learn already uses.
//     Context STEERS. It is never grounding in mode "notes": every item is still checked against the passage alone.
//   - THE RUBRIC every generated item carries (stored in `answer` jsonb, migration 416 -- no new column): objective,
//     cognitive level, expected answer, key points, accepted alternatives, misconceptions, and its source with the
//     ids of any reference it rests on. Each text entry is grounding-checked; one that fails is dropped from the
//     rubric, never the question. It reaches a browser only after the item is answered (revision-view.ts).
//   - THE DETERMINISTIC CHECKS a revision item gets on top of 416's: it asks a question, it is not a repeat, its
//     options are real distractors, its key agrees with its explanation, its difficulty is the one asked for.
//   - THE FEEDBACK SHAPE: what was right, missing concepts, misconceptions, why the answer holds, what to revise
//     next -- parsed from the evaluator's labelled lines, or from a JSON object, with the old free text as fallback.
//   - ADAPTING: the next default difficulty from recent answers, and from the programme level.
//
// ⚠ FORMATIVE. Nothing here is assessment, a mark, mastery or competence.

import { textGroundingViolations } from "@/lib/ai/grounding";
import { findPatientIdentifiers } from "./extract";
import { words as plainWords } from "./learner-context";
import { unsupportedTerms } from "./question-quality";
import { FEEDBACK_HEADINGS, GROUNDING_LABEL } from "./config";

// ── LEVELS, DIFFICULTY, SOURCE MODES ──

export const COGNITIVE_LEVELS = ["recall", "understanding", "application", "reasoning"] as const;
export type CognitiveLevel = (typeof COGNITIVE_LEVELS)[number];
export const isCognitiveLevel = (v: unknown): v is CognitiveLevel => typeof v === "string" && (COGNITIVE_LEVELS as readonly string[]).includes(v);
export const LEVEL_LABEL: Record<CognitiveLevel, string> = { recall: "Recall", understanding: "Understanding", application: "Application", reasoning: "Clinical reasoning" };
/** The 416 difficulty (1-3) a cognitive level stands for. */
export const LEVEL_DIFFICULTY: Record<CognitiveLevel, 1 | 2 | 3> = { recall: 1, understanding: 2, application: 3, reasoning: 3 };
const DIFFICULTY_LEVEL: Record<1 | 2 | 3, CognitiveLevel> = { 1: "recall", 2: "understanding", 3: "application" };

export const GENERATION_DIFFICULTIES = ["easy", "standard", "harder"] as const;
export type GenerationDifficulty = (typeof GENERATION_DIFFICULTIES)[number];
export const isGenerationDifficulty = (v: unknown): v is GenerationDifficulty => typeof v === "string" && (GENERATION_DIFFICULTIES as readonly string[]).includes(v);
/** The 416 difficulties an item may have for a requested difficulty. */
export const DIFFICULTY_RANGE: Record<GenerationDifficulty, readonly (1 | 2 | 3)[]> = { easy: [1, 2], standard: [1, 2, 3], harder: [2, 3] };
const DIFFICULTY_AIM: Record<GenerationDifficulty, string> = {
  easy: "DIFFICULTY: easier. Aim at recall and understanding (difficulty 1 or 2).",
  standard: "DIFFICULTY: standard. Mix recall, understanding and application, mostly understanding.",
  harder: "DIFFICULTY: harder. Aim at application and clinical reasoning (difficulty 2 or 3): the student uses what the passage says to decide, distinguish or prioritise.",
};

export const SOURCE_MODES = ["notes", "notes_and_references"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];
export const isSourceMode = (v: unknown): v is SourceMode => typeof v === "string" && (SOURCE_MODES as readonly string[]).includes(v);
export type ItemSource = keyof typeof GROUNDING_LABEL;
/** What a generated item is labelled, by what it rests on (config.ts, so client components can show it). */
export { GROUNDING_LABEL, FEEDBACK_HEADINGS };

// ── WHAT THE GENERATOR IS TOLD ──

/** A governed reference as a generator sees it (learn.ts governedReferences): a tag, never an id. */
export type PromptReference = { tag: string; id: string; title: string; outcome: string | null };

export type GenerationContext = {
  /** The section's topics: the student's correction where they made one, otherwise the topic finding's. */
  concepts: string[];
  /** The competency the section is linked to (accepted first), and its outcome where one is named. Steers only. */
  competency: { title: string; outcome: string | null } | null;
  /** The learner's programme and level, in words. Steers only. */
  level: string | null;
  difficulty: GenerationDifficulty | null;
  mode: SourceMode;
  /** Mode notes_and_references only: the references an item may draw on, cited by tag. */
  references: PromptReference[];
};
export const NO_CONTEXT: GenerationContext = { concepts: [], competency: null, level: null, difficulty: null, mode: "notes", references: [] };

const listWords = (xs: readonly string[], n: number) => [...new Set(xs.map(plainWords).filter(Boolean))].slice(0, n).join("; ");

/**
 * Pure. The block added after the passage. Words only (learner-context.ts words: no digits, no codes), so nothing in
 * it invites a figure the grounding check would refuse. Empty when there is nothing to add.
 */
export function generationContextBlock(c: GenerationContext, count: number | null = null): string {
  const lines: string[] = [];
  const concepts = listWords(c.concepts, 8);
  if (concepts) lines.push(`CONCEPTS this passage covers: ${concepts}. Test these, not trivia.`);
  if (c.competency && plainWords(c.competency.title)) lines.push(`COMPETENCY the passage is linked to: ${plainWords(c.competency.title)}${c.competency.outcome && plainWords(c.competency.outcome) ? ` -- ${plainWords(c.competency.outcome)}` : ""}. Prefer items that serve it.`);
  if (c.level && plainWords(c.level)) lines.push(`MY LEVEL: ${plainWords(c.level)}. Pitch the items to it.`);
  if (c.difficulty) lines.push(DIFFICULTY_AIM[c.difficulty]);
  if (count !== null) lines.push(`Write up to ${["one", "two", "three", "four", "five"][Math.min(5, Math.max(1, count)) - 1]} item${count === 1 ? "" : "s"}.`);
  const refs = c.mode === "notes_and_references" ? c.references.filter(r => plainWords(r.title)) : [];
  if (refs.length) lines.push(`APPROVED REFERENCES you may also draw on. An item that uses one lists its tag in "references"; never cite a tag not listed here:\n${refs.map(r => `[${r.tag}] ${plainWords(r.title)}${r.outcome && plainWords(r.outcome) ? `: ${plainWords(r.outcome)}` : ""}`).join("\n")}`);
  if (!lines.length) return "";
  const rule = refs.length
    ? "Every item must still be answerable from the passage, or from the passage with a reference above that it cites."
    : "Every item must still be answerable from the passage ALONE: this guidance only chooses what to test and how hard.";
  return `\n\nGUIDANCE (from my own study record; do not mention it). ${rule}\n${lines.join("\n")}`;
}

/** The text a reference adds to grounding in mode notes_and_references: what the generator was shown. */
export const referenceGrounding = (refs: readonly PromptReference[]) => refs.map(r => [plainWords(r.title), r.outcome ? plainWords(r.outcome) : ""].filter(Boolean).join(": "));

/** The rubric fields every generator asks for, after its own item shape. */
export const RUBRIC_RULE = [
  "RUBRIC. Every item also has these fields, all in the passage's own words, never counting things:",
  '"level": one of "recall", "understanding", "application", "reasoning" -- spread the items across levels, not all recall;',
  '"objective": one short sentence saying what the item checks;',
  '"keyPoints": one to four short points a full answer contains;',
  '"misconceptions": up to three short mistaken beliefs a student might hold that the passage contradicts ([] if none is evident);',
  '"references": [] or the tags of the approved references the item draws on (only when references are given).',
].join("\n");

// ── THE RUBRIC ──

export type Rubric = {
  objective: string | null;
  level: CognitiveLevel;
  /** The answer the item expects, in words (the key of its kind). */
  expectedAnswer: string | null;
  keyPoints: string[];
  acceptedAlternatives: string[];
  misconceptions: string[];
  source: ItemSource;
  referenceIds: string[];
};

const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(x => x.trim()).filter(x => x && x.length <= max).slice(0, n) : []);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/**
 * Pure. The rubric of one generated item. Every text entry is held to the item's own rules -- nothing the grounding
 * lacks, nothing identifying -- and one that fails is left out (the item is not dropped for its rubric). A reference
 * tag that was not given is ignored: a reference is never invented.
 */
export function parseRubric(raw: unknown, grounding: readonly string[], opts: { expectedAnswer: string | null; accepted?: readonly string[]; difficulty: 1 | 2 | 3; references?: readonly PromptReference[] }): Rubric {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = (t: string) => !findPatientIdentifiers(t).length && !textGroundingViolations(t, [...grounding]).length;
  const keep = (xs: string[]) => xs.filter(ok);
  const objective = str(r.objective, 300);
  const byTag = new Map((opts.references ?? []).map(x => [x.tag.toUpperCase(), x.id]));
  const referenceIds = [...new Set(strs(r.references, 6, 10).map(t => byTag.get(t.replace(/[[\]\s]/g, "").toUpperCase())).filter((x): x is string => !!x))];
  return {
    objective: objective && ok(objective) ? objective : null,
    level: isCognitiveLevel(r.level) ? r.level : DIFFICULTY_LEVEL[opts.difficulty],
    expectedAnswer: opts.expectedAnswer ? opts.expectedAnswer.slice(0, 600) : null,
    keyPoints: keep(strs(r.keyPoints, 4, 300)),
    acceptedAlternatives: [...new Set(opts.accepted ?? [])].slice(0, 8),
    misconceptions: keep(strs(r.misconceptions, 3, 300)),
    source: referenceIds.length ? "references" : "notes",
    referenceIds,
  };
}

/** Pure. The difficulty an item is stored with: its own (1-3) where it gave one, otherwise its level's. */
export const difficultyOf = (raw: unknown): 1 | 2 | 3 => {
  const r = (raw ?? {}) as Record<string, unknown>;
  return r.difficulty === 1 || r.difficulty === 2 || r.difficulty === 3 ? r.difficulty : isCognitiveLevel(r.level) ? LEVEL_DIFFICULTY[r.level] : 2;
};

/** Pure. A stored rubric read back from `answer`, or null where the item has none (written before this). */
export function rubricOf(answer: unknown): Rubric | null {
  const r = ((answer ?? {}) as Record<string, unknown>).rubric as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || !isCognitiveLevel(r.level)) return null;
  return {
    objective: typeof r.objective === "string" ? r.objective : null, level: r.level,
    expectedAnswer: typeof r.expectedAnswer === "string" ? r.expectedAnswer : null,
    keyPoints: strs(r.keyPoints, 4, 300), acceptedAlternatives: strs(r.acceptedAlternatives, 8, 300), misconceptions: strs(r.misconceptions, 3, 300),
    source: r.source === "references" ? "references" : "notes", referenceIds: strs(r.referenceIds, 6, 64),
  };
}

// ── THE DETERMINISTIC CHECKS ──

const ASKS = /\?\s*$|\?|^(name|list|state|define|explain|describe|identify|give|outline|match|put|arrange|order|choose|select|complete|compare|distinguish)\b/i;
/** Pure. A stem asks something: a question mark, or an instruction to answer. */
export const asksQuestion = (stem: string): boolean => stem.trim().length >= 12 && ASKS.test(stem.trim());

/**
 * Pure. A flashcard front is a question, or a short term to recall (at most eight words, not a sentence). A
 * statement -- "Pyelonephritis (kidney infection): This infection spreads from the bladder ..." -- is neither: it
 * gives the answer away and asks nothing.
 */
export function flashcardFrontAsks(front: string): boolean {
  const f = front.trim();
  if (/\?/.test(f)) return f.length >= 8;
  const words = f.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 8 && !/[.;]\s*$/.test(f) && !/:\s*\S+\s+\S+/.test(f);
}

// SCHOLAR-FLASHCARDS-01: a generated card is ONE concept and a RECALL PROMPT, not a sentence copied from the notes.
const flatWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** The longest back that is still one concept, and the most sentences it may run to. */
export const CARD_BACK_ONE_CONCEPT = { chars: 300, sentences: 2 };

/**
 * Pure. Why an AI-written card is not a good flashcard, or null: its front is a sentence copied from the notes (eight
 * words or more, found verbatim in the passage) rather than a recall prompt, or its back is more than one concept
 * (longer than 300 characters or more than two sentences).
 */
export function flashcardDraftProblem(front: string, back: string, passage: string): "copied" | "multi_concept" | null {
  const f = flatWords(front);
  if (f.split(" ").length >= 8 && flatWords(passage).includes(f)) return "copied";
  const sentences = back.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(Boolean).length;
  if (back.length > CARD_BACK_ONE_CONCEPT.chars || sentences > CARD_BACK_ONE_CONCEPT.sentences) return "multi_concept";
  return null;
}

/** Pure. A stem reduced for duplicate detection: case, punctuation and small framing words ignored. */
export function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|a|an|of|in|on|to|is|are|was|were|which|what|that|this|these|for|and|or|with|from|by|all|apply|choose|select)\b/g, " ").replace(/\s+/g, " ").trim();
}

const CATCH_ALL = /\b(all|none) of (the )?(above|these|the options)\b|^both\b|^[a-f] and [a-f]$|^neither\b/i;
/**
 * Pure. Options that are real distractors: distinct (by normalised wording), none a catch-all ("all of the above"),
 * none contained in another, and none a bare word or two beside full-sentence options (a give-away).
 */
export function distractorProblem(options: readonly string[]): string | null {
  const n = options.map(o => o.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
  if (n.some(o => !o) || new Set(n).size !== n.length) return "duplicate option";
  if (options.some(o => CATCH_ALL.test(o.trim()))) return "catch-all option";
  if (n.some((a, i) => n.some((b, j) => i !== j && a.split(" ").length >= 2 && ` ${b} `.includes(` ${a} `)))) return "one option contains another";
  const lens = n.map(o => o.split(" ").length);
  if (Math.max(...lens) >= 8 && Math.min(...lens) <= 1) return "options of very different kinds";
  return null;
}

/** Pure. The key agrees with its explanation: its content words are in the rationale or the quoted source. */
export const keyConsistent = (key: string, rationale: string, sourceQuote: string): boolean => !key.trim() || unsupportedTerms(key, `${rationale}\n${sourceQuote}`).length === 0;

/** Pure. An item's difficulty is one the request allows (no request allows any). */
export const difficultyFits = (difficulty: 1 | 2 | 3, requested: GenerationDifficulty | null): boolean => !requested || DIFFICULTY_RANGE[requested].includes(difficulty);

// ── FEEDBACK ──

export type FeedbackParts = { right: string[]; missing: string[]; misconceptions: string[]; why: string | null; next: string | null };

/** The lines an evaluator writes after its VERDICT line. "none" where a part has nothing. */
export const FEEDBACK_FORMAT = [
  "Then exactly these five lines, each short, in the passage's own words (write none where a part has nothing):",
  "RIGHT: what the answer got right (separate points with ;)",
  "MISSING: the concepts or key points it missed (separate with ;)",
  "MISCONCEPTIONS: any mistaken idea in the answer (separate with ;)",
  "WHY: one sentence on why the correct answer holds, from the passage",
  "NEXT: one short thing to revise next, from the passage",
].join("\n");

const LABELS: Record<string, keyof FeedbackParts> = { RIGHT: "right", MISSING: "missing", MISCONCEPTIONS: "misconceptions", MISCONCEPTION: "misconceptions", WHY: "why", NEXT: "next" };
const isNone = (s: string) => /^(none|nothing|n\/a|-)\.?$/i.test(s.trim());
const points = (s: string) => s.split(/\s*;\s*/).map(x => x.trim().replace(/\.$/, "")).filter(x => x && !isNone(x)).slice(0, 4);

/** Pure. The evaluator's labelled lines → the five parts, or null when it wrote none of them (the old free text). */
export function parseFeedbackSections(text: string): FeedbackParts | null {
  const out: FeedbackParts = { right: [], missing: [], misconceptions: [], why: null, next: null };
  let found = 0;
  for (const line of text.split("\n")) {
    const m = /^\s*\**\s*(RIGHT|MISSING|MISCONCEPTIONS?|WHY|NEXT)\s*\**\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    found++;
    const key = LABELS[m[1].toUpperCase()];
    const body = m[2].trim();
    if (key === "why" || key === "next") out[key] = body && !isNone(body) ? body.slice(0, 400) : null;
    else out[key] = points(body).map(p => p.slice(0, 300));
  }
  return found ? out : null;
}

/** Pure. The parts from a JSON object (the paper answer's attemptFeedback), or null when it carries none. */
export function feedbackPartsFrom(raw: unknown): FeedbackParts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p: FeedbackParts = {
    right: strs(r.right, 4, 300), missing: strs(r.missing, 4, 300), misconceptions: strs(r.misconceptions, 3, 300),
    why: str(r.why, 400), next: str(r.next, 400),
  };
  return p.right.length || p.missing.length || p.misconceptions.length || p.why || p.next ? p : null;
}

/** Pure. The parts as one readable text (the audit-free stored feedback, and any surface that shows text only). */
export function feedbackText(p: FeedbackParts): string {
  return [
    p.right.length ? `${FEEDBACK_HEADINGS.right}: ${p.right.join("; ")}.` : null,
    p.missing.length ? `${FEEDBACK_HEADINGS.missing}: ${p.missing.join("; ")}.` : null,
    p.misconceptions.length ? `${FEEDBACK_HEADINGS.misconceptions}: ${p.misconceptions.join("; ")}.` : null,
    p.why ? `${FEEDBACK_HEADINGS.why}: ${p.why}` : null,
    p.next ? `${FEEDBACK_HEADINGS.next}: ${p.next}` : null,
  ].filter(Boolean).join("\n");
}

// ── ADAPTING ──

const STEP: GenerationDifficulty[] = ["easy", "standard", "harder"];
/**
 * Pure. Progressive difficulty from the student's own recent answers (newest first): three right in a row steps the
 * default up, two of the last three missed steps it down. Fewer than three answers: unchanged. A rule on their
 * answers, not a model of them.
 */
export function adaptDifficulty(base: GenerationDifficulty, recent: readonly boolean[]): GenerationDifficulty {
  const last = recent.slice(0, 3);
  if (last.length < 3) return base;
  const i = STEP.indexOf(base);
  if (last.every(Boolean)) return STEP[Math.min(STEP.length - 1, i + 1)];
  if (last.filter(x => !x).length >= 2) return STEP[Math.max(0, i - 1)];
  return base;
}

/**
 * Pure. The default difficulty a programme level suggests (enrolled/certificate, diploma, bachelor's, master's,
 * doctoral), from the programme and level as configured -- or null when they name none of these. A default only:
 * the student may always choose another, and nothing is withheld by level.
 */
export function levelDefaultDifficulty(programme: string | null, level: string | null): GenerationDifficulty | null {
  const t = `${programme ?? ""} ${level ?? ""}`.toLowerCase();
  if (/\b(doctor(al|ate)?|phd|dphil|dnp)\b/.test(t) || /\b(master'?s?|msc|mph|mn|ma)\b/.test(t)) return "harder";
  if (/\b(bachelor'?s?|bsc|bn|bns|degree|undergraduate)\b/.test(t) || /\bdiploma\b/.test(t)) return "standard";
  if (/\b(enrolled|certificate)\b/.test(t)) return "easy";
  return null;
}

/** Pure. The revision difficulty ("any" included) a session asks generation for. */
export const generationDifficulty = (d: string | null | undefined): GenerationDifficulty | null => (isGenerationDifficulty(d) ? d : null);
