import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAiCopilot } from "@/lib/operations/ai-copilot";
import AiAssistant from "./AiAssistant";

export const dynamic = "force-dynamic";

// AI Operational Copilot (SSW-AI-001) — the decision-support layer. Eight AI modules
// derived live from every operational engine (command centre, workforce, patient,
// safety, operational, predictive, assistant, explainable) with prioritised,
// explainable recommendations. Heuristic/rule-based intelligence + a shift-grounded
// natural-language assistant (real LLM via /api/operations/copilot when configured).
// Recommendations are proposals for a human to accept; every AI answer is audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const RISK_TONE: Record<string, string> = { High: "text-rose-600", Medium: "text-amber-600", Low: "text-green-600", "—": "text-gray-300", Increasing: "text-orange-600", Stable: "text-gray-600" };
const RISK_BADGE: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-green-50 text-green-700", Increasing: "bg-orange-50 text-orange-700", Stable: "bg-gray-100 text-gray-600" };
const PRIO_BADGE: Record<string, string> = { Immediate: "bg-rose-100 text-rose-700", High: "bg-orange-100 text-orange-700", Medium: "bg-amber-100 text-amber-700" };
const FEED_DOT: Record<string, string> = { high: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500", green: "bg-green-500" };
const barTone = (n: number | null) => (n == null ? "bg-gray-200" : n >= 90 ? "bg-green-500" : n >= 75 ? "bg-amber-500" : "bg-rose-500");

export default async function AiCopilot() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadAiCopilot(admin, hid, isSuper);
  if (!d.ready) return (<div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">AI Operational Copilot</h1><div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Activates once the Clinical Operations Engine is provisioned.</p></div></div>);
  const c = d.command, w = d.workforceAi, p = d.patientAi, s = d.safetyAi, o = d.operationalAi;
  const healthDonut = `conic-gradient(${c.healthScore != null && c.healthScore >= 75 ? "#22c55e" : "#f59e0b"} ${(c.healthScore ?? 0) * 3.6}deg, #e5e7eb ${(c.healthScore ?? 0) * 3.6}deg 360deg)`;
  const metric = (label: string, val: any, tone?: string) => (<div className="flex items-center justify-between text-xs"><span className="text-gray-600">{label}</span><span className={`font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>{val}</span></div>);

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI Operational Copilot</h1><p className="text-sm text-gray-500">AI-powered insights, predictions and recommendations to support better shift decisions.</p></div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>
      </div>

      {/* AI Command Centre */}
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">AI Command Centre <span className="text-gray-400 font-normal">· your shift at a glance</span></h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
          <div className="rounded-lg border border-gray-100 p-3 flex items-center gap-2"><div className="relative w-10 h-10 shrink-0 rounded-full" style={{ background: healthDonut }}><div className="absolute inset-[3px] bg-white rounded-full flex items-center justify-center"><span className="text-[9px] font-bold text-gray-900">{c.healthScore ?? "—"}</span></div></div><div><p className="text-[9px] text-gray-400 uppercase">Health Score</p><p className={`text-sm font-bold ${scoreTone(c.healthScore)}`}>{c.healthScore != null && c.healthScore >= 75 ? "Good" : "Attention"}</p></div></div>
          <div className="rounded-lg border border-gray-100 p-3"><p className="text-[9px] text-gray-400 uppercase">Operational Pressure</p><p className={`text-lg font-bold ${RISK_TONE[c.pressureLabel] ?? "text-gray-900"}`}>{c.pressureLabel}</p><p className="text-[10px] text-gray-400">{c.pressure}/100</p></div>
          <div className="rounded-lg border border-gray-100 p-3 xl:col-span-2"><p className="text-[9px] text-gray-400 uppercase mb-1">Top Priorities (AI)</p><div className="space-y-0.5">{c.topPriorities.length === 0 ? <p className="text-[11px] text-gray-400">Shift is stable.</p> : c.topPriorities.slice(0, 3).map((t: any, i: number) => (<Link key={i} href={t.href} className="block text-[11px] text-gray-700 hover:text-teal-700 truncate">{i + 1}. {t.text}</Link>))}</div></div>
          <div className="rounded-lg border border-gray-100 p-3"><p className="text-[9px] text-gray-400 uppercase">Critical Patients</p><p className="text-lg font-bold text-rose-600">{c.criticalPatients}</p><p className="text-[10px] text-gray-400">Close monitoring</p></div>
          <div className="rounded-lg border border-gray-100 p-3"><p className="text-[9px] text-gray-400 uppercase">Staffing Risk</p><p className={`text-lg font-bold ${RISK_TONE[c.staffingRisk] ?? "text-gray-900"}`}>{c.staffingRisk}</p></div>
          <div className="rounded-lg border border-gray-100 p-3"><p className="text-[9px] text-gray-400 uppercase">AI Confidence</p><p className={`text-lg font-bold ${scoreTone(c.aiConfidence)}`}>{c.aiConfidence}%</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 space-y-4">
          {/* Modules 1-4 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-[11px] font-bold">1</span><h3 className="text-xs font-bold text-gray-900">Workforce Intelligence</h3></div>
              <p className="text-[10px] text-gray-400 uppercase">Safe Staffing Score · target 90%</p><p className={`text-2xl font-bold ${scoreTone(w.safeStaffingScore)}`}>{w.safeStaffingScore == null ? "—" : `${w.safeStaffingScore}%`}</p>
              <div className="mt-2 space-y-1">{metric("Staffing gap", `${w.staffingGapWte} WTE`, w.staffingGapWte > 0 ? "text-rose-600" : "text-gray-900")}{metric("Competency gap", `${w.competencyGap} roles`)}{metric("Fatigue risk", w.fatigueRisk, RISK_TONE[w.fatigueRisk])}{metric("Skill mix coverage", w.skillMixCoverage == null ? "—" : `${w.skillMixCoverage}%`)}{metric("Redeployment available", `${w.redeployment} staff`, "text-teal-600")}</div>
            </div>
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-[11px] font-bold">2</span><h3 className="text-xs font-bold text-gray-900">Patient Intelligence</h3></div>
              <p className="text-[10px] text-gray-400 uppercase">High Risk Patients</p><p className="text-2xl font-bold text-rose-600">{p.highRisk}</p>
              <div className="mt-2 space-y-1">{metric("Deterioration risk (next 2h)", `${p.deterioration} patients`, p.deterioration ? "text-rose-600" : "text-gray-900")}{metric("PEWS escalation likely", `${p.pewsLikely}`)}{metric("Likely ICU transfer", `${p.icuTransfer}`)}{metric("Ward congestion risk", p.wardCongestion, RISK_TONE[p.wardCongestion])}</div>
            </div>
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center text-[11px] font-bold">3</span><h3 className="text-xs font-bold text-gray-900">Safety Intelligence</h3></div>
              <p className="text-[10px] text-gray-400 uppercase">Safety Score · target 95%</p><p className={`text-2xl font-bold ${scoreTone(s.safetyScore)}`}>{s.safetyScore == null ? "—" : `${s.safetyScore}%`}</p>
              <div className="mt-2 space-y-1">{metric("Observation compliance risk", s.obsComplianceRisk, RISK_TONE[s.obsComplianceRisk])}{metric("Medication error risk", s.medicationRisk, RISK_TONE[s.medicationRisk])}{metric("Falls risk", s.fallsRisk, RISK_TONE[s.fallsRisk])}{metric("Pressure injury risk", s.pressureInjuryRisk, RISK_TONE[s.pressureInjuryRisk])}{metric("Open safety alerts", s.openAlerts, s.openAlerts ? "text-rose-600" : "text-gray-900")}</div>
            </div>
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-green-100 text-green-700 flex items-center justify-center text-[11px] font-bold">4</span><h3 className="text-xs font-bold text-gray-900">Operational Intelligence</h3></div>
              <p className="text-[10px] text-gray-400 uppercase">Operational Score · target 90%</p><p className={`text-2xl font-bold ${scoreTone(o.operationalScore)}`}>{o.operationalScore == null ? "—" : `${o.operationalScore}%`}</p>
              <div className="mt-2 space-y-1">{metric("Workflow bottlenecks", o.workflowBottlenecks)}{metric("Task delays", o.taskDelays, o.taskDelays ? "text-rose-600" : "text-gray-900")}{metric("Escalations in progress", o.escalations)}{metric("Communication load", o.commsLoad, RISK_TONE[o.commsLoad])}{metric("Bed utilisation", o.bedUtilisation == null ? "—" : `${o.bedUtilisation}%`)}</div>
            </div>
          </div>

          {/* Modules 5-8 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-[11px] font-bold">5</span><h3 className="text-xs font-bold text-gray-900">Predictive Intelligence</h3><span className="text-[8px] font-bold uppercase bg-violet-100 text-violet-600 rounded px-1 py-0.5">AI</span></div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Forecasts · Next 4 Hours</p>
              <div className="space-y-1">{d.predictive.map((f: any) => (<div key={f.label} className="flex items-center justify-between text-xs"><span className="text-gray-600">{f.label}</span><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${RISK_BADGE[f.value] ?? "bg-gray-100 text-gray-600"}`}>{f.value}</span></div>))}</div>
            </div>

            <AiAssistant />

            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-fuchsia-100 text-fuchsia-700 flex items-center justify-center text-[11px] font-bold">7</span><h3 className="text-xs font-bold text-gray-900">Explainable AI</h3></div>
              {!d.explain ? <p className="text-sm text-gray-400">No high-impact recommendation right now.</p> : (<>
                <div className="flex items-center gap-2 mb-2"><p className="text-xs font-medium text-gray-800 flex-1">{d.explain.recommendation}</p><span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{d.explain.impact} Impact</span></div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Why this recommendation?</p>
                <div className="space-y-0.5 mb-2">{d.explain.why.map((r: string, i: number) => (<p key={i} className="text-[11px] text-gray-600 flex items-start gap-1"><span className="text-green-500">✓</span>{r}</p>))}</div>
                <div className="flex items-center justify-between text-[11px]"><span className="text-gray-500">Confidence</span><span className={`font-bold ${scoreTone(d.explain.confidence)}`}>{d.explain.confidence}%</span></div>
                <p className="text-[10px] text-gray-400 mt-1">Alternative: {d.explain.alternative} · Expected: {d.explain.outcome}</p>
              </>)}
            </div>

            <div className={`${card} p-5`}>
              <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">8</span><h3 className="text-xs font-bold text-gray-900">AI Insights Feed</h3></div>
              {d.feed.length === 0 ? <p className="text-sm text-gray-400">No insights — the shift is stable.</p> : (
                <div className="space-y-2">{d.feed.map((f: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${FEED_DOT[f.tone] ?? "bg-gray-300"}`} /><div className="min-w-0"><p className="text-[11px] font-medium text-gray-800 leading-tight">{f.text}</p><p className="text-[10px] text-gray-400">{f.sub}</p></div></div>))}</div>
              )}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <div className="flex items-center gap-1.5 mb-3"><span className="text-base">✨</span><h2 className="text-sm font-bold text-gray-900">AI Copilot Recommendations</h2></div>
            {d.recs.length === 0 ? <p className="text-sm text-gray-400">No recommendations — the shift is balanced.</p> : (
              <div className="space-y-2">{d.recs.map((r: any, i: number) => (<Link key={i} href={r.href} className="block rounded-lg border border-gray-100 hover:border-teal-300 p-2.5"><div className="flex items-center gap-2"><p className="text-xs font-medium text-gray-800 truncate flex-1">{r.title}</p><span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded ${PRIO_BADGE[r.priority] ?? "bg-gray-100 text-gray-600"}`}>{r.priority}</span></div><p className="text-[10px] text-gray-400">{r.sub}</p></Link>))}</div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h2 className="text-sm font-bold text-gray-900 mb-2">AI Shift Summary</h2>
            <p className="text-[11px] text-gray-600 leading-relaxed">{d.summary || "Shift is stable."}</p>
          </div>
        </div>
      </div>

      {/* AI Agents */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">AI Agents Working for You <span className="text-gray-400 font-normal">· specialised AI services powering recommendations</span></h2>
        <div className="flex flex-wrap gap-2">{d.agents.map((a: string) => (<div key={a} className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /><span className="text-[11px] text-gray-700">{a}</span></div>))}</div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The AI Operational Copilot (SSW-AI-001) is the workspace's decision-support layer — a live command centre, workforce/patient/safety/operational/predictive intelligence, prioritised recommendations with explainable reasoning and confidence, an AI insights feed and a shift-grounded natural-language assistant. Intelligence is heuristic/rule-based over live operational data; recommendations are proposals for the supervisor to accept, and every AI answer is audited. True ML models are a later phase.</p>
    </div>
  );
}
