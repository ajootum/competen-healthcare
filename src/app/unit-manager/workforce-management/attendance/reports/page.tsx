import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Reports & Analytics (UMW-WFM-005 §21) — real point-in-time analytics (present/absence rates,
// data completeness) over current op_shift_staff; trend reports + exports need a persisted
// attendance-event store → honest next-phase. Analytics must not infer misconduct, expose
// medical detail or rank staff publicly (§21.3).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const REPORTS = ["Daily attendance", "Shift attendance variance", "Monthly summary", "Absence", "Lateness", "Early departure", "No-show", "Overtime attendance", "Replacement utilisation", "Redeployment", "Attendance exception", "Attendance correction", "Attendance by role", "Attendance by shift", "Attendance by employment type", "Leave impact on staffing", "Coverage impact", "Attendance cost", "Repeated pattern", "Data completeness"];

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ReportsAnalytics() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Reports &amp; Analytics</h1><p className="text-sm text-gray-500">Attendance analytics and standard reports.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  const k = d.ready ? d.kpis : null;
  const absenceRate = k && k.expected ? Math.round((k.absent / k.expected) * 100) : null;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Present rate" value={k?.presentRate != null ? `${k.presentRate}%` : "—"} sub="Present ÷ expected" tone={k?.presentRate != null && k.presentRate >= 90 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Absence rate" value={absenceRate != null ? `${absenceRate}%` : "—"} sub="Absent ÷ expected" tone={absenceRate ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Coverage after" value={k?.coveragePct != null ? `${k.coveragePct}%` : "—"} sub="vs requirement" />
        <Kpi label="Data completeness" value={k ? `${Math.round(((k.present + k.absent + k.confirmed) / (k.expected || 1)) * 100)}%` : "—"} sub="Verified status ÷ expected" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Analytics widgets <span className="text-[10px] text-gray-400 font-normal">§21.2 · point-in-time</span></h3>
          <p className="text-[11px] text-gray-500">Present rate, absence rate, coverage-after-attendance and data completeness are real for the current shift. Trend metrics (attendance-rate trend, punctuality, replacement fill rate, time-to-fill, overtime/redeployment dependency) need a persisted attendance-event history store → next-phase.</p>
          <p className="text-[10px] text-gray-400 mt-2">Analytics must not infer misconduct, expose medical detail, rank staff publicly, or treat training/redeployment/authorised duty as absence (§21.3).</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Standard reports <span className="text-[10px] text-gray-400 font-normal">§21.1</span></h3>
          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto pr-1">{REPORTS.map(r => (<div key={r} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1"><span className="text-[10px] text-gray-700">{r}</span><span className="text-[8px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">Soon</span></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Report generation + PDF/XLSX/CSV export need a reporting store.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Reports &amp; Analytics (UMW-WFM-005 §21). Point-in-time rates are real; trend reports + exports are next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
