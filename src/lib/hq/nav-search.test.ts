import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/super-admin" }));
import { HQ_SEARCH_TABLES, HQ_WORKSPACES, type HqSection } from "@/app/super-admin/_components/nav-tables";
import { sidebarMatches } from "@/app/super-admin/_components/WorkspaceSidebar";
import { filterHqNav } from "./nav-filter";
import { capabilityForRoute } from "./spaces";
import { hqSearchCatalogue, matchHqDestinations } from "./search-catalogue";
import { matchNavSubject, navSearchTerms, routeWords } from "./nav-search";

// SCHOLAR-SQIE-CLOSE-01 P2: the owner could not find /super-admin/individual/configuration ("Individual Policy").
// One matcher (nav-search.ts) serves the sidebar filter and Search HQ; these run against the REAL registry.

const OWNER = { isOwner: true, capabilities: [] as string[] };
const POLICY = "/super-admin/individual/configuration";
const FAIR = "/super-admin/ai/fair-use";
const SOURCES = "/super-admin/ai/research-sources";

const launcher = (q: string, viewer = OWNER) => matchHqDestinations(hqSearchCatalogue(HQ_SEARCH_TABLES, viewer), q, 50).map(d => d.href);
const sidebar = (q: string, viewer = OWNER) =>
  sidebarMatches(HQ_WORKSPACES.map(w => ({ label: w.label, sections: filterHqNav(w.sections, viewer) as HqSection[] })), q, 100).map(m => m.e.href);

describe("route words and terms", () => {
  it("splits a route into words and drops the shared /super-admin prefix", () => {
    expect(routeWords(POLICY)).toBe("individual configuration");
    expect(routeWords("/super-admin/ai/research-sources?x=1")).toBe("ai research sources");
    expect(navSearchTerms("individual/configuration")).toEqual(["individual", "configuration"]);
    expect(navSearchTerms("  Fair-use ")).toEqual(["fair", "use"]);
  });
  it("ranks label before location before keyword before route", () => {
    const s = { label: "Individual Policy", href: POLICY, trail: ["Products", "Competen Individual"], keywords: ["external scholarly sources"] };
    expect(matchNavSubject(s, ["policy"])?.rank).toBe(0);
    expect(matchNavSubject(s, ["products"])?.rank).toBe(1);
    expect(matchNavSubject(s, ["scholarly"])).toEqual({ rank: 2, via: ["external scholarly sources"] });
    expect(matchNavSubject(s, ["configuration"])?.rank).toBe(3);
    expect(matchNavSubject(s, ["zzz"])).toBeNull();
  });
});

describe.each([["Search HQ", launcher], ["the sidebar filter", sidebar]] as const)("%s finds pages by configuration terms", (_n, find) => {
  it.each([
    ["configuration", POLICY],
    ["settings", POLICY],
    ["individual/configuration", POLICY],
    ["external scholarly sources", POLICY],
    ["finding more learning resources", POLICY],
    ["external scholarly sourcez", null],
    ["learning resources", POLICY],
    ["pubmed", SOURCES],
    ["google scholar", SOURCES],
    ["eligibility", FAIR],
    ["model routing", FAIR],
  ])("%s", (q, href) => {
    const hits = find(q);
    if (href) expect(hits).toContain(href);
    else expect(hits).toEqual([]);
  });
  it("keeps label matching: a label hit still comes first", () => {
    expect(find("individual policy")[0]).toBe(POLICY);
    expect(find("fair use")[0]).toBe(FAIR);
  });
  it("does not return a page the viewer cannot open, nor reveal its keywords", () => {
    const cap = capabilityForRoute(SOURCES);
    expect(cap).toBeTruthy();
    const other = Object.values(HQ_SEARCH_TABLES).flatMap(t => t.sections.flatMap(s => s.items)).map(i => capabilityForRoute(i.href)).find(c => c && c !== cap && c !== capabilityForRoute(POLICY) && c !== capabilityForRoute(FAIR));
    const viewer = { isOwner: false, capabilities: other ? [other] : [] };
    expect(find("pubmed", viewer)).not.toContain(SOURCES);
    expect(find("configuration", viewer)).not.toContain(POLICY);
    expect(find("eligibility", viewer)).not.toContain(FAIR);
  });
  it("returns a permitted page to a viewer holding its capability", () => {
    const viewer = { isOwner: false, capabilities: [capabilityForRoute(SOURCES)!] };
    expect(find("pubmed", viewer)).toContain(SOURCES);
  });
});

describe("the matched keyword is reported", () => {
  it("Search HQ and the sidebar carry the keyword that matched, not for label hits", () => {
    const d = matchHqDestinations(hqSearchCatalogue(HQ_SEARCH_TABLES, OWNER), "external scholarly sources").find(x => x.href === POLICY);
    expect(d?.via).toEqual(["external scholarly sources"]);
    const label = matchHqDestinations(hqSearchCatalogue(HQ_SEARCH_TABLES, OWNER), "individual policy").find(x => x.href === POLICY);
    expect(label?.via).toBeUndefined();
    const m = sidebarMatches(HQ_WORKSPACES.map(w => ({ label: w.label, sections: w.sections })), "settings").find(x => x.e.href === POLICY);
    expect(m?.via).toEqual(["settings"]);
  });
});
