import Link from "next/link";
import { loadActionCommand } from "@/lib/operations/ops-actions";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Donut, Bars, Pill, OpsFoot, fmtT } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-007 Operational Action Manager — live action/task command over op_tasks. Dark command surface. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const prTone = (p: string) => (p === "urgent" ? "rose" : p === "high" ? "amber" : p === "normal" ? "blue" : "slate") as any;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadActionCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-007 · Operational Command" title="Operational Action Manager" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 038 then seed tasks.</p></div></div>;

  const k = d.kpis;
  const maxTrend = Math.max(1, ...d.trend.flatMap((t: any) => [t.created, t.completed]));
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Operational Action Manager" meta={d.asOf ? `as of ${d.asOf}` : "real-time"} refresh="30s" />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Total Actions" value={k.total} sub="last 7 days" />
          <Kpi label="Open Actions" value={k.open} sub="in flight" tone="text-blue-400" />
          <Kpi label="Overdue" value={k.overdue} sub="past due" tone={k.overdue ? "text-rose-400" : "text-white"} />
          <Kpi label="Due Today" value={k.dueToday} sub="deadline today" tone={k.dueToday ? "text-amber-400" : "text-white"} />
          <Kpi label="Completed Today" value={k.completedToday} sub="done" tone="text-emerald-400" />
          <Kpi label="On Track" value={`${k.onTrackPct}%`} sub="of open" tone={k.onTrackPct >= 80 ? "text-emerald-400" : "text-amber-400"} />
          <Kpi label="At Risk" value={`${k.atRiskPct}%`} sub="overdue share" tone={k.atRiskPct ? "text-rose-400" : "text-white"} />
          <Kpi label="Critical" value={k.critical} sub="urgent open" tone={k.critical ? "text-rose-400" : "text-white"} />
        </div>

        {/* Overview + priority + by type + deadlines */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Action Overview">
            <div className="flex items-center gap-3">
              <Donut segs={d.overview.map((o: any) => ({ n: o.n, color: o.color }))} total={k.total} centre={k.total} sub="Total" />
              <div className="space-y-1 text-[11px] flex-1">{d.overview.map((o: any) => <div key={o.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: o.color }} /><span className="text-slate-300 flex-1 truncate">{o.label}</span><span className="font-semibold text-white">{o.n}</span></div>)}</div>
            </div>
          </Card>

          <Card title="Priority Breakdown"><Bars rows={d.priority} /></Card>

          <Card title="Actions by Type">
            {d.byType.length ? <div className="space-y-2 text-[11px]">{d.byType.map((t: any) => <div key={t.label} className="flex items-center gap-2"><span className="text-slate-300 flex-1 truncate">{t.label}</span><div className="w-14 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-[var(--cmp-color-information)]" style={{ width: `${t.pct}%` }} /></div><span className="text-white font-semibold tabular-nums w-12 text-right">{t.n} · {t.pct}%</span></div>)}</div> : <p className="text-xs text-slate-400 py-4 text-center">No open actions.</p>}
          </Card>

          <Card title="Upcoming Deadlines" right={<span className="text-[9px] text-slate-500">next due</span>}>
            {d.deadlines.length ? <div className="space-y-2">{d.deadlines.map((dl: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[11px] text-slate-200 leading-tight truncate">{dl.desc}</p><p className="text-[10px] text-slate-500">{dl.owner} · {fmtT(dl.due)}</p></div><Pill text={dl.overdue ? "overdue" : dl.priority} tone={dl.overdue ? "rose" : prTone(dl.priority)} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No dated deadlines.</p>}
          </Card>
        </div>

        {/* Worklist + owner workload */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <Card title="Action Worklist" className="xl:col-span-2" right={<span className="text-[9px] text-slate-500">open &amp; in progress</span>}>
            {d.worklist.length ? <div className="space-y-1.5">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide px-1"><span className="flex-1">Action</span><span className="w-20">Owner</span><span className="w-16">Priority</span><span className="w-20 text-right">Progress</span></div>
              {d.worklist.map((w: any, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-2 py-1.5 text-[11px]">
                  <span className="text-slate-200 flex-1 truncate" title={w.desc}>{w.desc}</span>
                  <span className="text-slate-400 w-20 truncate">{w.owner}</span>
                  <span className="w-16"><Pill text={w.overdue ? "overdue" : w.priority} tone={w.overdue ? "rose" : prTone(w.priority)} /></span>
                  <span className="w-20 flex items-center justify-end gap-1"><div className="w-10 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-[var(--cmp-color-success)]" style={{ width: `${w.progress}%` }} /></div><span className="text-slate-300 tabular-nums text-[10px]">{w.progress}%</span></span>
                </div>
              ))}
            </div> : <p className="text-xs text-slate-400 py-6 text-center">No open actions. ✅</p>}
            <Link href="/unit-manager/action-centre" className="block text-center text-[11px] text-blue-400 hover:underline pt-2">Open Action Centre →</Link>
          </Card>

          <Card title="Action Owner Workload">
            {d.ownerWorkload.length ? <div className="space-y-2 text-[11px]">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide"><span className="flex-1">Owner</span><span className="w-12 text-right">Open</span><span className="w-16 text-right">Overdue</span></div>
              {d.ownerWorkload.map((o: any) => <div key={o.name} className="flex items-center"><span className="text-slate-300 flex-1 truncate">{o.name}</span><span className="w-12 text-right text-white tabular-nums">{o.open}</span><span className={`w-16 text-right tabular-nums font-semibold ${o.overdue ? "text-rose-400" : "text-slate-500"}`}>{o.overdue}</span></div>)}
            </div> : <p className="text-xs text-slate-400 py-4 text-center">No owners assigned.</p>}
            <div className="mt-3 pt-3 border-t border-slate-700/60"><p className="text-[10px] font-semibold text-slate-300 mb-1.5">Recommendations</p><div className="space-y-1.5">{d.recs.map((r: string, i: number) => <p key={i} className="text-[10px] text-slate-400 leading-tight">💡 {r}</p>)}</div></div>
          </Card>
        </div>

        {/* Trend */}
        <Card title="Action Trends" right={<span className="text-[9px] text-slate-500">created vs completed · 7 days</span>}>
          <div className="flex items-end gap-2 h-24">{d.trend.map((t: any) => (
            <div key={t.d} className="flex-1 flex flex-col items-center gap-1" title={`${t.d}: +${t.created} / ✓${t.completed}`}>
              <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "76px" }}><div className="w-2 bg-[var(--cmp-color-information)] rounded-t" style={{ height: `${(t.created / maxTrend) * 100}%` }} /><div className="w-2 bg-[var(--cmp-color-success)] rounded-t" style={{ height: `${(t.completed / maxTrend) * 100}%` }} /></div>
              <span className="text-[7px] text-slate-500">{t.d}</span>
            </div>
          ))}</div>
          <div className="flex gap-3 mt-1 text-[9px] text-slate-400"><span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--cmp-color-information)] rounded-full" />Created</span><span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--cmp-color-success)] rounded-full" />Completed</span></div>
        </Card>
      </div>

      <OpsFoot>UMW-OPC-007 — live action management over op_tasks (+ profiles for owner names). Status donut maps the created→verified lifecycle (Pending Review = completed-awaiting-verify); priority, worklist, owner workload and the 7-day trend are your unit&apos;s real data. Read-only manager lens — create/reassign in the Action Centre.</OpsFoot>
    </div>
  );
}
