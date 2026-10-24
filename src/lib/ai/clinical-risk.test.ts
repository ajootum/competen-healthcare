import { describe, expect, it } from "vitest";
import { classifyRisk, resolveRiskPolicy, termIn, type ResolvedRiskSubject } from "./clinical-risk";
import { activityAt, resolvePolicy, type Balance } from "./fair-use-policy";

// Owner D1: the clinical risk of a request comes from its subject, unknown is high risk, and no level runs a
// request below its tier's model floor.

const risk = resolveRiskPolicy({
  minTier: { standard_educational: "cheap", clinical_educational: "reasoning", high_risk_clinical: "heavy" },
  rules: [
    { id: "high.medication", label: "Medication and dosing", tier: "high_risk_clinical", all: [["medication*", "dose", "dosing", "insulin", "mg"]] },
    { id: "high.paediatric-deterioration", label: "Paediatric deterioration", tier: "high_risk_clinical", all: [["paediatric", "child*", "infant*"], ["deteriorat*", "sepsis"]] },
    { id: "high.competency", label: "High-risk competency", tier: "high_risk_clinical", competencyRisk: ["high"] },
    { id: "clinical.general", label: "Clinical topics", tier: "clinical_educational", all: [["oxygen", "respiratory", "hand hygiene", "assessment"]] },
    { id: "clinical.cf-found", label: "Foundational framework", tier: "clinical_educational", frameworks: ["CF-FOUND"] },
    { id: "standard.study", label: "Study skills", tier: "standard_educational", all: [["revision plan", "exam technique", "referencing"]] },
  ],
});
const subj = (text: string, more: Partial<ResolvedRiskSubject> = {}): ResolvedRiskSubject => ({ text, competencyRisks: [], frameworkCodes: [], ...more });

describe("clinical risk classification (owner D1)", () => {
  it("classifies by subject, not by activity: Teach Me on medication safety is high risk", () => {
    expect(classifyRisk(risk, subj("Teach me about medication safety")).tier).toBe("high_risk_clinical");
    expect(classifyRisk(risk, subj("Teach me about oxygen therapy")).tier).toBe("clinical_educational");
    expect(classifyRisk(risk, subj("Help me with my revision plan")).tier).toBe("standard_educational");
  });

  it("the highest matching tier wins over a lower one", () => {
    const d = classifyRisk(risk, subj("A revision plan for insulin dosing"));
    expect(d).toMatchObject({ tier: "high_risk_clinical", rule: "high.medication" });
  });

  it("a rule with several groups needs every group: paediatric AND deterioration", () => {
    expect(classifyRisk(risk, subj("Recognising deterioration in a child with sepsis")).rule).toBe("high.paediatric-deterioration");
    expect(classifyRisk(risk, subj("Child development milestones")).tier).toBe("high_risk_clinical"); // no rule: unknown
    expect(classifyRisk(risk, subj("Child development milestones")).rule).toBe("unknown:no_rule");
  });

  it("unknown is high risk: no subject, or a subject no rule recognises", () => {
    expect(classifyRisk(risk, subj(""))).toMatchObject({ tier: "high_risk_clinical", rule: "unknown:no_subject" });
    expect(classifyRisk(risk, subj("Tell me about the history of the hospital"))).toMatchObject({ tier: "high_risk_clinical", rule: "unknown:no_rule" });
    expect(classifyRisk(resolveRiskPolicy(null), subj("revision plan")).tier).toBe("high_risk_clinical");
  });

  it("competencies and frameworks classify too, and a high-risk competency makes the request high risk", () => {
    expect(classifyRisk(risk, subj("", { competencyRisks: ["high"] })).tier).toBe("high_risk_clinical");
    expect(classifyRisk(risk, subj("", { frameworkCodes: ["CF-FOUND"] })).tier).toBe("clinical_educational");
  });

  it("an activity floor only raises the result", () => {
    expect(classifyRisk(risk, subj("revision plan"), "high_risk_clinical")).toMatchObject({ tier: "high_risk_clinical", rule: "activity_floor:standard.study" });
    expect(classifyRisk(risk, subj("insulin dosing"), "standard_educational").tier).toBe("high_risk_clinical");
  });

  it("terms match whole words, or word starts for a term ending in *", () => {
    expect(termIn(" the dose was ", "dose")).toBe(true);
    expect(termIn(" doses ", "dose")).toBe(false);
    expect(termIn(" medications ", "medication*")).toBe(true);
    expect(termIn(" premedication ", "medication*")).toBe(false);
  });

  it("validation: bad rules dropped, floors never fall from tier to tier", () => {
    const r = resolveRiskPolicy({ minTier: { standard_educational: "heavy", clinical_educational: "cheap", high_risk_clinical: "cheap" },
      rules: [{ id: "Bad Id", tier: "high_risk_clinical", all: [["x1"]] }, { id: "ok.rule", tier: "nope", all: [["x1"]] }, { id: "empty", tier: "clinical_educational" }] });
    expect(r.rules).toEqual([]);
    expect(r.minTier).toEqual({ standard_educational: "heavy", clinical_educational: "heavy", high_risk_clinical: "heavy" });
  });
});

describe("no silent downgrade below a risk tier's model floor", () => {
  const p = resolvePolicy("scholar", { includedCau: 100, risk: { minTier: { standard_educational: "cheap", clinical_educational: "reasoning", high_risk_clinical: "heavy" }, rules: [] },
    activities: { teach: { tier: "reasoning", minTier: "cheap", riskFloor: "standard_educational" } } }, "v");
  const bal = (used: number): Balance => ({ includedCau: 100, reserveCau: 0, usedCau: used, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 });

  it("at full, a high-risk request runs on the tier floor even above the activity's own tier", () => {
    expect(activityAt(p, "full", "teach", bal(0), "high_risk_clinical")).toMatchObject({ available: true, tier: "heavy" });
    expect(activityAt(p, "full", "teach", bal(0), "standard_educational")).toMatchObject({ available: true, tier: "reasoning" });
  });

  it("at optimised, a clinical request may not drop below reasoning, a standard one may", () => {
    expect(activityAt(p, "optimised", "teach", bal(75), "clinical_educational")).toMatchObject({ available: false, refusal: "level_insufficient" });
    expect(activityAt(p, "optimised", "teach", bal(75), "standard_educational")).toMatchObject({ available: true, tier: "cheap" });
  });

  it("a high-risk request at optimised steps down from heavy only to its floor or is refused", () => {
    expect(activityAt(p, "optimised", "teach", bal(75), "high_risk_clinical")).toMatchObject({ available: false, refusal: "level_insufficient" });
  });
});
