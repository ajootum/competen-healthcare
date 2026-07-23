import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadFutureAvailability, AVAIL_LABEL } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";
import AvailabilityActions from "./AvailabilityActions";

export const dynamic = "force-dynamic";

// Future Availability (UMW-WFM-005 §19) — declared availability is real over op_staff_availability
// (migration 083): managers record availability windows (with source + confidence), and the tab
// summarises available / unavailable / expiring declarations. The forward roster-coverage risk
// heatmap needs future-roster + pending-leave joins → still honest next-phase. Predictive absence
// must always be labelled an estimate, never a disciplinary fact (BR-ATT-012).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const AVAIL_TONE: Record<string, string> = { unavailable: "bg-rose-50 text-rose-700", temporarily_unavailable: "bg-amber-50 text-amber-700", on_call: "bg-sky-50 text-sky-700", standby: "bg-sky-50 text-sky-700" };
const fmtD = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
const HORIZONS = ["Next shift", "Next 24h", "Next 72h", "Next 7 days", "Next 14 days", "Current roster period", "Next roster period"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function FutureAvailability() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadFutureAvailability(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Future Availability</h1><p className="text-sm text-gray-500">Declared availability and upcoming availability risks.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Availability store not provisioned</p><p className="text-sm text-amber-800 mt-1">Migration 083 (op_staff_availability) is required.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Active declarations" value={d.total} />
        <Kpi label="Unavailable" value={d.unavailable} tone={d.unavailable ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Expiring ≤7d" value={d.expiringSoon} tone={d.expiringSoon ? "text-amber-600" : undefined} />
        <Kpi label="Available pool" value={d.byType.filter((t: any) => !["unavailable", "temporarily_unavailable"].includes(t.type)).reduce((n: number, t: any) => n + t.count, 0)} tone="text-violet-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Declared availability <span className="text-[10px] text-gray-400 font-normal">source + confidence · §13.3</span></h3>
          {d.declarations.length === 0 ? <p className="text-sm text-gray-400">No availability declarations yet — record one on the right.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Availability</th><th className="py-2 pr-3 font-medium">Period</th><th className="py-2 pr-3 font-medium">Expires</th><th className="py-2 font-medium">Source</th></tr></thead>
              <tbody>{d.declarations.map((a: any) => (<tr key={a.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{a.staff_name ?? "Staff"}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${AVAIL_TONE[a.availability_type] ?? "bg-emerald-50 text-emerald-700"}`}>{AVAIL_LABEL[a.availability_type] ?? a.availability_type}</span></td><td className="py-2 pr-3 text-gray-500">{a.period_start ? `${fmtD(a.period_start)}–${fmtD(a.period_end)}` : "—"}</td><td className="py-2 pr-3 text-gray-500">{fmtD(a.expires_at)}</td><td className="py-2 text-gray-400 text-[11px]">{(a.confidence ?? "").replace(/_/g, " ")}</td></tr>))}</tbody>
            </table></div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Record availability</h3>
          <AvailabilityActions picker={d.picker} />
          <p className="text-[10px] text-gray-400 mt-3">Recorded as manager-confirmed (§13.3). Self-service staff declaration + verification workflow are next-phase.</p>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Forward roster-coverage risk <span className="text-[10px] text-gray-400 font-normal">§19.2-3</span></h3>
        <p className="text-[11px] text-gray-500">Availability declarations above are live. The forward risk heatmap (staffing requirement vs confirmed-available vs likely-attendance per date/shift/role) needs future-roster + pending-leave joins — available today in <Link href="/unit-manager/workforce-management/roster-governance/coverage" className="text-emerald-700 hover:underline">Roster Governance → Coverage &amp; Safety</Link>. Predictive absence must be labelled an estimate, never a disciplinary fact (BR-ATT-012).</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{HORIZONS.map(h => (<span key={h} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-500">{h}</span>))}</div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Future Availability (UMW-WFM-005 §19). Declared availability is real over op_staff_availability; the forward risk heatmap is next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
