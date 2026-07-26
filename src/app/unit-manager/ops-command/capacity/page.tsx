import Link from "next/link";
import { loadCapacityCommand } from "@/lib/operations/ops-capacity";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Donut, Spark, Pill, OpsFoot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-003 Capacity & Bed Coordination Centre — live capacity visibility, bed optimisation and flow over op_beds
// (+ snapshots/blockers/resources). Dark command surface. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const BED_STATUS: Record<string, string> = { occupied: "bg-emerald-500/90 text-slate-900", available: "bg-blue-500/80 text-white", cleaning: "bg-amber-500/90 text-slate-900", reserved: "bg-fuchsia-500/80 text-white", out_of_service: "bg-slate-600 text-slate-300" };
const BED_LEGEND = [["Occupied", "bg-emerald-500"], ["Available", "bg-blue-500"], ["Cleaning", "bg-amber-500"], ["Reserved", "bg-fuchsia-500"], ["Out of Service", "bg-slate-600"]];
const ACTIONS = [["➕", "New Admission", "/unit-manager/patient-operations/census"], ["➡️", "Transfer", "/unit-manager/patient-operations/flow"], ["🧹", "Mark Cleaning", "/unit-manager/patient-operations/beds"], ["🔧", "Out of Service", "/unit-manager/patient-operations/beds"], ["🗺️", "Ward Map", "/unit-manager/patient-operations/ward-map"], ["📋", "Bed History", "/unit-manager/patient-operations/timeline"]];
const EVENTS = [["10:30", "Discharge – expected", "+1 bed"], ["11:00", "Transfer Out (ICU)", "+1 bed"], ["12:00", "Planned Discharges (2)", "+2 beds"], ["14:00", "Expected Admissions (3)", "−3 beds"], ["16:00", "Cleaning Peak", "−3 beds"]];

export default async function CapacityPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadCapacityCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-003 · Operational Command" title="Capacity & Bed Coordination Centre" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migrations 038/101 then seed the ward.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Capacity & Bed Coordination" meta={d.asOf ? `as of ${d.asOf}` : "real-time"} refresh="10s" />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Total Beds" value={k.totalBeds} sub="licensed" />
          <Kpi label="Occupied Beds" value={k.occupied} sub={`${k.occupancy}%`} tone="text-emerald-400" delta={k.occDelta?.txt} deltaUp={k.occDelta?.up} />
          <Kpi label="Available Beds" value={k.available} sub="ready now" tone="text-blue-400" />
          <Kpi label="Beds Cleaning" value={k.cleaning} sub="in turnover" tone={k.cleaning ? "text-amber-400" : "text-white"} />
          <Kpi label="Reserved Beds" value={k.reserved} sub="held" />
          <Kpi label="Predicted Availability" value={k.predictedAvailability} sub="end of day (naive)" tone="text-blue-400" />
          <Kpi label="Admissions Today" value={k.admissionsToday ?? "—"} sub="snapshot" />
          <Kpi label="Discharges Today" value={k.dischargesToday ?? "—"} sub="snapshot" />
        </div>

        {/* Overview donut + occupancy trend + ward map */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Capacity Overview">
            <div className="flex items-center gap-3">
              <Donut segs={d.overview.map((o: any) => ({ n: o.n, color: o.color }))} total={k.totalBeds} centre={k.totalBeds} sub="Total Beds" />
              <div className="space-y-1 text-[11px] flex-1">{d.overview.map((o: any) => <div key={o.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: o.color }} /><span className="text-slate-300 flex-1 truncate">{o.label}</span><span className="font-semibold text-white">{o.n}</span></div>)}</div>
            </div>
            {d.trend.length >= 2 && <div className="mt-3"><p className="text-[10px] text-slate-400">Occupancy trend</p><Spark series={d.trend} color="#22c55e" /></div>}
          </Card>

          <Card title="Ward Map — Bed Status" className="xl:col-span-2">
            {d.bedGrid.length ? (
              <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5">
                {d.bedGrid.map((b: any) => <div key={b.label} title={`${b.label} · ${b.status}`} className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold ${BED_STATUS[b.status] ?? "bg-slate-700 text-slate-300"}`}>{String(b.label).replace(/\D/g, "").slice(-3) || b.label}</div>)}
              </div>
            ) : <p className="text-xs text-slate-400 py-6 text-center">No beds configured.</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-slate-400">{BED_LEGEND.map(([l, c]) => <span key={l} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${c}`} />{l}</span>)}</div>
          </Card>

          <Card title="Bed Requests & Waiting List">
            {d.waiting.length ? <div className="space-y-2">{d.waiting.map((w: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-slate-200 leading-tight truncate">{w.label}</p><p className="text-[10px] text-slate-500">{w.source}</p></div><Pill text={w.priority} tone={w.priority === "High" ? "rose" : "amber"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No pending bed requests.</p>}
            <p className="text-[9px] text-slate-500 mt-2">From expected admissions + no-bed blockers.</p>
          </Card>
        </div>

        {/* Category + turnover + resources + forecast */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Capacity by Category">
            {d.byCategory.length ? <div className="space-y-2 text-[11px]">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide"><span className="flex-1">Category</span><span className="w-10 text-right">Beds</span><span className="w-10 text-right">Occ</span><span className="w-12 text-right">%</span></div>
              {d.byCategory.map((c2: any) => <div key={c2.label} className="flex items-center"><span className="text-slate-300 flex-1 truncate">{c2.label}</span><span className="w-10 text-right text-white tabular-nums">{c2.total}</span><span className="w-10 text-right text-white tabular-nums">{c2.occupied}</span><span className={`w-12 text-right font-semibold tabular-nums ${c2.pct >= 95 ? "text-rose-400" : c2.pct >= 85 ? "text-amber-400" : "text-emerald-400"}`}>{c2.pct}%</span></div>)}
            </div> : <p className="text-xs text-slate-400 py-4 text-center">No bed-type data.</p>}
          </Card>

          <Card title="Bed Turnover Centre">
            <div className="grid grid-cols-2 gap-2.5 text-center">
              {[["Discharges Today", d.turnover.dischargesToday ?? "—"], ["Pending Cleaning", d.turnover.pendingCleaning], ["Turnover / bed", d.turnover.bedTurnover ?? "—"], ["Before Noon", d.turnover.beforeNoonPct != null ? `${d.turnover.beforeNoonPct}%` : "—"]].map(([l, v]: any) => (
                <div key={l} className="rounded-lg bg-slate-800/50 p-2.5"><p className="text-lg font-bold text-white tabular-nums">{v}</p><p className="text-[9px] text-slate-400 leading-tight">{l}</p></div>
              ))}
            </div>
          </Card>

          <Card title="Support Resources">
            {d.supportResources.length ? <div className="space-y-1.5 text-[11px]">{d.supportResources.map((r: any) => (
              <div key={r.name} className="flex items-center gap-2"><span className="text-slate-300 flex-1 truncate">{r.name}</span><span className="text-white tabular-nums">{r.available}/{r.total}</span><Pill text={r.demand} tone={r.demand === "high" ? "rose" : r.demand === "busy" ? "amber" : "emerald"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No resources configured.</p>}
          </Card>

          <Card title="Capacity Forecast" right={<span className="text-[9px] text-slate-500">daily snapshots</span>}>
            {d.forecast.length >= 2 ? <div className="space-y-2">{d.forecast.map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]"><span className="text-slate-400 w-16 shrink-0">{f.label}</span><div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${f.occupancy ?? 0}%` }} /></div><span className="text-slate-300 w-20 text-right">{f.occupancy}% · +{f.admissions ?? 0}/-{f.discharges ?? 0}</span></div>
            ))}</div> : <p className="text-xs text-slate-400 py-6 text-center">Forecast needs daily snapshots.</p>}
          </Card>
        </div>

        {/* Bed actions + upcoming events + capacity alerts */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Bed Actions" className="xl:col-span-2">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{ACTIONS.map(([icon, label, href]) => <Link key={label} href={href} className="flex flex-col items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 p-2.5"><span className="text-base">{icon}</span><span className="text-[8px] text-slate-300 text-center leading-tight">{label}</span></Link>)}</div>
            <div className="mt-3"><div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-slate-300">Upcoming Capacity Events</p><span className="text-[9px] text-slate-500">template</span></div>
              <div className="space-y-1.5">{EVENTS.map(([tm, l, impact]) => <div key={tm} className="flex items-center gap-2 text-[11px]"><span className="text-slate-400 tabular-nums w-11 shrink-0">{tm}</span><span className="text-slate-200 flex-1 truncate">{l}</span><span className={`${impact.startsWith("+") ? "text-emerald-400" : "text-rose-400"} tabular-nums`}>{impact}</span></div>)}</div>
            </div>
          </Card>

          <Card title="Capacity Alerts" className="xl:col-span-2">
            {d.alerts.length ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{d.alerts.map((a: any, i: number) => (
              <div key={i} className={`rounded-lg border p-2.5 ${a.tone === "rose" ? "bg-rose-500/10 border-rose-500/30" : a.tone === "emerald" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"}`}><p className={`text-[12px] font-semibold ${a.tone === "rose" ? "text-rose-300" : a.tone === "emerald" ? "text-emerald-300" : "text-amber-300"}`}>{a.title}</p><p className="text-[10px] text-slate-400 mt-0.5">{a.sub}</p></div>
            ))}</div> : <p className="text-xs text-slate-400 py-6 text-center">No capacity alerts. ✅</p>}
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-003 — live capacity & bed coordination over op_beds (+ op_ops_snapshots for occupancy/turnover/forecast, op_flow_blockers for the waiting list, op_resources for support capacity). The waiting list derives from expected admissions + no-bed blockers; upcoming-events is a template; avg cleaning duration has no store yet (shown &ldquo;—&rdquo;). Read-only manager lens.</OpsFoot>
    </div>
  );
}
