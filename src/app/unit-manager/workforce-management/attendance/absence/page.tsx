import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAbsenceLeave } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";
import LeaveActions from "./LeaveActions";

export const dynamic = "force-dynamic";

// Absence & Leave (UMW-WFM-005 §15) — manages the OPERATIONAL consequences of absence (it does
// not replace HR leave administration). The absent register is real over op_shift_staff and each
// absence can be classified into op_leave_records (migration 083) — operational fields only, no
// medical detail (§15.4). Approved leave overrides a roster expectation (BR-ATT-002).
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
    loadAbsenceLeave(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
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

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Kpi label="Absent today" value={d.total} tone={d.total ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Classified" value={`${d.classified}/${d.total}`} tone={d.classified < d.total ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Replacement needed" value={d.replacementOutstanding} tone={d.replacementOutstanding ? "text-amber-600" : undefined} />
        <Kpi label="Replacement pool" value={d.kpis.replacements} tone="text-violet-600" />
        <Kpi label="Coverage after" value={d.kpis.coveragePct != null ? `${d.kpis.coveragePct}%` : "—"} tone={d.kpis.coverageState === "Below minimum" ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Absent today · classify <span className="text-[10px] text-gray-400 font-normal">operational register</span></h3>
        <LeaveActions rows={d.absent} />
        <p className="text-[10px] text-gray-400 mt-2">Classification records an op_leave_records row (operational fields only — no medical detail, §15.4). Approved leave overrides a roster expectation and creates a conflict if the person remains scheduled (BR-ATT-002). Full notification workflow, supporting-document status and HR sync are next-phase.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Absence by type <span className="text-[10px] text-gray-400 font-normal">classified today</span></h3>
          {d.byType.length === 0 ? <p className="text-sm text-gray-400">No absences classified yet.</p> : <div className="space-y-2">{d.byType.map((t: any) => (<div key={t.type} className="flex items-center justify-between text-xs"><span className="text-gray-600">{t.label}</span><span className="font-semibold text-gray-800">{t.count}</span></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Classification taxonomy <span className="text-[10px] text-gray-400 font-normal">§15.4 · tenant-configurable</span></h3>
          <div className="flex flex-wrap gap-1.5">{CLASSIFICATIONS.map(c => (<span key={c} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{c}</span>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Absence &amp; Leave (UMW-WFM-005 §15). Absent register + classification are real over op_shift_staff + op_leave_records; notification workflow + HR sync are next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
