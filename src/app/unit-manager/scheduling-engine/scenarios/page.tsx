import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadScenarioPlanner } from "@/lib/operations/scenario-planner";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Scenario Planner (WSE-001G) — what-if workforce modelling. Re-runs the real solver with
// modified inputs (staff absence, patient surge, added bank capacity, budget cut) and
// compares coverage/competency/fairness/quality/cost side-by-side against the baseline,
// WITHOUT altering any live roster. Scenario library, saved versions and free-form scenario
// building are honest next-phase; these are the pre-modelled operational levers.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Scenario Library", "Comparison", "Demand Simulation", "Capacity Simulation", "Budget Impact", "Competency Coverage", "Risk Assessment", "Recommendations", "Audit & History", "Settings"];
const RISK: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-emerald-50 text-emerald-700" };
const delta = (n: number, invert = false) => { const good = invert ? n <= 0 : n >= 0; return <span className={n === 0 ? "text-gray-400" : good ? "text-emerald-600" : "text-rose-600"}>{n > 0 ? "+" : ""}{n}</span>; };
const money = (n: number) => `£${n.toLocaleString()}`;

export default async function ScenarioPlanner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadScenarioPlanner(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🔮</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Scenario Planner</h1><p className="text-sm text-gray-500">Model, compare and evaluate staffing scenarios before changing the roster.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
      <div className="flex gap-1 overflow-x-auto -mt-1">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-full font-medium ${i === 1 ? "bg-emerald-50 text-emerald-700" : "text-gray-300"}`} title={i === 1 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Insufficient planning data</p><p className="text-sm text-amber-800 mt-1">Scenario modelling needs establishment demand + a staff pool.</p></div></div>;

  const base = d.baseline;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Baseline coverage</p><p className="text-2xl font-bold text-gray-900 mt-1">{base.coverage}%</p><p className="text-[11px] text-gray-400">{base.slotsFilled}/{base.slotsTotal} posts</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Baseline quality</p><p className="text-2xl font-bold text-gray-900 mt-1">{base.quality}%</p><p className="text-[11px] text-gray-400">Composite score</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Baseline cost</p><p className="text-2xl font-bold text-gray-900 mt-1">{money(base.estCost)}</p><p className="text-[11px] text-gray-400">Week (solver estimate)</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Staff pool</p><p className="text-2xl font-bold text-gray-900 mt-1">{d.staffPool}</p><p className="text-[11px] text-gray-400">Clinical staff modelled</p></div>
      </div>

      {/* Side-by-side comparison */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Side-by-side scenario comparison <span className="text-[10px] text-gray-400 font-normal">week {d.weekStart} · vs baseline</span></h3>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Scenario</th><th className="py-2 pr-3 font-medium text-right">Coverage</th><th className="py-2 pr-3 font-medium text-right">Δ cov</th><th className="py-2 pr-3 font-medium text-right">Competency</th><th className="py-2 pr-3 font-medium text-right">Fairness</th><th className="py-2 pr-3 font-medium text-right">Quality</th><th className="py-2 pr-3 font-medium text-right">Δ qual</th><th className="py-2 pr-3 font-medium text-right">Cost</th><th className="py-2 pr-3 font-medium text-right">Δ cost</th><th className="py-2 font-medium">Risk</th></tr></thead>
          <tbody>{d.scenarios.map((s: any) => (
            <tr key={s.key} className={`border-b border-gray-50 ${s.isBase ? "bg-gray-50/60" : ""}`}>
              <td className="py-2 pr-3"><p className="font-semibold text-gray-800">{s.name}{s.isBase && <span className="text-[9px] text-gray-400 ml-1">baseline</span>}</p><p className="text-[10px] text-gray-400">{s.desc}</p></td>
              <td className="py-2 pr-3 text-right font-semibold">{s.coverage}%</td>
              <td className="py-2 pr-3 text-right">{s.isBase ? "—" : delta(s.dCoverage)}</td>
              <td className="py-2 pr-3 text-right text-gray-600">{s.competency}%</td>
              <td className="py-2 pr-3 text-right text-gray-600">{s.fairness}%</td>
              <td className="py-2 pr-3 text-right font-semibold">{s.quality}%</td>
              <td className="py-2 pr-3 text-right">{s.isBase ? "—" : delta(s.dQuality)}</td>
              <td className="py-2 pr-3 text-right text-gray-600">{money(s.estCost)}</td>
              <td className="py-2 pr-3 text-right">{s.isBase ? "—" : <span className={s.dCost === 0 ? "text-gray-400" : s.dCost < 0 ? "text-emerald-600" : "text-rose-600"}>{s.dCost > 0 ? "+" : ""}{money(s.dCost)}</span>}</td>
              <td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${RISK[s.risk]}`}>{s.risk}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="text-[10px] text-gray-400 mt-2">Each scenario re-runs the actual solver with modified inputs. Δ compares to baseline. Cost uses the solver&apos;s estimate; full cost detail is in the <Link href="/unit-manager/scheduling-engine/cost" className="text-emerald-700 hover:underline">Cost Engine</Link>.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Coverage bars */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Coverage forecast by scenario</h3>
          <div className="space-y-2">{d.scenarios.map((s: any) => (<div key={s.key} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{s.name}</span><span className="text-gray-500">{s.coverage}%{!s.isBase ? ` (${s.dCoverage > 0 ? "+" : ""}${s.dCoverage})` : ""}</span></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${s.coverage >= 90 ? "bg-emerald-500" : s.coverage >= 80 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${s.coverage}%` }} /></div></div>))}</div>
        </div>

        {/* AI recommendations */}
        <div className={`${card} p-5 xl:col-span-1 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI recommendations</h3>
          {d.insights.length === 0 ? <p className="text-sm text-gray-400">No insights.</p> : <div className="space-y-2">{d.insights.map((x: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{x.icon}</span><p className="text-xs text-gray-700 flex-1">{x.text}</p></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Scenario Planner (WSE-001G) re-runs the real scheduling solver for each modelled scenario — staff absence, patient surge, added bank capacity, budget cut — and compares coverage, competency, fairness, quality and cost against the baseline. Calculations are transient and never alter a live roster. Hypothetical added capacity (bank staff) is a clearly-labelled planning input, not real people. A free-form scenario builder, saved/versioned scenarios and a scenario library are honest next-phase — these are the pre-modelled operational levers. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
