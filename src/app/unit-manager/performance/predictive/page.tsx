import { loadPaPredictive } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, Ring, Pill, Provision, Foot } from "../_ui";
import AiCopilotPanel from "@/components/AiCopilotPanel";

export const dynamic = "force-dynamic";

// UMW-PA-007 Predictive Performance & AI Intelligence Centre — predictions, early warnings, recommendations and a
// KPI risk heatmap. Rule-based/seeded intelligence (explainable), not an opaque model. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
const HEAT = (n: number) => (n === 0 ? "bg-gray-50 text-gray-300" : n <= 1 ? "bg-[var(--cmp-surface-success)] text-emerald-700" : n <= 2 ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]");

export default async function PredictivePage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaPredictive(admin, hid, isSuper) as any;
  const head = <Head code="UMW-PA-007 · Performance Analytics" title="Predictive Performance & AI Intelligence Centre" sub="AI-assisted intelligence — predict performance, surface emerging risks and recommend high-impact interventions, each explainable and traceable." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="007" /><Provision module="Predictive & AI Intelligence" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="007" /><div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">Seed the performance stores first.</div></div>;

  const r = d.ribbon;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="007" />
      <AiCopilotPanel endpoint="/api/performance/copilot" title="Predictive Performance — live copilot" sublabel="Grounded in your live balanced scorecard, KPI RAG status & trends · logged to the AI gateway" placeholder="Ask where you're off target, what's declining, what to prioritise…" prompts={["Performance briefing", "What's off target?", "What's trending down?", "Top improvement priorities"]} />
      {d.empty && <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-lg p-3 text-[12px] text-amber-800">No predictions seeded yet — the <code className="font-mono">pa_predictions</code> table returned empty. Re-run migration 108 + the seed to populate. The risk heatmap below is derived from live KPI RAG status.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={r.aiScore || 0} size={60} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">AI Performance</p><p className="text-[11px] text-indigo-600 font-medium">avg confidence</p></div></div>
        <Kpi label="Active Recommendations" value={r.recommendations} sub={`${r.highImpact} high impact`} status="green" />
        <Kpi label="Emerging Risks" value={r.risks} sub="detected" status={r.risks ? "amber" : "green"} />
        <Kpi label="Predictions" value={r.predictions} sub="next 30 days" />
        <Kpi label="Forecast Confidence" value={`${r.avgConfidence || 0}%`} sub="mean" status={r.avgConfidence >= 80 ? "green" : "amber"} />
        <Kpi label="Optimisation Value" value={money(r.benefit)} sub="est. benefit" status="green" />
        <Kpi label="Recommendation Value" value={money(r.benefit)} sub="if actioned" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="KPI Risk Heatmap" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by perspective</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide"><span className="flex-1">Perspective</span><span className="w-16 text-center">Low</span><span className="w-16 text-center">Medium</span><span className="w-16 text-center">High</span></div>
            {d.heatmap.map((h: any) => (
              <div key={h.perspective} className="flex items-center gap-1 text-[12px]"><span className="flex-1 text-gray-700 truncate">{h.perspective}</span>
                <span className={`w-16 text-center py-1 rounded font-semibold tabular-nums ${HEAT(h.low)}`}>{h.low}</span>
                <span className={`w-16 text-center py-1 rounded font-semibold tabular-nums ${HEAT(h.medium)}`}>{h.medium}</span>
                <span className={`w-16 text-center py-1 rounded font-semibold tabular-nums ${HEAT(h.high)}`}>{h.high}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Cells = count of KPIs at each RAG level (green→low, amber→medium, red→high). Live from current KPI status.</p>
        </Card>

        <Card title="Top Predictions" right={<span className="text-[11px] text-gray-400">{d.predictions.length}</span>}>
          {d.predictions.length ? <div className="space-y-2">{d.predictions.map((p: any, i: number) => (
            <div key={i} className="border border-gray-100 rounded-lg p-2.5"><div className="flex items-center gap-1.5 mb-0.5"><Pill text={p.risk ?? "info"} tone={p.risk === "high" ? "rose" : p.risk === "medium" ? "amber" : "blue"} /><span className="text-[10px] text-gray-400 ml-auto">{p.confidence}% conf</span></div><p className="text-[12px] text-gray-800 leading-tight">{p.title}</p></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No predictions.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="AI Recommendations" right={<span className="text-[11px] text-gray-400">ranked by impact</span>}>
          {d.recommendations.length ? <div className="space-y-2">{d.recommendations.map((p: any, i: number) => (
            <div key={i} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5"><span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-sm shrink-0">💡</span><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 flex-wrap"><p className="text-[12px] font-medium text-gray-900">{p.title}</p><Pill text={`${p.impact} impact`} tone={p.impact === "high" ? "rose" : "amber"} /></div><p className="text-[11px] text-gray-500">{p.detail}</p></div><div className="text-right shrink-0"><p className="text-[12px] font-semibold text-[var(--cmp-text-success)]">{money(p.benefit)}</p><p className="text-[10px] text-gray-400">{p.confidence}%</p></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No recommendations.</p>}
        </Card>

        <Card title="Emerging Risks">
          {d.risks.length ? <div className="space-y-2">{d.risks.map((p: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="text-rose-500 mt-0.5">⚠️</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight">{p.title}</p><p className="text-[10px] text-gray-400">{p.detail}</p></div><Pill text={`${p.confidence}%`} tone="rose" /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No emerging risks flagged.</p>}
        </Card>
      </div>

      <Foot>UMW-PA-007 — predictive intelligence over pa_predictions + the live KPI risk heatmap, now paired with a <strong>live LLM copilot</strong> (top) wired to the real AI Runtime Gateway and grounded in the same balanced scorecard. The seeded predictions/recommendations below are explainable intents (confidence + est. benefit) and the heatmap is computed live from current KPI RAG status; the copilot adds natural-language analysis on demand and logs every call to the AI Services Platform (AIS-011 / AIS-008). Scenario simulation is the next phase.</Foot>
    </div>
  );
}
