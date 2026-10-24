import { describe, expect, it } from "vitest";
import { activityAt, addMonthsClamped, allowancePeriod, defaultPolicy, maxInputTokens, remainingBand, resolvePolicy, serviceLevel, type Balance } from "./fair-use-policy";

// AI-FAIR-USE-01, the pure decisions: one engine, a policy per product with its activities as data, levels from
// what remains, what each activity may do at each level, and the allowance period.

const bal = (used: number, included = 100, reserveUsed = 0, reserve = 10): Balance =>
  ({ includedCau: included, reserveCau: reserve, usedCau: used, reservedCau: 0, reserveUsedCau: reserveUsed, reserveReservedCau: 0 });
const ACTS = {
  explain: { label: "Explanations", tier: "reasoning", minTier: "cheap", clinicallySensitive: false },
  questions: { label: "Practice questions", tier: "reasoning", minTier: "reasoning", clinicallySensitive: true },
  deep: { label: "Deep dive", tier: "heavy", minTier: "reasoning", clinicallySensitive: false },
  clarify: { label: "Clarify", class: "essential", tier: "cheap", minTier: "cheap", clinicallySensitive: false, reserveEligible: true },
  recap: { label: "Recap", class: "essential", tier: "reasoning", minTier: "reasoning", clinicallySensitive: false, reserveEligible: true },
};
const scholar = resolvePolicy("scholar", { includedCau: 100, reserveCau: 10, levels: { optimisedBelowPct: 30, essentialBelowPct: 10 }, activities: ACTS }, "v1");

describe("AI fair use policy (shared by every product)", () => {
  it("the unpublished default allows nothing and offers no activity, so metering fails closed", () => {
    const d = defaultPolicy("scholar");
    expect(d.includedCau).toBe(0);
    expect(d.maxUnreconciledCau).toBe(0);
    expect(Object.keys(d.activities)).toEqual([]);
    expect(serviceLevel(d, bal(0, 0))).toBe("continuity");
  });

  it("Scholar and Professional resolve independently, each with only the activities its policy defines", () => {
    const pro = resolvePolicy("professional", { includedCau: 40, activities: { assistant: { label: "CPD" } } }, "p1");
    expect(scholar.includedCau).toBe(100);
    expect(pro.includedCau).toBe(40);
    expect(Object.keys(pro.activities)).toEqual(["assistant"]);
    expect(Object.keys(scholar.activities)).toContain("clarify");
  });

  it("clamps every value, drops invalid activity codes, and fails closed on what is unstated", () => {
    const p = resolvePolicy("scholar", { includedCau: -5, fxBufferPct: 400, activities: { "Bad Code": { tier: "heavy" }, x: {}, plain: { tier: "cheap", minTier: "heavy" }, std: { reserveEligible: true } } }, "v2");
    expect(p.includedCau).toBe(0);
    expect(p.fxBufferPct).toBe(100);
    expect(Object.keys(p.activities)).toEqual(["plain", "std"]);
    expect(p.activities.plain.minTier).toBe("cheap");
    expect(p.activities.plain.riskFloor).toBe("clinical_educational");
    expect(p.activities.std.reserveEligible).toBe(false);
  });

  it("an activity the policy does not define is refused as unknown", () => {
    expect(activityAt(scholar, "full", "invented", bal(0))).toMatchObject({ available: false, refusal: "unknown_activity" });
    expect(activityAt(scholar, "full", "constructor", bal(0)).refusal).toBe("unknown_activity");
  });

  it("levels follow what remains: full, optimised, essential, continuity", () => {
    expect([bal(0), bal(75), bal(95), bal(100)].map(b => serviceLevel(scholar, b))).toEqual(["full", "optimised", "essential", "continuity"]);
  });

  it("a cheaper level runs an activity only where the cheaper tier meets its floor, otherwise level_insufficient", () => {
    expect(activityAt(scholar, "full", "questions", bal(0))).toMatchObject({ available: true, tier: "reasoning", via: "included" });
    expect(activityAt(scholar, "optimised", "explain", bal(75)).tier).toBe("cheap");
    expect(activityAt(scholar, "optimised", "deep", bal(75))).toMatchObject({ available: true, tier: "reasoning" });
    expect(activityAt(scholar, "optimised", "questions", bal(75))).toMatchObject({ available: false, refusal: "level_insufficient", tier: null });
    expect(activityAt(scholar, "essential", "recap", bal(95))).toMatchObject({ available: false, refusal: "level_insufficient" });
  });

  it("essential keeps only essential activities, and continuity uses only the reserve while it lasts", () => {
    expect(activityAt(scholar, "essential", "explain", bal(95))).toMatchObject({ available: false, refusal: "allowance_exhausted" });
    expect(activityAt(scholar, "essential", "clarify", bal(95))).toMatchObject({ available: true, via: "included" });
    expect(activityAt(scholar, "continuity", "clarify", bal(100))).toMatchObject({ available: true, via: "reserve" });
    expect(activityAt(scholar, "continuity", "clarify", bal(100, 100, 10)).available).toBe(false);
    expect(activityAt(scholar, "continuity", "explain", bal(100)).available).toBe(false);
  });

  it("resets monthly on the subscription anniversary by default, on the last day where a month is shorter", () => {
    expect(scholar.reset.rule).toBe("subscription_anniversary");
    expect(addMonthsClamped(new Date("2026-01-31T09:00:00Z"), 1).toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(addMonthsClamped(new Date("2026-01-31T09:00:00Z"), 2).toISOString()).toBe("2026-03-31T09:00:00.000Z");
    const at = allowancePeriod(scholar, { startsAt: "2026-01-31T09:00:00Z", endsAt: null }, new Date("2026-03-15T00:00:00Z"));
    expect(at?.start.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(at?.end.toISOString()).toBe("2026-03-31T09:00:00.000Z");
    const edge = allowancePeriod(scholar, { startsAt: "2026-01-15T12:00:00Z", endsAt: null }, new Date("2026-02-15T11:59:59Z"));
    expect(edge?.start.toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(allowancePeriod(scholar, { startsAt: "2026-01-15T12:00:00Z", endsAt: "2026-02-01T00:00:00Z" }, new Date("2026-01-20T00:00:00Z"))?.end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("still supports a fixed cycle and the calendar month, inside the entitlement", () => {
    const p = resolvePolicy("scholar", { includedCau: 1, reset: { rule: "entitlement_cycle", cycleDays: 30 } }, "v");
    expect(allowancePeriod(p, { startsAt: "2026-01-01T00:00:00Z", endsAt: null }, new Date("2026-02-15T00:00:00Z"))?.start.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(allowancePeriod(p, { startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, new Date("2026-02-15T00:00:00Z"))).toBeNull();
    const month = resolvePolicy("scholar", { includedCau: 1, reset: { rule: "calendar_month" } }, "v");
    expect(allowancePeriod(month, { startsAt: "2026-01-20T00:00:00Z", endsAt: null }, new Date("2026-03-05T00:00:00Z"))?.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("a person sees a band, not units, and the input estimate is conservative", () => {
    expect(remainingBand(bal(95)).band).toBe("low");
    expect(remainingBand(bal(100)).band).toBe("none");
    expect(maxInputTokens("x".repeat(250), "y".repeat(250))).toBeGreaterThanOrEqual(200);
  });
});
