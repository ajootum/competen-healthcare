import { loadAnalytics, requireAnalyticsAccess, passRateOf, avgScoreOf, deltaLabel, competencyProfile, riskBuckets } from "@/lib/analytics";
import { StatTiles, Card } from "../../reports/ui";
import { AiHeader } from "../ui";
import AskAi from "../AskAi";

// Assessment Insights — rule-derived signals from live records, with an
// on-demand Claude narrative grounded in the same figures.

export const dynamic = "force-dynamic";

export default async function AssessmentInsightsPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const cur = ctx.assess.filter(a => a.assessed_at >= d30);
  const prev = ctx.assess.filter(a => a.assessed_at < d30);
  const comps = competencyProfile(ctx.latest);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const pending = ctx.entries.filter(e => e.status === "pending").length;
  const weak = [...comps].filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 3);
  const expiring = comps.reduce((s, c) => s + c.expSoon, 0);

  const insights: { icon: string; text: string; tone: "up" | "down" | "warn" | "info" }[] = [
    ...(passRateOf(cur) != null && passRateOf(prev) != null
      ? [{ icon: passRateOf(cur)! >= passRateOf(prev)! ? "📈" : "🔻", text: `Pass rate ${passRateOf(cur)}% this month vs ${passRateOf(prev)}% in the prior window (${deltaLabel(passRateOf(cur), passRateOf(prev))}).`, tone: (passRateOf(cur)! >= passRateOf(prev)! ? "up" : "down") as "up" | "down" }] : []),
    ...(weak.length ? [{ icon: "🎯", text: `Weakest competency: ${weak[0].name} at ${weak[0].pct}% passing (${weak[0].total} decisions).`, tone: "warn" as const }] : []),
    ...(risk.high ? [{ icon: "🚩", text: `${risk.high} learner${risk.high === 1 ? "" : "s"} carry critical-failure flags and need priority reassessment.`, tone: "warn" as const }] : []),
    ...(expiring ? [{ icon: "⏳", text: `${expiring} competenc${expiring === 1 ? "y" : "ies"} expire within 90 days — plan reassessment capacity.`, tone: "info" as const }] : []),
    ...(pending ? [{ icon: "🖊️", text: `${pending} evidence item${pending === 1 ? "" : "s"} await validation.`, tone: "info" as const }] : []),
  ];

  return (
    <div className="max-w-4xl">
      <AiHeader icon="💡" title="Assessment Insights" sub="Signals derived from your live assessment data, with an AI narrative on demand." />
      <StatTiles tiles={[
        { label: "Assessments (30d)", value: String(cur.length), d: deltaLabel(cur.length, prev.length) },
        { label: "Pass Rate (30d)", value: passRateOf(cur) != null ? `${passRateOf(cur)}%` : "—", d: deltaLabel(passRateOf(cur), passRateOf(prev)) },
        { label: "Avg Score (30d)", value: avgScoreOf(cur) != null ? `${avgScoreOf(cur)}` : "—" },
        { label: "Attention Items", value: String(risk.high + expiring + (pending > 10 ? 1 : 0)), sub: "risk + expiries + backlog", alert: risk.high > 0 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Top Insights" sub="rule-derived — each tied to a live figure">
          {insights.length ? (
            <ul className="space-y-2">
              {insights.map((s, i) => (
                <li key={i} className={`flex gap-2 text-xs rounded-lg px-2.5 py-2 border ${
                  s.tone === "down" || s.tone === "warn" ? "bg-red-50/50 border-red-100 text-red-800" :
                  s.tone === "up" ? "bg-green-50/50 border-green-100 text-green-800" : "bg-gray-50 border-gray-100 text-gray-700"}`}>
                  <span>{s.icon}</span>{s.text}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No notable signals — not enough recent activity.</p>}
        </Card>
        <Card title="AI Narrative" sub="Claude, grounded in the figures on this page">
          <AskAi endpoint="/api/ai/insights" body={{ scope: "overview" }} label="Generate insight narrative" />
        </Card>
      </div>

      <p className="text-[10px] text-gray-400">
        The signal list is deterministic (rules over live records); the narrative is generative but receives only the computed figures — it cannot introduce new numbers.
      </p>
    </div>
  );
}
