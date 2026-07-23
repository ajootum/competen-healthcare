import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendanceExceptions } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";
import { RaiseButtons, ExceptionRegister } from "./ExceptionActions";

export const dynamic = "force-dynamic";

// Attendance Exceptions (UMW-WFM-005 §18) — real over op_attendance_exceptions (migration 083).
// Live-detected exceptions (no-show, supervisor absent, severe lateness) can be RAISED into the
// stateful register, then progressed (review → resolve / escalate). Formal governance connects
// to UMW-WFM-006. Disputes retain evidence until resolved (BR-ATT-011).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function AttendanceExceptions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadAttendanceExceptions(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Attendance Exceptions</h1><p className="text-sm text-gray-500">Attendance conditions needing review, resolution or escalation.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p></div></div>;

  const critical = d.openPersisted.filter((e: any) => e.severity === "critical").length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open (register)" value={d.openPersisted.length} tone={d.openPersisted.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical" value={critical} tone={critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Detected (unraised)" value={d.derived.length} tone={d.derived.length ? "text-amber-600" : undefined} />
        <Kpi label="Total logged" value={d.persisted.length} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Detected — raise to register <span className="text-[10px] text-gray-400 font-normal">live over attendance state</span></h3>
          <RaiseButtons derived={d.derived} />
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exception register <span className="text-[10px] text-gray-400 font-normal">stateful lifecycle</span></h3>
          <ExceptionRegister rows={d.openPersisted} />
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Attendance Exceptions (UMW-WFM-005 §18) — detection is live over op_shift_staff + op_attendance_events; raising persists into op_attendance_exceptions with a review → resolve / escalate lifecycle. Awaiting-evidence/HR review + formal governance connect to <Link href="/unit-manager/action-centre" className="text-emerald-700 hover:underline">Exceptions &amp; Approvals</Link> (UMW-WFM-006, next-phase). <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
