import { describe, expect, it } from "vitest";
import {
  EMPTY_FACTS, UNASSIGNED_AREA_NAME, applyQuery, buildExplorerModel, deriveIndicators, indicatorLine, needsAttention, parseExplorerState, sortRows,
  type ExplorerCompetency, type ExplorerFacts, type ExplorerStructure,
} from "./competency-explorer";

// SCHOLAR-COMPETENCY-EXPLORER-HFE-01: seven independent indicators, the Holdings structure kept, search and filters that leave it intact.

const F = (over: Partial<ExplorerFacts> = {}): ExplorerFacts => ({ ...EMPTY_FACTS, ...over });

describe("deriveIndicators: seven independent indicators", () => {
  it("nothing recorded is Not started and nothing else", () => {
    const i = deriveIndicators(F());
    expect(i).toEqual({ material_linked: false, learning_started: false, practised: false, self_assessed: false, evidence_available: false, verified: false, not_started: true });
    expect(indicatorLine(i)).toBe("Not started");
  });
  it("an accepted mapping is Material linked, NOT Practised", () => {
    const i = deriveIndicators(F({ sectionsAccepted: 2 }));
    expect(i.material_linked).toBe(true);
    expect(i.practised).toBe(false);
    expect(i.learning_started).toBe(false);
    expect(i.evidence_available).toBe(false);
    expect(i.not_started).toBe(false);
    expect(indicatorLine(i)).toBe("Material linked");
  });
  it("a suggested (not accepted) link is neither Material linked nor Not started", () => {
    const i = deriveIndicators(F({ sectionsProposed: 1 }));
    expect(i.material_linked).toBe(false);
    expect(i.not_started).toBe(false);
  });
  it("a Learn session or activity on a linked section is Learning started, not Practised", () => {
    expect(deriveIndicators(F({ learningSessions: 1 }))).toMatchObject({ learning_started: true, practised: false, evidence_available: false });
    expect(deriveIndicators(F({ sectionsAccepted: 1, learningActions: 3 }))).toMatchObject({ material_linked: true, learning_started: true, practised: false });
  });
  it("an answered practice question through an accepted link is Practised, and a measured result is Learning evidence available", () => {
    const i = deriveIndicators(F({ sectionsAccepted: 1, questions: 4, answered: 2, latestAccuracy: 50 }));
    expect(i).toMatchObject({ material_linked: true, practised: true, evidence_available: true, self_assessed: false, verified: false });
  });
  it("a finished OSCE run or a completed case is Practised and evidence, without any notes link", () => {
    expect(deriveIndicators(F({ osceFinished: 1 }))).toMatchObject({ material_linked: false, practised: true, evidence_available: true });
    expect(deriveIndicators(F({ casesCompleted: 1 }))).toMatchObject({ practised: true, evidence_available: true });
  });
  it("a submitted self-assessment is Self-assessed only: it is not practice, not evidence and not verification", () => {
    const i = deriveIndicators(F({ selfAttempts: 1, selfLatestRating: 4, selfLatestAt: "2026-11-01T00:00:00Z" }));
    expect(i).toMatchObject({ self_assessed: true, practised: false, evidence_available: false, verified: false, not_started: false });
  });
  it("an open self-assessment is not Self-assessed, but the competency is no longer Not started", () => {
    expect(deriveIndicators(F({ selfOpen: true }))).toMatchObject({ self_assessed: false, not_started: false });
  });
  it("an assessor-led stage decision is Learning evidence available", () => {
    expect(deriveIndicators(F({ stage: { outstanding: 2 } }))).toMatchObject({ evidence_available: true, practised: false });
  });
  it("Verified comes only from a current verification, and sits beside the others", () => {
    const i = deriveIndicators(F({ verified: true, selfAttempts: 1 }));
    expect(i).toMatchObject({ verified: true, self_assessed: true, practised: false });
    expect(indicatorLine(i)).toBe("Self-assessed · Verified");
  });
});

describe("needsAttention never calls an empty record a deficiency", () => {
  it("is false for nothing recorded, and for a self rating at or above the expected level", () => {
    expect(needsAttention(F())).toBe(false);
    expect(needsAttention(F({ selfAttempts: 1, selfLatestRating: 4, expected: 4 }))).toBe(false);
  });
  it("is true for a self-identified gap, a difference, an outstanding stage requirement or a rating below expected", () => {
    expect(needsAttention(F({ selfGaps: 1 }))).toBe(true);
    expect(needsAttention(F({ compareDiffers: true }))).toBe(true);
    expect(needsAttention(F({ stage: { outstanding: 1 } }))).toBe(true);
    expect(needsAttention(F({ selfAttempts: 1, selfLatestRating: 2, expected: 4 }))).toBe(true);
  });
});

// A small NUR-CCF-shaped programme: two Areas, three domains, five competencies, deliberately out of alphabetical order.
const comp = (id: string, title: string, domainId: string, sortOrder: number, over: Partial<ExplorerCompetency> = {}): ExplorerCompetency => ({
  id, code: id.toUpperCase(), title, frameworkId: "fw", catalogue: "Competen Nursing Competency Framework", frameworkCode: "NUR-CCF", catalogueVersion: "1.0.0",
  domain: domainId, domainId, sortOrder, expectedLevel: null, contentStatus: "approved", ...over,
});
const COMPS = [
  comp("c1", "Concepts of Ventilation", "d-vent", 1, { expectedLevel: { score: 4, label: "Competent" } }),
  comp("c2", "Care of the Ventilated Patient", "d-vent", 2),
  comp("c3", "Basic Blood Gas Interpretation", "d-gas", 1),
  comp("c4", "Acts with accountability", "d-pp1", 1),
  comp("c5", "Communication & Teamwork", "d-pp2", 1),
];
const STRUCT: ExplorerStructure = {
  frameworkId: "fw",
  areas: [{ id: "a-clin", name: "Clinical Practice", sortOrder: 1 }, { id: "a-prof", name: "Professional Practice", sortOrder: 2 }],
  domains: [
    { id: "d-gas", name: "Blood Gases", code: null, sortOrder: 2, areaId: "a-clin" },
    { id: "d-vent", name: "Ventilation", code: null, sortOrder: 1, areaId: "a-clin" },
    { id: "d-pp2", name: "Communication", code: "PP-02", sortOrder: 2, areaId: "a-prof" },
    { id: "d-pp1", name: "Accountability", code: "PP-01", sortOrder: 1, areaId: "a-prof" },
  ],
};
const structures = new Map([["fw", STRUCT]]);
const facts = new Map<string, ExplorerFacts>([
  ["c1", F({ sectionsAccepted: 1, questions: 3, answered: 3, latestAccuracy: 67, lastPracticeAt: "2026-11-02T10:00:00Z", selfAttempts: 1, selfLatestRating: 2, selfLatestAt: "2026-10-30T00:00:00Z", selfGaps: 1 })],
  ["c3", F({ sectionsAccepted: 2 })],
  ["c5", F({ verified: true })],
]);

describe("buildExplorerModel keeps Framework -> Area -> Domain -> Competency in the saved order", () => {
  const m = buildExplorerModel({ competencies: COMPS, structures, facts });
  const fw = m.frameworks[0];
  it("one framework, two Areas in saved order, domains in saved order under the right Area, competencies in saved order", () => {
    expect(m.frameworks).toHaveLength(1);
    expect(fw).toMatchObject({ code: "NUR-CCF", version: "1.0.0", areasRead: true, total: 5, structureGaps: [] });
    expect(fw.areas.map(a => a.name)).toEqual(["Clinical Practice", "Professional Practice"]);
    expect(fw.areas[0].domains.map(d => d.name)).toEqual(["Ventilation", "Blood Gases"]);
    expect(fw.areas[0].domains[0].rows.map(r => r.id)).toEqual(["c1", "c2"]);
    expect(fw.areas[1].domains.map(d => d.code)).toEqual(["PP-01", "PP-02"]);
  });
  it("counts the summary from the indicators, honestly", () => {
    expect(m.summary).toEqual({ total: 5, selfAssessed: 1, learningActivity: 2, evidence: 1, verified: 1, notStarted: 2 });
  });
  it("a domain with no Area goes into the labelled unassigned group and the gap is said", () => {
    const s: ExplorerStructure = { ...STRUCT, domains: STRUCT.domains.map(d => (d.id === "d-gas" ? { ...d, areaId: null } : d)) };
    const fw2 = buildExplorerModel({ competencies: COMPS, structures: new Map([["fw", s]]), facts }).frameworks[0];
    const none = fw2.areas.find(a => a.id === null)!;
    expect(none).toMatchObject({ name: UNASSIGNED_AREA_NAME, unassigned: true });
    expect(none.domains.map(d => d.name)).toEqual(["Blood Gases"]);
    expect(fw2.structureGaps).toEqual(["1 domain of Competen Nursing Competency Framework has no Area: Blood Gases."]);
  });
  it("a competency with no domain of the framework is listed under the unassigned group, never dropped", () => {
    const loose = comp("c9", "Referenced from elsewhere", "d-foreign", 1, { domain: "Foreign domain" });
    const fw2 = buildExplorerModel({ competencies: [...COMPS, loose], structures, facts }).frameworks[0];
    expect(fw2.areas.flatMap(a => a.domains.flatMap(d => d.rows.map(r => r.id)))).toContain("c9");
    expect(fw2.structureGaps[0]).toMatch(/1 competency is not placed/);
  });
  it("with no structure read, the catalogue order is kept under one group and areasRead is false", () => {
    const fw2 = buildExplorerModel({ competencies: COMPS, structures: null, facts }).frameworks[0];
    expect(fw2.areasRead).toBe(false);
    expect(fw2.areas).toHaveLength(1);
    expect(fw2.areas[0].domains.flatMap(d => d.rows.map(r => r.id))).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });
});

describe("search, filters and sorting leave the structure intact", () => {
  const fw = buildExplorerModel({ competencies: COMPS, structures, facts }).frameworks[0];
  it("search by title, code, domain or Area keeps Area -> Domain -> Competency and drops empty domains", () => {
    const byTitle = applyQuery(fw, { q: "blood gas", filter: "all", sort: "framework" });
    expect(byTitle.areas.map(a => a.domains.map(d => d.rows.map(r => r.id)))).toEqual([[["c3"]], []]);
    const byCode = applyQuery(fw, { q: "C4", filter: "all", sort: "framework" });
    expect(byCode.areas[1].domains[0].rows.map(r => r.id)).toEqual(["c4"]);
    const byArea = applyQuery(fw, { q: "professional", filter: "all", sort: "framework" });
    expect(byArea.areas[0].domains).toEqual([]);
    expect(byArea.areas[1].domains.map(d => d.name)).toEqual(["Accountability", "Communication"]);
    const byDomain = applyQuery(fw, { q: "ventilation", filter: "all", sort: "framework" });
    expect(byDomain.areas[0].domains[0].rows.map(r => r.id)).toEqual(["c1", "c2"]);
  });
  it("filters: not started, in progress, self-assessed, evidence, needs attention", () => {
    const ids = (filter: Parameters<typeof applyQuery>[1]["filter"]) => applyQuery(fw, { q: "", filter, sort: "framework" }).areas.flatMap(a => a.domains.flatMap(d => d.rows.map(r => r.id)));
    expect(ids("not_started")).toEqual(["c2", "c4"]);
    expect(ids("in_progress")).toEqual(["c1", "c3"]);
    expect(ids("self_assessed")).toEqual(["c1"]);
    expect(ids("evidence")).toEqual(["c1"]);
    expect(ids("attention")).toEqual(["c1"]);
    expect(ids("all")).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });
  it("framework order is the default and never alphabetical; alphabetical, recent and gaps reorder within a domain only", () => {
    const vent = fw.areas[0].domains[0].rows;
    expect(sortRows(vent, "framework").map(r => r.id)).toEqual(["c1", "c2"]);
    expect(sortRows(vent, "alpha").map(r => r.id)).toEqual(["c2", "c1"]);
    expect(sortRows(vent, "recent").map(r => r.id)).toEqual(["c1", "c2"]);
    expect(sortRows([vent[1], vent[0]], "recent").map(r => r.id)).toEqual(["c1", "c2"]);
    // gaps: needs attention first, then not started
    expect(sortRows([vent[1], vent[0]], "gaps").map(r => r.id)).toEqual(["c1", "c2"]);
    const sorted = applyQuery(fw, { q: "", filter: "all", sort: "alpha" });
    expect(sorted.areas[0].domains.map(d => d.name)).toEqual(["Ventilation", "Blood Gases"]);
  });
});

describe("parseExplorerState trusts nothing it does not know", () => {
  it("keeps known fields and drops the rest", () => {
    expect(parseExplorerState({ areaId: "a", expanded: ["d", 3], q: "x", filter: "bogus", sort: "recent" })).toEqual({ areaId: "a", expanded: ["d"], q: "x", sort: "recent" });
    expect(parseExplorerState("nope")).toBeNull();
  });
});
