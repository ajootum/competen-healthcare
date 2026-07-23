import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftAssignments } from "@/lib/operations/shift-assignments";
import AssignmentBoard from "./AssignmentBoard";

export const dynamic = "force-dynamic";

// Shift Team Assignments (SSW-TC-TEAM-001) — the Shift Supervisor's operational allocation
// engine. Live ward-grouped assignment board (click-to-assign via the audited, competency-
// validating assignments API), unassigned staff/patients, assignment tools, a derived
// checklist, per-role coverage, breaks and recent reassignments. op_patients has no PHI →
// operational identifiers + acuity only.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Live Assignment Board", "Attendance", "Breaks & Cover", "Reassignments", "Assignment Summary", "Audit & History"];
const cap = (s: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "");

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ShiftTeamAssignments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const unassignedOnly = sp.unassigned === "1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadShiftAssignments(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Team Assignments</h1><p className="text-sm text-gray-500">Create, confirm and manage staff assignments for the current shift.</p></div></div>
        <span className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600/90 text-white cursor-default" title="A formal publish/lock workflow is next-phase — assignments are already live in Current Shift">📣 Publish Assignments</span>
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / operational data</p><p className="text-sm text-amber-800 mt-1">Team assignment activates once an operational shift with patients is running.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Staff on shift" value={`${k.staffOnShift}/${k.staffScheduled}`} sub={k.confirmedPct != null ? `${k.confirmedPct}% confirmed` : ""} icon="👥" />
        <Kpi label="Patients to allocate" value={k.patientsToAllocate} sub="Need assignment" icon="🧑" tone={k.patientsToAllocate ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="High acuity patients" value={k.highAcuity} sub={k.highAcuity === k.highAcuityAssigned ? "All assigned" : `${k.highAcuity - k.highAcuityAssigned} unassigned`} icon="❤️" tone={k.highAcuity && k.highAcuity !== k.highAcuityAssigned ? "text-rose-600" : undefined} />
        <Kpi label="Assignment coverage" value={k.coverage != null ? `${k.coverage}%` : "—"} sub={k.coverage != null && k.coverage >= 90 ? "Good" : "Review"} icon="🛡️" tone={k.coverage != null && k.coverage >= 90 ? "text-emerald-600" : undefined} />
        <Kpi label="Breaks pending" value={k.breaksPending} sub="Need cover" icon="☕" tone={k.breaksPending ? "text-amber-600" : undefined} />
        <Kpi label="Reassignments today" value={k.reassignToday} sub="Completed" icon="🔁" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Board */}
        <div className={`${card} p-5 xl:col-span-3`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-gray-900">Live Assignment Board</h3>
            <div className="flex gap-1">
              <Link href="/supervisor/team-assignments" className={`text-[10px] px-2 py-1 rounded-full ${!unassignedOnly ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}>All</Link>
              <Link href="/supervisor/team-assignments?unassigned=1" className={`text-[10px] px-2 py-1 rounded-full ${unassignedOnly ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}>Unassigned only</Link>
            </div>
          </div>
          <AssignmentBoard columns={d.columns} staff={d.staffPicker} shiftId={d.shiftId} showUnassignedOnly={unassignedOnly} />
        </div>

        {/* Right column */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Unassigned</h3>
            <div className="mb-2"><p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Staff ({d.unassignedStaff.length})</p>{d.unassignedStaff.length === 0 ? <p className="text-[11px] text-gray-400">All present staff assigned.</p> : <div className="space-y-1">{d.unassignedStaff.slice(0, 5).map((s: any) => (<div key={s.id} className="flex items-center justify-between text-[11px]"><span className="text-gray-700 truncate">{s.name} · {cap(s.role)}</span><span className="text-emerald-600 text-[10px]">Available</span></div>))}</div>}</div>
            <div><p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Patients ({d.unassignedPatients.length})</p>{d.unassignedPatients.length === 0 ? <p className="text-[11px] text-gray-400">All patients assigned.</p> : <div className="space-y-1">{d.unassignedPatients.slice(0, 5).map((p: any) => (<div key={p.id} className="flex items-center justify-between text-[11px]"><span className="text-gray-700 truncate">{p.bed ? `Bed ${p.bed} · ` : ""}{p.label}</span><span className={p.acuityBadge === "High" ? "text-rose-600 text-[10px]" : "text-gray-400 text-[10px]"}>{p.acuityBadge}</span></div>))}</div>}</div>
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Assignment tools</h3>
            <div className="space-y-1">{[["Auto-assign (recommended)", "AI best-fit allocations"], ["Create team", "Form a care team"], ["Assign shift roles", "Charge / team leader"], ["Add from float pool", "Allocate float staff"], ["Bulk assign", "Multiple patients / areas"]].map(([l, s]) => (<span key={l} className="flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-2 cursor-default" title="Next phase"><span><span className="text-[11px] text-gray-400 block">{l}</span><span className="text-[9px] text-gray-300">{s}</span></span><span className="text-gray-200">›</span></span>))}</div>
            <p className="text-[10px] text-gray-400 mt-1.5">Manual click-to-assign is live on the board. Auto/bulk allocation is next-phase.</p>
          </div>
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold text-gray-900">Assignment checklist</h3><span className="text-[10px] text-gray-400">{d.checklist.filter((c: any) => c.ok).length}/{d.checklist.length}</span></div>
            <div className="space-y-1">{d.checklist.map((c: any) => (<div key={c.label} className="flex items-center gap-2 text-[11px]"><span className={c.ok ? "text-emerald-600" : "text-gray-300"}>{c.ok ? "✓" : "○"}</span><span className={c.ok ? "text-gray-700" : "text-gray-400"}>{c.label}</span></div>))}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Staff on shift by role</h3>
          <table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Role</th><th className="py-1.5 font-medium text-right">On</th><th className="py-1.5 font-medium text-right">Req</th><th className="py-1.5 font-medium text-right">Cover</th><th className="py-1.5 font-medium text-right">Status</th></tr></thead>
            <tbody>{d.staffByRole.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{r.label}</td><td className="py-1.5 text-right text-gray-600">{r.on}</td><td className="py-1.5 text-right text-gray-600">{r.required}</td><td className="py-1.5 text-right font-semibold">{r.coverage != null ? `${r.coverage}%` : "—"}</td><td className="py-1.5 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${r.status === "Good" ? "bg-emerald-50 text-emerald-700" : r.status === "Fair" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{r.status}</span></td></tr>))}</tbody>
          </table>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Breaks &amp; cover</h3>
          {d.breaks.length === 0 ? <p className="text-sm text-gray-400">No breaks scheduled{" "}<Link href="/supervisor/workforce-operations#break" className="text-emerald-700 hover:underline">manage breaks →</Link></p> : <div className="space-y-1.5">{d.breaks.slice(0, 6).map((b: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{b.name}</span><span className="text-gray-500">{b.at}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${b.status === "Needs cover" ? "bg-amber-50 text-amber-700" : b.status === "On break" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{b.status}</span></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent reassignments</h3>
          {d.reassignments.length === 0 ? <p className="text-sm text-gray-400">No assignments recorded yet.</p> : <div className="space-y-1.5">{d.reassignments.slice(0, 6).map((r: any, i: number) => (<div key={i} className="text-xs"><div className="flex items-center justify-between"><span className="text-gray-800 font-medium truncate">{r.patient}</span><span className="text-gray-400">{r.at}</span></div><p className="text-[11px] text-gray-500">By {r.by}{r.override && <span className="text-amber-600"> · override</span>}</p></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Shift Team Assignments (SSW-TC-TEAM-001) is the Shift Supervisor&apos;s operational allocation engine — click-to-assign patients to present clinicians through the audited /api/operations/assignments route, which enforces competency validation (an emergency override with reason is required for unvalidated staff) and keeps one active primary clinician per patient. Cards show operational identifiers + acuity only (op_patients holds no PHI). Live in the healthcare worker&apos;s <Link href="/supervisor/current-shift" className="text-emerald-700 hover:underline">Current Shift</Link>. Drag-and-drop, auto/bulk allocation, ward-zone teams, a formal publish/lock workflow and the deep sub-tabs are honest next-phase. <Link href="/supervisor/shift-operations" className="text-emerald-700 hover:underline">← Shift Command</Link></p>
    </div>
  );
}
