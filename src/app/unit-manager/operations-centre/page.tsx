import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitOperationsCentre } from "@/lib/operations/unit-command";
import UnitCommandTabs from "../UnitCommandTabs";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Unit Operations Centre (UMW-003 redesign) — an intelligent operational command
// centre: executive situation awareness, AI operational summary, clinical & workforce
// operations, priority alerts, live timeline, predictive operations, unit performance
// and improvement tracking. Occupancy, beds, patients, acuity, flow, staffing, alerts,
// escalations, observation compliance, competency coverage, incidents, CAPA and the
// activity timeline are all LIVE. Equipment/biomed, resource-register, patient-
// satisfaction and %-progress feeds have no backing store and render as honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const TONE: Record<string, string> = { red: "text-rose-600", amber: "text-amber-600", green: "text-green-600", blue: "text-blue-600", gray: "text-gray-400" };
const DOT: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-500", green: "bg-green-500", blue: "bg-blue-500", gray: "bg-gray-300" };
const SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Medium: "bg-blue-50 text-blue-700" };

function Kpi({ label, value, sub, tone, accent }: { label: string; value: any; sub?: string; tone?: string; accent?: boolean }) {
  return (
    <div className={`${card} p-3.5 ${accent ? "ring-1 ring-teal-100" : ""}`}>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Donut({ segments, center, sub }: { segments: { n: number; color: string }[]; center: any; sub?: string }) {
  const total = segments.reduce((s, x) => s + x.n, 0) || 1;
  let acc = 0;
  const stops = segments.map(s => { const a = (acc / total) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / total) * 100}%`; }).join(", ");
  return (
    <div className="relative w-24 h-24 shrink-0">
      <div className="w-24 h-24 rounded-full" style={{ background: total > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} />
      <div className="absolute inset-[20%] rounded-full bg-white flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-gray-900 tabular-nums">{center}</span>
        {sub && <span className="text-[8px] text-gray-400">{sub}</span>}
      </div>
    </div>
  );
}

const HonestPanel = ({ title, note }: { title: string; note: string }) => (
  <div className={`${card} p-5`}>
    <h3 className="text-sm font-bold text-gray-900 mb-1">{title}</h3>
    <p className="text-sm text-gray-400">Not provisioned.</p>
    <p className="text-[10px] text-gray-400 mt-2">{note}</p>
  </div>
);

const QUICK = [
  ["Assign Staff", "/unit-manager/operations?section=shifts"], ["Open Escalation", "/supervisor/quality-safety"], ["Call MET", null],
  ["Create Task", "/supervisor/task-center"], ["Broadcast Message", "/supervisor/communication"], ["Ward Map", null],
  ["Approve Overtime", null], ["Incident Report", "/supervisor/quality-safety"], ["Generate Report", "/unit-manager/action-centre"],
  ["Review Competency", "/unit-manager/competency"], ["View Capacity Plan", null],
];

export default async function UnitOperationsCentre({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d: any = await loadUnitOperationsCentre(admin, profile?.hospital_id ?? null, roles.includes("super_admin"), dept);
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (!d.ready) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap"><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Unit Operations Centre</h1><p className="text-sm text-gray-500">Real-time operational overview and predictive insights.</p></div><UnitFilters departments={d.departments} /></div>
        <UnitCommandTabs />
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operations tables not provisioned</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations (op_*) tables aren&apos;t available for this tenant yet.</p></div>
      </div>
    );
  }

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Unit Operations Centre</h1>
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Live</span>
        </div>
        <div className="flex items-center gap-2"><UnitFilters departments={d.departments} showPeriod /><span className="text-[11px] text-gray-400 whitespace-nowrap">Updated {now}</span></div>
      </div>
      <UnitCommandTabs />

      {/* 1. Executive situation awareness — KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Unit Health Score" value={d.healthScore ?? "—"} sub={d.healthStatus.label} tone={TONE[d.healthStatus.tone]} accent />
        <Kpi label="Occupancy" value={`${k.occupancyPct}%`} sub={k.occupancy + " beds"} tone={k.occupancyPct >= 90 ? "text-rose-600" : undefined} />
        <Kpi label="Patients" value={k.patients} sub={`Capacity: ${d.bedStatus.total}`} />
        <Kpi label="Available Beds" value={k.bedsAvailable} sub={d.bedStatus.total ? `${Math.round((k.bedsAvailable / d.bedStatus.total) * 100)}% of capacity` : ""} />
        <Kpi label="Average Acuity" value={k.avgAcuity} sub={Number(k.avgAcuity) >= 3 ? "High" : Number(k.avgAcuity) >= 2 ? "Moderate" : "Low"} />
        <Kpi label="Staff on Duty" value={d.staffing.present} sub={`Rostered: ${d.staffing.rostered}`} />
        <Kpi label="Safety Events" value={k.safetyEvents} sub={k.safetyCritical ? `${k.safetyCritical} critical` : "none critical"} tone={k.safetyCritical ? "text-rose-600" : undefined} />
        <Kpi label="Predicted Occupancy" value={k.predictedOccupancy != null ? `${k.predictedOccupancy}%` : "—"} sub="heuristic" />
      </div>

      {/* 2. AI operational summary */}
      <div className={`${card} p-4 bg-gradient-to-r from-violet-50/60 to-white`}>
        <div className="flex items-start gap-3">
          <span className="text-base">✨</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">AI Operational Summary</p>
            <p className="text-sm text-gray-700 mt-0.5">{d.aiSummary}</p>
            {d.copilot.recommendations.length > 0 && <p className="text-[11px] text-gray-500 mt-1">Recommended: {d.copilot.recommendations.slice(0, 2).join(" · ")}</p>}
          </div>
          <span className="text-[10px] text-gray-400 shrink-0">rule-based over live data</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 3. Clinical operations */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Clinical Operations</h3>
          <div className="flex items-center justify-between mb-1"><span className="text-xs text-gray-500">Beds</span><span className="text-xs font-bold text-gray-800">{d.bedStatus.occupied} / {d.bedStatus.total}</span></div>
          <div className="flex h-3 rounded-md overflow-hidden border border-gray-100 mb-3">
            {[["occupied", "#16a34a"], ["available", "#3b82f6"], ["blocked", "#ef4444"]].map(([kk, c]) => { const v = d.bedStatus[kk]; return v ? <div key={kk} style={{ width: `${(v / (d.bedStatus.total || 1)) * 100}%`, background: c as string }} /> : null; })}
          </div>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {[["Adm", d.flow.admissions], ["Trans", d.flow.transfers], ["Disch", d.flow.discharges], ["Exp", d.flow.expected]].map(([l, v]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-1.5 text-center"><p className="text-base font-bold text-gray-900 tabular-nums">{v}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Donut center={d.kpis.patients} sub="patients" segments={[{ n: d.acuity.high, color: "#ef4444" }, { n: d.acuity.medium, color: "#f59e0b" }, { n: d.acuity.low, color: "#22c55e" }]} />
            <div className="text-[11px] space-y-1">
              <p><span className="inline-block w-2 h-2 rounded-sm bg-rose-500 mr-1" />High <b>{d.acuity.high}</b></p>
              <p><span className="inline-block w-2 h-2 rounded-sm bg-amber-500 mr-1" />Medium <b>{d.acuity.medium}</b></p>
              <p><span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-1" />Low <b>{d.acuity.low}</b></p>
              <p className="text-gray-400 pt-1">Predicted occ. {d.predictive.predictedOccupancy ?? "—"}%</p>
            </div>
          </div>
        </div>

        {/* 4. Workforce status */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Workforce Status</h3>
          <div className="flex items-center justify-between mb-3">
            <div><p className="text-[10px] text-gray-500 uppercase">Current Ratio</p><p className="text-2xl font-bold text-gray-900">{d.ratio.value}</p></div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${d.ratio.withinTarget ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>Target {d.ratio.target} · {d.ratio.withinTarget ? "within" : "over"}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {[["Present", d.staffing.present], ["Break", d.staffing.onBreak], ["Off", d.staffing.offDuty], ["Rostered", d.staffing.rostered]].map(([l, v]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-1.5 text-center"><p className="text-base font-bold text-gray-900 tabular-nums">{v}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mb-1">Competency Readiness</p>
          {d.competencyCoverage == null ? <p className="text-xs text-gray-400">No competency decisions recorded.</p> : (
            <>
              <div className="flex items-center gap-2"><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${d.competencyCoverage}%` }} /></div><span className="text-xs font-bold text-gray-700">{d.competencyCoverage}%</span></div>
              <p className="text-[10px] text-gray-400 mt-1">Overall unit coverage. Per-specialty breakdown integrates with the Competency Engine (next phase).</p>
            </>
          )}
        </div>

        {/* 5. Operational alerts */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Operational Alerts</h3><span className="text-[10px] text-gray-400">{d.alerts.length}</span></div>
          {d.alerts.length === 0 ? <p className="text-sm text-gray-400">No active operational alerts.</p> : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {d.alerts.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2 border-b border-gray-50 pb-2 last:border-0">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.tone]}`} />
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className={`text-xs font-semibold ${TONE[a.tone]} truncate`}>{a.title}</p>{a.at && <span className="text-[9px] text-gray-400 ml-auto shrink-0">{a.at}</span>}</div><p className="text-[10px] text-gray-500 truncate">{a.sub}</p></div>
                  <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${SEV[a.sev] ?? "bg-gray-50 text-gray-500"}`}>{a.sev}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Timeline · Resources · Equipment · Predictive · Performance · Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Live Activity Timeline</h3>
          {d.timeline.length === 0 ? <p className="text-sm text-gray-400">No recent recorded activity.</p> : (
            <div className="space-y-1.5">{d.timeline.map((t: any, i: number) => (<div key={i} className="flex items-start gap-2 text-xs"><span className="text-gray-400 tabular-nums shrink-0">{t.at}</span><span className="text-gray-700 capitalize">{t.label}</span></div>))}</div>
          )}
        </div>

        <HonestPanel title="Resources" note="Ventilators, monitors, pumps, oxygen points, isolation rooms and wheelchairs need an asset/resource register — a later Operations & Capacity phase." />
        <HonestPanel title="Equipment Status" note="Operational / maintenance-due / fault / calibration status requires a biomedical-equipment integration — shown as an honest state, not fabricated." />

        {/* 7. Predictive operations */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Predictive Operations <span className="text-[10px] text-gray-400 font-normal">(heuristic)</span></h3>
          {[["Expected Admissions", d.predictive.expectedAdmissions], ["Expected Discharges", d.predictive.expectedDischarges], ["Predicted Occupancy (peak)", d.predictive.predictedOccupancy != null ? `${d.predictive.predictedOccupancy}%` : "—"], ["Staffing Pressure", d.predictive.staffingPressure]].map(([l, v]: any) => (
            <div key={l} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0"><span className="text-gray-500">{l}</span><b className="text-gray-800">{v}</b></div>
          ))}
          <p className="text-[10px] text-gray-400 mt-2">Derived from live flow &amp; staffing. True ML forecasting is a later AI phase.</p>
        </div>

        {/* 8. Unit performance */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Unit Performance <span className="text-[10px] text-gray-400 font-normal">(today)</span></h3>
          {[["Observation Compliance", d.performance.obsCompliance != null ? `${d.performance.obsCompliance}%` : "—"], ["Incident Reports", d.performance.incidentsToday], ["Open Escalations", d.performance.escalations], ["Falls", "—"], ["Medication Delays", "—"], ["Documentation Compliance", "—"], ["Patient Satisfaction", "—"]].map(([l, v]: any) => (
            <div key={l} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0"><span className="text-gray-500">{l}</span><b className={`text-gray-800 ${v === "—" ? "text-gray-300" : ""}`}>{v}</b></div>
          ))}
          <p className="text-[10px] text-gray-400 mt-2">Compliance, incidents &amp; escalations are live. Falls, med-delays, documentation &amp; satisfaction need dedicated stores (honest states).</p>
        </div>

        {/* 10. Quick actions */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK.map(([label, href]: any) => href ? (
              <Link key={label} href={href} className="text-[11px] text-gray-700 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-teal-300 hover:bg-teal-50/40 text-center">{label}</Link>
            ) : (
              <span key={label} className="text-[11px] text-gray-300 border border-gray-100 rounded-lg px-2 py-1.5 text-center" title="Not wired yet">{label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 9. Improvement tracker + AI copilot */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Improvement Tracker</h3>
          {d.improvements.length === 0 ? <p className="text-sm text-gray-400">No active improvement projects or CAPA.</p> : (
            <div className="space-y-2">
              {d.improvements.map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{p.title}</span><span className="text-gray-400 capitalize">{p.type.replace(/_/g, " ")}</span><span className={`px-1.5 py-0.5 rounded ${p.status === "overdue" ? "bg-rose-50 text-rose-700" : p.status === "in_progress" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{p.status.replace(/_/g, " ")}</span><span className="text-gray-400">{p.owner}</span></div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Live from quality actions / CAPA. %-progress &amp; milestones need a project store (next phase).</p>
        </div>

        <div className={`${card} p-5 bg-gradient-to-br from-violet-50/50 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI Operational Copilot</h3>
          <div className="flex items-center gap-4 mb-3">
            <div className="text-center"><p className={`text-2xl font-bold ${d.copilot.shiftRisk == null ? "text-gray-400" : d.copilot.shiftRisk >= 60 ? "text-rose-600" : d.copilot.shiftRisk >= 35 ? "text-amber-600" : "text-green-600"}`}>{d.copilot.shiftRisk != null ? `${d.copilot.shiftRisk}%` : "—"}</p><p className="text-[9px] text-gray-400">Shift Risk</p></div>
            <div className="text-center"><p className="text-2xl font-bold text-green-600">{d.copilot.expectedHealth ?? "—"}</p><p className="text-[9px] text-gray-400">Expected Health</p></div>
            <div className="flex-1 text-[11px] text-gray-600">
              {d.copilot.recommendations.length === 0 ? <p className="text-gray-400">No priority recommendations.</p> : (
                <ul className="space-y-0.5">{d.copilot.recommendations.slice(0, 4).map((r: string, i: number) => (<li key={i} className="flex gap-1"><span className="text-violet-500">›</span>{r}</li>))}</ul>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-400">Rule-based over the live snapshot; recommendations are proposals for the Unit Manager, not automated actions.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Unit Operations Centre (UMW-003 redesign) is an operational command centre over the shared Clinical Operations, Workforce, Quality and audit services — occupancy, beds, patients, acuity, flow, staffing, ratios, escalations, safety alerts, observation compliance, competency coverage, incidents, CAPA and the live activity timeline are all real, with a derived unit-health score and rule-based AI summary/copilot. Equipment/biomed status, the resource register, ML forecasting, patient-satisfaction, falls, medication-delay and %-progress feeds have no backing store and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
