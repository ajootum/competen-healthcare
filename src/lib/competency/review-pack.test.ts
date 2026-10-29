import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PACK_NOTICE, checksFor, groupCriteria, renderPackDocx, versionLine, type Pack } from "./review-pack";

// Owner 29 Oct 2026: a paper copy of competencies for clinical review. Criteria grouped in source words, each
// competency with its exact version and fingerprint, and a notice that the decision is recorded in Competen.

const COMPONENTS = { clinical_skills: "Clinical Skills", knowledge: "Knowledge", knowledge_application: "Knowledge Application" };
const crit = [
  { component: "clinical_skills", text: "Uses correct techniques to assess the respiratory system", sourceRef: "Sheet!D7" },
  { component: "clinical_skills", text: "Uses correct techniques to assess the respiratory system", sourceRef: "Sheet!D8" },
  { component: "knowledge", text: "Demonstrates knowledge of normal respiratory cycle", sourceRef: "Sheet!D11" },
];

describe("the review pack content", () => {
  it("groups criteria by component in registry order, numbered S1, K1, A1", () => {
    const g = groupCriteria(crit, COMPONENTS);
    expect(g.map(x => [x.label, x.criteria.map(k => k.n)])).toEqual([["Clinical Skills", ["S1", "S2"]], ["Knowledge", ["K1"]]]);
  });
  it("points out a repeated criterion and a missing component, without judging the content", () => {
    expect(checksFor(crit, COMPONENTS)).toEqual(["Criterion 2 repeats criterion 1 word for word.", "No Knowledge Application criteria are recorded."]);
    expect(checksFor([], COMPONENTS)).toEqual(["No assessment criteria are recorded."]);
  });
});

describe("the Word copy", () => {
  const pack: Pack = {
    title: "Clinical review pack", scope: "Waiting for Reviewer · 1 competency", generatedAt: "2026-10-29T15:00:00Z", generatedBy: "Reviewer",
    items: [{ competencyId: "c1", code: "NUR-CCF-001", name: "Respiratory Assessment", domain: "Breathing", framework: "Competen Nursing Competency Framework",
      versionId: "0a1b2c3d-0000-4000-8000-000000000000", fingerprint: "23525c25898da74d89a653c446571b05", state: "In clinical review", approvals: 0, required: 1,
      description: null, outcomes: [], groups: groupCriteria(crit, COMPONENTS), checks: checksFor(crit, COMPONENTS) }],
  };
  it("carries the version and fingerprint on each competency", () => {
    expect(versionLine(pack.items[0])).toBe("Version 0a1b2c3d · fingerprint 23525c25…1b05 · In clinical review · 0 of 1 approval");
  });
  it("is a real .docx holding the notice, the version line and every criterion", async () => {
    const buf = await renderPackDocx(pack);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    expect(xml).toContain(PACK_NOTICE.slice(0, 60));
    expect(xml).toContain("fingerprint 23525c25");
    expect(xml).toContain("Demonstrates knowledge of normal respiratory cycle");
    expect(xml).toContain("Recommend approval");
  });
});
