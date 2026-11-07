import { createHash } from "node:crypto";
import type { ResearchItem } from "@/lib/holdings/research/providers";
import { SUBJECT_PHRASES } from "@/lib/holdings/research/subject-phrases";
import { authorityOf, canonWord } from "./research-relevance";
import { sameTopicWord } from "./source-quality";

// ── THE EVIDENCE PACK ── SCHOLAR-RESEARCH-TEACH-001 P1 (owner GO for development and testing, 6 Nov 2026) ─────────────────
//
// What a lesson needs from published research, prepared before it is taught. Pure: the reads and writes are in
// evidence-pack-service.ts.
//
// ⚠ NOTHING DERIVED FROM A LEARNER LEAVES COMPETEN. A lesson's title, topics and notes come from the learner's uploads and
// may hold a name, so they are never sent, nor cleaned and sent. They are only READ here, to choose from a closed list of
// subject topics written in this repository. What goes out is that topic's own query, a constant. A word that is not in
// the list cannot go out, because no code path builds a query from anything else (approvedQuery). So the privacy claim
// is checked by reading a list, not by trusting a filter (docs/design/SCHOLAR-ASK-WEB-SOURCES-DESIGN.md section 4, F1).
//
// ⚠ A TOPIC IS NOT A LEARNER. A pack is a set of topics, and each topic's search result is cached under the topic's own
// key (topicKey), so two learners whose notes reach the same scientific topic share one search and nothing else.
//
// ⚠ CITATIONS ARE SHARED, ABSTRACT TEXT IS NOT (owner, 6 Nov, until there is a licensing answer). shareable() removes the
// abstract before a result is written to the shared row. Each lesson reads the text from PubMed by PMID for itself.
//
// Appraisal is deterministic: what PubMed types the record as, how well it matches the topic, and how recent it is.
// Citation counts and a journal's prestige are not read at all.

export const PACK_VERSION = "teachpack-v1";
/** The shared row's provider. "holdings:" so the research retention job (holdings/research/retention.ts) also clears these. */
export const PACK_PROVIDER = "holdings:teachpack";
/** A row saying a search for this topic is under way, so a second learner waits instead of searching too. */
export const PACK_BUILDING_PROVIDER = "holdings:teachpack:building";
/** Published-result filter: what the hierarchy can use. Primary research comes through as trials. */
const HIERARCHY = '(guideline[pt] OR "practice guideline"[pt] OR "systematic review"[pt] OR "meta-analysis"[pt] OR review[pt] OR "randomized controlled trial"[pt] OR "clinical trial"[pt])';

/** One subject the closed list knows: how a lesson is recognised as being about it, and the query that may leave. */
export type SubjectTopic = {
  id: string;
  label: string;
  /** Phrases that mean a lesson is about this. Read locally, against the lesson. */
  match: readonly string[];
  /** The whole outgoing search, a constant. */
  query: string;
  /** What a found record is judged against. Never anything of the learner's. */
  concepts: readonly string[];
};

/** Hand-written topics, where a plain phrase search would find the wrong thing ("attachment" alone finds cell biology). */
const CURATED: readonly SubjectTopic[] = [
  { id: "critical-sensitive-periods", label: "critical and sensitive periods in development",
    match: ["critical period", "sensitive period"],
    query: '("critical and sensitive periods"[ti] OR "sensitive and critical periods"[ti] OR "sensitive periods"[ti] OR "sensitive period"[ti] OR "Critical Period, Psychological"[mh]) AND (child*[tiab] OR infant*[tiab] OR "early life"[tiab]) AND (development[tiab] OR developmental[tiab] OR plasticity[tiab])',
    concepts: ["critical period", "sensitive period", "plasticity", "development"] },
  { id: "motor-development-principles", label: "direction of motor development in infancy",
    match: ["cephalocaudal", "proximodistal", "proximal distal", "motor development"],
    query: '("motor development"[ti] OR cephalocaudal[tiab] OR proximodistal[tiab]) AND (infant*[ti] OR infancy[tiab] OR "early human"[tiab])',
    concepts: ["motor development", "cephalocaudal", "proximodistal", "infant"] },
  { id: "infant-attachment-caregiving", label: "infant attachment and early caregiving",
    match: ["attachment disorder", "infant attachment", "caregiver attachment", "secure attachment", "early caregiving", "foster care", "orphanage", "institutional care", "attachment"],
    query: '(("attachment"[ti] AND (infant*[tiab] OR "early childhood"[tiab]) AND (caregiv*[tiab] OR parent*[tiab] OR maternal[tiab])) OR "reactive attachment disorder"[ti] OR ("psychosocial deprivation"[tiab] AND institution*[tiab]))',
    concepts: ["attachment", "caregiving", "attachment disorder", "deprivation", "infant"] },
  { id: "language-development", label: "language development in early childhood",
    match: ["language development", "language acquisition", "phonology", "language"],
    query: '("language development"[ti] OR "language acquisition"[ti]) AND ("sensitive period"[tiab] OR "sensitive periods"[tiab] OR "critical period"[tiab] OR "critical periods"[tiab] OR plasticity[tiab]) AND (infant*[tiab] OR child*[tiab] OR "early childhood"[tiab])',
    concepts: ["language development", "language acquisition", "sensitive period", "plasticity"] },
];

const slug = (s: string) => s.replace(/\s+/g, "-");
const PHRASE_TOPICS: readonly SubjectTopic[] = SUBJECT_PHRASES.map(p => ({ id: slug(p), label: p, match: [p], query: `"${p}"[tiab]`, concepts: [p] }));
export const SUBJECT_TOPICS: readonly SubjectTopic[] = [...CURATED, ...PHRASE_TOPICS];
/** Bumped when the list changes, so results are searched afresh under the new list. */
export const VOCABULARY_VERSION = "subject-topics-1";

/** Pure. One word as matching reads it: lowercase, no accents, one spelling. */
const tokens = (s: string): string[] => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean).map(canonWord);
const COUNT_CAP = 12;

function countPhrase(stream: readonly string[], phrase: readonly string[]): number {
  let n = 0;
  for (let i = 0; i + phrase.length <= stream.length && n < COUNT_CAP; i++) if (phrase.every((w, k) => sameTopicWord(stream[i + k], w))) n++;
  return n;
}

/** What a lesson says, for matching only. Headings count more than a passing mention. */
export type LessonText = { headings: readonly string[]; body: readonly string[] };
const HEADING_WEIGHT = 3;
/** A topic mentioned once in the body is not what the lesson is about: never search merely to add a citation. */
const MIN_WEIGHT = 2;

/**
 * Pure. The topics of the closed list this lesson is about, most central first, at most `max`. Nothing of the lesson is
 * returned: only entries of the list. Ties keep the list's order, so the same notes always give the same topics.
 */
export function lessonTopics(lesson: LessonText, max: number, topics: readonly SubjectTopic[] = SUBJECT_TOPICS): SubjectTopic[] {
  const heads = tokens(lesson.headings.join(" . ")), body = tokens(lesson.body.join(" . "));
  const scored = topics.map((topic, order) => {
    const weight = topic.match.reduce((sum, m) => { const p = tokens(m); return sum + countPhrase(heads, p) * HEADING_WEIGHT + countPhrase(body, p); }, 0);
    return { topic, order, weight };
  }).filter(x => x.weight >= MIN_WEIGHT);
  return scored.sort((a, b) => b.weight - a.weight || a.order - b.order).slice(0, Math.max(0, max)).map(x => x.topic);
}

/**
 * ⚠ THE ONLY WAY A QUERY IS MADE. The topic's constant, the hierarchy filter, and the recency limit the registry sets. `id`
 * must be an entry of the list: an unknown id makes no query, so no string from anywhere else can reach a provider.
 */
export function approvedQuery(id: string, freshnessYears: number, topics: readonly SubjectTopic[] = SUBJECT_TOPICS): string | null {
  const t = topics.find(x => x.id === id);
  if (!t) return null;
  const years = Number.isInteger(freshnessYears) && freshnessYears > 0 ? ` AND "last ${freshnessYears} years"[dp]` : "";
  return `${t.query} AND ${HIERARCHY} AND english[la]${years}`;
}

/** Pure. The shared key of one topic's search: the topic, the list's version and every setting that decides the result. Nothing of a learner's. */
export const topicKey = (topic: Pick<SubjectTopic, "id">, plan: { sources: readonly string[]; freshnessYears: number; maxResults: number }) =>
  createHash("sha256").update(JSON.stringify([PACK_VERSION, VOCABULARY_VERSION, topic.id, [...plan.sources], plan.freshnessYears, plan.maxResults])).digest("hex");

/** One record as the shared row holds it: public bibliographic details and how it was appraised. Never abstract text. */
export type SharedRecord = Omit<ResearchItem, "abstract" | "abstractFrom"> & { abstract: null; topic: string; relevance: number; authority: number };

/** Pure. A record with its abstract removed, ready to be shared across learners. */
export function shareable(i: ResearchItem, topic: string, relevance: number): SharedRecord {
  const { abstract: _a, abstractFrom: _f, ...rest } = i;
  return { ...rest, abstract: null, topic, relevance, authority: authorityOf(i) };
}

/** Pure. Only well-formed records, read back from the shared row. Anything else is ignored, and an abstract never survives. */
export function readShared(rows: readonly unknown[]): SharedRecord[] {
  return (rows as SharedRecord[]).filter(r => typeof r?.title === "string" && typeof r?.url === "string" && !!r?.pmid && r?.verified?.pmid === true && typeof r?.topic === "string")
    .map(r => ({ ...r, abstract: null, relevance: Number(r.relevance) || 0, authority: Number(r.authority) || 0 }));
}

/**
 * A narrower group than a general lesson teaches, or not people at all. Such a record may be excellent and still be the wrong one to
 * teach a general principle from, so it ranks below a general one of any type. A lesson on the narrower group has its own topic.
 */
const NARROW = /\b(preterm|premature|autism|autistic|schizophreni\w*|bipolar|cochlear|fragile x|mice|mouse|murine|rodents?|rats?|zebrafish|primates?|in vitro|wearable|transcriptional|interneurons?|rejuvenation|adolescen\w*)\b/i;

/** A topic keeps its best few, so a pack is compact and its DOIs are few to check. */
export const TOPIC_KEEP = 3;

/** How a record is ranked within its topic: applicability, then the type of work and its match together, then age. Citation counts are not read. */
export function rank(r: SharedRecord, thisYear: number): number {
  const age = r.year ? Math.max(0, thisYear - r.year) : 15;
  return (NARROW.test(r.title) ? -20 : 0) + r.authority * 2 + Math.min(r.relevance, 8) + Math.max(0, 2 - age / 6);
}

/**
 * Pure. The compact pack: the best records, taken in turn from each topic so one rich topic cannot crowd out the rest,
 * each work once (by PMID, then DOI, then title). The order is stable, so [E n] mean the same thing every time.
 */
export function selectPack(results: readonly { topic: string; records: readonly SharedRecord[] }[], max: number, now: Date): SharedRecord[] {
  const thisYear = now.getUTCFullYear();
  const queues = results.map(t => [...t.records].sort((a, b) => rank(b, thisYear) - rank(a, thisYear) || String(a.pmid).localeCompare(String(b.pmid))));
  const out: SharedRecord[] = [];
  const same = (a: SharedRecord, b: SharedRecord) => a.pmid === b.pmid || (!!a.doi && a.doi === b.doi) || a.title.toLowerCase() === b.title.toLowerCase();
  for (let more = true; more && out.length < max;) {
    more = false;
    for (const q of queues) {
      if (out.length >= max) break;
      while (q.length && out.some(o => same(o, q[0]))) q.shift();
      const next = q.shift();
      if (!next) continue;
      more = true;
      out.push(next);
    }
  }
  return out;
}

/** What the evidence hierarchy calls a record, from PubMed's own types. Said to the model and to the learner. */
export function evidenceKind(pubTypes: readonly string[] | undefined): string {
  const t = (pubTypes ?? []).map(x => x.toLowerCase());
  if (t.some(x => /guideline/.test(x))) return "guideline";
  if (t.some(x => /systematic review/.test(x))) return "systematic review";
  if (t.some(x => /meta-analysis/.test(x))) return "meta-analysis";
  if (t.some(x => /randomi[sz]ed controlled trial/.test(x))) return "randomised trial";
  if (t.some(x => /clinical trial/.test(x))) return "clinical trial";
  if (t.some(x => x === "review")) return "narrative review";
  return "published study";
}

/** The learner's words. Said every time research was not part of a lesson that could have had it. */
export const RESEARCH_NOT_INCLUDED = "External research was not included in this lesson. It is taught from your notes and Scholar's own explanation.";
/** The learner's words for what the pack sends, shown beside the references. */
export const SUBJECT_TERMS_NOTICE = "Scholar consulted approved scholarly sources using subject terms only. Your notes, your name and your account are never sent.";
export { ABSTRACT_ONLY_NOTE, NOT_ENDORSED_NOTE } from "./teach-format";
