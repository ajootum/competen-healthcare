import { createHash } from "node:crypto";
import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import {
  normaliseDoi, pmcOpenAccess, researchContact, scholarSearchUrl, searchOpenAlex, searchPubmed, verifyDoi,
  type FetchLike, type ProviderDeps, type ResearchItem,
} from "./providers";
import { invocableProviders, notInvocable, type Capability, type ProviderRecord, type Registry, type ResearchActivity, type ResearchProduct } from "./registry";
import { workflowOperational, type ResearchPolicy, type Workflow } from "./engine-config";

// ── THE HOLDINGS RESEARCH & EVIDENCE ENGINE ── COMPETEN-RESEARCH-01 + ADDENDUM V2 ───────────────────────────────────────
//
// One shared lib module, not an AI engine: it searches the sources the registry (registry.ts) has ACTIVE for this
// product, activity and capability, and returns what they said, verified. It writes nothing of its own, calls no model
// and decides nothing clinical. A product (Scholar first) gives it a query it has already screened, the published
// configuration, a cache and a usage recorder; the product's own AI path (routing, eligibility, grounding) decides what
// is written from the result.
//
// Workflow (the Basic workflow, engine-config.ts): the workflow must be OPERATIONAL (Active, every step and capability it
// needs Active) -> the search sources in the governed order -> each call through the one gate (notInvocable) and its
// budget, recorded as research usage and cost, separately from AI cost -> merge and de-duplicate (DOI, PMID, title) ->
// plausible dates (never future, within the source's freshness) -> identity: a PMID is PubMed's own, a DOI is checked
// against Crossref (when Crossref is Active), and an item whose DOI Crossref contradicts is dropped. EVIDENCE is the
// subset with an abstract AND a verified identity. Everything else is further reading: its real link, never offered to
// the model, never treated as evidence. Metadata is never full text.
//
// ⚠ PRIVACY. researchQuery builds the only text that leaves: a handful of topic keywords. It refuses outright when the
// source text looks like it identifies a patient. Nothing else of the learner's is ever passed in.

export const RESEARCH_SERVICE_VERSION = "holdings-research-v2";
export const RESEARCH_MAX_RESULTS = 10;
const QUERY_WORDS = 8;
const STOP = new Set(("the and for with from that this what when which into about their there these those have has had been were was are "
  + "how why who does did can could should would will may might must not but its it's our your you they them than then also such each other "
  + "explain teach tell give show please help understand understanding notes note section step lesson learn learning more simply example examples "
  + "summary summarise summarize deeper detail detailed").split(/\s+/));

/** One request: who it is for, and the published configuration it runs under. */
export type ResearchPlan = { product: ResearchProduct; activity: ResearchActivity; registry: Registry; policy: ResearchPolicy; workflow: Workflow | undefined };

export type ResearchCache = {
  read: (key: string) => Promise<ResearchItem[] | null>;
  write: (key: string, items: ResearchItem[], providerCode: string, days: number) => Promise<void>;
};
/** One provider call (or a cache hit), as research usage. No query text and no person. */
export type UsageRow = { provider: string; capability: Capability; requests: number; results: number; outcome: "ok" | "failed" | "refused" | "budget" | "cache"; latencyMs: number; costUsd: number };
export type ResearchUsage = {
  record: (row: UsageRow) => Promise<void>;
  /** Whether this provider's daily request and spend budgets (and the engine's) leave room. Unreadable: false. */
  allow: (r: ProviderRecord) => Promise<boolean>;
};

export type ProviderCall = { provider: string; calls: number; failed: number };
export type ResearchResult = {
  state: "cached" | "searched" | "not_found" | "failed";
  query: string;
  items: ResearchItem[];
  /** Indexes into `items` that may ground an explanation: an abstract and a verified identity. */
  evidence: number[];
  calls: ProviderCall[];
  /** Codes only, for the outcome record: provider failures, refusals and what was dropped. */
  codes: string[];
  /** The Google Scholar link, only when that registry record is Active. */
  scholarLink: string | null;
  /** provider id -> the registry record version the result was retrieved under (provenance). */
  sourceVersions: Record<string, string>;
};

/** Pure. The research query: topic keywords only, bounded. Refused if the source text may identify a patient. */
export function researchQuery(parts: { question?: string | null; topics?: readonly string[]; title?: string | null }): { ok: true; query: string } | { ok: false; reason: "empty" | "identifier" } {
  const source = (parts.question?.trim() || (parts.topics ?? []).slice(0, 4).join(" ") || parts.title?.trim() || "").slice(0, 600);
  if (!source) return { ok: false, reason: "empty" };
  if (findPatientIdentifiers(source).length) return { ok: false, reason: "identifier" };
  const words = [...new Set((source.toLowerCase().normalize("NFKD").match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(w => !STOP.has(w)))].slice(0, QUERY_WORDS);
  return words.length ? { ok: true, query: words.join(" ") } : { ok: false, reason: "empty" };
}

/** The sources a plan would search, in order: the product's source policy order when it lists any, else priority. */
export function searchSources(plan: ResearchPlan, now?: Date): ProviderRecord[] {
  const ctx = { product: plan.product, activity: plan.activity, capability: "search" as const, now };
  const all = invocableProviders(plan.registry, ctx);
  const order = plan.policy.sources[plan.product]?.providers ?? [];
  return order.length ? order.map(id => all.find(r => r.id === id)).filter((r): r is ProviderRecord => !!r) : all;
}
const verifier = (plan: ResearchPlan, now?: Date) =>
  plan.policy.rules.doiVerification ? invocableProviders(plan.registry, { product: plan.product, activity: plan.activity, capability: "doi_verification", now })[0] ?? null : null;
/** SCHOLAR-SQIE-02: the open-access link source (PubMed Central), only while Active and the rule is on. */
const openAccessSource = (plan: ResearchPlan, now?: Date) =>
  plan.policy.rules.openAccessLinks ? invocableProviders(plan.registry, { product: plan.product, activity: plan.activity, capability: "open_access", now })[0] ?? null : null;

/** Pure. The cache key: the sources (at their versions) and every setting that decides the result, nothing of the learner's. */
export function researchKey(query: string, plan: ResearchPlan, now?: Date): string {
  const src = searchSources(plan, now).map(r => `${r.id}@${r.version}:${r.depth}:${r.freshnessYears}`);
  const v = verifier(plan, now), oa = openAccessSource(plan, now);
  const p = plan.policy;
  // An open-access source joins the key only when one is in play, so every key made without one is unchanged.
  return createHash("sha256").update(JSON.stringify([RESEARCH_SERVICE_VERSION, src, v ? `${v.id}@${v.version}` : null, p.rules.abstractsAsEvidence, p.limits.maxResultsPerRequest, plan.workflow?.maxSources ?? 0, query.toLowerCase().trim(), ...(oa ? [`${oa.id}@${oa.version}`] : [])])).digest("hex");
}

const titleKey = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").slice(0, 120);

/** Pure. Merge in priority order: the first copy of a work wins; a later copy may only lend an abstract it lacks. */
export function mergeItems(lists: readonly (readonly ResearchItem[])[]): ResearchItem[] {
  const out: ResearchItem[] = [];
  for (const list of lists) for (const raw of list) {
    const i = { ...raw, verified: { ...raw.verified } };
    const same = out.find(o => (o.doi && o.doi === i.doi) || (o.pmid && o.pmid === i.pmid) || titleKey(o.title) === titleKey(i.title));
    if (!same) { out.push(i); continue; }
    if (!same.abstract && i.abstract) { same.abstract = i.abstract; same.abstractFrom = i.provider; }
    same.doi ??= i.doi;
    if (!same.pmid && i.pmid) { same.pmid = i.pmid; same.verified.pmid = i.verified.pmid; }
    else if (same.pmid === i.pmid && i.verified.pmid) same.verified.pmid = true;
  }
  return out;
}

/** Pure. A plausible date: never in the future, and within the source's freshness when one is set (unknown fails then). */
export function datePlausible(year: number | null, maxAgeYears: number, now: Date): boolean {
  const thisYear = now.getUTCFullYear();
  if (year !== null && year > thisYear) return false;
  if (maxAgeYears <= 0) return true;
  return year !== null && year >= thisYear - maxAgeYears;
}

/** Pure. Whether an item may ground an explanation: it has an abstract and its identity was verified. */
export const isEvidence = (i: ResearchItem) => !!i.abstract && (i.verified.pmid || i.verified.doi === true);

const evidenceOf = (items: readonly ResearchItem[], max: number) => items.flatMap((x, n) => (isEvidence(x) ? [n] : [])).slice(0, max);

/** Pure. A result read back from a cache: only well-formed items, re-checked for evidence. No provider was called. */
export function cachedResult(query: string, cached: readonly unknown[], plan?: ResearchPlan): ResearchResult {
  const items = (cached as ResearchItem[]).filter(i => typeof i?.title === "string" && typeof i?.url === "string" && !!i.verified).slice(0, RESEARCH_MAX_RESULTS);
  return { state: items.length ? "cached" : "not_found", query, items, evidence: evidenceOf(items, plan?.policy.rules.maxEvidence ?? RESEARCH_MAX_RESULTS), calls: [], codes: ["cache_hit"], scholarLink: plan ? linkFor(plan, query) : null, sourceVersions: plan ? versions(plan) : {} };
}

const linkFor = (plan: ResearchPlan, query: string) =>
  plan.policy.rules.scholarLink && notInvocable(plan.registry.google_scholar_link, { product: plan.product, activity: plan.activity, capability: "external_link" }) === null ? scholarSearchUrl(query) : null;
const versions = (plan: ResearchPlan) => Object.fromEntries(Object.values(plan.registry).filter(r => r.status === "active").map(r => [r.id, `${r.id}@v${r.version}`]));

export type ResearchDeps = { fetch?: FetchLike; now?: () => Date; cache?: ResearchCache | null; usage?: ResearchUsage | null };

/** A fetch that counts the HTTP requests one provider makes, so its usage and cost are what was actually sent. */
const counting = (f: FetchLike) => { let n = 0; const fn: FetchLike = (u, i) => { n++; return f(u, i); }; return { fn, count: () => n }; };

/** Search, merge, date-check and verify, under the published plan. Fails soft: a provider that fails is a code, not an error. */
export async function runResearch(query: string, plan: ResearchPlan, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const now = deps.now ?? (() => new Date());
  const empty = (state: ResearchResult["state"], codes: string[] = []): ResearchResult => ({ state, query, items: [], evidence: [], calls: [], codes, scholarLink: null, sourceVersions: {} });
  if (!workflowOperational(plan.workflow, plan.registry, { product: plan.product, activity: plan.activity })) return empty("failed", ["workflow_not_operational"]);
  const sources = searchSources(plan, now());
  if (!sources.length) return empty("failed", ["no_provider"]);
  const key = researchKey(query, plan, now());
  const cached = deps.cache ? await deps.cache.read(key).catch(() => null) : null;
  if (cached) {
    await deps.usage?.record({ provider: sources[0].id, capability: "search", requests: 0, results: cached.length, outcome: "cache", latencyMs: 0, costUsd: 0 }).catch(() => {});
    return cachedResult(query, cached, plan);
  }

  const contact = researchContact();
  const base = deps.fetch ?? (fetch as unknown as FetchLike);
  const max = Math.max(1, Math.min(RESEARCH_MAX_RESULTS, plan.policy.limits.maxResultsPerRequest, plan.workflow?.maxSources ?? RESEARCH_MAX_RESULTS));
  const calls: ProviderCall[] = [], codes: string[] = [];

  /** ⚠ Every provider call goes through here: the gate again (defence in depth), the budget, then the adapter. */
  async function call<T>(r: ProviderRecord, capability: Capability, run: (p: ProviderDeps) => Promise<T | null>): Promise<T | null> {
    const blocked = notInvocable(r, { product: plan.product, activity: plan.activity, capability, now: now() });
    if (blocked) { codes.push(`${r.id}_${blocked}`); return null; }
    if (deps.usage && !(await deps.usage.allow(r).catch(() => false))) {
      codes.push(`${r.id}_budget`);
      await deps.usage.record({ provider: r.id, capability, requests: 0, results: 0, outcome: "budget", latencyMs: 0, costUsd: 0 }).catch(() => {});
      return null;
    }
    const c = counting(base);
    const started = Date.now();
    let out: T | null = null;
    for (let attempt = 0; attempt <= plan.policy.limits.retries && out === null; attempt++)
      out = await run({ fetch: c.fn, timeoutMs: plan.policy.limits.timeoutMs, contact, now }).catch(() => null);
    const results = Array.isArray(out) ? out.length : out === null ? 0 : 1;
    await deps.usage?.record({ provider: r.id, capability, requests: c.count(), results, outcome: out === null ? "failed" : "ok", latencyMs: Date.now() - started, costUsd: +(c.count() * r.costPerRequestUsd).toFixed(4) }).catch(() => {});
    return out;
  }

  const ADAPTER: Record<string, (p: ProviderDeps, r: ProviderRecord) => Promise<ResearchItem[] | null>> = {
    pubmed: (p, r) => searchPubmed(p, query, Math.min(max, r.depth), plan.policy.rules.abstractsAsEvidence && r.capabilities.includes("abstracts")),
    openalex: (p, r) => searchOpenAlex(p, query, Math.min(max, r.depth), plan.policy.rules.abstractsAsEvidence && r.capabilities.includes("abstracts")),
  };
  const found = await Promise.all(sources.map(r => (ADAPTER[r.id] ? call(r, "search", p => ADAPTER[r.id](p, r)) : (codes.push(`${r.id}_no_search_adapter`), Promise.resolve(null)))));
  sources.forEach((r, n) => { calls.push({ provider: r.id, calls: 1, failed: found[n] === null ? 1 : 0 }); if (found[n] === null && !codes.some(c => c.startsWith(`${r.id}_`))) codes.push(`${r.id}_failed`); });
  if (found.every(f => f === null)) return { ...empty("failed", codes), calls };

  let items = mergeItems(found.filter((f): f is ResearchItem[] => f !== null));
  const fresh = (i: ResearchItem) => datePlausible(i.year, plan.registry[i.provider]?.freshnessYears ?? 15, now());
  if (items.some(i => !fresh(i))) codes.push("dropped_date");
  items = items.filter(fresh).slice(0, max);

  const v = verifier(plan, now());
  if (v && items.some(i => i.doi)) {
    const checks = await Promise.all(items.map(i => (i.doi ? call(v, "doi_verification", p => verifyDoi(p, i).then(x => (x === null ? null : { ok: x }))) : Promise.resolve(null))));
    calls.push({ provider: v.id, calls: items.filter(i => i.doi).length, failed: items.filter((i, k) => i.doi && checks[k] === null).length });
    items.forEach((i, k) => { if (i.doi) i.verified.doi = checks[k] ? checks[k]!.ok : null; });
    if (items.some(i => i.verified.doi === false)) codes.push("dropped_identity");
    items = items.filter(i => i.verified.doi !== false);
  }
  // SCHOLAR-SQIE-02: PubMed Central's open-access link and licence, for PMIDs PubMed itself returned. A link only: the
  // full text is never fetched, so it never becomes evidence. A failed lookup leaves the items as they were.
  const oa = openAccessSource(plan, now());
  if (oa && items.some(i => i.pmid && i.verified.pmid)) {
    const found = await call(oa, "open_access", p => pmcOpenAccess(p, items.filter(i => i.pmid && i.verified.pmid).map(i => i.pmid!)));
    calls.push({ provider: oa.id, calls: 1, failed: found === null ? 1 : 0 });
    if (found) items.forEach(i => { if (i.pmid && i.verified.pmid) i.openAccess = found.get(i.pmid) ?? null; });
  }
  // Belt and braces: every field shown later must be what a provider gave, and the link must be the record's own.
  items = items.filter(i => /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|openalex\.org)\//.test(i.url) && (!i.doi || normaliseDoi(i.doi) === i.doi));
  items.forEach(i => { if (i.openAccess && !/^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/$/.test(i.openAccess.url)) i.openAccess = null; });

  const cacheDays = Math.min(plan.policy.limits.cacheDays, ...sources.map(r => r.cacheDays));
  if (deps.cache) await deps.cache.write(key, items, sources.map(r => r.id).join("+"), cacheDays).catch(() => {});
  return { state: items.length ? "searched" : "not_found", query, items, evidence: evidenceOf(items, plan.policy.rules.maxEvidence), calls, codes, scholarLink: linkFor(plan, query), sourceVersions: versions(plan) };
}
