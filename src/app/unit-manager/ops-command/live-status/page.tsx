import Link from "next/link";
import { loadLiveUnitStatus } from "@/lib/operations/ops-live-status";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, StatusTile, Gauge, Spark, Pill, OpsFoot, dcard, fmtT } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-002 Live Unit Status Engine — the real-time single view of unit operational status across eight domains,
// over the live operational stores. Dark command surface inside the light UMW shell. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const BED_TONE: Record<string, string> = { high: "bg-rose-500/90 text-white", medium: "bg-amber-500/90 text-slate-900", low: "bg-emerald-500/90 text-slate-900", reserved: "bg-blue-500/80 text-white", cleaning: "bg-amber-600/70 text-white", maintenance: "bg-slate-600 text-slate-300", available: "bg-slate-700/40 text-slate-400 border border-slate-600" };
const LEGEND = [["Occupied — high", "bg-rose-500"], ["Medium", "bg-amber-500"], ["Low / stable", "bg-emerald-500"], ["Available", "bg-slate-600"], ["Cleaning", "bg-amber-600"], ["Reserved", "bg-blue-500"], ["Maintenance", "bg-slate-500"]];
const EVENTS = [["10:45", "New Admission (expected)"], ["11:00", "Ward Round"], ["12:00", "Lunch Break Peak"], ["14:00", "Discharge Peak"], ["16:00", "Family Meetings"], ["18:30", "Evening Handover"]];

export default async function LiveUnitStatusPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadLiveUnitStatus(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-002 · Operational Command" title="Live Unit Status Engine" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migrations 038/048/050/101 then seed the ward.</p></div></div>;

  const t = d.trends;
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Live Unit Status Overview" meta={d.asOf ? `as of ${d.asOf}` : "real-time"} refresh="5s" />

        {/* Eight domain traffic-lights */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {d.domains.map((dm: any) => <StatusTile key={dm.label} label={dm.label} status={dm.status} value={dm.value} sub={dm.sub} />)}
        </div>

        {/* Unit map + status feed + active alerts */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Unit Status Map" className="xl:col-span-2">
            {d.bedGrid.length ? (
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                {d.bedGrid.map((b: any) => <div key={b.label} title={b.label} className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold ${BED_TONE[b.tone]}`}>{String(b.label).replace(/\D/g, "").slice(-3) || b.label}</div>)}
              </div>
            ) : <p className="text-xs text-slate-400 py-6 text-center">No beds configured.</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-slate-400">
              {LEGEND.map(([l, c]) => <span key={l} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${c}`} />{l}</span>)}
            </div>
          </Card>

          <Card title="Real-time Status Feed">
            {d.feed.length ? <div className="space-y-2.5">{d.feed.map((f: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" /><div className="min-w-0"><p className="text-[11px] text-slate-200 leading-tight capitalize truncate">{f.text}</p><p className="text-[9px] text-slate-500">{fmtT(f.at)}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No movement events today.</p>}
          </Card>

          <Card title="Active Alerts" right={<div className="flex gap-1.5 text-[10px]"><span className="text-rose-400">{d.buckets.critical} crit</span><span className="text-amber-400">{d.buckets.medium} med</span><span className="text-slate-400">{d.buckets.low} low</span></div>}>
            {d.alerts.length ? <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.band === "high" ? "bg-rose-500" : a.band === "medium" ? "bg-amber-500" : "bg-slate-500"}`} /><div className="min-w-0 flex-1"><p className="text-[12px] text-slate-200 leading-tight">{a.title}</p><p className="text-[10px] text-slate-500">{a.sub}{a.at ? ` · ${fmtT(a.at)}` : ""}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No active alerts. ✅</p>}
          </Card>
        </div>

        {/* Live metrics + status trends + upcoming events */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Live Metrics" className="xl:col-span-2">
            <div className="grid grid-cols-3 gap-2.5">
              {d.metrics.map((m: any) => <div key={m.label} className="rounded-lg bg-slate-800/60 border border-slate-700/50 p-2.5"><p className="text-[9px] text-slate-400 uppercase tracking-wide truncate">{m.label}</p><p className="text-lg font-bold text-white tabular-nums leading-tight mt-0.5">{m.value}</p><p className="text-[9px] text-slate-500">{m.sub}</p></div>)}
            </div>
          </Card>

          <Card title="Status Trends" right={<span className="text-[9px] text-slate-500">last 24h</span>}>
            {t.occupancy.length >= 2 ? (
              <div className="space-y-2.5">
                {[["Occupancy", t.occupancy, "#3b82f6"], ["Safe staffing", t.staffing, "#22c55e"], ["Capacity score", t.quality, "#a855f7"]].map(([l, s, c]: any) => (
                  <div key={l}><div className="flex items-center justify-between text-[10px]"><span className="text-slate-400">{l}</span><span className="text-slate-300 tabular-nums">{s[s.length - 1] || "—"}</span></div><Spark series={s} color={c} /></div>
                ))}
              </div>
            ) : <p className="text-xs text-slate-400 py-6 text-center">Trends need daily snapshots.</p>}
          </Card>

          <Card title="Upcoming Events" right={<span className="text-[9px] text-slate-500">template</span>}>
            <div className="space-y-2">{EVENTS.map(([tm, l]) => <div key={tm} className="flex gap-2.5 text-[11px]"><span className="text-slate-400 tabular-nums w-11 shrink-0">{tm}</span><span className="text-slate-200">{l}</span></div>)}</div>
          </Card>
        </div>

        {/* Operational status summary + score */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <div className={`${dcard} p-4 xl:col-span-3`}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white">Operational Status Summary</h3><Pill text={d.summary.overall} tone={d.summary.overall === "STABLE" ? "emerald" : d.summary.overall === "STRAINED" ? "amber" : "rose"} /></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[["Active Incidents", d.summary.activeIncidents, "text-amber-400"], ["Open Escalations", d.summary.openEscalations, "text-rose-400"], ["Tasks Overdue", d.summary.tasksOverdue, "text-amber-400"], ["Actions Completed Today", d.summary.actionsCompletedToday, "text-emerald-400"]].map(([l, v, tone]: any) => (
                <div key={l} className="rounded-lg bg-slate-800/50 p-3"><p className="text-[10px] text-slate-400">{l}</p><p className={`text-2xl font-bold tabular-nums ${tone}`}>{v}</p></div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-3">All critical systems monitored across eight live domains. Statuses recompute from your unit&apos;s real counts on each load.</p>
          </div>
          <div className={`${dcard} p-4 flex flex-col items-center justify-center`}>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide self-start">Operational Score</p>
            <Gauge v={d.score} />
            <p className="text-[11px] text-slate-300 mt-1">{d.score >= 85 ? "Very Good" : d.score >= 70 ? "Good" : d.score >= 55 ? "Fair" : "At Risk"}</p>
            <Link href="/unit-manager/ops-performance" className="text-[10px] text-blue-400 hover:underline mt-2">Command Dashboard →</Link>
          </div>
        </div>
      </div>

      <OpsFoot>UMW-OPC-002 — live single view of unit status across eight domains over the operational stores (op_beds / op_patients / op_shift_staff / op_escalations / op_safety_alerts / op_tasks / op_equipment / op_ops_snapshots / op_movement_events). Domain scores are composites derived from your unit&apos;s real counts; the events strip is a template. Read-only manager lens — live execution stays in the SSW.</OpsFoot>
    </div>
  );
}
