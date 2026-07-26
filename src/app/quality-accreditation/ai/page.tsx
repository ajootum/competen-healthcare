import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Foot, T } from "../_ui";
import { loadAiIntelligence } from "@/lib/qaw/ai-intelligence";
import AiCopilotPanel from "@/components/AiCopilotPanel";

export const dynamic = "force-dynamic";

// QAW-012 AI Quality Intelligence Centre — live LLM copilot + real-data intelligence widgets.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Predictive Analytics", "Accreditation Intelligence", "Quality Insights", "Risk Intelligence", "Safety Intelligence", "Audit Intelligence", "Governance Intelligence", "AI Settings"];
const BANDS = [["low", "Low"], ["moderate", "Moderate"], ["high", "High"], ["critical", "Critical"]] as const;
const BAND_TONE: Record<string, string> = { low: "emerald", moderate: "amber", high: "amber", critical: "rose" };

export default async function AiIntelligencePage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadAiIntelligence(admin, hid, isSuper);
  const head = <Head code="QAW-012 · Quality & Accreditation" title="AI Quality Intelligence Centre" sub="AI-powered intelligence, predictions and insights to drive quality, safety and accreditation excellence." />;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <AiCopilotPanel endpoint="/api/quality-ai/copilot" title="Quality Intelligence — live copilot" sublabel="Grounded in your live audits, findings, CAPA, risks, compliance & incidents · logged to the AI gateway" placeholder="Ask about risks, readiness, compliance or what to prioritise…" prompts={["Quality intelligence briefing", "What threatens accreditation readiness?", "Top risks right now", "What should we prioritise?"]} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🏅" tone="teal" label="Quality score" value={k.qualityScore != null ? `${k.qualityScore}` : "—"} sub="audit-derived" />
        <Stat icon="🛡️" tone="blue" label="Predicted readiness" value={k.predictedReadiness != null ? `${k.predictedReadiness}%` : "—"} sub="projected" />
        <Stat icon="🔴" tone="rose" label="High-risk issues" value={k.highRisks} sub="open register" />
        <Stat icon="🔎" tone="amber" label="Audit priority areas" value={k.auditPriority} sub="open findings" />
        <Stat icon="⚠️" tone="violet" label="Incidents projected" value={k.predictedIncidents != null ? k.predictedIncidents : "—"} sub="next month" />
        <Stat icon="✨" tone="indigo" label="AI interactions" value={k.aiCalls} sub="logged calls" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Predicted accreditation readiness" className="xl:col-span-2" right="actual + projected">
          {d.readinessTrend.length >= 2 ? <><Trend points={d.readinessTrend.map((t: any) => t.value)} labels={d.readinessTrend.map((t: any) => t.label)} tone="teal" suffix="%" target={90} height={150} /><p className="text-[10px] text-gray-400 text-center mt-1">The final points are a <strong>rule-based linear projection</strong> from the real assessment trend — not a machine-learning forecast. Dashed line = 90% survey target.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough assessment history for a projection yet.</p>}
        </Card>

        <Card title="Incident pattern detection">
          {d.incidentPattern.length ? <div className="flex items-center gap-2"><Donut segments={d.incidentPattern} total={d.incidentPattern.reduce((s: number, x: any) => s + x.value, 0)} label="Incidents" size={130} /><Legend items={d.incidentPattern.slice(0, 6).map((x: any) => ({ label: x.label, value: x.value, tone: x.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No incidents to analyse.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="AI risk heatmap" className="xl:col-span-2" right="register × severity">
          {d.riskHeat.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400"><th className="pb-1 pr-3 font-medium">Category</th>{BANDS.map(([, l]) => <th key={l} className="pb-1 px-2 font-medium text-center">{l}</th>)}</tr></thead>
                <tbody>
                  {d.riskHeat.map((r: any, i: number) => (
                    <tr key={i}><td className="py-1 pr-3 text-gray-700 capitalize">{r.category}</td>
                      {BANDS.map(([key]) => (
                        <td key={key} className="py-1 px-2"><div className="h-7 rounded flex items-center justify-center font-bold tabular-nums" style={{ backgroundColor: T(BAND_TONE[key]).hex + (r[key] ? "26" : "10"), color: r[key] ? T(BAND_TONE[key]).hex : "#cbd5e1" }}>{r[key]}</div></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Live from the risk register (<code>gov_risks</code>), scored likelihood × impact — an explainable heatmap, not a black-box model.</p>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No risks registered.</p>}
        </Card>

        <Card title="AI quality insights" right="explainable">
          <div className="space-y-2">
            {d.insights.map((it: any, i: number) => (
              <div key={i} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${T(it.tone).dot}`} />
                <div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-snug">{it.title}</p><Pill text={it.kind} tone={it.tone} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="AI recommendations" className="xl:col-span-2" right="ranked by impact">
          {d.recommendations.length ? <div className="space-y-2">{d.recommendations.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-3 border border-gray-100 rounded-lg p-3">
              <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-sm shrink-0">💡</span>
              <p className="text-[13px] font-medium text-gray-800 flex-1">{r.title}</p>
              <Pill text={`${r.impact} impact`} tone={r.impact === "high" ? "rose" : "amber"} />
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No elevated signals — nothing to recommend right now. ✅</p>}
          <p className="text-[10px] text-gray-400 mt-2">These are <strong>rule-based, explainable</strong> recommendations derived from the live data. For natural-language reasoning, use the copilot above (real LLM, grounded + logged).</p>
        </Card>

        <Card title="AI usage telemetry" right="plat_ai_requests">
          <div className="space-y-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-gray-500">Quality copilot calls</span><b className="tabular-nums">{d.aiUsage.qualityCalls}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Platform AI calls</span><b className="tabular-nums">{d.aiUsage.totalCalls}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Tokens processed</span><b className="tabular-nums">{d.aiUsage.tokens.toLocaleString()}</b></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Every copilot call is metered to the AI Services Platform (AIS-011 Observability / AIS-008 Governance) — real spend and latency, fully auditable.</p>
        </Card>
      </div>

      <Foot>QAW-012 — the <strong>live copilot</strong> (top) is a real LLM grounded in this workspace&apos;s quality data via the AI Runtime Gateway; every call is logged to <code>plat_ai_requests</code>. The intelligence widgets are grounded in real stores (<code>gov_risks</code>, <code>op_incidents</code>, <code>gov_standard_assessments</code>, audit/CAPA data); &ldquo;predicted&rdquo; figures are transparent <strong>rule-based projections</strong> from those trends — explicitly not black-box ML. A persisted per-domain prediction/feedback store (to track recommendation acceptance and model accuracy) is the next build phase.</Foot>
    </div>
  );
}
