import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadSchedulingEngine } from "@/lib/operations/scheduling-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// AI Workforce Scheduling Engine (WSE-001) — the platform scheduling service's tenant
// dashboard. Scores coverage, competency match, cost, fairness and constraint risk from
// the Establishment engine's demand + live operational data, with rule-based AI
// recommendations. The optimising roster GENERATOR (named staff → future shift slots),
// what-if scenarios and publish/approve need a roster store + solver → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const TABS = ["Overview", "Demand Optimiser", "Scheduling Engine", "Constraints & Rules", "Competency Matching", "Scenario Planner", "What-if Simulator", "Recommendations", "Publish & Approve", "Analytics", "Settings"];
const STATE_BADGE: Record<string, string> = { "Fully Covered": "bg-emerald-50 text-emerald-700", "At Risk": "bg-amber-50 text-amber-700", "Uncovered": "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };
const SEV: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };
const TAG: Record<string, string> = { "High Impact": "bg-emerald-50 text-emerald-700", Cost: "bg-blue-50 text-blue-700", Supervisor: "bg-violet-50 text-violet-700", Risk: "bg-rose-50 text-rose-700", OK: "bg-gray-100 text-gray-500" };

function Ring({ pct, label, tone }: { pct: number | null; label: string; tone: string }) {
  return <div className="relative w-20 h-20 shrink-0"><div className="w-20 h-20 rounded-full" style={{ background: pct != null ? `conic-gradient(${tone} ${pct}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[20%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{pct != null ? `${pct}%` : "—"}</span><span className="text-[7px] text-gray-400 text-center leading-tight">{label}</span></div></div>;
}
function Metric({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function SchedulingEngine() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadSchedulingEngine(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🗓️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI Workforce Scheduling Engine</h1><p className="text-sm text-gray-500">Intelligent scheduling that matches the right people to the right shifts — demand, competency &amp; contract aware.</p></div></div>
        <div className="flex items-center gap-2"><span className="flex items-center gap-1.5 text-[11px] text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" />Online</span><UnitFilters departments={departments} /><span className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600/90 text-white cursor-default" title="Roster generation + publish need a roster store + solver — next phase">✨ Generate Roster</span></div>
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Insufficient planning data</p><p className="text-sm text-amber-800 mt-1">The scheduling engine needs establishment demand (op_beds / op_staffing_standards) and live assignments to compute a schedule.</p></div></div>;

  const c = d.coverage, dm = d.demand, cm = d.competency, cost = d.cost, f = d.fairness, km = d.keyMetrics;
  return (
    <div className="space-y-4">
      {header}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Coverage summary</p><div className="flex items-center gap-3"><Ring pct={c.score} label="Coverage" tone="#10b981" /><div className="text-[11px] space-y-0.5"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Fully covered <b>{c.fullyCovered}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />At risk <b>{c.atRisk}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Uncovered <b>{c.uncovered}</b></div></div></div></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Required vs assigned</p><div className="flex items-center justify-around"><div className="text-center"><p className="text-2xl font-bold text-gray-900">{dm.required}</p><p className="text-[10px] text-gray-400">Required</p></div><div className="text-center"><p className="text-2xl font-bold text-gray-900">{dm.assigned}</p><p className="text-[10px] text-gray-400">Assigned</p></div></div><p className={`text-center text-xs mt-1 ${dm.variance < 0 ? "text-rose-600" : "text-emerald-600"}`}>Variance {dm.variance > 0 ? "+" : ""}{dm.variance}</p></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Competency match</p><div className="flex items-center gap-3"><Ring pct={cm.score} label="Match" tone="#8b5cf6" /><div className="text-[11px] space-y-0.5"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Full <b>{cm.full}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />Override <b>{cm.partial}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />No match <b>{cm.none}</b></div></div></div></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Cost &amp; efficiency</p><p className="text-2xl font-bold text-gray-900">£{cost.estCost.toLocaleString()}</p><p className="text-[10px] text-gray-400">Est. weekly cost</p><div className="flex justify-between text-[11px] mt-1"><span className="text-gray-500">Overtime <b>{cost.overtimeHrsWk}h</b></span><span className="text-gray-500">Agency <b>{cost.agencyShifts}</b></span></div></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Fairness index</p><div className="flex items-center gap-3"><Ring pct={f.score} label="Fairness" tone="#3b82f6" /><div className="text-[11px] space-y-0.5"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Balanced <b>{f.balanced}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />High load <b>{f.highLoad}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Over limit <b>{f.overLimit}</b></div></div></div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Demand by unit */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Demand by unit &amp; shift <span className="text-[10px] text-gray-400 font-normal">required per shift vs currently assigned</span></h3>
          {d.demandByUnit.length === 0 ? <p className="text-sm text-gray-400">No unit demand computed.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit / Area</th><th className="py-2 pr-3 font-medium text-right">Required</th><th className="py-2 pr-3 font-medium text-right">Assigned</th><th className="py-2 pr-3 font-medium text-right">Variance</th><th className="py-2 pr-3 font-medium text-right">Coverage</th><th className="py-2 font-medium text-right">Status</th></tr></thead>
              <tbody>{d.demandByUnit.map((u: any) => (<tr key={u.unit} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{u.unit}</td><td className="py-2 pr-3 text-right text-gray-600">{u.requiredPerShift}</td><td className="py-2 pr-3 text-right text-gray-600">{u.assigned}</td><td className={`py-2 pr-3 text-right ${u.variance < 0 ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{u.variance > 0 ? "+" : ""}{u.variance}</td><td className="py-2 pr-3 text-right font-semibold">{u.coverage != null ? `${u.coverage}%` : "—"}</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATE_BADGE[u.state]}`}>{u.state}</span></td></tr>))}</tbody>
              <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-2 pr-3 text-gray-800">Total</td><td className="py-2 pr-3 text-right">{dm.required}</td><td className="py-2 pr-3 text-right">{dm.assigned}</td><td className={`py-2 pr-3 text-right ${dm.variance < 0 ? "text-rose-600" : ""}`}>{dm.variance > 0 ? "+" : ""}{dm.variance}</td><td className="py-2 pr-3 text-right text-emerald-600">{c.score != null ? `${c.score}%` : "—"}</td><td /></tr></tfoot>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Required = per-shift posts from the Establishment engine; Assigned = distinct staff on active assignments in each unit. Day/night split &amp; the 7-day demand trend come from a generated roster (next-phase).</p>
        </div>

        {/* AI recommendations */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">AI recommendations</h3><span className="text-[10px] text-gray-400">{d.recs.length}</span></div>
          <div className="space-y-2">{d.recs.map((r: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{r.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${TAG[r.tag] ?? "bg-gray-100 text-gray-500"}`}>{r.tag}</span></div><p className="text-[11px] text-gray-500 mt-0.5">{r.sub}</p></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Advisory — no roster is published without Unit Manager approval.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Draft roster (honest) */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Draft roster preview</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center">
            <p className="text-3xl mb-1">🗓️</p>
            <p className="text-sm font-semibold text-gray-700">Roster generation is a next-phase build</p>
            <p className="text-[11px] text-gray-400 mt-1 max-w-lg mx-auto">Generating a named weekly roster (assigning specific staff to each unit&apos;s day/night shift slots) needs an optimising solver and a versioned roster store. Rather than fabricate staff-in-cells, the engine currently surfaces the real demand-vs-coverage above and the constraint risks alongside. The solver, what-if scenarios and publish/approve flow are the next build — the demand foundation (<Link href="/unit-manager/workforce-management/establishment" className="text-emerald-700 hover:underline">Establishment engine</Link>) is already live.</p>
          </div>
        </div>

        {/* Constraint & risk alerts */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Constraint &amp; risk alerts</h3><span className="text-[10px] text-gray-400">{d.alerts.length}</span></div>
          {d.alerts.length === 0 ? <p className="text-sm text-gray-400">No constraint violations detected. 🎉</p> : <div className="space-y-2">{d.alerts.slice(0, 6).map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">⚠</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-800 truncate">{a.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV[a.sev]}`}>{a.sev}</span></div><p className="text-[11px] text-gray-500">{a.sub}</p></div></div>))}</div>}
        </div>
      </div>

      {/* Key metrics */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Key metrics <span className="text-[10px] text-gray-400 font-normal">this week</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
          <Metric label="Staff available" value={`${km.staffAvailableFte} FTE`} />
          <Metric label="Assigned" value={`${km.assignedFte}`} sub="staff" />
          <Metric label="Coverage score" value={km.coverageScore != null ? `${km.coverageScore}%` : "—"} />
          <Metric label="Competency match" value={km.competencyScore != null ? `${km.competencyScore}%` : "—"} />
          <Metric label="Overtime (proj.)" value={`${km.overtimeHrsWk} hrs`} />
          <Metric label="Agency (proj.)" value={`${km.agencyShifts}`} sub="shifts" />
          <Metric label="Est. cost" value={`£${km.estCost.toLocaleString()}`} />
          <Metric label="Roster fairness" value={`${km.fairnessScore}%`} />
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The AI Workforce Scheduling Engine (WSE-001) is the platform scheduling service&apos;s review dashboard. Coverage, required-vs-assigned, competency match, fairness and constraint alerts are computed from the <Link href="/unit-manager/workforce-management/establishment" className="text-emerald-700 hover:underline">Establishment engine</Link>&apos;s demand + live assignments (op_patient_assignments.competency_validated) + expiring competencies; cost/overtime/agency are derived from FTE gaps at a transparent blended rate (£{cost.rate}/hr). The optimising roster generator (named staff → shift slots), what-if simulator, scenario planner and publish/approve workflow need a roster store + solver — honest next-phase. No roster is published without Unit Manager approval; unsafe coverage/competency blocks publication unless an authorised override is recorded. <Link href="/unit-manager" className="text-emerald-700 hover:underline">← Unit Manager</Link></p>
    </div>
  );
}
