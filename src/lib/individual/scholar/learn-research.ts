import { cachedResult, researchKey, researchQuery, runResearch, type ProviderCall, type ResearchResult } from "@/lib/holdings/research/service";
import { loadResearchEngine, planFor, researchOperational, researchUsage, type ResearchEngine } from "@/lib/holdings/research/load";
import { toEvidenceRecord } from "@/lib/holdings/research/evidence";
import { PROVIDER_LABEL, type ResearchItem } from "@/lib/holdings/research/providers";
import type { IndividualContext } from "../guard";
import type { ScholarResearchPolicy } from "../policy";
import { LEARN_RESEARCH_OPERATION, type ResearchEvidence } from "./generation";
import { audit } from "./http";
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
  /** Indexes into items: the verified abstracts the model may use, in [E n] order. */
  evidence: number[];
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

const MESSAGE: Partial<Record<LearnResearchState, string>> = {
  not_found: "No published research matching this topic was found. The answer below is from your notes.",
  failed: "The research sources could not be reached just now. The answer below is from your notes.",
};

/** Whether Research & Explain is operational for Scholar Learn right now (the engine's word, not Scholar's). */
export async function scholarResearchOperational(admin: unknown, engine?: ResearchEngine): Promise<boolean> {
  return researchOperational(engine ?? await loadResearchEngine(admin), "scholar", "learn");
}

/** The research for one Learn request, within the learner's limits and the engine's configuration. */
/** `actionId`: the Scholar AI action this research serves, so its usage and cost are attributed to that action's outcome. */
export async function learnResearch(ctx: IndividualContext, p: ScholarResearchPolicy, input: { question?: string | null; topics: readonly string[]; title?: string | null }, actionId: string | null = null): Promise<LearnResearch> {
  const engine = await loadResearchEngine(ctx.admin);
  if (!p.modes.includes("research") || !researchOperational(engine, "scholar", "learn")) return none("off", "Research & Explain is not available on Scholar at the moment.", ["off"]);
  const q = researchQuery(input);
  if (!q.ok) return none("refused", q.reason === "identifier" ? "Research was not run: the topic looks like it identifies a patient." : "There was no topic to research.", [`query_${q.reason}`]);
  const plan = planFor(engine, "scholar", "learn");
  const rules = { excerptChars: engine.policy.rules.excerptChars, furtherReading: engine.policy.rules.showFurtherReading, licensing: Object.fromEntries(Object.values(engine.registry).map(r => [r.id, r.licensing])) };
  const key = researchKey(q.query, plan);
  const cached = await readResearchCache(ctx.admin, key, new Date().toISOString());
  const usage = researchUsage(ctx.admin, { actionId, product: "scholar", operation: LEARN_RESEARCH_OPERATION, workflow: "basic", policy: plan.policy });
  if (cached) {
    await usage.record({ provider: "cache", capability: "search", requests: 0, results: cached.sources.length, outcome: "cache", latencyMs: 0, costUsd: 0 });
    return { ...fromResult(cachedResult(q.query, cached.sources as unknown[], plan)), ...rules };
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
  return { ...fromResult(r), ...rules };
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
};

/** Pure. Evidence items first (tagged E1 ...), then further reading (untagged, when the rules show it). Only what the providers returned. */
export function externalReferences(r: LearnResearch): ExternalReference[] {
  const rest = r.furtherReading ? r.items.map((_, i) => i).filter(i => !r.evidence.includes(i)) : [];
  return [...r.evidence, ...rest].map((i, n) => {
    const x = r.items[i];
    const rec = toEvidenceRecord(x, { question: null, query: r.query ?? "", strategy: "basic", sourceVersion: r.sourceVersions[x.provider] ?? "", licensing: r.licensing[x.provider] ?? "" }).verified;
    const evidence = n < r.evidence.length;
    const max = r.excerptChars;
    return {
      kind: "external", tag: evidence ? `E${n + 1}` : null, provider: PROVIDER_LABEL[x.provider], title: rec.title, journal: rec.source, year: rec.year, authors: rec.authors,
      pmid: rec.pmid, doi: rec.doi, url: rec.url, evidence,
      excerpt: evidence && rec.abstract && max > 0 ? (rec.abstract.length > max ? `${rec.abstract.slice(0, max).replace(/\s+\S*$/, "")}…` : rec.abstract) : null,
      verified: rec.identity, retrievedAt: rec.retrievedAt, sourceVersion: rec.sourceVersion || null, reuse: rec.reuse,
    };
  });
}
