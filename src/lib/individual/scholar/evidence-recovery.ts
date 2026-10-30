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
import { RECOVERY_ACTION_LABEL, RECOVERY_ORIGIN_LABEL, RECOVERY_PROMPT, RECOVERY_RETRIEVED_LABEL, RETRIEVAL_LIMIT } from "./config";
import { rankChunks, searchTerms, spreadAcrossMaterials, toTsQuery } from "./retrieval";
import { searchCandidates, toPassages } from "./store";
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
  /** May ground an explanation: an abstract and a verified identity. Details-only references are reading, never evidence. */
  evidence: boolean;
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
  /** What the caller's own AI activity may be given, only when canExplain. */
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

export type TierPlan = { notes: true; library: boolean; external: boolean; externalReason: ExternalStatus["reason"]; guidelines: boolean };

/**
 * Pure. Which tiers run, in order. Notes always. The library unless the learner chose notes only. External only when
 * the learner chose references AND HQ offers it AND a search source is enabled for Scholar AND the engine has research
 * operational (and Learn offers Research & Explain, whose per-learner limits it shares).
 */
export function tierPlan(mode: RecoveryMode, policy: Pick<IndividualPolicy, "scholarRecovery" | "scholarResearch">, engineOperational: boolean): TierPlan {
  const r = policy.scholarRecovery;
  const library = mode !== "notes_only";
  const chosen = mode === "notes_and_references";
  const reason: ExternalStatus["reason"] = !chosen ? "not_chosen" : r.external !== "offer" ? "off"
    : !r.providers.some(p => SEARCH_PROVIDERS.includes(p)) ? "no_source"
      : !engineOperational || !policy.scholarResearch.modes.includes("research") ? "unavailable" : "ran";
  return { notes: true, library, external: reason === "ran", externalReason: reason, guidelines: chosen && r.external === "offer" && r.providers.includes("guidelines") };
}

/** Whether a wider tier than `mode` could run at all, and which mode it is. */
export function widerMode(mode: RecoveryMode, policy: Pick<IndividualPolicy, "scholarRecovery" | "scholarResearch">, engineOperational: boolean): RecoveryMode | null {
  if (mode === "notes_only") return "notes_and_library";
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
  const words = searchTerms(kept.join(" ")).filter(w => !/^\d/.test(w) && !TIME_WORDS.test(w) && !MONTH.test(w)).slice(0, max);
  if (!words.length) return { ok: false, reason: "empty" };
  return { ok: true, keywords: words };
}

// ── PURE: MATCHING, LABELS AND SUFFICIENCY ────────────────────────────────────────────────────────────────────────

/** The question's key terms, as retrieval reads them. */
export const keyTermsOf = (question: string) => searchTerms(question);
const stem = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);
/** Pure. The key terms a text contains (by prefix, as retrieval ranks). */
export function matchedTerms(text: string, terms: readonly string[]): string[] {
  const words = text.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/);
  return terms.filter(t => words.some(w => w.startsWith(stem(t))));
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

/** Pure. The engine's shown references as evidence items: verified only, labelled by what was retrieved. */
export function externalEvidence(research: LearnResearch, terms: readonly string[]): ExternalEvidence[] {
  const refs = externalReferences(research);
  return refs.map((r: ExternalReference) => {
    const item = research.items.find(i => i.url === r.url);
    // retrievedOf reads the item as the provider gave it: an abstract the engine holds is "abstract", never more.
    const retrieved = retrievedOf({ abstract: item?.abstract ?? null, excerpt: r.excerpt });
    return {
      origin: "external" as const, tag: r.tag, provider: r.provider, title: r.title, authors: r.authors, journal: r.journal, year: r.year,
      doi: r.doi, pmid: r.pmid, url: r.url, licence: research.licensing[item?.provider ?? ""] ?? null, retrieved, excerpt: r.excerpt,
      verification: "verified" as const, evidence: r.evidence && retrieved === "abstract",
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
  const covered = keyTerms.filter(t => items.some(i => i.matched.includes(t)));
  const unanswered = keyTerms.filter(t => !covered.includes(t));
  const canExplain = items.length > 0 && keyTerms.length > 0;
  const verdict = !canExplain ? "insufficient" : covered.length / keyTerms.length >= 0.6 ? "sufficient" : "partial";
  return { verdict, keyTerms, covered, unanswered, canExplain };
}

/** Pure. The recovery's state for tracking: an explanation is possible, there is reading only, or nothing. */
export const recoveryState = (s: SufficiencyVerdict, reading: number, details: number): RecoveryState =>
  s.canExplain ? "explanation_available" : reading + details > 0 ? "reading_only" : "unanswered";

/** Pure. The actions offered, in order. Continue with my notes is always there. */
export function suggestedActions(s: SufficiencyVerdict, wider: RecoveryMode | null): RecoveryResult["actions"] {
  return [
    ...(wider ? [{ action: "find_resources" as const, label: RECOVERY_ACTION_LABEL.find_resources, mode: wider }] : []),
    ...(s.canExplain ? [{ action: "explain_with_references" as const, label: RECOVERY_ACTION_LABEL.explain_with_references }] : []),
    { action: "continue_with_notes" as const, label: RECOVERY_ACTION_LABEL.continue_with_notes },
  ];
}

/**
 * What the caller's OWN approved AI activity may be given to explain from (runLearn's passages, references and research
 * evidence), only the items that are evidence. It is the caller's activity, risk classification and grounding check
 * that then decide; recovery never calls a model and never names a different activity.
 */
export type GenerationInputs = { chunkIds: string[]; references: GovernedReference[]; research: ResearchEvidence[] };
export function generationInputs(r: Pick<RecoveryResult, "evidence" | "sufficiency">, research: LearnResearch | null): GenerationInputs | null {
  if (!r.sufficiency.canExplain) return null;
  return {
    chunkIds: r.evidence.notes.filter(n => n.matched.length).map(n => n.chunkId),
    references: r.evidence.library.filter(l => l.approved && l.matched.length && l.kind === "competency")
      .map(l => ({ competencyId: l.itemId, title: l.title, code: l.code, outcome: l.outcome, status: l.status, approved: true, library: true })),
    research: research ? researchEvidence(research) : [],
  };
}

// ── THE COORDINATOR ───────────────────────────────────────────────────────────────────────────────────────────────

/** The three readers, injected so the order and the gating can be proven without a database or a network. */
export type RecoverySources = {
  notes: (question: string) => Promise<Passage[] | null>;
  library: (question: string, notes: readonly Passage[]) => Promise<Omit<LibraryEvidence, "tag" | "matched">[] | null>;
  external: (keywords: readonly string[]) => Promise<LearnResearch>;
  guidelines: () => ReadingLink[];
};
export type RecoveryInput = { question: string; mode: RecoveryMode; materialId?: string | null; sectionId?: string | null };

/** The sequence, in order: notes, then the library, then (references only, and only if allowed) external sources. */
export async function runRecovery(input: RecoveryInput, plan: TierPlan, sources: RecoverySources, opts: { wider: RecoveryMode | null; recoveryId?: string }): Promise<RecoveryResult & { research: LearnResearch | null }> {
  const terms = keyTermsOf(input.question);
  // 1. Notes. The section and material the learner was on come first when they match.
  const passages = (await sources.notes(input.question).catch(() => null)) ?? [];
  const first = (p: Passage) => (p.chunkId === input.sectionId ? 0 : p.materialId === input.materialId ? 1 : 2);
  const notes: NotesEvidence[] = [...passages].sort((a, b) => first(a) - first(b)).map((p, i) => ({
    origin: "notes", tag: `N${i + 1}`, chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p),
    excerpt: p.content.slice(0, 400), matched: matchedTerms(p.content, terms),
  }));
  // 2. The governed library (no external call).
  const lib = plan.library ? ((await sources.library(input.question, passages).catch(() => null)) ?? []) : [];
  const library: LibraryEvidence[] = lib.map((l, i) => ({ ...l, tag: `L${i + 1}`, matched: matchedTerms(`${l.title} ${l.text}`, terms) }));
  // 3. External, only now and only if every gate allowed it. Only keywords leave.
  let research: LearnResearch | null = null, external: ExternalEvidence[] = [], dropped = 0;
  let status: ExternalStatus = { ran: false, reason: plan.externalReason, state: null, dropped: 0 };
  if (plan.external) {
    const k = topicKeywords(input.question);
    if (!k.ok) status = { ran: false, reason: "refused", state: "refused", dropped: 0 };
    else {
      // Fails soft: a source that cannot be reached leaves the notes and library results as they are.
      research = await sources.external(k.keywords).catch(() => null);
      external = research ? externalEvidence(research, terms) : [];
      dropped = research ? research.items.length - external.length : 0;
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
  // Reading, not evidence: details-only references and library cases (practice, never an explanation's source).
  const details = external.filter(e => !e.evidence).length + library.filter(l => l.kind === "case").length;
  return {
    recoveryId: opts.recoveryId ?? randomUUID(), mode: input.mode, prompt: RECOVERY_PROMPT, evidence, reading, sufficiency,
    state: recoveryState(sufficiency, reading.length, details), actions: suggestedActions(sufficiency, opts.wider), external: status,
    generation: generationInputs({ evidence, sufficiency }, research), research,
  };
}

/** The real readers, each an existing read path, every one keyed on the learner's own id. */
export function liveSources(ctx: IndividualContext, policy: IndividualPolicy, recoveryId: string): RecoverySources {
  return {
    async notes(question) {
      const tsq = toTsQuery(question);
      if (!tsq) return [];
      const found = await searchCandidates(ctx.admin, ctx.userId, tsq, null);
      if (!found.ok) return null;
      return toPassages(ctx.admin, ctx.userId, spreadAcrossMaterials(rankChunks(question, found.data, 40), RETRIEVAL_LIMIT));
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
    external: keywords => learnResearch(ctx, policy.scholarResearch, { question: keywords.join(" "), topics: [], title: null }, recoveryId, recoveryNarrowing(policy.scholarRecovery)),
    guidelines: () => policy.scholarExams.domains.slice(0, 6).map(d => ({ kind: "guideline" as const, label: `Approved guideline publisher: ${d}`, url: `https://${d}/` })),
  };
}

/** One recovery for one learner, recorded (codes only). */
export async function recoverEvidence(ctx: IndividualContext, policy: IndividualPolicy, input: RecoveryInput & { withheldReason?: string | null }): Promise<RecoveryResult> {
  const recoveryId = randomUUID();
  const operational = await scholarResearchOperational(ctx.admin).catch(() => false);
  const plan = tierPlan(input.mode, policy, operational);
  const { research: _research, ...r } = await runRecovery(input, plan, liveSources(ctx, policy, recoveryId), { wider: widerMode(input.mode, policy, operational), recoveryId });
  void _research;
  await recordRecovery(ctx.admin, r, input.withheldReason ?? null);
  return r;
}

// ── TRACKING ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The link between a recovery and its result: a digest, so a row is never read back to a request. */
export const recoveryKey = (recoveryId: string) => sha256Hex(`${RECOVERY_VERSION}\u0000${recoveryId}`);
const SUFFICIENCY_CODE: Record<SufficiencyVerdict["verdict"], OutcomeSufficiency> = { sufficient: "sufficient", partial: "uncertain", insufficient: "insufficient" };
const reasonCode = (s: string | null) => (s && /^[a-z_]{2,40}$/.test(s) ? `withheld_${s}` : null);

/** Best-effort. One outcome row per recovery: no AI was called ("redirected"), output kind "other", codes only. */
export async function recordRecovery(admin: any, r: Pick<RecoveryResult, "recoveryId" | "mode" | "state" | "sufficiency" | "external" | "evidence">, withheldReason: string | null): Promise<void> {
  await recordAiOutcome(admin, {
    actionId: r.recoveryId, product: "scholar", activity: "evidence_recovery", operation: RECOVERY_OPERATION, outputKind: "other", outcome: "redirected",
    reasons: [`recovery_${r.state}`, ...(reasonCode(withheldReason) ? [reasonCode(withheldReason)!] : []), `recovery_external_${r.external.reason}`],
    sufficiency: SUFFICIENCY_CODE[r.sufficiency.verdict], promptVersion: RECOVERY_VERSION, configVersion: `mode:${r.mode};n:${r.evidence.notes.length};l:${r.evidence.library.length};e:${r.evidence.external.length}`,
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

