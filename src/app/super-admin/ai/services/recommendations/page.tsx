import { requireHqCapability } from "@/lib/hq/context";
import { loadAiRecommendations } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Bars, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-006 Recommendation & Prediction Engine — a unified view over the platform's REAL AI recommendation/prediction
// data (adm_ai_recommendations + pa_predictions). No new store — aggregation over what's already generated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
const IMPACT_TONE: Record<string, string> = { high: "rose", medium: "amber", low: "slate", critical: "rose" };

export default async function RecommendationsPage() {
  const { admin } = await requireHqCapability("hq.platform.ai.view");
  const d = await loadAiRecommendations(admin) as any;
  const head = <Head code="AIS-006 · AI Services Platform" title="Recommendation & Prediction Engine" sub="A unified, explainable view of every AI recommendation, prediction and risk the platform generates — aggregated across workspaces." />;
  if (!d.provisioned || !d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="006" /><div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">No AI recommendation data yet — seed the Administration (ADM-009) and Performance (PA-007) sections; this engine aggregates their real output.</div></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="006" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Total Insights" value={k.total} sub="recs + predictions" />
        <Stat label="Recommendations" value={k.recommendations} sub="actionable" tone="text-violet-700" />
        <Stat label="Predictions" value={k.predictions} sub="forecasts" />
        <Stat label="Risks / High Impact" value={k.risks} sub="need attention" tone={k.risks ? "text-[var(--cmp-text-error)]" : undefined} />
        <Stat label="Avg Confidence" value={`${k.avgConfidence}%`} sub="explainable" />
        <Stat label="Est. Benefit" value={money(k.benefit)} sub="if actioned" tone="text-[var(--cmp-text-success)]" />
        <Stat label="High Impact" value={k.highImpact} sub="prioritised" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="By Source">
          <Bars rows={d.bySource.map((s: any) => ({ label: s.label, n: s.n }))} />
          <p className="text-[10px] text-gray-500 mt-3">Aggregated from adm_ai_recommendations (Administration) + pa_predictions (Performance). PPE priority AI and per-workspace copilots feed in as those stores grow.</p>
        </Card>
        <Card title="By Kind"><Bars rows={d.byKind.map((s: any) => ({ label: s.label, n: s.n }))} /></Card>
        <Card title="Confidence Bands">
          <div className="space-y-2 text-[12px]">
            {[["High (≥85%)", d.top.filter((r: any) => r.confidence >= 85).length, "bg-[var(--cmp-color-success)]"], ["Medium (70–84%)", d.top.filter((r: any) => r.confidence >= 70 && r.confidence < 85).length, "bg-[var(--cmp-color-warning)]"], ["Lower (<70%)", d.top.filter((r: any) => r.confidence < 70).length, "bg-gray-400"]].map(([l, n, c]: any) => (
              <div key={l} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${c}`} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900">{n}</span></div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Top Insights" right={<span className="text-[11px] text-gray-500">by confidence</span>}>
        <div className="space-y-2">
          {d.top.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-lg p-2.5">
              <span className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0 text-sm">{r.kind === "prediction" ? "📈" : r.kind === "risk" ? "⚠️" : "💡"}</span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 flex-wrap"><p className="text-[13px] font-medium text-gray-900">{r.title}</p><Pill text={r.source} tone="blue" /><Pill text={r.kind} tone="violet" />{r.impact && <Pill text={`${r.impact} impact`} tone={IMPACT_TONE[r.impact] ?? "slate"} />}</div>{r.detail && <p className="text-[11px] text-gray-500 mt-0.5">{r.detail}</p>}</div>
              <div className="text-right shrink-0"><p className="text-[13px] font-semibold text-gray-800">{r.confidence}%</p>{r.benefit ? <p className="text-[10px] text-[var(--cmp-text-success)]">{money(r.benefit)}</p> : null}</div>
            </div>
          ))}
        </div>
      </Card>

      <Foot>AIS-006 — the recommendation &amp; prediction engine as a real aggregation over the platform&apos;s existing AI output (adm_ai_recommendations + pa_predictions). Every insight carries a confidence score and (mostly) explainability. A unified feedback/acceptance loop and cross-workspace prioritisation are the next phase.</Foot>
    </div>
  );
}
