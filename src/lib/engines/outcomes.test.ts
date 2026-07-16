import { describe, it, expect } from "vitest";
import { outcomeFor, maturityFromScore } from "./outcomes";

describe("outcomeFor — governed competency decision (Book I Ch.10)", () => {
  it("critical failure blocks competency regardless of score", () => {
    expect(outcomeFor(6, true, true, true)).toBe("not_yet_competent");
    expect(outcomeFor(5, true, false, true)).toBe("not_yet_competent");
  });
  it("passing + educator-validated → competent", () => {
    expect(outcomeFor(4, true, true, false)).toBe("competent");
    expect(outcomeFor(6, true, true, false)).toBe("competent");
  });
  it("passing but not validated → provisionally competent", () => {
    expect(outcomeFor(4, true, false, false)).toBe("provisionally_competent");
  });
  it("non-passing score ≥2 → requires remediation", () => {
    expect(outcomeFor(2, false, false, false)).toBe("requires_remediation");
    expect(outcomeFor(2, false, true, false)).toBe("requires_remediation");
  });
  it("score <2 or missing → not yet competent", () => {
    expect(outcomeFor(1, false, false, false)).toBe("not_yet_competent");
    expect(outcomeFor(0, false, false, false)).toBe("not_yet_competent");
    expect(outcomeFor(null, false, false, false)).toBe("not_yet_competent");
  });
});

describe("maturityFromScore — Benner model mapping", () => {
  it("maps every score band", () => {
    expect(maturityFromScore(0)).toBe("novice");
    expect(maturityFromScore(1)).toBe("novice");
    expect(maturityFromScore(2)).toBe("advanced_beginner");
    expect(maturityFromScore(3)).toBe("competent");
    expect(maturityFromScore(4)).toBe("competent");
    expect(maturityFromScore(5)).toBe("proficient");
    expect(maturityFromScore(6)).toBe("expert");
  });
});
