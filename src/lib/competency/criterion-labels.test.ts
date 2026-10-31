import { describe, expect, it } from "vitest";
import { criterionLabel, criterionPrefixes, initialsOf } from "./criterion-labels";

// Owner 31 Oct 2026: criteria labels come from the component registry, not hard-coded letters.
describe("criterion labels from the registry", () => {
  it("derives initials from the label, leaving out joining words", () => {
    expect(initialsOf("Demonstrated Professional Practice")).toBe("DPP");
    expect(initialsOf("Application & Judgement")).toBe("AJ");
    expect(initialsOf("Knowledge")).toBe("K");
    expect(initialsOf("Knowledge of the Law")).toBe("KL");
  });
  it("is unique across the registry, never the unclassified C, and numbers within the section", () => {
    const p = criterionPrefixes({ clinical_skills: "Clinical Skills", knowledge: "Knowledge", knowledge_application: "Knowledge Application", communication: "Communication", kindness: "Kindness" });
    expect(p).toEqual({ clinical_skills: "CS", knowledge: "K", knowledge_application: "KA", communication: "CO", kindness: "KI" });
    expect(criterionLabel(p, "knowledge", 0)).toBe("K1");
    expect(criterionLabel(p, null, 2)).toBe("C3");
    expect(criterionLabel(p, "unknown_code", 0)).toBe("C1");
  });
});
