import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import StaffEngineTabs from "../StaffEngineTabs";

export const dynamic = "force-dynamic";

// Staff Availability (WSE-STAFF-001 §8) — the single source of truth for who is available,
// deployable, present, on-break, off or absent right now. Categorises every rostered clinician
// (Appendix C availability states) and surfaces the standby / float pool. Real over
// op_shift_staff + op_staff_breaks via loadWorkforceOps. Rest/fatigue windows, reason-code
// drawers and contact/redeploy actions reuse the audited allocation surfaces → cross-linked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

// Appendix C availability categories
const CAT: Record<string, { label: string; badge: string; dot: string }> = {
  PRESENT: { label: "Present", badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  ON_BREAK: { label: "On break", badge: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  CONFIRMED: { label: "Confirmed", badge: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  ROSTERED: { label: "Rostered", badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  OFF_DUTY: { label: "Off duty", badge: "bg-gray-100 text-gray-400", dot: "bg-gray-300" },
  ABSENT: { label: "Absent", badge: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
};
const categorise = (s: any, onBreak: Set<string>): keyof typeof CAT =>
  s.status === "absent" ? "ABSENT"
    : onBreak.has(s.name) ? "ON_BREAK"
      : s.status === "on_duty" ? "PRESENT"
        : s.status === "confirmed" ? "CONFIRMED"
          : s.status === "off_duty" ? "OFF_DUTY"
            : "ROSTERED";

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function StaffAvailability() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [w, departments] = await Promise.all([
    loadWorkforceOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧑‍⚕️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staffing Engine · Staff Availability</h1><p className="text-sm text-gray-500">Who is available, deployable, present, on break or absent — right now.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <StaffEngineTabs />
    </>
  );

  if (!w.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p><p className="text-sm text-amber-800 mt-1">Staff availability activates once an operational shift with staffing is running.</p></div></div>;

  const onBreakSet = new Set<string>((w.breaks?.onBreakList ?? []).map((b: any) => b.name));
  const board = (w.assignmentBoard as any[]).map(s => ({ ...s, cat: categorise(s, onBreakSet) }));
  const deployable = board.filter(s => s.cat === "PRESENT" && s.competencyOk !== false);
  const counts = board.reduce((m: Record<string, number>, s) => { m[s.cat] = (m[s.cat] ?? 0) + 1; return m; }, {});
  const float = w.floatPool ?? [];
  const floatAvail = float.filter((f: any) => f.status === "Available").length;
  // order: deployable first, then present-but-restricted, break, confirmed, rostered, off, absent
  const ORDER = ["PRESENT", "ON_BREAK", "CONFIRMED", "ROSTERED", "OFF_DUTY", "ABSENT"];
  const sorted = [...board].sort((a, b) => ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || b.patients - a.patients);

  return (
    <div className="space-y-4">
      {header}

      {/* Availability summary (Appendix C) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Deployable now" value={deployable.length} sub="Present & competent" tone="text-emerald-600" />
        <Kpi label="Present" value={counts.PRESENT ?? 0} sub="On the floor" />
        <Kpi label="On break" value={counts.ON_BREAK ?? 0} sub={w.breaks?.overdue ? `${w.breaks.overdue} overdue` : "Relief covered"} tone={w.breaks?.overdue ? "text-amber-600" : undefined} />
        <Kpi label="Confirmed" value={counts.CONFIRMED ?? 0} sub="Awaited on shift" />
        <Kpi label="Standby / float" value={floatAvail} sub={`${float.length} in pool`} tone="text-violet-600" />
        <Kpi label="Absent" value={counts.ABSENT ?? 0} sub="Unavailable" tone={(counts.ABSENT ?? 0) ? "text-rose-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Availability roster */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Availability roster <span className="text-[10px] text-gray-400 font-normal">{board.length} rostered · deployable first</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Availability</th><th className="py-2 pr-3 font-medium">Area</th><th className="py-2 pr-3 font-medium text-right">Load</th><th className="py-2 font-medium">Deployable</th></tr></thead>
            <tbody>{sorted.map((s: any) => { const c = CAT[s.cat]; const dep = s.cat === "PRESENT" && s.competencyOk !== false; return (<tr key={s.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{s.name}</td><td className="py-2 pr-3 text-gray-500 capitalize">{s.role}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${c.badge}`}>{c.label}</span></span></td><td className="py-2 pr-3 text-gray-500">{s.assignment}</td><td className="py-2 pr-3 text-right text-gray-600">{s.patients || "—"}</td><td className="py-2">{dep ? <span className="text-emerald-600 font-semibold">● Yes</span> : s.competencyOk === false ? <span className="text-amber-600" title="Competency gate">◐ Supervised</span> : <span className="text-gray-300">—</span>}</td></tr>); })}</tbody>
          </table></div>
          <p className="text-[10px] text-gray-400 mt-2">Deployable = present clinicians clearing competency gates. Rest/fatigue windows (11h between shifts, max consecutive) and reason-code drawers need a working-time history store → honest next-phase.</p>
        </div>

        {/* Standby pool + break board */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Standby / float pool <span className="text-[10px] text-gray-400 font-normal">{floatAvail} available</span></h3>
            {float.length === 0 ? <p className="text-sm text-gray-400">No float pool staff on this shift.</p> : <div className="space-y-1.5">{float.map((f: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 p-2"><span className="text-gray-700 font-medium">{f.name}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${f.status === "Available" ? "bg-violet-50 text-violet-700" : "bg-gray-100 text-gray-400"}`}>{f.status}</span></div>))}</div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">On break now</h3>
            {(w.breaks?.onBreakList ?? []).length === 0 ? <p className="text-sm text-gray-400">Nobody on break.{w.breaks?.dueForBreak ? ` ${w.breaks.dueForBreak} due.` : ""}</p> : <div className="space-y-1.5">{(w.breaks.onBreakList as any[]).map((b: any) => (<div key={b.id} className="flex items-center justify-between text-xs rounded-lg border border-sky-100 bg-sky-50/40 p-2"><span className="text-gray-700 font-medium">{b.name}</span><span className="text-[10px] text-gray-500 capitalize">{b.role}</span></div>))}</div>}
            <Link href="/supervisor/workforce-operations" className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Break board →</Link>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Staff Availability (WSE-STAFF-001 §8 / Appendix C) categorises every rostered clinician over live op_shift_staff + op_staff_breaks. Deploy, redeploy and status changes run through the audited <Link href="/supervisor/team-assignments" className="text-emerald-700 hover:underline">Team Assignments</Link> and Overview deployment surfaces; rest/fatigue and reason codes need a working-time store (honest next-phase). Coverage impact is in <Link href="/unit-manager/workforce-management/staffing-engine/coverage" className="text-emerald-700 hover:underline">Real-Time Coverage</Link>. <Link href="/unit-manager/workforce-management/staffing-engine" className="text-emerald-700 hover:underline">← Overview</Link></p>
    </div>
  );
}
