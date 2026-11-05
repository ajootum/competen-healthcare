// REVISE ENGINE QUALITY (owner, 5 Nov 2026, sections 2.1 and 2.6). Pure and client-safe: imports only the format registry.
//
// SIX COGNITIVE-DEPTH CATEGORIES are question-design guidance. They are NOT competency staging levels, nothing is required in
// sequence, and nothing here touches verified competence. A depth is stored in the rubric inside `answer` (no migration). An item
// written before this has no depth: it is read from its older four-way `level`.
//
// FOUR REVISION INTENTIONS choose formats, depths and a length for one sitting, on the existing session route.

import { INTENT_FORMATS } from "./question-formats";

export const DEPTHS = ["recall", "understand", "interpret", "apply", "analyse", "evaluate"] as const;
export type Depth = (typeof DEPTHS)[number];
export const isDepth = (v: unknown): v is Depth => typeof v === "string" && (DEPTHS as readonly string[]).includes(v);

export const DEPTH_LABEL: Record<Depth, string> = {
  recall: "Recall", understand: "Understand", interpret: "Interpret", apply: "Apply", analyse: "Analyse and prioritise", evaluate: "Evaluate and adapt",
};

/** The older four-way level (question-intel.ts COGNITIVE_LEVELS) as a depth, for items written before depth existed. */
const FROM_LEVEL: Record<string, Depth> = { recall: "recall", understanding: "understand", application: "apply", reasoning: "analyse" };
export const depthFromLevel = (level: unknown): Depth | null => (typeof level === "string" ? FROM_LEVEL[level] ?? null : null);

/** Pure. The depth of a stored item, from its `answer` (its rubric): its own, else its level's, else null. */
export function depthOfAnswer(answer: unknown): Depth | null {
  const r = ((answer ?? {}) as Record<string, unknown>).rubric as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  return isDepth(r.depth) ? r.depth : depthFromLevel(r.level);
}

/** What the generator is told. The passage decides what is possible: an item is never pushed past what it supports. */
export const DEPTH_RULE = [
  'DEPTH. Every item also has "depth", one of:',
  '"recall" (retrieve a fact, definition or key observation); "understand" (explain a concept, mechanism or relationship); "interpret" (recognise a pattern or explain a finding); "apply" (use the knowledge in a new situation); "analyse" (compare evidence, identify a risk, justify a priority); "evaluate" (defend a decision, reassess, respond to changed information).',
  "Choose the depth the learning objective needs and the passage can support. Never write a harder item than the passage supports, and do not make an item complicated when the objective is simple recall.",
  "Items in one reply each test a DIFFERENT fact or idea, and vary in depth where the passage allows. Never test the same fact twice in different words.",
].join("\n");

// ── TEST THE SUBJECT, NOT THE SLIDE ── (owner pilot, 5 Nov 2026: questions about what a slide lists or what its title says) ──

const ABOUT_THE_DOCUMENT = /\b(the|this|these|your) (passage|slides?|lecture|presentation|document|text|notes)\b|\baccording to\b|\b(sub)?title\b|\blearning (objectives?|outcomes?)\b|\bobjectives?\b[^.?!]*\b(include|includes|list|lists|state|states|say|says|describe|describes|call|calls)\b|\b(include|includes|list|lists|listed|state|states|stated|say|says|describe|describes|described)\b[^.?!]*\bobjectives?\b/i;
/** Pure. A question about the document rather than the subject: what the passage says, what the objectives list, what the title means. */
export const aboutTheDocument = (stem: string): boolean => ABOUT_THE_DOCUMENT.test(stem);

/** Pure. A line from a reference list: nothing to learn from, and a blank in it tests nothing. */
export const looksLikeCitation = (text: string): boolean => /doi\.org|https?:\/\/|\bet al\b|\b(19|20)\d{2}\b[^.]*\b\d+\(\d+\)|\b\d+\(\d+\),?\s*\d+[-\u2013]\d+/i.test(text);

/** Pure. The screen numbers the parts of a structured question, so a label a stored part already carries ("part (a):") would show twice. */
export const withoutPartLabel = (prompt: string): string => prompt.replace(/^\s*part\s*(?:\([a-z0-9]\)|[a-z0-9](?=[:.)\-\s]))\s*[:.)-]?\s*/i, "");

/** Pure. A section with too little to test: a title slide, or a list of objectives or contents. Nothing is written from it, which is where the trivia came from. */
export function thinForQuestions(content: string): boolean {
  const t = content.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < 30 || /^references\b/i.test(t) || (words < 150 && looksLikeCitation(t))) return true;
  return words < 120 && /^(learning )?(objectives|outcomes|aims)\b|^by the end\b|^at the end of\b|^(outline|contents|agenda)\b|\bobjectives?\s*:/i.test(t.slice(0, 160));
}

export const SUBJECT_RULE = "Test the subject itself, as if it were being discussed on the ward or in class. Never ask what the passage, a slide, the notes, the objectives or a title say, list or contain, and never write \"according to the passage\" or \"the passage states\" in anything the student reads. If the passage is only a title, objectives or a list of contents, reply [].";

/** Pure. The guidance line for a sitting that aims at some depths. */
export function depthAimLine(depths: readonly Depth[] | null | undefined): string | null {
  if (!depths?.length) return null;
  return `DEPTH AIM for this sitting: ${depths.map(d => `"${d}"`).join(" or ")}, where the passage supports it. If it does not, write what it does support.`;
}

// ── THE FOUR INTENTIONS ──

export const REVISION_INTENTS = ["quick_recall", "deep_understanding", "clinical_reasoning", "mixed_challenge"] as const;
export type RevisionIntent = (typeof REVISION_INTENTS)[number];
export const isRevisionIntent = (v: unknown): v is RevisionIntent => typeof v === "string" && (REVISION_INTENTS as readonly string[]).includes(v);

export const REVISION_INTENT: Record<RevisionIntent, {
  label: string; help: string;
  /** The session mode it runs as (both may write new questions for a shortfall). */
  mode: "quick" | "today";
  /** Preferred formats, in order, kept only where HQ offers them. Empty: everything offered. */
  formats: readonly string[];
  /** Preferred depths. Empty: a spread of whatever is there. */
  depths: readonly Depth[];
  quantity: number | null;
  difficulty: "any" | "easy" | "standard" | "harder";
}> = {
  quick_recall: { label: "Quick Recall", help: "Short questions on the facts you need to hand.", mode: "quick", formats: INTENT_FORMATS.quick_recall, depths: ["recall"], quantity: 8, difficulty: "easy" },
  deep_understanding: { label: "Deep Understanding", help: "Explain concepts and how they connect.", mode: "quick", formats: INTENT_FORMATS.deep_understanding, depths: ["understand", "interpret"], quantity: 6, difficulty: "standard" },
  clinical_reasoning: { label: "Clinical Reasoning", help: "Interpret, prioritise and decide in situations.", mode: "quick", formats: INTENT_FORMATS.clinical_reasoning, depths: ["interpret", "apply", "analyse", "evaluate"], quantity: 5, difficulty: "harder" },
  mixed_challenge: { label: "Mixed Challenge", help: "A varied set, led by what your answers show you need.", mode: "today", formats: INTENT_FORMATS.mixed_challenge, depths: [], quantity: null, difficulty: "any" },
};

/** Pure. The formats of a sitting: the intention's that HQ offers, or all that are offered where none of them is. */
export function intentFormats<F extends string>(intent: RevisionIntent, offered: readonly F[]): F[] {
  const wanted = REVISION_INTENT[intent].formats;
  const kept = wanted.length ? (wanted.filter(f => (offered as readonly string[]).includes(f)) as F[]) : [...offered];
  return kept.length ? kept : [...offered];
}

// ── NOT THE SAME FACT TWICE ──

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Pure. What makes two items the same fact: the same stated objective in the same section. Null: nothing to compare. */
export const factKeyOf = (chunkId: string, objective: string | null | undefined): string | null => {
  const o = objective ? norm(objective) : "";
  return o ? `${chunkId}|${o}` : null;
};

/**
 * Pure. Items in their order, with a repeat of the same fact moved behind everything else: a set fills with different facts first.
 * Order is otherwise unchanged, and an item with no objective is never treated as a repeat.
 */
export function differentFactsFirst<T extends { factKey?: string | null }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const first: T[] = [], later: T[] = [];
  for (const it of items) {
    if (it.factKey && seen.has(it.factKey)) { later.push(it); continue; }
    if (it.factKey) seen.add(it.factKey);
    first.push(it);
  }
  return [...first, ...later];
}

// ── AFTER A MISS: A DIFFERENT QUESTION ON THE GAP ──

/** Pure. What a follow-up should test: what the answer missed, then what the question lists as misconceptions and key points. */
export function followUpConcepts(input: { missing?: readonly string[]; misconceptions?: readonly string[]; keyPoints?: readonly string[] }): string[] {
  const all = [...(input.missing ?? []), ...(input.misconceptions ?? []), ...(input.keyPoints ?? [])].map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  return all.filter(s => { const k = norm(s); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}

/** The words a follow-up question carries, and what its result says. Formative only. */
export const FOLLOW_UP_LABEL = "A different question on what you missed.";
export const FOLLOW_UP_IMPROVED = "You got this one right, so that gap looks better. It comes back on your schedule. This is practice, not a judgement of competence.";
export const FOLLOW_UP_STILL = "This is still a gap. Teach me this goes back over it in your notes.";
