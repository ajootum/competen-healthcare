import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Planned vs Actual (UMW-WFM-004 §17) — compares the published roster with actual attendance.
// Actual attendance is captured operationally in op_shift_staff / Shift Activation on the
// day, but it is shift-scoped, not linked to the forward-planned weekly roster (there is no
// roster_actual_assignment store, §21.12). Reconciliation is therefore an honest next-phase
// surface: the intended comparison measures + variance categories + real cross-links to where
// actual staffing is confirmed today. Actual attendance must never overwrite the plan (BR-015).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const MEASURES = ["Rostered staff", "Staff who reported", "Absent", "Late", "Left early", "Replaced", "Additional deployed", "Moved to another unit", "Actual supervisor", "Planned vs actual hours", "Planned vs actual skill mix", "Planned vs actual cost"];
const VARIANCE = ["Attended as planned", "Approved replacement", "Unapproved replacement", "Sickness absence", "No-show", "Late arrival", "Early departure", "Cross-unit redeployment", "Overtime extension", "Supervisor change", "Role change", "Cancelled assignment"];

export default async function PlannedVsActual() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Planned vs Actual</h1><p className="text-sm text-gray-500">Compare the published roster with actual attendance and deployment.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Planned-vs-actual reconciliation — next phase</p>
        <p className="text-sm text-amber-800 mt-1">Actual attendance is confirmed operationally on the day (<Link href="/supervisor/shift-activation" className="text-amber-800 underline font-medium">Shift Activation</Link> / <Link href="/supervisor/team-assignments" className="text-amber-800 underline font-medium">Team Assignments</Link> over op_shift_staff), but a store linking day-of attendance back to the forward-planned weekly roster (<span className="font-mono text-[11px]">roster_actual_assignment</span>, §21.12) is not yet provisioned. Reconciliation is shown honestly rather than with fabricated variance. Actual attendance must never overwrite the published roster (BR-015) — the two remain separate records.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Comparison measures <span className="text-[10px] text-gray-400 font-normal">§17.2 · per shift</span></h3>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-600">{MEASURES.map(m => (<div key={m} className="rounded border border-gray-100 px-2 py-1">{m}</div>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Variance categories <span className="text-[10px] text-gray-400 font-normal">§17.3</span></h3>
          <div className="flex flex-wrap gap-1.5">{VARIANCE.map(v => (<span key={v} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{v}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-3">Repeated planned-vs-actual variance feeds demand forecasting, absence/overtime analytics and establishment review (§17.6) once reconciliation is wired.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Planned vs Actual (UMW-WFM-004 §17). The Shift Supervisor confirms actual staff at handover (updating operational status, not the plan, §17.4). <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
