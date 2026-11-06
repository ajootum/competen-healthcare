import { isEvidence, readAbstracts, runResearch, verifyAndLink, type ResearchDeps, type ResearchPlan } from "@/lib/holdings/research/service";
import { loadResearchEngine, planFor, researchOperational, researchUsage, type ResearchEngine } from "@/lib/holdings/research/load";
import type { FetchLike, ResearchItem } from "@/lib/holdings/research/providers";
import type { IndividualContext } from "../guard";
import type { ScholarResearchPolicy, ScholarTeachResearchPolicy } from "../policy";
import {
  PACK_BUILDING_PROVIDER, PACK_PROVIDER, TOPIC_KEEP, VOCABULARY_VERSION, approvedQuery, evidenceKind, lessonTopics, rank, readShared, selectPack, shareable, topicKey,
  type LessonText, type SharedRecord, type SubjectTopic,
} from "./evidence-pack";
import { LEARN_RESEARCH_OPERATION } from "./generation";
import { audit } from "./http";
import { externalReferences, narrowPlan, type ExternalReference, type LearnResearch } from "./learn-research";
import { rankRelevant } from "./research-relevance";
import { evidenceGate, queryKeywords, type EvidenceQuality } from "./source-quality";
import { LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, aiSpendToday, claimResearchTopic, learnResearchToday, readResearchTopic, releaseResearchTopic, writeResearchCache } from "./store";
import type { PackEvidence } from "./teach-integrated";

// ── PREPARING THE EVIDENCE PACK ── SCHOLAR-RESEARCH-TEACH-001 P1 ───────────────────────────────────────────────────────
//
// Called for the FIRST Teach Me of a lesson, and only after the saved-lesson lookups have missed, so reopening, a saved
// lesson and moving between stages never come here. A prepared lesson (the next lesson, ahead of time) comes here with
// search off: it may use what is already shared, and it never makes a search of its own.
//
// Fails soft, always: whatever goes wrong here, Teach Me still teaches from the notes and says external research was not
// included. Nothing here throws to the route.
//
// Source: the owner's free-source ruling. PubMed searches, Crossref checks DOIs, PubMed Central says whether an open
// copy exists. OpenAlex is metered and is left out, by narrowing what the engine has Active: the engine's own gate
// still decides everything else, so a source the engine does not have Active is refused however it is listed here.

/** The free sources the owner approved for this pack (6 Nov 2026). Narrowing only: each must also be Active in the engine. */
export const PACK_SOURCES = ["pubmed", "crossref", "pmc"] as const;
export const TEACH_RESEARCH_OPERATION = "individual_scholar_teach_research";
/** The wall clock the whole preparation may take, so a slow source cannot use up the lesson's own time. */
export const PACK_DEADLINE_MS = 20_000;
/** How long a learner waits for another learner's search of the same topic before going on without it. */
const PEER_WAIT_MS = 4_000, PEER_POLL_MS = 500;
/** A claim outlives no more than this: a crashed search frees its topic. */
const CLAIM_MS = 45_000;
/** A topic with nothing usable is remembered briefly, so a topic the literature does not serve is not searched on every lesson. */
const EMPTY_DAYS = 7;

export type PackState = "off" | "no_topic" | "limit" | "ready" | "none" | "failed";
export type EvidencePack = {
  state: PackState;
  /** Entries of the closed list this lesson reached. Not the learner's words. */
  topics: string[];
  /** In [E n] order. Each has its abstract, read for this lesson and kept nowhere shared. */
  items: ResearchItem[];
  evidence: PackEvidence[];
  /** Fresh searches made for this lesson, and topics served from the shared row. */
  searched: number;
  reused: number;
  /** Every topic the lesson reached was answered. A prepared lesson needs this. */
  complete: boolean;
  codes: string[];
  ms: number;
  references: (cited: readonly number[]) => ExternalReference[];
};

const none = (state: PackState, codes: string[], started: number, topics: string[] = [], searched = 0, reused = 0): EvidencePack =>
  ({ state, topics, items: [], evidence: [], searched, reused, complete: false, codes, ms: Date.now() - started, references: () => [] });

/** The plan for this pack: the engine's, narrowed to the free sources. The search itself is told not to verify: that runs once on what is kept. */
export function packPlan(engine: ResearchEngine): ResearchPlan {
  // The engine's own timeout stands: this narrows the sources, not how long a slow one may take.
  return narrowPlan(planFor(engine, "scholar", "learn"), { providers: PACK_SOURCES, maxResults: 5, timeoutMs: engine.policy.limits.timeoutMs });
}
const searchOnly = (plan: ResearchPlan): ResearchPlan => ({ ...plan, policy: { ...plan.policy, rules: { ...plan.policy.rules, doiVerification: false, openAccessLinks: false } } });

/** The records of one topic that may ground a lesson: relevant to the TOPIC, and passing the same source-quality gate as every Scholar path. */
export function keepForTopic(items: readonly ResearchItem[], topic: SubjectTopic, quality: EvidenceQuality, level: ScholarResearchPolicy["relevance"]): { item: ResearchItem; relevance: number }[] {
  const { kept } = rankRelevant(items, { title: topic.label, concepts: topic.concepts, topics: topic.concepts }, level ?? "standard");
  const keywords = queryKeywords(topic.concepts.join(" "));
  const year = new Date().getUTCFullYear();
  return kept.filter(k => isEvidence(k.item) && !evidenceGate(k.item, keywords, quality)).map(k => ({ item: k.item, relevance: k.relevance.net }))
    .sort((a, b) => rank(shareable(b.item, topic.id, b.relevance), year) - rank(shareable(a.item, topic.id, a.relevance), year)).slice(0, TOPIC_KEEP);
}

/** A topic just searched: what it kept, held until the DOIs and links are checked once for the whole lesson and the row is written. */
type Searched = { topic: SubjectTopic; key: string; kept: { item: ResearchItem; relevance: number }[] };

async function searchTopic(topic: SubjectTopic, key: string, plan: ResearchPlan, quality: EvidenceQuality, level: ScholarResearchPolicy["relevance"], deps: ResearchDeps, codes: string[]): Promise<Searched | null> {
  const query = approvedQuery(topic.id, plan.registry.pubmed?.freshnessYears ?? 15);
  if (!query) { codes.push("topic_not_in_list"); return null; }
  const r = await runResearch(query, searchOnly(plan), { ...deps, cache: null });
  codes.push(...r.codes.filter(c => c !== "dropped_date"));
  if (r.state === "failed") return null;
  return { topic, key, kept: keepForTopic(r.items, topic, quality, level) };
}

/** The topic's result, shared: citations and appraisal, never abstract text. A topic with nothing usable is remembered for less time. */
async function writeTopic(admin: unknown, s: Searched, records: readonly SharedRecord[], plan: ResearchPlan): Promise<void> {
  const days = Math.min(plan.policy.limits.cacheDays, plan.registry.pubmed?.cacheDays ?? 30);
  await writeResearchCache(admin, { key: s.key, provider: PACK_PROVIDER, policyVersion: `research:pubmed@${plan.registry.pubmed?.version ?? 0};${VOCABULARY_VERSION}`, sources: records as never, searches: 1, days: records.length ? days : Math.min(days, EMPTY_DAYS) });
}

export type PackInput = { lesson: LessonText; actionId: string | null; search: boolean };
export type PackPolicy = { research: Pick<ScholarResearchPolicy, "dailyMax" | "relevance">; teach: ScholarTeachResearchPolicy; quality: EvidenceQuality };

/** The evidence pack for one lesson. See the header. */
export async function prepareEvidencePack(ctx: IndividualContext, policy: PackPolicy, input: PackInput, inject: { fetch?: FetchLike; now?: () => Date } = {}): Promise<EvidencePack> {
  const started = Date.now(), codes: string[] = [];
  const now = inject.now ?? (() => new Date());
  try {
    const engine = await loadResearchEngine(ctx.admin);
    if (!researchOperational(engine, "scholar", "learn")) return none("off", ["engine_not_operational"], started);
    const plan = packPlan(engine);
    if (!plan.policy.sources.scholar.providers.includes("pubmed") || !plan.registry.pubmed) return none("off", ["no_free_source"], started);

    const topics = lessonTopics(input.lesson, policy.teach.maxSearches);
    const ids = topics.map(t => t.id);
    if (!topics.length) return none("no_topic", ["no_topic"], started);

    // The learner's limits, once, and only for what costs: spend bars the deeper lesson, the count bars only fresh searches.
    const [count, spend] = await Promise.all([learnResearchToday(ctx.admin, ctx.userId), aiSpendToday(ctx.admin, ctx.userId, LEARN_RESEARCH_OPERATION)]);
    if (count === null || spend === null) return none("failed", ["limit_unreadable"], started, ids);
    if (spend * 100 >= policy.teach.dailyCostCents) return none("limit", ["limit_cost"], started, ids);
    const mayBuild = input.search && count < policy.research.dailyMax;
    if (input.search && !mayBuild) codes.push("limit_count");

    const usage = researchUsage(ctx.admin, { actionId: input.actionId, product: "scholar", operation: TEACH_RESEARCH_OPERATION, workflow: "basic", policy: plan.policy });
    const deps: ResearchDeps = { usage, fetch: inject.fetch, now };
    const sourceIds = plan.policy.sources.scholar.providers;
    const results: { topic: string; records: SharedRecord[] }[] = [];
    const abstracts = new Map<string, string>();
    const fresh: Searched[] = [];
    let searched = 0, reused = 0, unavailable = 0;

    // One topic at a time: NCBI allows three requests a second without a key, and a topic is three requests.
    for (const topic of topics) {
      if (Date.now() - started > PACK_DEADLINE_MS) { codes.push("deadline"); unavailable++; continue; }
      const key = topicKey(topic, { sources: sourceIds, freshnessYears: plan.registry.pubmed.freshnessYears, maxResults: plan.policy.limits.maxResultsPerRequest });
      const nowIso = now().toISOString();
      const row = await readResearchTopic(ctx.admin, key, nowIso);
      if (row && row.provider !== PACK_BUILDING_PROVIDER) { results.push({ topic: topic.id, records: readShared(row.sources) }); reused++; continue; }
      if (!mayBuild) { unavailable++; continue; }
      // ⚠ Search once: whoever claims the topic searches, and a second learner waits for that result.
      const claimed = await claimResearchTopic(ctx.admin, key, { provider: PACK_BUILDING_PROVIDER, policyVersion: VOCABULARY_VERSION, ms: CLAIM_MS, nowIso });
      if (!claimed) {
        let peer: Awaited<ReturnType<typeof readResearchTopic>> = null;
        for (const until = Date.now() + PEER_WAIT_MS; Date.now() < until;) {
          await new Promise(res => setTimeout(res, PEER_POLL_MS));
          peer = await readResearchTopic(ctx.admin, key, now().toISOString());
          if (peer && peer.provider !== PACK_BUILDING_PROVIDER) break;
          peer = null;
        }
        if (peer) { results.push({ topic: topic.id, records: readShared(peer.sources) }); reused++; } else { codes.push("topic_in_flight"); unavailable++; }
        continue;
      }
      const done = await searchTopic(topic, key, plan, policy.quality, policy.research.relevance, deps, codes).catch(() => null);
      if (!done) { await releaseResearchTopic(ctx.admin, key, PACK_BUILDING_PROVIDER, now().toISOString()); codes.push("topic_failed"); unavailable++; continue; }
      searched++;
      fresh.push(done);
    }

    // The DOIs and open-access links are checked ONCE, over everything this lesson just found, the likely picks first (PubMed Central is asked about five).
    const allFresh = [...new Map(fresh.flatMap(f => f.kept.map(k => [k.item.pmid, k.item] as const))).values()];
    const likely = new Set(selectPack(fresh.map(f => ({ topic: f.topic.id, records: f.kept.map(k => shareable(k.item, f.topic.id, k.relevance)) })), plan.policy.rules.maxEvidence, now()).map(r => r.pmid));
    const checked = allFresh.length ? await verifyAndLink([...allFresh].sort((a, b) => Number(likely.has(b.pmid)) - Number(likely.has(a.pmid))), plan, deps) : [];
    const byPmid = new Map(checked.map(i => [i.pmid, i]));
    for (const f of fresh) {
      const records = f.kept.flatMap(k => { const i = byPmid.get(k.item.pmid); return i ? [shareable(i, f.topic.id, k.relevance)] : []; });
      await writeTopic(ctx.admin, f, records, plan);
      results.push({ topic: f.topic.id, records });
    }
    for (const i of checked) if (i.pmid && i.abstract) abstracts.set(i.pmid, i.abstract);

    const chosen = selectPack(results, plan.policy.rules.maxEvidence, now());
    // Citations are what is shared. The text is read here, for this lesson, from PubMed: PMIDs only, and it goes no further than the model and the short excerpt the licence allows.
    const missing = chosen.flatMap(r => (r.pmid && !abstracts.has(r.pmid) ? [r.pmid] : []));
    if (missing.length) {
      const read = await readAbstracts(missing, plan, deps, codes);
      if (read) for (const [p, a] of read) abstracts.set(p, a); else codes.push("abstracts_unreadable");
    }
    const items: ResearchItem[] = chosen.flatMap(r => { const a = r.pmid ? abstracts.get(r.pmid) : null; if (!a) return []; const { topic: _t, relevance: _r, authority: _x, ...rest } = r; return [{ ...rest, abstract: a }]; });
    const evidence: PackEvidence[] = items.map(i => ({ title: i.title, journal: i.journal, year: i.year, kind: evidenceKind(i.pubTypes), abstract: i.abstract ?? "" }));

    // One row per lesson that actually searched: counts and public codes, never a query or a title. It is what the learner's daily count reads.
    if (searched) await audit(ctx, LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, null, { surface: "teach", action_id: input.actionId, topics: ids, searched, reused, evidence: items.length, codes: [...new Set(codes)].slice(0, 20), ms: Date.now() - started });
    const research: LearnResearch = { state: searched ? "searched" : "cached", message: null, query: null, scholarLink: null, items, evidence: items.map((_, i) => i), calls: [], codes, sourceVersions: { pubmed: `pubmed@v${plan.registry.pubmed.version}` }, excerptChars: engine.policy.rules.excerptChars, furtherReading: false, licensing: Object.fromEntries(Object.values(engine.registry).map(r => [r.id, r.licensing])), retrieved: items.length, accepted: items.length, excluded: [] };
    const state: PackState = items.length ? "ready" : unavailable && !results.length ? "failed" : "none";
    return { state, topics: ids, items, evidence, searched, reused, complete: !unavailable && !missing.some(p => !abstracts.has(p)), codes: [...new Set(codes)], ms: Date.now() - started,
      references: cited => externalReferences(research).filter(r => r.tag && cited.includes(Number(r.tag.slice(1)))).map(r => ({ ...r, studyKind: evidenceKind(items[Number(r.tag!.slice(1)) - 1]?.pubTypes), accessed: "abstract" as const })) };
  } catch {
    return none("failed", [...new Set([...codes, "pack_error"])], started);
  }
}
