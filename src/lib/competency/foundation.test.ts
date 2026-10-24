import { describe, expect, it } from "vitest";
import { allowedCatalogueIds, assembleCatalogue, loadIndividualCatalogue, withClinicalReview } from "./foundation";

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

  // Migration 394: a controlled catalogue REFERENCES existing competencies, with their own practice and CPU.
  const controlled = {
    ...base,
    frameworks: [{ id: "fw-c", name: "Scholar: Respiratory and Cardiovascular", code: "SCH-RC", competency_layer: "profession", profession_term_id: "t-nursing" }],
    homeFrameworks: [{ id: "fw-core", name: "Core Nursing" }],
    domains: [{ id: "d-air", framework_id: "fw-core", name: "Domain 2: Airway" }, { id: "d-hosp", framework_id: "fw-hosp", name: "Ward airway" }],
    competencies: [
      { id: "c-air", domain_id: "d-air", name: "Maintains Airway Safety", description: null, code: null, practice_id: "p-air", cpu_id: null, learning_outcomes: [], expected_level_id: null },
      { id: "c-oxy", domain_id: "d-air", name: "Administers oxygen", description: null, code: null, practice_id: null, cpu_id: "u-1", learning_outcomes: [], expected_level_id: null },
      { id: "c-hosp", domain_id: "d-hosp", name: "Ward airway", description: null, code: null, practice_id: null, cpu_id: null, learning_outcomes: [], expected_level_id: null },
    ],
    cpus: [{ id: "u-1", code: "CPU-OXYSAFE-001", name: "Safe Oxygen Administration", practice_id: "p-oxy" }],
    practices: [{ id: "p-air", code: "PRA-AIR-001", name: "Airway Management" }, { id: "p-oxy", code: "PRA-OXY-001", name: "Oxygen Therapy" }],
    entries: [
      { catalogue_id: "fw-c", competency_id: "c-oxy", content_status: "approved", status_note: "Reviewed by the clinical lead", sort_order: 2 },
      { catalogue_id: "fw-c", competency_id: "c-air", content_status: "unreviewed", status_note: null, sort_order: 1 },
      { catalogue_id: "fw-c", competency_id: "c-hosp", content_status: "approved", status_note: null, sort_order: 3 },
      { catalogue_id: "fw-other", competency_id: "c-air", content_status: "approved", status_note: null, sort_order: 0 },
    ],
    dependencies: [], equivalencies: [],
  };

  it("a controlled catalogue offers what it references, in its order, with home, practice (own or via the CPU) and status", () => {
    const out = assembleCatalogue(controlled);
    expect(out.map(c => c.competencyId)).toEqual(["c-air", "c-oxy"]);
    expect(out[0]).toMatchObject({ catalogue: { id: "fw-c" }, home: { frameworkId: "fw-core", frameworkName: "Core Nursing" }, domain: { name: "Domain 2: Airway" },
      practice: { code: "PRA-AIR-001" }, cpu: null, contentStatus: "unreviewed", layer: "profession", profession: { label: "Nursing" } });
    // D2: an entry can no longer make content approved -- only 395 clinical review can.
    expect(out[1]).toMatchObject({ practice: { code: "PRA-OXY-001" }, cpu: { code: "CPU-OXYSAFE-001" }, contentStatus: "unreviewed", statusNote: "Reviewed by the clinical lead" });
  });

  it("D2: approved only when clinical review approved the current content; every other state is labelled", () => {
    const out = assembleCatalogue(controlled);
    const reviews = new Map([
      ["c-oxy", { state: "approved" as const, approvals: 1, required: 1, versionId: "v1", approvedAt: "2026-10-24" }],
      ["c-air", { state: "stale" as const, approvals: 0, required: 1, versionId: null, approvedAt: null }],
    ]);
    const [air, oxy] = withClinicalReview(out, reviews);
    expect(oxy).toMatchObject({ contentStatus: "approved", clinicalState: "approved", statusNote: "Approved by 1 independent clinical reviewer for this exact content." });
    expect(air).toMatchObject({ contentStatus: "unreviewed", clinicalState: "stale", statusNote: "The content changed after it was approved, so it needs renewed approval." });
  });

  it("a reference to a hospital framework's competency, or from a catalogue not offered, is dropped", () => {
    const ids = assembleCatalogue(controlled).map(c => c.competencyId);
    expect(ids).not.toContain("c-hosp");
    // fw-other is not an offered catalogue, so its "approved" entry for c-air never applies.
    expect(assembleCatalogue(controlled).find(c => c.competencyId === "c-air")?.contentStatus).toBe("unreviewed");
  });

  it("a catalogue's own competencies are unreviewed: publication is not a clinical review", () => {
    expect(assembleCatalogue(base).every(c => c.contentStatus === "unreviewed" && c.statusNote === null && c.home.frameworkId === c.catalogue.id)).toBe(true);
  });

  it("an unknown status string is never read as approved", () => {
    const [c] = assembleCatalogue({ ...controlled, entries: [{ catalogue_id: "fw-c", competency_id: "c-oxy", content_status: "APPROVED", sort_order: 0 }] });
    expect(c.contentStatus).toBe("unreviewed");
  });

  it("nothing allowed reads nothing, and an unreadable library is null (fail closed)", async () => {
    expect(await loadIndividualCatalogue({ from: () => { throw new Error("must not be called"); } }, [])).toEqual([]);
    expect(await loadIndividualCatalogue({ from: () => { throw new Error("down"); } }, ["fw-f"])).toBeNull();
    expect(allowedCatalogueIds({ scholarCatalogues: ["a"], professionalCatalogues: ["b"] }, "professional")).toEqual(["b"]);
  });
});
