import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Rules & Settings (UMW-WFM-005 §22) — mostly tenant-wide Workforce Configuration. Working-hour
// rules ARE configurable today in the Workforce Planning Studio (WPS-001) → cross-linked and
// real; attendance/lateness, availability, replacement and data-source settings need an
// attendance-config store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const GROUPS = [
  { name: "Attendance settings", cfg: "Grace period, late/early thresholds, no-show trigger, check-in methods, correction approval", live: false },
  { name: "Availability settings", cfg: "Declaration period, minimum notice, open-shift/overtime/standby/on-call rules", live: false },
  { name: "Working-hour rules", cfg: "Max hours/shift/day/week, minimum rest, consecutive/night limits, overtime approval", live: true },
  { name: "Replacement settings", cfg: "Replacement sequence, candidate ranking, approval levels, float/agency, offer expiry", live: false },
  { name: "Data-source settings", cfg: "Biometric, access-control, payroll, HR, mobile/geofence/kiosk/QR, manual register", live: false },
];

export default async function RulesSettings() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const departments = await loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Rules &amp; Settings</h1><p className="text-sm text-gray-500">Attendance, availability, working-hour and replacement configuration.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
        <p className="font-semibold text-emerald-900">✓ Working-hour rules are live in the Workforce Planning Studio</p>
        <p className="text-sm text-emerald-800 mt-1">Max weekly hours, minimum rest, consecutive-shift/night limits and overtime multipliers are already tenant-configurable and versioned in <Link href="/unit-manager/planning-studio" className="text-emerald-900 underline font-medium">Workforce Planning Studio (WPS-001)</Link>, driving the scheduling &amp; governance chain.</p>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Configuration groups <span className="text-[10px] text-gray-400 font-normal">§22</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{GROUPS.map(g => (
          <div key={g.name} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 p-3">
            <div className="min-w-0"><p className="text-xs font-semibold text-gray-800">{g.name}</p><p className="text-[10px] text-gray-400 mt-0.5">{g.cfg}</p></div>
            <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded ${g.live ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{g.live ? "Live" : "Next phase"}</span>
          </div>
        ))}</div>
        <p className="text-[10px] text-gray-400 mt-3">Most tenant-wide settings belong to Workforce Configuration; the Unit Manager may have limited unit-level controls (§22). Attendance/availability/replacement/data-source config needs an attendance-config store → next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Rules &amp; Settings (UMW-WFM-005 §22). Working-hour rules live via WPS-001; attendance-specific config is next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
