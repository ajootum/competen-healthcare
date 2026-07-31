import Link from "next/link";
import { loadStaffingOversight } from "@/lib/operations/ops-staffing";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Donut, Gauge, Pill, OpsFoot, dcard } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-004 Staffing & Assignment Oversight — live workforce deployment, skill mix, assignment load and gaps over
// op_shift_staff + op_patient_assignments. Dark command surface. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const impactTone = (i: string) => (i === "High" ? "rose" : i === "Medium" ? "amber" : "emerald") as any;

export default async function StaffingPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadStaffingOversight(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-004 · Operational Command" title="Staffing & Assignment Oversight" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 038 then seed shifts + staff.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Staffing & Assignment Oversight" meta={d.asOf ? `as of ${d.asOf}` : "real-time"} refresh="10s" />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Staffing Coverage" value={k.coverage != null ? `${k.coverage}%` : "—"} sub="target 90%" tone={k.coverage != null && k.coverage >= 90 ? "text-emerald-400" : "text-amber-400"} />
          <Kpi label="Staff On Duty" value={`${k.onDuty}${k.establishment ? `/${k.establishment}` : ""}`} sub="establishment" />
          <Kpi label="Vacancies" value={k.vacancies ?? "—"} sub="below establishment" tone={k.vacancies ? "text-amber-400" : "text-white"} />
          <Kpi label="Agency / Temp" value={k.agency ?? "—"} sub="FTE (snapshot)" />
          <Kpi label="Absentees" value={k.absentees} sub={k.absentees ? "cover needed" : "none"} tone={k.absentees ? "text-rose-400" : "text-white"} />
          <Kpi label="Competency Match" value={k.competencyMatch != null ? `${k.competencyMatch}%` : "—"} sub="validated assignments" tone={k.competencyMatch != null && k.competencyMatch >= 90 ? "text-emerald-400" : "text-amber-400"} />
          <Kpi label="Safe Staffing" value={k.safeStaffing != null ? `${k.safeStaffing}` : "—"} sub="score (snapshot)" />
          <div className={`${dcard} p-3.5 flex flex-col items-center justify-center`}><p className="text-[10px] text-slate-400 uppercase tracking-wide self-start">Coverage Health</p><Gauge v={k.coverage ?? 0} /><p className="text-[10px] text-slate-400 -mt-1">{k.coverage != null ? (k.coverage >= 90 ? "Adequate" : "At risk") : "no target"}</p></div>
        </div>

        {/* Overview donut + skill mix + workload */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Staffing Overview">
            <div className="flex items-center gap-3">
              <Donut segs={d.overview.map((o: any) => ({ n: o.n, color: o.color }))} total={d.totalStaff} centre={d.totalStaff} sub="Rostered" />
              <div className="space-y-1 text-[11px] flex-1">{d.overview.map((o: any) => <div key={o.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: o.color }} /><span className="text-slate-300 flex-1">{o.label}</span><span className="font-semibold text-white">{o.n}</span></div>)}</div>
            </div>
          </Card>

          <Card title="Coverage by Skill Mix" className="xl:col-span-2">
            {d.skillMix.length ? <div className="space-y-2 text-[11px]">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide"><span className="flex-1">Role</span><span className="w-14 text-right">On Duty</span><span className="w-14 text-right">Rostered</span><span className="w-16 text-right">Share</span></div>
              {d.skillMix.map((s: any) => <div key={s.role} className="flex items-center"><span className="text-slate-300 flex-1 truncate">{s.role}</span><span className="w-14 text-right text-white tabular-nums">{s.on}</span><span className="w-14 text-right text-slate-400 tabular-nums">{s.total}</span><div className="w-16 flex items-center justify-end gap-1"><div className="w-8 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-[var(--cmp-color-information)]" style={{ width: `${s.share}%` }} /></div><span className="text-slate-300 tabular-nums text-[10px]">{s.share}%</span></div></div>)}
            </div> : <p className="text-xs text-slate-400 py-4 text-center">No staff on shift.</p>}
          </Card>

          <Card title="Assignment Load">
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              {[["Assigned", d.assignedPatients], ["Per RN", d.patientsPerRN ?? "—"], ["Unassigned", d.unassigned]].map(([l, v]: any) => <div key={l} className="rounded-lg bg-slate-800/50 p-2"><p className="text-lg font-bold text-white tabular-nums">{v}</p><p className="text-[9px] text-slate-400">{l}</p></div>)}
            </div>
            {d.workload.length ? <div className="space-y-1.5 text-[11px]">{d.workload.map((w: any, i: number) => <div key={i} className="flex items-center gap-2"><span className="text-slate-300 flex-1 truncate">{w.name}</span><span className="text-white font-semibold tabular-nums">{w.patients} pt</span></div>)}</div> : <p className="text-[10px] text-slate-500 text-center py-2">No active assignments.</p>}
          </Card>
        </div>

        {/* Gaps + off-duty + redeployment */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <Card title="Staffing Gaps & Exceptions">
            {d.gaps.length ? <div className="space-y-2">{d.gaps.map((g: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-1.5"><Pill text={g.type} tone={g.type === "Gap" || g.type === "Absence" ? "rose" : g.type === "Skill" ? "amber" : "blue"} /></div><p className="text-[11px] text-slate-300 mt-1 leading-tight">{g.detail}</p></div><Pill text={g.impact} tone={impactTone(g.impact)} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No open gaps. ✅</p>}
          </Card>

          <Card title="Off Duty / Leave / Absence">
            {d.offList.length ? <div className="space-y-2">{d.offList.map((o: any, i: number) => (
              <div key={i} className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-slate-300 shrink-0">{o.name[0] ?? "?"}</div><div className="min-w-0 flex-1"><p className="text-[12px] text-slate-200 leading-tight truncate">{o.name}</p><p className="text-[10px] text-slate-500">{o.role}</p></div><Pill text={o.type} tone={o.type === "Absent" ? "rose" : "slate"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">All rostered staff present.</p>}
          </Card>

          <Card title="Redeployment & Actions">
            <div className="space-y-2 text-[11px]">
              {d.unassigned > 0 && <div className="rounded-lg bg-[var(--cmp-color-information)]/10 border border-blue-500/30 p-2.5"><p className="text-blue-300 font-semibold text-[12px]">Assign {d.unassigned} patient{d.unassigned === 1 ? "" : "s"}</p><p className="text-slate-400 text-[10px] mt-0.5">Admitted patients without a named nurse — allocate on Team Assignments.</p></div>}
              {(d.kpis.vacancies ?? 0) > 0 && <div className="rounded-lg bg-[var(--cmp-color-warning)]/10 border border-amber-500/30 p-2.5"><p className="text-amber-300 font-semibold text-[12px]">Fill {d.kpis.vacancies} vacanc{d.kpis.vacancies === 1 ? "y" : "ies"}</p><p className="text-slate-400 text-[10px] mt-0.5">Draw from float pool or agency to reach establishment.</p></div>}
              <Link href="/unit-manager/workforce-management/team-assignments" className="block text-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2 text-[11px] text-slate-200 font-medium">Open Team Assignments →</Link>
              <Link href="/unit-manager/workforce-management/staffing-engine" className="block text-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2 text-[11px] text-slate-200 font-medium">Staffing Engine →</Link>
            </div>
            <p className="text-[9px] text-slate-500 mt-2">Overtime &amp; fatigue tracking need a worked-hours store (next-phase).</p>
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-004 — live staffing & assignment oversight over op_shift_staff (today&apos;s shift roster) + op_patient_assignments (competency-validated staff↔patient) + profiles. Skill-mix, workload, gaps and the off-duty list are your unit&apos;s real data; establishment/agency come from the daily snapshot. Overtime-hours &amp; fatigue-risk have no store yet and are surfaced as next-phase rather than fabricated. Read-only manager lens.</OpsFoot>
    </div>
  );
}
