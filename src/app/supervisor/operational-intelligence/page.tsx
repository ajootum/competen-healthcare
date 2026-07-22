import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOperationalIntelligence } from "@/lib/operations/operational-intelligence";

export const dynamic = "force-dynamic";

// Operational Intelligence Centre (SSW-INT-001) — the analytical / decision-support
// layer. Seven intelligence modules derived from live operational data (shift
// performance, patient, workforce, safety & quality, predictive, reporting,
// executive) plus AI copilot insights. Read-only/derived — no new tables. Per-period
// trends without stored history, ML predictions (heuristic here), average LOS and
// report generation are shown as honest states rather than fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const LEVEL_TONE: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-green-50 text-green-700", Increasing: "bg-orange-50 text-orange-700", Stable: "bg-gray-100 text-gray-600" };
const INSIGHT_TONE: Record<string, string> = { high: "border-rose-100 bg-rose-50/40", medium: "border-amber-100 bg-amber-50/40", rec: "border-violet-100 bg-violet-50/40", info: "border-blue-100 bg-blue-50/40" };
const barTone = (n: number | null) => (n == null ? "bg-gray-200" : n >= 90 ? "bg-green-500" : n >= 75 ? "bg-amber-500" : "bg-rose-500");

export default async function OperationalIntelligence() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadOperationalIntelligence(admin, hid, isSuper);
  if (!d.ready) return (<div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Operational Intelligence Centre</h1><div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Activates once the Clinical Operations Engine is provisioned.</p></div></div>);
  const k = d.kpis, sp = d.shiftPerf, p = d.patient, w = d.workforce, s = d.safety;

  const healthDonut = `conic-gradient(${k.healthScore != null && k.healthScore >= 75 ? "#22c55e" : "#f59e0b"} ${(k.healthScore ?? 0) * 3.6}deg, #e5e7eb ${(k.healthScore ?? 0) * 3.6}deg 360deg)`;
  const utilDonut = `conic-gradient(#14b8a6 ${(w.utilisation ?? 0) * 3.6}deg, #e5e7eb ${(w.utilisation ?? 0) * 3.6}deg 360deg)`;

  const kpis = [
    { label: "Overall Shift Health Score", donut: healthDonut, value: k.healthScore == null ? "—" : `${k.healthScore}%`, sub: k.healthScore != null && k.healthScore >= 75 ? "Good" : "Attention" },
    { label: "Operational Pressure", value: k.pressureLabel, sub: `${k.pressure}/100`, tone: k.pressure >= 70 ? "text-rose-600" : k.pressure >= 40 ? "text-amber-600" : "text-green-600" },
    { label: "Capacity Utilisation", value: k.capacity == null ? "—" : `${k.capacity}%`, sub: `${k.occupied} / ${k.totalBeds} beds` },
    { label: "Safety Status", value: k.safetyStatus, sub: `${k.criticalAlerts} critical`, tone: k.safetyStatus === "Good" ? "text-green-600" : "text-rose-600" },
    { label: "Tasks Completion", value: k.taskCompletion == null ? "—" : `${k.taskCompletion}%`, sub: `${k.completedTasks} / ${k.totalTasks} tasks`, tone: scoreTone(k.taskCompletion) },
    { label: "Communication", value: k.commsResponse == null ? "—" : `${k.commsResponse}%`, sub: "Ack rate" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Operational Intelligence Centre</h1><p className="text-sm text-gray-500">Real-time insights, analytics and predictions to drive better decisions this shift.</p></div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kp: any) => (
          <div key={kp.label} className={`${card} p-4`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{kp.label}</p>
            <div className="flex items-center gap-2 mt-1">
              {kp.donut && <div className="relative w-9 h-9 shrink-0 rounded-full" style={{ background: kp.donut }}><div className="absolute inset-[3px] bg-white rounded-full" /></div>}
              <div><p className={`text-xl font-bold tabular-nums leading-none ${kp.tone ?? "text-gray-900"}`}>{kp.value}</p><p className="text-[10px] text-gray-400">{kp.sub}</p></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Modules */}
        <div className="xl:col-span-3 space-y-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Intelligence Modules</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Shift Performance */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">1</span><h3 className="text-xs font-bold text-gray-900">Shift Performance Intelligence</h3></div>
              <div className="mb-3"><div className="flex items-center justify-between text-[10px] text-gray-500 mb-1"><span>{sp.phase}</span><span>{sp.elapsedPct == null ? "" : `${sp.elapsedPct}% elapsed`}</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${sp.elapsedPct ?? 0}%` }} /></div></div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">{[["Admissions", sp.admissions], ["Discharges", sp.discharges], ["Transfers", sp.transfers], ["Avg LOS", sp.avgLos == null ? "—" : `${sp.avgLos}d`]].map(([l, v]: any) => (<div key={l} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1"><span className="text-gray-600">{l}</span><span className="font-semibold text-gray-900">{v}</span></div>))}</div>
            </div>

            {/* 2. Patient Intelligence */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-[11px] font-bold">2</span><h3 className="text-xs font-bold text-gray-900">Patient Intelligence</h3></div>
              <div className="grid grid-cols-3 gap-1.5 text-center">{[["Census", p.census], ["High Risk", p.highRisk], ["PEWS Esc.", p.pewsEscalations], ["Admissions", p.newAdmissions], ["Discharges", p.discharges], ["Occupancy", p.occupancy == null ? "—" : `${p.occupancy}%`]].map(([l, v]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-1.5"><p className="text-base font-bold text-gray-900 tabular-nums">{v}</p><p className="text-[8px] text-gray-500">{l}</p></div>))}</div>
              <p className="text-[10px] text-gray-400 mt-2">Census trend needs per-hour history.</p>
            </div>

            {/* 3. Workforce Intelligence */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-[11px] font-bold">3</span><h3 className="text-xs font-bold text-gray-900">Workforce Intelligence</h3></div>
              <div className="flex items-center gap-3 mb-3">
                <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: utilDonut }}><div className="absolute inset-[7px] bg-white rounded-full flex items-center justify-center"><span className="text-sm font-bold text-gray-900">{w.utilisation == null ? "—" : `${w.utilisation}%`}</span></div></div>
                <div className="text-[11px] space-y-0.5 flex-1">{[["Planned", w.planned], ["On Duty", w.onDuty], ["Available", w.available]].map(([l, v]: any) => (<div key={l} className="flex items-center justify-between"><span className="text-gray-600">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{v}</span></div>))}</div>
              </div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Skill Mix Coverage</p>
              <div className="space-y-1">{w.skillMix.length === 0 ? <p className="text-[11px] text-gray-400">No staffing standards.</p> : w.skillMix.slice(0, 5).map((r: any) => (<div key={r.role} className="flex items-center gap-1.5 text-[11px]"><span className="text-gray-600 w-16 truncate capitalize">{r.role}</span><div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${barTone(r.coverage)}`} style={{ width: `${r.coverage ?? 0}%` }} /></div><span className="tabular-nums text-gray-500 w-8 text-right">{r.coverage == null ? "—" : `${r.coverage}%`}</span></div>))}</div>
            </div>

            {/* 4. Safety & Quality Intelligence */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-[11px] font-bold">4</span><h3 className="text-xs font-bold text-gray-900">Safety &amp; Quality Intelligence</h3></div>
              <div className="flex items-end gap-1 h-16 mb-2">{s.incidentTrend.map((t: any, i: number) => (<div key={i} className="flex-1 flex flex-col items-center gap-0.5"><div className="w-full bg-rose-300 rounded-t" style={{ height: `${(t.n / s.trendMax) * 100}%`, minHeight: t.n > 0 ? "3px" : "0" }} /><span className="text-[7px] text-gray-400">{t.day.split(" ")[1]}</span></div>))}</div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">{[["Incidents", s.incidents], ["Near Misses", s.nearMisses], ["Med. Errors", s.medicationErrors], ["Falls", s.falls]].map(([l, v]: any) => (<div key={l} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1"><span className="text-gray-600">{l}</span><span className="font-semibold text-gray-900">{v}</span></div>))}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 5. Predictive Intelligence */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-[11px] font-bold">5</span><h3 className="text-xs font-bold text-gray-900">Predictive Intelligence</h3><span className="text-[8px] font-bold uppercase bg-violet-100 text-violet-600 rounded px-1 py-0.5">AI</span></div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Forecast · Next 6 Hours</p>
              <div className="space-y-1">{d.forecast.map((f: any) => (<div key={f.label} className="flex items-center justify-between text-xs"><span className="text-gray-600">{f.label}</span><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${LEVEL_TONE[f.value] ?? "bg-gray-100 text-gray-600"}`}>{f.value}</span></div>))}</div>
              <p className="text-[10px] text-gray-400 mt-2">Heuristic forecasts from live load — not ML.</p>
            </div>

            {/* 6. Operational Reporting */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-[11px] font-bold">6</span><h3 className="text-xs font-bold text-gray-900">Operational Reporting</h3></div>
              <div className="space-y-1">{["Shift Report", "Daily / Weekly / Monthly", "Executive Report", "Custom Report", "Scheduled Reports", "Export (PDF / Excel)"].map((r) => (<div key={r} className="flex items-center gap-2 text-xs text-gray-600"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" />{r}</div>))}</div>
              <p className="text-[10px] text-gray-400 mt-2">Report generation &amp; export are a follow-up phase.</p>
            </div>

            {/* 7. Executive Insights */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center text-[11px] font-bold">7</span><h3 className="text-xs font-bold text-gray-900">Executive Insights</h3></div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Performance Scorecard</p>
              <div className="space-y-1.5">{d.scorecard.map((c: any) => (<div key={c.label}><div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-gray-600 truncate">{c.label}</span><span className={`font-semibold ${scoreTone(c.pct)}`}>{c.pct == null ? "—" : `${c.pct}%`}</span></div><div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${barTone(c.pct)}`} style={{ width: `${c.pct ?? 0}%` }} /></div></div>))}</div>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <div className="flex items-center gap-1.5 mb-3"><span className="text-base">✨</span><h2 className="text-sm font-bold text-gray-900">AI Copilot Insights</h2></div>
            {d.aiInsights.length === 0 ? <p className="text-sm text-gray-400">No anomalies flagged — the shift is stable.</p> : (
              <div className="space-y-2">{d.aiInsights.map((a: any, i: number) => (<div key={i} className={`rounded-lg border p-2.5 ${INSIGHT_TONE[a.tone] ?? "border-gray-100"}`}><p className="text-[11px] font-semibold text-gray-800">{a.title}</p><p className="text-[11px] text-gray-600 leading-tight">{a.text}</p><p className="text-[10px] font-semibold text-teal-700 mt-0.5">{a.action} →</p></div>))}</div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h2 className="text-sm font-bold text-gray-900 mb-2">Data Snapshot</h2>
            <div className="space-y-1 text-xs">{[["Data Sources", d.dataSnapshot.sources], ["Data Quality", d.dataSnapshot.quality], ["Alerts Active", d.dataSnapshot.alertsActive]].map(([l, v]: any) => (<div key={l} className="flex items-center justify-between"><span className="text-gray-600">{l}</span><span className="font-semibold text-gray-900">{v}</span></div>))}</div>
            <p className="text-[10px] text-gray-400 mt-2">Live from the operational engines · updated on load.</p>
          </div>
        </div>
      </div>

      {/* Integration strip */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Integrated Across Your Shift <span className="text-gray-400 font-normal">· analytics powered by all operational modules</span></h2>
        <div className="flex flex-wrap gap-2">{[["🧭 Patient Operations", "Census & patient data"], ["👥 Workforce Operations", "Staffing & competency"], ["✅ Task Centre", "Tasks & completion"], ["💬 Communication Centre", "Messages & escalations"], ["🛡️ Quality & Escalation", "Incidents & safety"], ["✨ AI Operational Copilot", "Predictions & recommendations"]].map(([t, sub]: any) => (<div key={t} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5"><p className="text-[11px] font-medium text-gray-700">{t}</p><p className="text-[9px] text-gray-400">{sub}</p></div>))}</div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Operational Intelligence Centre (SSW-INT-001) is the workspace's analytical layer — a derived shift health &amp; operational-pressure score, capacity, task, workforce, patient and safety intelligence, heuristic predictive forecasts and an executive scorecard, all consolidated live from every operational engine. Per-period trends without stored history, true ML predictions, average LOS and report generation/export are shown as honest states rather than fabricated.</p>
    </div>
  );
}
