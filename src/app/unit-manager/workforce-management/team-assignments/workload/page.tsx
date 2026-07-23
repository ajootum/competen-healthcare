import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTaWorkload } from "@/lib/operations/team-assignments";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import TeamGovTabs from "../TeamGovTabs";

export const dynamic = "force-dynamic";

// Workload Oversight (TAG-001 §6) — the demand-points workload model. Converts patient +
// acuity + task demand into comparable points and compares with productive staff capacity
// per unit and per assignee. Real over op_patients / op_tasks / op_patient_assignments.
// Weights are surfaced (auditable, not black-box). Forecast + next-4h risk need history →
// honest next-phase; per-ward staff split is an even-split proxy (no staff↔ward map stored).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const WL: Record<string, string> = { Critical: "bg-rose-500", High: "bg-amber-500", Moderate: "bg-sky-500", Low: "bg-emerald-500", "—": "bg-gray-300" };
const WL_BADGE: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Moderate: "bg-sky-50 text-sky-700", Low: "bg-emerald-50 text-emerald-700", "—": "bg-gray-100 text-gray-500" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function WorkloadOversight() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadTaWorkload(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignments · Workload Oversight</h1><p className="text-sm text-gray-500">Analyse demand vs capacity and rebalance workload across units and assignees.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <TeamGovTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">Workload oversight activates once operational patients and assignments are running.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Avg workload index" value={k.avgIndex != null ? `${k.avgIndex}%` : "—"} sub="Across units" tone={k.avgIndex != null && k.avgIndex >= 100 ? "text-rose-600" : k.avgIndex != null && k.avgIndex >= 85 ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Overloaded assignees" value={k.overloaded} sub="Index ≥ 100%" tone={k.overloaded ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Critical units" value={k.criticalUnits} sub="Index ≥ 100%" tone={k.criticalUnits ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Imbalance" value={k.imbalance != null ? `±${k.imbalance}` : "—"} sub="Index spread (σ)" tone={k.imbalance >= 25 ? "text-amber-600" : undefined} />
        <Kpi label="Assignees" value={k.assignees} sub="With active load" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Unit workload */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Unit workload <span className="text-[10px] text-gray-400 font-normal">demand ÷ capacity</span></h3>
          {d.units.length === 0 ? <p className="text-sm text-gray-400">No patient data.</p> : <div className="space-y-2.5">{d.units.map((u: any) => (<div key={u.name}><div className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-28 truncate">{u.name}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${WL[u.status]}`} style={{ width: `${Math.min(100, u.index ?? 0)}%` }} /></div><span className="text-gray-700 w-10 text-right font-semibold">{u.index != null ? `${u.index}%` : "—"}</span><span className={`text-[9px] px-1.5 py-0.5 rounded w-16 text-center ${WL_BADGE[u.status]}`}>{u.status}</span></div><p className="text-[10px] text-gray-400 ml-[7.75rem] mt-0.5">{u.patients} patients · demand {u.demand}pts ({u.patientPts} patient + {u.taskPts} task) · capacity {u.capacity}pts</p></div>))}</div>}
        </div>

        {/* Redistribution recs */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Redistribution recommendations</h3>
          {d.recs.length === 0 ? <p className="text-sm text-gray-400">Workload is reasonably balanced — no safe redistribution recommended.</p> : <div className="space-y-2">{d.recs.map((r: any, i: number) => (<div key={i} className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-gray-800"><span className="px-1.5 py-0.5 rounded bg-white border border-gray-200">{r.from}</span><span className="text-gray-400">→</span><span className="px-1.5 py-0.5 rounded bg-white border border-gray-200">{r.to}</span></div><p className="text-[11px] text-gray-600 mt-1.5">{r.rationale}</p></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-3">Recommendations are advisory and require manager approval before any move. Optimiser with hard-constraint checking + before/after preview is next-phase.</p>
        </div>
      </div>

      {/* Per-assignee workload table */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Staff / team workload <span className="text-[10px] text-gray-400 font-normal">by active assignee · highest first</span></h3>
        {d.assignees.length === 0 ? <p className="text-sm text-gray-400">No active assignments to a named worker yet — allocation runs during Supervisor assignment.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Assignee</th><th className="py-2 pr-3 font-medium text-right">Patients</th><th className="py-2 pr-3 font-medium text-right">High acuity</th><th className="py-2 pr-3 font-medium text-right">Acuity pts</th><th className="py-2 pr-3 font-medium text-right">Demand</th><th className="py-2 pr-3 font-medium text-right">Capacity</th><th className="py-2 pr-3 font-medium text-right">Index</th><th className="py-2 font-medium">Status</th></tr></thead>
            <tbody>{d.assignees.map((a: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{a.name}</td><td className="py-2 pr-3 text-right text-gray-600">{a.patients}</td><td className={`py-2 pr-3 text-right ${a.high ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{a.high || "—"}</td><td className="py-2 pr-3 text-right text-gray-600">{a.acuityPts}</td><td className="py-2 pr-3 text-right text-gray-600">{a.demand}</td><td className="py-2 pr-3 text-right text-gray-400">{a.capacity}</td><td className={`py-2 pr-3 text-right font-semibold ${a.index >= 100 ? "text-rose-600" : a.index >= 85 ? "text-amber-600" : "text-gray-700"}`}>{a.index}%</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${WL_BADGE[a.status]}`}>{a.status}</span></td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Demand points = 1 base per patient + acuity additive (critical {d.weights.critical} · high {d.weights.high} · medium {d.weights.medium} · low {d.weights.low}) + 0.5 per open task. Capacity = {d.capPerNurse} productive points per assignee (transparent assumption; tenant-configurable is next-phase). Unit-level staff is an even-split proxy — no staff↔ward map is stored.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workload Oversight (TAG-001 §6) implements the demand-points model over live op_patients / op_tasks / op_patient_assignments. The unit heat-map by time block, workload trend + forecast band, and the constraint-checked optimiser need per-interval history → honest next-phase. Coverage lives in <Link href="/unit-manager/workforce-management/staffing-engine/coverage" className="text-emerald-700 hover:underline">Real-Time Coverage</Link>. <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
