// ── HOLDINGS-FX-01: SUBSCRIPTION UNIT ECONOMICS AND FX EXPOSURE (pure) ─────────────────────────────────────
//
// Pure: measured inputs and the published policy in, per-subscriber economics, depreciation scenarios,
// reserve cover and exceptions out. No I/O, no clock except the `now` it is given, no side effect. The
// loader (unit-economics-load.ts) gathers the inputs. Nothing here changes a price, buys currency or limits
// a user. An exception is a finding and a recommendation for a person to decide on.
//
// All money in the result is in MAJOR units (UGX shillings, US dollars). UGX has no minor unit.

import type { UnitEconomicsPolicy } from "./unit-economics-policy";

export type Basis = "measured" | "assumption" | "absent";
export type RateKind = "actual" | "reference" | "planning";

export type UnitEconomicsInputs = {
  now: Date;
  policy: UnitEconomicsPolicy;
  /** The active plan's price, normalised by the loader to 30 days. Null when no active plan exists. */
  planPriceUgxMonthly: number | null;
  /** Paid checkouts in the measurement window. Fee and net are null where the gateway figure was not recorded. */
  collections: { grossUgx: number; feeUgx: number | null; netUgx: number | null }[];
  /** People with live access in the window, and how many of them hold it through payment. */
  activeUsers: number;
  payingUsers: number;
  /** Provider cost in the window, USD, by person. Null when no cost record can be read. */
  aiCostUsdByUser: Map<string, number> | null;
  aiCostSource: "ledger" | "requests" | "none";
  /** Provider cost so far this calendar month, USD, for the budget test. */
  providerSpendMonthToDateUsd: number | null;
  reference: { ugxPerUsd: number; publishedOn: string | null; placeholder: boolean } | null;
  /** Weighted UGX per USD over the executed-rate window, from recorded conversions. */
  actual: { ugxPerUsd: number; conversions: number } | null;
  /** USD held, from the reserve ledger. Null when the ledger cannot be read. */
  reserveUsd: number | null;
};

export type Severity = "high" | "medium" | "info";
export type Exception = { code: string; severity: Severity; finding: string; recommendation: string };

export type Margins = {
  aiCostUgx: number;
  grossUgx: number;          // net receipt less provider cost
  contributionUgx: number;   // gross less other variable cost
  grossPct: number | null;   // of the price
  contributionPct: number | null;
};

export type Scenario = { shockPct: number; ugxPerUsd: number; margins: Margins; belowFloor: boolean };

export type UnitEconomics = {
  basisRate: { kind: RateKind; ugxPerUsd: number } | null;
  rates: { actual: number | null; reference: number | null; planning: number | null };
  perSubscriber: {
    price: { ugx: number | null; basis: Basis };
    gatewayFee: { ugx: number | null; pct: number | null; basis: Basis };
    net: { ugx: number | null };
    aiCost: { usd: number | null; basis: Basis };
    otherVariableUgx: number;
  };
  margins: { actual: Margins | null; reference: Margins | null; planning: Margins | null; basis: Margins | null };
  scenarios: Scenario[];
  breakEvenUgxPerUsd: number | null;
  reserve: { usd: number | null; monthlyProviderCostUsd: number | null; coverMonths: number | null; targetMonths: number; shortfallUsd: number | null };
  consumption: { users: number; medianUsdMonthly: number | null; outliers: number; topUsdMonthly: number | null };
  exceptions: Exception[];
};

// toPrecision first, so a half that binary floating point stores as 0.4999... still rounds up (63.75 -> 63.8).
const round = (n: number, dp = 0) => { const f = 10 ** dp; return Math.round(Number((n * f).toPrecision(12))) / f; };
const pct = (part: number, whole: number | null) => (whole && whole > 0 ? round((part / whole) * 100, 1) : null);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function marginsAt(price: number | null, net: number | null, aiCostUsd: number | null, other: number, ugxPerUsd: number): Margins | null {
  if (price == null || net == null || aiCostUsd == null) return null;
  const aiCostUgx = aiCostUsd * ugxPerUsd;
  const grossUgx = net - aiCostUgx;
  const contributionUgx = grossUgx - other;
  return {
    aiCostUgx: round(aiCostUgx), grossUgx: round(grossUgx), contributionUgx: round(contributionUgx),
    grossPct: pct(grossUgx, price), contributionPct: pct(contributionUgx, price),
  };
}

export function computeUnitEconomics(i: UnitEconomicsInputs): UnitEconomics {
  const p = i.policy;
  const monthScale = 30 / p.measurementWindowDays;
  const exceptions: Exception[] = [];

  // ── Rates. The basis for the headline margin is the rate Holdings actually paid, else the official one,
  // else the budget one. All three are always shown.
  const rates = { actual: i.actual?.ugxPerUsd ?? null, reference: i.reference?.ugxPerUsd ?? null, planning: p.planningUgxPerUsd };
  const basisRate = rates.actual != null ? { kind: "actual" as const, ugxPerUsd: rates.actual }
    : rates.reference != null ? { kind: "reference" as const, ugxPerUsd: rates.reference }
    : rates.planning != null ? { kind: "planning" as const, ugxPerUsd: rates.planning } : null;

  // ── Price.
  const price = i.planPriceUgxMonthly != null ? { ugx: i.planPriceUgxMonthly, basis: "measured" as Basis }
    : p.assumed.priceUgxMonthly != null ? { ugx: p.assumed.priceUgxMonthly, basis: "assumption" as Basis }
    : { ugx: null, basis: "absent" as Basis };

  // ── Gateway fee: measured from the checkouts that carry one, else the assumed percentage.
  const withFee = i.collections.filter(c => c.feeUgx != null && c.grossUgx > 0);
  const feePct = withFee.length
    ? round((withFee.reduce((n, c) => n + (c.feeUgx ?? 0), 0) / withFee.reduce((n, c) => n + c.grossUgx, 0)) * 100, 2)
    : p.assumed.gatewayFeePct;
  const feeBasis: Basis = withFee.length ? "measured" : "assumption";
  const feeUgx = price.ugx != null ? round(price.ugx * feePct / 100) : null;
  const netUgx = price.ugx != null && feeUgx != null ? price.ugx - feeUgx : null;

  // ── Provider cost per person per month.
  const perUser = i.aiCostUsdByUser ? [...i.aiCostUsdByUser.values()].map(v => v * monthScale) : [];
  const measuredTotal = perUser.reduce((n, v) => n + v, 0);
  const denom = Math.max(i.activeUsers, perUser.length);
  const aiCost = perUser.length && denom > 0 ? { usd: round(measuredTotal / denom, 4), basis: "measured" as Basis }
    : p.assumed.aiCostUsdPerUserMonthly != null ? { usd: p.assumed.aiCostUsdPerUserMonthly, basis: "assumption" as Basis }
    : { usd: null, basis: "absent" as Basis };

  const other = p.otherVariableCostUgxMonthly;
  const m = (r: number | null) => (r == null ? null : marginsAt(price.ugx, netUgx, aiCost.usd, other, r));
  const margins = { actual: m(rates.actual), reference: m(rates.reference), planning: m(rates.planning), basis: m(basisRate?.ugxPerUsd ?? null) };

  // ── Depreciation scenarios on the basis rate.
  const scenarios: Scenario[] = basisRate ? p.shocksPct.map(s => {
    const r = basisRate.ugxPerUsd * (1 + s / 100);
    const mm = marginsAt(price.ugx, netUgx, aiCost.usd, other, r);
    return mm ? { shockPct: s, ugxPerUsd: round(r, 2), margins: mm, belowFloor: (mm.contributionPct ?? -Infinity) < p.marginFloorPct } : null;
  }).filter((x): x is Scenario => x != null) : [];

  const breakEvenUgxPerUsd = netUgx != null && aiCost.usd != null && aiCost.usd > 0 ? round((netUgx - other) / aiCost.usd, 2) : null;

  // ── Reserve cover. Monthly provider cost: measured this window, else projected from the per-person figure.
  const monthlyProviderCostUsd = perUser.length ? round(measuredTotal, 2)
    : aiCost.usd != null && i.activeUsers > 0 ? round(aiCost.usd * i.activeUsers, 2) : null;
  const coverMonths = i.reserveUsd != null && monthlyProviderCostUsd && monthlyProviderCostUsd > 0 ? round(i.reserveUsd / monthlyProviderCostUsd, 1) : null;
  const shortfallUsd = i.reserveUsd != null && monthlyProviderCostUsd != null
    ? Math.max(0, round(p.reserveTargetMonths * monthlyProviderCostUsd - i.reserveUsd, 2)) : null;

  // ── Consumption distribution (counts and amounts only, never identities).
  const med = median(perUser);
  const outliers = med != null && med > 0 && perUser.length >= p.outlierMinUsers ? perUser.filter(v => v > p.outlierMultiple * med).length : 0;
  const top = perUser.length ? round(Math.max(...perUser), 4) : null;

  // ── Exceptions. Findings and recommendations only.
  const fmt = (n: number) => Math.round(n).toLocaleString("en-UG");
  if (!basisRate) exceptions.push({ code: "no_rate", severity: "high", finding: "No exchange rate is available: no conversion is recorded, no reference rate is set and no planning rate is published.", recommendation: "Set the reference rate on the AI Fair Use page, or publish a planning rate here." });
  if (i.reference?.placeholder) exceptions.push({ code: "placeholder_rate", severity: "medium", finding: "The reference rate is a placeholder, not an official published rate.", recommendation: "Record the official Bank of Uganda rate with its source on the AI Fair Use page." });
  if (i.reference?.publishedOn) {
    const age = (i.now.getTime() - new Date(i.reference.publishedOn).getTime()) / 86400000;
    if (age > p.staleRateDays) exceptions.push({ code: "stale_rate", severity: "medium", finding: `The reference rate was published ${Math.floor(age)} days ago (limit ${p.staleRateDays}).`, recommendation: "Update the reference rate from the latest official publication." });
  }
  if (rates.reference != null && rates.planning != null) {
    const move = ((rates.reference - rates.planning) / rates.planning) * 100;
    if (Math.abs(move) >= p.pricingReviewFxMovePct) exceptions.push({ code: "fx_move", severity: move > 0 ? "high" : "info", finding: `The reference rate is ${round(move, 1)}% ${move > 0 ? "weaker" : "stronger"} for UGX than the planning rate (${fmt(rates.reference)} vs ${fmt(rates.planning)} UGX per USD).`, recommendation: move > 0 ? "Review the subscription price and the planning rate. No price changes automatically." : "Consider whether the planning rate should be updated." });
  }
  if (rates.actual != null && rates.reference != null) {
    const spread = ((rates.actual - rates.reference) / rates.reference) * 100;
    if (spread >= p.pricingReviewFxMovePct) exceptions.push({ code: "execution_spread", severity: "medium", finding: `Recorded conversions cost ${round(spread, 1)}% more than the reference rate.`, recommendation: "Review the conversion channel and the bank's spread before the next purchase." });
  }
  if (price.basis === "absent") exceptions.push({ code: "no_price", severity: "info", finding: "No active Scholar plan and no assumed price, so margins cannot be computed.", recommendation: "Publish an assumed monthly price here to model margins before pricing goes live." });
  if (aiCost.basis === "absent") exceptions.push({ code: "no_cost", severity: "info", finding: "No AI cost is measured in the window and no assumed cost per user is published.", recommendation: "Publish an assumed monthly AI cost per user, or turn on metering when ready." });
  const bm = margins.basis;
  if (bm && bm.contributionPct != null && bm.contributionPct < p.marginFloorPct) exceptions.push({ code: "margin_floor", severity: "high", finding: `Contribution margin is ${bm.contributionPct}% at the ${basisRate!.kind} rate, below the ${p.marginFloorPct}% floor.`, recommendation: "Review the price, the fair-use allowance or provider routing. Nothing changes automatically, and no legitimate user is restricted." });
  const firstBreach = scenarios.find(s => s.belowFloor);
  if (bm && (bm.contributionPct ?? -Infinity) >= p.marginFloorPct && firstBreach) exceptions.push({ code: "shock_exposure", severity: "medium", finding: `A ${firstBreach.shockPct}% UGX depreciation would take contribution margin to ${firstBreach.margins.contributionPct}%, below the ${p.marginFloorPct}% floor.`, recommendation: "Hold USD reserve to the target and set a pricing-review trigger at this rate." });
  if (coverMonths != null && coverMonths < p.reserveTargetMonths) exceptions.push({ code: "reserve_low", severity: "high", finding: `USD reserve covers ${coverMonths} months of provider cost (target ${p.reserveTargetMonths}).`, recommendation: `Consider buying about USD ${round(shortfallUsd ?? 0, 2).toLocaleString("en-US")} to reach the target. Nothing is purchased automatically.` });
  if (i.reserveUsd == null) exceptions.push({ code: "reserve_unknown", severity: "info", finding: "The USD reserve ledger cannot be read.", recommendation: "Apply migration 560, then record the opening balance." });
  if (p.providerBudgetUsdMonthly != null && i.providerSpendMonthToDateUsd != null) {
    const day = i.now.getUTCDate();
    const days = new Date(Date.UTC(i.now.getUTCFullYear(), i.now.getUTCMonth() + 1, 0)).getUTCDate();
    const projected = round(i.providerSpendMonthToDateUsd * days / Math.max(1, day), 2);
    if (projected > p.providerBudgetUsdMonthly) exceptions.push({ code: "budget", severity: "high", finding: `Provider cost is projected at USD ${projected} this month, over the USD ${p.providerBudgetUsdMonthly} budget.`, recommendation: "Review routing and the fair-use allowance. Users are not restricted automatically." });
  }
  if (outliers > 0) exceptions.push({ code: "consumption_outliers", severity: "info", finding: `${outliers} ${outliers === 1 ? "person uses" : "people use"} more than ${p.outlierMultiple} times the median monthly AI cost.`, recommendation: "Check the fair-use policy against these patterns. Heavy legitimate use is not restricted by this page." });
  if (i.aiCostSource === "requests") exceptions.push({ code: "cost_estimate", severity: "info", finding: "AI cost comes from the request log's list-price estimate, because metering is off.", recommendation: "Treat cost per user as an estimate until metering records settled cost." });

  return {
    basisRate, rates,
    perSubscriber: { price, gatewayFee: { ugx: feeUgx, pct: price.ugx != null ? feePct : null, basis: feeBasis }, net: { ugx: netUgx }, aiCost, otherVariableUgx: other },
    margins, scenarios, breakEvenUgxPerUsd,
    reserve: { usd: i.reserveUsd, monthlyProviderCostUsd, coverMonths, targetMonths: p.reserveTargetMonths, shortfallUsd },
    consumption: { users: perUser.length, medianUsdMonthly: med != null ? round(med, 4) : null, outliers, topUsdMonthly: top },
    exceptions,
  };
}
