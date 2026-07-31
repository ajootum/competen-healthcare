import Link from "next/link";
import { loadAuditAnalytics } from "@/lib/operations/ops-analytics";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, HBar, OpsFoot, fmtT } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-011 Audit, Reporting & Operational Analytics — period rollups, day/month trend analytics, scorecards, a
// unified operational audit feed, a report catalogue and real data-quality indicators. Dark surface. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const toneCls: Record<string, string> = { emerald: "text-emerald-400", amber: "text-amber-400", rose: "text-rose-400", blue: "text-blue-400" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadAuditAnalytics(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-011 · Operational Command" title="Audit, Reporting & Operational Analytics" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 101 then seed op_ops_snapshots.</p></div></div>;

  const r = d.rollups;
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Audit, Reporting & Operational Analytics" meta={`${r.days}d rollup`} refresh="on demand" />

        {/* Operational KPI rollups */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Avg Occupancy" value={`${r.avgOccupancy}%`} sub={`${r.days}d`} series={d.trends.occupancy} sparkColor="#22c55e" />
          <Kpi label="Total Admissions" value={r.totalAdmissions} sub="period" series={d.trends.admissions} sparkColor="#3b82f6" />
          <Kpi label="Total Discharges" value={r.totalDischarges} sub="period" tone="text-emerald-400" />
          <Kpi label="Avg LOS" value={`${r.avgLos}d`} sub="period" series={d.trends.los} sparkColor="#a855f7" />
          <Kpi label="Escalation Rate" value={r.avgEscalationRate} sub="avg/day" tone={r.avgEscalationRate >= 5 ? "text-rose-400" : "text-white"} />
          <Kpi label="Readmission Rate" value={`${r.avgReadmission}%`} sub="period" />
          <Kpi label="Safe Staffing" value={r.avgSafeStaffing || "—"} sub="avg score" series={d.trends.staffing} sparkColor="#06b6d4" />
          <Kpi label="Reporting Window" value={`${r.days}d`} sub="daily snapshots" />
        </div>

        {/* Scorecards + monthly trend */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Performance Scorecards" className="xl:col-span-2">
            <div className="grid grid-cols-2 gap-2.5">{d.scorecards.map((s: any) => (
              <div key={s.label} className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3"><p className="text-[10px] text-slate-400">{s.label}</p><p className={`text-2xl font-bold tabular-nums ${toneCls[s.tone] ?? "text-white"}`}>{s.value}</p><p className="text-[9px] text-slate-500">{s.sub}</p></div>
            ))}</div>
          </Card>

          <Card title="Monthly Trend" className="xl:col-span-2" right={<span className="text-[9px] text-slate-500">op_ops_snapshots · month</span>}>
            {d.monthlyTrend.length ? <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide"><span className="w-16">Month</span><span className="flex-1 text-right">Occ</span><span className="flex-1 text-right">Adm</span><span className="flex-1 text-right">Disch</span><span className="flex-1 text-right">LOS</span><span className="flex-1 text-right">Esc</span><span className="flex-1 text-right">Readm</span></div>
              {d.monthlyTrend.map((m: any) => <div key={m.period} className="flex items-center"><span className="w-16 text-slate-300">{m.period}</span><span className="flex-1 text-right text-white tabular-nums">{m.occupancy}%</span><span className="flex-1 text-right text-white tabular-nums">{m.admissions}</span><span className="flex-1 text-right text-white tabular-nums">{m.discharges}</span><span className="flex-1 text-right text-white tabular-nums">{m.los}</span><span className="flex-1 text-right text-white tabular-nums">{m.escalation}</span><span className="flex-1 text-right text-white tabular-nums">{m.readmission}%</span></div>)}
            </div> : <p className="text-xs text-slate-400 py-6 text-center">No monthly snapshots yet.</p>}
          </Card>
        </div>

        {/* Audit feed + data quality + report centre */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Audit Activity Feed" className="xl:col-span-2" right={<span className="text-[9px] text-slate-500">operational log</span>}>
            {d.auditFeed.length ? <div className="space-y-2 max-h-72 overflow-y-auto pr-1">{d.auditFeed.map((f: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{f.icon}</span><div className="min-w-0 flex-1"><p className="text-[11px] text-slate-200 leading-tight">{f.text}</p><p className="text-[9px] text-slate-500">{f.kind} · {fmtT(f.at)}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No audit activity in window.</p>}
          </Card>

          <Card title="Data Quality Indicators">
            <div className="space-y-3">{d.dataQuality.map((q: any) => (
              <div key={q.label}><HBar label={q.label} pct={q.pct} /><p className="text-[9px] text-slate-500 mt-0.5">{q.sub}</p></div>
            ))}</div>
          </Card>

          <Card title="Report Centre">
            <div className="space-y-1.5">{d.reports.map((rep: any) => (
              <Link key={rep.name} href={rep.href} className="flex items-center gap-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 px-2.5 py-2"><div className="min-w-0 flex-1"><p className="text-[11px] text-slate-200 leading-tight">{rep.name}</p><p className="text-[9px] text-slate-500 truncate">{rep.desc}</p></div><span className="text-blue-400 text-[11px]">→</span></Link>
            ))}</div>
            <p className="text-[9px] text-slate-500 mt-2">Scheduled reports &amp; benchmarking are next-phase.</p>
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-011 — operational analytics &amp; audit over op_ops_snapshots (day + month rollups/trends) and a unified audit feed from op_escalations / op_safety_alerts / op_tasks / op_movement_events. KPI rollups, scorecards, the audit feed and data-quality indicators are your unit&apos;s real data; the report centre cross-links to authoritative analytics surfaces; scheduled reports &amp; external benchmarking are next-phase. Read-only manager lens.</OpsFoot>
    </div>
  );
}
