import { describe, expect, it } from "vitest";
import { computeUnitEconomics, type UnitEconomicsInputs } from "./unit-economics";
import { defaultUnitEconomicsPolicy, resolveUnitEconomicsPolicy, validateUnitEconomicsSettings } from "./unit-economics-policy";

const NOW = new Date("2026-10-26T12:00:00Z");
const policy = (s: Record<string, unknown> = {}) => resolveUnitEconomicsPolicy("scholar", {
  planningUgxPerUsd: 3700, shocksPct: [10, 15, 25], marginFloorPct: 50, pricingReviewFxMovePct: 5, reserveTargetMonths: 3,
  otherVariableCostUgxMonthly: 1000, measurementWindowDays: 30, ...s,
}, "v1");

const base = (o: Partial<UnitEconomicsInputs> = {}): UnitEconomicsInputs => ({
  now: NOW, policy: policy(), planPriceUgxMonthly: 20000,
  collections: [{ grossUgx: 20000, feeUgx: 700, netUgx: 19300 }],
  activeUsers: 2, payingUsers: 2,
  aiCostUsdByUser: new Map([["a", 1.5], ["b", 1.5]]), aiCostSource: "ledger",
  providerSpendMonthToDateUsd: null,
  reference: { ugxPerUsd: 3700, publishedOn: "2026-10-23", placeholder: false },
  actual: null, reserveUsd: 100,
  ...o,
});

describe("unit economics: per-subscriber margins", () => {
  it("computes net, provider cost and margins at the basis rate (hand-worked)", () => {
    const u = computeUnitEconomics(base());
    expect(u.basisRate).toEqual({ kind: "reference", ugxPerUsd: 3700 });
    expect(u.perSubscriber.gatewayFee).toMatchObject({ ugx: 700, pct: 3.5, basis: "measured" });
    expect(u.perSubscriber.net.ugx).toBe(19300);
    expect(u.perSubscriber.aiCost).toEqual({ usd: 1.5, basis: "measured" });
    // 1.5 USD x 3700 = 5550 provider cost. Gross 19300 - 5550 = 13750. Contribution 13750 - 1000 = 12750 = 63.8%.
    expect(u.margins.basis).toEqual({ aiCostUgx: 5550, grossUgx: 13750, contributionUgx: 12750, grossPct: 68.8, contributionPct: 63.8 });
  });

  it("models the owner's 10, 15 and 25 percent UGX depreciation shocks", () => {
    const u = computeUnitEconomics(base());
    expect(u.scenarios.map(s => [s.shockPct, s.ugxPerUsd, s.margins.aiCostUgx, s.margins.contributionUgx])).toEqual([
      [10, 4070, 6105, 12195], [15, 4255, 6383, 11918], [25, 4625, 6938, 11363],
    ]);
    // Break-even: (19300 - 1000) / 1.5 = 12200 UGX per USD.
    expect(u.breakEvenUgxPerUsd).toBe(12200);
  });

  it("keeps planning, reference and actual rates apart, and prefers actual for the basis", () => {
    const u = computeUnitEconomics(base({ actual: { ugxPerUsd: 3800, conversions: 2 } }));
    expect(u.rates).toEqual({ actual: 3800, reference: 3700, planning: 3700 });
    expect(u.basisRate?.kind).toBe("actual");
    expect(u.margins.actual?.aiCostUgx).toBe(5700);
    expect(u.margins.reference?.aiCostUgx).toBe(5550);
  });

  it("uses labelled assumptions only where nothing is measured", () => {
    const u = computeUnitEconomics(base({
      policy: policy({ assumed: { priceUgxMonthly: 15000, gatewayFeePct: 4, aiCostUsdPerUserMonthly: 2 } }),
      planPriceUgxMonthly: null, collections: [], aiCostUsdByUser: new Map(), aiCostSource: "none",
    }));
    expect(u.perSubscriber.price).toEqual({ ugx: 15000, basis: "assumption" });
    expect(u.perSubscriber.gatewayFee).toMatchObject({ ugx: 600, pct: 4, basis: "assumption" });
    expect(u.perSubscriber.aiCost).toEqual({ usd: 2, basis: "assumption" });
  });

  it("reports absence instead of inventing a margin", () => {
    const u = computeUnitEconomics(base({ planPriceUgxMonthly: null, collections: [], aiCostUsdByUser: null, aiCostSource: "none" }));
    expect(u.perSubscriber.price.basis).toBe("absent");
    expect(u.margins.basis).toBeNull();
    expect(u.scenarios).toEqual([]);
    expect(u.exceptions.map(e => e.code)).toEqual(expect.arrayContaining(["no_price", "no_cost"]));
  });
});

describe("unit economics: exceptions are findings, never actions", () => {
  const codes = (o: Partial<UnitEconomicsInputs>) => computeUnitEconomics(base(o)).exceptions.map(e => e.code);

  it("flags a margin below the floor", () => {
    expect(codes({ policy: policy({ marginFloorPct: 70 }) })).toContain("margin_floor");
  });

  it("flags shock exposure when today's margin holds but a scenario breaches the floor", () => {
    const c = codes({ policy: policy({ marginFloorPct: 60 }) });
    expect(c).toContain("shock_exposure");
    expect(c).not.toContain("margin_floor");
  });

  it("flags a reference move against the planning rate at the review threshold", () => {
    const c = codes({ reference: { ugxPerUsd: 3900, publishedOn: "2026-10-23", placeholder: false } });
    expect(c).toContain("fx_move");
  });

  it("flags a stale or placeholder reference rate", () => {
    expect(codes({ reference: { ugxPerUsd: 3700, publishedOn: "2026-08-01", placeholder: false } })).toContain("stale_rate");
    expect(codes({ reference: { ugxPerUsd: 3700, publishedOn: null, placeholder: true } })).toContain("placeholder_rate");
  });

  it("computes reserve cover and the shortfall to target, recommending without buying", () => {
    const u = computeUnitEconomics(base({ reserveUsd: 3 }));
    // Monthly provider cost 2 x 1.5 = 3 USD. Cover 1 month. Target 3 months = 9 USD, shortfall 6.
    expect(u.reserve).toMatchObject({ usd: 3, monthlyProviderCostUsd: 3, coverMonths: 1, shortfallUsd: 6 });
    const e = u.exceptions.find(x => x.code === "reserve_low")!;
    expect(e.recommendation).toMatch(/Nothing is purchased automatically/);
  });

  it("projects the month against the provider budget", () => {
    expect(codes({ policy: policy({ providerBudgetUsdMonthly: 10 }), providerSpendMonthToDateUsd: 9 })).toContain("budget");
    expect(codes({ policy: policy({ providerBudgetUsdMonthly: 100 }), providerSpendMonthToDateUsd: 9 })).not.toContain("budget");
  });

  it("counts consumption outliers without naming anyone, and never above the minimum population", () => {
    const heavy = new Map([["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 20]]);
    const u = computeUnitEconomics(base({ aiCostUsdByUser: heavy, activeUsers: 5 }));
    expect(u.consumption).toMatchObject({ users: 5, medianUsdMonthly: 1, outliers: 1, topUsdMonthly: 20 });
    expect(JSON.stringify(u.exceptions)).not.toMatch(/"e"/);
    const few = computeUnitEconomics(base({ aiCostUsdByUser: new Map([["a", 1], ["b", 30]]) }));
    expect(few.consumption.outliers).toBe(0);
  });

  it("no exception text claims an automatic change", () => {
    const u = computeUnitEconomics(base({ policy: policy({ marginFloorPct: 90, providerBudgetUsdMonthly: 1 }), providerSpendMonthToDateUsd: 5, reserveUsd: 0 }));
    for (const e of u.exceptions) expect(e.recommendation).not.toMatch(/\b(has been|was) (changed|purchased|restricted|blocked)\b/i);
  });
});

describe("unit economics policy", () => {
  it("defaults to the owner's shocks and fails safe when unpublished", () => {
    const d = defaultUnitEconomicsPolicy("scholar");
    expect(d).toMatchObject({ published: false, planningUgxPerUsd: null, shocksPct: [10, 15, 25], providerBudgetUsdMonthly: null });
    expect(resolveUnitEconomicsPolicy("scholar", null, null)).toEqual(d);
  });

  it("clamps and de-duplicates a published document", () => {
    const p = resolveUnitEconomicsPolicy("scholar", { shocksPct: [25, 10, 10, -5, 200], marginFloorPct: 999, staleRateDays: 0 }, "v2");
    expect(p).toMatchObject({ published: true, version: "v2", shocksPct: [10, 25], marginFloorPct: 100, staleRateDays: 1 });
  });

  it("validates a submitted form field by field", () => {
    const bad = validateUnitEconomicsSettings({ shocksPct: "10, abc", marginFloorPct: "x", pricingReviewFxMovePct: 5, reserveTargetMonths: 3, staleRateDays: 35, executedRateWindowDays: 90, measurementWindowDays: 30, outlierMultiple: 5, outlierMinUsers: 5, otherVariableCostUgxMonthly: 0, assumed: { gatewayFeePct: 3.5 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["marginFloorPct", "shocksPct"]);
    const good = validateUnitEconomicsSettings({ planningUgxPerUsd: "", shocksPct: "10 15 25", marginFloorPct: 40, pricingReviewFxMovePct: 5, reserveTargetMonths: 3, staleRateDays: 35, executedRateWindowDays: 90, measurementWindowDays: 30, outlierMultiple: 5, outlierMinUsers: 5, otherVariableCostUgxMonthly: 500, assumed: { gatewayFeePct: 3.5 } });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.settings).toMatchObject({ planningUgxPerUsd: null, shocksPct: [10, 15, 25] });
  });
});
