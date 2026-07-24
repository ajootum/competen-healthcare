import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Planning & Establishment Analytics (UMW-WFM-008 §6.1) — establishment, vacancy, demand vs
// capacity, workforce mix, over the Unit Workforce Planning engine (loadEstablishment). Real.
// Vacancy ageing + establishment change-log need HR position + change-event stores → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function PlanningAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadEstablishment(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Planning &amp; Establishment</h1><p className="text-sm text-gray-500">Establishment, vacancy, demand vs capacity and workforce mix.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No planning data</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Required FTE" value={k.totalRequired} sub="Establishment demand" foot="ⁱ" />
        <Kpi label="Available FTE" value={k.totalAvailable} sub="Current capacity" tone="text-emerald-600" />
        <Kpi label="Vacancy" value={k.vacancyFte} sub={`${k.openPositions} open posts`} tone={k.vacancyFte > 0 ? "text-rose-600" : "text-emerald-600"} foot="WF-VAC-001" />
        <Kpi label="Coverage compliance" value={k.coverageCompliance != null ? `${k.coverageCompliance}%` : "—"} tone={k.coverageCompliance != null && k.coverageCompliance >= 90 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Supervisor FTE" value={`${k.supervisorAvailable}/${k.supervisorRequired}`} sub="Available / required" tone={k.supervisorAvailable < k.supervisorRequired ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Predicted overtime" value={`${k.predictedOvertimeHrs}h`} sub="From vacancy gap" tone={k.predictedOvertimeHrs ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Required vs available by role <span className="text-[10px] text-gray-400 font-normal">WA-PL-003</span></h3>
          {d.requiredVsAvailable.length === 0 ? <p className="text-sm text-gray-400">No role data.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Required</th><th className="py-2 pr-3 font-medium text-right">Available</th><th className="py-2 pr-3 font-medium text-right">Gap</th><th className="py-2 font-medium text-right">Coverage</th></tr></thead>
              <tbody>{d.requiredVsAvailable.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.label}</td><td className="py-2 pr-3 text-right text-gray-600">{r.required}</td><td className="py-2 pr-3 text-right text-gray-700 font-semibold">{r.available}</td><td className={`py-2 pr-3 text-right ${r.gap > 0 ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{r.gap > 0 ? r.gap : "—"}</td><td className="py-2 text-right">{r.coverage != null ? `${r.coverage}%` : "—"}</td></tr>))}</tbody>
            </table></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Capacity scenarios <span className="text-[10px] text-gray-400 font-normal">WA-PL-006</span></h3>
          <div className="space-y-2">{d.forecast.map((f: any) => (<div key={f.label} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 p-2.5"><span className="text-gray-700">{f.label}</span><span className="font-semibold text-gray-800">{f.fte} FTE{f.occDelta ? ` (+${f.occDelta}%)` : ""}</span></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Occupancy-driven scenarios (no time-series). Vacancy ageing + establishment change-log need HR position/change-event stores → next-phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Planning &amp; Establishment (UMW-WFM-008 §6.1) over the Unit Workforce Planning engine. <Link href="/unit-manager/workforce-management/establishment" className="text-emerald-700 hover:underline">Open Unit Workforce Planning ↗</Link> · <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
