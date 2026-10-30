/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyRisk, resolveRiskPolicy, type ResolvedRiskSubject } from "./clinical-risk";
import { SCHOLAR_HIGH_KEPT, STUDY_TOPIC_RULES, withScholarEducational } from "../../../scripts/scholar-edu-policy";

// SCHOLAR-EDU-AI-01: how real Scholar questions classify once the topic rules are educational. The starting point is
// the production rule set as published on 30 Oct (the 29 Oct additions applied to the earlier published rules).

const S = (text: string, competencyRisks: string[] = []): ResolvedRiskSubject => ({ text, competencyRisks, frameworkCodes: [] });
const base = JSON.parse(readFileSync(new URL("./fixtures/scholar-risk-2026-10-30.json", import.meta.url), "utf8"));
const before = resolveRiskPolicy(base);
const after = resolveRiskPolicy(withScholarEducational(base));
const tier = (p: any, t: string, c: string[] = []) => classifyRisk(p, S(t, c), "standard_educational").tier;

describe("Scholar educational classification", () => {
  it("studying medicines, emergencies, paediatrics and high-risk competencies is clinical educational, not refused as patient care", () => {
    for (const q of [
      "Explain how furosemide works and what to monitor",
      "What are the side effects of morphine",
      "Explain the steps of adult CPR and resuscitation",
      "How is anaphylaxis recognised",
      "Explain mechanical ventilation and advanced airway management",
      "Signs of sepsis in children and paediatric deterioration",
      "Pyelonephritis: how does the infection spread from the bladder to the kidneys",
    ]) {
      expect(tier(after, q), q).toBe("clinical_educational");
    }
    expect(classifyRisk(after, S("Explain this competency", ["high"]), "standard_educational").tier).toBe("clinical_educational");
    expect(tier(before, "What are the side effects of morphine")).toBe("high_risk_clinical");
    expect(tier(before, "Explain how furosemide works and what to monitor")).toBe("high_risk_clinical");
    // Text no rule recognises still fails closed.
    expect(tier(after, "qwerty zxcv")).toBe("high_risk_clinical");
  });

  it("a real patient, giving a medicine, acting now, personal safety and identifiable details stay high risk", () => {
    for (const q of [
      "My patient in bed 4 is septic, what should I do now",
      "Should I give 10 mg of morphine to him",
      "The patient is not breathing right now",
      "I want to hurt myself",
      "Patient NHS number 943 476 5919 has a fever, explain",
      "Her date of birth is 2 May 1950, what is wrong with her",
    ]) {
      expect(tier(after, q), q).toBe("high_risk_clinical");
    }
  });

  it("changes only the four topic rules' tier and adds two rules; ids are kept", () => {
    const b = base.rules, a = withScholarEducational(base).rules;
    expect(a.length).toBe(b.length + 2);
    for (const r of b) {
      const n = a.find((x: any) => x.id === r.id);
      if (STUDY_TOPIC_RULES[r.id]) expect([r.tier, n.tier]).toEqual(["high_risk_clinical", "clinical_educational"]);
      else expect(n).toEqual(r);
    }
    for (const id of SCHOLAR_HIGH_KEPT) expect(a.find((x: any) => x.id === id)?.tier).toBe("high_risk_clinical");
  });

  it("refuses a policy without the 29 Oct high-risk rules, and is idempotent", () => {
    expect(() => withScholarEducational({ rules: [] })).toThrow(/high-risk rules/);
    const once = withScholarEducational(base);
    expect(withScholarEducational(once)).toEqual(once);
  });
});
