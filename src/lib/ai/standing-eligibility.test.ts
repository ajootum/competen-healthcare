import { describe, expect, it } from "vitest";
import { NOT_ELIGIBLE_REASON, withEligibility, type AiStanding, type EligibilityRow } from "./allowance";
import { resolvePolicy } from "./fair-use-policy";

// IND-004 found the defect: standing said questions and evaluate were "available via included" while every call was
// refused not_eligible. Standing must say what ai_reserve will do (411, 412): above standard educational, only an
// evaluated model for that activity, at that tier, is offered.

const policy = resolvePolicy("scholar", {
  includedCau: 4000, risk: { minTier: { standard_educational: "cheap", clinical_educational: "reasoning", high_risk_clinical: "reasoning" }, rules: [] },
  activities: {
    teach: { tier: "reasoning", minTier: "cheap", riskFloor: "standard_educational" },
    questions: { tier: "reasoning", minTier: "reasoning", riskFloor: "clinical_educational" },
    case_steps: { tier: "reasoning", minTier: "reasoning", riskFloor: "high_risk_clinical" },
    evaluate: { tier: "reasoning", minTier: "reasoning", riskFloor: "clinical_educational" },
  },
}, "v");
const b = { includedCau: 4000, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
const models = { cheap: "claude-haiku-4-5-20251001", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8" };
const all = (on: boolean): AiStanding => ({ readable: true, metered: true, level: "full", remaining: { band: "plenty", percent: 100 }, resetsAt: null, message: null,
  activities: Object.fromEntries(Object.keys(policy.activities).map(c => [c, { label: c, available: on, via: on ? "included" : null, reason: null }])) as AiStanding["activities"] });
const row = (activity: string, prefix: string, tier: string | null, eligible = true): EligibilityRow => ({ activity, provider: "anthropic", model_prefix: prefix, eligible, max_risk_tier: tier });

describe("standing reflects model eligibility", () => {
  it("THE DEFECT: with no eligibility decision, the clinical activities are not offered, and standard ones still are", () => {
    const s = withEligibility(all(true), policy, b, "anthropic", models, []);
    expect(s.activities.teach.available).toBe(true);
    for (const c of ["questions", "case_steps", "evaluate"]) expect(s.activities[c]).toMatchObject({ available: false, via: null, reason: NOT_ELIGIBLE_REASON });
  });

  it("an eligibility row for the model the tier resolves to, at the activity's tier or higher, makes it available", () => {
    const s = withEligibility(all(true), policy, b, "anthropic", models, [row("questions", "claude-sonnet-4-6", "clinical_educational"), row("case_steps", "claude-sonnet", "high_risk_clinical")]);
    expect(s.activities.questions.available).toBe(true);
    expect(s.activities.case_steps.available).toBe(true);
    expect(s.activities.evaluate.available).toBe(false);
  });

  it("a row for another model, a lower tier, another activity, or eligible false does not count", () => {
    const rows = [row("questions", "claude-opus-4-8", "high_risk_clinical"), row("case_steps", "claude-sonnet-4-6", "clinical_educational"),
      row("evaluate", "claude-sonnet-4-6", "clinical_educational", false), row("teach", "claude-sonnet-4-6", "high_risk_clinical")];
    const s = withEligibility(all(true), policy, b, "anthropic", models, rows);
    expect([s.activities.questions.available, s.activities.case_steps.available, s.activities.evaluate.available]).toEqual([false, false, false]);
  });

  it("an eligibility row naming no tier covers clinical educational, never high risk (as 411 reads it)", () => {
    const s = withEligibility(all(true), policy, b, "anthropic", models, [row("questions", "claude-sonnet-4-6", null), row("case_steps", "claude-sonnet-4-6", null)]);
    expect(s.activities.questions.available).toBe(true);
    expect(s.activities.case_steps.available).toBe(false);
  });

  it("fails closed: unreadable eligibility or no configured model closes the clinical activities", () => {
    expect(withEligibility(all(true), policy, b, "anthropic", models, null).activities.questions.available).toBe(false);
    expect(withEligibility(all(true), policy, b, null, models, [row("questions", "claude-sonnet-4-6", "clinical_educational")]).activities.questions.available).toBe(false);
    expect(withEligibility(all(true), policy, b, "anthropic", {}, [row("questions", "claude-sonnet-4-6", "clinical_educational")]).activities.questions.available).toBe(false);
  });

  it("never makes an unavailable activity available", () => {
    const s = withEligibility(all(false), policy, b, "anthropic", models, [row("questions", "claude-sonnet-4-6", "high_risk_clinical")]);
    expect(s.activities.questions.available).toBe(false);
  });
});
