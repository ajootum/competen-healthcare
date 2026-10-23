import { describe, expect, it } from "vitest";
import { allowedCatalogueIds, assembleCatalogue, loadIndividualCatalogue } from "./foundation";

const base = {
  frameworks: [
    { id: "fw-f", name: "Competen Foundational", code: "CF", version_major: 1, version_minor: 0, version_revision: 0, competency_layer: "foundational", profession_term_id: null },
    { id: "fw-n", name: "Nursing: Respiratory Care", code: "NRC", version_major: 1, version_minor: 2, version_revision: 0, competency_layer: "profession", profession_term_id: "t-nursing" },
  ],
  domains: [{ id: "d-f", framework_id: "fw-f", name: "Clinical reasoning" }, { id: "d-n", framework_id: "fw-n", name: "Oxygen therapy" }],
  competencies: [
    { id: "c-f", domain_id: "d-f", name: "Recognises deterioration", description: null, code: "CF-CR-01", cpu_id: null, learning_outcomes: ["Explains early warning signs", " "], expected_level_id: "l-3" },
    { id: "c-n", domain_id: "d-n", name: "Assess oxygen requirement", description: "SpO2 targets", code: "COMP-OXY-001", cpu_id: "u-1", learning_outcomes: [], expected_level_id: null },
  ],
  cpus: [{ id: "u-1", code: "CPU-OXYSAFE-001", name: "Safe Oxygen Administration" }],
  levels: [{ id: "l-3", score: 3, label: "Competent" }],
  terms: [{ id: "t-nursing", value: "Nursing" }],
  dependencies: [{ source_competency_id: "c-n", target_competency_id: "c-f", dependency_type: "prerequisite" }, { source_competency_id: "c-n", target_competency_id: "c-x", dependency_type: "inherited" }],
  equivalencies: [{ source_competency_id: "c-n", target_competency_id: "c-f" }],
};

describe("the shared competency foundation read API (S1)", () => {
  it("assembles layer, profession, catalogue, outcomes, expected level, CPU and Holdings links", () => {
    const [f, n] = assembleCatalogue(base);
    expect(f).toMatchObject({ competencyId: "c-f", layer: "foundational", profession: null, outcomes: ["Explains early warning signs"], expectedLevel: { score: 3, label: "Competent" }, cpu: null });
    expect(n).toMatchObject({ layer: "profession", profession: { termId: "t-nursing", label: "Nursing" }, catalogue: { id: "fw-n", version: "1.2.0" }, cpu: { code: "CPU-OXYSAFE-001" }, outcomes: [] });
    // A link to a competency outside the offered set is dropped, not invented.
    expect(n.links).toEqual({ prerequisites: ["c-f"], extends: [], sharedWith: ["c-f"] });
    expect(f.links.sharedWith).toEqual(["c-n"]);
  });

  it("an unclassified catalogue reads as layer null, never as a guessed layer", () => {
    const [c] = assembleCatalogue({ ...base, frameworks: [{ ...base.frameworks[0], competency_layer: "nursing-root" }], competencies: [base.competencies[0]] });
    expect(c.layer).toBeNull();
  });

  it("nothing allowed reads nothing, and an unreadable library is null (fail closed)", async () => {
    expect(await loadIndividualCatalogue({ from: () => { throw new Error("must not be called"); } }, [])).toEqual([]);
    expect(await loadIndividualCatalogue({ from: () => { throw new Error("down"); } }, ["fw-f"])).toBeNull();
    expect(allowedCatalogueIds({ scholarCatalogues: ["a"], professionalCatalogues: ["b"] }, "professional")).toEqual(["b"]);
  });
});
