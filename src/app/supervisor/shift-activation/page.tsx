import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftActivation } from "@/lib/operations/shift-activation";
import { ConfirmAttendance, ActivateButton } from "./ActivationActions";

export const dynamic = "force-dynamic";

// Shift Planning & Activation Centre (SSW-SPA-001 / SPA-000) — the Shift Supervisor's
// operational orchestration hub. 10-service planning workflow (shift identity, incoming
// team, workforce availability, census, acuity, workload, competency, demand, allocation,
// readiness & activation) over live single-source data — it owns none of it. Activation is
// gated on the readiness checklist.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ACU: Record<string, string> = { red: "#ef4444", orange: "#f97316", amber: "#f59e0b", green: "#22c55e" };
const SEV: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };
const STEPS = ["Shift Identity", "Incoming Team", "Workforce Availability", "Patient Census", "Patient Acuity", "Operational Workload", "Competency Readiness", "Demand Calculation", "Staff Allocation", "Readiness & Activation"];

function Ring({ pct, label, tone, big }: { pct: number | null; label: string; tone: string; big?: string }) {
  const sz = big ? "w-24 h-24" : "w-20 h-20";
  return <div className={`relative ${sz} shrink-0`}><div className={`${sz} rounded-full`} style={{ background: pct != null ? `conic-gradient(${tone} ${pct}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[20%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{big ?? (pct != null ? `${pct}%` : "—")}</span><span className="text-[7px] text-gray-400 text-center leading-tight">{label}</span></div></div>;
}
function Mini({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold ${tone ?? "text-gray-900"}`}>{value}</p><p className="text-[9px] text-gray-400 leading-tight">{label}</p></div>;
}

export default async function ShiftActivationCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadShiftActivation(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><span className="text-xl">📅</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Planning &amp; Activation Centre</h1><p className="text-sm text-gray-500">Plan, validate and activate the shift with confidence.</p></div></div>
      <div className="flex items-center gap-2">{d.ready && <span className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${d.phase === "activated" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{d.phase === "activated" ? "● Shift active" : "○ Planning in progress"}</span>}<Link href="/supervisor/handover" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600">Handover View</Link></div>
    </div>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">The activation centre orchestrates a running/planned shift with patients + staff.</p></div></div>;

  const w = d.workforce, ce = d.census, ac = d.acuity, dm = d.demand;
  const done = [!!d.shift, !!d.publishedRoster, w.attendancePct != null && w.attendancePct >= 90, ce.totalPatients > 0, ac.avgAcuity != null, true, d.competencyReadiness.every((c: any) => c.ok), dm.minRequired != null, ce.totalPatients === 0 || (d as any).checklist?.find?.((x: any) => x.label === "All patients assigned")?.ok, d.phase === "activated"];
  const acuTotal = ac.levels.reduce((n: number, x: any) => n + x.n, 0) || 1;
  const acuStops = ac.levels.map((l: any, i: number) => { const before = ac.levels.slice(0, i).reduce((n: number, x: any) => n + x.n, 0); const after = before + l.n; return `${ACU[l.tone]} ${(before / acuTotal) * 100}% ${(after / acuTotal) * 100}%`; }).join(", ");

  return (
    <div className="space-y-4">
      {header}

      {/* 10-step workflow */}
      <div className={`${card} p-3`}><div className="flex items-center justify-between gap-1 overflow-x-auto">{STEPS.map((s, i) => (<div key={s} className="flex flex-col items-center text-center min-w-[80px] flex-1"><span className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center ${done[i] ? "bg-emerald-500 text-white" : i === done.findIndex((x: any) => !x) ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"}`}>{done[i] ? "✓" : i + 1}</span><span className={`text-[9px] mt-1 leading-tight ${done[i] ? "text-gray-700 font-medium" : "text-gray-400"}`}>{s}</span></div>))}</div></div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Shift Identity */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift Identity</h3>
          <div className="space-y-1.5 text-xs">{[["Unit", d.identity.unit], ["Shift Type", d.identity.shiftType], ["Date", d.identity.date ?? "—"], ["Time", d.identity.time], ["Shift Supervisor", d.identity.supervisor], ["Roster Version", d.identity.rosterVersion]].map(([l, v]) => (<div key={l as string} className="flex items-center justify-between"><span className="text-gray-500">{l}</span><span className="text-gray-800 font-medium text-right">{v}</span></div>))}</div>
        </div>

        {/* Workforce Availability */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Workforce Availability</h3>
          <div className="grid grid-cols-4 gap-1.5 mb-3"><Mini label="Rostered" value={w.rostered} /><Mini label="Confirmed" value={w.confirmed} tone="text-emerald-600" /><Mini label="Expected" value={w.expectedLater} tone="text-amber-600" /><Mini label="Unavailable" value={w.unavailable} tone="text-rose-600" /></div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Attendance</p>
          <div className="space-y-1 max-h-[140px] overflow-y-auto">{w.attendance.slice(0, 6).map((s: any) => (<div key={s.id} className="flex items-center justify-between text-[11px]"><span className="text-gray-700 truncate flex-1">{s.name}</span><span className="text-gray-400 mx-1 truncate max-w-[70px]">{s.role}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${s.status === "absent" ? "bg-rose-50 text-rose-700" : ["on_duty", "confirmed"].includes(s.status) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{s.statusLabel}</span><span className="ml-1"><ConfirmAttendance staffId={s.id} status={s.status} /></span></div>))}</div>
        </div>

        {/* Patient Census */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Patient Census</h3>
          <div className="grid grid-cols-2 gap-1.5 mb-3"><Mini label="Current Patients" value={ce.totalPatients} /><Mini label="Expected Admissions" value={ce.expectedAdmissions} tone="text-amber-600" /><Mini label="Planned Discharges" value={ce.plannedDischarges} /><Mini label="Projected Peak" value={ce.projectedPeak} /></div>
          <p className="text-[10px] text-gray-500">Occupied beds <b className="text-gray-800">{ce.occupiedBeds}/{ce.totalBeds}</b>{ce.occupancyPct != null ? ` · ${ce.occupancyPct}%` : ""}</p>
          <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden mt-1"><div className="h-full bg-emerald-500" style={{ width: `${ce.occupancyPct ?? 0}%` }} /></div>
        </div>

        {/* Alerts & Gaps */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>🔔</span>Alerts &amp; Gaps</h3>
          {d.alertsGaps.length === 0 ? <p className="text-sm text-gray-400">No alerts or gaps. 🎉</p> : <div className="space-y-2">{d.alertsGaps.slice(0, 5).map((a: any, i: number) => (<div key={i} className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-gray-800">{a.label}</p><p className="text-[10px] text-gray-500">{a.detail}</p></div><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV[a.sev]}`}>{a.sev}</span></div>))}</div>}
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Patient Acuity */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Patient Acuity</h3>
          <div className="flex items-center gap-3">
            <div className="relative w-20 h-20 shrink-0"><div className="w-20 h-20 rounded-full" style={{ background: `conic-gradient(${acuStops})` }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{ce.totalPatients}</span><span className="text-[7px] text-gray-400">Total</span></div></div>
            <div className="text-[11px] space-y-0.5 flex-1">{ac.levels.map((l: any) => (<div key={l.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: ACU[l.tone] }} /><span className="text-gray-600 flex-1 truncate">{l.label}</span><b>{l.n}</b></div>))}<div className="flex items-center gap-1.5 pt-0.5"><span className="text-gray-400">⚕</span><span className="text-gray-600 flex-1">One-to-one</span><b>{ac.oneToOne}</b></div></div>
          </div>
        </div>

        {/* Demand Calculation */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Demand Calculation</h3>
          <div className="flex items-center gap-3">
            <div className="text-[11px] space-y-1 flex-1">{[["Minimum FTE", dm.minRequired], ["Recommended", dm.recommended], ["Available", dm.availableFte], ["Min gap", dm.minGap], ["Rec. gap", dm.recGap]].map(([l, v]) => (<div key={l as string} className="flex items-center justify-between"><span className="text-gray-500">{l}</span><b className="text-gray-800">{v ?? "—"}</b></div>))}</div>
            <Ring pct={dm.coverage} label={dm.coverage != null && dm.coverage >= 100 ? "Met" : "Below rec."} tone={dm.coverage != null && dm.coverage >= 90 ? "#10b981" : "#f97316"} />
          </div>
        </div>

        {/* Competency Readiness */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Competency Readiness</h3>
          {d.competencyReadiness.length === 0 ? <p className="text-sm text-gray-400">No staff on shift.</p> : (
            <table className="w-full text-[11px]"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1 font-medium">Role</th><th className="py-1 text-right font-medium">Req</th><th className="py-1 text-right font-medium">Avail</th><th className="py-1 text-right font-medium">✓</th></tr></thead>
              <tbody>{d.competencyReadiness.map((c: any) => (<tr key={c.role} className="border-b border-gray-50"><td className="py-1 text-gray-700">{c.role}</td><td className="py-1 text-right text-gray-600">{c.required}</td><td className="py-1 text-right text-gray-600">{c.available}</td><td className="py-1 text-right">{c.ok ? <span className="text-emerald-600">✓</span> : <span className="text-rose-500">✗</span>}</td></tr>))}</tbody>
            </table>
          )}
          <p className="text-[9px] text-gray-400 mt-2">Role competency currency (competency_decisions). Specialty-competency matrix next-phase.</p>
        </div>

        {/* Actions */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Actions</h3>
          <div className="space-y-1.5">
            {[["Open Staff Allocation", "/supervisor/team-assignments"], ["View Competency Gaps", "/unit-manager/scheduling-engine/competency-matching"], ["Demand Calculation", "/unit-manager/scheduling-engine/demand-optimiser"], ["Escalate Issue", "/supervisor/operations?section=safety"]].map(([l, h]) => (<Link key={l} href={h} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-700 hover:border-emerald-200 hover:bg-emerald-50/30">{l}<span className="text-gray-300">›</span></Link>))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100"><ActivateButton shiftId={d.shift?.id ?? null} ready={d.mandatoryDone} phase={d.phase} /><p className="text-[9px] text-gray-400 mt-1.5 text-center">All validations must be complete to activate.</p></div>
        </div>
      </div>

      {/* Row 3 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Operational Workload */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Operational Workload <span className="text-[10px] text-gray-400 font-normal">today</span></h3>
          <div className="grid grid-cols-2 gap-2">{d.workload.map((wk: any) => (<div key={wk.label} className="flex items-center gap-2 rounded-lg border border-gray-100 p-2"><span>{wk.icon}</span><span className="text-xs text-gray-600 flex-1">{wk.label}</span><b className="text-gray-900">{wk.n}</b></div>))}</div>
          <p className="text-[9px] text-gray-400 mt-2">Rounds from schedule; admissions/discharges/transfers/theatre from movement events + census forecast.</p>
        </div>

        {/* Shift Readiness */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✅</span>Shift Readiness</h3>
          <div className="flex items-center gap-4">
            <Ring pct={d.readinessPct} label={d.mandatoryDone ? "Ready" : "Not ready"} tone={d.mandatoryDone ? "#10b981" : "#f59e0b"} big={`${d.readinessPct}%`} />
            <div className="text-[11px] space-y-0.5 flex-1">{d.checklist.map((c: any) => (<div key={c.label} className="flex items-center gap-1.5"><span className={c.ok ? "text-emerald-600" : c.mandatory ? "text-rose-500" : "text-amber-500"}>{c.ok ? "✓" : c.mandatory ? "✗" : "!"}</span><span className={c.ok ? "text-gray-600" : "text-gray-500"}>{c.label}</span></div>))}</div>
          </div>
        </div>

        {/* Handover Summary */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Handover Summary <span className="text-[10px] text-gray-400 font-normal">to incoming shift</span></h3>
          <div className="space-y-1.5 text-xs">{d.handoverSummary.map((h: any) => (<div key={h.label} className="flex items-center justify-between"><span className="text-gray-600">{h.label}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${h.value === "Completed" ? "bg-emerald-50 text-emerald-700" : h.ok ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{h.value}</span></div>))}</div>
          <Link href="/supervisor/handover" className="text-[11px] text-emerald-700 hover:underline mt-3 inline-block">Open Handover Centre →</Link>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 border-t border-gray-100 pt-3"><span>ℹ️</span>The Shift Planning &amp; Activation Centre (SSW-SPA-001 / SPA-000) orchestrates information from multiple modules — all operational data remains in its original source systems (roster→WSE-001B, attendance→Workforce Ops, census/acuity→Patient Ops, competency→Competency Platform, tasks→Task Centre, escalations→Quality &amp; Safety). Activation is gated on readiness; every planning action is audited. Immutable per-shift activation snapshots are a next-phase addition (snapshots currently live in <Link href="/supervisor/shift-operations" className="text-emerald-700 hover:underline">Shift Operations</Link>).</div>
    </div>
  );
}
