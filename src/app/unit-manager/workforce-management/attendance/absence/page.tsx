import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Absence & Leave (UMW-WFM-005 §15) — manages the OPERATIONAL consequences of absence (it does
// not replace HR leave administration). The absent-today register is real over op_shift_staff;
// absence sub-classification (sick/annual/emergency/etc.), notification workflow and leave
// approval status need a Leave Management store → honest next-phase. Sensitive medical detail is
// never shown (§15.4).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const CLASSIFICATIONS = ["Sick leave", "Annual leave", "Maternity / parental", "Compassionate", "Study leave", "Official duty", "Training", "Emergency leave", "Unpaid leave", "Suspension", "Occupational restriction", "Administrative", "Unauthorised absence", "No-show"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function AbsenceLeave() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadAttendance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Absence &amp; Leave</h1><p className="text-sm text-gray-500">The operational consequences of absence and leave (HR administration stays in HR).</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p></div></div>;

  const absent = d.register.filter((r: any) => r.status === "absent");
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Absent today" value={absent.length} tone={absent.length ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Replacement pool" value={d.kpis.replacements} tone="text-violet-600" />
        <Kpi label="Coverage after" value={d.kpis.coveragePct != null ? `${d.kpis.coveragePct}%` : "—"} tone={d.kpis.coverageState === "Below minimum" ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Pending actions" value={d.kpis.pendingActions} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Absent today <span className="text-[10px] text-gray-400 font-normal">operational register</span></h3>
        {absent.length === 0 ? <p className="text-sm text-gray-400">No confirmed absences on active shifts. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Unit / shift</th><th className="py-2 pr-3 font-medium">Absence type</th><th className="py-2 font-medium">Replacement</th></tr></thead>
            <tbody>{absent.map((r: any) => (<tr key={r.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{r.name}</td><td className="py-2 pr-3 text-gray-500">{r.roleLabel}</td><td className="py-2 pr-3 text-gray-500 capitalize">{r.unit} · {r.shiftType}</td><td className="py-2 pr-3 text-gray-400">Unclassified <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100">needs leave store</span></td><td className="py-2"><Link href="/unit-manager/workforce-management/attendance/replacement" className="text-[10px] font-semibold text-emerald-700 hover:underline">Find cover →</Link></td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Approved leave overrides a roster expectation and creates a conflict if the person remains scheduled (BR-ATT-002). Sensitive medical detail is never shown to operational users (§15.4) — the manager sees only that a person is unavailable and the approved duration.</p>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Absence classification taxonomy <span className="text-[10px] text-gray-400 font-normal">§15.4 · tenant-configurable</span></h3>
        <div className="flex flex-wrap gap-1.5">{CLASSIFICATIONS.map(c => (<span key={c} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{c}</span>))}</div>
        <p className="text-[10px] text-gray-400 mt-3">Absence sub-classification, notification workflow (time/channel/notified-by), expected-return, supporting-document and leave-approval status need a Leave Management store integrating HR → next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Absence &amp; Leave (UMW-WFM-005 §15). The absent register is real; leave classification + workflow are next-phase (HR integration). <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
