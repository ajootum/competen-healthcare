/* eslint-disable @typescript-eslint/no-explicit-any */

// ── HOLDINGS-FX-01: THE FX AND MARGIN POLICY ─────────────────────────────────────────────────────────────
//
// One CONFIG-002 document per product at scope {platform, holdings_finance}, edited as a draft and published
// as a version by the same engine as the AI fair-use policy (workspace_config_overrides / _versions / _audit).
// It holds targets and assumptions only. Nothing here changes a price, buys currency or limits a user: the
// policy decides what the Unit Economics page calls an exception and what it recommends, nothing more.
//
// THREE RATES, KEPT APART. The PLANNING rate is this document's budget rate (planningUgxPerUsd). The
// REFERENCE rate is the official published rate in ai_fx_rate (migration 410/412, Bank of Uganda). The
// ACTUAL rate is what Holdings really paid, from the conversions recorded in holdings_fx_event (migration
// 560). A margin is never computed at a rate without saying which one.
//
// ASSUMPTIONS ARE LABELLED. Where a measured figure exists (a plan price, paid checkouts, metered AI cost)
// it is used. Where it does not, the assumption below is used and the page says "assumption".

export type UnitEconomicsProduct = "scholar";
export const UNIT_ECONOMICS_PRODUCTS: readonly UnitEconomicsProduct[] = ["scholar"];
export const HOLDINGS_FINANCE_SCOPE = { scopeType: "platform", scopeRef: "holdings_finance" } as const;
export const unitEconomicsPath = (p: UnitEconomicsProduct) => `finance.unit_economics.${p}`;

export type UnitEconomicsPolicy = {
  product: UnitEconomicsProduct;
  version: string;                      // "unpublished" or the published version label
  published: boolean;
  planningUgxPerUsd: number | null;     // the budget rate; null = not set
  shocksPct: number[];                  // UGX depreciation scenarios, e.g. [10, 15, 25]
  marginFloorPct: number;               // contribution margin below this is an exception
  pricingReviewFxMovePct: number;       // reference vs planning move that triggers a pricing review
  reserveTargetMonths: number;          // USD reserve cover target, in months of provider cost
  providerBudgetUsdMonthly: number | null; // provider cost budget for this product, per month
  staleRateDays: number;                // a reference rate older than this is flagged
  executedRateWindowDays: number;       // window for the weighted actual rate
  measurementWindowDays: number;        // window for collections and consumption
  outlierMultiple: number;              // a user above this multiple of the median monthly cost is flagged
  outlierMinUsers: number;              // no outlier test below this many active users
  otherVariableCostUgxMonthly: number;  // hosting, support, messaging per subscriber per month
  assumed: {
    priceUgxMonthly: number | null;     // used only when no active plan exists
    gatewayFeePct: number;              // used only when no paid checkout carries a recorded fee
    aiCostUsdPerUserMonthly: number | null; // used only when no AI cost is measured in the window
  };
};

const clamp = (v: any, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const clampOrNull = (v: any, lo: number, hi: number) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** The unpublished default: no planning rate, no budget, the owner's three shocks, conservative thresholds. */
export function defaultUnitEconomicsPolicy(product: UnitEconomicsProduct): UnitEconomicsPolicy {
  return {
    product, version: "unpublished", published: false,
    planningUgxPerUsd: null, shocksPct: [10, 15, 25],
    marginFloorPct: 30, pricingReviewFxMovePct: 5, reserveTargetMonths: 3,
    providerBudgetUsdMonthly: null, staleRateDays: 35, executedRateWindowDays: 90,
    measurementWindowDays: 30, outlierMultiple: 5, outlierMinUsers: 5,
    otherVariableCostUgxMonthly: 0,
    assumed: { priceUgxMonthly: null, gatewayFeePct: 3.5, aiCostUsdPerUserMonthly: null },
  };
}

/** Pure: a settings document as a policy. Every value is clamped. Unknown keys are ignored. */
export function resolveUnitEconomicsPolicy(product: UnitEconomicsProduct, settings: any, version: string | null): UnitEconomicsPolicy {
  const d = defaultUnitEconomicsPolicy(product);
  if (!settings || typeof settings !== "object") return d;
  const shocks = Array.isArray(settings.shocksPct)
    ? [...new Set(settings.shocksPct.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0 && x <= 100))].sort((a: any, b: any) => a - b).slice(0, 8) as number[]
    : d.shocksPct;
  const a = settings.assumed ?? {};
  return {
    product, version: version ?? "unpublished", published: version != null,
    planningUgxPerUsd: clampOrNull(settings.planningUgxPerUsd, 1, 1_000_000),
    shocksPct: shocks.length ? shocks : d.shocksPct,
    marginFloorPct: clamp(settings.marginFloorPct, -100, 100, d.marginFloorPct),
    pricingReviewFxMovePct: clamp(settings.pricingReviewFxMovePct, 0.1, 100, d.pricingReviewFxMovePct),
    reserveTargetMonths: clamp(settings.reserveTargetMonths, 0, 36, d.reserveTargetMonths),
    providerBudgetUsdMonthly: clampOrNull(settings.providerBudgetUsdMonthly, 0, 10_000_000),
    staleRateDays: Math.round(clamp(settings.staleRateDays, 1, 366, d.staleRateDays)),
    executedRateWindowDays: Math.round(clamp(settings.executedRateWindowDays, 7, 730, d.executedRateWindowDays)),
    measurementWindowDays: Math.round(clamp(settings.measurementWindowDays, 7, 365, d.measurementWindowDays)),
    outlierMultiple: clamp(settings.outlierMultiple, 1.5, 100, d.outlierMultiple),
    outlierMinUsers: Math.round(clamp(settings.outlierMinUsers, 2, 10_000, d.outlierMinUsers)),
    otherVariableCostUgxMonthly: clamp(settings.otherVariableCostUgxMonthly, 0, 100_000_000, 0),
    assumed: {
      priceUgxMonthly: clampOrNull(a.priceUgxMonthly, 1, 100_000_000),
      gatewayFeePct: clamp(a.gatewayFeePct, 0, 50, d.assumed.gatewayFeePct),
      aiCostUsdPerUserMonthly: clampOrNull(a.aiCostUsdPerUserMonthly, 0, 10_000),
    },
  };
}

/** The settings document a form submits, validated. Returns a list of field errors, or the clean settings. */
export function validateUnitEconomicsSettings(input: any): { ok: true; settings: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const num = (k: string, v: any, lo: number, hi: number, optional = false) => {
    if (optional && (v === null || v === undefined || v === "")) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) { errors[k] = `Enter a number from ${lo} to ${hi}.`; return null; }
    return n;
  };
  const s = input ?? {};
  const shocks = String(s.shocksPct ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
  if (!shocks.length || shocks.some(x => !Number.isFinite(x) || x <= 0 || x > 100)) errors.shocksPct = "List one to eight percentages from 1 to 100, e.g. 10, 15, 25.";
  if (shocks.length > 8) errors.shocksPct = "At most eight scenarios.";
  const out = {
    planningUgxPerUsd: num("planningUgxPerUsd", s.planningUgxPerUsd, 1, 1_000_000, true),
    shocksPct: shocks,
    marginFloorPct: num("marginFloorPct", s.marginFloorPct, -100, 100),
    pricingReviewFxMovePct: num("pricingReviewFxMovePct", s.pricingReviewFxMovePct, 0.1, 100),
    reserveTargetMonths: num("reserveTargetMonths", s.reserveTargetMonths, 0, 36),
    providerBudgetUsdMonthly: num("providerBudgetUsdMonthly", s.providerBudgetUsdMonthly, 0, 10_000_000, true),
    staleRateDays: num("staleRateDays", s.staleRateDays, 1, 366),
    executedRateWindowDays: num("executedRateWindowDays", s.executedRateWindowDays, 7, 730),
    measurementWindowDays: num("measurementWindowDays", s.measurementWindowDays, 7, 365),
    outlierMultiple: num("outlierMultiple", s.outlierMultiple, 1.5, 100),
    outlierMinUsers: num("outlierMinUsers", s.outlierMinUsers, 2, 10_000),
    otherVariableCostUgxMonthly: num("otherVariableCostUgxMonthly", s.otherVariableCostUgxMonthly, 0, 100_000_000),
    assumed: {
      priceUgxMonthly: num("assumed.priceUgxMonthly", s.assumed?.priceUgxMonthly, 1, 100_000_000, true),
      gatewayFeePct: num("assumed.gatewayFeePct", s.assumed?.gatewayFeePct, 0, 50),
      aiCostUsdPerUserMonthly: num("assumed.aiCostUsdPerUserMonthly", s.assumed?.aiCostUsdPerUserMonthly, 0, 10_000, true),
    },
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings: out };
}
