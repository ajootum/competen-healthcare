import { RESEARCH_SERVICE_VERSION, cachedResult, researchKey, researchQuery, runResearch, type ProviderCall, type ResearchConfig, type ResearchResult } from "@/lib/holdings/research/service";
import { PROVIDER_LABEL, type ResearchItem } from "@/lib/holdings/research/providers";
import type { IndividualContext } from "../guard";
import type { ScholarResearchPolicy } from "../policy";
import { LEARN_RESEARCH_OPERATION, type ResearchEvidence } from "./generation";
import { audit } from "./http";
import { LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, aiSpendToday, learnResearchToday, readResearchCache, writeResearchCache } from "./store";

// ── LEARN: RESEARCH & EXPLAIN ── COMPETEN-RESEARCH-01 (owner direction 2026-10-28) ──────────────────────────────────
//
// Scholar's side of the shared Holdings research service (src/lib/holdings/research). It decides only whether to
// search and what the search is: the governed configuration (policy.ts scholarResearch), the learner's daily search
// and spend limits, the query (topic keywords, screened for identifiers), and the public cache migration 570 built
// (individual_scholar_research_cache: no user id, nothing of the learner's). The AI path -- routing, eligibility,
// the grounding check -- is the existing Learn engine's, unchanged.
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
  /** Indexes into items: the verified abstracts the model may use, in [E n] order. */
  evidence: number[];
  calls: ProviderCall[];
  codes: string[];
};

export function researchConfig(p: ScholarResearchPolicy): ResearchConfig {
  return { providers: p.providers, maxResults: p.maxResults, abstracts: p.abstracts, verifyDoi: p.verifyDoi, maxAgeYears: p.maxAgeYears };
}

const none = (state: LearnResearchState, message: string | null, codes: string[] = [], query: string | null = null): LearnResearch =>
  ({ state, message, query, scholarLink: null, items: [], evidence: [], calls: [], codes });

const MESSAGE: Partial<Record<LearnResearchState, string>> = {
  not_found: "No published research matching this topic was found. The answer below is from your notes.",
  failed: "The research providers could not be reached just now. The answer below is from your notes.",
};

/** The research for one Learn request, within the learner's limits. */
export async function learnResearch(ctx: IndividualContext, p: ScholarResearchPolicy, input: { question?: string | null; topics: readonly string[]; title?: string | null }): Promise<LearnResearch> {
  if (!p.modes.includes("research") || !p.providers.length) return none("off", "Research & Explain is not switched on for Scholar.", ["off"]);
  const q = researchQuery(input);
  if (!q.ok) return none("refused", q.reason === "identifier" ? "Research was not run: the topic looks like it identifies a patient." : "There was no topic to research.", [`query_${q.reason}`]);
  const cfg = researchConfig(p);
  const key = researchKey(q.query, cfg);
  const cached = await readResearchCache(ctx.admin, key, new Date().toISOString());
  if (cached) return fromResult(cachedResult(q.query, cached.sources as unknown[]));

  const [count, spend] = await Promise.all([learnResearchToday(ctx.admin, ctx.userId), aiSpendToday(ctx.admin, ctx.userId, LEARN_RESEARCH_OPERATION)]);
  if (count === null || spend === null) return none("failed", "Your research allowance could not be checked, so no research was run.", ["limit_unreadable"], q.query);
  if (count >= p.dailyMax) return none("limit", `You have used today's ${p.dailyMax} research requests. The answer below is from your notes.`, ["limit_count"], q.query);
  if (spend * 100 >= p.dailyCostCents) return none("limit", "Today's research allowance is used up. The answer below is from your notes.", ["limit_cost"], q.query);

  const r = await runResearch(q.query, cfg, {
    cache: { read: async () => null, write: (k, items, providers) => writeResearchCache(ctx.admin, { key: k, provider: `holdings:${providers}`, policyVersion: `${RESEARCH_SERVICE_VERSION}:n${cfg.maxResults}`, sources: items as never, searches: cfg.providers.length, days: p.cacheDays }) },
  });
  // One row per fresh search: counts and codes only, never the query text. It is what the daily limit counts.
  await audit(ctx, LEARN_RESEARCH_AUDIT_ACTION, LEARN_RESEARCH_ENTITY, null,
    { query_chars: q.query.length, state: r.state, items: r.items.length, evidence: r.evidence.length, calls: r.calls, codes: r.codes });
  return fromResult(r);
}

function fromResult(r: ResearchResult): LearnResearch {
  return { state: r.state, message: MESSAGE[r.state] ?? null, query: r.query, scholarLink: r.scholarLink, items: r.items, evidence: r.evidence, calls: r.calls, codes: r.codes };
}

/** Pure. What the model is shown: the verified abstracts only, in [E n] order. */
export const researchEvidence = (r: LearnResearch): ResearchEvidence[] =>
  r.evidence.map(i => r.items[i]).map(x => ({ title: x.title, journal: x.journal, year: x.year, abstract: x.abstract ?? "" }));

/** One external reference as shown and saved: provider fields only, labelled, with the real identifiers and link. */
export type ExternalReference = {
  kind: "external"; tag: string | null; provider: string; title: string; journal: string | null; year: number | null; authors: string[];
  pmid: string | null; doi: string | null; url: string; evidence: boolean; excerpt: string | null; verified: { pmid: boolean; doi: boolean | null }; retrievedAt: string;
};
const EXCERPT = 320;

/** Pure. Evidence items first (tagged E1 ...), then further reading (untagged). Only what the providers returned. */
export function externalReferences(r: LearnResearch): ExternalReference[] {
  const order = [...r.evidence, ...r.items.map((_, i) => i).filter(i => !r.evidence.includes(i))];
  return order.map((i, n) => {
    const x = r.items[i];
    const evidence = n < r.evidence.length;
    return {
      kind: "external", tag: evidence ? `E${n + 1}` : null, provider: PROVIDER_LABEL[x.provider], title: x.title, journal: x.journal, year: x.year, authors: x.authors,
      pmid: x.pmid, doi: x.doi, url: x.url, evidence, excerpt: evidence && x.abstract ? (x.abstract.length > EXCERPT ? `${x.abstract.slice(0, EXCERPT).replace(/\s+\S*$/, "")}…` : x.abstract) : null,
      verified: x.verified, retrievedAt: x.retrievedAt,
    };
  });
}
