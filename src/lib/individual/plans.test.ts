import { describe, it, expect } from "vitest";
import { validatePlan, isPlanRefusal } from "@/lib/individual/plans";
import { INDIVIDUAL_AI_HOURLY_DEFAULT } from "@/lib/individual/policy";

// P1 Commercial: an HQ plan body, checked against every CHECK migration 399 carries, before the database.

const good = { planCode: "scholar_month_ugx", experience: "scholar", name: "Scholar monthly", active: true, amount: 20000, currency: "ugx", intervalDays: 30 };

describe("validatePlan", () => {
  it("accepts a priced plan, storing the price in MINOR units through the currency table", () => {
    expect(validatePlan(good)).toEqual({ planCode: "scholar_month_ugx", experience: "scholar", name: "Scholar monthly", active: true,
      price: { amountMinor: 20000, currency: "UGX", intervalDays: 30 }, aiHourlyLimit: null });
    expect(validatePlan({ ...good, currency: "USD", amount: 9.99 })).toMatchObject({ price: { amountMinor: 999, currency: "USD" } });
  });
  it("refuses an active plan with no price -- 399's individual_plan_active_priced", () => {
    const r = validatePlan({ ...good, amount: undefined, currency: undefined, intervalDays: undefined });
    expect(isPlanRefusal(r) && r.code).toBe("PLAN_NOT_PRICED");
    expect(isPlanRefusal(validatePlan({ ...good, active: false, amount: undefined }))).toBe(false);
  });
  it("refuses an unknown currency, a zero price, a price finer than the currency, and a bad period", () => {
    expect(isPlanRefusal(validatePlan({ ...good, currency: "ZZZ" }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, amount: 0 }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, amount: 200.5 }))).toBe(true);          // UGX has no minor unit
    expect(isPlanRefusal(validatePlan({ ...good, currency: "USD", amount: 9.999 }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, intervalDays: 0 }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, intervalDays: 367 }))).toBe(true);
  });
  it("refuses a bad code, an unknown experience and an empty name", () => {
    expect(isPlanRefusal(validatePlan({ ...good, planCode: "Scholar Month" }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, experience: "enterprise" }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, name: "  " }))).toBe(true);
  });
  it("an AI limit is 1 to the Individual hard limit, or absent", () => {
    expect(validatePlan({ ...good, aiHourlyLimit: 12 })).toMatchObject({ aiHourlyLimit: 12 });
    expect(isPlanRefusal(validatePlan({ ...good, aiHourlyLimit: INDIVIDUAL_AI_HOURLY_DEFAULT + 1 }))).toBe(true);
    expect(isPlanRefusal(validatePlan({ ...good, aiHourlyLimit: 0 }))).toBe(true);
  });
});
