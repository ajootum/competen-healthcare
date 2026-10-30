// ── HOLDINGS RESEARCH PROVIDERS ── COMPETEN-RESEARCH-01 (owner direction 2026-10-28) ────────────────────────────────
//
// The three academic sources the shared research capability may call, and nothing else:
//   PubMed E-utilities (NCBI): esearch for PMIDs, esummary for metadata, efetch for abstracts.
//   OpenAlex: works search, with the abstract when OpenAlex holds one (its data is CC0).
//   Crossref: one DOI at a time, to verify that the DOI exists and names the same work (title and year).
//   PubMed Central (SCHOLAR-SQIE-02): for PMIDs PubMed returned, whether an open-access copy exists, its licence and link.
// Google Scholar is a plain outbound link only (scholarSearchUrl). It is never fetched or scraped.
//
// ⚠ SERVER SIDE ONLY, AND ONLY THE QUERY LEAVES. Each call carries the search query (built by service.ts from the
// topic, screened for patient identifiers) or a DOI the provider itself returned -- never a learner's notes, name,
// id or anything they uploaded. The app identifies itself politely (NCBI tool + email, OpenAlex and Crossref mailto).
//
// ⚠ FAIL SOFT. Every call has a timeout, and a provider that fails, times out or answers malformed returns null. The
// caller carries on with what the others returned, or with the learner's notes alone. Nothing here throws.
//
// ⚠ NOTHING IS INVENTED. Every field of a ResearchItem is copied from a provider response. An item with no abstract
// is metadata only (abstract: null) and service.ts never offers it to the model as evidence.

export type ResearchProvider = "pubmed" | "openalex";
export const RESEARCH_PROVIDERS: readonly ResearchProvider[] = ["pubmed", "openalex"];
export const PROVIDER_LABEL: Record<ResearchProvider | "crossref", string> = { pubmed: "PubMed", openalex: "OpenAlex", crossref: "Crossref" };

export type ResearchItem = {
  provider: ResearchProvider;
  /** The provider's own id: a PMID for PubMed, the W-id for OpenAlex. */
  sourceId: string;
  pmid: string | null;
  doi: string | null;
  title: string;
  journal: string | null;
  /** Year of publication, as the provider gives it. */
  year: number | null;
  /** First authors, as the provider lists them (public bibliographic metadata). */
  authors: string[];
  /** The record's own page: PubMed, the DOI resolver, or OpenAlex. */
  url: string;
  /** The abstract, as the provider returned it, bounded. null = metadata only, never evidence. */
  abstract: string | null;
  /** When the abstract came from another provider's copy of the same work (merge), that provider. */
  abstractFrom?: ResearchProvider;
  /** Identity checks: the PMID came from PubMed itself, the DOI was confirmed by Crossref (null = not checked). */
  verified: { pmid: boolean; doi: boolean | null };
  retrievedAt: string;
  /**
   * SCHOLAR-SQIE-02 s6: PubMed Central's word that an open-access copy exists, its licence and its link. A LINK the
   * learner may follow: the full text is never fetched, so this never makes the item full-text evidence. Absent or
   * null: not checked, or not in the open-access subset.
   */
  openAccess?: OpenAccess | null;
  /**
   * SCHOLAR-SOURCE-QUALITY-01: PubMed's publication types for the record (esummary pubtype), exactly as PubMed writes
   * them ("Review", "Case Reports" ...). Only PubMed gives them: absent for every other source = not known.
   */
  pubTypes?: string[];
};

export type OpenAccess = { pmcid: string; licence: string | null; url: string; retracted: boolean };

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
export type ProviderDeps = { fetch: FetchLike; timeoutMs: number; contact: { tool: string; email: string }; now: () => Date };

export const ABSTRACT_MAX = 2400; // ten of these and their metadata stay inside 570's 40,000-byte cache row
const TITLE_MAX = 300;

/** The polite identity every request carries, from the environment (never a learner's details). */
export function researchContact(): { tool: string; email: string } {
  const email = (process.env.RESEARCH_CONTACT_EMAIL ?? "").trim();
  return { tool: "competen-scholar", email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "hello@competenhealthcare.com" };
}

/** GET with a timeout. A network failure or timeout is null; a non-2xx answer keeps its status and has no body. */
async function getRaw(deps: ProviderDeps, url: string): Promise<{ status: number; text: string | null } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs);
  try {
    const res = await deps.fetch(url, { signal: ctl.signal, headers: { "User-Agent": `${deps.contact.tool} (mailto:${deps.contact.email})`, Accept: "application/json, text/xml" } });
    return { status: res.status, text: res.ok ? await res.text() : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
const getText = async (deps: ProviderDeps, url: string) => (await getRaw(deps, url))?.text ?? null;
const parse = (t: string | null): any | null => { if (t === null) return null; try { return JSON.parse(t); } catch { return null; } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const getJson = async (deps: ProviderDeps, url: string) => parse(await getText(deps, url));

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
export const normaliseDoi = (d: unknown): string | null => {
  const s = typeof d === "string" ? d.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase() : "";
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : null;
};
const yearOf = (v: unknown): number | null => { const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(v ?? "")); return m ? Number(m[1]) : null; };

// ── PubMed E-utilities ───────────────────────────────────────────────────────────────────────────────────────────

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ncbi = (deps: ProviderDeps) => `tool=${encodeURIComponent(deps.contact.tool)}&email=${encodeURIComponent(deps.contact.email)}`;

/** Pure. PubMed efetch XML → abstract text by PMID. Structured abstracts keep their labels. */
export function parsePubmedAbstracts(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const art of xml.split(/<PubmedArticle[\s>]/).slice(1)) {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(art)?.[1];
    if (!pmid) continue;
    const parts = [...art.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map(m => {
      const label = /Label="([^"]+)"/.exec(m[1])?.[1];
      const text = clean(decodeXml(m[2]), ABSTRACT_MAX);
      return text ? (label ? `${decodeXml(label)}: ${text}` : text) : "";
    }).filter(Boolean);
    if (parts.length) out.set(pmid, parts.join(" ").slice(0, ABSTRACT_MAX));
  }
  return out;
}

/** Pure. One esummary record → an item (abstract added later). */
export function pubmedItem(r: any, retrievedAt: string): ResearchItem | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pmid = typeof r?.uid === "string" && /^\d{1,9}$/.test(r.uid) ? r.uid : null;
  const title = clean(r?.title, TITLE_MAX);
  if (!pmid || !title) return null;
  const doi = normaliseDoi((Array.isArray(r.articleids) ? r.articleids : []).find((a: any) => a?.idtype === "doi")?.value); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    provider: "pubmed", sourceId: pmid, pmid, doi, title, journal: clean(r.fulljournalname || r.source, 200) || null, year: yearOf(r.pubdate ?? r.sortpubdate),
    authors: (Array.isArray(r.authors) ? r.authors : []).slice(0, 3).map((a: any) => clean(a?.name, 80)).filter(Boolean), // eslint-disable-line @typescript-eslint/no-explicit-any
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, abstract: null, verified: { pmid: true, doi: null }, retrievedAt,
    pubTypes: (Array.isArray(r.pubtype) ? r.pubtype : []).map((t: unknown) => clean(t, 80)).filter(Boolean).slice(0, 12),
  };
}

export async function searchPubmed(deps: ProviderDeps, query: string, max: number, abstracts: boolean): Promise<ResearchItem[] | null> {
  const search = await getJson(deps, `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${max}&term=${encodeURIComponent(query)}&${ncbi(deps)}`);
  if (!search?.esearchresult) return null;
  const ids: string[] = Array.isArray(search.esearchresult.idlist) ? search.esearchresult.idlist.filter((x: unknown) => typeof x === "string" && /^\d{1,9}$/.test(x)).slice(0, max) : [];
  if (!ids.length) return [];
  const summary = await getJson(deps, `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}&${ncbi(deps)}`);
  if (!summary?.result) return null;
  const at = deps.now().toISOString();
  const items = ids.map(id => pubmedItem(summary.result[id], at)).filter((x): x is ResearchItem => !!x);
  if (abstracts && items.length) {
    const xml = await getText(deps, `${EUTILS}/efetch.fcgi?db=pubmed&rettype=abstract&retmode=xml&id=${items.map(i => i.pmid).join(",")}&${ncbi(deps)}`);
    const found = xml ? parsePubmedAbstracts(xml) : new Map<string, string>();
    for (const i of items) i.abstract = found.get(i.pmid!) ?? null;
  }
  return items;
}

// ── OpenAlex ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pure. OpenAlex's abstract_inverted_index → the abstract's words in order. */
export function openAlexAbstract(index: unknown): string | null {
  if (!index || typeof index !== "object") return null;
  const words: string[] = [];
  for (const [word, at] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(at)) continue;
    for (const n of at) if (Number.isInteger(n) && n >= 0 && n < 5000) words[n as number] = word;
  }
  const text = words.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, ABSTRACT_MAX) : null;
}

/** Pure. One OpenAlex work → an item. */
export function openAlexItem(w: any, retrievedAt: string, abstracts: boolean): ResearchItem | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = typeof w?.id === "string" ? /W\d+$/.exec(w.id)?.[0] ?? null : null;
  const title = clean(w?.title ?? w?.display_name, TITLE_MAX);
  if (!id || !title) return null;
  const doi = normaliseDoi(w.doi ?? w.ids?.doi);
  const pmid = typeof w.ids?.pmid === "string" ? /(\d{1,9})\/?$/.exec(w.ids.pmid)?.[1] ?? null : null;
  return {
    provider: "openalex", sourceId: id, pmid, doi, title, journal: clean(w.primary_location?.source?.display_name, 200) || null,
    year: Number.isInteger(w.publication_year) ? w.publication_year : yearOf(w.publication_date),
    authors: (Array.isArray(w.authorships) ? w.authorships : []).slice(0, 3).map((a: any) => clean(a?.author?.display_name, 80)).filter(Boolean), // eslint-disable-line @typescript-eslint/no-explicit-any
    url: doi ? `https://doi.org/${doi}` : `https://openalex.org/${id}`,
    abstract: abstracts ? openAlexAbstract(w.abstract_inverted_index) : null,
    // A PMID OpenAlex reports is OpenAlex's claim, not PubMed's: it is not counted as verified here.
    verified: { pmid: false, doi: null }, retrievedAt,
  };
}

export async function searchOpenAlex(deps: ProviderDeps, query: string, max: number, abstracts: boolean): Promise<ResearchItem[] | null> {
  const select = "id,doi,ids,title,display_name,publication_year,publication_date,primary_location,authorships,abstract_inverted_index,type";
  const r = await getJson(deps, `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=type:article|review&per-page=${max}&select=${select}&mailto=${encodeURIComponent(deps.contact.email)}`);
  if (!r || !Array.isArray(r.results)) return null;
  const at = deps.now().toISOString();
  return r.results.slice(0, max).map((w: unknown) => openAlexItem(w, at, abstracts)).filter((x: ResearchItem | null): x is ResearchItem => !!x);
}

// ── Crossref ─────────────────────────────────────────────────────────────────────────────────────────────────────

const words = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3));
/** Pure. Whether two titles name the same work: most of the shorter title's longer words appear in the other. */
export function sameTitle(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (!small.size) return false;
  return [...small].filter(w => big.has(w)).length / small.size >= 0.7;
}

/** Crossref's record for a DOI matches the item's title (and year, where both have one). null = could not check. */
export async function verifyDoi(deps: ProviderDeps, item: Pick<ResearchItem, "doi" | "title" | "year">): Promise<boolean | null> {
  if (!item.doi) return null;
  const raw = await getRaw(deps, `https://api.crossref.org/works/${encodeURIComponent(item.doi)}?mailto=${encodeURIComponent(deps.contact.email)}`);
  if (raw?.status === 404) return false; // Crossref does not know this DOI
  const m = parse(raw?.text ?? null)?.message;
  if (!m) return null;
  const title = Array.isArray(m.title) ? String(m.title[0] ?? "") : "";
  const year = yearOf(m.issued?.["date-parts"]?.[0]?.[0] ?? m.published?.["date-parts"]?.[0]?.[0]);
  if (!sameTitle(title, item.title)) return false;
  return item.year === null || year === null || Math.abs(item.year - year) <= 1;
}

// ── PubMed Central (open-access links) ── SCHOLAR-SQIE-02 s6 ─────────────────────────────────────────────────────────
//
// Two NCBI services, asked only about PMIDs PubMed itself returned: the ID converter (PMID -> PMCID) and the PMC Cloud
// Service's per-article metadata (is that PMCID in the open-access dataset, and under which licence). The PMC OA web
// service this once used was retired by NCBI in August 2026 (oa.fcgi answers 404). What comes back is an open-access
// flag, a licence and a link to the article's PMC page.
// ⚠ METADATA ONLY. Only the small `.json` metadata file is read from the Cloud Service. The article's XML, text, PDF and
// media sit beside it and are NEVER requested: "full text is never fetched" is the engine rule and stays.
// ⚠ UNKNOWN IS NOT "NOT OPEN ACCESS". A 404, 5xx, timeout or unreadable answer from the Cloud Service means we could
// not tell: the item gets no link and the caller is told how many were unknown. Only a clear answer (no PMCID, no copy in
// the dataset, flag false, retracted) settles an item as having no open-access copy.

const PMC_IDCONV = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";
const PMC_CLOUD = "https://pmc-oa-opendata.s3.amazonaws.com";
const PMC_PAGE = "https://pmc.ncbi.nlm.nih.gov/articles/";
/** At most this many PMIDs are asked about per request (one listing and one metadata read each). */
export const PMC_MAX = 5;

/** Pure. ID converter JSON -> the PMCID by PMID, and every PMID the converter answered about (a record with no PMCID answers "none"). */
export function parsePmcIdconvFull(json: unknown): { mapped: Map<string, string>; answered: Set<string> } {
  const mapped = new Map<string, string>(), answered = new Set<string>();
  const recs = (json as { records?: unknown[] } | null)?.records;
  for (const r of Array.isArray(recs) ? recs : []) {
    const x = r as { pmid?: unknown; pmcid?: unknown } | null;
    const pmid = String(x?.pmid ?? ""), pmcid = String(x?.pmcid ?? "");
    if (!/^\d{1,9}$/.test(pmid)) continue;
    answered.add(pmid);
    if (/^PMC\d{1,10}$/.test(pmcid)) mapped.set(pmid, pmcid);
  }
  return { mapped, answered };
}
/** Pure. ID converter JSON -> PMCID by PMID. Records the converter could not map are left out. */
export const parsePmcIdconv = (json: unknown): Map<string, string> => parsePmcIdconvFull(json).mapped;

/**
 * Pure. Cloud Service prefix listing (S3 ListObjectsV2 with delimiter "/") -> the highest version of the article.
 * 0 = the listing is valid and the article has no version in the dataset. null = not a listing we can read.
 */
export function parsePmcLatestVersion(xml: string, pmcid: string): number | null {
  if (!/<ListBucketResult\b/.test(xml) || /<Error\b/.test(xml)) return null;
  let latest = 0;
  for (const m of xml.matchAll(new RegExp(`<Prefix>${pmcid}\\.(\\d{1,6})/</Prefix>`, "g"))) latest = Math.max(latest, Number(m[1]));
  return latest;
}

/**
 * Pure. Cloud Service per-article metadata JSON -> the open-access record; false when the article is clearly not an open
 * copy (flag not true, or retracted); null when the metadata cannot be read or is about another article.
 * The licence is exactly as PMC records it: a CC code, or "TDM" for an author manuscript. This only ever yields a LINK.
 */
export function parsePmcCloudMeta(json: unknown, pmcid: string): OpenAccess | false | null {
  const m = json as { pmcid?: unknown; is_pmc_openaccess?: unknown; is_retracted?: unknown; license_code?: unknown } | null;
  if (!m || typeof m !== "object" || m.pmcid !== pmcid || typeof m.is_pmc_openaccess !== "boolean") return null;
  if (m.is_pmc_openaccess !== true || m.is_retracted === true) return false;
  const licence = typeof m.license_code === "string" ? m.license_code.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return { pmcid, licence: licence || null, url: `${PMC_PAGE}${pmcid}/`, retracted: false };
}

/** One article: the latest version from a prefix listing, then that version's metadata file. false = settled no; null = unknown. */
async function pmcCloudLookup(deps: ProviderDeps, pmcid: string): Promise<OpenAccess | false | null> {
  const list = await getRaw(deps, `${PMC_CLOUD}/?list-type=2&delimiter=%2F&prefix=${pmcid}.`);
  if (!list || list.status !== 200 || list.text === null) return null;
  const v = parsePmcLatestVersion(list.text, pmcid);
  if (v === null) return null;
  if (v === 0) return false;
  const meta = await getRaw(deps, `${PMC_CLOUD}/${pmcid}.${v}/${pmcid}.${v}.json`);
  if (!meta || meta.status !== 200) return null;
  return parsePmcCloudMeta(parse(meta.text), pmcid);
}

export type PmcResult = {
  /** PMID -> open-access link and licence, only for articles the Cloud Service says are open access. */
  found: Map<string, OpenAccess>;
  /** PMIDs with a clear answer (found, or settled as having no open-access copy). Any other PMID asked about is unknown. */
  settled: Set<string>;
  /** How many PMIDs could not be settled (service 404/5xx/timeout/unreadable). They get no link and are not "not open access". */
  unknown: number;
};

/** PMID -> open-access link and licence, for the PMIDs given (at most PMC_MAX). null = nothing could be settled at all. */
export async function pmcOpenAccess(deps: ProviderDeps, pmids: readonly string[]): Promise<PmcResult | null> {
  const ids = [...new Set(pmids.filter(p => /^\d{1,9}$/.test(p)))].slice(0, PMC_MAX);
  if (!ids.length) return { found: new Map(), settled: new Set(), unknown: 0 };
  const conv = await getJson(deps, `${PMC_IDCONV}?ids=${ids.join(",")}&format=json&${ncbi(deps)}`);
  if (!conv) return null;
  const { mapped, answered } = parsePmcIdconvFull(conv);
  const found = new Map<string, OpenAccess>(), settled = new Set<string>();
  for (const p of answered) if (!mapped.has(p) && ids.includes(p)) settled.add(p); // the converter says it is not in PMC
  const looked = await Promise.all([...mapped].filter(([p]) => ids.includes(p)).map(async ([pmid, pmcid]) => [pmid, await pmcCloudLookup(deps, pmcid)] as const));
  for (const [pmid, r] of looked) {
    if (r === null) continue;
    settled.add(pmid);
    if (r) found.set(pmid, r);
  }
  const unknown = ids.length - settled.size;
  return unknown === ids.length ? null : { found, settled, unknown };
}

/** A plain link to the same search on Google Scholar, for the learner to follow. Never fetched by Competen. */
export const scholarSearchUrl = (query: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
