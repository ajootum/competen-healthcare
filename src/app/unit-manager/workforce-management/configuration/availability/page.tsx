import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceConfig } from "@/lib/operations/workforce-config";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import ConfigTabs from "../ConfigTabs";

export const dynamic = "force-dynamic";

// Availability, Leave & Attendance config (UMW-WFM-009 §12-13) — leave entitlement parameters
// are live over wps_config; availability types, clocking sources, grace periods and attendance
// tolerances need an attendance-config store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Param({ label, value, unit }: { label: string; value: any; unit?: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-xs text-gray-600">{label}</span><span className="text-sm font-semibold text-gray-800 tabular-nums">{value}{unit ? <span className="text-[10px] text-gray-400 ml-0.5">{unit}</span> : null}</span></div>;
}

export default async function AvailabilityConfig() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceConfig(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);
  const s = d.settings ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration · Availability, Leave &amp; Attendance</h1><p className="text-sm text-gray-500">Leave entitlement, availability types, clocking and attendance tolerances.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Leave entitlement <span className="text-[10px] text-emerald-600 font-normal">live · wps_config</span></h3>
          <div className="space-y-1.5"><Param label="Annual leave" value={s.annualLeaveDays} unit="days" /><Param label="Study leave" value={s.studyLeaveDays} unit="days" /><Param label="Sickness allowance" value={s.sicknessDays} unit="days" /><Param label="Public holidays" value={s.publicHolidays} unit="days" /></div>
          <Link href="/unit-manager/planning-studio" className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Edit in Planning Studio ↗</Link>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Leave &amp; availability config <span className="text-[10px] text-gray-400 font-normal">§12</span></h3>
          <div className="flex flex-wrap gap-1.5">{["Leave categories", "Notice requirement", "Approval path", "Coverage protection", "Blackout periods", "Availability types", "Recurring availability", "Return-to-work"].map(x => (<span key={x} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{x}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Leave-category catalogue + coverage-protection rules need a leave-config store → next-phase. Leave classification is recorded operationally in <Link href="/unit-manager/workforce-management/attendance/absence" className="text-emerald-700 hover:underline">Availability &amp; Attendance</Link>.</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Attendance tolerances <span className="text-[10px] text-gray-400 font-normal">§13</span></h3>
          <div className="flex flex-wrap gap-1.5">{["Clocking methods", "Clock-source priority", "Late grace period", "Early-departure grace", "Rounding rules", "Missed-clock detection", "Absence statuses", "Overtime trigger"].map(x => (<span key={x} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{x}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Grace periods, rounding + clock-source priority need an attendance-config store — attendance detection runs on op_shift_staff + op_attendance_events today (§13 interpretation policies).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Availability, Leave &amp; Attendance (UMW-WFM-009 §12-13). Leave entitlement is live over wps_config; availability/attendance interpretation config is next-phase. <Link href="/unit-manager/workforce-management/configuration" className="text-emerald-700 hover:underline">← Dashboard</Link></p>
    </div>
  );
}
