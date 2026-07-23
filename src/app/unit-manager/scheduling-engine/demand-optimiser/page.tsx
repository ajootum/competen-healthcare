import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDemandOptimiser } from "@/lib/operations/demand-optimiser";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Demand Optimiser (WSE-001A) — converts live clinical/operational demand (census,
// acuity, dependency, isolation, occupancy) into validated staffing requirements for the
// Scheduling Engine. Real KPIs, demand-driver breakdown, per-unit demand intensity, role
// requirements and an acuity profile over op_patients/op_beds + the Establishment engine.
// Acuity trend history & multi-horizon forecasting need historical census (next-phase).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Overview", "Demand Drivers", "Unit Demand", "Role Requirements", "Acuity & Complexity", "Demand Trends", "Assumptions", "Simulation", "Audit & History", "Settings"];
const ACUITY_COLOR: Record<string, string> = { Critical: "#ef4444", High: "#f97316", Moderate: "#f59e0b", Stable: "#22c55e" };
const DRIVER_COLOR = ["#8b5cf6", "#ef4444", "#0ea5e9", "#f59e0b"];
const heat = (v: number) => (v >= 80 ? "bg-rose-100 text-rose-800" : v >= 60 ? "bg-amber-100 text-amber-800" : v >= 40 ? "bg-lime-100 text-lime-800" : "bg-emerald-100 text-emerald-800");

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function DemandOptimiser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadDemandOptimiser(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Demand Optimiser</h1><p className="text-sm text-gray-500">Convert live clinical demand into validated staffing requirements for scheduling.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
      <div className="flex gap-1 overflow-x-auto -mt-1">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-full font-medium ${i === 0 ? "bg-emerald-50 text-emerald-700" : "text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No demand data</p><p className="text-sm text-amber-800 mt-1">The Demand Optimiser needs patient census (op_patients) and establishment standards to calculate demand.</p></div></div>;

  const k = d.kpis;
  const driverTotal = d.drivers.reduce((n: number, x: any) => n + x.contribution, 0) || 1;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total patient demand" value={k.totalPatients} sub={`${k.totalDemand} demand units`} icon="🧑" />
        <Kpi label="Average acuity" value={k.avgAcuity != null ? k.avgAcuity : "—"} sub={k.avgAcuityLabel} icon="❤️" tone={k.avgAcuity != null && k.avgAcuity >= 3 ? "text-rose-600" : undefined} />
        <Kpi label="Required FTE" value={k.requiredFte} sub="From demand" icon="📊" />
        <Kpi label="Available FTE" value={k.availableFte} sub="Rostered headcount" icon="👥" />
        <Kpi label="Coverage score" value={k.coverageScore != null ? `${k.coverageScore}%` : "—"} sub={k.vacancyFte > 0 ? `${k.vacancyFte} FTE gap` : "Covered"} icon="🛡️" tone={k.coverageScore != null && k.coverageScore >= 100 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="High acuity" value={k.highAcuity} sub="Drives demand" icon="🔺" tone={k.highAcuity ? "text-rose-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Demand by unit */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Demand by unit</h3>
          {d.demandByUnit.length === 0 ? <p className="text-sm text-gray-400">No unit demand.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Model</th><th className="py-2 pr-3 font-medium text-right">Patients</th><th className="py-2 pr-3 font-medium text-right">Avg acuity</th><th className="py-2 pr-3 font-medium text-right">Req/shift</th><th className="py-2 pr-3 font-medium text-right">Req FTE</th><th className="py-2 font-medium text-right">Intensity</th></tr></thead>
              <tbody>{d.demandByUnit.map((u: any) => (<tr key={u.unit} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{u.unit}</td><td className="py-2 pr-3"><span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{u.demandModel}</span></td><td className="py-2 pr-3 text-right text-gray-600">{u.patients}</td><td className="py-2 pr-3 text-right text-gray-600">{u.avgAcuity ?? "—"}</td><td className="py-2 pr-3 text-right text-gray-700">{u.requiredPerShift}</td><td className="py-2 pr-3 text-right text-gray-700">{u.requiredFte}</td><td className="py-2 text-right"><span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${heat(u.intensity)}`}>{u.intensity}</span></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Demand intensity blends avg acuity (60%) and occupancy (40%) — a per-unit heat index. Required FTE flows to the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p>
        </div>

        {/* Demand drivers */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Top demand drivers</h3>
          {d.drivers.length === 0 ? <p className="text-sm text-gray-400">No demand drivers.</p> : (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden mb-3">{d.drivers.map((x: any, i: number) => <div key={i} style={{ width: `${(x.contribution / driverTotal) * 100}%`, background: DRIVER_COLOR[i % DRIVER_COLOR.length] }} title={`${x.label} ${x.pct}%`} />)}</div>
              <div className="space-y-2">{d.drivers.map((x: any, i: number) => (<div key={i} className="text-xs"><div className="flex items-center justify-between"><span className="text-gray-700 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: DRIVER_COLOR[i % DRIVER_COLOR.length] }} />{x.label}</span><span className="text-gray-500">{x.pct}%</span></div><p className="text-[10px] text-gray-400 ml-3.5">{x.value} · {x.note}</p></div>))}</div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Role requirements */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Role requirements</h3>
          {d.roleReq.length === 0 ? <p className="text-sm text-gray-400">No role demand.</p> : <div className="space-y-2">{d.roleReq.map((r: any) => (<div key={r.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{r.label}</span><span className={r.gap > 0 ? "text-rose-600" : "text-gray-500"}>{r.available}/{r.required} FTE{r.gap > 0 ? ` · −${r.gap}` : ""}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${r.gap > 0 ? "bg-rose-400" : "bg-emerald-500"}`} style={{ width: `${r.required ? Math.min(100, (r.available / r.required) * 100) : 0}%` }} /></div></div>))}</div>}
        </div>

        {/* Acuity profile */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Acuity &amp; complexity profile</h3>
          {d.acuityDist.length === 0 ? <p className="text-sm text-gray-400">No patients in scope.</p> : (
            <>
              <div className="flex h-3 rounded-full overflow-hidden mb-3">{d.acuityDist.map((a: any) => <div key={a.key} style={{ width: `${(a.n / k.totalPatients) * 100}%`, background: ACUITY_COLOR[a.label] }} title={`${a.label}: ${a.n}`} />)}</div>
              <div className="space-y-1">{d.acuityDist.map((a: any) => (<div key={a.key} className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-sm" style={{ background: ACUITY_COLOR[a.label] }} /><span className="text-gray-600 flex-1">{a.label}</span><b>{a.n}</b><span className="text-gray-400">({Math.round((a.n / k.totalPatients) * 100)}%)</span></div>))}</div>
              <p className="text-[10px] text-gray-400 mt-2">Current snapshot. An acuity trend line needs historical census (next-phase).</p>
            </>
          )}
        </div>

        {/* AI insights */}
        <div className={`${card} p-5 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI insights</h3>
          {d.insights.length === 0 ? <p className="text-sm text-gray-400">No insights.</p> : <div className="space-y-2">{d.insights.map((x: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{x.icon}</span><p className="text-xs text-gray-700 flex-1">{x.text}</p></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Demand Optimiser (WSE-001A) converts live clinical demand into validated staffing requirements: total patient demand (census weighted by acuity/isolation/dependency), average acuity, per-unit demand intensity, role requirements and the demand-driver breakdown — all from real op_patients / op_beds + the <Link href="/unit-manager/workforce-management/establishment" className="text-emerald-700 hover:underline">Establishment engine</Link> (nurse ratios by demand model, relief factor, FTE maths). Required FTE feeds the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine (WSE-001B)</Link>. Acuity trend history, multi-horizon forecasting (seasonal / admission-discharge), theatre/OPD activity models and the deep sub-tabs need historical census + booking feeds — honest next-phase. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
