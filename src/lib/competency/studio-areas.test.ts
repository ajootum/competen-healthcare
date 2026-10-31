import { describe, expect, it } from "vitest";
import { dropAction, expandOrder, groupDomains, mapModel, moveCompetency, setDomainArea } from "./studio-areas";

const A = { id: "a1", name: "Clinical Practice" }, B = { id: "a2", name: "Professional Practice" };
type C = { id: string; code: string; name: string; status: string; criteria: { active?: boolean }[] };
const comp = (id: string): C => ({ id, code: id.toUpperCase(), name: `C ${id}`, status: "eligible", criteria: [{}, { active: false }, {}] });
const doms: { id: string; name: string; areaId: string | null; competencies: C[] }[] = [
  { id: "d1", name: "D1", areaId: "a1", competencies: [comp("c1"), comp("c2")] },
  { id: "d2", name: "D2", areaId: null, competencies: [comp("c3")] },
  { id: "d3", name: "D3", areaId: "a2", competencies: [] },
  { id: "d4", name: "D4", areaId: "gone", competencies: [] },
];

describe("groupDomains", () => {
  it("groups by Area in Area order, then Unassigned (no Area, or an unknown one)", () => {
    const g = groupDomains(doms, [B, A]);
    expect(g.map(x => [x.area?.id ?? null, x.domains.map(d => d.id)])).toEqual([["a2", ["d3"]], ["a1", ["d1"]], [null, ["d2", "d4"]]]);
  });
  it("keeps an empty Area and shows no Unassigned group when every domain is placed", () => {
    const g = groupDomains([doms[0]], [A, B]);
    expect(g.map(x => [x.area?.id ?? null, x.domains.length])).toEqual([["a1", 1], ["a2", 0]]);
  });
  it("is one flat group without Areas", () => {
    expect(groupDomains(doms, [])).toEqual([{ area: null, domains: doms }]);
    expect(groupDomains(doms, undefined)).toHaveLength(1);
  });
});

describe("organisational moves", () => {
  it("expandOrder refills only the group's slots", () => {
    expect(expandOrder(["d1", "d2", "d3", "d4"], ["d2", "d4"], ["d4", "d2"])).toEqual(["d1", "d4", "d3", "d2"]);
  });
  it("setDomainArea changes one domain only", () => {
    expect(setDomainArea(doms, "d2", "a2").map(d => d.areaId)).toEqual(["a1", "a2", "a2", "gone"]);
    expect(setDomainArea(doms, "zz", "a2")).toEqual(doms);
  });
  it("moveCompetency moves to the end or to a position and keeps the competency itself", () => {
    const end = moveCompetency(doms, "c1", "d2");
    expect(end[0].competencies.map(c => c.id)).toEqual(["c2"]);
    expect(end[1].competencies.map(c => c.id)).toEqual(["c3", "c1"]);
    expect(moveCompetency(doms, "c1", "d2", 0)[1].competencies.map(c => c.id)).toEqual(["c1", "c3"]);
    expect(moveCompetency(doms, "c1", "d2", 99)[1].competencies.map(c => c.id)).toEqual(["c3", "c1"]);
    expect(end[1].competencies[1]).toBe(doms[0].competencies[0]);
    expect(moveCompetency(doms, "zz", "d2").map(d => d.competencies.length)).toEqual([2, 1, 0, 0]);
    expect(moveCompetency(doms, "c1", "nope").map(d => d.competencies.length)).toEqual([2, 1, 0, 0]);
  });
});

describe("dropAction", () => {
  it("a domain onto another Area (or Unassigned) sets its Area", () => {
    expect(dropAction({ kind: "domain", id: "d1", areaId: "a1" }, { kind: "area", areaId: "a2" })).toEqual({ action: "set_domain_area", domainId: "d1", areaId: "a2" });
    expect(dropAction({ kind: "domain", id: "d1", areaId: "a1" }, { kind: "area", areaId: null })).toEqual({ action: "set_domain_area", domainId: "d1", areaId: null });
  });
  it("a competency onto another domain moves it", () => {
    expect(dropAction({ kind: "competency", id: "c1", domainId: "d1" }, { kind: "domain", domainId: "d2" })).toEqual({ action: "move_competency_domain", competencyId: "c1", domainId: "d2" });
  });
  it("same parent and incompatible parents mean nothing", () => {
    expect(dropAction({ kind: "domain", id: "d2", areaId: null }, { kind: "area", areaId: null })).toBeNull();
    expect(dropAction({ kind: "competency", id: "c1", domainId: "d1" }, { kind: "domain", domainId: "d1" })).toBeNull();
    expect(dropAction({ kind: "competency", id: "c1", domainId: "d1" }, { kind: "area", areaId: "a1" })).toBeNull();
    expect(dropAction({ kind: "domain", id: "d1", areaId: "a1" }, { kind: "domain", domainId: "d2" })).toBeNull();
  });
});

describe("mapModel", () => {
  it("is a column per Area plus Unassigned, with chips showing code, name, active criteria count and status", () => {
    const m = mapModel(doms, [A, B]);
    expect(m.map(c => [c.key, c.title, c.unassigned, c.domains.map(d => d.id)])).toEqual([["a1", "Clinical Practice", false, ["d1"]], ["a2", "Professional Practice", false, ["d3"]], ["none", "Unassigned", true, ["d2", "d4"]]]);
    expect(m[0].domains[0].chips[0]).toEqual({ id: "c1", code: "C1", name: "C c1", criteria: 2, status: "eligible" });
  });
  it("is one column of all domains without Areas", () => {
    const m = mapModel(doms, null);
    expect(m).toHaveLength(1);
    expect(m[0].domains.map(d => d.id)).toEqual(["d1", "d2", "d3", "d4"]);
  });
});
