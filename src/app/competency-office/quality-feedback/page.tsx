import { cmoGuard, Head, Card, Kpi, Pill, Donut, Bars, Foot } from "../_cmo-ui";
import { loadQualityFeedback } from "@/lib/competency/quality-feedback";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-028 Competency-to-Quality Feedback Loop — closing the loop between quality data, competency
// performance and continuous improvement. Live over op_incidents (typed quality signals) correlated to
// competency domains + interventions (remediation in flight). No fabricated correlation.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SEV_TONE: Record<string, string> = { critical: "rose", high: "rose", medium: "amber", low: "slate" };
const RISK_TONE: Record<string, string> = { rose: "rose", amber: "amber", emerald: "emerald" };
const RISK_LABEL: Record<string, string> = { rose: "unaddressed", amber: "under-covered", emerald: "covered" };
const LOOP_HEX = ["#3b82f6", "#f59e0b", "#8b5cf6", "#6366f1", "#14b8a6", "#10b981", "#22c55e"];
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—");

export default async function QualityFeedbackPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadQualityFeedback(admin, hid, isSuper);
  const head = <Head code="COMP-028 · Competency Office" title="Competency-to-Quality Feedback Loop" sub="Closing the loop between quality data, competency performance and continuous improvement — quality events correlated to competency domains and the remediation in flight." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The incident/quality store (<code>op_incidents</code>) is not provisioned yet — apply migration 073 to enable the quality-to-competency feedback loop.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[12px] text-blue-800">No quality events captured yet — as incidents and near-misses are reported, this loop correlates them to competency domains and the remediation addressing them.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Quality events" value={k.events} sub="incidents + near-miss" />
        <Kpi label="High / critical" value={k.highCritical} tone={k.highCritical ? "text-rose-600" : "text-gray-900"} />
        <Kpi label="Near-miss" value={k.nearMiss} sub="learning signals" />
        <Kpi label="Competency domains hit" value={k.domainsImpacted} />
        <Kpi label="Remediation in flight" value={k.remediationOpen} sub="open interventions" tone="text-teal-600" />
        <Kpi label="Unaddressed risks" value={k.unaddressed} tone={k.unaddressed ? "text-rose-600" : "text-emerald-600"} sub="high-risk, no remediation" />
      </div>

      {/* The closed feedback loop */}
      <Card title="The feedback loop" right={<span className="text-[11px] text-gray-400">capture → analyse → link → remediate → reassess → measure</span>}>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {d.loop.map((s: any, i: number) => (
            <div key={s.step} className="flex items-center gap-1 shrink-0">
              <div className="flex flex-col items-center text-center w-[104px]">
                <span className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold tabular-nums text-white" style={{ background: LOOP_HEX[i] }}>{s.n}</span>
                <span className="text-[10.5px] text-gray-600 mt-1 leading-tight">{s.label}</span>
              </div>
              {i < d.loop.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Step 7 shows the month-on-month change in quality-event volume (a fall is improvement). Counts are live from the correlated events + interventions.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Quality-linked competency risks" className="xl:col-span-2" right={<Link href="/competency-office/gaps" className="text-[11px] text-teal-600 hover:underline">Gap management →</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-3 font-medium">Competency domain</th><th className="pb-2 pr-3 font-medium text-right">Events</th><th className="pb-2 pr-3 font-medium text-right">High/crit</th><th className="pb-2 pr-3 font-medium text-right">Near-miss</th><th className="pb-2 pr-3 font-medium text-right">Remediation</th><th className="pb-2 font-medium">Coverage</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.domains.map((row: any) => (
                  <tr key={row.domain} className="text-gray-700">
                    <td className="py-2 pr-3 font-medium text-gray-800">{row.domain}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.events}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-rose-600">{row.highCritical || "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{row.nearMiss || "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-teal-700">{row.interventions || "—"}</td>
                    <td className="py-2"><Pill text={RISK_LABEL[row.risk]} tone={RISK_TONE[row.risk]} /></td>
                  </tr>
                ))}
                {!d.domains.length && <tr><td colSpan={6} className="py-6 text-center text-gray-400">No quality events to correlate yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Events are mapped to the competency domain their type/description most signals; &ldquo;coverage&rdquo; compares high/critical events against interventions targeting that domain.</p>
        </Card>

        <Card title="Events by domain">
          {d.domainDonut.length ? (
            <div className="flex flex-col items-center gap-3">
              <Donut segs={d.domainDonut} total={k.events} centre={k.events} sub="events" size={140} />
              <div className="w-full space-y-1">
                {d.domainDonut.map((s: any) => (
                  <div key={s.label} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="tabular-nums text-gray-800 font-semibold">{s.n}</span></div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No events yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Recommended remediation" right={<Link href="/educator/interventions" className="text-[11px] text-teal-600 hover:underline">Interventions →</Link>}>
          {d.recommendations.length ? (
            <div className="space-y-2">
              {d.recommendations.map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-2"><span className="text-sm mt-0.5">{r.priority === "high" ? "🔴" : "🟠"}</span><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800">{r.domain}</p><p className="text-[11px] text-gray-500 leading-snug">{r.text}</p></div></div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No quality-linked competency risks — remediation coverage is keeping pace. 🎉</p>}
        </Card>

        <Card title="Quality event volume" right="last 6 months">
          {d.trend.length >= 2 ? <Bars rows={d.trend.map((t: any) => ({ label: t.label, n: t.value }))} /> : <p className="text-sm text-gray-400 py-8 text-center">Not enough history yet.</p>}
        </Card>
      </div>

      <Card title="Recent quality signals" right="live">
        {d.stream.length ? (
          <div className="space-y-1">
            {d.stream.map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1">
                <Pill text={e.severity} tone={SEV_TONE[e.severity] ?? "slate"} />
                <span className="text-gray-700 capitalize flex-1 truncate">{e.type}{e.nearMiss ? " · near-miss" : ""}</span>
                <span className="text-gray-400 text-[11px] truncate w-40">{e.domain}</span>
                <span className="text-gray-400 text-[10px] tabular-nums w-14 text-right">{fmt(e.when)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No quality signals captured yet.</p>}
      </Card>

      <Foot>COMP-028 — live over <code>op_incidents</code> (typed quality signals: incident type, severity, near-miss) correlated to competency domains, and <code>interventions</code> (the remediation in flight). The correlation, coverage and recommendations are real; the domain mapping is heuristic (by incident type/description). Additional signal sources (M&amp;M, clinical audits, patient feedback, adverse-drug-event feeds), a persistent incident↔competency linkage record, and closed-loop outcome tracking are the next-phase deepening.</Foot>
    </div>
  );
}
