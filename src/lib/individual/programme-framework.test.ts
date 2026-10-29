import { describe, expect, it } from "vitest";
import { assembleCatalogue } from "@/lib/competency/foundation";
import { projectForProgramme, type ProgrammeConfig } from "./scholar/catalogue";
import { annotate } from "./programme-framework";

// CFCA-STUDIO-P1 item 10 evidence: programme-specific filtering. One shared master catalogue, two programme
// frameworks that NAME parts of it with their own requirements and targets -- and each programme resolves to
// exactly its own set, through the same projection Scholar uses for a learner.

const L = (id: string, score: number) => ({ id, score, label: `Level ${score}` });
const rows = {
  frameworks: [
    { id: "enr", name: "Enrolled Nursing Programme", code: "NUR-ENR", competency_layer: "profession", profession_term_id: null, version_major: 1, version_minor: 0, version_revision: 0 },
    { id: "bsc", name: "BSc Nursing Programme", code: "NUR-BSC", competency_layer: "profession", profession_term_id: null, version_major: 1, version_minor: 2, version_revision: 0 },
  ],
  homeFrameworks: [{ id: "master", name: "Competen Nursing Foundation" }],
  domains: [{ id: "d1", framework_id: "master", name: "Fundamentals" }, { id: "d2", framework_id: "master", name: "Leadership" }],
  competencies: [
    { id: "vit", domain_id: "d1", name: "Vital signs", expected_level_id: "b3" },
    { id: "med", domain_id: "d1", name: "Medication administration", expected_level_id: "b3" },
    { id: "lead", domain_id: "d2", name: "Leading a care team", expected_level_id: "b3" },
  ],
  cpus: [], terms: [], dependencies: [], equivalencies: [], practices: [],
  levels: [L("b3", 3), L("d3", 3), L("d4", 4), L("d5", 5)],
  entries: [
    { id: "e1", catalogue_id: "enr", competency_id: "vit", requirement: "required", expected_level_id: "d3", sort_order: 1 },
    { id: "e2", catalogue_id: "enr", competency_id: "med", requirement: "recommended", expected_level_id: null, sort_order: 2 },
    { id: "e3", catalogue_id: "bsc", competency_id: "vit", requirement: "required", expected_level_id: "d4", sort_order: 1 },
    { id: "e4", catalogue_id: "bsc", competency_id: "med", requirement: "required", expected_level_id: "d4", sort_order: 2 },
    { id: "e5", catalogue_id: "bsc", competency_id: "lead", requirement: "optional", expected_level_id: "d5", sort_order: 3 },
  ],
};
const programme = (code: string, catalogue: string): ProgrammeConfig =>
  ({ code, label: code, profession: "Nursing", country: null, level: null, frameworks: [{ frameworkId: catalogue, layer: "profession", sortOrder: 0 }] });

describe("programme-specific filtering over one shared catalogue", () => {
  const all = assembleCatalogue(rows as never);
  const enrolled = projectForProgramme(all as never, programme("nursing-enrolled", "enr"));
  const bsc = projectForProgramme(all as never, programme("nursing-bsc", "bsc"));

  it("no competency is copied: three shared competencies, one record each", () => {
    expect(all.map(c => c.competencyId).sort()).toEqual(["lead", "med", "vit"]);
  });
  it("the enrolled programme sees only what its framework names, with its own requirement and target", () => {
    expect(enrolled.map(c => [c.id, c.requirement, c.expectedLevel?.score, c.targetFrom])).toEqual([
      ["vit", "required", 3, "programme"],
      ["med", "recommended", 3, "competency"],
    ]);
    expect(enrolled.every(c => c.catalogue === "Enrolled Nursing Programme")).toBe(true);
  });
  it("the BSc programme sees the same shared competencies at its own higher targets, plus its optional one", () => {
    expect(bsc.map(c => [c.id, c.requirement, c.expectedLevel?.score])).toEqual([["vit", "required", 4], ["med", "required", 4], ["lead", "optional", 5]]);
    expect(bsc.map(c => c.catalogueVersion)).toEqual(["1.2.0", "1.2.0", "1.2.0"]);
  });
  it("a programme with no framework linked resolves to nothing", () => {
    expect(projectForProgramme(all as never, { ...programme("none", "x"), frameworks: [] })).toEqual([]);
  });
  it("the preview says why a row is not offered: catalogue not published, not allowlisted, below the content floor", () => {
    const out = annotate(bsc, {
      catalogues: new Map([["bsc", { status: "draft", allowlisted: false }]]), minStatus: "approved",
      stageOf: (_id, score) => (score === 4 ? "competent" : score === 5 ? "proficient" : null), components: new Map([["e3", []]]),
    });
    expect(out[0].targetStage).toBe("competent");
    expect(out[2].targetStage).toBe("proficient");
    expect(out[0].notOffered).toHaveLength(3);
    const offered = annotate(bsc.map(c => ({ ...c, contentStatus: "approved" as const })), {
      catalogues: new Map([["bsc", { status: "published", allowlisted: true }]]), minStatus: "approved", stageOf: () => null, components: new Map(),
    });
    expect(offered.every(r => r.notOffered.length === 0)).toBe(true);
  });
});
