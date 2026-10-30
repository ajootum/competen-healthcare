import { describe, expect, it } from "vitest";
import { checkPmcConnectivity } from "./admin";
import { parsePmcCloudMeta, parsePmcIdconv, parsePmcIdconvFull, parsePmcLatestVersion, pmcOpenAccess, type FetchLike, type ProviderDeps } from "./providers";
import { SEED_REGISTRY, applyEdit } from "./registry";

// PubMed Central open-access LINKS through the PMC Cloud Service (the OA web service was retired, oa.fcgi answers 404).
// Metadata only: no test lets a request reach an article's xml, txt, pdf or media. No network.

const LIST = (pmcid: string, versions: number[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>pmc-oa-opendata</Name><Prefix>${pmcid}.</Prefix><KeyCount>${versions.length}</KeyCount><Delimiter>/</Delimiter><IsTruncated>false</IsTruncated>${versions.map(v => `<CommonPrefixes><Prefix>${pmcid}.${v}/</Prefix></CommonPrefixes>`).join("")}</ListBucketResult>`;
const META = (over: Record<string, unknown> = {}) => ({ pmcid: "PMC1790863", version: 1, pmid: 17299597, doi: "10.1371/journal.pone.0000217", is_pmc_openaccess: true, is_manuscript: false, is_historical_ocr: false, is_retracted: false, license_code: "CC BY", ...over });

type Reply = { status: number; body: string } | "throw";
function deps(route: (url: string) => Reply, log: string[] = []): ProviderDeps {
  const fetch: FetchLike = async url => {
    log.push(url);
    const r = route(url);
    if (r === "throw") throw new Error("network");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return { fetch, timeoutMs: 1000, contact: { tool: "competen-scholar", email: "hello@example.com" }, now: () => new Date("2026-10-30T10:00:00Z") };
}
const json = (o: unknown): Reply => ({ status: 200, body: JSON.stringify(o) });
const IDCONV = (recs: unknown[]) => json({ status: "ok", records: recs });
const isList = (u: string) => u.startsWith("https://pmc-oa-opendata.s3.amazonaws.com/?");

describe("PMC parsers", () => {
  it("ID converter: maps PMIDs to PMCIDs, and 'not in PMC' still counts as an answer", () => {
    const j = { records: [{ pmid: 111, pmcid: "PMC777" }, { pmid: 2, status: "error", errmsg: "Identifier not found in PMC" }] };
    expect([...parsePmcIdconv(j)]).toEqual([["111", "PMC777"]]);
    expect([...parsePmcIdconvFull(j).answered].sort()).toEqual(["111", "2"]);
  });
  it("prefix listing: the highest version wins, no version is 0, anything else is unreadable", () => {
    expect(parsePmcLatestVersion(LIST("PMC9", [1, 3, 2]), "PMC9")).toBe(3);
    expect(parsePmcLatestVersion(LIST("PMC9", [4]), "PMC9")).toBe(4);
    expect(parsePmcLatestVersion(LIST("PMC9", []), "PMC9")).toBe(0);
    expect(parsePmcLatestVersion(LIST("PMC99", [7]), "PMC9")).toBe(0); // another article's prefix is not this article's version
    expect(parsePmcLatestVersion(`<Error><Code>NoSuchBucket</Code></Error>`, "PMC9")).toBeNull();
    expect(parsePmcLatestVersion("not xml", "PMC9")).toBeNull();
  });
  it("metadata: open access with its licence, and the PMC page as the link", () => {
    expect(parsePmcCloudMeta(META(), "PMC1790863")).toEqual({ pmcid: "PMC1790863", licence: "CC BY", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1790863/", retracted: false });
  });
  it("metadata: an author manuscript (TDM) and a non-commercial licence show as reading links, licence as returned", () => {
    expect(parsePmcCloudMeta(META({ is_manuscript: true, license_code: "TDM" }), "PMC1790863")).toMatchObject({ licence: "TDM" });
    expect(parsePmcCloudMeta(META({ license_code: "CC BY-NC-ND" }), "PMC1790863")).toMatchObject({ licence: "CC BY-NC-ND" });
    expect(parsePmcCloudMeta(META({ license_code: null }), "PMC1790863")).toMatchObject({ licence: null });
  });
  it("metadata: retracted or not open access is settled as no link; unreadable or someone else's is unknown", () => {
    expect(parsePmcCloudMeta(META({ is_retracted: true }), "PMC1790863")).toBe(false);
    expect(parsePmcCloudMeta(META({ is_pmc_openaccess: false }), "PMC1790863")).toBe(false);
    expect(parsePmcCloudMeta(META({ pmcid: "PMC1" }), "PMC1790863")).toBeNull();
    expect(parsePmcCloudMeta({ pmcid: "PMC1790863" }, "PMC1790863")).toBeNull();
    expect(parsePmcCloudMeta(null, "PMC1790863")).toBeNull();
  });
});

describe("pmcOpenAccess: the endpoints, metadata only, unknown is not 'not open access'", () => {
  const open = (u: string): Reply => {
    if (u.startsWith("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/")) return IDCONV([{ pmid: 17299597, pmcid: "PMC1790863" }]);
    if (isList(u)) return { status: 200, body: LIST("PMC1790863", [1, 2]) };
    if (u === "https://pmc-oa-opendata.s3.amazonaws.com/PMC1790863.2/PMC1790863.2.json") return json(META({ version: 2 }));
    return { status: 404, body: "" };
  };
  it("converts with the new address and tool/email, lists the prefix, reads only the latest version's .json", async () => {
    const log: string[] = [];
    const r = await pmcOpenAccess(deps(open, log), ["17299597"]);
    expect(r?.found.get("17299597")).toMatchObject({ pmcid: "PMC1790863", licence: "CC BY", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1790863/" });
    expect(log[0]).toBe("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=17299597&format=json&tool=competen-scholar&email=hello%40example.com");
    expect(log).toContain("https://pmc-oa-opendata.s3.amazonaws.com/?list-type=2&delimiter=%2F&prefix=PMC1790863.");
    expect(log).toContain("https://pmc-oa-opendata.s3.amazonaws.com/PMC1790863.2/PMC1790863.2.json");
    // full text is never fetched: nothing but the idconv call, the listing and the .json
    expect(log.filter(u => /\.(xml|txt|pdf|jpg|png)\b/.test(u))).toEqual([]);
    expect(log.some(u => /oa\.fcgi/.test(u))).toBe(false);
  });
  it("a PMID with no PMCID, or a PMCID with nothing in the Cloud Service, is settled: no open-access copy", async () => {
    const r = await pmcOpenAccess(deps(u => (u.includes("idconv") ? IDCONV([{ pmid: 1, status: "error" }, { pmid: 2, pmcid: "PMC5" }]) : { status: 200, body: LIST("PMC5", []) })), ["1", "2"]);
    expect(r).toEqual({ found: new Map(), settled: new Set(["1", "2"]), unknown: 0 });
  });
  it("a retracted article gets no link, settled", async () => {
    const r = await pmcOpenAccess(deps(u => (open(u) !== undefined && u.endsWith(".2.json") ? json(META({ is_retracted: true })) : open(u))), ["17299597"]);
    expect(r?.found.size).toBe(0);
    expect(r?.settled.has("17299597")).toBe(true);
  });
  it("a 404, 5xx, timeout or unreadable Cloud Service answer is UNKNOWN: no link, not settled as closed", async () => {
    for (const bad of [{ status: 404, body: "" }, { status: 503, body: "" }, "throw", { status: 200, body: "garbage" }] as Reply[]) {
      const partial = await pmcOpenAccess(deps(u => (u.includes("idconv") ? IDCONV([{ pmid: 17299597, pmcid: "PMC1790863" }, { pmid: 1, status: "error" }]) : bad)), ["17299597", "1"]);
      expect(partial?.found.size).toBe(0);
      expect(partial?.settled.has("17299597")).toBe(false);
      expect(partial?.settled.has("1")).toBe(true);
      expect(partial?.unknown).toBe(1);
      const none = await pmcOpenAccess(deps(u => (u.includes("idconv") ? IDCONV([{ pmid: 17299597, pmcid: "PMC1790863" }]) : bad)), ["17299597"]);
      expect(none).toBeNull(); // nothing settled at all: the lookup failed
    }
  });
  it("a metadata file that 404s after a good listing is unknown, and so is a failed ID converter", async () => {
    expect(await pmcOpenAccess(deps(u => (u.includes("idconv") ? IDCONV([{ pmid: 17299597, pmcid: "PMC1790863" }]) : isList(u) ? { status: 200, body: LIST("PMC1790863", [1]) } : { status: 404, body: "" })), ["17299597"])).toBeNull();
    expect(await pmcOpenAccess(deps(() => ({ status: 500, body: "" })), ["17299597"])).toBeNull();
  });
});

describe("PMC connectivity passes only when a known open-access article returns a licence", () => {
  const route = (meta: Reply) => (u: string): Reply => {
    if (u.includes("idconv")) return IDCONV([{ pmid: 17299597, pmcid: "PMC1790863" }]);
    if (isList(u)) return { status: 200, body: LIST("PMC1790863", [1]) };
    return meta;
  };
  it("PASSES with the licence in the detail", async () => {
    const c = await checkPmcConnectivity(deps(route(json(META()))));
    expect(c.ok).toBe(true);
    expect(c.detail).toMatch(/CC BY/);
  });
  it("FAILS on a 404 (the retired service), a timeout, a missing licence, and a 'not open access' answer", async () => {
    expect((await checkPmcConnectivity(deps(route({ status: 404, body: "" })))).ok).toBe(false);
    expect((await checkPmcConnectivity(deps(route("throw")))).ok).toBe(false);
    expect((await checkPmcConnectivity(deps(route(json(META({ license_code: null })))))).ok).toBe(false);
    expect((await checkPmcConnectivity(deps(route(json(META({ license_code: "  " })))))).ok).toBe(false);
    const closed = await checkPmcConnectivity(deps(route(json(META({ is_pmc_openaccess: false })))));
    expect(closed.ok).toBe(false);
    expect(closed.detail).toMatch(/no open-access copy/);
    expect((await checkPmcConnectivity(deps(() => ({ status: 404, body: "" })))).ok).toBe(false);
  });
});

describe("the pmc registry record", () => {
  it("names the Cloud Service, not the retired OA web service, and a provenance/docs update does not demote an Active record", () => {
    const pmc = SEED_REGISTRY.pmc;
    expect(pmc.provenance).toMatch(/Cloud Service/);
    expect(pmc.docsUrl).toBe("https://pmc.ncbi.nlm.nih.gov/tools/cloud/");
    expect(pmc.licensing).toMatch(/full text is never fetched/i);
    const live = { ...pmc, status: "active" as const };
    expect(applyEdit(live, { provenance: pmc.provenance })).toMatchObject({ demoted: false, record: { status: "active" } });
  });
});
