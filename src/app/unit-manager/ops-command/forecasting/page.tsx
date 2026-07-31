import { loadForecastCommand } from "@/lib/operations/ops-forecast";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Gauge, Pill, OpsFoot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-009 Operational Forecasting & Predictive Intelligence — naive projections over the real snapshot history +
// live ICU occupancy, staffing forecast, bottlenecks, scenarios and recommendations. Dark surface. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ForecastingPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadForecastCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-009 · Operational Command" title="Operational Forecasting & Predictive Intelligence" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 101 then seed op_ops_snapshots.</p></div></div>;

  const k = d.kpis;
  const maxVol = Math.max(1, ...d.volume.flatMap((v: any) => [v.admissions, v.discharges]));
  const maxStaff = Math.max(1, ...d.staffing.flatMap((s: any) => [s.required, s.available]));
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Operational Forecasting & Predictive Intelligence" meta={`naive · ${d.historyDays}d history`} refresh="5m" />

        {/* KPI ribbon (predicted) */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Kpi label="Predicted Admissions" value={k.predAdmissions} sub="next period" tone="text-emerald-400" />
          <Kpi label="Predicted Discharges" value={k.predDischarges} sub="next period" tone="text-emerald-400" />
          <Kpi label="Avg LOS (pred)" value={`${k.predLos}d`} sub="recent mean" />
          <Kpi label="Bed Occupancy (pred)" value={`${k.bedOccupancy}%`} sub="next period" tone={k.bedOccupancy >= 92 ? "text-rose-400" : "text-white"} />
          <Kpi label="ICU Occupancy (live)" value={k.icuOccupancy != null ? `${k.icuOccupancy}%` : "—"} sub="critical_care beds" tone={k.icuOccupancy != null && k.icuOccupancy >= 90 ? "text-rose-400" : "text-white"} />
          <Kpi label="Staffing Coverage (pred)" value={k.staffingCoverage != null ? `${k.staffingCoverage}%` : "—"} sub="snapshot" />
          <Kpi label="Escalation Risk" value={k.escalationRisk} sub="recent rate" tone={k.escalationRisk === "High" ? "text-rose-400" : k.escalationRisk === "Medium" ? "text-amber-400" : "text-emerald-400"} />
        </div>

        {/* Volume forecast + occupancy + predictive alerts */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Patient Volume Forecast" className="xl:col-span-2" right={<span className="text-[9px] text-slate-500">history + naive tail</span>}>
            <div className="flex items-end gap-1 h-32">{d.volume.map((v: any, i: number) => (
              <div key={i} className={`flex-1 flex flex-col items-center gap-0.5 ${v.forecast ? "opacity-60" : ""}`} title={`${v.label}: +${v.admissions} / -${v.discharges}`}>
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "104px" }}><div className="w-1.5 bg-[var(--cmp-color-success)] rounded-t" style={{ height: `${(v.admissions / maxVol) * 100}%` }} /><div className="w-1.5 bg-[var(--cmp-color-information)] rounded-t" style={{ height: `${(v.discharges / maxVol) * 100}%` }} /></div>
                <span className="text-[6px] text-slate-500">{v.label}</span>
              </div>
            ))}</div>
            <div className="flex gap-3 mt-1 text-[9px] text-slate-400"><span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--cmp-color-success)] rounded-full" />Admissions</span><span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--cmp-color-information)] rounded-full" />Discharges</span><span className="text-slate-500">faded = forecast</span></div>
          </Card>

          <Card title="Staffing Forecast" right={<span className="text-[9px] text-slate-500">req vs avail</span>}>
            {d.staffing.length ? <div className="flex items-end gap-1.5 h-32">{d.staffing.map((s: any) => (
              <div key={s.label} className="flex-1 flex flex-col items-center gap-0.5" title={`${s.label}: req ${s.required} / avail ${s.available} / gap ${s.gap}`}>
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "104px" }}><div className="w-2 bg-purple-500 rounded-t" style={{ height: `${(s.required / maxStaff) * 100}%` }} /><div className="w-2 bg-cyan-500 rounded-t" style={{ height: `${(s.available / maxStaff) * 100}%` }} /></div>
                <span className={`text-[8px] tabular-nums ${s.gap < 0 ? "text-rose-400" : "text-emerald-400"}`}>{s.gap > 0 ? `+${s.gap}` : s.gap}</span>
                <span className="text-[6px] text-slate-500">{s.label}</span>
              </div>
            ))}</div> : <p className="text-xs text-slate-400 py-8 text-center">No FTE data in snapshots.</p>}
          </Card>

          <Card title="Predictive Alerts">
            <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.tone === "rose" ? "bg-[var(--cmp-color-error)]" : a.tone === "amber" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-success)]"}`} /><div className="min-w-0"><p className="text-[12px] text-slate-200 leading-tight">{a.title}</p><p className="text-[10px] text-slate-500">{a.sub}</p></div></div>
            ))}</div>
          </Card>
        </div>

        {/* Risk score + bottlenecks + drivers */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Operational Risk Score">
            <div className="flex flex-col items-center"><Gauge v={d.riskScore} invert /><p className={`text-[12px] font-semibold mt-1 ${d.riskScore <= 30 ? "text-emerald-400" : d.riskScore <= 60 ? "text-amber-400" : "text-rose-400"}`}>{d.riskScore <= 30 ? "Low Risk" : d.riskScore <= 60 ? "Moderate" : "High Risk"}</p></div>
          </Card>

          <Card title="Patient Flow Bottlenecks" className="xl:col-span-2">
            {d.bottlenecks.length ? <div className="space-y-2 text-[11px]">{d.bottlenecks.map((b: any) => (
              <div key={b.label} className="flex items-center gap-2"><span className="text-slate-300 flex-1 capitalize truncate">{b.label}</span><div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden"><div className={`h-full rounded-full ${b.impact === "High" ? "bg-[var(--cmp-color-error)]" : b.impact === "Medium" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-success)]"}`} style={{ width: `${Math.min(100, b.n * 12)}%` }} /></div><span className="text-white font-semibold tabular-nums w-8 text-right">{b.n}</span><Pill text={b.impact} tone={b.impact === "High" ? "rose" : b.impact === "Medium" ? "amber" : "emerald"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No active bottlenecks. ✅</p>}
          </Card>

          <Card title="Top Drivers">
            <div className="space-y-2">{d.drivers.map((dr: string, i: number) => <p key={i} className="text-[11px] text-slate-300 leading-snug flex gap-1.5"><span>📈</span><span>{dr}</span></p>)}</div>
          </Card>
        </div>

        {/* Scenario planner + recommended actions */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <Card title="Scenario Planner" className="xl:col-span-2" right={<span className="text-[9px] text-slate-500">template multipliers on baseline</span>}>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide"><span className="flex-1">Scenario</span><span className="w-20 text-right">Admissions</span><span className="w-16 text-right">Occupancy</span><span className="w-16 text-right">Staff Gap</span><span className="w-14 text-right">Risk</span></div>
              {d.scenarios.map((s: any) => <div key={s.name} className="flex items-center rounded-lg bg-slate-800/40 px-2 py-1.5"><span className="text-slate-200 flex-1">{s.name}</span><span className="w-20 text-right text-white tabular-nums">{s.admissions}</span><span className={`w-16 text-right tabular-nums ${s.occ >= 100 ? "text-rose-400" : s.occ >= 92 ? "text-amber-400" : "text-white"}`}>{s.occ}%</span><span className={`w-16 text-right tabular-nums ${s.gap < 0 ? "text-rose-400" : "text-emerald-400"}`}>{s.gap > 0 ? `+${s.gap}` : s.gap}</span><span className={`w-14 text-right tabular-nums font-semibold ${s.risk <= 30 ? "text-emerald-400" : s.risk <= 60 ? "text-amber-400" : "text-rose-400"}`}>{s.risk}</span></div>)}
            </div>
          </Card>

          <Card title="Recommended Actions">
            <div className="space-y-2">{d.recs.map((r: string, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-800/50 p-2.5"><span className="text-[10px] font-bold text-blue-400 shrink-0">{i + 1}</span><span className="text-[11px] text-slate-200 leading-tight">{r}</span></div>
            ))}</div>
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-009 — forecasting over {d.historyDays} days of real op_ops_snapshots history. Projections are <strong>naive</strong> (recent-mean + trend), labelled as such, not a trained model; ICU occupancy is live from critical_care beds; bottlenecks are live op_flow_blockers; scenario multipliers are illustrative templates over the data-derived baseline. Forecast-accuracy tracking (predicted-vs-actual) needs a store and is next-phase. Read-only manager lens.</OpsFoot>
    </div>
  );
}
