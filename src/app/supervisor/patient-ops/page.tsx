import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps } from "@/lib/operations/patient-ops";

export const dynamic = "force-dynamic";

// Patient Operations Dashboard (SSW-PO-001 §1) — the read-only operational
// overview of the unit: KPIs, patient-journey stages, bottlenecks and the
// clinical-safety summary, all from the shared Patient Operations model. Detailed
// action opens the relevant module or Patient Card. Shift-completion metrics need
// the Phase-3 shift-updates table and are shown as an honest placeholder for now.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const card = "bg-white rounded-xl border border-gray-200 p-5";

// Map the stored current_stage onto the spec's patient-journey buckets.
const JOURNEY: { label: string; stages: string[] }[] = [
  { label: "Admission", stages: ["expected_admission", "awaiting_bed", "admitted", "in_care"] },
  { label: "Assessment", stages: ["assessment"] },
  { label: "Treatment", stages: ["treatment", "theatre", "transfer_pending"] },
  { label: "Recovery", stages: ["recovery"] },
  { label: "Discharge Ready", stages: ["discharge_ready"] },
];

export default async function PatientOperationsDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const po = await loadPatientOps(admin, hid, isSuper);
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Patient Operations Dashboard</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );
  const { summary, capacity, safetyBanner, flow, blockers, active } = po;

  // Today's movement counts (fail-soft pre-migration 050).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since = today.toISOString();
  const mScope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const countEv = async (t: string) => { const { count, error } = await mScope(admin.from("op_movement_events").select("id", { count: "exact", head: true })).eq("event_type", t).gte("created_at", since); return error ? 0 : (count ?? 0); };
  const [admitToday, dischToday, transferToday] = await Promise.all([countEv("admission"), countEv("discharge"), countEv("transfer")]);

  const journey = JOURNEY.map(j => ({ label: j.label, n: active.filter((p: any) => j.stages.includes(p.stage)).length }));

  const kpis: { label: string; n: any; sub?: string; tone: string; href: string }[] = [
    { label: "Current patients", n: summary.total, tone: "text-gray-900", href: "/supervisor/patient-list" },
    { label: "Admissions today", n: admitToday, tone: "text-sky-600", href: "/supervisor/patient-flow" },
    { label: "Discharges today", n: dischToday, tone: "text-teal-600", href: "/supervisor/patient-flow" },
    { label: "Transfers today", n: transferToday, tone: "text-indigo-600", href: "/supervisor/patient-flow" },
    { label: "Bed occupancy", n: `${capacity.occPct}%`, sub: `${capacity.occupied}/${capacity.total}`, tone: capacity.occPct >= 90 ? "text-red-600" : "text-gray-900", href: "/supervisor/bed-management" },
    { label: "Available beds", n: capacity.available, tone: "text-blue-600", href: "/supervisor/bed-management" },
    { label: "High-risk patients", n: summary.highRisk, tone: summary.highRisk ? "text-red-600" : "text-gray-400", href: "/supervisor/clinical-safety" },
    { label: "PEWS escalations", n: safetyBanner.pewsAlerts, tone: safetyBanner.pewsAlerts ? "text-orange-600" : "text-gray-400", href: "/supervisor/clinical-safety" },
    { label: "Overdue observations", n: safetyBanner.overdueObs, tone: safetyBanner.overdueObs ? "text-red-600" : "text-gray-400", href: "/supervisor/clinical-safety" },
    { label: "Delayed discharges", n: summary.dischargesExpected, tone: "text-amber-600", href: "/supervisor/patient-flow" },
  ];

  const bottlenecks = [
    { label: "Awaiting bed", n: flow.awaitingBed.length },
    { label: "Transfer pending", n: flow.transferTheatre.length },
    { label: "Discharge ready", n: flow.dischargeReady.length },
    { label: "Bed cleaning delay", n: capacity.cleaning },
    ...blockers.slice(0, 4).map((b: any) => ({ label: b.label, n: 1, detail: b.detail })),
  ].filter(b => b.n > 0);

  const safety = [
    ["Rapid response", safetyBanner.rapidResponse], ["PEWS escalations", safetyBanner.pewsAlerts], ["Deteriorating", safetyBanner.deteriorating],
    ["Overdue observations", safetyBanner.overdueObs], ["Medication", safetyBanner.medication], ["Falls risk", safetyBanner.falls],
    ["Isolation", safetyBanner.isolation], ["Pressure injury", safetyBanner.pressure],
  ] as [string, number][];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Patient Operations Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time operational overview of the unit</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(k => (
          <Link key={k.label} href={k.href} className={card + " py-4 hover:border-teal-300 transition-colors"}>
            <p className={`text-3xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-xs text-gray-500 mt-1 leading-tight">{k.label}</p>
            {k.sub && <p className="text-[10px] text-gray-400">{k.sub}</p>}
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Patient journey */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Patient journey</h3>
          <div className="flex items-stretch gap-1">
            {journey.map((j, i) => (
              <div key={j.label} className="flex-1 flex items-center gap-1">
                <div className="flex-1 rounded-lg border border-gray-100 text-center py-3">
                  <p className="text-2xl font-bold tabular-nums text-gray-900">{j.n}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{j.label}</p>
                </div>
                {i < journey.length - 1 && <span className="text-gray-300 text-xs">→</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">By current operational stage. Set a patient&apos;s stage from the Patient Card.</p>
        </div>

        {/* Bottlenecks */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Operational bottlenecks</h3>
          <div className="space-y-1.5">
            {bottlenecks.length === 0 && <p className="text-sm text-gray-400">No bottlenecks — flow is clear.</p>}
            {bottlenecks.map((b: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{b.label}{b.detail ? <span className="text-gray-400"> · {b.detail}</span> : null}</span>
                <span className="font-semibold tabular-nums text-amber-600">{b.n}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/patient-flow" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Open Patient Flow →</Link>
        </div>

        {/* Clinical safety summary */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Clinical safety summary</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {safety.map(([l, n]) => (
              <div key={l} className="flex items-center justify-between">
                <span className="text-gray-600">{l}</span>
                <span className={`font-semibold tabular-nums ${n ? "text-red-600" : "text-gray-300"}`}>{n}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/clinical-safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Open Clinical Safety →</Link>
        </div>

        {/* Shift completion — Phase 3 */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Shift completion</h3>
          <p className="text-sm text-gray-500">Patients reviewed, updates due/overdue and handover completion activate with <span className="font-medium text-gray-700">Patient Shift Management</span> (next phase). The census, safety and flow above are live now.</p>
          <Link href="/supervisor/patient-list" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Open Patient Census →</Link>
        </div>
      </div>
    </div>
  );
}
