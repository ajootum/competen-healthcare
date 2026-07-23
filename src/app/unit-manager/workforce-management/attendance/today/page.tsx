import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";
import AttendanceActions from "./AttendanceActions";

export const dynamic = "force-dynamic";

// Today's Attendance (UMW-WFM-005 §11) — the primary operational attendance register over
// op_shift_staff, with real audited status actions (confirm present / acknowledge / mark absent
// / complete) via the existing shift-staff API. Corrections that preserve the original record +
// check-in timestamps / minutes-late need an attendance-event store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function TodaysAttendance() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Today&apos;s Attendance</h1><p className="text-sm text-gray-500">The operational attendance register — confirm, acknowledge or mark absent.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p><p className="text-sm text-amber-800 mt-1">The attendance register populates from the approved roster once a shift is running.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Expected" value={k.expected} />
        <Kpi label="Present" value={k.present} tone="text-emerald-600" />
        <Kpi label="Not reported" value={k.notReported} tone={k.notReported ? "text-amber-600" : undefined} />
        <Kpi label="Absent" value={k.absent} tone={k.absent ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Late arrivals" value={k.late} tone={k.late ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Completed" value={k.completed} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Attendance register <span className="text-[10px] text-gray-400 font-normal">{d.register.length} rostered · live status</span></h3>
        <AttendanceActions rows={d.register} />
        <p className="text-[10px] text-gray-400 mt-3">Each action logs a timestamped, append-only op_attendance_events row (migration 083) and updates op_shift_staff — minutes-late is computed from the shift start on check-in. Colours are paired with text labels (§11.4). A <span className="text-violet-600 font-medium">Correct</span> is a separate record that preserves the original (§12.1 / BR-ATT-003).</p>
      </div>

      {(d.corrections ?? []).length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent corrections <span className="text-[10px] text-gray-400 font-normal">original preserved</span></h3>
          <div className="space-y-1.5">{d.corrections.map((cr: any) => (<div key={cr.id} className="flex items-center justify-between text-xs rounded-lg border border-violet-100 bg-violet-50/30 p-2"><div><p className="text-gray-700"><span className="capitalize">{(cr.previous_value ?? "").replace(/_/g, " ")}</span> → <span className="font-semibold capitalize">{(cr.corrected_value ?? "").replace(/_/g, " ")}</span></p><p className="text-[10px] text-gray-500">{cr.reason}</p></div><span className="text-[10px] text-gray-400">{cr.entered_by_name ?? "—"} · {new Date(cr.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></div>))}</div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 pb-4">Today&apos;s Attendance (UMW-WFM-005 §11) is real over op_shift_staff — the §39 non-integrated implementation. Row actions confirm present / acknowledge / mark absent / complete through the audited shift-staff API. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
