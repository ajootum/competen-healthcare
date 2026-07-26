import { fetchCmoSuite } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Bars, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-017 AI Competency Intelligence Centre — predictive analytics, recommendations and explainable decision support.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_TONE: Record<string, string> = { gap: "rose", risk: "amber", readiness: "blue", certification: "teal", privileging: "violet", planning: "emerald" };
const CAT_ICON: Record<string, string> = { gap: "🕳️", risk: "⚠️", readiness: "📊", certification: "🎓", privileging: "🏥", planning: "🗺️" };

export default async function AiIntelligencePage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-017 · Competency Office" title="AI Competency Intelligence Centre" sub="Predictive analytics, intelligent recommendations and explainable decision support for competency risk, readiness and workforce planning." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="AI Intelligence" part="part 2" /></div>;

  const recs = d.aiRecs;
  const byCategory = Object.entries(recs.reduce((acc: Record<string, number>, r: any) => { acc[r.category] = (acc[r.category] ?? 0) + 1; return acc; }, {})).map(([label, n]) => ({ label, n: n as number })).sort((a, b) => b.n - a.n);
  const avgConf = recs.length ? Math.round(recs.reduce((a: number, r: any) => a + Number(r.confidence || 0), 0) / recs.length) : 0;
  const highImpact = recs.filter((r: any) => r.impact === "high");

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Recommendations" value={recs.length} sub="actionable" tone="text-teal-600" />
        <Kpi label="High Impact" value={highImpact.length} sub="prioritised" tone={highImpact.length ? "text-rose-600" : undefined} />
        <Kpi label="Avg Confidence" value={`${avgConf}%`} sub="explainable" />
        <Kpi label="Categories" value={byCategory.length} sub="domains" />
        <Kpi label="Open" value={recs.filter((r: any) => r.status === "open").length} sub="awaiting review" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Insights by Domain">
          <Bars rows={byCategory} colors={byCategory.map((b: any) => (({ gap: "#f43f5e", risk: "#f59e0b", readiness: "#3b82f6", certification: "#14b8a6", privileging: "#a855f7", planning: "#22c55e" } as Record<string, string>)[b.label] ?? "#14b8a6"))} />
          <p className="text-[10px] text-gray-400 mt-3">Every recommendation carries a confidence score and evidence — explainable, traceable, human-in-the-loop.</p>
        </Card>

        <Card title="AI Recommendations" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by confidence</span>}>
          <div className="space-y-2">{[...recs].sort((a: any, b: any) => Number(b.confidence) - Number(a.confidence)).map((r: any) => (
            <div key={r.id} className="flex items-start gap-3 border border-gray-100 rounded-lg p-2.5">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${r.impact === "high" ? "bg-rose-50" : r.impact === "medium" ? "bg-amber-50" : "bg-blue-50"}`}>{CAT_ICON[r.category] ?? "💡"}</span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 flex-wrap"><p className="text-[12px] font-medium text-gray-900">{r.title}</p><Pill text={r.category} tone={CAT_TONE[r.category] ?? "slate"} /><Pill text={`${r.impact} impact`} tone={r.impact === "high" ? "rose" : r.impact === "medium" ? "amber" : "slate"} /></div><p className="text-[11px] text-gray-500 mt-0.5">{r.detail}</p></div>
              <span className="text-[12px] font-semibold text-gray-700 shrink-0">{r.confidence}%</span>
            </div>
          ))}</div>
        </Card>
      </div>

      <Foot>CMO-017 — AI competency intelligence over cmo_ai_recommendations (gap / risk / readiness / certification / privileging / planning). Recommendations are explainable, confidence-scored insights over the competency data; wiring a governed LLM copilot (via the AI Services Platform) and the acceptance/feedback loop are the next phase.</Foot>
    </div>
  );
}
