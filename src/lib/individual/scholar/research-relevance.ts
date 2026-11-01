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
/** `alts`: other ways the same idea is written (research-relevance EQUIVALENTS), as token runs. Matching accepts any of them. */
export type Concept = { text: string; tokens: string[]; phrase: boolean; alts?: string[][]; idea?: boolean };

/** Function words and lesson-instruction words: never a concept, and skipped when looking for a phrase. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set((
  "the and for with from that this what when which into about their there these those have has had been were was are how why who does did can could should would will may might must not but its our your you they them than then also such each other "
  + "of in on to a an or by as at is it be if so no vs via per use used using "
  + "explain teach tell give show please help understand understanding notes note section step lesson learn learning more simply example examples summary summarise summarize deeper detail detailed "
  + "including include includes included objective objectives describe discuss identify outline apply evaluate assess assessing plan planning recognise recognize compare demonstrate able learner student topic topics key concept concepts introduction overview basics basic"
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

/** British spellings the sources and lessons mix with American ones, written to one form. Deterministic, a closed list. */
const UK_US: Readonly<Record<string, string>> = {
  centre: "center", centres: "centers", centred: "centered", programme: "program", programmes: "programs", paediatric: "pediatric", paediatrics: "pediatrics",
  anaesthesia: "anesthesia", anaesthetic: "anesthetic", anaesthetics: "anesthetics", oedema: "edema", haemorrhage: "hemorrhage", haematology: "hematology", tumour: "tumor", tumours: "tumors",
  behaviour: "behavior", behaviours: "behaviors", behavioural: "behavioral", labour: "labor", colour: "color", favour: "favor", judgement: "judgment", ageing: "aging",
  catalogue: "catalog", defence: "defense", licence: "license", practise: "practice", paralyse: "paralyze", leukaemia: "leukemia", diarrhoea: "diarrhea", foetal: "fetal", foetus: "fetus",
  oesophagus: "esophagus", orthopaedic: "orthopedic", gynaecology: "gynecology", analyse: "analyze", analysed: "analyzed", analyses: "analyses", analysing: "analyzing", counselling: "counseling",
};
const IZE = /^(organi|standardi|randomi|hospitali|recogni|minimi|optimi|utili|prioriti|categori|summari|speciali|generali|stabili|immuni|sterili|individuali|institutionali|normali|characteri|visuali|mobili|digiti|operationali|conceptuali|personali|centrali|formali|harmoni)s(e|ed|es|ing|ation|ations)$/;
export const canonWord = (w: string): string => UK_US[w] ?? w.replace(IZE, "$1z$2");

/** Words of a text in order, lowercased, accents removed. Digits-only tokens and one-letter tokens are dropped. */
export const wordsOf = (s: string | null | undefined): string[] =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 1 && !/^\d+$/.test(w)).map(canonWord);
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
 * Ideas that academic text writes in more than one way. Each group is one idea; the FIRST entry is the one searched for.
 * Small, explicit and deterministic (no model): a concept of the lesson that is any entry of a group is also matched by every
 * other entry in a source, and a lesson that uses one entry has the group's first entry as a concept. Spelling variants
 * (centre/center) and plurals are handled apart (canonWord, sameTopicWord), so they are not repeated here.
 */
export const EQUIVALENTS: readonly (readonly string[])[] = [
  ["donabedian", "donabedian model", "structure process outcome", "structure outcome process", "structure process and outcome", "structure-process-outcome model", "structure process outcome model", "donabedian framework"],
  ["quality improvement", "improvement science", "qi", "continuous quality improvement", "quality improvement science", "quality improvement methods", "continuous improvement", "improvement methodology"],
  ["pdsa", "plan do study act", "plan-do-study-act", "plan do check act", "pdca", "model for improvement", "pdsa cycle", "pdsa cycles"],
  ["process measures", "process measure", "process indicators", "process indicator", "process metrics", "process of care measures"],
  ["outcome measures", "outcome measure", "outcome indicators", "outcome indicator", "health outcomes", "patient outcomes", "clinical outcomes", "outcome metrics"],
  ["structure measures", "structural measures", "structure indicators", "structural indicators"],
  ["patient safety", "safety culture", "culture of safety", "safety management", "patient safety culture"],
  ["root cause analysis", "rca", "root cause investigation"],
  ["person centred care", "patient centred care", "person centered care", "patient centered care", "person-centred care", "patient-centred care"],
  ["clinical audit", "audit and feedback", "audit cycle", "quality audit"],
  ["evidence based practice", "evidence-based practice", "ebp", "evidence based medicine", "evidence-based medicine"],
  ["failure mode and effects analysis", "fmea", "failure modes and effects analysis", "failure mode effects analysis"],
  ["adverse event", "adverse events", "preventable harm", "patient harm", "harm events"],
  ["lean methodology", "lean thinking", "lean healthcare", "toyota production system"],
  ["six sigma", "lean six sigma", "dmaic"],
  ["run chart", "run charts", "statistical process control", "spc chart", "control chart", "control charts"],
];
const EQ: readonly string[][][] = EQUIVALENTS.map(g => g.map(v => wordsOf(v).filter(w => !FUNCTION_WORDS.has(w)))).map(g => g.filter(r => r.length));
const sameRun = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((w, i) => sameTopicWord(w, b[i]));
/** Pure. The other ways of writing the idea a concept (a token run) stands for; [] when it is in no group. */
export function altsFor(tokens: readonly string[]): string[][] {
  const out: string[][] = [];
  for (const g of EQ) if (g.some(v => sameRun(v, tokens))) for (const v of g) if (!sameRun(v, tokens) && !out.some(o => sameRun(o, v)) && (v.length > 1 || v[0].length >= 4)) out.push(v);
  return out;
}

/**
 * Pure. The lesson's concepts: multi-word first (KNOWN phrases found in the lesson text, then adjacent content words
 * with a distinctive word in them, from the title, objective and key concepts), then distinctive single words.
 * Duplicates (same words, same stem) are removed. Generic words are never a concept on their own.
 */
export function lessonConcepts(ctx: LessonContext): Concept[] {
  // A single word that is the name of a curated idea (Donabedian, PDSA) is an IDEA: it counts like a phrase when a source has it.
  return lessonConceptsRaw(ctx).map(c => { const alts = altsFor(c.tokens); return alts.length ? { ...c, alts, ...(c.phrase ? {} : { idea: true }) } : c; });
}
function lessonConceptsRaw(ctx: LessonContext): Concept[] {
  const sources = [ctx.title, ctx.objective, ...(ctx.concepts ?? []), ...(ctx.topics ?? []).slice(0, 8), ctx.question];
  const phrases: Concept[] = [], singles: Concept[] = [];
  const known = new Set<string>();
  // `display`: the phrase as people write it, function words kept ("quality of care"), which is what a search must quote.
  const addPhrase = (tokens: string[], isKnown = false, display?: string) => {
    if (isKnown) known.add(tokens.join(" "));
    if (tokens.length < 2 || tokens.length > 4 || phrases.some(p => p.tokens.length === tokens.length && p.tokens.every((t, i) => sameTopicWord(t, tokens[i])))) return;
    phrases.push({ text: display ? display.replace(/-/g, " ").toLowerCase() : tokens.join(" "), tokens, phrase: true });
  };
  const addSingle = (w: string) => {
    if (w.length < 3 || isGeneric(w) || singles.some(c => sameTopicWord(c.tokens[0], w))) return;
    singles.push({ text: w, tokens: [w], phrase: false });
  };
  const wholeStreams = sources.map(streamOf).filter(s => s.length);
  for (const stream of wholeStreams) KNOWN.forEach((k, n) => { if (containsRun(stream, k)) addPhrase(k, true, KNOWN_PHRASES[n]); });
  // A lesson that writes an idea any way a group lists it has the group's first entry as a concept (QI -> quality improvement).
  // The lesson's own wording is what is searched; a short acronym (QI) stands for the group's first entry.
  EQUIVALENTS.forEach((names, n) => {
    const g = EQ[n];
    const at = g.findIndex(v => wholeStreams.some(st => containsRun(st, v)));
    if (at < 0) return;
    const use = g[at].length > 1 || g[at][0].length >= 4 ? at : 0;
    if (g[use].length > 1) addPhrase(g[use], true, names[use]); else addSingle(g[use][0]);
  });
  for (const [ti, text] of sources.entries()) for (const stream of runsOf(text)) {
    for (let n = 3; n >= 2; n--) for (let i = 0; i + n <= stream.length; i++) {
      const run = stream.slice(i, i + n);
      // A phrase needs at least one distinctive word.
      // What the lesson's TITLE says is never dropped as redundant (ti 0).
      if (run.some(w => !isGeneric(w) && w.length >= 3)) addPhrase(run, ti === 0);
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

/**
 * Pure. The research query for a lesson: one quoted phrase (the lesson's own wording, function words kept) and up to two more
 * distinctive words that are not in it. Few terms on purpose: every term narrows the search, and five narrowed it to nothing. Words only.
 */
export function buildResearchQuery(ctx: LessonContext, limits: { phrases?: number; words?: number } = {}): string {
  const concepts = lessonConcepts(ctx);
  const phrases: Concept[] = [];
  for (const c of concepts.filter(x => x.phrase)) {
    if (phrases.length >= (limits.phrases ?? 1)) break;
    if (!phrases.some(p => p.tokens.some(t => c.tokens.some(u => sameTopicWord(t, u))))) phrases.push(c);
  }
  const inPhrase = (w: string) => phrases.some(p => p.tokens.some(t => sameTopicWord(t, w)));
  const words = concepts.filter(c => !c.phrase && !inPhrase(c.tokens[0])).slice(0, limits.words ?? 2);
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
  const singles = concepts.filter(c => !c.phrase && !c.idea);
  for (const c of concepts) {
    const found = (stream: readonly string[]) => (c.phrase ? containsRun(stream, c.tokens) : hasWord(stream, c.tokens[0])) || (c.alts ?? []).some(a => containsRun(stream, a));
    const inTitle = found(title);
    const inAbstract = !inTitle && found(abstract);
    if (!inTitle && !inAbstract) continue;
    score += c.phrase || c.idea ? (inTitle ? 3 : 2) : inTitle ? 2 : 1;
    if (c.phrase || c.idea) phrases++; else distinct++;
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

/** Why an item was not presented. Codes only: stored in the audit row, never shown with a title. */
export type ExcludedReason = "off_topic" | "specialty_mismatch" | "insufficient_concepts" | "model_declared_irrelevant";
/** A retrieved source that was excluded: its public ids (and title, for the in-memory result only) and why. */
export type ExcludedSource = { pmid: string | null; doi: string | null; title: string | null; reason: ExcludedReason };

/** Pure. Why a source that did not pass did not pass: nothing of the lesson in it, a foreign specialty over it, or too little of the lesson. */
export function exclusionReason(s: RelevanceScore): ExcludedReason {
  if (s.score <= 0) return "off_topic";
  if (s.penalty > 0 && s.score >= 2 && (s.phrases >= 1 || s.distinct >= 2)) return "specialty_mismatch";
  return "insufficient_concepts";
}

/** Pure. The items that are relevant to the lesson, best first: by relevance, then authority, then the engine's own order. The rest, with the reason. */
export function rankRelevant<T extends Pick<ResearchItem, "title" | "abstract" | "pubTypes">>(items: readonly T[], ctx: LessonContext, level: RelevanceLevel = DEFAULT_RELEVANCE): { kept: { item: T; index: number; relevance: RelevanceScore }[]; dropped: number; rejected: { item: T; index: number; reason: ExcludedReason }[] } {
  const concepts = lessonConcepts(ctx), vocab = lessonVocabulary(ctx);
  if (!concepts.length) return { kept: [], dropped: items.length, rejected: items.map((item, index) => ({ item, index, reason: "insufficient_concepts" as const })) };
  const scored = items.map((item, index) => ({ item, index, relevance: scoreRelevance(item, concepts, vocab, level) }));
  const kept = scored.filter(s => s.relevance.pass).sort((a, b) => b.relevance.net - a.relevance.net || authorityOf(b.item) - authorityOf(a.item) || a.index - b.index);
  const rejected = scored.filter(s => !s.relevance.pass).map(s => ({ item: s.item, index: s.index, reason: exclusionReason(s.relevance) }));
  return { kept, dropped: items.length - kept.length, rejected };
}

/**
 * Pure. Whether a research summary itself says its sources do not bear on the topic -- "the abstracts are not relevant to
 * the topic your notes cover ... no findings can be meaningfully added [E1] [E2]". Deterministic: a phrase of
 * irrelevance with an [E n] citation within a sentence's reach of it. Such a summary must cite nothing.
 */
const IRRELEVANCE = /\b(?:(?:is|are|was|were|seems?|appears?|remains?)\s+(?:also\s+)?not\s+(?:directly\s+|clearly\s+|particularly\s+|really\s+)?(?:relevant|applicable|related|pertinent)|(?:not|n't)\s+(?:directly\s+)?(?:relevant|applicable|pertinent)\s+to|irrelevant|unrelated|(?:do|does|did)\s+not\s+(?:directly\s+)?(?:address|cover|concern|relate\s+to|speak\s+to|bear\s+on)\s+(?:the|this|your|that)\s+(?:topic|lesson|notes?|subject|material|question|model)|(?:no|nothing)\b[^.]{0,60}\b(?:can|could)\s+be\s+(?:meaningfully\s+)?(?:added|drawn|said|concluded)|cannot\s+(?:be\s+)?meaningfully|can(?:no|')t\s+(?:be\s+)?meaningfully|no\s+(?:research\s+)?(?:findings?|evidence)\s+(?:is|are)?\s*(?:directly\s+)?relevant)/i;
export function declaresIrrelevant(text: string | null | undefined): boolean {
  const t = text ?? "";
  const re = new RegExp(IRRELEVANCE.source, "gi");
  for (const m of t.matchAll(re)) {
    const at = m.index ?? 0;
    // A citation in the same sentence, or the tag written after its full stop.
    const after = t.slice(at, at + 260), before = t.slice(Math.max(0, at - 160), at);
    const sentenceEnd = after.search(/[.!?](?=\s|$)/);
    const reach = sentenceEnd < 0 ? after : after.slice(0, sentenceEnd + 1) + (after.slice(sentenceEnd + 1).match(/^\s*(?:\[E\d+\]\s*)+/)?.[0] ?? "");
    if (/\[E\d+\]/.test(reach) || /\[E\d+\][^.!?]*$/.test(before)) return true;
  }
  return false;
}
