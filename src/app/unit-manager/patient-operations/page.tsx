import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOperations } from "@/lib/operations/patient-operations";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import PosTabs from "./PosTabs";

export const dynamic = "force-dynamic";

// Patient Operations Dashboard (POS-101) — the Unit Manager's real-time operational
// overview of the unit. Every widget is computed once in the shared Patient Operations
// model (loadPatientOperations → loadPatientOps over live op_* data) so the UMW and the
// Shift Supervisor Workspace render the same single source of truth. The AI Operational
// Pressure Score is a transparent rule-based composite (not a trained model); capacity
// forecasting that needs historical rates is an honest next-phase state.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

const BAND_TONE: Record<string, string> = { Normal: "text-emerald-600", Elevated: "text-amber-600", High: "text-rose-600" };
const BAND_RING: Record<string, string> = { Normal: "#10b981", Elevated: "#f59e0b", High: "#ef4444" };

export default async function PatientOperationsDashboard() {
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
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Operations</h1><p className="text-sm text-gray-500">The operational command view of every patient on the unit — admission to discharge.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );

  if (!p.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data yet</p><p className="text-sm text-amber-800 mt-1">Patient Operations activates once the Clinical Operations Engine (op_shifts / op_patients / op_beds) is provisioned and a unit is operating.</p></div></div>;

  const { po, pressure, workload, today } = p;
  const s = po.summary, cap = po.capacity, comp = po.compliance;
  const pendingReviews = po.active.filter((x: any) => x.nextReview || x.overdueObs).length;
  const clinicalAlerts = po.alertQueue.length;

  const kpis: { label: string; value: any; sub?: string; tone?: string; icon?: string }[] = [
    { label: "Current census", value: s.total, sub: `${cap.occPct}% occupancy`, icon: "🧑‍🤝‍🧑" },
    { label: "Admissions today", value: today.admissions ?? "—", sub: today.admissions == null ? "movement log" : "logged", icon: "➕" },
    { label: "Discharges today", value: today.discharges ?? "—", sub: today.discharges == null ? "movement log" : "logged", icon: "🏠" },
    { label: "Transfers today", value: today.transfers ?? "—", sub: today.transfers == null ? "movement log" : "logged", icon: "🔄" },
    { label: "Occupancy", value: `${cap.occPct}%`, sub: `${cap.occupied}/${cap.total} beds`, tone: cap.occPct >= 90 ? "text-rose-600" : cap.occPct >= 80 ? "text-amber-600" : "text-emerald-600", icon: "🛏️" },
    { label: "Available beds", value: cap.available, sub: `${cap.cleaning} cleaning · ${cap.reserved} reserved`, tone: cap.available ? "text-emerald-600" : "text-rose-600", icon: "🔓" },
    { label: "High-risk patients", value: s.highRisk, sub: `${s.critical} critical`, tone: s.highRisk ? "text-rose-600" : "text-gray-400", icon: "⚠️" },
    { label: "Observation compliance", value: comp.observation != null ? `${comp.observation}%` : "—", sub: comp.observation == null ? "no obs data" : comp.observation >= 90 ? "On target" : "Below target", tone: comp.observation != null && comp.observation >= 90 ? "text-emerald-600" : "text-amber-600", icon: "✅" },
    { label: "Pending reviews", value: pendingReviews, sub: `${s.review} due/overdue`, tone: pendingReviews ? "text-amber-600" : "text-gray-400", icon: "🔎" },
    { label: "Clinical alerts", value: clinicalAlerts, sub: `${po.openEsc.length} escalation(s)`, tone: clinicalAlerts ? "text-rose-600" : "text-gray-400", icon: "🚨" },
    { label: "Workload index", value: workload.weighted ?? "—", sub: workload.ratio != null ? `${workload.ratio} pt/nurse` : "no nurse assignments", icon: "⚖️" },
    { label: "Isolation", value: s.isolation, sub: "active precautions", tone: s.isolation ? "text-fuchsia-600" : "text-gray-400", icon: "🧫" },
  ];

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => <Kpi key={k.label} {...k} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* AI Operational Pressure Score */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">✨ Operational Pressure <span className="text-[10px] font-normal text-gray-400">rule-based composite</span></h3>
          <div className="flex items-center gap-4 mt-2">
            <div className="relative w-24 h-24 shrink-0">
              <div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(${BAND_RING[pressure.band]} 0% ${pressure.score}%, #f3f4f6 ${pressure.score}% 100%)` }} />
              <div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-lg font-bold ${BAND_TONE[pressure.band]}`}>{pressure.score}</span><span className="text-[8px] text-gray-400">/ 100</span></div>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${BAND_TONE[pressure.band]}`}>{pressure.band} pressure</p>
              <div className="mt-1.5 space-y-1">
                {pressure.drivers.slice(0, 4).map((d: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-[11px]"><span className="text-gray-600 truncate">{d.label}</span><span className="text-gray-400 tabular-nums ml-2">+{d.pts}</span></div>
                ))}
                {pressure.drivers.length === 0 && <p className="text-[11px] text-gray-400">No active pressure drivers.</p>}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Transparent composite of occupancy, acuity, deterioration, escalations, unassigned patients and bed waits — not a trained model.</p>
        </div>

        {/* Capacity snapshot + forecast (honest) */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Capacity</h3>
          <div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-600">Occupied</span><b>{cap.occupied}/{cap.total} ({cap.occPct}%)</b></div>
          <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden mb-3"><div className={`h-full ${cap.occPct >= 90 ? "bg-rose-500" : cap.occPct >= 80 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, cap.occPct)}%` }} /></div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-50 py-2"><p className="text-lg font-bold text-emerald-700 tabular-nums">{cap.available}</p><p className="text-[10px] text-emerald-600">Available</p></div>
            <div className="rounded-lg bg-sky-50 py-2"><p className="text-lg font-bold text-sky-700 tabular-nums">{cap.expectedVacancies}</p><p className="text-[10px] text-sky-600">Expected free</p></div>
            <div className="rounded-lg bg-amber-50 py-2"><p className="text-lg font-bold text-amber-700 tabular-nums">{cap.expectedDemand}</p><p className="text-[10px] text-amber-600">Expected demand</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Net position from live discharge-ready vs expected-admission counts. A forward capacity forecast needs historical admission/discharge rates — honest next-phase.</p>
        </div>

        {/* Operational Copilot */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">✨ Operational Copilot <span className="text-[10px] font-normal text-gray-400">from live data</span></h3>
          {po.copilot.length === 0 ? <p className="text-sm text-gray-400">No suggestions — the unit is balanced and up to date.</p> : <div className="space-y-2">{po.copilot.slice(0, 6).map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs rounded-lg border border-gray-100 px-3 py-2"><span className="text-gray-700 flex-1 truncate">{c.text}</span><Link href={c.href} className="text-[11px] font-medium text-emerald-700 shrink-0 hover:underline">{c.action} →</Link></div>
          ))}</div>}
        </div>
      </div>

      {/* Clinical alert queue preview */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Clinical alerts</h3><Link href="/unit-manager/patient-operations/safety" className="text-[11px] font-medium text-emerald-700 hover:underline">Clinical Safety Centre →</Link></div>
        {po.alertQueue.length === 0 ? <p className="text-sm text-gray-400">No active clinical alerts. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Patient</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Severity</th><th className="py-1.5 font-medium text-right">Action</th></tr></thead>
            <tbody>{po.alertQueue.slice(0, 8).map((a: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{a.patient}</td><td className="py-1.5 text-gray-600">{a.type}</td><td className="py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${a.severity === "critical" || a.severity === "high" ? "bg-rose-50 text-rose-700" : a.severity === "moderate" || a.severity === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.severity}</span></td><td className="py-1.5 text-right text-emerald-700">{a.action}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Patient Operations Dashboard (POS-101) over the single operational source of truth (op_patients, op_beds, op_patient_assignments, op_observations, op_safety_alerts, op_escalations, op_movement_events). Real: census, occupancy, high-risk, observation compliance, pending reviews, clinical alerts, workload index and the rule-based Operational Pressure Score. Honest next-phase: forward capacity forecasting (needs historical rates). Operational data entry (admission, transfer, discharge) is performed in the <Link href="/supervisor/patient-ops-center" className="text-emerald-700 hover:underline">Patient Operations Centre</Link>.</p>
    </div>
  );
}
