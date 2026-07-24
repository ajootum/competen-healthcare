import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Roster & Attendance Analytics (UMW-WFM-008 §6.3) — attendance rate, absence, punctuality over
// Workforce Availability & Attendance (WFM-005). Real. Roster publication compliance + stability
// index draw on Roster Governance; multi-period trends need history → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function AttendanceAnalytics() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Roster &amp; Attendance</h1><p className="text-sm text-gray-500">Attendance rate, absence, punctuality and fulfilment.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p></div></div>;

  const k = d.kpis;
  const absenceRate = k.expected ? Math.round((k.absent / k.expected) * 100) : null;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Attendance rate" value={k.presentRate != null ? `${k.presentRate}%` : "—"} sub="Present ÷ expected" tone={k.presentRate != null && k.presentRate >= 90 ? "text-emerald-600" : "text-amber-600"} foot="WF-ATT-001" />
        <Kpi label="Absence rate" value={absenceRate != null ? `${absenceRate}%` : "—"} tone={absenceRate ? "text-rose-600" : "text-emerald-600"} foot="WF-ABS-001" />
        <Kpi label="Late arrivals" value={k.late} tone={k.late ? "text-amber-600" : "text-emerald-600"} foot="WF-PUN-001" />
        <Kpi label="Not reported" value={k.notReported} tone={k.notReported ? "text-amber-600" : undefined} />
        <Kpi label="Coverage after" value={k.coveragePct != null ? `${k.coveragePct}%` : "—"} sub={k.coverageState} foot="WF-COV-001" />
        <Kpi label="Available replacements" value={k.replacements} tone="text-violet-600" />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Expected vs present by role <span className="text-[10px] text-gray-400 font-normal">WA-AT-003</span></h3>
        {d.roleBreakdown.length === 0 ? <p className="text-sm text-gray-400">No role data.</p> : <div className="space-y-2">{d.roleBreakdown.map((rb: any) => { const pct = rb.expected ? Math.round((rb.present / rb.expected) * 100) : 0; return (<div key={rb.role} className="flex items-center gap-3 text-xs"><span className="text-gray-600 w-32 truncate">{rb.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${pct}%` }} /></div><span className="text-gray-700 w-16 text-right">{rb.present}/{rb.expected}{rb.absent ? ` · ${rb.absent} abs` : ""}</span></div>); })}</div>}
        <p className="text-[10px] text-gray-400 mt-2">Roster publication compliance + stability index draw on Roster Governance; multi-period attendance/absence/leave trends need a history store → next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Roster &amp; Attendance (UMW-WFM-008 §6.3) over Workforce Availability &amp; Attendance. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">Open Availability &amp; Attendance ↗</Link> · <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
