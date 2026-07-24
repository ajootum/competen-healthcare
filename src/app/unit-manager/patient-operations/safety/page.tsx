import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Clinical Safety Centre (POS-107) — the unit's live safety monitors and unified alert
// queue from the shared operational model (loadPatientOps). Real: PEWS deterioration,
// overdue observations, medication/falls/pressure alerts, isolation, escalations and the
// prioritised alert queue. Monitors with no operational signal yet (e.g. sepsis screening)
// are shown as honest "not tracked" rather than fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

export default async function ClinicalSafety() {
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
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Clinical Safety Centre</h1><p className="text-sm text-gray-500">Live safety monitors and the prioritised clinical alert queue for the unit.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!po.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const { safetyBanner: sb, alertQueue, compliance, openEsc } = po;
  const monitors = [
    { label: "High PEWS", value: sb.pewsAlerts, tone: sb.pewsAlerts ? "text-rose-600" : "text-emerald-600", tracked: true },
    { label: "Deteriorating", value: sb.deteriorating, tone: sb.deteriorating ? "text-orange-600" : "text-emerald-600", tracked: true },
    { label: "Overdue reviews", value: sb.overdueObs, tone: sb.overdueObs ? "text-amber-600" : "text-emerald-600", tracked: true },
    { label: "Medication", value: sb.medication, tone: sb.medication ? "text-amber-600" : "text-gray-400", tracked: true },
    { label: "Falls", value: sb.falls, tone: sb.falls ? "text-amber-600" : "text-gray-400", tracked: true },
    { label: "Pressure injury", value: sb.pressure, tone: sb.pressure ? "text-amber-600" : "text-gray-400", tracked: true },
    { label: "Isolation", value: sb.isolation, tone: sb.isolation ? "text-fuchsia-600" : "text-gray-400", tracked: true },
    { label: "Rapid response", value: sb.rapidResponse, tone: sb.rapidResponse ? "text-rose-600" : "text-gray-400", tracked: true },
    { label: "Sepsis screen", value: "—", tone: "text-gray-300", tracked: false },
  ];

  return (
    <div className="space-y-5">
      {header}

      {/* Observation compliance banner */}
      <div className={`${card} p-5 flex items-center gap-5 flex-wrap`}>
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 shrink-0">
            <div className="w-20 h-20 rounded-full" style={{ background: `conic-gradient(${compliance.observation != null && compliance.observation >= 90 ? "#10b981" : "#f59e0b"} 0% ${compliance.observation ?? 0}%, #f3f4f6 ${compliance.observation ?? 0}% 100%)` }} />
            <div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{compliance.observation != null ? `${compliance.observation}%` : "—"}</span></div>
          </div>
          <div><p className="text-sm font-bold text-gray-900">Observation compliance</p><p className="text-xs text-gray-500">Recorded vs due/overdue observations</p></div>
        </div>
        <div className="flex-1" />
        <div className="text-right"><p className="text-2xl font-bold text-gray-900 tabular-nums">{openEsc.length}</p><p className="text-xs text-gray-500">open escalations</p></div>
      </div>

      {/* Monitors grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
        {monitors.map(m => <div key={m.label} className={`${card} p-3 text-center`}><p className={`text-2xl font-bold tabular-nums ${m.tone}`}>{m.value}</p><p className="text-[10px] text-gray-500 mt-1 leading-tight">{m.label}</p>{!m.tracked && <p className="text-[8px] text-gray-300 mt-0.5">not tracked</p>}</div>)}
      </div>

      {/* Alert queue */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Prioritised alert queue</h3><Link href="/supervisor/clinical-safety" className="text-[11px] font-medium text-emerald-700 hover:underline">Act on alerts →</Link></div>
        {alertQueue.length === 0 ? <p className="text-sm text-gray-400">No active clinical alerts. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Patient</th><th className="py-1.5 font-medium">Alert</th><th className="py-1.5 font-medium">Severity</th><th className="py-1.5 font-medium">Since</th><th className="py-1.5 font-medium text-right">Action</th></tr></thead>
            <tbody>{alertQueue.map((a: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{a.patientId ? <Link href={`/unit-manager/patient-operations/patient-card?patient=${a.patientId}`} className="text-emerald-700 hover:underline">{a.patient}</Link> : a.patient}</td><td className="py-1.5 text-gray-600">{a.type}</td><td className="py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${a.severity === "critical" || a.severity === "high" || a.severity === "emergency" ? "bg-rose-50 text-rose-700" : a.severity === "moderate" || a.severity === "medium" || a.severity === "urgent" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.severity}</span></td><td className="py-1.5 text-gray-400 tabular-nums">{fmtTime(a.at)}</td><td className="py-1.5 text-right text-emerald-700">{a.action}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Clinical Safety Centre (POS-107) over op_observations / op_safety_alerts / op_escalations. Real: high-PEWS deterioration, overdue observations, medication/falls/pressure-injury alerts, isolation, rapid-response escalations, observation compliance and the prioritised alert queue. Honest next-phase: sepsis screening and other monitors with no operational signal captured yet. Alerts are acknowledged and escalated in the <Link href="/supervisor/clinical-safety" className="text-emerald-700 hover:underline">operational Clinical Safety</Link> surface.</p>
    </div>
  );
}
