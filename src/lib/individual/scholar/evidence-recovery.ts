/* eslint-disable @typescript-eslint/no-explicit-any */
// ── EVIDENCE RECOVERY ── SCHOLAR-SQIE-02 s5-8 and s14 (owner, 30 Oct 2026) ─────────────────────────────────────────────
//
// "Search first where possible, use AI where it adds educational value, and never substitute unsupported confidence
// for evidence." When an answer was withheld (the grounding check could not tie it to the notes) or the notes were not
// enough, this finds what CAN be stood on. It is a COORDINATOR, not an engine: every read below is an existing one.
//
//   1. the learner's own notes        store.searchCandidates + retrieval.rankChunks (their user id first, Postgres FTS)
//   2. the Competen governed library  learn.governedReferences / learn.libraryReferences (approved CFCA content) and
//                                     cases/library.findLibraryCases (published, approved for their exact version)
//   3. external scholarly sources     learn-research.learnResearch -> the Research & Evidence Engine (registry, one gate,
//                                     budgets, Crossref verification, cache, usage). ONLY when the learner chose
//                                     "notes_and_references", HQ offers it (scholar_recovery_external), the source is
//                                     enabled for Scholar (scholar_recovery_providers) AND the engine has it Active.
//
// ⚠ NO AI HERE. The sufficiency decision is deterministic (key terms of the question found in the evidence). When there
// IS evidence, the caller may ask its OWN, already-approved AI activity to explain from it (generationInputs), through
// its own grounding check -- never a relabel to a lower-risk activity. When there is not, the learner gets reading
// suggestions and what remains unanswered: never an answer.
//
// ⚠ PRIVACY. Nothing of the learner's notes leaves Competen. External sources receive only topicKeywords(question):
// topic words, deterministically extracted, with names, numbers and dates removed, then screened again by the engine.
//
// ⚠ LABELS ARE WHAT WAS RETRIEVED. An external reference is "details only" (metadata) or "abstract only". Full text is
// never fetched (engine FIXED_RULES), so nothing here is ever labelled full text; an open-access copy is a LINK.
//
// ⚠ TRACKING. Each recovery is one plat_ai_outcomes row (migration 600, no new schema): activity evidence_recovery,
// output kind "other" (so it never counts as an explanation), codes only. The caller records the final result of an
// explanation from recovered evidence (recordRecoveryResult), linked by a digest of the recovery id. HQ reads
// summariseRecovery: the safe-withholding rate apart from the answer rate, and what recovery achieved.

import { randomUUID } from "node:crypto";
import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import { findLibraryCases } from "@/lib/cases/library";
import { nonDelivery, recordAiOutcome, sha256Hex, type AiOutcome, type Sufficiency as OutcomeSufficiency } from "@/lib/ai/outcomes";
import type { IndividualContext } from "../guard";
import { RECOVERY_MODES, type IndividualPolicy, type RecoveryMode, type RecoveryProvider } from "../policy";
import { DEFAULT_QUALITY, NOT_USED_REASONS, gateResearch, qualityOf, type EvidenceQuality, type NotUsedReason } from "./source-quality";
import { RECOVERY_ACTION_LABEL, RECOVERY_EXPLANATION_LABEL, RECOVERY_ORIGIN_LABEL, RECOVERY_PROMPT, RECOVERY_RETRIEVED_LABEL, RETRIEVAL_LIMIT } from "./config";
import { rankChunks, searchTerms, spreadAcrossMaterials, toTsQuery } from "./retrieval";
import { termCovered, termIndex } from "./term-match";
import { listExamPapers, searchCandidates, toPassages } from "./store";
import { passageCitation, type GovernedReference, type Passage, type ResearchEvidence } from "./generation";
import { governedReferences, libraryReferences, referenceSource } from "./learn";
import { loadLearnerCatalogue } from "./competency-view";
import { externalReferences, learnResearch, researchEvidence, scholarResearchOperational, type ExternalReference, type LearnResearch, type ResearchNarrowing } from "./learn-research";

export const RECOVERY_OPERATION = "individual_scholar_evidence_recovery";
export const RECOVERY_VERSION = "evidence-recovery-v1";

/** The student-facing words live in config.ts (shared with the page). */
export { RECOVERY_PROMPT, RECOVERY_ACTION_LABEL };
export const ORIGIN_LABEL = RECOVERY_ORIGIN_LABEL;
export const RETRIEVED_LABEL = RECOVERY_RETRIEVED_LABEL;
export type RecoveryAction = keyof typeof RECOVERY_ACTION_LABEL;

// ── TYPES ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EvidenceOrigin = "notes" | "library" | "external";
/** What was actually retrieved for an external reference. Full text only if full text was retrieved -- never today. */
export type Retrieved = keyof typeof RETRIEVED_LABEL;

export type NotesEvidence = {
  origin: "notes"; tag: string; chunkId: string; materialId: string; materialTitle: string; citation: string; excerpt: string;
  /** The question's key terms this passage contains. */
  matched: string[];
};
export type LibraryEvidence = {
  origin: "library"; tag: string; kind: "competency" | "case";
  /** The library item: a competency id, or a case's version id (its exact approved version). */
  itemId: string; version: string | null; code: string | null; title: string;
  /** The competency outcome named, where one was. */
  outcome: string | null;
  text: string; status: string; approved: boolean;
  matched: string[];
};
export type ExternalEvidence = {
  origin: "external"; tag: string | null; provider: string; title: string; authors: string[]; journal: string | null; year: number | null;
  doi: string | null; pmid: string | null; url: string; licence: string | null; retrieved: Retrieved; excerpt: string | null;
  /** Shown references are always verified (a PMID from PubMed or a DOI Crossref confirmed); unverified ones are dropped. */
  verification: "verified";
  /**
   * May ground an explanation: an abstract, a verified identity AND Scholar's source-quality rules (indexed, publication
   * type, on topic). Details-only references and those the rules stopped are reading, never evidence.
   */
  evidence: boolean;
  /** Why the engine's evidence was not used to explain (the first source-quality rule it failed). null otherwise. */
  notUsed: NotUsedReason | null;
  openAccess: { url: string; licence: string | null } | null;
  matched: string[];
};
export type EvidenceItem = NotesEvidence | LibraryEvidence | ExternalEvidence;
export type ReadingLink = { kind: "search_link" | "guideline"; label: string; url: string };

export type SufficiencyVerdict = {
  verdict: "sufficient" | "partial" | "insufficient";
  keyTerms: string[];
  covered: string[];
  /** What remains unanswered: the key terms no evidence item contains. */
  unanswered: string[];
  /** Whether any item may ground an explanation. Only then may the caller ask its AI activity to explain. */
  canExplain: boolean;
};

export type ExternalStatus = { ran: boolean; reason: "not_chosen" | "off" | "no_source" | "unavailable" | "refused" | "ran"; state: LearnResearch["state"] | null; dropped: number };
export type RecoveryState = "explanation_available" | "reading_only" | "unanswered";

export type RecoveryResult = {
  recoveryId: string;
  mode: RecoveryMode;
  prompt: string;
  evidence: { notes: NotesEvidence[]; library: LibraryEvidence[]; external: ExternalEvidence[] };
  reading: ReadingLink[];
  sufficiency: SufficiencyVerdict;
  state: RecoveryState;
  actions: { action: RecoveryAction; label: string; mode?: RecoveryMode }[];
  external: ExternalStatus;
  /** Whether Explain using approved references may be offered (evidence, and an approved reference among it). */
  explainable: boolean;
  /** What the caller's own AI activity may be given, only when explainable. */
  generation: GenerationInputs | null;
};

// ── PURE: MODES AND SETTINGS ──────────────────────────────────────────────────────────────────────────────────────

const MODE_ALIAS: Record<string, RecoveryMode> = { notes: "notes_only", library: "notes_and_library", research: "notes_and_references" };
/** Pure. A mode from a request: the recovery modes, or Learn's own words for them. Anything else is the fallback. */
export function parseRecoveryMode(v: unknown, fallback: RecoveryMode): RecoveryMode {
  if (typeof v !== "string") return fallback;
  if ((RECOVERY_MODES as readonly string[]).includes(v)) return v as RecoveryMode;
  return MODE_ALIAS[v] ?? fallback;
}

/** The external sources that SEARCH (the others verify, link or point). */
const SEARCH_PROVIDERS: readonly RecoveryProvider[] = ["pubmed", "openalex"];

export type TierPlan = { notes: true; library: boolean; external: boolean; externalReason: ExternalStatus["reason"]; guidelines: boolean; quality: EvidenceQuality };

/**
 * Pure. Which tiers run, in order. Notes and the approved Competen library always (neither leaves Competen; in notes-only
 * mode the library is what "approved references" can mean). External only when the learner chose references AND HQ
 * offers it AND a search source is enabled for Scholar AND the engine has research operational (and Learn offers
 * Research & Explain, whose per-learner limits it shares). Notes-only never runs an external tier.
 */
export function tierPlan(mode: RecoveryMode, policy: Pick<IndividualPolicy, "scholarRecovery" | "scholarResearch">, engineOperational: boolean): TierPlan {
  const r = policy.scholarRecovery;
  const library = true;
  const chosen = mode === "notes_and_references";
  const reason: ExternalStatus["reason"] = !chosen ? "not_chosen" : r.external !== "offer" ? "off"
    : !r.providers.some(p => SEARCH_PROVIDERS.includes(p)) ? "no_source"
      : !engineOperational || !policy.scholarResearch.modes.includes("research") ? "unavailable" : "ran";
  return {
    notes: true, library, external: reason === "ran", externalReason: reason, guidelines: chosen && r.external === "offer" && r.providers.includes("guidelines"),
    quality: qualityOf(r),
  };
}

/** Whether a wider tier than `mode` could run at all, and which mode it is. */
export function widerMode(mode: RecoveryMode, policy: Pick<IndividualPolicy, "scholarRecovery" | "scholarResearch">, engineOperational: boolean): RecoveryMode | null {
  // Notes only is the learner's choice: recovery never widens it to external sources.
  if (mode === "notes_and_library") return tierPlan("notes_and_references", policy, engineOperational).external ? "notes_and_references" : null;
  return null;
}

/** Pure. The engine narrowing for Scholar's own recovery settings: enabled sources only, its result and time limits. */
export const recoveryNarrowing = (r: IndividualPolicy["scholarRecovery"]): ResearchNarrowing =>
  ({ providers: r.providers.filter(p => p !== "guidelines"), maxResults: r.maxResults, timeoutMs: r.timeoutMs });

// ── PURE: WHAT LEAVES COMPETEN ────────────────────────────────────────────────────────────────────────────────────

const MONTH = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|tomorrow)$/i;
const TIME_WORDS = /^(years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|old|ago|aged?|yo|born|dob)$/i;
const HONORIFIC = /\b(?:[Mm]rs?|[Mm]s|[Mm]iss|[Mm]x|[Dd]r|[Pp]rof|[Ss]ir|[Mm]adam|[Ss]ister|[Nn]urse|[Pp]atient|[Cc]lient|[Bb]aby|[Mm]aster|[Mm]other|[Ff]ather)\.?\s+(?:\p{Lu}[\p{L}'’-]*\s*)+/gu;
/** A capitalised word followed by one of these is an eponym (Parkinson disease, Glasgow Coma Scale): kept. */
const EPONYM_NOUN = /^(disease|syndrome|sign|signs|test|score|scale|criteria|classification|reflex|triad|law|manoeuvre|maneuver|position|palsy|phenomenon|ulcer|fracture|tumou?r|lymphoma|sarcoma|procedure|method|formula|equation|index|questionnaire|model|cycle|stage|stages|coma|chart|tool|guideline|guidelines|protocol|bundle)$/i;
/** A capitalised word at the start of a sentence followed by one of these is a person ("Sarah presented with ..."). */
const PERSON_VERB = /^(has|had|is|was|presents|presented|presenting|complains|complained|reports|reported|came|attended|attends|says|said|told|went|feels|felt|developed|takes|took|lives|lived|underwent)$/i;

/**
 * Pure. The ONLY text an external source ever receives: the question's topic keywords. Deterministic. Removed: e-mail
 * addresses, links, every token starting with a digit (numbers, ages, doses, identifiers), dates and month or day
 * names, durations, a title and the names after it (Mr Okello ...), and other capitalised words that look like names.
 * Kept: lower-case topic words, acronyms (COPD) and eponyms followed by their noun (Parkinson's disease). Then the
 * retrieval stop words go and at most eight words remain. A question that still looks like it identifies a patient
 * after all that gives nothing.
 */
export function topicKeywords(question: string, max = 8): { ok: true; keywords: string[] } | { ok: false; reason: "empty" | "identifier" } {
  if (findPatientIdentifiers(question).length) return { ok: false, reason: "identifier" };
  const scrubbed = question
    .replace(/\S+@\S+/g, " ").replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/g, " ")
    .replace(HONORIFIC, " ");
  const kept: string[] = [];
  for (const sentence of scrubbed.split(/(?<=[.!?;:])\s+|\n+/)) {
    const toks = sentence.match(/[\p{L}\d][\p{L}\d'’-]*/gu) ?? [];
    toks.forEach((t, i) => {
      if (/^\d/.test(t) || MONTH.test(t) || TIME_WORDS.test(t)) return;
      const bare = t.replace(/['’]s$/i, "");
      const next = toks[i + 1] ?? "";
      const acronym = /^[A-Z][A-Z0-9]+$/.test(bare) && /[A-Z].*[A-Z]|[A-Z]\d/.test(bare);
      const capitalised = /^\p{Lu}/u.test(bare) && !acronym;
      if (capitalised) {
        if (EPONYM_NOUN.test(next)) { kept.push(bare); return; } // Parkinson's disease, Glasgow Coma Scale
        if (i > 0 || /['’]s$/i.test(t)) return; // a capitalised word inside a sentence, or a possessive: a name, never sent
        if ((/^\p{Lu}/u.test(next) && !EPONYM_NOUN.test(toks[i + 2] ?? "")) || PERSON_VERB.test(next)) return; // "Sarah Nambi ..." / "Sarah has ..."
      }
      kept.push(bare);
    });
  }
  // SQIE D-3: question labels and command words are not topics either (questionTopicText).
  const words = searchTerms(questionTopicText(kept.join(" "))).filter(w => !/^\d/.test(w) && !TIME_WORDS.test(w) && !MONTH.test(w)).slice(0, max);
  if (!words.length) return { ok: false, reason: "empty" };
  return { ok: true, keywords: words };
}

// ── PURE: MATCHING, LABELS AND SUFFICIENCY ────────────────────────────────────────────────────────────────────────

// SQIE D-3 (staging 30 Oct): a paper question "Question 1: antibiotic choice in pyelonephritis" gave the key terms
// question, 1, antibiotic, choice, pyelonephritis -- its numbering searched for, and matched, like a topic.
/** Question labels and numbering: never a topic, wherever they stand ("Question 1", "(2 marks)", "Part b", "(iii)"). */
const QUESTION_LABEL = /^(questions?|q\d*[a-z]?|parts?|marks?|answers?|i{1,3}|iv|vi{0,3}|ix|xi{0,2}|\d+[a-z]?)$/i;
/** Generic command words: never a topic. */
const COMMAND_WORD = /^(explain|describe|list|outline|discuss|why|how|what|define|identify|briefly)$/i;
/** Command words that are also clinical words ("mental state"): dropped only where they open a clause ("State two ..."). */
const LEADING_COMMAND = /^(state|name|give)$/i;

/** Pure. A question without its labels, numbering and command words: the words that say what it is about. */
export function questionTopicText(question: string): string {
  return question.split(/(?<=[.!?;:\n()])|(?=[(])/).map(clause => {
    let lead = true;
    return clause.split(/(\s+)/).filter(tok => {
      const w = tok.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
      if (!w) return true;
      const drop = QUESTION_LABEL.test(w) || COMMAND_WORD.test(w) || (lead && LEADING_COMMAND.test(w));
      if (!drop) lead = false;
      return !drop;
    }).join("");
  }).join(" ");
}

/** The question's key terms, as retrieval reads them, without labels, numbering or command words (SQIE D-3). */
export const keyTermsOf = (question: string) => searchTerms(questionTopicText(question));
/**
 * Pure. The key terms a text contains: by prefix, as retrieval ranks, and (SCHOLAR-GUIDED-LEARNING-01) by root, curated
 * variant and abbreviation (term-match.ts termCovered). Deterministic, no AI. Numbers stay literal.
 */
export function matchedTerms(text: string, terms: readonly string[]): string[] {
  const ix = termIndex(text);
  return terms.filter(t => termCovered(t, ix));
}

/**
 * Pure. What an external record's retrieval actually was. Full text only when full text was retrieved (the engine never
 * does); an abstract is never full text and metadata is never an abstract.
 */
export function retrievedOf(x: { abstract?: string | null; excerpt?: string | null; fullText?: string | null }): Retrieved {
  if (typeof x.fullText === "string" && x.fullText.trim()) return "full_text";
  if ((typeof x.abstract === "string" && x.abstract.trim()) || (typeof x.excerpt === "string" && x.excerpt.trim())) return "abstract";
  return "metadata";
}

// ── PURE: SOURCE QUALITY ── SCHOLAR-SOURCE-QUALITY-01: the ONE gate lives in source-quality.ts (shared with Learn). ──
export { GENERIC_TOPIC_WORDS, NEVER_EVIDENCE_TYPES, evidenceGate, onTopic, sameTopicWord, specificTerms, typeVerdict } from "./source-quality";
export { DEFAULT_QUALITY, NOT_USED_REASONS, gateResearch, type EvidenceQuality, type NotUsedReason };

/**
 * Pure. The engine's shown references as evidence items: verified only, labelled by what was retrieved. Only those that
 * pass Scholar's source-quality gate are evidence (tagged E1 ... in the order the AI is given them); an item the gate
 * stopped stays in the list as reading -- untagged, without an excerpt, with the code of the rule it failed.
 * `keywords`: the question's de-identified key terms (topicKeywords), for the topic check.
 */
export function externalEvidence(research: LearnResearch, terms: readonly string[], q: EvidenceQuality = DEFAULT_QUALITY, keywords: readonly string[] = terms): ExternalEvidence[] {
  const gated = gateResearch(research, keywords, q);
  return externalReferences(gated).map((r: ExternalReference) => {
    const item = gated.items.find(i => i.url === r.url);
    // retrievedOf reads the item as the provider gave it: an abstract the engine holds is "abstract", never more.
    const retrieved = retrievedOf({ abstract: item?.abstract ?? null, excerpt: r.excerpt });
    return {
      origin: "external" as const, tag: r.tag, provider: r.provider, title: r.title, authors: r.authors, journal: r.journal, year: r.year,
      doi: r.doi, pmid: r.pmid, url: r.url, licence: gated.licensing[item?.provider ?? ""] ?? null, retrieved, excerpt: r.excerpt,
      verification: "verified" as const, evidence: r.evidence && retrieved === "abstract", notUsed: r.notUsed,
      openAccess: r.openAccess ? { url: r.openAccess.url, licence: r.openAccess.licence } : null,
      matched: matchedTerms(`${r.title} ${item?.abstract ?? ""}`, terms),
    };
  });
}

/**
 * Pure. THE DETERMINISTIC SUFFICIENCY DECISION. Evidence = a notes passage or library item containing at least one of
 * the question's key terms (an approved competency, not a case: a case is practice), or an external abstract with a
 * verified identity. Details-only references never count.
 *   sufficient    evidence covers at least 60% of the key terms
 *   partial       some evidence, less coverage
 *   insufficient  no evidence at all: reading suggestions and what remains unanswered, never an answer
 */
export function assessSufficiency(question: string, ev: RecoveryResult["evidence"]): SufficiencyVerdict {
  const keyTerms = keyTermsOf(question);
  const items = [
    ...ev.notes.filter(n => n.matched.length), ...ev.library.filter(l => l.kind === "competency" && l.approved && l.matched.length), ...ev.external.filter(e => e.evidence),
  ];
  // SCHOLAR-LEARN-FIX-01 (owner, 31 Oct), adjusting SQIE D-4: what is COVERED is what the shown evidence contains --
  // the learner's notes included -- so a term is never listed as unanswered while a note on screen says it (production
  // listed every term of a step as "not found" beside notes that held them). The verdict is that coverage.
  // What D-4 still decides: an explanation FROM RECOVERY (the wider tiers, beyond the learner's selected notes) needs
  // an approved reference among the evidence; the learner's notes alone never make canExplain (their own lesson, from
  // their selected material, is taught by Learn itself: groundingOutcome).
  const covered = keyTerms.filter(t => items.some(i => i.matched.includes(t)));
  const unanswered = keyTerms.filter(t => !covered.includes(t));
  const canExplain = items.length > 0 && keyTerms.length > 0 && hasApprovedReference(ev);
  return { verdict: groundingVerdict(covered.length, keyTerms.length), keyTerms, covered, unanswered, canExplain };
}

/** Pure. THE THREE OUTCOMES, one rule: sufficient at 60% of the key terms covered or more, partial below, insufficient at none. */
export const SUFFICIENT_COVERAGE = 0.6;
export const groundingVerdict = (covered: number, of: number): SufficiencyVerdict["verdict"] =>
  !of || !covered ? "insufficient" : covered / of >= SUFFICIENT_COVERAGE ? "sufficient" : "partial";

export type Grounding = { outcome: SufficiencyVerdict["verdict"]; keyTerms: string[]; covered: string[]; uncoveredTerms: string[] };

/**
 * Pure. SCHOLAR-LEARN-FIX-01: whether a lesson's (or a question's) key terms are in the passages it will be taught from.
 *   sufficient    teach
 *   partial       teach what is supported, name the uncovered terms, offer the wider tiers (evidence recovery)
 *   insufficient  nothing to teach from: the existing evidence recovery
 * The terms are matched by prefix, as retrieval ranks and as recovery's sufficiency reads them.
 */
export function groundingOutcome(terms: readonly string[], passages: readonly { content: string }[]): Grounding {
  const keyTerms = [...new Set(terms)];
  const text = passages.map(p => p.content).join("\n");
  const covered = passages.length ? matchedTerms(text, keyTerms) : [];
  return { outcome: groundingVerdict(covered.length, keyTerms.length), keyTerms, covered, uncoveredTerms: keyTerms.filter(t => !covered.includes(t)) };
}

/** Another material's section joins a lesson only when it holds this share of the lesson's key terms, and at least two. */
export const OTHER_MATERIAL_MIN_SHARE = 0.6;
export const OTHER_MATERIAL_MIN_TERMS = 2;

/**
 * Pure. SCHOLAR-LEARN-FIX-01: the sections to add to a thin or partly grounded lesson, best first, at most `limit`.
 * The SAME selected material(s) first: any section that holds a key term the lesson has not covered yet. Another of the
 * learner's uploads only when `others` is allowed (a source mode wider than My notes only) AND it is clearly relevant:
 * at least OTHER_MATERIAL_MIN_SHARE of the key terms and at least OTHER_MATERIAL_MIN_TERMS of them. Never one already
 * in the lesson, never an excluded material (an examination paper).
 */
export function relatedSections<T extends { id: string; materialId: string; ordinal: number; content: string }>(
  candidates: readonly T[], input: { have: readonly string[]; terms: readonly string[]; covered: readonly string[]; materialIds: readonly string[]; others: boolean; exclude?: ReadonlySet<string>; limit: number },
): T[] {
  const own = new Set(input.materialIds), have = new Set(input.have), missing = input.terms.filter(t => !input.covered.includes(t));
  const need = Math.max(OTHER_MATERIAL_MIN_TERMS, Math.ceil(input.terms.length * OTHER_MATERIAL_MIN_SHARE));
  const scored = candidates.filter(c => !have.has(c.id) && !input.exclude?.has(c.materialId)).map(c => {
    const m = matchedTerms(c.content, input.terms);
    return { c, inScope: own.has(c.materialId), all: m.length, adds: m.filter(t => missing.includes(t)).length };
  }).filter(s => (s.inScope ? s.adds > 0 || (!missing.length && s.all > 0) : input.others && s.all >= need));
  scored.sort((a, b) => Number(b.inScope) - Number(a.inScope) || b.adds - a.adds || b.all - a.all || a.c.ordinal - b.c.ordinal || a.c.id.localeCompare(b.c.id));
  return [...new Map(scored.map(s => [s.c.id, s.c])).values()].slice(0, input.limit);
}

/** Pure. An approved reference among the evidence: an approved Competen library entry or a verified external abstract. */
const hasApprovedReference = (ev: RecoveryResult["evidence"]) =>
  ev.library.some(l => l.kind === "competency" && l.approved && l.matched.length > 0) || ev.external.some(e => e.evidence);

/**
 * Pure. Whether "Explain using approved references" may be offered: there is evidence AND at least one approved
 * reference among it -- an approved Competen library entry or a verified external abstract. More of the learner's own
 * notes alone do not make it a references explanation (the notes were already not enough). In notes-only mode that
 * means approved library evidence, or nothing.
 */
export function explainable(s: SufficiencyVerdict, ev: RecoveryResult["evidence"]): boolean {
  return s.canExplain && hasApprovedReference(ev);
}

/** Pure. The recovery's state for tracking: an explanation is possible, there is reading only, or nothing. */
export const recoveryState = (canExplain: boolean, reading: number, details: number): RecoveryState =>
  canExplain ? "explanation_available" : reading + details > 0 ? "reading_only" : "unanswered";

/**
 * Pure. The actions offered, in order. Find learning resources when there is reading to show or a wider search the
 * learner may choose; Explain only when explainable; Continue with my notes always.
 */
export function suggestedActions(canExplain: boolean, wider: RecoveryMode | null, reading = 0): RecoveryResult["actions"] {
  return [
    ...(wider || reading > 0 ? [{ action: "find_resources" as const, label: RECOVERY_ACTION_LABEL.find_resources, ...(wider ? { mode: wider } : {}) }] : []),
    ...(canExplain ? [{ action: "explain_with_references" as const, label: RECOVERY_ACTION_LABEL.explain_with_references }] : []),
    { action: "continue_with_notes" as const, label: RECOVERY_ACTION_LABEL.continue_with_notes },
  ];
}

/**
 * What the caller's OWN approved AI activity may be given to explain from (runLearn's passages, references and research
 * evidence), only the items that are evidence. It is the caller's activity, risk classification and grounding check
 * that then decide; recovery never calls a model and never names a different activity. Null unless explainable.
 */
export type GenerationInputs = { chunkIds: string[]; references: GovernedReference[]; research: ResearchEvidence[] };
export function generationInputs(r: Pick<RecoveryResult, "evidence" | "sufficiency">, research: LearnResearch | null): GenerationInputs | null {
  if (!explainable(r.sufficiency, r.evidence)) return null;
  return {
    chunkIds: r.evidence.notes.filter(n => n.matched.length).map(n => n.chunkId),
    references: r.evidence.library.filter(l => l.approved && l.matched.length && l.kind === "competency")
      .map(l => ({ competencyId: l.itemId, title: l.title, code: l.code, outcome: l.outcome, status: l.status, approved: true, library: true })),
    research: research ? researchEvidence(research) : [],
  };
}

// ── THE COORDINATOR ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure. SQIE D-4: a passage with the question's own wording (four words or more: a question, not a topic name) taken
 * out. Shorter wording is left: a topic such as "respiratory failure" is what real notes say.
 */
const QUESTION_WORDING_MIN = 4;
const wordsOf = (s: string) => s.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/).filter(Boolean);
export function withoutQuestion(content: string, question: string): string {
  const q = wordsOf(questionTopicText(question));
  const c = wordsOf(content);
  if (q.length < QUESTION_WORDING_MIN) return c.join(" ");
  const out: string[] = [];
  for (let i = 0; i < c.length;) {
    if (q.every((w, k) => c[i + k] === w)) { i += q.length; continue; }
    out.push(c[i++]);
  }
  return out.join(" ");
}

/**
 * Pure. SQIE D-4: whether a passage merely restates the question -- the learner's own examination paper, or a heading
 * -- so that apart from the question's own wording it contains none of the key terms. Such a passage is not evidence.
 */
export const restatesOnly = (content: string, question: string, terms: readonly string[]): boolean =>
  terms.length > 0 && matchedTerms(withoutQuestion(content, question), terms).length === 0;

/** The three readers, injected so the order and the gating can be proven without a database or a network. */
export type RecoverySources = {
  /** The learner's notes for the question; `scope` (My notes only, in a Learn session) keeps the search to those materials. */
  notes: (question: string, scope?: { materialIds: readonly string[] } | null) => Promise<Passage[] | null>;
  library: (question: string, notes: readonly Passage[]) => Promise<Omit<LibraryEvidence, "tag" | "matched">[] | null>;
  external: (keywords: readonly string[]) => Promise<LearnResearch>;
  guidelines: () => ReadingLink[];
};
export type RecoveryInput = {
  question: string; mode: RecoveryMode; materialId?: string | null; sectionId?: string | null;
  /** A material the notes search must leave out: an examination paper is never evidence for its own questions. */
  excludeMaterialId?: string | null;
  /**
   * SCHOLAR-LEARN-FIX-01: the materials the learner selected (a Learn session's). In My notes only, notes evidence comes
   * from these alone -- another upload is never shown or used unless the learner chose a wider mode. In a wider mode
   * they come first. Absent (revision, papers, OSCE): the learner's notes as before.
   */
  scopeMaterialIds?: readonly string[] | null;
};
type Internal = { research: LearnResearch | null; passages: Passage[] };

/** The sequence, in order: notes, then the library, then (references only, and only if allowed) external sources. */
export async function runRecovery(input: RecoveryInput, plan: TierPlan, sources: RecoverySources, opts: { wider: RecoveryMode | null; recoveryId?: string }): Promise<RecoveryResult & Internal> {
  const terms = keyTermsOf(input.question);
  // 1. Notes. The section and material the learner was on come first when they match. An excluded material never counts.
  // In My notes only, a scoped session's notes come from its own materials alone (the reader is asked so, and held to it).
  const selected = new Set(input.scopeMaterialIds ?? []);
  const scoped = input.mode === "notes_only" && selected.size > 0;
  const passages = ((await sources.notes(input.question, scoped ? { materialIds: [...selected] } : null).catch(() => null)) ?? [])
    .filter(p => (!input.excludeMaterialId || p.materialId !== input.excludeMaterialId) && (!scoped || selected.has(p.materialId)));
  const first = (p: Passage) => (p.chunkId === input.sectionId ? 0 : p.materialId === input.materialId ? 1 : selected.has(p.materialId) ? 2 : 3);
  const ordered = [...passages].sort((a, b) => first(a) - first(b));
  const notes: NotesEvidence[] = ordered.map((p, i) => ({
    origin: "notes", tag: `N${i + 1}`, chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p),
    excerpt: p.content.slice(0, 400), matched: restatesOnly(p.content, input.question, terms) ? [] : matchedTerms(p.content, terms),
  }));
  // 2. The governed library (no external call).
  const lib = plan.library ? ((await sources.library(input.question, ordered).catch(() => null)) ?? []) : [];
  const library: LibraryEvidence[] = lib.map((l, i) => ({ ...l, tag: `L${i + 1}`, matched: matchedTerms(`${l.title} ${l.text}`, terms) }));
  // 3. External, only now and only if every gate allowed it. Only keywords leave.
  let research: LearnResearch | null = null, external: ExternalEvidence[] = [], dropped = 0;
  let status: ExternalStatus = { ran: false, reason: plan.externalReason, state: null, dropped: 0 };
  if (plan.external) {
    const k = topicKeywords(input.question);
    if (!k.ok) status = { ran: false, reason: "refused", state: "refused", dropped: 0 };
    else {
      // Fails soft: a source that cannot be reached leaves the notes and library results as they are.
      const found = await sources.external(k.keywords).catch(() => null);
      external = found ? externalEvidence(found, terms, plan.quality, k.keywords) : [];
      dropped = found ? found.items.length - external.length : 0;
      // SCHOLAR-SOURCE-QUALITY-01: from here on the research is the GATED one, so the AI is only ever given what passed.
      research = found ? gateResearch(found, k.keywords, plan.quality) : null;
      const ran = !!research && (research.state === "searched" || research.state === "cached" || research.state === "not_found");
      status = { ran, reason: ran ? "ran" : "unavailable", state: research?.state ?? "failed", dropped };
    }
  }
  const reading: ReadingLink[] = [
    ...(research?.scholarLink ? [{ kind: "search_link" as const, label: "Search Google Scholar for this topic", url: research.scholarLink }] : []),
    ...(plan.guidelines ? sources.guidelines() : []),
  ];
  const evidence = { notes, library, external };
  const sufficiency = assessSufficiency(input.question, evidence);
  const canExplain = explainable(sufficiency, evidence);
  // Reading, not evidence: details-only references and library cases (practice, never an explanation's source).
  // SCHOLAR-LEARN-FIX-01: notes that hold a key term are reading too, so the state never says "unanswered" beside them.
  const details = external.filter(e => !e.evidence).length + library.filter(l => l.kind === "case").length + notes.filter(n => n.matched.length).length;
  return {
    recoveryId: opts.recoveryId ?? randomUUID(), mode: input.mode, prompt: RECOVERY_PROMPT, evidence, reading, sufficiency, explainable: canExplain,
    state: recoveryState(canExplain, reading.length, details), actions: suggestedActions(canExplain, opts.wider, reading.length), external: status,
    generation: generationInputs({ evidence, sufficiency }, research), research, passages: ordered,
  };
}

/** The real readers, each an existing read path, every one keyed on the learner's own id. */
export function liveSources(ctx: IndividualContext, policy: IndividualPolicy, recoveryId: string): RecoverySources {
  return {
    async notes(question, scope) {
      const tsq = toTsQuery(question);
      if (!tsq) return [];
      const [found, papers] = await Promise.all([searchCandidates(ctx.admin, ctx.userId, tsq, scope?.materialIds.length ? { materialIds: scope.materialIds } : null), listExamPapers(ctx.admin, ctx.userId)]);
      // SQIE D-4: a prepared examination paper is the learner's questions, never notes that answer them. Unreadable
      // papers: no notes evidence at all (fail closed: less evidence, never a paper counted as notes). Where papers are
      // not provisioned there are none.
      if (!found.ok || (!papers.ok && !papers.notProvisioned)) return null;
      const exam = new Set(papers.ok ? papers.data.map(p => p.materialId) : []);
      const chunks = found.data.filter(c => !exam.has(c.materialId));
      return toPassages(ctx.admin, ctx.userId, spreadAcrossMaterials(rankChunks(question, chunks, 40), RETRIEVAL_LIMIT + 2));
    },
    async library(question, notes) {
      const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
      const source = await referenceSource(ctx.admin, policy, learner.competencies);
      const versions = new Map((learner.competencies ?? []).map(c => [c.id, c.catalogueVersion ?? null]));
      const linked = policy.scholarLearningObjectives === "outcomes" && notes.length ? await governedReferences(ctx.admin, ctx.userId, notes.map(p => p.chunkId), source) : [];
      // Approved content only: a linked reference that is not approved as it stands is not library evidence.
      const refs = [...linked.filter(r => r.approved), ...libraryReferences(question, source, linked)];
      const cases = policy.scholarCaseEntries.includes("library") ? (await findLibraryCases(ctx.admin, { topic: keyTermsOf(question).slice(0, 6).join(" "), limit: 3 })) ?? [] : [];
      return [
        ...refs.map(r => ({ origin: "library" as const, kind: "competency" as const, itemId: r.competencyId ?? "", version: r.competencyId ? versions.get(r.competencyId) ?? null : null, code: r.code, title: r.title, outcome: r.outcome, text: [r.title, r.outcome].filter(Boolean).join(": "), status: r.status, approved: !!r.approved })),
        ...cases.map(c => ({ origin: "library" as const, kind: "case" as const, itemId: c.versionId, version: c.versionId, code: c.code, title: c.title, outcome: null, text: c.intro ?? "", status: "Clinically approved", approved: true })),
      ].filter(l => l.itemId);
    },
    external: keywords => learnResearch(ctx, policy.scholarResearch, { question: keywords.join(" "), topics: [], title: null }, recoveryId, recoveryNarrowing(policy.scholarRecovery), qualityOf(policy.scholarRecovery)),
    guidelines: () => policy.scholarExams.domains.slice(0, 6).map(d => ({ kind: "guideline" as const, label: `Approved guideline publisher: ${d}`, url: `https://${d}/` })),
  };
}

const publicResult = (r: RecoveryResult & Internal): RecoveryResult => {
  const { research: _r, passages: _p, ...out } = r;
  void _r; void _p;
  return out;
};

/** One recovery for one learner, recorded (codes only). */
export async function recoverEvidence(ctx: IndividualContext, policy: IndividualPolicy, input: RecoveryInput & { withheldReason?: string | null }): Promise<RecoveryResult> {
  const recoveryId = randomUUID();
  const operational = await scholarResearchOperational(ctx.admin).catch(() => false);
  const plan = tierPlan(input.mode, policy, operational);
  const r = publicResult(await runRecovery(input, plan, liveSources(ctx, policy, recoveryId), { wider: widerMode(input.mode, policy, operational), recoveryId }));
  await recordRecovery(ctx.admin, r, input.withheldReason ?? null);
  return r;
}

// ── "EXPLAIN USING APPROVED REFERENCES": THE INPUTS, RE-DERIVED ON THE SERVER ─────────────────────────────────────────
//
// A generation route that is asked to explain from a recovery receives ONLY { id, mode, question } from the browser.
// It never takes evidence text, chunk ids or references from the request: the id must name a recovery this server
// recorded, and the evidence is found again here, by the same coordinator, from the learner's own rows, the governed
// library and the engine (whose cache makes an external repeat free). What the route then sends its own model is what
// this returns -- and its own grounding check runs over it, unchanged.

export type RecoveryRequest = { id: string; mode: RecoveryMode; question: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pure. The optional `recovery` body field of a generation route. null: absent. Otherwise the request, or why it is
 * refused. Anything else in it (evidence, ids, text) is ignored, never read.
 */
export function parseRecoveryRequest(raw: unknown, fallback: RecoveryMode, maxQuestion: number): { ok: true; value: RecoveryRequest } | { ok: false; error: string } | null {
  if (raw === undefined || raw === null) return null;
  const x = raw as { id?: unknown; mode?: unknown; question?: unknown };
  if (typeof raw !== "object" || typeof x.id !== "string" || !UUID.test(x.id)) return { ok: false, error: "That set of learning resources could not be found. Look for them again." };
  const question = typeof x.question === "string" ? x.question.replace(/\s+/g, " ").trim() : "";
  if (question.length < 2 || question.length > maxQuestion) return { ok: false, error: `Name the topic in up to ${maxQuestion} characters.` };
  if (findPatientIdentifiers(question).length) return { ok: false, error: "That looks like it identifies a patient. Remove it and try again." };
  return { ok: true, value: { id: x.id.toLowerCase(), mode: parseRecoveryMode(x.mode, "notes_only"), question } };
}

/** Whether this server recorded the recovery (its plat_ai_outcomes row). Unreadable or absent: false -- fail closed. */
export async function recoveryKnown(admin: any, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  try {
    const { data, error } = await admin.from("plat_ai_outcomes").select("action_id").eq("action_id", id).eq("activity", "evidence_recovery").limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch { return false; }
}

/** A verified external abstract, as a generation route may cite it: the provider's own record, nothing written by AI. */
export type RecoveredAbstract = { title: string; journal: string | null; year: number | null; url: string; abstract: string; retrievedAt: string };
export type RecoveredInputs = {
  result: RecoveryResult;
  /** The learner's own passages that are evidence (full text, read again from their rows). */
  passages: Passage[];
  references: GovernedReference[];
  research: ResearchEvidence[];
  abstracts: RecoveredAbstract[];
};
export type Rederived = { ok: true; inputs: RecoveredInputs } | { ok: false; reason: "unknown" | "no_evidence"; result: RecoveryResult | null };

/** Pure. The inputs from a coordinator run: only what generationInputs allowed, with the passages and abstracts it names. */
export function inputsOf(r: RecoveryResult & Internal): Rederived {
  const g = r.generation;
  if (!g) return { ok: false, reason: "no_evidence", result: publicResult(r) };
  const passages = r.passages.filter(p => g.chunkIds.includes(p.chunkId));
  const abstracts = (r.research?.evidence ?? []).map(i => r.research!.items[i]).filter(i => !!i?.abstract)
    .map(i => ({ title: i.title, journal: i.journal, year: i.year, url: i.url, abstract: i.abstract!, retrievedAt: i.retrievedAt }));
  return { ok: true, inputs: { result: publicResult(r), passages, references: g.references, research: g.research, abstracts } };
}

/**
 * The generation inputs for a recovery, found again on the server. Refused when the id names no recovery this server
 * recorded; no_evidence when there is nothing approved to explain from (the route then makes no AI call).
 */
export async function rederiveRecovery(ctx: IndividualContext, policy: IndividualPolicy, req: RecoveryRequest, scope: Pick<RecoveryInput, "materialId" | "sectionId" | "excludeMaterialId" | "scopeMaterialIds"> = {}, deps: { known?: typeof recoveryKnown; sources?: RecoverySources; operational?: boolean } = {}): Promise<Rederived> {
  if (!(await (deps.known ?? recoveryKnown)(ctx.admin, req.id))) return { ok: false, reason: "unknown", result: null };
  const operational = deps.operational ?? await scholarResearchOperational(ctx.admin).catch(() => false);
  const plan = tierPlan(req.mode, policy, operational);
  const r = await runRecovery({ question: req.question, mode: req.mode, ...scope }, plan, deps.sources ?? liveSources(ctx, policy, req.id), { wider: widerMode(req.mode, policy, operational), recoveryId: req.id });
  return inputsOf(r);
}

/**
 * Pure. For an activity that reads ONE passage (the short-answer evaluation): the question's own passage, then the
 * recovered passages of the learner's notes and the approved library entries, each under its own heading. Every word
 * is the learner's own notes or approved library text, read on the server; external abstracts are never added here.
 */
export function recoveryPassage(own: Passage, inputs: Pick<RecoveredInputs, "passages" | "references">): Passage {
  const more = inputs.passages.filter(p => p.chunkId !== own.chunkId).map(p => `MORE FROM MY NOTES (${passageCitation(p)}):\n${p.content}`);
  const library = inputs.references.map(r => `APPROVED COMPETEN LIBRARY: ${[r.code, r.title].filter(Boolean).join(" ")}${r.outcome ? `: ${r.outcome}` : ""}`);
  return { ...own, content: [own.content, ...more, ...library].join("\n\n") };
}

/** What a generation route says back about a recovery: shown or not, under which label, and what remains. */
export function recoveredReply(d: Rederived, shown: boolean) {
  const result = d.ok ? d.inputs.result : d.result;
  return {
    shown, label: RECOVERY_EXPLANATION_LABEL,
    unanswered: result?.sufficiency.unanswered ?? [], reading: result?.reading ?? [],
    evidence: result ? { notes: result.evidence.notes.length, library: result.evidence.library.length, external: result.evidence.external.length } : { notes: 0, library: 0, external: 0 },
  };
}

// ── TRACKING ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The link between a recovery and its result: a digest, so a row is never read back to a request. */
export const recoveryKey = (recoveryId: string) => sha256Hex(`${RECOVERY_VERSION}\u0000${recoveryId}`);
const SUFFICIENCY_CODE: Record<SufficiencyVerdict["verdict"], OutcomeSufficiency> = { sufficient: "sufficient", partial: "uncertain", insufficient: "insufficient" };
const reasonCode = (s: string | null) => (s && /^[a-z_]{2,40}$/.test(s) ? `withheld_${s}` : null);

/** Pure. SCHOLAR-SOURCE-QUALITY-01: how many external items each source-quality rule stopped, codes and counts only. */
export const notUsedCounts = (external: readonly Pick<ExternalEvidence, "notUsed">[]): [NotUsedReason, number][] =>
  NOT_USED_REASONS.map(c => [c, external.filter(e => e.notUsed === c).length] as [NotUsedReason, number]).filter(([, k]) => k > 0);

/** Best-effort. One outcome row per recovery: no AI was called ("redirected"), output kind "other", codes only. */
export async function recordRecovery(admin: any, r: Pick<RecoveryResult, "recoveryId" | "mode" | "state" | "sufficiency" | "external" | "evidence">, withheldReason: string | null): Promise<void> {
  const notUsed = notUsedCounts(r.evidence.external);
  await recordAiOutcome(admin, {
    actionId: r.recoveryId, product: "scholar", activity: "evidence_recovery", operation: RECOVERY_OPERATION, outputKind: "other", outcome: "redirected",
    reasons: [`recovery_${r.state}`, ...(reasonCode(withheldReason) ? [reasonCode(withheldReason)!] : []), `recovery_external_${r.external.reason}`, ...notUsed.map(([c]) => `recovery_not_used_${c}`)],
    sufficiency: SUFFICIENCY_CODE[r.sufficiency.verdict], promptVersion: RECOVERY_VERSION,
    configVersion: `mode:${r.mode};n:${r.evidence.notes.length};l:${r.evidence.library.length};e:${r.evidence.external.length}${notUsed.map(([c, k]) => `;${c}:${k}`).join("")}`,
    materialKey: recoveryKey(r.recoveryId),
  });
}

/**
 * Best-effort. The caller's record of what an explanation from recovered evidence came to, once its own grounding check
 * decided: shown (recovered_explanation) or withheld again (unanswered). Its own AI outcome row is separate.
 */
export async function recordRecoveryResult(admin: any, recoveryId: string, shown: boolean): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(recoveryId)) return;
  const outcome: AiOutcome = shown ? "accepted" : "rejected";
  await recordAiOutcome(admin, {
    actionId: randomUUID(), product: "scholar", activity: "evidence_recovery_result", operation: `${RECOVERY_OPERATION}_result`, outputKind: "other", outcome,
    accepted: shown ? 1 : 0, rejected: shown ? 0 : 1, reasons: [shown ? "recovery_recovered_explanation" : "recovery_unanswered"], promptVersion: RECOVERY_VERSION,
    materialKey: recoveryKey(recoveryId),
  });
}

export type RecoveryOutcomeRow = { product: string; activity: string; output_kind: string; outcome: string; rejection_reasons: string[] | null; material_key: string | null };

/**
 * Pure. For HQ: the answer rate and the SAFE-WITHHOLDING rate kept apart (a safe non-answer is containment working, not
 * an answer), and what recovery achieved: recovered explanations, reading only, unanswered, and recoveries where an
 * explanation was possible but not (yet) asked for. Rates are null when there is nothing to divide: never zero.
 */
export function summariseRecovery(rows: readonly RecoveryOutcomeRow[]) {
  const scholar = rows.filter(r => r.product === "scholar");
  const answers = scholar.filter(r => r.output_kind === "explanation" && r.outcome !== "redirected");
  const answered = answers.filter(r => r.outcome === "accepted" || r.outcome === "partial").length;
  const safe = answers.filter(r => nonDelivery({ outcome: r.outcome as AiOutcome, rejection_reasons: r.rejection_reasons }) === "safe_non_answer").length;
  const declined = answers.filter(r => nonDelivery({ outcome: r.outcome as AiOutcome, rejection_reasons: r.rejection_reasons }) === "declined_not_in_notes").length;
  const rate = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);

  const requests = scholar.filter(r => r.activity === "evidence_recovery");
  const results = new Map<string, string>();
  for (const r of scholar.filter(x => x.activity === "evidence_recovery_result" && x.material_key))
    results.set(r.material_key!, (r.rejection_reasons ?? []).includes("recovery_recovered_explanation") ? "recovered_explanation" : "unanswered");
  const tally = { recoveredExplanation: 0, readingOnly: 0, unanswered: 0, explanationNotRequested: 0 };
  for (const r of requests) {
    const codes = r.rejection_reasons ?? [];
    const result = r.material_key ? results.get(r.material_key) : undefined;
    if (result === "recovered_explanation") tally.recoveredExplanation++;
    else if (result === "unanswered") tally.unanswered++;
    else if (codes.includes("recovery_explanation_available")) tally.explanationNotRequested++;
    else if (codes.includes("recovery_reading_only")) tally.readingOnly++;
    else tally.unanswered++;
  }
  return {
    answers: { actions: answers.length, answered, safeWithheld: safe, declined, answerRate: rate(answered, answers.length), safeWithholdingRate: rate(safe, answers.length) },
    recovery: { requests: requests.length, ...tally, recoveryRate: rate(tally.recoveredExplanation, requests.length) },
  };
}

/** HQ read. `measured` is false until migration 600 is readable: say so, never zero. */
export async function loadRecoverySummary(admin: any, days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await admin.from("plat_ai_outcomes").select("product, activity, output_kind, outcome, rejection_reasons, material_key")
    .eq("product", "scholar").gte("created_at", since).limit(10000);
  return { measured: !error, days, ...summariseRecovery(error ? [] : data ?? []) };
}

