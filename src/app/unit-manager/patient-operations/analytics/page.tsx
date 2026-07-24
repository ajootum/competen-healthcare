import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOperations } from "@/lib/operations/patient-operations";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Operational Analytics (POS-111) — throughput, LOS, occupancy, turnover, observation
// compliance, escalation rate, complexity and workload for the unit, computed from the
// shared operational model. Real: current-state metrics. Trends over time need a metrics
// history the operational store doesn't retain — honest next-phase, not fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

export default async function OperationalAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [p, departments] = await Promise.all([
    loadPatientOperations(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Operational Analytics</h1><p className="text-sm text-gray-500">Throughput, length of stay, occupancy, safety and workload for the unit.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!p.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { po, workload, today } = p;
  const cap = po.capacity, fm = po.flowMetrics, comp = po.compliance;
  const throughput = (today.admissions ?? 0) + (today.discharges ?? 0);
  const escRate = po.active.length ? Math.round((po.openEsc.length / po.active.length) * 100) : 0;
  const complexity = po.active.length ? Math.round(((po.summary.critical * 2 + po.summary.highRisk) / po.active.length) * 100) / 100 : 0;

  const metrics = [
    { label: "Throughput today", value: today.admissions == null ? "—" : throughput, sub: today.admissions == null ? "movement log" : `${today.admissions} in · ${today.discharges} out`, real: today.admissions != null },
    { label: "Average LOS", value: fm.avgLosDays != null ? `${fm.avgLosDays}d` : "—", sub: "from admission events", real: fm.avgLosDays != null },
    { label: "Occupancy", value: `${cap.occPct}%`, sub: `${cap.occupied}/${cap.total} beds`, real: true },
    { label: "Bed turnover", value: fm.avgTurnaroundH != null ? `${fm.avgTurnaroundH}h` : "—", sub: "avg turnaround", real: fm.avgTurnaroundH != null },
    { label: "Observation compliance", value: comp.observation != null ? `${comp.observation}%` : "—", sub: "recorded vs due", real: comp.observation != null },
    { label: "Escalation rate", value: `${escRate}%`, sub: `${po.openEsc.length} open / ${po.active.length} pts`, real: true },
    { label: "Patient complexity", value: complexity, sub: "acuity-weighted index", real: true },
    { label: "Workload index", value: workload.weighted ?? "—", sub: workload.ratio != null ? `${workload.ratio} pt/nurse` : "no assignments", real: workload.weighted != null },
  ];

  // Current acuity distribution (real snapshot).
  const dist = [
    { label: "Critical", n: po.summary.critical, tone: "bg-rose-500" },
    { label: "High risk", n: po.summary.highRisk - po.summary.critical, tone: "bg-orange-400" },
    { label: "Review / obs", n: po.summary.review, tone: "bg-amber-400" },
    { label: "Stable", n: po.active.filter((x: any) => x.state === "Stable").length, tone: "bg-emerald-400" },
  ].filter(d => d.n > 0);
  const distTotal = dist.reduce((n, d) => n + d.n, 0) || 1;

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map(m => <div key={m.label} className={`${card} p-4`}><p className="text-xs text-gray-500">{m.label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${m.real ? "text-gray-900" : "text-gray-300"}`}>{m.value}</p><p className="text-[10px] text-gray-400 mt-0.5">{m.sub}</p></div>)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Acuity distribution */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Current acuity distribution</h3>
          <div className="w-full h-4 rounded-full overflow-hidden flex mb-3">{dist.map(d => <div key={d.label} className={d.tone} style={{ width: `${(d.n / distTotal) * 100}%` }} title={`${d.label}: ${d.n}`} />)}</div>
          <div className="grid grid-cols-2 gap-2">{dist.map(d => <div key={d.label} className="flex items-center gap-1.5 text-xs"><span className={`w-2.5 h-2.5 rounded-sm ${d.tone}`} /><span className="text-gray-600 flex-1">{d.label}</span><b className="tabular-nums">{d.n}</b></div>)}</div>
        </div>

        {/* Trends (honest) */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Trends over time</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center h-[calc(100%-2rem)] flex flex-col items-center justify-center"><p className="text-3xl mb-2 opacity-40">📈</p><p className="text-sm text-gray-500">Throughput, LOS and occupancy trends need a retained metrics history.</p><p className="text-[11px] text-gray-400 mt-1">The operational store holds current state; a time-series warehouse is an honest next-phase build.</p></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Operational Analytics (POS-111) over the shared operational model. Real current-state metrics: throughput, average LOS, occupancy, bed turnover, observation compliance, escalation rate, acuity-weighted complexity and workload index. Honest next-phase: trends over time and benchmarking, which require a retained metrics history / time-series warehouse. Enterprise analytics roll up to the <Link href="/unit-manager/reports" className="text-emerald-700 hover:underline">Executive Reports</Link>.</p>
    </div>
  );
}
