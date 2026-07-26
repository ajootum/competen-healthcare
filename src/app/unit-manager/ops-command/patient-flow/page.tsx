import Link from "next/link";
import { loadFlowCommand } from "@/lib/operations/ops-flow";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, HBar, Pill, OpsFoot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-005 Patient Flow Coordination Centre — live admissions/discharges/transfers, census, pathways, blockers and
// flow recommendations over op_movement_events + op_patients + op_flow_blockers. Dark command surface. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const DEMAND = [["11:00", "Elective Admissions", "+6 patients"], ["13:00", "MRI Bookings", "+3 transfers"], ["14:00", "Discharges (expected)", "−5 patients"], ["16:00", "ED Peak (forecast)", "High"]];

export default async function PatientFlowPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadFlowCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-005 · Operational Command" title="Patient Flow Coordination Centre" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migrations 038/048/050 then seed the ward.</p></div></div>;

  const k = d.kpis;
  const maxT = Math.max(1, ...d.timeline.map((h: any) => h.a + h.d + h.t));
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Patient Flow Coordination" meta={d.asOf ? `as of ${d.asOf}` : "real-time"} refresh="10s" />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Inpatients" value={k.inpatients} sub="admitted" />
          <Kpi label="Admissions Today" value={k.admissions} sub="movement events" tone="text-rose-400" />
          <Kpi label="Discharges Today" value={k.discharges} sub="movement events" tone="text-emerald-400" />
          <Kpi label="Transfers Today" value={k.transfers} sub="in + out" tone="text-blue-400" />
          <Kpi label="Average LOS" value={k.avgLos != null ? `${k.avgLos}d` : "—"} sub="predicted" />
          <Kpi label="Beds Turning Over" value={typeof k.turnover === "number" ? k.turnover : "—"} sub="today" />
          <Kpi label="Flow Efficiency" value={`${k.flowEfficiency}%`} sub="100 − blockers" tone={k.flowEfficiency >= 85 ? "text-emerald-400" : "text-amber-400"} />
          <Kpi label="Blocked Capacity" value={k.blocked} sub="active blockers" tone={k.blocked ? "text-rose-400" : "text-white"} />
        </div>

        {/* Flow overview + timeline + alerts */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Patient Flow Overview" className="xl:col-span-2">
            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <div><p className="text-[9px] text-slate-500 uppercase tracking-wide mb-1.5">Incoming</p><div className="space-y-1.5">{d.flow.incoming.map((f: any) => <div key={f.label} className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-2 py-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: f.color }} /><span className="text-slate-300 flex-1 truncate">{f.label}</span><span className="text-white font-semibold">{f.n}</span></div>)}</div></div>
              <div><p className="text-[9px] text-slate-500 uppercase tracking-wide mb-1.5">Current Location</p><div className="space-y-1.5">{d.flow.current.map((f: any) => <div key={f.label} className="flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-2 py-1.5"><span className="text-slate-300 flex-1 truncate">{f.label}</span><span className="text-white font-semibold">{f.n}</span></div>)}</div></div>
              <div><p className="text-[9px] text-slate-500 uppercase tracking-wide mb-1.5">Outgoing</p><div className="space-y-1.5">{d.flow.outgoing.map((f: any) => <div key={f.label} className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-2 py-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: f.color }} /><span className="text-slate-300 flex-1 truncate">{f.label}</span><span className="text-white font-semibold">{f.n}</span></div>)}</div></div>
            </div>
            <p className="text-[9px] text-slate-500 mt-2">Incoming/outgoing = today&apos;s movement events; current = live census by department.</p>
          </Card>

          <Card title="Flow Timeline" right={<span className="text-[9px] text-slate-500">today by hour</span>}>
            {d.timeline.length ? <div className="flex items-end gap-1 h-28">{d.timeline.map((h: any) => (
              <div key={h.h} className="flex-1 flex flex-col items-center gap-0.5" title={`${h.h}:00 — +${h.a} / -${h.d} / ↔${h.t}`}>
                <div className="w-full flex flex-col justify-end gap-px" style={{ height: "88px" }}>
                  <div className="w-full bg-rose-500 rounded-t" style={{ height: `${(h.a / maxT) * 100}%` }} />
                  <div className="w-full bg-emerald-500" style={{ height: `${(h.d / maxT) * 100}%` }} />
                  <div className="w-full bg-blue-500 rounded-b" style={{ height: `${(h.t / maxT) * 100}%` }} />
                </div>
                <span className="text-[7px] text-slate-500">{h.h}</span>
              </div>
            ))}</div> : <p className="text-xs text-slate-400 py-8 text-center">No movement events today.</p>}
            <div className="flex gap-3 mt-2 text-[9px] text-slate-400"><span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full" />Adm</span><span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full" />Disch</span><span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-full" />Transf</span></div>
          </Card>

          <Card title="Blockers & Constraints">
            {d.constraints.length ? <div className="space-y-2">{d.constraints.map((b: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-slate-200 leading-tight">{b.label}</p>{b.detail && <p className="text-[10px] text-slate-500 truncate">{b.detail}</p>}</div><Pill text={b.impact} tone={b.impact === "High" ? "rose" : "amber"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No active blockers. ✅</p>}
          </Card>
        </div>

        {/* Census + indicators + pathways + demand */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Current Census by Location">
            {d.flow.current.length ? <div className="space-y-1.5 text-[11px]">{d.flow.current.map((c2: any) => <div key={c2.label} className="flex items-center"><span className="text-slate-300 flex-1 truncate">{c2.label}</span><span className="text-white font-semibold tabular-nums">{c2.n}</span></div>)}<div className="flex items-center border-t border-slate-700 pt-1.5 mt-1.5"><span className="text-slate-400 flex-1">Total inpatients</span><span className="text-white font-bold tabular-nums">{k.inpatients}</span></div></div> : <p className="text-xs text-slate-400 py-4 text-center">No census data.</p>}
          </Card>

          <Card title="Flow Performance Indicators">
            <div className="space-y-2.5">
              {d.indicators.map((ind: any) => (
                <div key={ind.label} className="text-[11px]">
                  {ind.pct != null ? <HBar label={ind.label} pct={ind.pct} tone={ind.invert ? (ind.pct <= ind.target ? "#22c55e" : "#f43f5e") : undefined} /> : (
                    <div className="flex items-center justify-between"><span className="text-slate-300">{ind.label}</span><span className="text-white font-semibold tabular-nums">{ind.value ?? "—"}</span></div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-2">From daily snapshots; blanks have no store yet.</p>
          </Card>

          <Card title="Patient Flow by Pathway">
            {d.pathways.length ? <div className="space-y-2 text-[11px]">{d.pathways.map((p: any) => <div key={p.label} className="flex items-center gap-2"><span className="text-slate-300 flex-1 truncate">{p.label}</span><div className="w-16 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${p.pct}%` }} /></div><span className="text-white font-semibold tabular-nums w-12 text-right">{p.n} · {p.pct}%</span></div>)}</div> : <p className="text-xs text-slate-400 py-4 text-center">No movements today.</p>}
          </Card>

          <Card title="Upcoming Demand" right={<span className="text-[9px] text-slate-500">template</span>}>
            <div className="space-y-2">{DEMAND.map(([tm, l, impact]) => <div key={tm} className="flex items-center gap-2 text-[11px]"><span className="text-slate-400 tabular-nums w-11 shrink-0">{tm}</span><span className="text-slate-200 flex-1 truncate">{l}</span><span className={`${impact.startsWith("+") ? "text-rose-400" : impact.startsWith("−") ? "text-emerald-400" : "text-amber-400"} text-[10px] tabular-nums`}>{impact}</span></div>)}</div>
          </Card>
        </div>

        {/* AI flow recommendations */}
        <Card title="Flow Recommendations">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{d.recs.map((r: any, i: number) => (
            <Link key={i} href={r.href} className="flex items-center gap-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 p-2.5"><span className="text-sm">💡</span><span className="text-[11px] text-slate-200 flex-1">{r.text}</span><span className="text-blue-400 text-[11px]">→</span></Link>
          ))}</div>
        </Card>
      </div>

      <OpsFoot>UMW-OPC-005 — live patient flow over op_movement_events (today&apos;s admissions/transfers/discharges), op_patients (census by department), op_flow_blockers (constraints) + op_ops_snapshots (LOS/turnover/before-noon). Flow overview, census, pathways and blockers are real; upcoming-demand is a template; flow efficiency is a blocker-derived proxy. Read-only manager lens.</OpsFoot>
    </div>
  );
}
