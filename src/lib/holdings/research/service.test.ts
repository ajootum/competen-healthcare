import { describe, expect, it } from "vitest";
import { openAlexAbstract, parsePubmedAbstracts, sameTitle, scholarSearchUrl, type FetchLike } from "./providers";
import { cachedResult, datePlausible, isEvidence, mergeItems, researchKey, researchQuery, runResearch, type ResearchConfig } from "./service";

// COMPETEN-RESEARCH-01: the shared Holdings research service, against canned provider responses. No network.

const CFG: ResearchConfig = { providers: ["pubmed", "openalex"], maxResults: 5, abstracts: true, verifyDoi: true, maxAgeYears: 15 };
const NOW = () => new Date("2026-10-28T10:00:00Z");

const ESEARCH = { esearchresult: { idlist: ["111", "222"] } };
const ESUMMARY = { result: {
  uids: ["111", "222"],
  "111": { uid: "111", title: "Oxygen saturation targets in acute illness: a systematic review.", fulljournalname: "Respiratory Care", pubdate: "2022 Mar", authors: [{ name: "Smith A" }], articleids: [{ idtype: "doi", value: "10.1000/oxy.2022" }] },
  "222": { uid: "222", title: "Pulse oximetry accuracy in darker skin.", fulljournalname: "Thorax", pubdate: "2005", authors: [], articleids: [] },
} };
const EFETCH = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">111</PMID><Abstract><AbstractText Label="BACKGROUND">Conservative oxygen targets were compared with liberal targets.</AbstractText><AbstractText Label="RESULTS">Liberal oxygen was associated with higher mortality &amp; harm.</AbstractText></Abstract></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
const OPENALEX = { results: [
  { id: "https://openalex.org/W1", doi: "https://doi.org/10.1000/OXY.2022", title: "Oxygen saturation targets in acute illness: a systematic review", publication_year: 2022, ids: { pmid: "https://pubmed.ncbi.nlm.nih.gov/111" }, abstract_inverted_index: { Conservative: [0], targets: [1] } },
  { id: "https://openalex.org/W2", doi: "https://doi.org/10.2000/fake", title: "A different paper about oxygen", publication_year: 2021, abstract_inverted_index: { Oxygen: [0], helps: [1] } },
  { id: "https://openalex.org/W3", doi: null, title: "Nurse-led oxygen titration audit", publication_year: 2020, abstract_inverted_index: { Audit: [0], findings: [1] } },
] };

type Route = (url: string) => { status: number; body: string } | "throw";
function fakeFetch(route: Route, log: string[] = []): FetchLike {
  return async url => {
    log.push(url);
    const r = route(url);
    if (r === "throw") throw new Error("network");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
}
const ok = (b: unknown) => ({ status: 200, body: typeof b === "string" ? b : JSON.stringify(b) });
const standard: Route = url => {
  if (url.includes("esearch")) return ok(ESEARCH);
  if (url.includes("esummary")) return ok(ESUMMARY);
  if (url.includes("efetch")) return ok(EFETCH);
  if (url.includes("openalex")) return ok(OPENALEX);
  if (url.includes("crossref") && url.includes(encodeURIComponent("10.1000/oxy.2022"))) return ok({ message: { title: ["Oxygen saturation targets in acute illness: a systematic review"], issued: { "date-parts": [[2022]] } } });
  if (url.includes("crossref") && url.includes(encodeURIComponent("10.2000/fake"))) return ok({ message: { title: ["Bananas in the tropics"], issued: { "date-parts": [[2021]] } } });
  return { status: 404, body: "" };
};

describe("researchQuery: only topic keywords leave, never an identifier", () => {
  it("keeps topic words and drops filler", () => {
    expect(researchQuery({ topics: ["Oxygen therapy", "target saturation"] })).toEqual({ ok: true, query: "oxygen therapy target saturation" });
    expect(researchQuery({ question: "Can you explain why oxygen is given to a target range?" })).toEqual({ ok: true, query: "oxygen given target range" });
  });
  it("refuses text that looks like it identifies a patient", () => {
    expect(researchQuery({ question: "Mrs Jones NHS number 943 476 5919 has low oxygen" })).toMatchObject({ ok: false, reason: "identifier" });
  });
  it("refuses an empty topic", () => {
    expect(researchQuery({ topics: [], title: "" })).toEqual({ ok: false, reason: "empty" });
  });
  it("the cache key holds the configuration and the query, nothing else", () => {
    expect(researchKey("oxygen", CFG)).toMatch(/^[0-9a-f]{64}$/);
    expect(researchKey("oxygen", CFG)).not.toBe(researchKey("oxygen", { ...CFG, maxResults: 3 }));
  });
});

describe("parsers copy provider text, invent nothing", () => {
  it("PubMed structured abstracts keep their labels and decode entities", () => {
    expect(parsePubmedAbstracts(EFETCH).get("111")).toBe("BACKGROUND: Conservative oxygen targets were compared with liberal targets. RESULTS: Liberal oxygen was associated with higher mortality & harm.");
  });
  it("OpenAlex inverted index rebuilds in order", () => {
    expect(openAlexAbstract({ world: [1], hello: [0] })).toBe("hello world");
    expect(openAlexAbstract(null)).toBeNull();
  });
  it("titles match only when they name the same work", () => {
    expect(sameTitle("Oxygen saturation targets in acute illness", "Oxygen saturation targets in acute illness: a systematic review.")).toBe(true);
    expect(sameTitle("Oxygen saturation targets", "Bananas in the tropics")).toBe(false);
  });
  it("the Google Scholar link is a link only", () => {
    expect(scholarSearchUrl("oxygen therapy")).toBe("https://scholar.google.com/scholar?q=oxygen%20therapy");
  });
});

describe("runResearch: search, merge, date, verify, fail soft", () => {
  it("merges the same work across providers, drops a DOI Crossref contradicts and an out-of-range date", async () => {
    const log: string[] = [];
    const r = await runResearch("oxygen targets", CFG, { fetch: fakeFetch(standard, log), now: NOW });
    expect(r.state).toBe("searched");
    const titles = r.items.map(i => i.title);
    expect(titles[0]).toMatch(/^Oxygen saturation targets/);
    expect(titles).not.toContain("A different paper about oxygen"); // DOI names another work
    expect(titles).not.toContain("Pulse oximetry accuracy in darker skin."); // 2005, older than 15 years
    expect(titles).toContain("Nurse-led oxygen titration audit");
    expect(r.items[0]).toMatchObject({ provider: "pubmed", pmid: "111", doi: "10.1000/oxy.2022", verified: { pmid: true, doi: true }, url: "https://pubmed.ncbi.nlm.nih.gov/111/" });
    expect(r.codes).toEqual(expect.arrayContaining(["dropped_date", "dropped_identity"]));
    // Evidence: abstract AND verified identity. The OpenAlex-only item with no DOI is further reading.
    expect(r.evidence).toEqual([0]);
    // Polite identification on every provider call, and only the query is sent.
    expect(log.filter(u => u.includes("eutils")).every(u => u.includes("tool=competen-scholar") && u.includes("email="))).toBe(true);
    expect(log.filter(u => u.includes("openalex") || u.includes("crossref")).every(u => u.includes("mailto="))).toBe(true);
  });

  it("a failing provider is a code, the other still answers", async () => {
    const r = await runResearch("oxygen targets", CFG, { fetch: fakeFetch(u => (u.includes("eutils") ? "throw" : standard(u)), []), now: NOW });
    expect(r.state).toBe("searched");
    expect(r.codes).toContain("pubmed_failed");
    expect(r.calls.find(c => c.provider === "pubmed")).toMatchObject({ failed: 1 });
  });

  it("every provider failing is 'failed', not an error", async () => {
    const r = await runResearch("oxygen targets", CFG, { fetch: fakeFetch(() => "throw"), now: NOW });
    expect(r).toMatchObject({ state: "failed", items: [], evidence: [] });
  });

  it("a timeout aborts the call and fails soft", async () => {
    const hang: FetchLike = (_u, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const r = await runResearch("oxygen", { ...CFG, providers: ["openalex"] }, { fetch: hang, timeoutMs: 20, now: NOW });
    expect(r.state).toBe("failed");
  });

  it("with abstracts off, nothing is evidence (metadata is never full text)", async () => {
    const r = await runResearch("oxygen targets", { ...CFG, abstracts: false }, { fetch: fakeFetch(standard), now: NOW });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every(i => i.abstract === null)).toBe(true);
    expect(r.evidence).toEqual([]);
  });

  it("no provider configured: nothing is called", async () => {
    const log: string[] = [];
    const r = await runResearch("oxygen", { ...CFG, providers: [] }, { fetch: fakeFetch(standard, log) });
    expect(r.state).toBe("failed");
    expect(log).toEqual([]);
  });

  it("a cache hit calls no provider; a miss writes the verified items", async () => {
    const log: string[] = [];
    const writes: unknown[] = [];
    const cache = { read: async () => null, write: async (_k: string, items: unknown[]) => { writes.push(items); } };
    const first = await runResearch("oxygen targets", CFG, { fetch: fakeFetch(standard, log), now: NOW, cache });
    expect(writes).toHaveLength(1);
    const again = await runResearch("oxygen targets", CFG, { fetch: fakeFetch(standard, log), now: NOW, cache: { read: async () => first.items, write: async () => {} } });
    expect(again).toMatchObject({ state: "cached", evidence: first.evidence, calls: [] });
    const before = log.length;
    await runResearch("oxygen targets", CFG, { fetch: fakeFetch(standard, log), cache: { read: async () => first.items, write: async () => {} } });
    expect(log.length).toBe(before);
  });
});

describe("pure rules", () => {
  it("dates: never the future; within the governed age, unknown fails then", () => {
    expect(datePlausible(2027, 0, NOW())).toBe(false);
    expect(datePlausible(null, 0, NOW())).toBe(true);
    expect(datePlausible(null, 10, NOW())).toBe(false);
    expect(datePlausible(2016, 10, NOW())).toBe(true);
    expect(datePlausible(2015, 10, NOW())).toBe(false);
  });
  it("evidence needs an abstract and a verified identity", () => {
    const base = { provider: "openalex" as const, sourceId: "W1", pmid: null, doi: "10.1/x", title: "T", journal: null, year: 2020, authors: [], url: "https://doi.org/10.1/x", retrievedAt: "" };
    expect(isEvidence({ ...base, abstract: "A", verified: { pmid: false, doi: true } })).toBe(true);
    expect(isEvidence({ ...base, abstract: "A", verified: { pmid: false, doi: null } })).toBe(false);
    expect(isEvidence({ ...base, abstract: null, verified: { pmid: true, doi: true } })).toBe(false);
  });
  it("a later copy only lends a missing abstract", () => {
    const a = { provider: "pubmed" as const, sourceId: "1", pmid: "1", doi: "10.1/x", title: "Same", journal: null, year: 2020, authors: [], url: "https://pubmed.ncbi.nlm.nih.gov/1/", abstract: null, verified: { pmid: true, doi: null }, retrievedAt: "" };
    const b = { ...a, provider: "openalex" as const, sourceId: "W9", url: "https://doi.org/10.1/x", abstract: "From OpenAlex", verified: { pmid: false, doi: null } };
    const [m] = mergeItems([[a], [b]]);
    expect(m).toMatchObject({ provider: "pubmed", url: a.url, abstract: "From OpenAlex", abstractFrom: "openalex", verified: { pmid: true } });
  });
  it("a cache row that is not a well-formed item is ignored", () => {
    expect(cachedResult("q", [{ title: "x" }, null]).items).toEqual([]);
  });
});
