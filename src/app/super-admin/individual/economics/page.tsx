import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadUnitEconomics } from "@/lib/holdings/unit-economics-load";
import type { Basis, Margins } from "@/lib/holdings/unit-economics";
import { LedgerEntryForm, PolicyForm } from "./_components/EconomicsControls";

// /super-admin/individual/economics -- HOLDINGS-FX-01, Scholar first.
//
// Subscription unit economics and FX exposure for Competen Holdings: what a Scholar subscriber brings in,
// what serving them costs in USD, what that is in UGX at the planning, reference and actual rates, what a
// 10, 15 or 25 percent depreciation would do, how long the USD reserve lasts, and what needs a decision.
//
// Guarded by hq.individual.commercial.manage, the owner-only financial right. Reads only HQ-plane and
// Individual tables (no practice_* table, so the plane boundary does not govern it).
// ⚠ NOTHING ON THIS PAGE CHANGES A PRICE, BUYS CURRENCY OR LIMITS A USER. Exceptions are findings and
// recommendations for a person to decide on.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scholar unit economics" };

const ugx = (n: number | null | undefined) => (n == null ? "—" : `UGX ${Math.round(n).toLocaleString("en-UG")}`);
const usd = (n: number | null | undefined, dp = 2) => (n == null ? "—" : `USD ${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const pctTxt = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const rate = (n: number | null | undefined) => (n == null ? "Not available" : `${n.toLocaleString("en-UG", { maximumFractionDigits: 2 })} UGX per USD`);

const BASIS: Record<Basis, { label: string; cls: string }> = {
  measured: { label: "Measured", cls: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" },
  assumption: { label: "Assumption", cls: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" },
  absent: { label: "Not available", cls: "bg-gray-100 text-gray-600" },
};
const SEV: Record<string, string> = {
  high: "border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  medium: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  info: "border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] text-blue-900",
};

function Chip({ b }: { b: Basis }) {
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BASIS[b].cls}`}>{BASIS[b].label}</span>;
}

function MarginRow({ label, m }: { label: string; m: Margins | null }) {
  return (
    <tr className="border-t border-gray-100">
      <th scope="row" className="py-2 pr-3 text-left font-semibold text-gray-800">{label}</th>
      <td className="py-2 pr-3 tabular-nums">{m ? ugx(m.aiCostUgx) : "—"}</td>
      <td className="py-2 pr-3 tabular-nums">{m ? `${ugx(m.grossUgx)} (${pctTxt(m.grossPct)})` : "—"}</td>
      <td className="py-2 tabular-nums">{m ? `${ugx(m.contributionUgx)} (${pctTxt(m.contributionPct)})` : "—"}</td>
    </tr>
  );
}

export default async function ScholarEconomicsPage() {
  const ctx = await requireHqCapability("hq.individual.commercial.manage");
  const v = await loadUnitEconomics(ctx.admin, "scholar");
  const e = v.economics;
  const ps = e.perSubscriber;
  const card = "rounded-xl border border-gray-200 bg-white p-4";
  const h2 = "text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500";

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Scholar</p>
        <h1 className="text-xl font-bold text-gray-900">Unit economics and FX exposure</h1>
        <p className="mt-1 text-sm text-gray-600">
          What a Scholar subscriber brings in, what serving them costs in US dollars, and what that means in shillings at the planning,
          reference and actual exchange rates. Figures are per subscriber per 30 days.
        </p>
        <p className="mt-2 rounded-lg border border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] px-3 py-2 text-[13px] text-blue-900">
          This page never changes a price, buys currency or limits anyone. It shows findings and recommendations for a person to decide on.
        </p>
      </header>

      <section aria-labelledby="exc-h" className="space-y-2">
        <h2 id="exc-h" className={h2}>Exceptions and recommendations ({e.exceptions.length})</h2>
        {e.exceptions.length === 0
          ? <p className={`${card} text-sm text-gray-700`}>No exceptions against the published policy.</p>
          : <ul className="space-y-2">{e.exceptions.map(x => (
              <li key={x.code} className={`rounded-lg border px-3 py-2 text-[13.5px] ${SEV[x.severity]}`}>
                <p className="font-semibold">{x.finding}</p>
                <p className="mt-0.5">{x.recommendation}</p>
              </li>))}
            </ul>}
      </section>

      <section aria-labelledby="rate-h" className="space-y-2">
        <h2 id="rate-h" className={h2}>Exchange rates</h2>
        <dl className={`${card} grid gap-3 text-[13.5px] md:grid-cols-3`}>
          <div><dt className="text-[12px] font-semibold text-gray-500">Actual (what Holdings paid)</dt><dd className="font-semibold text-gray-900">{rate(e.rates.actual)}</dd>
            <dd className="text-[12px] text-gray-500">{v.ledger?.summary.actual ? `Weighted over ${v.ledger.summary.actual.conversions} conversion(s), last ${v.policy.executedRateWindowDays} days` : "No conversion recorded in the window"}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Reference (official)</dt><dd className="font-semibold text-gray-900">{rate(e.rates.reference)}</dd>
            <dd className="text-[12px] text-gray-500">Set on the <a className="underline" href="/super-admin/ai/fair-use">AI Fair Use</a> page</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Planning (budget)</dt><dd className="font-semibold text-gray-900">{rate(e.rates.planning)}</dd>
            <dd className="text-[12px] text-gray-500">From the published policy below</dd></div>
        </dl>
        <p className="text-[12.5px] text-gray-600">Margins below use the <strong>{e.basisRate ? e.basisRate.kind : "no"}</strong> rate{e.basisRate ? ` (${rate(e.basisRate.ugxPerUsd)})` : ""}: actual if recorded, else reference, else planning.</p>
      </section>

      <section aria-labelledby="unit-h" className="space-y-2">
        <h2 id="unit-h" className={h2}>Per subscriber, per 30 days</h2>
        <dl className={`${card} grid gap-3 text-[13.5px] md:grid-cols-2`}>
          <div><dt className="text-[12px] font-semibold text-gray-500">Price<Chip b={ps.price.basis} /></dt><dd className="font-semibold">{ugx(ps.price.ugx)}</dd>
            <dd className="text-[12px] text-gray-500">{v.plan ? `${v.plan.name}: ${ugx(v.plan.amountUgx)} per ${v.plan.intervalDays} days` : "No active UGX Scholar plan"}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Gateway fee<Chip b={ps.gatewayFee.basis} /></dt><dd className="font-semibold">{ugx(ps.gatewayFee.ugx)} {ps.gatewayFee.pct != null ? `(${ps.gatewayFee.pct}%)` : ""}</dd>
            <dd className="text-[12px] text-gray-500">{v.collections.withFee ? `From ${v.collections.withFee} paid checkout(s) with a recorded fee` : "No paid checkout carries a recorded fee yet"}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Net receipt</dt><dd className="font-semibold">{ugx(ps.net.ugx)}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">AI provider cost<Chip b={ps.aiCost.basis} /></dt><dd className="font-semibold">{usd(ps.aiCost.usd, 4)}</dd>
            <dd className="text-[12px] text-gray-500">{v.aiCostSource === "ledger" ? "Settled cost from metering" : v.aiCostSource === "requests" ? "List-price estimate from the request log (metering is off)" : "No AI cost measured in the window"}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Other variable cost</dt><dd className="font-semibold">{ugx(ps.otherVariableUgx)}</dd>
            <dd className="text-[12px] text-gray-500">Hosting, support and messaging, from the policy</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">People</dt><dd className="font-semibold">{v.users.active} with live Scholar access, {v.users.paying} paying</dd>
            <dd className="text-[12px] text-gray-500">{v.collections.paid} paid checkout(s), {ugx(v.collections.grossUgx)} collected in the last {v.policy.measurementWindowDays} days</dd></div>
        </dl>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[520px] text-[13.5px]">
            <caption className="pb-2 text-left text-[12px] font-semibold text-gray-500">Margins at each rate</caption>
            <thead><tr className="text-left text-[12px] text-gray-500"><th scope="col" className="pb-1">Rate</th><th scope="col" className="pb-1">AI cost</th><th scope="col" className="pb-1">Gross margin</th><th scope="col" className="pb-1">Contribution margin</th></tr></thead>
            <tbody>
              <MarginRow label="Actual" m={e.margins.actual} />
              <MarginRow label="Reference" m={e.margins.reference} />
              <MarginRow label="Planning" m={e.margins.planning} />
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="sc-h" className="space-y-2">
        <h2 id="sc-h" className={h2}>UGX depreciation scenarios</h2>
        {e.scenarios.length === 0
          ? <p className={`${card} text-sm text-gray-700`}>Scenarios need a rate, a price and an AI cost (measured or assumed). See the exceptions above.</p>
          : <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead><tr className="text-left text-[12px] text-gray-500"><th scope="col" className="pb-1">Shock</th><th scope="col" className="pb-1">Rate</th><th scope="col" className="pb-1">AI cost</th><th scope="col" className="pb-1">Contribution margin</th></tr></thead>
                <tbody>{e.scenarios.map(s => (
                  <tr key={s.shockPct} className="border-t border-gray-100">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold">+{s.shockPct}%</th>
                    <td className="py-2 pr-3 tabular-nums">{s.ugxPerUsd.toLocaleString("en-UG")}</td>
                    <td className="py-2 pr-3 tabular-nums">{ugx(s.margins.aiCostUgx)}</td>
                    <td className={`py-2 tabular-nums ${s.belowFloor ? "font-semibold text-[var(--cmp-text-critical)]" : ""}`}>{ugx(s.margins.contributionUgx)} ({pctTxt(s.margins.contributionPct)}){s.belowFloor ? " · below floor" : ""}</td>
                  </tr>))}
                </tbody>
              </table>
              <p className="mt-2 text-[12.5px] text-gray-600">Break-even rate: {rate(e.breakEvenUgxPerUsd)}. Above it, each subscriber costs more to serve than they bring in.</p>
            </div>}
      </section>

      <section aria-labelledby="res-h" className="space-y-2">
        <h2 id="res-h" className={h2}>USD reserve</h2>
        <dl className={`${card} grid gap-3 text-[13.5px] md:grid-cols-4`}>
          <div><dt className="text-[12px] font-semibold text-gray-500">Held</dt><dd className="font-semibold">{v.ledger ? usd(e.reserve.usd) : "Ledger not available"}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Provider cost per month</dt><dd className="font-semibold">{usd(e.reserve.monthlyProviderCostUsd)}</dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Cover</dt><dd className="font-semibold">{e.reserve.coverMonths == null ? "—" : `${e.reserve.coverMonths} months`} <span className="font-normal text-gray-500">(target {e.reserve.targetMonths})</span></dd></div>
          <div><dt className="text-[12px] font-semibold text-gray-500">Consumption</dt><dd className="font-semibold">{e.consumption.users} user(s), median {usd(e.consumption.medianUsdMonthly, 4)}</dd>
            <dd className="text-[12px] text-gray-500">{e.consumption.outliers} above {v.policy.outlierMultiple}× median</dd></div>
        </dl>
        {v.ledger && v.ledger.rows.length > 0 && (
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[640px] text-[13px]">
              <caption className="pb-2 text-left text-[12px] font-semibold text-gray-500">Ledger, newest first ({v.ledger.summary.entries} live, {v.ledger.summary.voided} voided)</caption>
              <thead><tr className="text-left text-[12px] text-gray-500"><th scope="col">Date</th><th scope="col">What</th><th scope="col">Out</th><th scope="col">In</th><th scope="col">Reference</th><th scope="col">Entry</th></tr></thead>
              <tbody>{v.ledger.rows.map(r => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2">{r.occurred_at.slice(0, 10)}</td>
                  <td className="py-1.5 pr-2">{r.kind.replace("_", " ")}{r.counterparty ? ` · ${r.counterparty}` : ""}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{r.from_currency ? `${r.from_currency} ${r.from_amount_minor}` : ""}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{r.to_currency ? `${r.to_currency} ${r.to_amount_minor}` : ""}</td>
                  <td className="py-1.5 pr-2">{r.source_ref}</td>
                  <td className="py-1.5 font-mono text-[11px] text-gray-500">{r.id.slice(0, 8)}{r.voids_id ? ` voids ${r.voids_id.slice(0, 8)}` : ""}</td>
                </tr>))}
              </tbody>
            </table>
            <p className="mt-1 text-[11.5px] text-gray-500">Amounts are in each currency&apos;s smallest unit (UGX shillings, US cents).</p>
          </div>)}
        {v.ledger
          ? <LedgerEntryForm entries={v.ledger.rows.filter(r => r.kind !== "void").map(r => ({ id: r.id, label: `${r.occurred_at.slice(0, 10)} ${r.kind.replace("_", " ")} ${r.source_ref}` }))} />
          : <p className={`${card} text-sm text-gray-700`}>The reserve ledger is not available yet. It arrives with migration 560.</p>}
      </section>

      <section aria-labelledby="pol-h" className="space-y-2">
        <h2 id="pol-h" className={h2}>Policy · {v.policy.published ? `published ${v.policy.version}` : "not published (defaults apply)"}{v.draftDiffers ? " · unpublished draft" : ""}</h2>
        <PolicyForm initial={v.draft ?? (v.policy.published ? v.policy : null)} defaults={v.policy} canPublish={!!v.draft} />
      </section>
    </div>
  );
}
