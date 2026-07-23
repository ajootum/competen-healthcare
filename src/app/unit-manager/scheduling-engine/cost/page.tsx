import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCostEngine } from "@/lib/operations/cost-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Cost Optimisation Engine (WSE-001F) — prices the generated roster from a transparent,
// configurable role-rate model (base £/hr + night differential + overtime premium),
// derives overtime, projected agency spend, an establishment-based budget with variance,
// cost per patient day, month-end projection and savings recommendations. Never
// compromises safety. Real payroll/pay-grades/agency-contract/budget stores → next-phase;
// the rate model is shown verbatim so every figure is auditable.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Overview", "Labour Cost", "Overtime", "Agency & Float", "Skill Mix Cost", "Budget Compliance", "Recommendations", "Variance & Forecast", "Audit & History", "Settings"];
const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurses", nurse: "Registered Nurses", support: "Support Staff", float: "Float Pool", doctor: "Doctors", therapist: "Allied Health", educator: "Educators", assessor: "Assessors" };
const money = (n: number | null) => (n == null ? "—" : `£${n.toLocaleString()}`);

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function CostEngine() {
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
        <div className="flex items-center gap-2"><span className="text-xl">💷</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Cost Optimisation</h1><p className="text-sm text-gray-500">Cost-effective rostering without compromising safety, competency or fairness.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
      <div className="flex gap-1 overflow-x-auto -mt-1">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-full font-medium ${i === 0 ? "bg-emerald-50 text-emerald-700" : "text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>080</code> and generate a roster — the Cost Engine prices it.</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className={`${card} p-8 text-center`}><p className="text-3xl mb-2">💷</p><p className="text-sm font-semibold text-gray-700">No roster to cost for week of {d.weekStart}</p><p className="text-xs text-gray-400 mt-1">Generate a roster in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> — cost analysis runs over it.</p></div></div>;

  const k = d.kpis; const m = d.model;
  const overBudget = k.variance != null && k.variance > 0;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total labour cost" value={money(k.totalLabour)} sub="This week" icon="💷" />
        <Kpi label="Budget vs actual" value={k.variance != null ? `${overBudget ? "+" : ""}${money(k.variance)}` : "—"} sub={k.weeklyBudget != null ? `Budget ${money(k.weeklyBudget)}` : "n/a"} icon="🎯" tone={overBudget ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Overtime cost" value={money(k.overtimePremium)} sub={`${k.overtimeHours} OT hours`} icon="⏰" tone={k.overtimePremium ? "text-amber-600" : undefined} />
        <Kpi label="Agency spend (proj.)" value={money(k.agencyProjected)} sub={`${k.agencyShifts} uncovered post(s)`} icon="🏥" tone={k.agencyProjected ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Cost / patient day" value={money(k.costPerPatientDay)} sub="Labour only" icon="🛏️" />
        <Kpi label="Projected month-end" value={money(k.monthEnd)} sub="× 4.33 weeks" icon="📅" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Labour cost by role */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Labour cost by role <span className="text-[10px] text-gray-400 font-normal">roster week {d.weekStart}</span></h3>
          {d.roleBreakdown.length === 0 ? <p className="text-sm text-gray-400">No assignments to cost.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Rate £/hr</th><th className="py-2 pr-3 font-medium text-right">Hours</th><th className="py-2 pr-3 font-medium text-right">Cost</th><th className="py-2 font-medium text-right">% of labour</th></tr></thead>
              <tbody>{d.roleBreakdown.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{ROLE_LABEL[r.role] ?? r.role}</td><td className="py-2 pr-3 text-right text-gray-500">£{m.roleRate[r.role] ?? m.blendedRate}</td><td className="py-2 pr-3 text-right text-gray-600">{r.hours}</td><td className="py-2 pr-3 text-right font-semibold text-gray-800">{money(r.cost)}</td><td className="py-2 text-right text-gray-500">{r.pct}%</td></tr>))}</tbody>
              <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-2 pr-3 text-gray-800" colSpan={3}>Total (incl. night differential + overtime)</td><td className="py-2 pr-3 text-right text-emerald-600" colSpan={2}>{money(k.totalLabour)}</td></tr></tfoot>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Rates are configurable defaults (base £/hr by role · night +{Math.round((m.nightMultiplier - 1) * 100)}% · overtime ×{m.overtimeMultiplier} above {m.contractHoursWeek}h/wk · agency ×{m.agencyMultiplier}). A per-tenant payroll/finance store is next-phase.</p>
        </div>

        {/* Budget compliance */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Budget compliance</h3>
          {k.weeklyBudget == null ? <p className="text-sm text-gray-400">No establishment budget available.</p> : (
            <>
              <div className="flex items-end justify-between mb-1"><div><p className="text-[10px] text-gray-500 uppercase">Actual</p><p className="text-lg font-bold text-gray-900">{money(k.totalLabour)}</p></div><div className="text-right"><p className="text-[10px] text-gray-500 uppercase">Budget</p><p className="text-lg font-bold text-gray-500">{money(k.weeklyBudget)}</p></div></div>
              <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${overBudget ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.round((k.totalLabour / k.weeklyBudget) * 100))}%` }} /></div>
              <p className={`text-xs mt-2 font-semibold ${overBudget ? "text-rose-600" : "text-emerald-600"}`}>{overBudget ? "Over budget by " : "Under budget by "}{money(Math.abs(k.variance))} ({Math.round((k.variance / k.weeklyBudget) * 100)}%)</p>
              <p className="text-[10px] text-gray-400 mt-2">Budget = required establishment FTE × contracted hours × blended rate (establishment-based, not a finance-system budget).</p>
            </>
          )}
        </div>
      </div>

      {/* Savings recommendations */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5"><span>✨</span>AI savings recommendations</h3>{k.totalSavings > 0 && <span className="text-xs font-semibold text-emerald-700">~{money(k.totalSavings)} opportunity</span>}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{d.recs.map((r: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-3"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{r.title}</p>{r.saving != null && r.saving > 0 && <span className="text-[10px] text-emerald-700 font-semibold shrink-0">{money(r.saving)}</span>}</div><p className="text-[11px] text-gray-500 mt-0.5">{r.sub}</p></div>))}</div>
        <p className="text-[10px] text-gray-400 mt-2">Recommendations never violate safety or hard constraints — they optimise cost within the validated roster. Prefer permanent staff before agency; minimise premium overtime.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Cost Optimisation Engine (WSE-001F) prices the generated roster from a transparent role-rate model (base £/hr by role + night differential + overtime premium above the {m.contractHoursWeek}h contract), and derives overtime cost, projected agency spend to cover uncovered posts, an establishment-based budget with variance, cost per patient day and a month-end projection. Optimisation never compromises safety, competency or fairness. Real pay grades, shift differentials, agency contracts and department budgets need a payroll/finance store — the rate assumptions are shown verbatim so every figure is auditable, not a black box. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
