import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCostEngine } from "@/lib/operations/cost-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Cost & Utilisation Analytics (UMW-WFM-008 §6.5) — paid/overtime/agency hours + budget variance
// over the Cost engine (WSE-001F). Real. Overtime is PROVISIONAL until payroll reconciliation
// (WF-OT-001); payroll reconciliation status needs the finance integration → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function CostAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadCostEngine(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Cost &amp; Utilisation</h1><p className="text-sm text-gray-500">Paid/overtime/agency hours, budget variance and cost by role.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.provisioned || !d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Cost analytics compute over the generated roster — generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Est. labour" value={`£${(k.totalLabour / 1000).toFixed(1)}k`} sub="This cycle (provisional)" foot="ⁱ" />
        <Kpi label="Budget variance" value={k.variance != null ? `${k.variance >= 0 ? "+" : ""}£${Math.round(k.variance / 100) / 10}k` : "—"} tone={k.variance != null && k.variance > 0 ? "text-rose-600" : "text-emerald-600"} foot="WF-UTL-001" />
        <Kpi label="Overtime hours" value={`${k.overtimeHours}h`} sub={`£${k.overtimePremium.toLocaleString()} premium`} tone={k.overtimeHours ? "text-amber-600" : undefined} foot="WF-OT-001" />
        <Kpi label="Agency projected" value={`£${k.agencyProjected.toLocaleString()}`} sub={`${k.agencyShifts} shifts`} tone={k.agencyProjected ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Cost / patient-day" value={k.costPerPatientDay != null ? `£${k.costPerPatientDay}` : "—"} foot="WF-UTL-001" />
        <Kpi label="Month-end est." value={`£${(k.monthEnd / 1000).toFixed(0)}k`} sub="×4.33 projection" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Cost by role <span className="text-[10px] text-gray-400 font-normal">WA-CO-001</span></h3>
          {(d.roleBreakdown ?? []).length === 0 ? <p className="text-sm text-gray-400">No cost data.</p> : <div className="space-y-1.5">{d.roleBreakdown.slice(0, 8).map((r: any) => (<div key={r.role} className="flex items-center gap-2 text-xs"><span className="text-gray-600 w-16 capitalize truncate">{r.role}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${r.pct}%` }} /></div><span className="text-gray-600 w-16 text-right">£{r.cost.toLocaleString()}</span></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Cost recommendations <span className="text-[10px] text-gray-400 font-normal">WA-CO-007</span></h3>
          {(d.recs ?? []).length === 0 ? <p className="text-sm text-gray-400">No recommendations.</p> : <div className="space-y-2">{d.recs.map((r: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{r.title}</p>{r.saving ? <span className="text-[10px] text-emerald-600 font-semibold">£{r.saving.toLocaleString()}</span> : null}</div><p className="text-[11px] text-gray-500">{r.sub}</p></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Overtime is provisional until payroll reconciliation (WF-OT-001). Cost-reconciliation vs payroll accepted/rejected values needs the finance integration → next-phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Cost &amp; Utilisation (UMW-WFM-008 §6.5) over the Cost engine. <Link href="/unit-manager/scheduling-engine/cost" className="text-emerald-700 hover:underline">Open Cost Optimisation ↗</Link> · <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
