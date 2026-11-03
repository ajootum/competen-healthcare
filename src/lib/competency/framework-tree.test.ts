import { describe, expect, it } from "vitest";
import { frameworkTree, toLayoutTree } from "./framework-tree";

// The tree every page shows: saved order, Areas from the records, gaps said rather than guessed.

const input = {
  areas: [{ id: "a-prof", name: "Professional Practice", sortOrder: 2 }, { id: "a-clin", name: "Clinical Practice", sortOrder: 1 }],
  domains: [
    { id: "d-pp1", name: "Accountability", code: "PP-01", sortOrder: 1, areaId: "a-prof" },
    { id: "d-vent", name: "Ventilation", sortOrder: 3, areaId: "a-clin" },
    { id: "d-airway", name: "Airway", sortOrder: 1, areaId: "a-clin" },
    { id: "d-breath", name: "Breathing", sortOrder: 2, areaId: "a-clin" },
  ],
  competencies: [
    { id: "c-z", name: "Zebra first by saved order", domainId: "d-airway", sortOrder: 1 },
    { id: "c-a", name: "Alpha second by saved order", domainId: "d-airway", sortOrder: 2 },
    { id: "c-v", name: "Concepts of Ventilation", domainId: "d-vent", sortOrder: 1 },
    { id: "c-b", name: "Basic Blood Gas", domainId: "d-breath", sortOrder: 1 },
    { id: "c-p", name: "Acts accountably", domainId: "d-pp1", sortOrder: 1 },
  ],
};

describe("frameworkTree", () => {
  it("keeps Framework -> Area -> Domain -> Competency in the saved order, never alphabetical", () => {
    const t = frameworkTree(input);
    expect(t.areasRead).toBe(true);
    expect(t.areas.map(a => a.area?.name)).toEqual(["Clinical Practice", "Professional Practice"]);
    expect(t.areas[0].domains.map(d => d.name)).toEqual(["Airway", "Breathing", "Ventilation"]);
    expect(t.areas[0].domains[0].competencyIds).toEqual(["c-z", "c-a"]);
    expect(t.areas[1].domains[0]).toMatchObject({ code: "PP-01", competencyIds: ["c-p"] });
    expect(t.unassignedDomainIds).toEqual([]);
    expect(t.unplacedCompetencyIds).toEqual([]);
  });

  it("puts a domain with no Area in the unassigned group and names it as a gap, instead of inferring an Area from its name", () => {
    const t = frameworkTree({ ...input, domains: [...input.domains, { id: "d-lost", name: "Clinical Governance", sortOrder: 9, areaId: null }] });
    const none = t.areas.find(a => a.area === null)!;
    expect(none.domains.map(d => d.id)).toEqual(["d-lost"]);
    expect(t.unassignedDomainIds).toEqual(["d-lost"]);
    // the unassigned group comes after the Areas
    expect(t.areas[t.areas.length - 1]).toBe(none);
  });

  it("with no Areas read there is one group, area null, and nothing is called unassigned", () => {
    const t = frameworkTree({ domains: input.domains.map(d => ({ id: d.id, name: d.name, code: d.code, sortOrder: d.sortOrder })), competencies: input.competencies });
    expect(t.areasRead).toBe(false);
    expect(t.areas).toHaveLength(1);
    expect(t.areas[0].area).toBeNull();
    expect(t.areas[0].domains.map(d => d.name)).toEqual(["Accountability", "Airway", "Breathing", "Ventilation"]);
    expect(t.unassignedDomainIds).toEqual([]);
  });

  it("lists a competency whose domain is not the framework's as unplaced", () => {
    const t = frameworkTree({ ...input, competencies: [...input.competencies, { id: "c-ref", name: "Referenced elsewhere", domainId: "d-other-fw", sortOrder: 1 }] });
    expect(t.unplacedCompetencyIds).toEqual(["c-ref"]);
    expect(t.areas.flatMap(a => a.domains.flatMap(d => d.competencyIds))).not.toContain("c-ref");
  });

  it("applies a layout draft through the same rules the Studio uses (the Studio's view), and none without one (the learner's view)", () => {
    const draft = { v: 1 as const, areas: ["a-prof", "a-clin"], competencies: { "d-airway": ["c-a", "c-z"] } };
    expect(frameworkTree(input, draft).areas.map(a => a.area?.name)).toEqual(["Professional Practice", "Clinical Practice"]);
    expect(frameworkTree(input, draft).areas[1].domains[0].competencyIds).toEqual(["c-a", "c-z"]);
    expect(frameworkTree(input, null).areas[0].domains[0].competencyIds).toEqual(["c-z", "c-a"]);
  });

  it("toLayoutTree carries criteria and the section order for the Studio", () => {
    const t = toLayoutTree({ ...input, componentOrder: ["knowledge"], registry: ["knowledge", "skill"], competencies: [{ id: "c-1", name: "x", domainId: "d-vent", sortOrder: 1, criteria: [{ id: "k1", name: "k", sortOrder: 1, component: "skill" }] }] });
    expect(t.componentOrder).toEqual(["knowledge"]);
    expect(t.domains.find(d => d.id === "d-vent")!.competencies[0].criteria).toEqual([{ id: "k1", name: "k", sortOrder: 1, component: "skill" }]);
  });
});
