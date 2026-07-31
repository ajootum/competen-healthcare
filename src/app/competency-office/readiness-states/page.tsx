import { cmoGuard, Head, Card, Kpi, Pill, Donut, Bars, Foot } from "../_cmo-ui";
import { loadReadinessStates } from "@/lib/competency/readiness-states";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-019 Competency Achievement & Readiness State Engine — resolves the workforce's competencies into the
// seven named readiness states over the real competency_decisions spine (outcome + expiry). NO migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ReadinessStatesPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadReadinessStates(admin, hid, isSuper);
  const head = <Head code="COMP-019 · Competency Office" title="Competency Achievement & Readiness State Engine" sub="Every worker's latest competency decision resolved into exactly one of seven named readiness states — by a fixed precedence over the real decision outcome and expiry — with the workforce distribution and a transparent explain panel." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The competency decision spine (<code>competency_decisions</code>) is not provisioned yet — apply migration <code>011</code> to enable the readiness state engine.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-3 text-[12px] text-blue-800">No competency decisions recorded yet — as assessment decisions are validated, each resolves into a readiness state and this engine reports the workforce distribution.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Competencies assessed" value={k.assessed} sub={`${k.workers} worker${k.workers === 1 ? "" : "s"}`} />
        <Kpi label="Ready" value={`${k.readyPct}%`} sub="of assessed" tone={k.readyPct >= 85 ? "text-[var(--cmp-text-success)]" : k.readyPct >= 60 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"} />
        <Kpi label="At Risk" value={k.atRisk} sub="expiring ≤ 30d" tone={k.atRisk ? "text-[var(--cmp-text-warning)]" : "text-gray-900"} />
        <Kpi label="Remediation Required" value={k.remediation} sub="not yet competent" tone={k.remediation ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
        <Kpi label="Expired" value={k.expired} sub="lapsed" tone={k.expired ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
        <Kpi label="Need attention" value={k.needAttention} sub="worst state not ready" tone={k.needAttention ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Readiness state distribution" right={<Link href="/competency-office/readiness" className="text-[11px] text-teal-600 hover:underline">Composite readiness →</Link>}>
          {k.assessed ? (
            <div className="flex flex-col items-center gap-3">
              <Donut segs={d.donutSegs} total={k.assessed} centre={k.assessed} sub="competencies" size={150} />
              <div className="w-full space-y-1">
                {d.distribution.map((s: any) => (
                  <div key={s.key} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="tabular-nums text-gray-400 w-9 text-right">{s.pct}%</span><span className="tabular-nums text-gray-800 font-semibold w-8 text-right">{s.decisions}</span></div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No decisions to resolve yet.</p>}
          <p className="text-[10px] text-gray-400 mt-2">Per-decision — the latest decision for each (worker × competency) pair, resolved to one state.</p>
        </Card>

        <Card title="Workforce by worst readiness state" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{k.workers} workers · worst-state rollup</span>}>
          {k.workers ? (
            <Bars rows={d.distribution.map((s: any) => ({ label: s.label, n: s.workers }))} colors={d.distribution.map((s: any) => s.color)} />
          ) : <p className="text-sm text-gray-400 py-8 text-center">No workers assessed yet.</p>}
          <p className="text-[10px] text-gray-400 mt-2">Each worker is placed in their single WORST state across all their competencies. Precedence: Expired ▸ Remediation ▸ Restricted ▸ Not Ready ▸ At Risk ▸ Partially Ready ▸ Ready.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Attention worklist" right={<span className="text-[11px] text-gray-400">worst first · top 10</span>}>
          {d.worklist.length ? (
            <div className="space-y-1">
              {d.worklist.map((w: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1.5">
                  <span className="text-gray-800 font-medium flex-1 truncate">{w.person}</span>
                  <span className="text-gray-400 text-[11px] truncate w-44">{w.competency}</span>
                  <Pill text={w.stateLabel} tone={w.tone} />
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">Every assessed worker is Ready or Partially Ready. 🎉</p>}
          <p className="text-[10px] text-gray-400 mt-2">Workers whose worst readiness state is not Ready / Partially Ready, with the competency driving that state.</p>
        </Card>

        <Card title="The seven readiness states" right={<span className="text-[11px] text-gray-400">evaluated top-down · first match wins</span>}>
          <div className="space-y-2">
            {d.distribution.map((s: any, i: number) => (
              <div key={s.key} className="flex items-start gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ background: s.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-gray-800">{i + 1}. {s.label}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">band {s.band}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums ml-auto shrink-0">{s.decisions} · {s.workers}w</span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug">{s.def}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Score bands are the COMP-019 readiness-index ranges (Ready 95–100 is spec-fixed; the remainder are indicative). &ldquo;n · nw&rdquo; = decisions in that state · workers whose worst state it is.</p>
        </Card>
      </div>

      <Foot>COMP-019 — states are DERIVED on read from each worker&rsquo;s latest <code>competency_decisions</code> outcome + <code>expiry_date</code> (real), not a persisted recompute-on-event state machine. Rule choice: <code>competent_with_conditions</code> resolves to <strong>Partially Ready</strong> (competent, with conditions), reserving <strong>Restricted Practice</strong> for <code>suspended</code> decisions where practice is actively restricted. A persisted <code>competency_lifecycle_state</code> with event-driven recompute (assessment ▸ validation ▸ expiry ▸ suspension) is COMP-017&rsquo;s next-phase migration.</Foot>
    </div>
  );
}
