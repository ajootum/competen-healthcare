import { describe, it, expect } from "vitest";
import { buildCompetencyCoverage, absentLabel, insufficient, notMeasured, COVERAGE_REASON } from "./progress-model";

// The Holdings-level progress shape, shared by Scholar and Professional.

const cat = [
  { id: "a", name: "Asepsis", frameworkName: "CF-FOUND", expectedLevel: { score: 2, label: "Competent" } },
  { id: "b", name: "Handover", frameworkName: "CF-FOUND", expectedLevel: { score: 4, label: "Proficient" } },
  { id: "c", name: "Consent", frameworkName: "NUR-RESP", expectedLevel: null },
];

describe("buildCompetencyCoverage", () => {
  it("each missing input is Not measured with its own reason, checked in order", () => {
    expect(buildCompetencyCoverage({ catalogue: cat, evidence: new Map(), unreadable: true })).toEqual(notMeasured(COVERAGE_REASON.unreadable));
    expect(buildCompetencyCoverage({ catalogue: null, evidence: new Map() })).toEqual(notMeasured(COVERAGE_REASON.noCatalogue));
    expect(buildCompetencyCoverage({ catalogue: cat, evidence: null })).toEqual(notMeasured(COVERAGE_REASON.noEvidenceSource));
    expect(buildCompetencyCoverage({ catalogue: [], evidence: new Map() })).toEqual(notMeasured(COVERAGE_REASON.emptyCatalogue));
    expect(buildCompetencyCoverage({ catalogue: null, evidence: null, reasons: { noCatalogue: "Custom." } })).toEqual(notMeasured("Custom."));
  });
  it("covered, covered positively, and gaps by expected level -- touched, never achieved", () => {
    const r = buildCompetencyCoverage({ catalogue: cat, evidence: new Map([["a", { evidence: 3, positive: 0 }]]) });
    expect(r).toEqual({
      state: "measured", framework: "CF-FOUND, NUR-RESP", total: 3, covered: 1, coveredPositive: 0,
      gaps: [{ id: "b", name: "Handover", expected: "Proficient" }, { id: "c", name: "Consent", expected: null }],
      rows: [
        { id: "a", name: "Asepsis", evidence: 3, positive: 0, expected: "Competent" },
        { id: "b", name: "Handover", evidence: 0, positive: 0, expected: "Proficient" },
        { id: "c", name: "Consent", evidence: 0, positive: 0, expected: null },
      ],
    });
  });
});

describe("absent states", () => {
  it("name themselves, with the experience's own noun", () => {
    expect(absentLabel(insufficient(2, 5, "x"))).toBe("Too little practice to say");
    expect(absentLabel(insufficient(2, 5, "x"), "evidence")).toBe("Too little evidence to say");
    expect(absentLabel(notMeasured("x"))).toBe("Not measured");
  });
});
