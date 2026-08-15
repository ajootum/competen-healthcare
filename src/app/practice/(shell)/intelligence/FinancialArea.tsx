import Link from "next/link";
import type { FinancialIntelligence } from "@/lib/practice/financial-intelligence";
import { formatMinor } from "@/lib/practice/billing-constants";
import { metricById } from "@/lib/practice/intelligence-registry";

// The Financial intelligence area -- CPR-PAY-001 s17 under CPR-PI-001 v2.
//
// EVERY PERCENTAGE ON THIS SCREEN ARRIVES WITH ITS DENOMINATOR IN REACH (v2 s19): a delta prints
// beside both periods' absolute figures, a mix proportion prints as "n of N". And every number
// ROUTES to Payments rather than growing actions here -- intelligence informs, Payments acts.

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white p-4";

function Delta({ label, nowMinor, deltaMinor, pct, prevMinor, currency }: {
  label: string; nowMinor: number; deltaMinor: number; pct: number | null; prevMinor: number; currency: string;
}) {
  // s16's line, held: the sentence describes VOLUME ("charged", "collected"), never performance --
  // and when the percentage is withheld by the low-denominator rule, the counts still speak.
  return (
    <p className="text-[11px] text-gray-600">
      {label} {deltaMinor === 0 ? "unchanged" : deltaMinor > 0 ? "up" : "down"}{" "}
      {deltaMinor !== 0 && <strong>{formatMinor(Math.abs(deltaMinor), currency)}</strong>}
      {pct !== null && deltaMinor !== 0 && <> ({pct > 0 ? "+" : ""}{pct}&#37;)</>}{" "}
      vs {formatMinor(prevMinor, currency)} in the previous period
      {pct === null && deltaMinor !== 0 && <span className="text-gray-400"> (too few prior records for a percentage)</span>}.
      <span className="sr-only">This period: {formatMinor(nowMinor, currency)}.</span>
    </p>
  );
}

export default function FinancialArea({ financial }: { financial: FinancialIntelligence }) {
  if (!financial.available || !financial.data) {
    return (
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">Financial</h2>
        <p className="mt-1 text-[12px] text-gray-600">{financial.unavailableReason}</p>
      </section>
    );
  }
  const d = financial.data;

  return (
    <div className="flex flex-col gap-3">
      {d.byCurrency.length === 0 ? (
        <section className={CARD}>
          <p className="text-[12px] text-gray-600">
            No qualifying billing records exist for {d.period.fromDay} to {d.period.toDay}. The read
            succeeded &mdash; this is a genuinely empty money picture for the period.
          </p>
        </section>
      ) : d.byCurrency.map(c => (
        <section key={c.currency} className={CARD}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{c.currency}</h2>
            <Link href="/practice/payments" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Act on this in Payments &rarr;
            </Link>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-500">Charged</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.charged.minor, c.currency)}</p>
              <p className="text-[10px] text-gray-500">{c.charged.count} charge{c.charged.count === 1 ? "" : "s"} &mdash; billed, not income received</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500">Collected</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.collected.minor, c.currency)}</p>
              <p className="text-[10px] text-gray-500">{c.collected.count} payment{c.collected.count === 1 ? "" : "s"}, by anyone</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500">Received by you</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.received.minor, c.currency)}</p>
              <p className="text-[10px] text-gray-500">
                {formatMinor(c.received.directMinor, c.currency)} direct
                {c.received.settledMinor > 0 ? ` + ${formatMinor(c.received.settledMinor, c.currency)} settled` : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500">Still owed</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.outstandingInvoicedMinor + c.settlementReceivableMinor, c.currency)}</p>
              <p className="text-[10px] text-gray-500">
                {formatMinor(c.outstandingInvoicedMinor, c.currency)} on invoices
                {c.settlementReceivableMinor > 0 ? ` + ${formatMinor(c.settlementReceivableMinor, c.currency)} from facilities` : ""}
                {c.settlementNeedsDecision > 0 ? ` (${c.settlementNeedsDecision} awaiting a share decision)` : ""}
              </p>
            </div>
          </div>
          {c.delta && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                Change vs {d.previous.fromDay} to {d.previous.toDay}
              </p>
              <div className="mt-1 flex flex-col gap-0.5">
                <Delta label="Charged" nowMinor={c.charged.minor} deltaMinor={c.delta.chargedMinor}
                  pct={c.delta.chargedPct} prevMinor={c.delta.previous.chargedMinor} currency={c.currency} />
                <Delta label="Collected" nowMinor={c.collected.minor} deltaMinor={c.delta.collectedMinor}
                  pct={c.delta.collectedPct} prevMinor={c.delta.previous.collectedMinor} currency={c.currency} />
                <Delta label="Received" nowMinor={c.received.minor} deltaMinor={c.delta.receivedMinor}
                  pct={c.delta.receivedPct} prevMinor={c.delta.previous.receivedMinor} currency={c.currency} />
              </div>
            </div>
          )}
        </section>
      ))}

      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Charges by service type</h3>
          {d.serviceMix.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No charges in this period.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {d.serviceMix.slice(0, 8).map((m, i) => (
                <li key={i} className="flex items-baseline gap-2 border-b border-gray-100 py-1 text-[12px] last:border-0">
                  <span className="text-gray-800">{m.label}</span>
                  <span className="text-[10px] text-gray-500">{m.count} of {m.ofCount} charges</span>
                  <span className="ml-auto font-semibold text-gray-900">{formatMinor(m.minor, m.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Charges by location</h3>
          {d.locationMix.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No charges in this period.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {d.locationMix.slice(0, 8).map((m, i) => (
                <li key={i} className="flex items-baseline gap-2 border-b border-gray-100 py-1 text-[12px] last:border-0">
                  <span className="text-gray-800">{m.label}</span>
                  <span className="text-[10px] text-gray-500">{m.count} of {m.ofCount} charges</span>
                  <span className="ml-auto font-semibold text-gray-900">{formatMinor(m.minor, m.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* v2 s5's provenance + the registry, visible: which definitions these figures answer to. */}
      <p className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 text-[11px] text-gray-500">
        <strong className="text-gray-600">Derived from your billing records.</strong> Every figure is
        defined in the metric registry ({financial.registry.map(id => metricById(id)?.displayName ?? id).join(", ")}),
        each with its own denominator and time field. Percentages describe volume, never performance,
        and are withheld where the previous period is too small to divide by honestly.
      </p>
    </div>
  );
}
