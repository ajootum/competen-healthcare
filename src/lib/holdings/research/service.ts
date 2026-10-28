import { createHash } from "node:crypto";
import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import {
  RESEARCH_PROVIDERS, normaliseDoi, researchContact, scholarSearchUrl, searchOpenAlex, searchPubmed, verifyDoi,
  type FetchLike, type ProviderDeps, type ResearchItem, type ResearchProvider,
} from "./providers";

// ── THE HOLDINGS RESEARCH SERVICE ── COMPETEN-RESEARCH-01 (owner direction 2026-10-28) ──────────────────────────────
//
// A shared lib module, not an AI engine: it searches the approved academic providers for a topic and returns what
// they said, verified. It writes nothing, calls no model and decides nothing clinical. A product (Scholar first)
// gives it a query it has already screened, its governed configuration and a cache; the product's own AI path
// (routing, eligibility, grounding) decides what is written from the result.
//
// Workflow (directive item 4, steps 3 to 5): search the providers in their governed priority order -> merge and
// de-duplicate (DOI, PMID, title) -> keep only plausible dates (not in the future, within the governed age) -> verify
// identity: a PMID is PubMed's own, a DOI is checked against Crossref, and an item whose DOI Crossref contradicts is
// dropped. EVIDENCE is the subset with an abstract AND a verified identity. Everything else is further reading:
// shown with its real link, never offered to the model, never treated as evidence. Metadata is never full text.
//
// ⚠ PRIVACY. researchQuery builds the only text that leaves: a handful of topic keywords. It refuses outright when
// the source text looks like it identifies a patient. Nothing else of the learner's is ever passed in.

export const RESEARCH_SERVICE_VERSION = "holdings-research-v1";
export const RESEARCH_MAX_RESULTS = 10;
const QUERY_WORDS = 8;
const STOP = new Set(("the and for with from that this what when which into about their there these those have has had been were was are "
  + "how why who does did can could should would will may might must not but its it's our your you they them than then also such each other "
  + "explain teach tell give show please help understand understanding notes note section step lesson learn learning more simply example examples "
  + "summary summarise summarize deeper detail detailed").split(/\s+/));

export type ResearchConfig = {
  /** In governed priority order. Empty: research is off. */
  providers: readonly ResearchProvider[];
  /** At most this many results in all (and from each provider). */
  maxResults: number;
  /** Fetch abstracts (PubMed efetch, OpenAlex's index). Off: every item is metadata only, so nothing is evidence. */
  abstracts: boolean;
  /** Check each DOI against Crossref. */
  verifyDoi: boolean;
  /** Keep only work published within this many years. 0: any date (still never in the future). */
  maxAgeYears: number;
};

export type ResearchCache = {
  read: (key: string) => Promise<ResearchItem[] | null>;
  write: (key: string, items: ResearchItem[], providerCode: string) => Promise<void>;
};

export type ProviderCall = { provider: ResearchProvider | "crossref"; calls: number; failed: number };
export type ResearchResult = {
  state: "cached" | "searched" | "not_found" | "failed";
  query: string;
  items: ResearchItem[];
  /** Indexes into `items` that may ground an explanation: an abstract and a verified identity. */
  evidence: number[];
  calls: ProviderCall[];
  /** Codes only, for the outcome record: provider failures and what was dropped. */
  codes: string[];
  scholarLink: string;
};

/** Pure. The research query: topic keywords only, bounded. Refused if the source text may identify a patient. */
export function researchQuery(parts: { question?: string | null; topics?: readonly string[]; title?: string | null }): { ok: true; query: string } | { ok: false; reason: "empty" | "identifier" } {
  const source = (parts.question?.trim() || (parts.topics ?? []).slice(0, 4).join(" ") || parts.title?.trim() || "").slice(0, 600);
  if (!source) return { ok: false, reason: "empty" };
  if (findPatientIdentifiers(source).length) return { ok: false, reason: "identifier" };
  const words = [...new Set((source.toLowerCase().normalize("NFKD").match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(w => !STOP.has(w)))].slice(0, QUERY_WORDS);
  return words.length ? { ok: true, query: words.join(" ") } : { ok: false, reason: "empty" };
}

/** Pure. The cache key: everything that decides the result, nothing of the learner's. */
export function researchKey(query: string, c: ResearchConfig): string {
  return createHash("sha256").update(JSON.stringify([RESEARCH_SERVICE_VERSION, [...c.providers], c.maxResults, c.abstracts, c.verifyDoi, c.maxAgeYears, query.toLowerCase().trim()])).digest("hex");
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

/** Pure. A plausible date: never in the future, and within the governed age when one is set (unknown fails then). */
export function datePlausible(year: number | null, maxAgeYears: number, now: Date): boolean {
  const thisYear = now.getUTCFullYear();
  if (year !== null && year > thisYear) return false;
  if (maxAgeYears <= 0) return true;
  return year !== null && year >= thisYear - maxAgeYears;
}

/** Pure. Whether an item may ground an explanation: it has an abstract and its identity was verified. */
export const isEvidence = (i: ResearchItem) => !!i.abstract && (i.verified.pmid || i.verified.doi === true);

/** Pure. A result read back from a cache: only well-formed items, re-checked for evidence. No provider was called. */
export function cachedResult(query: string, cached: readonly unknown[]): ResearchResult {
  const items = (cached as ResearchItem[]).filter(i => typeof i?.title === "string" && typeof i?.url === "string" && !!i.verified).slice(0, RESEARCH_MAX_RESULTS);
  return { state: items.length ? "cached" : "not_found", query, items, evidence: items.flatMap((x, n) => (isEvidence(x) ? [n] : [])), calls: [], codes: ["cache_hit"], scholarLink: scholarSearchUrl(query) };
}

export type ResearchDeps ={ fetch?: FetchLike; timeoutMs?: number; now?: () => Date; cache?: ResearchCache | null };

/** Search, merge, date-check and verify. Fails soft: a provider that fails is a code, not an error. */
export async function runResearch(query: string, c: ResearchConfig, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const scholarLink = scholarSearchUrl(query);
  const providers = c.providers.filter(p => RESEARCH_PROVIDERS.includes(p));
  const empty = (state: ResearchResult["state"], codes: string[] = []): ResearchResult => ({ state, query, items: [], evidence: [], calls: [], codes, scholarLink });
  if (!providers.length) return empty("failed", ["no_provider"]);
  const key = researchKey(query, c);
  const cached = deps.cache ? await deps.cache.read(key).catch(() => null) : null;
  if (cached) return cachedResult(query, cached);

  const now = deps.now ?? (() => new Date());
  const p: ProviderDeps = { fetch: deps.fetch ?? (fetch as unknown as FetchLike), timeoutMs: deps.timeoutMs ?? 6000, contact: researchContact(), now };
  const max = Math.max(1, Math.min(RESEARCH_MAX_RESULTS, Math.floor(c.maxResults)));
  const found = await Promise.all(providers.map(pr => (pr === "pubmed" ? searchPubmed(p, query, max, c.abstracts) : searchOpenAlex(p, query, max, c.abstracts)).catch(() => null)));
  const calls: ProviderCall[] = providers.map((pr, n) => ({ provider: pr, calls: 1, failed: found[n] === null ? 1 : 0 }));
  const codes = providers.flatMap((pr, n) => (found[n] === null ? [`${pr}_failed`] : []));
  if (found.every(f => f === null)) return { ...empty("failed", codes), calls };

  let items = mergeItems(found.filter((f): f is ResearchItem[] => f !== null));
  const dated = items.filter(i => datePlausible(i.year, c.maxAgeYears, now()));
  if (dated.length < items.length) codes.push("dropped_date");
  items = dated.slice(0, max);

  if (c.verifyDoi && items.some(i => i.doi)) {
    const checks = await Promise.all(items.map(i => (i.doi ? verifyDoi(p, i).catch(() => null) : Promise.resolve(null))));
    const n = items.filter(i => i.doi).length;
    calls.push({ provider: "crossref", calls: n, failed: items.filter((i, k) => i.doi && checks[k] === null).length });
    items.forEach((i, k) => { if (i.doi) i.verified.doi = checks[k]; });
    if (items.some(i => i.verified.doi === false)) codes.push("dropped_identity");
    items = items.filter(i => i.verified.doi !== false);
  }
  // Belt and braces: every field shown later must be what a provider gave, and the link must be the record's own.
  items = items.filter(i => /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|openalex\.org)\//.test(i.url) && (!i.doi || normaliseDoi(i.doi) === i.doi));

  if (deps.cache) await deps.cache.write(key, items, providers.join("+")).catch(() => {});
  return { state: items.length ? "searched" : "not_found", query, items, evidence: items.flatMap((x, n) => (isEvidence(x) ? [n] : [])), calls, codes, scholarLink };
}
