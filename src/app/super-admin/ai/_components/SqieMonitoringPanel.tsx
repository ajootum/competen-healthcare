import type { SqieSummary } from "@/lib/ai/sqie-monitoring";
import type { CostFigure, SqieCost } from "@/lib/ai/sqie-cost";

// SCHOLAR QUESTION INTELLIGENCE ENGINE, MEASURED -- SQIE-COMPLETE-01. Per format over the window: what was generated,
// kept and rejected (and why), how often blind verification failed, latency, cost and cost per accepted question, how the
// governed library is reused, and how many legacy exam papers were rechecked. Codes and counts only: no learner, no
// question text. A figure with no data says "No data yet" and is never shown as zero.

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "No data yet";
const num = (n: number | null) => (n == null ? NONE : n.toLocaleString());
const pct = (n: number | null) => (n == null ? NONE : `${n}%`);
const ms = (n: number | null) => (n == null ? NONE : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const money = (n: number | null) => (n == null ? NONE : `$${n.toFixed(n < 1 ? 4 : 2)}`);
const REASON = (r: string) => r.replace(/_/g, " ");

/** SQIE-CLOSE-2026-11 WS-G: one cost figure from the ledger, or why there is none (metering off is no data, never $0). */
function Cost({ label, f, basis }: { label: string; f: CostFigure; basis?: string }) {
  return (
    <div>
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-semibold tabular-nums text-gray-900">{f.measured ? `${money(f.per)} (${money(f.usd)} over ${f.n.toLocaleString()})` : <span className="font-normal text-gray-700">{f.reason}</span>}</dd>
      {f.measured && basis && <dd className="text-[11px] text-gray-500">{basis}</dd>}
    </div>
  );
}

export default function SqieMonitoringPanel({ s, cost }: { s: SqieSummary; cost?: SqieCost }) {
  return (
    <section aria-labelledby="sqie-h" className="space-y-3">
      <div>
        <h2 id="sqie-h" className="font-semibold text-gray-900 text-[15px]">Scholar question engine <span className="text-[10px] text-gray-500">last {s.days} days · by format</span></h2>
        <p className="text-xs text-gray-500">Generated, kept and rejected questions, blind-verification failures, latency and cost, library reuse and legacy paper rechecks. Aggregates only: no learner, no question text.</p>
      </div>
      {!s.outcomesMeasured && (
        <div role="status" className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Outcomes not measured yet.</span> Accepted, rejected and verification figures are recorded once migration 600 is applied.
        </div>
      )}
      {s.truncated && <p role="status" className="text-xs text-amber-800">A source returned its row limit: figures are for the most recent rows only.</p>}
      <div className={`${card} p-5 overflow-x-auto`}>
        {s.formats.length === 0 ? <p className="text-sm text-gray-500">No Scholar question-engine activity in this window.</p> : (
          <table className="w-full min-w-[56rem] text-left text-xs">
            <caption className="sr-only">Scholar question engine by format</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-1 pr-3">Format</th><th scope="col" className="pr-3">Actions</th><th scope="col" className="pr-3">Accepted</th><th scope="col" className="pr-3">Rejected</th>
                <th scope="col" className="pr-3">Top rejection reasons</th><th scope="col" className="pr-3">Verification failures</th><th scope="col" className="pr-3">p50 / p90</th>
                <th scope="col" className="pr-3">Cost</th><th scope="col">Cost / accepted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums text-gray-800">
              {s.formats.map(f => (
                <tr key={f.format}>
                  <th scope="row" className="py-1.5 pr-3 font-medium text-gray-900">{f.label}</th>
                  <td className="pr-3">{s.outcomesMeasured ? f.actions : NONE}</td>
                  <td className="pr-3">{num(f.accepted)}</td>
                  <td className="pr-3">{num(f.rejected)}{f.rejectionRate != null ? ` (${f.rejectionRate}%)` : ""}</td>
                  <td className="pr-3">{f.topReasons.length ? f.topReasons.map(r => `${REASON(r.reason)} ${r.n}`).join(", ") : NONE}</td>
                  <td className="pr-3">{f.verified == null ? NONE : f.verificationFailureRate == null ? "No verified actions" : `${f.verificationFailures} of ${f.verified} (${pct(f.verificationFailureRate)})`}</td>
                  <td className="pr-3">{ms(f.p50)} / {ms(f.p90)}</td>
                  <td className="pr-3">{money(f.cost)}</td>
                  <td>{money(f.costPerAccepted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {cost && (
        <div className={`${card} p-5`}>
          <h3 className="text-[13px] font-semibold text-gray-900">Cost per evaluated answer and per completed session <span className="text-[10px] font-normal text-gray-500">last {cost.days} days · settled ledger</span></h3>
          {!cost.meteringOn && <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">Metering off, no data. AI metering is off on this environment, so the ledger records no spend. These figures read not measured, not zero.</p>}
          <dl className="mt-2 grid grid-cols-1 gap-3 text-[13px] md:grid-cols-2">
            <Cost label="Per evaluated answer (AI evaluation)" f={cost.perEvaluatedAnswer} />
            <Cost label="Per completed revision session or adaptive exam" f={cost.perCompletedSession} basis={"basis" in cost.perCompletedSession ? cost.perCompletedSession.basis : undefined} />
          </dl>
          {cost.adaptiveCompleted != null && <p className="mt-1 text-[11px] text-gray-500">{cost.adaptiveCompleted} of the completed sessions were adaptive exams.</p>}
          {cost.truncated && <p role="status" className="text-xs text-amber-800">A source returned its row limit: figures are for the most recent rows only.</p>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${card} p-5`}>
          <h3 className="text-[13px] font-semibold text-gray-900">Governed library reuse</h3>
          {s.library ? (
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[13px]">
              <dt className="text-gray-600">Sessions that looked</dt><dd className="font-semibold tabular-nums text-gray-900">{s.library.sessions}</dd>
              <dt className="text-gray-600">Offered</dt><dd className="font-semibold tabular-nums text-gray-900">{s.library.offered}</dd>
              <dt className="text-gray-600">Picked</dt><dd className="font-semibold tabular-nums text-gray-900">{s.library.picked}</dd>
              <dt className="text-gray-600">Copied (new)</dt><dd className="font-semibold tabular-nums text-gray-900">{s.library.copied}</dd>
              <dt className="text-gray-600">Used (new or held)</dt><dd className="font-semibold tabular-nums text-gray-900">{s.library.reused}</dd>
            </dl>
          ) : <p className="mt-2 text-sm text-gray-500">{NONE}. No revision session has looked for library questions in this window.</p>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-[13px] font-semibold text-gray-900">Legacy exam papers</h3>
          {s.legacy ? (
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[13px]">
              <dt className="text-gray-600">Rechecked on open</dt><dd className="font-semibold tabular-nums text-gray-900">{s.legacy.checked == null ? "Not recorded before this release" : s.legacy.checked}</dd>
              <dt className="text-gray-600">Redirected (statements hidden)</dt><dd className="font-semibold tabular-nums text-gray-900">{s.legacy.redirected}</dd>
            </dl>
          ) : <p className="mt-2 text-sm text-gray-500">{NONE}. No legacy paper has been opened since rechecks were recorded.</p>}
          <p className="mt-2 text-[11px] text-gray-500">One row per open of a paper read by an earlier parser, so repeat opens count again.</p>
        </div>
      </div>
    </section>
  );
}
