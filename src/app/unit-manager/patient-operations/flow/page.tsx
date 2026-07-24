import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, ewsColor } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Patient Flow Command Centre (POS-103) — admissions, transfers, theatre, recovery,
// discharge pipeline for the unit, from the shared operational model (loadPatientOps).
// Real: the flow pipeline, live + logged blockers, active bed turnarounds, average LOS
// and turnaround. Metrics that need event-duration capture (boarding time, transfer
// delay, theatre wait) are honest next-phase, not fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

const COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: "expected", label: "Expected", tone: "bg-gray-50" },
  { key: "awaitingBed", label: "Awaiting bed", tone: "bg-amber-50" },
  { key: "inCare", label: "In care", tone: "bg-emerald-50" },
  { key: "transferTheatre", label: "Transfer / theatre", tone: "bg-indigo-50" },
  { key: "dischargeReady", label: "Discharge ready", tone: "bg-teal-50" },
];

export default async function PatientFlow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [po, departments] = await Promise.all([
    loadPatientOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Flow Command Centre</h1><p className="text-sm text-gray-500">Admissions, transfers, theatre, recovery and discharge — the unit&apos;s movement pipeline.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!po.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { flow, blockers, flowBlockers, flowBlockersReady, turnaround, turnaroundReady, flowMetrics } = po;
  const metrics = [
    { label: "Average LOS", value: flowMetrics.avgLosDays != null ? `${flowMetrics.avgLosDays}d` : "—", real: flowMetrics.avgLosDays != null, note: "from admission events" },
    { label: "Avg turnaround", value: flowMetrics.avgTurnaroundH != null ? `${flowMetrics.avgTurnaroundH}h` : "—", real: flowMetrics.avgTurnaroundH != null, note: "completed cleans" },
    { label: "Delayed discharges", value: flowMetrics.delayedDischarges, real: true, note: "discharge-ready" },
    { label: "Awaiting bed", value: flowMetrics.awaitingBed, real: true, note: "no bed allocated" },
    { label: "Boarding time", value: "—", real: false, note: "needs event durations" },
    { label: "Theatre wait", value: "—", real: false, note: "needs theatre events" },
  ];

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map(m => <div key={m.label} className={`${card} p-4`}><p className="text-xs text-gray-500">{m.label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${m.real ? "text-gray-900" : "text-gray-300"}`}>{m.value}</p><p className="text-[10px] text-gray-400 mt-0.5">{m.note}</p></div>)}
      </div>

      {/* Flow pipeline */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {COLUMNS.map(col => {
          const list = (flow[col.key] ?? []) as any[];
          return (
            <div key={col.key} className={`${card} p-0 overflow-hidden`}>
              <div className={`px-3 py-2 ${col.tone} border-b border-gray-100 flex items-center justify-between`}><span className="text-xs font-bold text-gray-700">{col.label}</span><span className="text-[11px] font-bold text-gray-500 tabular-nums">{list.length}</span></div>
              <div className="p-2 space-y-1.5 min-h-[80px]">
                {list.length === 0 && <p className="text-[11px] text-gray-300 text-center py-4">—</p>}
                {list.slice(0, 12).map((p: any) => (
                  <Link key={p.id} href={`/unit-manager/patient-operations/patient-card?patient=${p.id}`} className="block rounded-lg border border-gray-100 px-2.5 py-1.5 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors">
                    <div className="flex items-center justify-between"><span className="text-xs font-medium text-gray-800 truncate">{p.bed ?? p.label}</span>{p.pews != null && <span className={`text-[11px] font-bold tabular-nums ${ewsColor(p.pews)}`}>{p.pews}</span>}</div>
                    <p className="text-[10px] text-gray-400 truncate">{p.nurse ?? "unassigned"}</p>
                  </Link>
                ))}
                {list.length > 12 && <p className="text-[10px] text-gray-400 text-center">+{list.length - 12} more</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Blockers + turnaround */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Flow blockers <span className="text-[10px] font-normal text-gray-400">delayed discharges &amp; capacity holds</span></h3>
          {(blockers.length === 0 && flowBlockers.length === 0) ? <p className="text-sm text-gray-400">No active flow blockers. 🎉</p> : (
            <div className="space-y-1.5">
              {flowBlockers.map((b: any) => <div key={b.id} className="flex items-center gap-2 text-xs rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" /><span className="font-medium text-gray-700">{b.category}</span><span className="text-gray-500 truncate">{b.op_patients?.label ?? b.detail}</span></div>)}
              {blockers.slice(0, 10).map((b: any, i: number) => <div key={i} className="flex items-center gap-2 text-xs rounded-lg border border-gray-100 px-3 py-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" /><span className="font-medium text-gray-700">{b.label}</span><span className="text-gray-500 truncate">{b.detail}</span></div>)}
            </div>
          )}
          {!flowBlockersReady && <p className="text-[10px] text-gray-400 mt-2">Logged flow-blocker store (migration 048) not provisioned — showing live-detected blockers only.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Bed turnaround <span className="text-[10px] font-normal text-gray-400">active cleans</span></h3>
          {turnaround.length === 0 ? <p className="text-sm text-gray-400">{turnaroundReady ? "No beds in turnaround." : "Turnaround store (migration 049) not provisioned."}</p> : (
            <div className="space-y-1.5">{turnaround.map((t: any) => <div key={t.id} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 px-3 py-2"><span className="font-medium text-gray-700">{t.op_beds?.label ?? t.bed_id}</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{t.stage}</span></div>)}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Patient Flow Command Centre (POS-103) over the shared operational model. Real: the flow pipeline (each patient in exactly one stage), live + logged blockers, active bed turnarounds, average LOS (from admission events) and average turnaround (from completed cleans). Honest next-phase: boarding time, transfer delay, theatre wait and flow-efficiency trends — these need per-event duration capture. Flow actions (admit / transfer / discharge) are performed in the <Link href="/supervisor/patient-flow" className="text-emerald-700 hover:underline">operational Patient Flow</Link> surface.</p>
    </div>
  );
}
