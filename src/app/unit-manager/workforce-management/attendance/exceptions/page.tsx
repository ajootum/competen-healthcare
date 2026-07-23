import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Attendance Exceptions (UMW-WFM-005 §18) — a module view of attendance-related exceptions.
// Detection is real over op_shift_staff status (no-show in min role, confirmed absence,
// unverified/not-reported, supervisor absent, coverage below minimum). The stateful lifecycle
// (assign reviewer → evidence → resolve/escalate) connects to UMW-WFM-006 and needs an
// attendance-exception store → honest next-phase; every derived exception is state "New".
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Moderate: "bg-sky-50 text-sky-700", Informational: "bg-gray-100 text-gray-500" };
const DOT: Record<string, string> = { Critical: "bg-rose-500", High: "bg-amber-500", Moderate: "bg-sky-500", Informational: "bg-gray-400" };
const RANK: Record<string, number> = { Critical: 0, High: 1, Moderate: 2, Informational: 3 };

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
    loadAttendance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
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

  // Derive exception register from attendance state (real)
  const rows: { category: string; staff: string; unit: string; severity: string; detail: string; action: string }[] = [];
  for (const r of d.register) {
    if (r.status === "absent" && ["charge", "nurse"].includes(r.role)) rows.push({ category: "No-show in minimum-staffing role", staff: r.name, unit: r.unit, severity: r.role === "charge" ? "Critical" : "High", detail: `${r.roleLabel} · confirmed absent`, action: "Request replacement / HR referral" });
    else if (r.status === "absent") rows.push({ category: "Confirmed absence", staff: r.name, unit: r.unit, severity: "Moderate", detail: `${r.roleLabel} · replacement review`, action: "Review replacement need" });
    if ((r.role === "charge" || r.supervisor) && r.status === "absent") rows.push({ category: "Shift Supervisor absent", staff: r.name, unit: r.unit, severity: "Critical", detail: "No confirmed supervisor on shift", action: "Assign acting supervisor" });
  }
  if (d.kpis.coverageState === "Below minimum") rows.push({ category: "Coverage below minimum", staff: "—", unit: "Unit", severity: "Critical", detail: `${d.kpis.present}/${d.kpis.coverageBasis} present`, action: "Redeploy / open shift" });
  d.register.filter((r: any) => r.status === "assigned").slice(0, 6).forEach((r: any) => rows.push({ category: "Unverified attendance", staff: r.name, unit: r.unit, severity: "Informational", detail: `${r.roleLabel} · not yet reported`, action: "Verify attendance" }));
  rows.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  const sev = (s: string) => rows.filter(r => r.severity === s).length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open exceptions" value={rows.length} tone={rows.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical" value={sev("Critical")} tone={sev("Critical") ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="High" value={sev("High")} tone={sev("High") ? "text-amber-600" : undefined} />
        <Kpi label="Unverified" value={sev("Informational")} tone={sev("Informational") ? "text-gray-600" : undefined} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Exception register <span className="text-[10px] text-gray-400 font-normal">critical first · detected now</span></h3>
        {rows.length === 0 ? <p className="text-sm text-gray-400">No attendance exceptions — everyone is accounted for. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Detail</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 font-medium">Recommended action</th></tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.category}</td><td className="py-2 pr-3 text-gray-800 font-medium">{r.staff}</td><td className="py-2 pr-3 text-gray-500">{r.unit}</td><td className="py-2 pr-3 text-gray-600">{r.detail}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[r.severity]}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.severity]}`}>{r.severity}</span></span></td><td className="py-2 text-gray-500">{r.action}</td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Detection is live over op_shift_staff. Conflicting/duplicate check-ins, missed check-out, wrong-unit attendance and manual-correction exceptions need the attendance-event store. The stateful lifecycle (assign reviewer, evidence, resolve, escalate) connects to <Link href="/unit-manager/action-centre" className="text-emerald-700 hover:underline">Exceptions &amp; Approvals</Link> (UMW-WFM-006) → next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Attendance Exceptions (UMW-WFM-005 §18) derives real exceptions from attendance state; formal governance connects to UMW-WFM-006. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
