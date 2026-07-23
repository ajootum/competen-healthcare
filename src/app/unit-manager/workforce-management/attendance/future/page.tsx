import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Future Availability (UMW-WFM-005 §19) — upcoming availability risks. Needs future declared
// availability + pending-leave stores (op_shift_staff is current-shift only), so this is an
// honest next-phase surface. Future roster/coverage risk is available in Roster Governance;
// predictive absence must always be labelled an estimate, never a disciplinary fact (BR-ATT-012).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const HORIZONS = ["Next shift", "Next 24h", "Next 72h", "Next 7 days", "Next 14 days", "Current roster period", "Next roster period"];
const WIDGETS = ["Confirmed unavailable staff", "Pending leave requests", "Expiring availability declarations", "Unfilled open shifts", "Critical roles at risk", "Low replacement availability", "High overtime dependency", "Competency gaps", "Planned training conflicts", "High absence-risk shifts", "Staff reaching working-hour limits"];

export default async function FutureAvailability() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Future Availability</h1><p className="text-sm text-gray-500">Upcoming availability risks before they become roster failures.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Future availability risk — next phase</p>
        <p className="text-sm text-amber-800 mt-1">This tab needs forward declared-availability + pending-leave stores; op_shift_staff covers the current shift only. Shown honestly rather than with fabricated future risk. Forward roster coverage risk is available today in <Link href="/unit-manager/workforce-management/roster-governance/coverage" className="text-amber-800 underline font-medium">Roster Governance → Coverage &amp; Safety</Link>. Predictive absence, where enabled, must be labelled an estimate — never a disciplinary fact (BR-ATT-012).</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Planning horizons <span className="text-[10px] text-gray-400 font-normal">§19.1</span></h3>
          <div className="flex flex-wrap gap-1.5">{HORIZONS.map(h => (<span key={h} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{h}</span>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Future risk widgets <span className="text-[10px] text-gray-400 font-normal">§19.2</span></h3>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-600">{WIDGETS.map(w => (<div key={w} className="rounded border border-gray-100 px-2 py-1">{w}</div>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Future Availability (UMW-WFM-005 §19) — next-phase pending forward availability + leave stores. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
