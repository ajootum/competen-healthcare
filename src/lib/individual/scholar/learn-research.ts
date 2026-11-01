import { cachedResult, researchKey, researchQuery, runResearch, searchSources, type ProviderCall, type ResearchPlan, type ResearchResult } from "@/lib/holdings/research/service";
import { loadResearchEngine, planFor, researchOperational, researchUsage, type ResearchEngine } from "@/lib/holdings/research/load";
import { toEvidenceRecord } from "@/lib/holdings/research/evidence";
import { PROVIDER_LABEL, type OpenAccess, type ResearchItem } from "@/lib/holdings/research/providers";
import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import type { IndividualContext } from "../guard";
import type { ScholarResearchPolicy } from "../policy";
import { LEARN_RESEARCH_OPERATION, type ResearchEvidence } from "./generation";
import { audit } from "./http";
import { DEFAULT_QUALITY, gateResearch, queryKeywords, type EvidenceQuality, type NotUsedByIndex, type NotUsedReason } from "./source-quality";
import { DEFAULT_RELEVANCE, buildResearchQuery, rankRelevant, type LessonContext, type RelevanceLevel } from "./research-relevance";
import { LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, aiSpendToday, learnResearchToday, readResearchCache, writeResearchCache } from "./store";

// ── LEARN: RESEARCH & EXPLAIN ── COMPETEN-RESEARCH-01 + ADDENDUM V2 ─────────────────────────────────────────────────────
//
// Scholar's side of the shared Research & Evidence Engine (src/lib/holdings/research). The ENGINE decides what may run:
// its published registry (only Active sources, through its one gate), source policy, evidence rules, budgets and the
// Basic workflow, which must be operational. SCHOLAR decides only whether this learner may search now -- its own mode
// setting and per-learner limits (policy.ts scholarResearch) -- and what the search is: topic keywords, screened for
// identifiers, never the passages. The public cache is migration 570's (no user id, nothing of the learner's). The AI
// path -- routing, eligibility, the grounding check -- is the existing Learn engine's, unchanged.
//
// Called only when the learner chose Research & Explain for this request. Never for every request.
// Fails soft: whatever happens here, Learn still answers from the notes (and library) and says why research did not run.

export type LearnResearchState = "off" | "cached" | "searched" | "not_found" | "refused" | "limit" | "failed";
export type LearnResearch = {
  state: LearnResearchState;
  message: string | null;
  query: string | null;
  scholarLink: string | null;
  items: ResearchItem[];
  /**
   * Indexes into items: the verified abstracts the model may use, in [E n] order. SCHOLAR-SOURCE-QUALITY-01: only those
   * that passed Scholar's source-quality gate (learnResearch applies it), never the engine's raw list.
   */
  evidence: number[];
  /** SCHOLAR-SOURCE-QUALITY-01: engine evidence the gate stopped, by item index, with the rule it failed. Reading only. */
  notUsed?: NotUsedByIndex;
  calls: ProviderCall[];
  codes: string[];
  /** Provenance: provider -> registry record version. */
  sourceVersions: Record<string, string>;
  /** Evidence and citation rules, as published. */
  excerptChars: number;
  furtherReading: boolean;
  licensing: Record<string, string>;
};

const none = (state: LearnResearchState, message: string | null, codes: string[] = [], query: string | null = null): LearnResearch =>
  ({ state, message, query, scholarLink: null, items: [], evidence: [], calls: [], codes, sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {} });

/** SCHOLAR-RESEARCH-RELEVANCE-01: said when nothing found was directly relevant. Teaching carries on from the supported material. */
export const NO_RELEVANT_RESEARCH = "No additional research directly relevant to this lesson was found.";

const MESSAGE: Partial<Record<LearnResearchState, string>> = {
  not_found: NO_RELEVANT_RESEARCH,
  failed: "The research sources could not be reached just now. The answer below is from your notes.",
};

/** Whether Research & Explain is operational for Scholar Learn right now (the engine's word, not Scholar's). */
export async function scholarResearchOperational(admin: unknown, engine?: ResearchEngine): Promise<boolean> {
  return researchOperational(engine ?? await loadResearchEngine(admin), "scholar", "learn");
}

/**
 * SCHOLAR-SQIE-02 (evidence recovery): a consumer's own, NARROWER choice of what the engine may run for it -- which of
 * the engine's sources (search, DOI verification, open-access links, the Google Scholar link), fewer results and a
 * shorter timeout. It can only ever narrow: a source the engine has not Active is still refused by the one gate, a rule
 * the engine has off stays off, and a narrowing that leaves no search source searches nothing at all.
 */
export type ResearchNarrowing = { providers: readonly string[]; maxResults: number; timeoutMs: number };

/** Pure. The plan, narrowed. The engine's own provider order wins where it has one; otherwise the consumer's. */
export function narrowPlan(plan: ResearchPlan, n: ResearchNarrowing): ResearchPlan {
  const engineOrder = plan.policy.sources[plan.product]?.providers ?? [];
  const providers = engineOrder.length ? engineOrder.filter(id => n.providers.includes(id)) : [...n.providers];
  const p = plan.policy, has = (id: string) => n.providers.includes(id);
  return {
    ...plan,
    policy: {
      ...p,
      sources: { ...p.sources, [plan.product]: { ...p.sources[plan.product], providers } },
      rules: { ...p.rules, doiVerification: p.rules.doiVerification && has("crossref"), openAccessLinks: p.rules.openAccessLinks && has("pmc"), scholarLink: p.rules.scholarLink && has("google_scholar_link") },
      limits: { ...p.limits, maxResultsPerRequest: Math.max(1, Math.min(p.limits.maxResultsPerRequest, n.maxResults)), timeoutMs: Math.max(1000, Math.min(p.limits.timeoutMs, n.timeoutMs)) },
    },
  };
}

/** What a research request is about: the lesson (title, objective, key concepts, material topics) and the learner's question. */
export type ResearchInput = { question?: string | null; topics: readonly string[]; title?: string | null; objective?: string | null; concepts?: readonly string[] | null };

/**
 * SCHOLAR-RESEARCH-RELEVANCE-01. The query that leaves Competen, built from the lesson's own distinctive concepts (quoted
 * phrases first), not from generic topic words. Privacy as researchQuery: refused if the source text may identify a patient.
 * Falls back to the engine's plain keyword query when the lesson yields no concept (a question of generic words only).
 */
export function lessonQuery(input: ResearchInput): ReturnType<typeof researchQuery> {
  const ctx: LessonContext = { title: input.title, objective: input.objective, concepts: input.concepts, topics: input.topics, question: input.question };
  const source = [input.title, input.objective, ...(input.concepts ?? []), ...input.topics.slice(0, 8), input.question].filter(Boolean).join(" ").slice(0, 1200);
  if (findPatientIdentifiers(source).length) return { ok: false, reason: "identifier" };
  const query = buildResearchQuery(ctx);
  return query ? { ok: true, query } : researchQuery(input);
}

/**
 * The research for one Learn request, within the learner's limits and the engine's configuration.
 * `actionId`: the Scholar AI action this research serves, so its usage and cost are attributed to that action's outcome.
 * `quality`: SCHOLAR-SOURCE-QUALITY-01 -- every result (fresh or cached) leaves here GATED: only items passing the
 * source-quality rules remain evidence; the rest are reading. Every Scholar caller (Learn, evidence recovery) gets this.
 */
export async function learnResearch(ctx: IndividualContext, p: ScholarResearchPolicy, input: ResearchInput, actionId: string | null = null, narrow: ResearchNarrowing | null = null, quality: EvidenceQuality = DEFAULT_QUALITY): Promise<LearnResearch> {
  const lesson = { ctx: { title: input.title, objective: input.objective, concepts: input.concepts, topics: input.topics, question: input.question } as LessonContext, level: (p.relevance ?? DEFAULT_RELEVANCE) as RelevanceLevel };
  const engine = await loadResearchEngine(ctx.admin);
  if (!p.modes.includes("research") || !researchOperational(engine, "scholar", "learn")) return none("off", "Research & Explain is not available on Scholar at the moment.", ["off"]);
  const q = lessonQuery(input);
  if (!q.ok) return none("refused", q.reason === "identifier" ? "Research was not run: the topic looks like it identifies a patient." : "There was no topic to research.", [`query_${q.reason}`]);
  const plan = narrow ? narrowPlan(planFor(engine, "scholar", "learn"), narrow) : planFor(engine, "scholar", "learn");
  // A narrowing that leaves no search source runs nothing. (An EMPTY list must be caught here: searchSources reads an
  // empty list as "every Active source by priority".)
  if (narrow && (!plan.policy.sources.scholar.providers.length || !searchSources(plan).length)) return none("off", "No research source is switched on for this.", ["off_narrowed"]);
  const rules = { excerptChars: engine.policy.rules.excerptChars, furtherReading: engine.policy.rules.showFurtherReading, licensing: Object.fromEntries(Object.values(engine.registry).map(r => [r.id, r.licensing])) };
  const key = researchKey(q.query, plan);
  const cached = await readResearchCache(ctx.admin, key, new Date().toISOString());
  const usage = researchUsage(ctx.admin, { actionId, product: "scholar", operation: LEARN_RESEARCH_OPERATION, workflow: "basic", policy: plan.policy });
  if (cached) {
    await usage.record({ provider: "cache", capability: "search", requests: 0, results: cached.sources.length, outcome: "cache", latencyMs: 0, costUsd: 0 });
    return gated({ ...fromResult(cachedResult(q.query, cached.sources as unknown[], plan)), ...rules }, quality, lesson);
  }

  const [count, spend] = await Promise.all([learnResearchToday(ctx.admin, ctx.userId), aiSpendToday(ctx.admin, ctx.userId, LEARN_RESEARCH_OPERATION)]);
  if (count === null || spend === null) return none("failed", "Your research allowance could not be checked, so no research was run.", ["limit_unreadable"], q.query);
  if (count >= p.dailyMax) return none("limit", `You have used today's ${p.dailyMax} research requests. The answer below is from your notes.`, ["limit_count"], q.query);
  if (spend * 100 >= p.dailyCostCents) return none("limit", "Today's research allowance is used up. The answer below is from your notes.", ["limit_cost"], q.query);

  const r = await runResearch(q.query, plan, {
    cache: { read: async () => null, write: (k, items, providers, days) => writeResearchCache(ctx.admin, { key: k, provider: `holdings:${providers}`, policyVersion: `research:${Object.values(plan.registry).filter(x => x.status === "active").map(x => `${x.id}@${x.version}`).join(",")}`.slice(0, 200), sources: items as never, searches: 1, days }) },
    usage,
  });
  // One row per fresh search: counts and codes only, never the query text. It is what the learner's daily limit counts.
  await audit(ctx, LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, null,
    { action_id: actionId, query_chars: q.query.length, state: r.state, items: r.items.length, evidence: r.evidence.length, calls: r.calls, codes: r.codes });
  return gated({ ...fromResult(r), ...rules }, quality, lesson);
}

/**
 * Pure. Research as Scholar may use it: first RELEVANT to the lesson (SCHOLAR-RESEARCH-RELEVANCE-01, when the lesson is
 * given), then gated on the de-identified query that left Competen (SCHOLAR-SOURCE-QUALITY-01).
 */
export const gated = (r: LearnResearch, quality: EvidenceQuality = DEFAULT_QUALITY, lesson?: { ctx: LessonContext; level?: RelevanceLevel }): LearnResearch =>
  gateResearch(lesson ? relevant(r, lesson.ctx, lesson.level) : r, queryKeywords(r.query), quality);

/**
 * Pure. Only what is relevant to the lesson stays -- as evidence, as reading, or at all: an item below the bar is not
 * presented even when PubMed or OpenAlex returned it. What stays is ranked by relevance, then authority, and the evidence
 * indexes follow. Idempotent. When items were found and none is relevant, the state is not_found with the plain sentence.
 */
export function relevant(r: LearnResearch, ctx: LessonContext, level: RelevanceLevel = DEFAULT_RELEVANCE): LearnResearch {
  if (!r.items.length) return r;
  const { kept, dropped } = rankRelevant(r.items, ctx, level);
  if (!dropped && kept.every((k, i) => k.index === i)) return r;
  const at = new Map(kept.map((k, n) => [k.index, n]));
  const evidence = kept.filter(k => r.evidence.includes(k.index)).map(k => at.get(k.index)!);
  const notUsed: NotUsedByIndex = {};
  for (const [i, why] of Object.entries(r.notUsed ?? {})) if (at.has(Number(i))) notUsed[at.get(Number(i))!] = why;
  const codes = dropped ? [...r.codes, `relevance_dropped_${dropped}`] : r.codes;
  const none = !kept.length;
  return { ...r, items: kept.map(k => k.item), evidence, notUsed, codes, state: none ? "not_found" : r.state, message: none ? NO_RELEVANT_RESEARCH : r.message };
}

function fromResult(r: ResearchResult): Omit<LearnResearch, "excerptChars" | "furtherReading" | "licensing"> & Partial<LearnResearch> {
  return { state: r.state, message: MESSAGE[r.state] ?? null, query: r.query, scholarLink: r.scholarLink, items: r.items, evidence: r.evidence, calls: r.calls, codes: r.codes, sourceVersions: r.sourceVersions };
}

/** Pure. What the model is shown: the verified abstracts only, in [E n] order. */
export const researchEvidence = (r: LearnResearch): ResearchEvidence[] =>
  r.evidence.map(i => r.items[i]).map(x => ({ title: x.title, journal: x.journal, year: x.year, abstract: x.abstract ?? "" }));

/** One external reference as shown and saved: provider fields only (the evidence record's verified half), labelled. */
export type ExternalReference = {
  kind: "external"; tag: string | null; provider: string; title: string; journal: string | null; year: number | null; authors: string[];
  pmid: string | null; doi: string | null; url: string; evidence: boolean; excerpt: string | null; verified: { pmid: boolean; doi: boolean | null }; retrievedAt: string;
  sourceVersion: string | null; reuse: "private_evidence_excerpt_only" | "metadata_only";
  /** SCHOLAR-SOURCE-QUALITY-01: why the engine's evidence is reading only here (the source-quality rule it failed). */
  notUsed: NotUsedReason | null;
  /** SCHOLAR-SQIE-02: PubMed Central's open-access link and licence, when it was asked and has one. Never fetched. */
  openAccess: OpenAccess | null;
};

/**
 * Pure. Evidence items first (tagged E1 ...), then further reading (untagged, when the rules show it). Only what the
 * providers returned, and (RESEARCH-02) only records whose identity was VERIFIED: a PMID from PubMed or a DOI Crossref
 * confirmed. An unverified record is never shown, as evidence or as reading; a contradicted one was already dropped.
 * SCHOLAR-SOURCE-QUALITY-01: engine evidence the source-quality gate stopped is always listed (after the evidence, before
 * other further reading), untagged, without an excerpt, with the rule it failed.
 */
export function externalReferences(r: LearnResearch): ExternalReference[] {
  const notUsed = r.notUsed ?? {};
  const stopped = r.items.map((_, i) => i).filter(i => !!notUsed[i] && !r.evidence.includes(i));
  const rest = r.furtherReading ? r.items.map((_, i) => i).filter(i => !r.evidence.includes(i) && !notUsed[i] && (r.items[i].verified.pmid || r.items[i].verified.doi === true)) : [];
  return [...r.evidence, ...stopped, ...rest].map((i, n) => {
    const x = r.items[i];
    const rec = toEvidenceRecord(x, { question: null, query: r.query ?? "", strategy: "basic", sourceVersion: r.sourceVersions[x.provider] ?? "", licensing: r.licensing[x.provider] ?? "" }).verified;
    const evidence = n < r.evidence.length;
    const max = r.excerptChars;
    return {
      kind: "external", tag: evidence ? `E${n + 1}` : null, provider: PROVIDER_LABEL[x.provider], title: rec.title, journal: rec.source, year: rec.year, authors: rec.authors,
      pmid: rec.pmid, doi: rec.doi, url: rec.url, evidence,
      excerpt: evidence && rec.abstract && max > 0 ? (rec.abstract.length > max ? `${rec.abstract.slice(0, max).replace(/\s+\S*$/, "")}…` : rec.abstract) : null,
      verified: rec.identity, retrievedAt: rec.retrievedAt, sourceVersion: rec.sourceVersion || null, reuse: evidence || !notUsed[i] ? rec.reuse : "metadata_only", notUsed: evidence ? null : notUsed[i] ?? null,
      openAccess: x.openAccess && !x.openAccess.retracted ? x.openAccess : null,
    };
  });
}
