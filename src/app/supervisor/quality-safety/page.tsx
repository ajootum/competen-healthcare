import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadQualitySafety } from "@/lib/operations/quality-safety";
import SafetyConsole from "./SafetyConsole";
import IncidentList from "./IncidentList";
import QualityList from "./QualityList";

export const dynamic = "force-dynamic";

// Quality, Safety & Escalation Centre (SSW-QSE-001) — the operational safety engine:
// safety score, patient-risk overview & heat map, observation compliance, incident
// management, escalations, quality improvement (CAPA) and governance. Patient risk,
// observations, escalations and safety alerts are live from op_*; incidents & CAPA
// are live from op_incidents / op_quality_actions (migration 073). Per-day safety-
// score / observation trends have no history and are honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const RISK_TONE: Record<string, string> = { high: "bg-rose-200 text-rose-800", medium: "bg-amber-200 text-amber-800", low: "bg-green-100 text-green-700", normal: "bg-gray-50 text-gray-400" };
const DOT: Record<string, string> = { rose: "bg-rose-500", amber: "bg-amber-500", orange: "bg-orange-500", purple: "bg-purple-500" };
const ESC_TONE: Record<string, string> = { open: "bg-rose-50 text-rose-700", acknowledged: "bg-blue-50 text-blue-700", resolved: "bg-green-50 text-green-700" };

export default async function QualitySafety() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadQualitySafety(admin, hid, isSuper);
  if (!d.ready) {
    return (<div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Quality, Safety &amp; Escalation Centre</h1><div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Activates once the Clinical Operations Engine is provisioned.</p></div></div>);
  }
  const k = d.kpis, g = d.governance;
  const kpis = [
    ["Overall Safety Score", k.safetyScore == null ? "—" : `${k.safetyScore}%`, k.safetyScore != null && k.safetyScore >= 75 ? "Good" : "Attention", scoreTone(k.safetyScore)],
    ["High Risk Patients", k.highRiskPatients, "Require close monitoring", k.highRiskPatients ? "text-rose-600" : ""],
    ["Open Incidents", k.openIncidents, `${k.incidentsCritical} critical · ${k.incidentsHigh} high`, k.openIncidents ? "text-orange-600" : ""],
    ["Escalations Active", k.escalationsActive, `${k.escInProgress} in progress · ${k.escNew} new`, k.escalationsActive ? "text-amber-600" : ""],
    ["Observation Compliance", k.obsCompliance == null ? "—" : `${k.obsCompliance}%`, "Target 95%", scoreTone(k.obsCompliance)],
    ["Overdue Tasks (Safety)", k.overdueSafetyTasks, `${k.criticalSafetyTasks} critical`, k.overdueSafetyTasks ? "text-rose-600" : ""],
  ];
  const govDonut = (() => { const segs = [["#22c55e", g.compliant], ["#f59e0b", g.partial], ["#ef4444", g.non]] as [string, number][]; const tot = g.compliant + g.partial + g.non || 1; let acc = 0; const st: string[] = []; segs.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Quality, Safety &amp; Escalation Centre</h1><p className="text-sm text-gray-500">Real-time safety oversight, incident management, quality improvement and escalation response.</p></div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(([l, v, sub, tone]: any) => (<div key={l} className={`${card} p-4`}><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{l}</p><p className={`text-2xl font-bold mt-1 tabular-nums ${tone || "text-gray-900"}`}>{v}</p><p className="text-[10px] text-gray-400 truncate">{sub}</p></div>))}
      </div>

      {/* Safety Command Centre · Critical Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5 xl:col-span-3`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Safety Command Centre <span className="text-gray-400 font-normal">· live overview &amp; immediate actions</span></h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Risk Overview</p>
              <div className="space-y-1">
                {d.riskOverview.map((r: any) => (<div key={r.label} className="flex items-center gap-1.5 text-xs"><span className={`w-1.5 h-1.5 rounded-full ${DOT[r.tone] ?? "bg-gray-400"}`} /><span className="text-gray-600 flex-1 truncate">{r.label}</span><span className={`font-semibold tabular-nums ${r.n ? "text-gray-900" : "text-gray-300"}`}>{r.n}</span></div>))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Patient Risk Heat Map</p>
              {d.heatMap.length === 0 ? <p className="text-xs text-gray-400">No beds configured.</p> : (<>
                <div className="grid grid-cols-4 gap-1">{d.heatMap.map((b: any, i: number) => (<div key={i} className={`rounded text-center py-1 text-[9px] font-semibold ${RISK_TONE[b.risk]}`} title={b.risk}>{b.label}</div>))}</div>
                <div className="flex flex-wrap gap-2 mt-2 text-[9px] text-gray-500"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-rose-200" />High</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-200" />Medium</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-100" />Low</span></div>
              </>)}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Top Safety Concerns</p>
              <div className="space-y-1">
                {d.topConcerns.length === 0 ? <p className="text-xs text-gray-400">No active concerns.</p> : d.topConcerns.map((c: any) => (<div key={c.label} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{c.label}</span><span className="font-semibold text-gray-900 tabular-nums">{c.n}</span></div>))}
              </div>
            </div>
            <div className="rounded-lg bg-violet-50/40 border border-violet-100 p-2.5">
              <p className="text-[10px] font-semibold text-violet-700 uppercase mb-1.5">✨ AI Safety Insight</p>
              <div className="space-y-1.5">
                {d.aiInsights.length === 0 ? <p className="text-xs text-gray-400">No safety concerns flagged.</p> : d.aiInsights.map((s: string, i: number) => (<p key={i} className="text-[11px] text-gray-700 leading-tight">• {s}</p>))}
              </div>
            </div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Critical Alerts</h2>
          {d.criticalAlerts.length === 0 ? <p className="text-sm text-gray-400">No critical alerts.</p> : (
            <div className="space-y-2">
              {d.criticalAlerts.map((a: any, i: number) => (<div key={i} className={`rounded-lg border p-2.5 ${a.tone === "high" ? "border-rose-100 bg-rose-50/40" : "border-amber-100 bg-amber-50/40"}`}><div className="flex items-center gap-2"><span className="text-xs font-medium text-gray-800 truncate flex-1 capitalize">{a.title}</span><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${a.tone === "high" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{tc(a.tone)}</span></div><p className="text-[10px] text-gray-400">{relTime(a.at)}{a.sub ? ` · ${a.sub}` : ""}</p></div>))}
            </div>
          )}
        </div>
      </div>

      {/* Console · Open Escalations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SafetyConsole incidentsProvisioned={d.incidentsProvisioned} qaProvisioned={d.qaProvisioned} />
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Open Escalations</h2>
          {d.escalation.list.length === 0 ? <p className="text-sm text-gray-400">No open escalations.</p> : (
            <div className="space-y-1.5">
              {d.escalation.list.map((e: any, i: number) => (<div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5"><span className={`w-2 h-2 rounded-full shrink-0 ${e.level >= 4 ? "bg-rose-500" : "bg-amber-500"}`} /><div className="min-w-0 flex-1"><p className="text-xs text-gray-800 truncate">{e.patient ? `${e.patient} — ` : ""}{e.summary}</p><p className="text-[10px] text-gray-400">{relTime(e.at)}</p></div><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${ESC_TONE[e.status] ?? "bg-gray-100 text-gray-600"}`}>{tc(e.status)}</span></div>))}
            </div>
          )}
        </div>
      </div>

      {/* Modules 2–6 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">2</span><h3 className="text-xs font-bold text-gray-900 leading-tight">Observation &amp; Monitoring</h3></div>
          <p className={`text-2xl font-bold ${scoreTone(d.observation.compliance)}`}>{d.observation.compliance == null ? "—" : `${d.observation.compliance}%`}</p>
          <p className="text-[10px] text-gray-400 mb-2">Compliance · target 95%</p>
          <div className="flex items-center justify-between text-xs"><span className="text-gray-600">Overdue observations</span><span className={`font-semibold ${d.observation.overdue ? "text-rose-600" : "text-gray-900"}`}>{d.observation.overdue}</span></div>
          <p className="text-[10px] text-gray-400 mt-2">Hourly compliance trend needs per-hour history.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center text-[11px] font-bold">3</span><h3 className="text-xs font-bold text-gray-900 leading-tight">Incident &amp; Event Management</h3></div>
          {!d.incidentsProvisioned ? <p className="text-[11px] text-gray-400">Run migration 073.</p> : (<>
            <div className="grid grid-cols-3 gap-1 mb-2 text-center">{[["Open", d.incidentMgmt.open], ["Investig.", d.incidentMgmt.investigating], ["Awaiting", d.incidentMgmt.awaitingAction]].map(([l, n]: any) => (<div key={l} className="rounded border border-gray-100 p-1"><p className="text-sm font-bold text-gray-900">{n}</p><p className="text-[8px] text-gray-500">{l}</p></div>))}</div>
            <IncidentList incidents={d.incidentMgmt.recent} editable={true} />
          </>)}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-[11px] font-bold">4</span><h3 className="text-xs font-bold text-gray-900 leading-tight">Escalation Centre</h3></div>
          <div className="space-y-1.5 text-xs">{[["Active Escalations", d.escalation.active], ["New This Shift", d.escalation.newThisShift], ["Response Overdue", d.escalation.responseOverdue], ["Resolved This Shift", d.escalation.resolved]].map(([l, n]: any) => (<div key={l} className="flex items-center justify-between"><span className="text-gray-600">{l}</span><span className="font-semibold text-gray-900 tabular-nums">{n}</span></div>))}</div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 rounded-lg bg-green-100 text-green-700 flex items-center justify-center text-[11px] font-bold">5</span><h3 className="text-xs font-bold text-gray-900 leading-tight">Quality Improvement</h3></div>
          {!d.qaProvisioned ? <p className="text-[11px] text-gray-400">Run migration 073.</p> : (<>
            <div className="grid grid-cols-3 gap-1 mb-2 text-center">{[["CAPA", d.quality.openCapa], ["Overdue", d.quality.overdueActions], ["Done", d.quality.actionsCompleted]].map(([l, n]: any) => (<div key={l} className="rounded border border-gray-100 p-1"><p className="text-sm font-bold text-gray-900">{n}</p><p className="text-[8px] text-gray-500">{l}</p></div>))}</div>
            <QualityList actions={d.quality.recent} editable={true} />
          </>)}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-[11px] font-bold">6</span><h3 className="text-xs font-bold text-gray-900 leading-tight">Clinical Governance</h3></div>
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: govDonut }}><div className="absolute inset-[7px] bg-white rounded-full flex items-center justify-center"><span className={`text-sm font-bold ${scoreTone(g.compliancePct)}`}>{g.compliancePct == null ? "—" : `${g.compliancePct}%`}</span></div></div>
            <div className="text-[10px] space-y-0.5 flex-1">{[["Compliant", g.compliant, "#22c55e"], ["Partial", g.partial, "#f59e0b"], ["Non", g.non, "#ef4444"]].map(([l, n, c]: any) => (<div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>))}</div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">From quality-action completion. Accreditation &amp; regulatory reporting need their own stores.</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Quick Actions</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-8 gap-2">
          {[["🚩 Report Incident", "#"], ["⬆️ Escalate Issue", "/supervisor/operations?section=safety"], ["✅ Create CAPA", "#"], ["🔍 Start RCA", "#"], ["👥 Safety Huddle", "/supervisor/shift-operations"], ["📄 Policy Lookup", "/supervisor/settings"], ["📋 Audit Checklist", "#"], ["⚠️ Risk Register", "/supervisor/clinical-safety"]].map(([l, href]: any) => (<Link key={l} href={href} className="rounded-lg border border-gray-100 hover:border-teal-300 hover:bg-teal-50/40 p-2.5 text-center text-[11px] font-medium text-gray-700">{l}</Link>))}
        </div>
      </div>

      {/* Integration strip */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Integrated for Safer Care <span className="text-gray-400 font-normal">· connected across the Shift Supervisor Workspace</span></h2>
        <div className="flex flex-wrap gap-2">{[["🧭 Patient Operations", "Patient risk & census"], ["👥 Workforce Operations", "Staffing & competency"], ["✅ Task Centre", "Safety tasks & follow-ups"], ["💬 Communication Centre", "Alerts & broadcasts"], ["✨ AI Copilot", "Risk predictions & recommendations"]].map(([t, s]: any) => (<div key={t} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5"><p className="text-[11px] font-medium text-gray-700">{t}</p><p className="text-[9px] text-gray-400">{s}</p></div>))}</div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Quality, Safety &amp; Escalation Centre (SSW-QSE-001) is the operational safety engine — a derived safety score, live patient-risk overview &amp; heat map, observation compliance, incident management, escalation response, quality improvement (CAPA) and derived governance, all from op_*/op_incidents/op_quality_actions. Per-day safety-score &amp; observation trends, accreditation and regulatory reporting have no store yet and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
