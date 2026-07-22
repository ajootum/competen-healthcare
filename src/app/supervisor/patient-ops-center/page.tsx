import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOpsCenter } from "@/lib/operations/patient-ops-center";
import PatientCensusConsole from "./PatientCensusConsole";
import AdmissionsWorkflow from "./AdmissionsWorkflow";

export const dynamic = "force-dynamic";

// Patient Operations Center (SSW-003) — the single operational source for all
// patient information: KPI strip, the interactive patient census + Patient Card
// drawer, patient flow, bed & capacity, high-risk patients, ward map and
// observation compliance, plus the real admissions workflow. Everything is live
// from op_* data; the registry holds no PHI, so identity fields are honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const card = "bg-white rounded-xl border border-gray-200 p-5";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

const ACUITY_DOT: Record<string, string> = { critical: "bg-rose-500", high: "bg-orange-500", moderate: "bg-amber-500", stable: "bg-green-500", low: "bg-green-500" };

export default async function PatientOperationsCenter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const [d, deptRes, availBedRes, moveRes] = await Promise.all([
    loadPatientOpsCenter(admin, hid, isSuper),
    admin.from("departments").select("id, name").eq("hospital_id", hid ?? "").order("name"),
    scope(admin.from("op_beds").select("id, label, status")).eq("status", "available").order("label").limit(200),
    scope(admin.from("op_movement_events").select("id, event_type, detail, created_at, op_patients!patient_id(label)")).order("created_at", { ascending: false }).limit(12),
  ]);
  const movement = (moveRes as any).error ? [] : (moveRes.data ?? []);

  if (!d.ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Patient Operations Center</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet. Once applied, the patient operations centre fills with live data.</p></div>
      </div>
    );
  }

  const k = d.kpis, cap = d.capacity, obs = d.obsCompliance;
  const kpis = [
    ["Total Patients", k.total, "Current census", ""],
    ["High Acuity", k.highAcuity, `${k.total ? Math.round((k.highAcuity / k.total) * 100) : 0}% of patients`, k.highAcuity ? "text-orange-600" : ""],
    ["Critical Risk", k.criticalRisk, "Requiring attention", k.criticalRisk ? "text-rose-600" : ""],
    ["Occupied Beds", `${k.occupied}/${k.totalBeds}`, `${k.occPct}% occupancy`, ""],
    ["Pending Admissions", k.pendingAdmissions, "Awaiting bed", ""],
    ["Pending Discharges", k.pendingDischarges, "To action", ""],
    ["Overdue Observations", k.overdueObs, "Requiring action", k.overdueObs ? "text-rose-600" : ""],
    ["Active Escalations", k.escalations, `${k.criticalEsc} critical`, k.escalations ? "text-amber-600" : ""],
  ];

  const capSegs = [["#3b82f6", cap.occupied], ["#22c55e", cap.available], ["#f59e0b", cap.cleaning], ["#94a3b8", cap.reserved], ["#ef4444", cap.blocked]] as [string, number][];
  const capDonut = (() => { const tot = cap.total || 1; let acc = 0; const st: string[] = []; capSegs.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();
  const obsTot = obs.completed + obs.due + obs.overdue;
  const obsDonut = (() => { const segs = [["#22c55e", obs.completed], ["#f59e0b", obs.due], ["#ef4444", obs.overdue]] as [string, number][]; const tot = obsTot || 1; let acc = 0; const st: string[] = []; segs.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  return (
    <div data-wide className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Operations Center</h1>
        <p className="text-sm text-gray-500">Real-time patient operations and flow management — the single operational source for all patient information</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpis.map(([l, v, sub, tone]: any) => (
          <div key={l} className={`${card} !p-3`}>
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{l}</p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${tone || "text-gray-900"}`}>{v}</p>
            <p className="text-[10px] text-gray-400 truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* Census table + Patient Card drawer */}
      <PatientCensusConsole records={d.records} tabs={d.tabs} />

      {/* Flow · Capacity · High Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={card}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Patient Flow</h3>
          <div className="space-y-1.5 text-sm">
            {[["Pending Admissions", d.flow.pendingAdmissions, "⏳"], ["Admitted Today", d.flow.admittedToday, "✅"], ["Transfers", d.flow.transfers, "🔀"], ["Discharge Pending", d.flow.dischargePending, "📤"]].map(([l, n, ic]: any) => (
              <div key={l} className="flex items-center justify-between"><span className="text-gray-600">{ic} {l}</span><span className="font-bold text-gray-900 tabular-nums">{n}</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Transfer in/out direction &amp; discharged-today need directional flow tracking.</p>
        </div>

        <div className={card}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Bed &amp; Capacity Overview</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: capDonut }}>
              <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900 leading-none">{cap.occupied}/{cap.total}</span><span className="text-[8px] text-gray-400">{k.occPct}% occ.</span></div>
            </div>
            <div className="text-[11px] space-y-1 flex-1">
              {[["Occupied", cap.occupied, "#3b82f6"], ["Available", cap.available, "#22c55e"], ["Cleaning", cap.cleaning, "#f59e0b"], ["Reserved", cap.reserved, "#94a3b8"], ["Blocked", cap.blocked, "#ef4444"]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>
              ))}
            </div>
          </div>
        </div>

        <div className={card}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">High Risk Patients</h3>
          <div className="space-y-1.5">
            {d.highRisk.length === 0 && <p className="text-sm text-gray-400">No high-risk patients.</p>}
            {d.highRisk.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${ACUITY_DOT[r.acuity] ?? "bg-gray-400"}`} />
                <span className="text-gray-800 flex-1 truncate">{r.label} <span className="text-gray-400 text-xs">{r.bed ?? ""}</span></span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${r.acuity === "critical" ? "bg-rose-50 text-rose-700" : "bg-orange-50 text-orange-700"}`}>{tc(r.acuity)}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/clinical-safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View all high risk patients →</Link>
        </div>
      </div>

      {/* Ward Map · Observation Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} lg:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Ward Map</h3>
          {d.wardBeds.length === 0 ? <p className="text-sm text-gray-400">No beds configured.</p> : (
            <>
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {d.wardBeds.map((b: any) => {
                  const tone = ["cleaning", "out_of_service"].includes(b.status) ? "border-gray-200 bg-gray-50" : b.status === "available" ? "border-blue-200 bg-blue-50/40" : b.acuity === "critical" || b.acuity === "high" ? "border-red-200 bg-red-50/40" : b.acuity === "moderate" ? "border-amber-200 bg-amber-50/40" : "border-green-200 bg-green-50/30";
                  const dot = ["cleaning", "out_of_service"].includes(b.status) ? "bg-gray-300" : b.status === "available" ? "bg-blue-400" : b.acuity === "critical" || b.acuity === "high" ? "bg-red-500" : b.acuity === "moderate" ? "bg-amber-500" : "bg-green-500";
                  return <Link key={b.id} href="/supervisor/ward-map" className={`rounded-lg border ${tone} px-1 py-1.5 text-center hover:shadow-sm`}><p className="text-[10px] font-semibold text-gray-700 truncate">{b.label}</p><span className={`inline-block w-2 h-2 rounded-full my-0.5 ${dot}`} /></Link>;
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Stable</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Review</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> High risk</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Available</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> Not in use</span>
              </div>
            </>
          )}
        </div>

        <div className={card}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Observation Compliance</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: obsDonut }}>
              <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900 leading-none">{obs.pct == null ? "—" : `${obs.pct}%`}</span><span className="text-[8px] text-gray-400">compliance</span></div>
            </div>
            <div className="text-xs space-y-1 flex-1">
              {[["Completed", obs.completed, "#22c55e"], ["Due", obs.due, "#f59e0b"], ["Overdue", obs.overdue, "#ef4444"]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>
              ))}
            </div>
          </div>
          <Link href="/supervisor/operations?section=safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View observations dashboard →</Link>
        </div>
      </div>

      {/* Real admissions workflow (single operational input) */}
      <AdmissionsWorkflow departments={deptRes.data ?? []} beds={availBedRes.data ?? []} />

      {/* Movement timeline */}
      <div className={card}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Movement Timeline</h3>
        <div className="space-y-2">
          {movement.length === 0 && <p className="text-sm text-gray-400">No operational movement events yet.</p>}
          {movement.map((m: any) => (
            <div key={m.id} className="flex items-start gap-2.5 text-sm">
              <span className="text-xs text-gray-400 tabular-nums w-24 shrink-0">{fmt(m.created_at)}</span>
              <span className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 shrink-0" />
              <span className="min-w-0"><span className="font-medium text-gray-800">{tc(m.event_type)}</span>{m.op_patients?.label ? <span className="text-gray-500"> — {m.op_patients.label}</span> : null}{m.detail ? <span className="text-gray-400"> · {m.detail}</span> : null}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Patient Operations Center is the single operational source for patient information — census, acuity, safety flags, observation status, responsible staff, flow, capacity and ward map, all live from the Clinical Operations Engine (op_*). The operational registry deliberately holds no PHI: patient identity (MRN, age, sex, attending team) arrives via EMR integration and is shown as an honest state. Transfer in/out direction and discharged-today counts need directional flow tracking and are noted rather than fabricated.</p>
    </div>
  );
}
