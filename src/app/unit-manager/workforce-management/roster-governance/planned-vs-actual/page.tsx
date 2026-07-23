import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPlannedVsActualView } from "@/lib/operations/roster-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";
import ActualActions from "./ActualActions";

export const dynamic = "force-dynamic";

// Planned vs Actual (UMW-WFM-004 §17) — compares the published roster with actual attendance,
// real over op_roster_actuals (082). Actual attendance is a SEPARATE record and never overwrites
// the planned roster (BR-EXA-013). Confirm per planned assignment; variances are surfaced.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const VAR: Record<string, string> = { no_show: "bg-rose-50 text-rose-700", sickness: "bg-amber-50 text-amber-700", unapproved_replacement: "bg-rose-50 text-rose-700", late: "bg-amber-50 text-amber-700", early_departure: "bg-amber-50 text-amber-700" };
const fmtD = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function PlannedVsActual() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadPlannedVsActualView(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Planned vs Actual</h1><p className="text-sm text-gray-500">Compare the published roster with actual attendance and deployment.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const confirmedPct = d.plannedPosts ? Math.round((d.confirmed / d.plannedPosts) * 100) : null;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Planned posts" value={d.plannedPosts} />
        <Kpi label="Confirmed actual" value={`${d.confirmed}${confirmedPct != null ? ` · ${confirmedPct}%` : ""}`} tone="text-emerald-600" />
        <Kpi label="Attended as planned" value={d.attended} tone="text-emerald-600" />
        <Kpi label="Variances" value={d.variances.length} tone={d.variances.length ? "text-amber-600" : "text-emerald-600"} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Confirm actual attendance <span className="text-[10px] text-gray-400 font-normal">per planned assignment</span></h3>
        <ActualActions rosterId={d.rosterId} planned={d.planned} />
        <p className="text-[10px] text-gray-400 mt-2">Actual attendance is a separate record and never overwrites the published roster (BR-EXA-013 / §17). Confirming updates operational status; reconciliation at cycle close is next-phase.</p>
      </div>

      {d.variances.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Variances <span className="text-[10px] text-gray-400 font-normal">§17.3</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Variance</th><th className="py-2 font-medium">Reason</th></tr></thead>
            <tbody>{d.variances.map((v: any) => (<tr key={v.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{v.staff_name ?? "—"}</td><td className="py-2 pr-3 text-gray-500">{v.unit_name}</td><td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{fmtD(v.shift_date)} · {v.shift_type}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${VAR[v.attendance_status] ?? "bg-gray-100 text-gray-500"}`}>{(v.attendance_status ?? "").replace(/_/g, " ")}</span></td><td className="py-2 text-gray-500">{v.variance_reason ?? "—"}</td></tr>))}</tbody>
          </table></div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 pb-4">Planned vs Actual (UMW-WFM-004 §17) is real over op_roster_actuals. Repeated variance feeds demand forecasting, absence + fairness analytics (next-phase). <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
