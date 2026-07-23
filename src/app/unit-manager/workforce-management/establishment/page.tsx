import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import WfmTabs from "../WfmTabs";

export const dynamic = "force-dynamic";

// Workforce Establishment & Demand Planning Engine (UMW-WFM-000A) — determines required
// FTE before rostering. Computes establishment from real bed capacity + occupancy +
// ratios (op_beds / op_staffing_standards / op_patients) using transparent, configurable
// planning assumptions (relief factor, contracted hours, leave), all surfaced in the UI.
// A per-tenant configuration store + demand-model time-series are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function EstablishmentEngine() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📐</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Establishment &amp; Demand Planning</h1><p className="text-sm text-gray-500">Calculate required FTE, relief factor and staffing demand before rostering.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No bed / staffing data</p><p className="text-sm text-amber-800 mt-1">The engine needs bed capacity (op_beds) and staffing standards (op_staffing_standards) to calculate establishment.</p></div></div>;

  const k = d.kpis; const m = d.model; const a = d.assumptions;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Required FTE" value={k.totalRequired} sub="Budgeted establishment" icon="📊" />
        <Kpi label="Available FTE" value={k.totalAvailable} sub="Rostered headcount" icon="👥" />
        <Kpi label="Vacancy (gap)" value={k.vacancyFte > 0 ? `${k.vacancyFte}` : "0"} sub={k.vacancyFte > 0 ? "FTE short" : "Fully covered"} icon="⚠️" tone={k.vacancyFte > 0 ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Coverage compliance" value={k.coverageCompliance != null ? `${k.coverageCompliance}%` : "—"} sub={k.coverageCompliance != null && k.coverageCompliance >= 100 ? "Met" : "Below establishment"} icon="🛡️" tone={k.coverageCompliance != null && k.coverageCompliance >= 100 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Relief factor" value={k.reliefFactor} sub="Leave / sickness cover" icon="🔁" />
        <Kpi label="Open positions" value={k.openPositions} sub="Whole posts" icon="🪑" tone={k.openPositions ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Establishment summary */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Establishment summary <span className="text-[10px] text-gray-400 font-normal">by unit</span></h3>
          {d.units.length === 0 ? <p className="text-sm text-gray-400">No units with bed capacity / staffing standards.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Demand model</th><th className="py-2 pr-3 font-medium text-right">Beds</th><th className="py-2 pr-3 font-medium text-right">Occ</th><th className="py-2 pr-3 font-medium text-right">Direct FTE</th><th className="py-2 pr-3 font-medium text-right">Supervisor</th><th className="py-2 pr-3 font-medium text-right">Float</th><th className="py-2 font-medium text-right">Total FTE</th></tr></thead>
              <tbody>{d.units.map((u: any) => (<tr key={u.unit} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{u.unit}</td><td className="py-2 pr-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{u.demandModel}</span></td><td className="py-2 pr-3 text-right text-gray-600">{u.capacity}</td><td className="py-2 pr-3 text-right text-gray-600">{u.occupancyPct != null ? `${u.occupancyPct}%` : u.occupied}</td><td className="py-2 pr-3 text-right text-gray-700">{u.directFte}</td><td className="py-2 pr-3 text-right text-gray-700">{u.supervisorFte}</td><td className="py-2 pr-3 text-right text-gray-600">{u.floatFte}</td><td className="py-2 text-right font-bold text-gray-900">{u.totalFte}</td></tr>))}</tbody>
              <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-2 pr-3 text-gray-800" colSpan={7}>Total required establishment</td><td className="py-2 text-right text-emerald-600">{k.totalRequired} FTE</td></tr></tfoot>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Demand model is set per unit from its dominant bed type (ICU acuity / theatre / paediatric / patient-ratio), supplying the default nurse ratio where op_staffing_standards has none. FTE per continuously-staffed post = {m.ftePerPost} (annual post hours ÷ {m.annualProductive} productive hrs). Charge posts are mandatory (≥1/shift); float pool = {a.floatPoolPct}% of direct care.</p>
        </div>

        {/* Planning assumptions */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Planning assumptions</h3>
          <p className="text-[10px] text-gray-400 mb-2">Configurable defaults driving every calculation (a per-tenant config store is next-phase).</p>
          <div className="space-y-1 text-[11px]">
            {[["Contracted hours/week", `${a.contractedHoursWeek}h`], ["Shifts", `${a.shiftHours}h × ${a.shiftsPerDay}/day`], ["Annual leave", `${a.annualLeaveDays} days`], ["Study leave", `${a.studyLeaveDays} days`], ["Sickness allowance", `${a.sicknessDays} days`], ["Public holidays", `${a.publicHolidays} days`], ["Annual contracted hrs", `${m.annualContracted}`], ["Annual productive hrs", `${m.annualProductive}`], ["Relief factor", `${m.reliefFactor}`]].map(([l, v]) => (<div key={l} className="flex items-center justify-between"><span className="text-gray-600">{l}</span><b className="text-gray-800">{v}</b></div>))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Required vs available */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Required vs available FTE</h3>
          {d.requiredVsAvailable.length === 0 ? <p className="text-sm text-gray-400">No establishment computed.</p> : <div className="space-y-2.5">{d.requiredVsAvailable.map((r: any) => (<div key={r.role} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{r.label}</span><span className="text-gray-500">{r.available}/{r.required}{r.coverage != null && ` · ${r.coverage}%`}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(r.coverage ?? 0) >= 100 ? "bg-emerald-500" : (r.coverage ?? 0) >= 80 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.min(100, r.coverage ?? 0)}%` }} /></div></div>))}</div>}
        </div>

        {/* Demand forecast */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Demand forecast <span className="text-[10px] text-gray-400 font-normal">scenarios</span></h3>
          <div className="space-y-2">{d.forecast.map((f: any, i: number) => (<div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5"><div><p className="text-xs font-semibold text-gray-800">{f.label}</p>{f.occDelta != null && f.occDelta > 0 && <p className="text-[10px] text-gray-400">+{f.occDelta}% occupancy</p>}</div><span className="text-sm font-bold text-gray-900">{f.fte} <span className="text-[10px] text-gray-400 font-normal">FTE</span></span></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Occupancy-driven scenarios. A time-series demand forecast needs historical occupancy (next-phase).</p>
        </div>

        {/* Supervisor + ratio compliance */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Supervisor coverage</h3>
            <div className="flex items-center justify-between"><div><p className="text-2xl font-bold text-gray-900">{k.supervisorAvailable}<span className="text-sm text-gray-400"> / {k.supervisorRequired}</span></p><p className="text-[11px] text-gray-400">Charge FTE available / required</p></div><span className={`text-[10px] px-2 py-1 rounded ${k.supervisorAvailable >= k.supervisorRequired ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{k.supervisorAvailable >= k.supervisorRequired ? "Met" : "Short"}</span></div>
            <p className="text-[10px] text-amber-600 mt-2">Supervisor posts are mandatory per shift unless an authorised override exists.</p>
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Ratio compliance</h3>
            {d.ratioCompliance.length === 0 ? <p className="text-[11px] text-gray-400">No nurse ratio standards configured.</p> : <div className="space-y-1 text-[11px]">{d.ratioCompliance.slice(0, 5).map((r: any) => (<div key={r.unit} className="flex items-center justify-between"><span className="text-gray-700 truncate">{r.unit}</span><span className="text-gray-500">{r.ratio ? `1:${r.ratio}` : "min"} · needs {r.requiredNow ?? "—"}</span></div>))}</div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Annual leave impact</h3>
            <div className="grid grid-cols-3 gap-2">
              <div><p className="text-lg font-bold text-gray-900">{d.annualLeaveImpact.coverFte}</p><p className="text-[10px] text-gray-400">FTE to backfill leave</p></div>
              <div><p className="text-lg font-bold text-gray-900">{d.annualLeaveImpact.reliefPortionPct}%</p><p className="text-[10px] text-gray-400">of establishment is relief</p></div>
              <div><p className="text-lg font-bold text-gray-900">{d.annualLeaveImpact.leaveDaysTotal.toLocaleString()}</p><p className="text-[10px] text-gray-400">leave days / year</p></div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{d.annualLeaveImpact.leaveDaysPerFte} days entitlement per FTE — already absorbed into the relief factor ({m.reliefFactor}).</p>
          </div>
        </div>
      </div>

      {/* AI forecast */}
      <div className={`${card} p-4 bg-gradient-to-br from-emerald-50/40 to-white flex items-start justify-between gap-3`}>
        <div className="flex items-start gap-2.5"><span className="text-lg">✨</span><div><p className="text-sm font-bold text-gray-900">AI workforce forecast</p><p className="text-xs text-gray-600 mt-0.5">{d.aiForecast}</p></div></div>
        <span className="text-[10px] text-gray-400 whitespace-nowrap">Advisory</span>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Establishment &amp; Demand Planning Engine (UMW-WFM-000A) is the foundation calculation service beneath the Staffing Engine, Team Assignments and Roster — the single source of truth for workforce demand. It computes FTE establishment from real bed capacity + occupancy (op_beds) and patient-to-staff ratios / minimums (op_staffing_standards), applying a relief factor derived from transparent, configurable planning assumptions (contracted hours, leave, sickness) shown above. &quot;Available FTE&quot; uses rostered headcount as a proxy (no funded-establishment/contract store yet). A per-tenant configuration store, custom demand models, and time-series forecasting are honest next-phase. Every assumption is visible so the numbers are auditable, not a black box. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
