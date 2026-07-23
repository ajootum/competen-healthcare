import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance, ROLE_LABEL } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Staff Availability (UMW-WFM-005 §13) — declared and inferred availability of unit staff.
// Real over op_shift_staff: rostered/present staff are derived-from-roster; off-shift clinical
// staff are the available/redeployable pool. Self-declared availability, preferences, rest-hour
// and overtime eligibility need a Staff Availability Registry → honest next-phase (confidence
// state shown per §13.3).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const CAT: Record<string, { badge: string; dot: string }> = {
  "Rostered (present)": { badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  "Rostered (awaited)": { badge: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  "Available (redeploy/overtime)": { badge: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  "Unavailable (absent)": { badge: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
};

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
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

  const [d, departments] = await Promise.all([
    loadAttendance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Staff Availability</h1><p className="text-sm text-gray-500">Who is rostered, available for redeployment/overtime, or unavailable.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p></div></div>;

  // Build availability rows: on-shift (from register) + off-shift clinical pool
  const onShift = d.register.map((r: any) => ({
    name: r.name, role: r.roleLabel, category: r.status === "on_duty" ? "Rostered (present)" : r.status === "absent" ? "Unavailable (absent)" : "Rostered (awaited)",
    source: "Derived from approved roster", confidence: "Roster-verified", unit: r.unit,
  }));
  const pool = (d.replacementPool ?? []).map((p: any) => ({
    name: p.full_name ?? "Staff", role: ROLE_LABEL[p.role] ?? p.role, category: "Available (redeploy/overtime)",
    source: "Off-shift clinical staff", confidence: "System inferred", unit: "—",
  }));
  const rows = [...onShift, ...pool];
  const catCount = (c: string) => rows.filter(r => r.category === c).length;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Rostered present" value={catCount("Rostered (present)")} tone="text-emerald-600" />
        <Kpi label="Rostered awaited" value={catCount("Rostered (awaited)")} tone="text-sky-600" />
        <Kpi label="Available pool" value={catCount("Available (redeploy/overtime)")} tone="text-violet-600" />
        <Kpi label="Unavailable" value={catCount("Unavailable (absent)")} tone={catCount("Unavailable (absent)") ? "text-rose-600" : undefined} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Availability register <span className="text-[10px] text-gray-400 font-normal">source + confidence shown per §13.3</span></h3>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Availability</th><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 font-medium">Confidence</th></tr></thead>
          <tbody>{rows.map((r, i) => { const c = CAT[r.category]; return (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{r.name}</td><td className="py-2 pr-3 text-gray-500">{r.role}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${c.badge}`}>{r.category}</span></span></td><td className="py-2 pr-3 text-gray-500">{r.source}</td><td className="py-2 text-gray-400 text-[11px]">{r.confidence}</td></tr>); })}</tbody>
        </table></div>
        <p className="text-[10px] text-gray-400 mt-2">Contracted vs declared vs rostered availability (§2) — self-declared availability, preferred/restricted shifts, remaining contracted hours, rest-hour status and overtime eligibility need a Staff Availability Registry (next-phase). The 4-week availability calendar with conflict flags (§14) also needs that store.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Staff Availability (UMW-WFM-005 §13) is real over op_shift_staff attendance state + off-shift clinical pool. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
