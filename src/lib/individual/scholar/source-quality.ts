// ── SOURCE QUALITY ── SCHOLAR-SOURCE-QUALITY-01 (owner GO 30 Oct 2026) ───────────────────────────────────────────────
//
// ONE gate for every Scholar path that may give an external abstract to an AI: evidence recovery AND Learn's own
// Research & Explain (learnResearch applies it, so both judge an item identically). The engine's isEvidence (an
// abstract and a verified identity) says what MAY be evidence for any product; Scholar asks more before an item may
// GROUND an explanation, under its HQ settings (policy.ts, scholar_recovery_evidence_*):
//   1. indexed     pubmed_only (default): a PMID PubMed itself returned. any_verified: or a DOI Crossref confirmed.
//   2. type        one of the allowed PubMed publication types, and none of the never-evidence types. No known type: no.
//   3. on topic    title (default): a specific topic word of the question (not treatment, management, care ...) is in
//                  the item's title. off: no check.
// An item that fails stays in the learner's list as READING (never tagged, never given to the AI), and the first rule it
// failed is kept as a code. A staging run (30 Oct) grounded a pyelonephritis question on an OpenAlex Ayurveda case
// study and an asymptomatic-bacteriuria guideline: the first fails rules 1 and 2, the second rule 3.

import type { ResearchItem } from "@/lib/holdings/research/providers";
import { RECOVERY_EVIDENCE_TYPES, type ScholarRecoveryPolicy } from "../policy";

export type EvidenceQuality = Pick<ScholarRecoveryPolicy, "evidenceIndexed" | "evidenceTypes" | "evidenceOnTopic">;
/** Why an item the engine offered as evidence may not ground a Scholar explanation. Codes only, in the order checked. */
export const NOT_USED_REASONS = ["not_indexed", "type_unknown", "type_excluded", "off_topic"] as const;
export type NotUsedReason = (typeof NOT_USED_REASONS)[number];

/** PubMed publication types that never ground an explanation, whatever else the record is also typed as. */
export const NEVER_EVIDENCE_TYPES: readonly string[] = [
  "Case Reports", "Letter", "Editorial", "Comment", "News", "Newspaper Article",
  "Retracted Publication", "Retraction of Publication", "Published Erratum", "Expression of Concern", "Preprint",
];
const ALLOWED_PUBMED = new Map<string, string>(RECOVERY_EVIDENCE_TYPES.map(t => [t.value, t.pubmed]));
/** PubMed writes trial phases as their own types ("Clinical Trial, Phase III"): each is a clinical trial. */
const TRIAL_PHASE = /^Clinical Trial, Phase [IV]+$/;

/** Pure. Whether PubMed's types for an item allow it to ground: null when they do, else why not. */
export function typeVerdict(pubTypes: readonly string[] | undefined, allowed: readonly string[]): "type_unknown" | "type_excluded" | null {
  const types = (pubTypes ?? []).map(t => t.trim()).filter(Boolean);
  if (!types.length) return "type_unknown";
  if (types.some(t => NEVER_EVIDENCE_TYPES.includes(t))) return "type_excluded";
  const ok = new Set(allowed.map(a => ALLOWED_PUBMED.get(a)).filter((x): x is string => !!x));
  return types.some(t => ok.has(t) || (ok.has("Clinical Trial") && TRIAL_PHASE.test(t))) ? null : "type_excluded";
}

/**
 * Words that say what is done or to whom, never which condition or topic: never enough on their own to be on topic.
 * No profession is named here (scholar-learning-harness K9: a profession is configuration, never code).
 */
export const GENERIC_TOPIC_WORDS: ReadonlySet<string> = new Set([
  "treatment", "treatments", "treat", "treating", "management", "manage", "managing", "choice", "choices", "choose", "choosing",
  "care", "caring", "patient", "patients", "adult", "adults", "child", "children", "people", "person",
  "therapy", "therapies", "therapeutic", "intervention", "interventions", "approach", "approaches", "role", "use", "used", "using",
  "effect", "effects", "effective", "effectiveness", "clinical", "practice", "evidence", "guideline", "guidelines", "review", "study",
  "studies", "assessment", "principles", "factors", "signs", "symptoms", "acute", "chronic", "severe", "first", "line", "best",
  "antibiotic", "antibiotics", "drug", "drugs", "medication", "medications", "medicine", "medicines", "disease", "condition",
  "conditions", "health", "hospital", "ward", "community", "primary", "secondary", "versus", "among",
]);
const titleWords = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
/** Simple plural tolerance: infections/infection, kidneys/kidney, therapies/therapy. Never shorter than three letters. */
const singular = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 4 && /(ses|xes|ches|shes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("is") ? w.slice(0, -1) : w);
/** Pure. One word is the same topic word as another: equal once singular, or the same stem (diabetes/diabetic, pyelonephritis/pyelonephritic). */
export function sameTopicWord(a: string, b: string): boolean {
  const x = singular(a), y = singular(b);
  if (x === y) return true;
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n >= Math.max(6, Math.max(x.length, y.length) - 3);
}
/** Pure. The question's specific topic words: its de-identified key terms that are not generic. */
export const specificTerms = (keywords: readonly string[]) => keywords.filter(k => k.length > 2 && !/^\d/.test(k) && !GENERIC_TOPIC_WORDS.has(k.toLowerCase()));
/** Pure. Whether a title names the question's topic: at least one specific term is in it. No specific term: never. */
export function onTopic(title: string, keywords: readonly string[]): boolean {
  const words = titleWords(title);
  return specificTerms(keywords).some(k => words.some(w => sameTopicWord(w, k.toLowerCase())));
}

/** Pure. THE GATE. null: the item may ground a Scholar explanation; otherwise the first rule it failed. */
export function evidenceGate(item: ResearchItem, keywords: readonly string[], q: EvidenceQuality): NotUsedReason | null {
  const indexed = !!item.pmid && item.verified.pmid === true;
  if (!(q.evidenceIndexed === "any_verified" ? indexed || item.verified.doi === true : indexed)) return "not_indexed";
  const type = typeVerdict(item.pubTypes, q.evidenceTypes);
  if (type) return type;
  if (q.evidenceOnTopic === "title" && !onTopic(item.title, keywords)) return "off_topic";
  return null;
}

/** The defaults, as no published value leaves them. */
export const DEFAULT_QUALITY: EvidenceQuality = { evidenceIndexed: "pubmed_only", evidenceTypes: RECOVERY_EVIDENCE_TYPES.map(t => t.value), evidenceOnTopic: "title" };
/** Pure. The gate's settings from Scholar's recovery policy. */
export const qualityOf = (r: ScholarRecoveryPolicy): EvidenceQuality => ({ evidenceIndexed: r.evidenceIndexed, evidenceTypes: r.evidenceTypes, evidenceOnTopic: r.evidenceOnTopic });

/** Why the engine's evidence was not used, by item index. */
export type NotUsedByIndex = Partial<Record<number, NotUsedReason>>;
/** Question labels and command words (SQIE D-3): never a topic, so never what makes a title "on topic". */
const NOT_A_TOPIC = /^(questions?|q\d*[a-z]?|parts?|marks?|answers?|explain|describe|list|outline|discuss|why|how|what|define|identify|briefly|state|name|give)$/;
/** Pure. The topic check's words from a research query (already de-identified: it is what left Competen). */
export const queryKeywords = (query: string | null | undefined) => (query ?? "").toLowerCase().split(/[^\p{L}\d'-]+/u).filter(w => w && !NOT_A_TOPIC.test(w));

/**
 * Pure. Research with ONLY the items that pass the gate left as evidence (in the engine's order), and why each of the
 * others was not used, by item index. Idempotent: what an earlier pass stopped stays stopped. Everything given to an AI
 * is this research's evidence, never the engine's.
 */
export function gateResearch<R extends { items: readonly ResearchItem[]; evidence: number[]; notUsed?: NotUsedByIndex }>(research: R, keywords: readonly string[], q: EvidenceQuality = DEFAULT_QUALITY): R & { notUsed: NotUsedByIndex } {
  const notUsed: NotUsedByIndex = { ...(research.notUsed ?? {}) };
  for (const i of research.evidence) {
    const why = research.items[i] ? evidenceGate(research.items[i], keywords, q) : "not_indexed";
    if (why) notUsed[i] = why;
  }
  return { ...research, evidence: research.evidence.filter(i => !notUsed[i]), notUsed };
}
