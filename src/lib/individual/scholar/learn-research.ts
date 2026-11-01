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
import { DEFAULT_RELEVANCE, buildResearchQuery, declaresIrrelevant, exclusionReason, lessonConcepts, lessonVocabulary, rankRelevant, scoreRelevance, type ExcludedSource, type LessonContext, type RelevanceLevel } from "./research-relevance";
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
  /**
   * SCHOLAR-RESEARCH-RELEVANCE-02: what the relevance filter did. `retrieved` is what the providers returned, `accepted` what
   * remains in `items` (the only sources that reach the learner), `excluded` the rest with public ids and a reason code.
   * Absent until the filter has run (an engine result that never went through `relevant`).
   */
  retrieved?: number;
  accepted?: number;
  excluded?: ExcludedSource[];
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
 * SCHOLAR-RESEARCH-RELEVANCE-02: the lesson a request is for, from the lesson outline (title, objective, focus). When given,
 * it REPLACES the material-wide title and topics: a deck about quality improvement and sepsis must not search sepsis for a
 * lesson on the Donabedian model. Without it (an Ask, which has no lesson) the request stands as it was.
 */
export type LessonScope = { title?: string | null; objective?: string | null; focus?: readonly string[] | null };
export function withLessonScope(input: ResearchInput, scope: LessonScope | null | undefined): ResearchInput {
  if (!scope || !(scope.title || scope.objective || scope.focus?.length)) return input;
  const focus = scope.focus?.length ? scope.focus : null;
  return { ...input, title: scope.title ?? input.title ?? null, objective: scope.objective ?? input.objective ?? null, concepts: focus ?? input.concepts ?? null, topics: focus ?? [] };
}
/** Pure. The lesson context relevance is judged against, for a request. */
export const contextOf = (input: ResearchInput): LessonContext => ({ title: input.title, objective: input.objective, concepts: input.concepts, topics: input.topics, question: input.question });

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
export async function learnResearch(ctx: IndividualContext, p: ScholarResearchPolicy, input: ResearchInput, actionId: string | null = null, narrow: ResearchNarrowing | null = null, quality: EvidenceQuality = DEFAULT_QUALITY, scope: LessonScope | null = null): Promise<LearnResearch> {
  input = withLessonScope(input, scope);
  const lesson = { ctx: contextOf(input), level: (p.relevance ?? DEFAULT_RELEVANCE) as RelevanceLevel };
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
  const g = gated({ ...fromResult(r), ...rules }, quality, lesson);
  // One row per fresh search: counts and codes only, never the query text or a title. It is what the learner's daily limit
  // counts. SCHOLAR-RESEARCH-RELEVANCE-02: it also says what the relevance filter did (retrieved / accepted, and each
  // excluded source as its public id and reason code), so a bad retrieval can be diagnosed without any learner text.
  await audit(ctx, LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, null,
    { action_id: actionId, query_chars: q.query.length, state: r.state, items: r.items.length, evidence: r.evidence.length, calls: r.calls, codes: r.codes,
      retrieved: g.retrieved ?? r.items.length, accepted: g.accepted ?? g.items.length, excluded: (g.excluded ?? []).slice(0, 20).map(x => ({ pmid: x.pmid, doi: x.doi, reason: x.reason })) });
  return g;
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
  if (!r.items.length) return r.retrieved === undefined ? { ...r, retrieved: 0, accepted: 0, excluded: [] } : r;
  const { kept, dropped, rejected } = rankRelevant(r.items, ctx, level);
  const retrieved = r.retrieved ?? r.items.length;
  const excluded: ExcludedSource[] = [...(r.excluded ?? []), ...rejected.map(x => ({ pmid: x.item.pmid, doi: x.item.doi, title: x.item.title, reason: x.reason }))];
  if (!dropped && kept.every((k, i) => k.index === i)) return r.retrieved !== undefined ? r : { ...r, retrieved, accepted: kept.length, excluded };
  const at = new Map(kept.map((k, n) => [k.index, n]));
  const evidence = kept.filter(k => r.evidence.includes(k.index)).map(k => at.get(k.index)!);
  const notUsed: NotUsedByIndex = {};
  for (const [i, why] of Object.entries(r.notUsed ?? {})) if (at.has(Number(i))) notUsed[at.get(Number(i))!] = why;
  const codes = dropped ? [...r.codes, `relevance_dropped_${dropped}`] : r.codes;
  const none = !kept.length;
  return { ...r, items: kept.map(k => k.item), evidence, notUsed, codes, state: none ? "not_found" : r.state, message: none ? NO_RELEVANT_RESEARCH : r.message, retrieved, accepted: kept.length, excluded };
}

/**
 * SCHOLAR-RESEARCH-RELEVANCE-02, pure. A research summary that says its own sources do not bear on the lesson ("the
 * abstracts are not relevant to the topic ... no findings can be meaningfully added [E1] [E2]") must cite nothing: every
 * source is excluded as model_declared_irrelevant and the plain sentence is shown instead. Otherwise returned unchanged.
 */
export function withdrawDeclaredIrrelevant(r: LearnResearch, summary: string | null | undefined): LearnResearch {
  if (!r.items.length || !declaresIrrelevant(summary)) return r;
  const excluded: ExcludedSource[] = [...(r.excluded ?? []), ...r.items.map(x => ({ pmid: x.pmid, doi: x.doi, title: x.title, reason: "model_declared_irrelevant" as const }))];
  return { ...r, items: [], evidence: [], notUsed: {}, state: "not_found", message: NO_RELEVANT_RESEARCH, codes: [...r.codes, "relevance_model_declared_irrelevant"], retrieved: r.retrieved ?? r.items.length, accepted: 0, excluded };
}

/** What a saved research part looks like when served: only what is relevant to the lesson now. */
export type RestoredResearch = { references: ExternalReference[]; text: string | null; message: string | null; excluded: ExcludedSource[]; retrieved: number; accepted: number };

/**
 * SCHOLAR-RESEARCH-RELEVANCE-02, pure, no AI. A saved teach/research artefact is an immutable record and is never changed;
 * it is FILTERED when served. Its stored external references are judged against the lesson: a source the relevance rules
 * refuse (or every source, when the saved summary itself declares them irrelevant) is left out of the sources, its excerpt
 * goes with it, and its [E n] tags are taken out of the text -- a sentence that cited only excluded sources is removed.
 * References saved after the filter existed carry `relevanceChecked` and are not re-scored (their stored excerpt is shorter
 * than the abstract they were judged on). With no source left the research part is the plain no-research sentence and the
 * notes-based teaching stands unchanged. A lesson that yields no concept cannot judge anything: nothing is removed then.
 */
export function restoreResearch(external: readonly ExternalReference[], text: string | null | undefined, ctx: LessonContext, level: RelevanceLevel = DEFAULT_RELEVANCE): RestoredResearch {
  const declared = declaresIrrelevant(text);
  const concepts = lessonConcepts(ctx), vocab = lessonVocabulary(ctx);
  const excluded: ExcludedSource[] = [], kept: ExternalReference[] = [], gone = new Set<string>();
  for (const ref of external) {
    let reason: ExcludedSource["reason"] | null = null;
    if (declared) reason = "model_declared_irrelevant";
    else if (!ref.relevanceChecked && concepts.length) {
      const s = scoreRelevance({ title: ref.title, abstract: ref.excerpt }, concepts, vocab, level);
      if (!s.pass) reason = exclusionReason(s);
    }
    if (reason) { excluded.push({ pmid: ref.pmid, doi: ref.doi, title: ref.title, reason }); if (ref.tag) gone.add(ref.tag); } else kept.push(ref);
  }
  let shown: string | null = text?.trim() ? text : null;
  if (shown && gone.size) {
    // Line by line (a bullet is a unit), then sentence by sentence. A unit whose citations are ALL excluded goes with them;
    // a unit citing a mix keeps its accepted tags only. Surviving tags keep their numbers: a claim never moves to another source.
    const unit = (sen: string) => {
      const tags = [...sen.matchAll(/\[(E\d+)\]/g)].map(m => m[1]);
      if (tags.length && tags.every(t => gone.has(t))) return "";
      return sen.replace(/\s*\[(E\d+)\]/g, (m, t: string) => (gone.has(t) ? "" : m));
    };
    shown = shown.split("\n").map(line => (line.match(/[^.!?]+[.!?]+(?:\s*\[E\d+\])*\s*|[^.!?]+$/g) ?? [line]).map(unit).join("").trimEnd()).filter(l => l.trim()).join("\n").trim() || null;
  }
  // A summary with no surviving cited source has nothing to stand on.
  if (shown && (!kept.some(k => k.tag) || !/\[E\d+\]/.test(shown))) shown = null;
  return { references: kept, text: shown, message: kept.length ? null : NO_RELEVANT_RESEARCH, excluded, retrieved: external.length, accepted: kept.length };
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
  /** SCHOLAR-RESEARCH-RELEVANCE-02: set when the relevance filter judged this source against its lesson before it was saved. */
  relevanceChecked?: boolean;
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
      ...(r.retrieved !== undefined ? { relevanceChecked: true } : {}),
    };
  });
}
