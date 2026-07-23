import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Late Arrival & Early Departure (UMW-WFM-005 §16) — real late arrivals from op_attendance_events
// (minutes-late computed from the shift start on check-in, migration 083). Early departure needs
// an early-departure event + shift-end comparison → honest next-phase; pattern detection needs
// persisted history. Pattern detection is a review prompt, never a disciplinary conclusion (§16.3).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEVERITY = [
  { band: "1–5 min", label: "Informational", tone: "bg-gray-100 text-gray-500", min: 1, max: 5 },
  { band: "6–15 min", label: "Minor", tone: "bg-sky-50 text-sky-700", min: 6, max: 15 },
  { band: "16–30 min", label: "Significant", tone: "bg-amber-50 text-amber-700", min: 16, max: 30 },
  { band: "> 30 min", label: "Severe", tone: "bg-orange-50 text-orange-700", min: 31, max: 99999 },
];
const bandOf = (m: number) => SEVERITY.find(s => m >= s.min && m <= s.max) ?? SEVERITY[0];
const PATTERNS = ["Repeated late arrival", "Repeated early departure", "Frequent Monday/weekend absence", "Absence around leave", "Absence near public holidays", "Recurring missed clock-out", "Repeated correction", "Repeated no-show", "Abnormal attendance across units"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function LateEarly() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Late &amp; Early Departure</h1><p className="text-sm text-gray-500">Real-time management and pattern review of lateness and early departure.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  const late = d.ready ? d.register.filter((r: any) => (r.minutesLate ?? 0) > 0).sort((a: any, b: any) => (b.minutesLate ?? 0) - (a.minutesLate ?? 0)) : [];

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Late arrivals" value={late.length} tone={late.length ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Severe (>30m)" value={late.filter((r: any) => r.minutesLate > 30).length} tone={late.filter((r: any) => r.minutesLate > 30).length ? "text-rose-600" : undefined} />
        <Kpi label="Present" value={d.ready ? d.kpis.present : "—"} tone="text-emerald-600" />
        <Kpi label="Early departures" value="—" tone="text-gray-300" />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Late arrivals <span className="text-[10px] text-gray-400 font-normal">this shift · from check-in time</span></h3>
        {late.length === 0 ? <p className="text-sm text-gray-400">No late arrivals recorded — either everyone was on time, or check-in hasn&apos;t been captured yet on <Link href="/unit-manager/workforce-management/attendance/today" className="text-emerald-700 hover:underline">Today&apos;s Attendance</Link>.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Arrival</th><th className="py-2 pr-3 font-medium text-right">Late by</th><th className="py-2 font-medium">Severity</th></tr></thead>
            <tbody>{late.map((r: any) => { const bnd = bandOf(r.minutesLate); return (<tr key={r.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{r.name}</td><td className="py-2 pr-3 text-gray-500">{r.roleLabel}</td><td className="py-2 pr-3 text-gray-500">{r.unit}</td><td className="py-2 pr-3 text-gray-600">{r.arrivalAt ? new Date(r.arrivalAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td className="py-2 pr-3 text-right font-semibold text-amber-600">{r.minutesLate}m</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${bnd.tone}`}>{bnd.label}</span></td></tr>); })}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Minutes-late is computed from the shift start (op_shifts.starts_at) at check-in. Grace-period + repeat-lateness thresholds are tenant-configurable (§16.1, next-phase). Early departure needs an early-departure event + shift-end comparison (next-phase).</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Lateness severity <span className="text-[10px] text-gray-400 font-normal">§16.1 · configurable</span></h3>
          <div className="space-y-1.5">{SEVERITY.map(s => (<div key={s.band} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5"><span className="text-xs text-gray-700">{s.band}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${s.tone}`}>{s.label}</span></div>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Early-departure workflow <span className="text-[10px] text-gray-400 font-normal">§16.2</span></h3>
          <ul className="space-y-1 text-[11px] text-gray-600 list-disc list-inside">{["Requested departure time", "Reason", "Supervisor recommendation", "Remaining staffing impact", "Replacement/coverage plan", "Approval decision", "Actual departure time", "Hours completed", "Follow-up requirement"].map(x => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Pattern detection <span className="text-[10px] text-gray-400 font-normal">§16.3</span></h3>
          <div className="flex flex-wrap gap-1.5">{PATTERNS.map(p => (<span key={p} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{p}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Pattern detection needs persisted history and produces a review prompt, never an automatic disciplinary conclusion (§16.3 / BR-ATT-012).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Late &amp; Early Departure (UMW-WFM-005 §16) — late arrivals are real from op_attendance_events; early departure + pattern detection are next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
