import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { externalReferences, gated, learnResearch, researchEvidence, type LearnResearch } from "./learn-research";
import { DEFAULT_QUALITY, evidenceGate, queryKeywords, qualityOf } from "./source-quality";
import { externalEvidence } from "./evidence-recovery";
import { DEFAULT_POLICY, type ScholarResearchPolicy } from "../policy";
import { RECOVERY_NOT_USED_LABEL } from "./config";
import { SEED_REGISTRY } from "@/lib/holdings/research/registry";
import type { ResearchItem } from "@/lib/holdings/research/providers";
import type { IndividualContext } from "../guard";

// SCHOLAR-SOURCE-QUALITY-01, Learn's own Research & Explain: the SAME gate as evidence recovery (source-quality.ts).
// External abstracts reach Learn's generation only if they pass the three HQ settings; the rest are reading only, with
// the same reason codes and the same student labels.

const Q = "antibiotic choice in pyelonephritis";
const item = (over: Partial<ResearchItem>): ResearchItem => ({
  provider: "pubmed", sourceId: "1", pmid: "1", doi: null, title: "x", journal: "J", year: 2023, authors: ["A"],
  url: "https://pubmed.ncbi.nlm.nih.gov/1/", abstract: "An abstract.", verified: { pmid: true, doi: null }, retrievedAt: "2026-10-30T00:00:00Z", ...over,
});
const asb = item({ sourceId: "2", pmid: "2", url: "https://pubmed.ncbi.nlm.nih.gov/2/", title: "Clinical Practice Guideline for the Management of Asymptomatic Bacteriuria: 2019 Update", pubTypes: ["Practice Guideline"] });
const review = item({ sourceId: "3", pmid: "3", url: "https://pubmed.ncbi.nlm.nih.gov/3/", title: "Acute pyelonephritis in adults: a systematic review", abstract: "Beta-lactams and fluoroquinolones for pyelonephritis.", pubTypes: ["Journal Article", "Systematic Review"] });
const ayurveda = item({ provider: "openalex", sourceId: "W9", pmid: null, doi: "10.5555/ayur.1", url: "https://doi.org/10.5555/ayur.1", title: "Acute Pyelonephritis management through Ayurveda - A Case Study", verified: { pmid: false, doi: true } });
const caseReport = item({ sourceId: "4", pmid: "4", url: "https://pubmed.ncbi.nlm.nih.gov/4/", title: "Emphysematous pyelonephritis: a case report", pubTypes: ["Case Reports"] });
const CACHED = [asb, review, ayurveda, caseReport];

/** A database that holds an Active engine (PubMed, Basic workflow) and one cached result for any query. */
function fakeAdmin(sources: unknown[]) {
  const ok = { at: "2026-10-28T00:00:00Z", by: "owner", ok: true, detail: "test" };
  const tables: Record<string, unknown> = {
    workspace_config_overrides: [
      { config_path: "research.registry", published: { pubmed: { ...SEED_REGISTRY.pubmed, status: "active", checks: { connectivity: ok, approval: ok, activation: ok } } } },
      { config_path: "research.workflows", published: { basic: { status: "active" } } },
    ],
    individual_scholar_research_cache: { sources, created_at: "2026-10-30T00:00:00Z", expires_at: "2999-01-01T00:00:00Z" },
  };
  return {
    from: (t: string) => {
      const data = tables[t];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "lte", "limit", "order"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: Array.isArray(data) ? data[0] ?? null : data ?? null, error: null });
      q.insert = async () => ({ error: null });
      q.upsert = async () => ({ error: null });
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: data ?? [], error: null }).then(res, rej);
      return q;
    },
  };
}
const ctx = (sources: unknown[]) => ({ admin: fakeAdmin(sources), userId: "u1" }) as unknown as IndividualContext;
const P: ScholarResearchPolicy = { modes: ["notes", "research"], dailyMax: 5, dailyCostCents: 25 };

describe("Learn Research & Explain: learnResearch leaves gated (cache path, through a fake database)", () => {
  it("only the PubMed systematic review on pyelonephritis reaches generation; the rest are reading with their reason", async () => {
    const r = await learnResearch(ctx(CACHED), P, { question: Q, topics: [] }, null, null, qualityOf(DEFAULT_POLICY.scholarRecovery));
    expect(r.state).toBe("cached");
    // What the Learn route gives its model (route.ts: researchEvidence(research)).
    expect(researchEvidence(r).map(e => e.title)).toEqual([review.title]);
    // What the Learn route shows and saves (route.ts: externalReferences(research)).
    expect(externalReferences(r).map(x => [x.title.slice(0, 14), x.tag, x.evidence, x.notUsed, x.excerpt === null])).toEqual([
      ["Acute pyelonep", "E1", true, null, false],
      ["Clinical Pract", null, false, "off_topic", true],
      ["Acute Pyelonep", null, false, "not_indexed", true],
      ["Emphysematous ", null, false, "type_excluded", true],
    ]);
  });
  it("without the settings argument the defaults still gate (no caller can get the engine's raw list)", async () => {
    const r = await learnResearch(ctx(CACHED), P, { question: Q, topics: [] });
    expect(researchEvidence(r).map(e => e.title)).toEqual([review.title]);
  });
  it("HQ settings relax exactly as named: on topic off lets the guideline ground; any_verified alone does not let the untyped OpenAlex item", async () => {
    const off = await learnResearch(ctx(CACHED), P, { question: Q, topics: [] }, null, null, { ...DEFAULT_QUALITY, evidenceOnTopic: "off" });
    expect(researchEvidence(off).map(e => e.title)).toEqual([asb.title, review.title]);
    const any = await learnResearch(ctx(CACHED), P, { question: Q, topics: [] }, null, null, { ...DEFAULT_QUALITY, evidenceIndexed: "any_verified" });
    expect(externalReferences(any).find(x => x.url === ayurveda.url)?.notUsed).toBe("type_unknown");
  });
  it("when nothing passes: no abstract reaches generation, and every item is still listed as reading", async () => {
    const r = await learnResearch(ctx([asb, ayurveda, caseReport]), P, { question: Q, topics: [] });
    expect(researchEvidence(r)).toEqual([]);
    expect(externalReferences(r).map(x => x.evidence)).toEqual([false, false, false]);
  });
});

describe("one gate, two paths: Learn and evidence recovery judge an item identically", () => {
  const raw: LearnResearch = { state: "searched", message: null, query: "antibiotic choice pyelonephritis", scholarLink: null, items: CACHED, evidence: [0, 1, 2, 3], calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: false, licensing: {} };
  it("same reasons, same evidence, same labels", () => {
    const learn = externalReferences(gated(raw));
    const recovery = externalEvidence(raw, ["antibiotic", "choice", "pyelonephritis"], DEFAULT_QUALITY, ["antibiotic", "choice", "pyelonephritis"]);
    expect(learn.map(x => [x.url, x.evidence, x.tag, x.notUsed])).toEqual(recovery.map(x => [x.url, x.evidence, x.tag, x.notUsed]));
    for (const i of CACHED) expect(learn.find(x => x.url === i.url)?.notUsed ?? null).toBe(evidenceGate(i, queryKeywords(raw.query), DEFAULT_QUALITY));
    for (const x of learn) if (x.notUsed) expect(RECOVERY_NOT_USED_LABEL[x.notUsed]).toBeTruthy();
  });
  it("a Learn question's labels and command words never make a title on topic", () => {
    expect(queryKeywords("question explain antibiotic choice pyelonephritis")).toEqual(["antibiotic", "choice", "pyelonephritis"]);
  });
});

// The wiring: a change that lets Learn bypass the gate must go red. Each plant below is such a change.
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const LR = read("src/lib/individual/scholar/learn-research.ts");
const ROUTE = read("src/app/api/individual/scholar/learn/act/route.ts");
const CLIENT = read("src/app/individual/(app)/[experience]/(scholar)/study/_components/learn-client.tsx");
/** True when every result learnResearch returns is gated, the route passes HQ's settings and generates from that result. */
function learnGated(lr: string, route: string): boolean {
  const returns = [...lr.matchAll(/^\s*return (.*fromResult\(.*)$/gm)].map(m => m[1]);
  return returns.length === 2 && returns.every(r => r.startsWith("gated(") && r.endsWith(", quality);"))
    && /export const gated = \([^)]*\)[^=]*=> gateResearch\(r, queryKeywords\(r\.query\), quality\);/.test(lr)
    && /research = await learnResearch\([^;]*, qualityOf\(policy\.scholarRecovery\)\);/.test(route)
    && /const evidence = \[\.\.\.\(research \? researchEvidence\(research\) : \[\]\)/.test(route)
    && (route.match(/\bresearch = /g) ?? []).length === 1; // the gated assignment, and nothing that replaces it
}

describe("wiring: Learn cannot bypass the gate", () => {
  it("as built: gated", () => {
    expect(learnGated(LR, ROUTE)).toBe(true);
    expect(CLIENT).toMatch(/RECOVERY_NOT_USED_LABEL\[r\.notUsed\]/); // the same student labels as recovery
  });
  it("PLANT: a fresh search returned ungated goes red", () => {
    expect(learnGated(LR.replace("return gated({ ...fromResult(r), ...rules }, quality);", "return { ...fromResult(r), ...rules };"), ROUTE)).toBe(false);
  });
  it("PLANT: a cached result returned ungated goes red", () => {
    expect(learnGated(LR.replace(/return gated\(\{ \.\.\.fromResult\(cachedResult\((.*)\), \.\.\.rules \}, quality\);/, "return { ...fromResult(cachedResult($1), ...rules };"), ROUTE)).toBe(false);
  });
  it("PLANT: gated() made a no-op goes red", () => {
    expect(learnGated(LR.replace("=> gateResearch(r, queryKeywords(r.query), quality);", "=> r;"), ROUTE)).toBe(false);
  });
  it("PLANT: the route not passing HQ's settings, or re-assigning the research it generates from, goes red", () => {
    expect(learnGated(LR, ROUTE.replace(", qualityOf(policy.scholarRecovery));", ");"))).toBe(false);
    expect(learnGated(LR, ROUTE.replace("const evidence = [", "research = raw;\n  const evidence = ["))).toBe(false);
  });
});
