// ── RESEARCH RELEVANCE ── SCHOLAR-RESEARCH-RELEVANCE-01 (owner instruction 1 Nov 2026, item 6) ──────────────────────────
//
// Incident: teaching the Donabedian model returned ICU sedation and delirium guidelines as "supporting evidence". The
// cause was threefold (learn-research.ts, service.ts researchQuery, source-quality.ts onTopic):
//   1. the search was a bag of the first eight words of the first four MATERIAL topics (title ignored whenever topics
//      existed), so generic words ("quality", "safety", "care") drove the search and nothing was a phrase;
//   2. the on-topic gate passed an item when ONE non-generic word of the query was in its title, and "quality",
//      "safety" and "improvement" are not generic words there (a QI lesson needs them);
//   3. nothing looked at the abstract, nor at what the item is ABOUT (an ICU guideline in a lesson about no ICU).
// This file is the fix: a grounded query built from the lesson, and a pure relevance filter that runs before anything
// is presented. Pure, no I/O. Generic words never make an item relevant alone; distinctive concepts and multi-word
// concepts do; a clinical specialty the lesson never mentions counts against an item.

import type { ResearchItem } from "@/lib/holdings/research/providers";
import { GENERIC_TOPIC_WORDS, sameTopicWord } from "./source-quality";

export type RelevanceLevel = "strict" | "standard";
export const DEFAULT_RELEVANCE: RelevanceLevel = "standard";
/** What the lesson is: any of these may be absent. `concepts` are the lesson's key concepts (chunk analysis / material topics). */
export type LessonContext = { title?: string | null; objective?: string | null; concepts?: readonly string[] | null; topics?: readonly string[] | null; question?: string | null };
/** One concept of a lesson: a distinctive word, or a multi-word phrase (tokens in order). */
export type Concept = { text: string; tokens: string[]; phrase: boolean };

/** Function words and lesson-instruction words: never a concept, and skipped when looking for a phrase. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set((
  "the and for with from that this what when which into about their there these those have has had been were was are how why who does did can could should would will may might must not but its our your you they them than then also such each other "
  + "of in on to a an or by as at is it be if so no vs via per use used using "
  + "explain teach tell give show please help understand understanding notes note section step lesson learn learning more simply example examples summary summarise summarize deeper detail detailed "
  + "objective objectives describe discuss identify outline apply evaluate assess assessing plan planning recognise recognize compare demonstrate able learner student topic topics key concept concepts introduction overview basics basic"
).split(/\s+/));

/**
 * Words that are real words but name no particular topic. Together with source-quality's generic words. Alone they never
 * make an item relevant; inside a KNOWN or lesson phrase they still count (quality improvement, patient safety).
 */
const WEAK_WORDS: ReadonlySet<string> = new Set([
  "quality", "safety", "safe", "healthcare", "improvement", "improve", "improving", "model", "models", "framework", "frameworks",
  "structure", "structures", "process", "processes", "outcome", "outcomes", "system", "systems", "service", "services", "level", "levels", "high", "low", "new", "good",
  "important", "general", "overview", "method", "methods", "analysis", "result", "results", "based", "associated", "related", "impact", "performance", "program", "programme",
  "programs", "programmes", "standard", "standards", "measure", "measures", "measurement", "monitoring", "implementation", "development", "improved", "professional", "professionals",
  "staff", "team", "teams", "work", "working", "need", "needs", "case", "cases", "report", "reports", "literature", "research", "systematic", "meta",
]);
const isGeneric = (w: string) => FUNCTION_WORDS.has(w) || GENERIC_TOPIC_WORDS.has(w) || WEAK_WORDS.has(w);

/** Multi-word concepts that are one idea although their words are generic. Matched in the lesson text, in order, function words skipped. */
const KNOWN_PHRASES: readonly string[] = [
  "structure process outcome", "quality improvement", "continuous quality improvement", "patient safety", "improvement science", "quality of care", "quality care",
  "healthcare quality", "health care quality", "quality assurance", "plan do study act", "root cause analysis", "clinical governance", "clinical audit",
  "evidence based practice", "evidence based medicine", "infection prevention", "infection control", "person centred care", "patient centred care", "patient experience",
  "adverse event", "adverse events", "safety culture", "just culture", "human factors", "risk management", "care pathway", "care bundle", "early warning score",
];

/** Words of a text in order, lowercased, accents removed. Digits-only tokens and one-letter tokens are dropped. */
export const wordsOf = (s: string | null | undefined): string[] =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
/** The content stream a phrase is matched in: words without function words. */
const streamOf = (s: string | null | undefined) => wordsOf(s).filter(w => !FUNCTION_WORDS.has(w));

const containsRun = (stream: readonly string[], run: readonly string[]): boolean => {
  if (!run.length || run.length > stream.length) return false;
  for (let i = 0; i + run.length <= stream.length; i++) if (run.every((w, k) => sameTopicWord(stream[i + k], w))) return true;
  return false;
};
const hasWord = (stream: readonly string[], w: string) => stream.some(x => sameTopicWord(x, w));

const KNOWN: readonly string[][] = KNOWN_PHRASES.map(p => streamOf(p));

/** Segments of a text that a phrase may not cross: punctuation, brackets, colons. "Donabedian model: structure, process" is three. */
const segments = (s: string | null | undefined) => (s ?? "").split(/[:;,.()\[\]/\n?!]+/).map(x => x.trim()).filter(Boolean);
/** Runs of adjacent content words: a segment cut at every function word, so no phrase spans "to", "of" or "and". */
const runsOf = (s: string | null | undefined): string[][] => {
  const out: string[][] = [];
  for (const seg of segments(s)) {
    let cur: string[] = [];
    for (const w of wordsOf(seg)) { if (FUNCTION_WORDS.has(w)) { if (cur.length) out.push(cur); cur = []; } else cur.push(w); }
    if (cur.length) out.push(cur);
  }
  return out;
};

/**
 * Pure. The lesson's concepts: multi-word first (KNOWN phrases found in the lesson text, then adjacent content words
 * with a distinctive word in them, from the title, objective and key concepts), then distinctive single words.
 * Duplicates (same words, same stem) are removed. Generic words are never a concept on their own.
 */
export function lessonConcepts(ctx: LessonContext): Concept[] {
  const sources = [ctx.title, ctx.objective, ...(ctx.concepts ?? []), ...(ctx.topics ?? []).slice(0, 8), ctx.question];
  const phrases: Concept[] = [], singles: Concept[] = [];
  const known = new Set<string>();
  const addPhrase = (tokens: string[], isKnown = false) => {
    if (isKnown) known.add(tokens.join(" "));
    if (tokens.length < 2 || tokens.length > 4 || phrases.some(p => p.tokens.length === tokens.length && p.tokens.every((t, i) => sameTopicWord(t, tokens[i])))) return;
    phrases.push({ text: tokens.join(" "), tokens, phrase: true });
  };
  const addSingle = (w: string) => {
    if (w.length < 3 || isGeneric(w) || singles.some(c => sameTopicWord(c.tokens[0], w))) return;
    singles.push({ text: w, tokens: [w], phrase: false });
  };
  const wholeStreams = sources.map(streamOf).filter(s => s.length);
  for (const stream of wholeStreams) for (const k of KNOWN) if (containsRun(stream, k)) addPhrase(k, true);
  for (const text of sources) for (const stream of runsOf(text)) {
    for (let n = 3; n >= 2; n--) for (let i = 0; i + n <= stream.length; i++) {
      const run = stream.slice(i, i + n);
      // A phrase needs at least one distinctive word.
      if (run.some(w => !isGeneric(w) && w.length >= 3)) addPhrase(run);
    }
    for (const w of stream) addSingle(w);
  }
  // A longer phrase makes its shorter AUTO parts redundant for matching and for the query. Known phrases always stay.
  const kept = phrases.filter(p => known.has(p.text) || !phrases.some(q => q !== p && q.tokens.length > p.tokens.length && containsRun(q.tokens, p.tokens)));
  return [...kept.slice(0, 6), ...singles.slice(0, 12)];
}

/** Pure. Every content word of the lesson, as a set: what the lesson is allowed to mention. */
export const lessonVocabulary = (ctx: LessonContext): string[] =>
  [...new Set([ctx.title, ctx.objective, ...(ctx.concepts ?? []), ...(ctx.topics ?? []), ctx.question].flatMap(streamOf))];

/**
 * Pure. Clinical-specialty and drug words. An item that is full of them while the lesson names none of them is about
 * something else (an ICU sedation guideline in a lesson on a quality model). Configuration-free on purpose: they only
 * ever COUNT AGAINST an item, and only while the lesson does not use the word itself.
 */
export const SPECIALTY_TERMS: readonly string[] = [
  "icu", "intensive", "sedation", "sedative", "sedatives", "delirium", "agitation", "analgesia", "analgesic", "anesthesia", "anaesthesia", "anesthetic", "ventilation", "ventilator", "ventilated",
  "intubation", "extubation", "opioid", "opioids", "propofol", "dexmedetomidine", "midazolam", "benzodiazepine", "benzodiazepines", "haloperidol", "antipsychotic", "vasopressor",
  "chemotherapy", "oncology", "tumour", "tumor", "carcinoma", "cardiac", "myocardial", "arrhythmia", "stroke", "sepsis", "septic", "neonatal", "neonate", "paediatric", "pediatric",
  "obstetric", "pregnancy", "surgery", "surgical", "postoperative", "perioperative", "dialysis", "diabetes", "diabetic", "insulin", "hypertension", "asthma", "copd", "pneumonia",
  "dose", "dosing", "dosage", "mg", "randomised", "randomized", "placebo", "mortality", "hospitalised", "hospitalized",
];
const SPECIALTY = new Set(SPECIALTY_TERMS);

/** Pure. The research query for a lesson: quoted phrases first, then distinctive words not already in a phrase. Words only. */
export function buildResearchQuery(ctx: LessonContext, limits: { phrases?: number; words?: number } = {}): string {
  const concepts = lessonConcepts(ctx);
  const phrases = concepts.filter(c => c.phrase).slice(0, limits.phrases ?? 2);
  const inPhrase = (w: string) => phrases.some(p => p.tokens.some(t => sameTopicWord(t, w)));
  const words = concepts.filter(c => !c.phrase && !inPhrase(c.tokens[0])).slice(0, limits.words ?? 3);
  return [...phrases.map(p => `"${p.text}"`), ...words.map(w => w.text)].join(" ");
}

export type RelevanceScore = { score: number; net: number; distinct: number; phrases: number; titleHit: boolean; penalty: number; pass: boolean };

/** Authority of what the item is, as PubMed types it: guideline and systematic review above review above trial above the rest. */
export function authorityOf(item: Pick<ResearchItem, "pubTypes">): number {
  const t = (item.pubTypes ?? []).map(x => x.toLowerCase());
  if (t.some(x => /guideline|consensus/.test(x))) return 4;
  if (t.some(x => /systematic review|meta-analysis/.test(x))) return 4;
  if (t.some(x => x === "review")) return 3;
  if (t.some(x => /trial/.test(x))) return 2;
  return t.length ? 1 : 0;
}

/**
 * Pure. How an item matches a lesson. Points: a single concept in the title 2, in the abstract 1; a phrase in the title
 * 3, in the abstract 2. Penalty: each specialty word the lesson never mentions, 2 in the title, 0.5 in the abstract (at
 * most 6). It passes with (standard) two distinctive concepts, or one phrase, or -- when the lesson has one concept
 * only -- that one; and a net score of 2. Strict also needs the title to carry a concept, a phrase or three concepts, and a net score of 3.
 */
export function scoreRelevance(item: Pick<ResearchItem, "title" | "abstract">, concepts: readonly Concept[], vocabulary: readonly string[], level: RelevanceLevel = DEFAULT_RELEVANCE): RelevanceScore {
  const title = streamOf(item.title), abstract = streamOf(item.abstract);
  let score = 0, distinct = 0, phrases = 0, titleHit = false;
  const singles = concepts.filter(c => !c.phrase);
  for (const c of concepts) {
    const inTitle = c.phrase ? containsRun(title, c.tokens) : hasWord(title, c.tokens[0]);
    const inAbstract = !inTitle && (c.phrase ? containsRun(abstract, c.tokens) : hasWord(abstract, c.tokens[0]));
    if (!inTitle && !inAbstract) continue;
    score += c.phrase ? (inTitle ? 3 : 2) : inTitle ? 2 : 1;
    if (c.phrase) phrases++; else distinct++;
    if (inTitle) titleHit = true;
  }
  const vocab = vocabulary.map(w => w.toLowerCase());
  const known = (w: string) => vocab.some(v => sameTopicWord(v, w));
  const mismatched = (stream: readonly string[]) => [...new Set(stream.filter(w => SPECIALTY.has(w) && !known(w)))];
  const inTitleMismatch = mismatched(title), inAbstractMismatch = mismatched(abstract).filter(w => !inTitleMismatch.includes(w));
  const penalty = Math.min(6, inTitleMismatch.length * 2 + inAbstractMismatch.length * 0.5);
  const net = score - penalty;
  const enough = (n: number) => distinct >= Math.min(n, singles.length) && singles.length > 0;
  const pass = level === "strict" ? titleHit && (phrases >= 1 || enough(3)) && net >= 3 : (phrases >= 1 || enough(2)) && net >= 2;
  return { score, net, distinct, phrases, titleHit, penalty, pass };
}

/** Pure. The items that are relevant to the lesson, best first: by relevance, then authority, then the engine's own order. */
export function rankRelevant<T extends Pick<ResearchItem, "title" | "abstract" | "pubTypes">>(items: readonly T[], ctx: LessonContext, level: RelevanceLevel = DEFAULT_RELEVANCE): { kept: { item: T; index: number; relevance: RelevanceScore }[]; dropped: number } {
  const concepts = lessonConcepts(ctx), vocab = lessonVocabulary(ctx);
  if (!concepts.length) return { kept: [], dropped: items.length };
  const scored = items.map((item, index) => ({ item, index, relevance: scoreRelevance(item, concepts, vocab, level) }));
  const kept = scored.filter(s => s.relevance.pass).sort((a, b) => b.relevance.net - a.relevance.net || authorityOf(b.item) - authorityOf(a.item) || a.index - b.index);
  return { kept, dropped: items.length - kept.length };
}
