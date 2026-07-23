import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWhatIf } from "@/lib/operations/what-if";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";
import SimControls from "./SimControls";

export const dynamic = "force-dynamic";

// What-if Simulator (WSE-001H) — interactive simulation. Managers set parameters (staff
// absences, census surge, added bank capacity); the server re-runs the real solver and
// shows before-vs-after impact plus fatigue and patient-safety risk. Never alters a live
// roster unless explicitly applied. Distinct from the pre-modelled Scenario Planner.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-emerald-50 text-emerald-700" };
const fmt = (v: number, unit: string) => (unit === "£" ? `£${v.toLocaleString()}` : `${v}${unit}`);
const num = (v: any, def = 0, max = 50) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; };

export default async function WhatIfSimulator({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = { absent: num(sp.absent, 0, 20), surge: num(sp.surge, 0, 100), bank: num(sp.bank, 0, 20) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWhatIf(admin, profile?.hospital_id ?? null, isSuper, params) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎛️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">What-if Simulator</h1><p className="text-sm text-gray-500">Evaluate the impact of staffing changes before committing to the live roster.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Insufficient data</p><p className="text-sm text-amber-800 mt-1">Simulation needs establishment demand + a staff pool.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Controls */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Simulation builder</h3>
          <SimControls params={d.params} />
          <div className="mt-3 pt-3 border-t border-gray-100 text-[10px] text-gray-400">Staff pool: {d.staffPool} clinical · week {d.weekStart}. Simulations are transient — the live roster is never altered unless applied.</div>
        </div>

        {/* Before vs after */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Before vs after {d.changed && <span className="text-[10px] text-gray-400 font-normal">{d.params.absent ? `−${d.params.absent} staff · ` : ""}{d.params.surge ? `+${d.params.surge}% census · ` : ""}{d.params.bank ? `+${d.params.bank} bank` : ""}</span>}</h3>
          {!d.changed ? (
            <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center"><p className="text-3xl mb-1">🎛️</p><p className="text-sm font-semibold text-gray-700">Set parameters and press Simulate</p><p className="text-[11px] text-gray-400 mt-1">The solver re-runs with your changes and shows the impact here.</p></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Metric</th><th className="py-2 pr-3 font-medium text-right">Before</th><th className="py-2 pr-3 font-medium text-right">After</th><th className="py-2 font-medium text-right">Change</th></tr></thead>
              <tbody>{d.metrics.map((mt: any) => { const good = mt.invert ? mt.delta <= 0 : mt.delta >= 0; return (<tr key={mt.label} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{mt.label}</td><td className="py-2 pr-3 text-right text-gray-500">{fmt(mt.before, mt.unit)}</td><td className="py-2 pr-3 text-right font-semibold text-gray-800">{fmt(mt.after, mt.unit)}</td><td className={`py-2 text-right font-semibold ${mt.delta === 0 ? "text-gray-400" : good ? "text-emerald-600" : "text-rose-600"}`}>{mt.delta > 0 ? "+" : ""}{fmt(mt.delta, mt.unit)}</td></tr>); })}</tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Risk dashboard */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Risk dashboard</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-gray-800">Patient safety risk</p><p className="text-[11px] text-gray-500">{d.risk.uncoveredSup} shift(s) without supervisor · {d.risk.uncovered} uncovered</p></div><span className={`text-[10px] px-2 py-1 rounded ${RISK[d.risk.safetyRisk]}`}>{d.risk.safetyRisk}</span></div>
            <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-gray-800">Fatigue risk</p><p className="text-[11px] text-gray-500">{d.risk.fatigued} staff over-worked (&gt;4 shifts / ≥5 consec.)</p></div><span className={`text-[10px] px-2 py-1 rounded ${RISK[d.risk.fatigueRisk]}`}>{d.risk.fatigueRisk}</span></div>
          </div>
          {d.changed && (d.risk.safetyRisk !== d.baseRisk.safetyRisk || d.risk.fatigueRisk !== d.baseRisk.fatigueRisk) && <p className="text-[10px] text-amber-600 mt-2">Risk profile changed from baseline (safety {d.baseRisk.safetyRisk}, fatigue {d.baseRisk.fatigueRisk}).</p>}
        </div>

        {/* AI insights */}
        <div className={`${card} p-5 xl:col-span-2 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI insights &amp; recommended actions</h3>
          {d.insights.length === 0 ? <p className="text-sm text-gray-400">No insights.</p> : <div className="space-y-2">{d.insights.map((x: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{x.icon}</span><p className="text-xs text-gray-700 flex-1">{x.text}</p></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The What-if Simulator (WSE-001H) re-runs the real scheduling solver with your interactive parameters (staff absences, census surge, added bank capacity) and shows before-vs-after coverage, competency, fairness, quality, cost, plus fatigue and patient-safety risk. Simulations are isolated from production — the live roster is never altered unless you Apply (which regenerates it from current real data; hypothetical inputs remain planning-only). Concurrent saved simulations, version history and a free-form change builder (shift swaps / ward expansion) are honest next-phase. See the pre-modelled <Link href="/unit-manager/scheduling-engine/scenarios" className="text-emerald-700 hover:underline">Scenario Planner</Link> for standard scenarios. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
