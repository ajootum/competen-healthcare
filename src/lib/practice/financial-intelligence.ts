import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { paymentsOverview } from "@/lib/practice/billing";
import { METRIC_REGISTRY, LOW_DENOMINATOR_FLOOR } from "@/lib/practice/intelligence-registry";

// CPR-PAY-001 s17 (Phase 3) under CPR-PI-001 v2 -- the financial intelligence module.
//
// DESCRIPTIVE AND SECONDARY, the spec's own words: it exists only because reliable transaction
// capture now does (303/304), and every figure here is the Payments workspace's own arithmetic
// re-read, never a second computation that can drift from the first.
//
// ⚠ THE LANGUAGE GUARDRAILS ARE PAY-001 s17's, VERBATIM: charges are never called income received,
// and facility-collected amounts are never called received until settlement. s16 of PI v2 adds the
// delta rule -- a period-over-period percentage DESCRIBES VOLUME and never judges performance, and
// it is withheld entirely under the low-denominator rule rather than shouting +300% over four
// consultations.
//
// ⚠ GATED ON billing.view, NOT report.view. PAY-001 s18: financial permissions are distinct from
// clinical ones, and the intelligence page's own report.view gate does not imply money access.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FinancialIntelligence = {
  key: "financial";
  label: "Financial";
  available: boolean;
  unavailableReason: string | null;
  registry: string[];
  provenance: "Derived";
  data: {
    period: { fromDay: string; toDay: string };
    previous: { fromDay: string; toDay: string };
    byCurrency: {
      currency: string;
      charged: { minor: number; count: number };
      collected: { minor: number; count: number };
      received: { minor: number; directMinor: number; settledMinor: number };
      collectedByOthersMinor: number;
      outstandingInvoicedMinor: number;
      settlementReceivableMinor: number;
      settlementNeedsDecision: number;
      /** null when the previous period fails the low-denominator rule or had nothing to compare. */
      delta: {
        chargedMinor: number; collectedMinor: number; receivedMinor: number;
        chargedPct: number | null; collectedPct: number | null; receivedPct: number | null;
        previous: { chargedMinor: number; collectedMinor: number; receivedMinor: number; collectedCount: number };
      } | null;
    }[];
    serviceMix: { currency: string; label: string; count: number; minor: number; ofCount: number }[];
    locationMix: { currency: string; label: string; count: number; minor: number; ofCount: number }[];
  } | null;
};

const unavailable = (reason: string): FinancialIntelligence => ({
  key: "financial", label: "Financial", available: false, unavailableReason: reason,
  registry: METRIC_REGISTRY.filter(m => m.metricId.startsWith("fin.")).map(m => m.metricId),
  provenance: "Derived", data: null,
});

/** The immediately preceding equal-length period -- PI v2 s5's default comparison. */
export function precedingPeriod(fromDay: string, toDay: string): { fromDay: string; toDay: string } {
  const from = Date.parse(fromDay + "T00:00:00Z");
  const to = Date.parse(toDay + "T00:00:00Z");
  const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { fromDay: iso(from - days * 86400000), toDay: iso(from - 86400000) };
}

export async function financialIntelligence(admin: any, ctx: WorkspaceContext, range: {
  fromDay: string; toDay: string;
}): Promise<FinancialIntelligence> {
  if (!hasCapability(ctx, "billing.view"))
    return unavailable("Financial figures need billing.view -- financial permissions are separate from clinical ones (CPR-PAY-001 s18), and holding the intelligence page does not imply holding the money.");

  const previous = precedingPeriod(range.fromDay, range.toDay);
  // paymentsOverview twice (this period and the preceding equal one) -- the SAME arithmetic the
  // Payments workspace shows, so intelligence and the workspace cannot disagree about one figure.
  // The settlement receivable rides in on the overview, which computes it through
  // facilityReceivables itself.
  const [now, prior] = await Promise.all([
    paymentsOverview(admin, ctx, { fromDay: range.fromDay, toDay: range.toDay }),
    paymentsOverview(admin, ctx, { fromDay: previous.fromDay, toDay: previous.toDay }),
  ]);
  if (!now.permitted) return unavailable("The billing read was not permitted.");
  if (now.unavailable)
    return unavailable(`The billing figures could not be read: ${now.detail}. This is not a statement that nothing was charged.`);

  // Service and location mix need the charges themselves, grouped -- one bounded read. charged_on is
  // a practice-calendar DATE, so day bounds compare directly with no timezone arithmetic.
  const { data: chargeRows, error: chargeErr } = await admin.from("practice_charge")
    .select("amount_minor, currency, location_id, service_fee_id, fee_snapshot, source, charged_on")
    .eq("workspace_id", ctx.workspaceId)
    .gte("charged_on", range.fromDay).lte("charged_on", range.toDay).limit(1000);
  if (chargeErr)
    return unavailable(`The charge breakdown could not be read: ${chargeErr.message}`);
  const charges = (chargeRows ?? []) as any[];

  const feeIds = [...new Set(charges.map(c => c.service_fee_id).filter(Boolean))];
  const { data: fees } = feeIds.length
    ? await admin.from("practice_service_fee").select("id, service_type").in("id", feeIds)
    : { data: [] };
  const typeOf = new Map(((fees ?? []) as any[]).map(f => [f.id, f.service_type]));
  const { data: locs } = await admin.from("practice_location")
    .select("id, name").eq("workspace_id", ctx.workspaceId);
  const locName = new Map(((locs ?? []) as any[]).map(l => [l.id, l.name]));

  const mix = (keyOf: (c: any) => string) => {
    const groups = new Map<string, { currency: string; label: string; count: number; minor: number }>();
    for (const c of charges) {
      const label = keyOf(c);
      const k = `${c.currency}|${label}`;
      const g = groups.get(k) ?? { currency: c.currency, label, count: 0, minor: 0 };
      g.count += 1; g.minor += c.amount_minor;
      groups.set(k, g);
    }
    const perCurrencyTotal = new Map<string, number>();
    for (const g of groups.values())
      perCurrencyTotal.set(g.currency, (perCurrencyTotal.get(g.currency) ?? 0) + g.count);
    // ofCount IS the denominator, on every row -- PI v2 s19's rule carried in the shape itself.
    return [...groups.values()]
      .map(g => ({ ...g, ofCount: perCurrencyTotal.get(g.currency) ?? g.count }))
      .sort((a, b) => b.minor - a.minor);
  };

  const priorBy = new Map((prior.permitted && !prior.unavailable ? prior.byCurrency : []).map((c: any) => [c.currency, c]));
  const byCurrency = now.byCurrency.map((c: any) => {
    const prev = priorBy.get(c.currency);
    // The registry's own nullHandling for fin.period_delta: no previous-period ACTIVITY means no
    // delta at all. The overview's currency list includes currencies whose only rows are the
    // always-full invoice/receivable reads, so a prior group EXISTING is not a prior period HAPPENING
    // -- the harness caught a hollow all-zero comparison being built exactly that way (FIN-3).
    const p = prev && (prev.chargedCount > 0 || prev.collectedCount > 0) ? prev : undefined;
    // s16/s22: a delta exists only against a real previous period, and its PERCENTAGE only where the
    // prior period is big enough to divide by honestly. Counts always speak; percentages earn it.
    const pct = (nowV: number, prevV: number, prevCount: number): number | null =>
      p && prevV > 0 && prevCount >= LOW_DENOMINATOR_FLOOR
        ? Math.round(((nowV - prevV) / prevV) * 100) : null;
    return {
      currency: c.currency,
      charged: { minor: c.chargedMinor, count: c.chargedCount },
      collected: { minor: c.collectedMinor, count: c.collectedCount },
      received: { minor: c.receivedByPractitionerMinor, directMinor: c.collectedDirectlyMinor, settledMinor: c.settledToPractitionerMinor },
      collectedByOthersMinor: c.collectedByOthersMinor,
      outstandingInvoicedMinor: c.outstandingInvoicedMinor,
      settlementReceivableMinor: c.outstandingSettlementMinor,
      settlementNeedsDecision: c.settlementNeedsDecision,
      delta: p ? {
        chargedMinor: c.chargedMinor - p.chargedMinor,
        collectedMinor: c.collectedMinor - p.collectedMinor,
        receivedMinor: c.receivedByPractitionerMinor - p.receivedByPractitionerMinor,
        chargedPct: pct(c.chargedMinor, p.chargedMinor, p.chargedCount),
        collectedPct: pct(c.collectedMinor, p.collectedMinor, p.collectedCount),
        receivedPct: pct(c.receivedByPractitionerMinor, p.receivedByPractitionerMinor, p.collectedCount),
        previous: {
          chargedMinor: p.chargedMinor, collectedMinor: p.collectedMinor,
          receivedMinor: p.receivedByPractitionerMinor, collectedCount: p.collectedCount,
        },
      } : null,
    };
  });

  return {
    key: "financial", label: "Financial", available: true, unavailableReason: null,
    registry: METRIC_REGISTRY.filter(m => m.metricId.startsWith("fin.")).map(m => m.metricId),
    provenance: "Derived",
    data: {
      period: { fromDay: range.fromDay, toDay: range.toDay },
      previous,
      byCurrency,
      serviceMix: mix(c => c.service_fee_id
        ? String(typeOf.get(c.service_fee_id) ?? c.fee_snapshot?.feeName ?? "other")
        : c.source === "manual" ? "manual" : c.source),
      locationMix: mix(c => c.location_id ? String(locName.get(c.location_id) ?? "former location") : "no location recorded"),
    },
  };
}
