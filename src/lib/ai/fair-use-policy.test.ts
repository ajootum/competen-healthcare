import { describe, expect, it } from "vitest";
import { activityAt, allowancePeriod, defaultPolicy, maxInputTokens, remainingBand, resolvePolicy, serviceLevel, type Balance } from "./fair-use-policy";

// AI-FAIR-USE-01, the pure decisions: one engine, a policy per product, levels from what remains, and what each
// activity may do at each level.

const bal = (used: number, included = 100, reserveUsed = 0, reserve = 10): Balance =>
  ({ includedCau: included, reserveCau: reserve, usedCau: used, reservedCau: 0, reserveUsedCau: reserveUsed, reserveReservedCau: 0 });
const scholar = resolvePolicy("scholar", { includedCau: 100, reserveCau: 10, levels: { optimisedBelowPct: 30, essentialBelowPct: 10 } }, "v1");

describe("AI fair use policy (shared by every product)", () => {
  it("the unpublished default allows nothing, so metering fails closed", () => {
    const d = defaultPolicy("scholar");
    expect(d.includedCau).toBe(0);
    expect(serviceLevel(d, bal(0, 0))).toBe("continuity");
  });

  it("Scholar and Professional resolve independently from the same engine", () => {
    const pro = resolvePolicy("professional", { includedCau: 40 }, "p1");
    expect(scholar.includedCau).toBe(100);
    expect(pro.includedCau).toBe(40);
    expect(Object.keys(pro.activities)).toEqual(["assistant", "map"]);
    expect(Object.keys(scholar.activities)).toContain("clarify");
  });

  it("clamps every value and cannot invent an activity or lower a clinically sensitive one", () => {
    const p = resolvePolicy("scholar", { includedCau: -5, activities: { questions: { tier: "cheap", minTier: "cheap" }, invented: { tier: "heavy" } } }, "v2");
    expect(p.includedCau).toBe(0);
    expect(p.activities.invented).toBeUndefined();
    expect(p.activities.questions.tier).toBe("reasoning");
    expect(p.activities.questions.minTier).toBe("reasoning");
  });

  it("levels follow what remains: full, optimised, essential, continuity", () => {
    expect([bal(0), bal(75), bal(95), bal(100)].map(b => serviceLevel(scholar, b))).toEqual(["full", "optimised", "essential", "continuity"]);
  });

  it("optimised uses efficient models except for clinically sensitive activities", () => {
    expect(activityAt(scholar, "optimised", "explain", bal(75)).tier).toBe("cheap");
    expect(activityAt(scholar, "optimised", "questions", bal(75)).tier).toBe("reasoning");
  });

  it("essential keeps only essential activities, and continuity uses only the reserve while it lasts", () => {
    expect(activityAt(scholar, "essential", "questions", bal(95)).available).toBe(false);
    expect(activityAt(scholar, "essential", "clarify", bal(95))).toMatchObject({ available: true, pool: "included" });
    expect(activityAt(scholar, "continuity", "clarify", bal(100))).toMatchObject({ available: true, pool: "reserve" });
    expect(activityAt(scholar, "continuity", "clarify", bal(100, 100, 10)).available).toBe(false);
    expect(activityAt(scholar, "continuity", "explain", bal(100)).available).toBe(false);
  });

  it("the allowance resets on its cycle, inside the entitlement", () => {
    const p = resolvePolicy("scholar", { includedCau: 1, reset: { rule: "entitlement_cycle", cycleDays: 30 } }, "v");
    const at = allowancePeriod(p, { startsAt: "2026-01-01T00:00:00Z", endsAt: null }, new Date("2026-02-15T00:00:00Z"));
    expect(at?.start.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(allowancePeriod(p, { startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, new Date("2026-02-15T00:00:00Z"))).toBeNull();
    const month = resolvePolicy("scholar", { includedCau: 1, reset: { rule: "calendar_month" } }, "v");
    expect(allowancePeriod(month, { startsAt: "2026-01-20T00:00:00Z", endsAt: null }, new Date("2026-03-05T00:00:00Z"))?.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("a person sees a band, not tokens, and the input estimate is conservative", () => {
    expect(remainingBand(bal(95)).band).toBe("low");
    expect(remainingBand(bal(100)).band).toBe("none");
    expect(maxInputTokens("x".repeat(250), "y".repeat(250))).toBeGreaterThanOrEqual(200);
  });
});
