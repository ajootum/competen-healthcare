import { AI_MODE_LABEL, type AiMode } from "@/lib/ai/operating-mode";
import type { ModeVersion, ModeView, PilotMetrics } from "@/lib/ai/modes-admin";
import { RISK_TIER_LABEL, type RiskTier } from "@/lib/ai/clinical-risk";
import { ModesPanel } from "./ModesControls";
import { ReadinessWarning } from "./FairUseControls";

// "AI operating modes" on /super-admin/ai/fair-use: the editor, and the pilot metrics beside it. Server-rendered from
// counts only (the decision log holds no request text); the client part is ModesControls.

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const th = "text-[11.5px] uppercase tracking-[0.08em] text-gray-500";

export function ModesSection({ modes, versions, ruleIds, metrics, gaps = [] }: { modes: ModeView[] | null; versions: ModeVersion[] | null; ruleIds: Record<string, string[]>; metrics: PilotMetrics | null; gaps?: string[] }) {
  const pendingCount = (modes ?? []).filter(m => m.pending).length;
  return (
    <section aria-labelledby="md-h" className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 id="md-h" className="text-[16px] font-bold text-gray-900">AI operating modes</h2>
      <p className="mt-1 text-[13px] text-gray-600">
        Strict Production runs the published risk rules unchanged. Supervised Pilot applies only to the cohorts named. A mode never approves a model;
        high-risk clinical requests still need a model made eligible by a recorded evaluation. Modes publish and roll back on their own, apart from the
        other AI policies, and every gate decision in a pilot is logged without the request text.
      </p>
      {gaps.length > 0 && <ReadinessWarning gaps={gaps} />}
      {modes === null ? (
        <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">The operating modes could not be read just now (or the configuration engine, migration 076, is not applied here). Every request runs in Strict Production.</p>
      ) : (
        <div className="mt-3">
          <ModesPanel
            products={modes.map(m => ({ ...m, ruleIds: ruleIds[m.product] ?? [] }))}
            versions={versions === null ? null : versions.map(v => ({ ...v, when: `${when(v.createdAt)}` }))}
            pendingCount={pendingCount} />
        </div>
      )}

      <div className="mt-6" aria-labelledby="pm-h" role="region">
        <h3 id="pm-h" className="text-[15px] font-bold text-gray-900">Pilot metrics (last {metrics?.days ?? 30} days)</h3>
        {metrics === null ? (
          <p role="status" className="mt-2 text-[13px] text-amber-900">The decision log could not be read just now.</p>
        ) : metrics.total === 0 ? (
          <p className="mt-2 text-[13px] text-gray-700">No decisions recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-4">
            <p className="text-[12.5px] text-gray-600">{metrics.total.toLocaleString()} gate decisions{metrics.truncated ? " (the most recent 20,000; older ones are not counted)" : ""}. Counts only: no request text is stored.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <caption className="sr-only">Gate decisions by product, mode and cohort</caption>
                <thead><tr className={`border-b border-gray-200 ${th}`}><th scope="col" className="py-1.5">Product · mode · cohort</th><th scope="col">Served</th><th scope="col">Clarify asked</th><th scope="col">Refused</th><th scope="col">Total</th></tr></thead>
                <tbody>{metrics.cells.map(c => (
                  <tr key={`${c.product}|${c.mode}|${c.cohort}`} className="border-b border-gray-100">
                    <th scope="row" className="py-1.5 font-normal capitalize">{c.product} · {AI_MODE_LABEL[c.mode as AiMode] ?? c.mode} · {c.cohort}</th>
                    <td>{c.served}</td><td>{c.clarify}</td><td>{c.refused}</td><td>{c.total}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-[13px] font-semibold text-gray-800">By risk tier</p>
                <ul className="mt-1 space-y-0.5 text-[13px] text-gray-800">{metrics.byTier.length ? metrics.byTier.map(t => <li key={t.label}>{RISK_TIER_LABEL[t.label as RiskTier] ?? t.label}: {t.n}</li>) : <li className="text-gray-600">None recorded.</li>}</ul>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800">Top rules</p>
                <ol className="mt-1 space-y-0.5 text-[13px] text-gray-800">{metrics.topRules.length ? metrics.topRules.map(r => <li key={r.label}><span className="font-mono text-[12px]">{r.label}</span>: {r.n}</li>) : <li className="text-gray-600">None recorded.</li>}</ol>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800">Refusal reasons</p>
                <ul className="mt-1 space-y-0.5 text-[13px] text-gray-800">{metrics.refusalReasons.length ? metrics.refusalReasons.map(r => <li key={r.label}>{r.label}: {r.n}</li>) : <li className="text-gray-600">No refusals.</li>}</ul>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="text-[13px] font-semibold text-gray-800">Cost and tokens for the cohorts&apos; named members</p>
          {metrics === null || metrics.cohortCost === null ? <p className="text-[13px] text-amber-900">Not measured: AI requests could not be read just now.</p>
            : metrics.cohortCost.length === 0 ? <p className="text-[13px] text-gray-700">No published cohort names a person, so there is nothing to measure. A cohort chosen by plan or entitlement source is not costed.</p> : (
            <div className="overflow-x-auto">
              <table className="mt-1 w-full min-w-[520px] text-left text-[13px]">
                <caption className="sr-only">AI cost by cohort</caption>
                <thead><tr className={`border-b border-gray-200 ${th}`}><th scope="col" className="py-1.5">Cohort</th><th scope="col">Members</th><th scope="col">Requests</th><th scope="col">Cost (USD)</th><th scope="col">Tokens</th></tr></thead>
                <tbody>{metrics.cohortCost.map(c => (
                  <tr key={`${c.product}|${c.code}`} className="border-b border-gray-100">
                    <th scope="row" className="py-1.5 font-normal capitalize">{c.product} · {c.label}</th><td>{c.members}</td><td>{c.requests.toLocaleString()}</td><td>{c.costUsd.toFixed(4)}</td><td>{c.tokens.toLocaleString()}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-[13px] font-semibold text-gray-800">Learner feedback (all AI outputs)</p>
          {metrics === null || metrics.feedback === null ? <p className="text-[13px] text-gray-700">Not measured: feedback is not available on this environment.</p> : (
            <ul className="mt-1 space-y-0.5 text-[13px] text-gray-800">
              {metrics.feedback.kinds.map(k => <li key={k.kind} className="capitalize">{k.kind}: {k.n} rated, {k.positive} positive</li>)}
              {metrics.feedback.reasons.length > 0 && <li>Reasons given: {metrics.feedback.reasons.map(r => `${r.label} (${r.n})`).join(", ")}</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
