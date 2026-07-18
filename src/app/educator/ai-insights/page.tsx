import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, riskBuckets, competencyProfile } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import AskAi from "@/app/assessor/ai/AskAi";
import { EduHeader } from "../ui";

// AI Learning Insights — the AI layer over learner support: rule-derived
// signals (labeled), grounded Claude narratives per scope, and per-learner
// coach plans. "Risk prediction" is deliberately record-derived, not ML.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ n?: string }>;

export default async function AiLearningInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireEducatorAccess();
  const { n } = await searchParams;
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const comps = competencyProfile(ctx.latest);
  const sel = n ? ctx.nurses.find(x => x.id === n) ?? null : null;

  const weak = comps.filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 3);
  const in30 = new Date(new Date().getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const expiring = ctx.latest.filter(d => d.passing && !d.expired && d.expiry_date && d.expiry_date <= in30).length;

  const recommendations: { text: string; href: string }[] = [
    ...(weak.length ? [{ text: `Prioritise teaching on ${weak[0].name} (${weak[0].pct}% passing)`, href: "/educator/gaps" }] : []),
    ...(risk.high ? [{ text: `Review ${risk.high} high-risk learner${risk.high === 1 ? "" : "s"} and plan remediation`, href: "/educator/at-risk" }] : []),
    ...(expiring ? [{ text: `Schedule reassessment for ${expiring} expiring competenc${expiring === 1 ? "y" : "ies"}`, href: "/assessor/calendar" }] : []),
  ];

  return (
    <div className="max-w-4xl">
      <EduHeader icon="✨" title="AI Learning Insights" sub="AI support for learner development — every signal is record-derived and labeled; narratives are grounded in live figures." />
      <StatTiles tiles={[
        { label: "High Risk", value: String(risk.high), sub: "record-derived, not predicted", alert: risk.high > 0 },
        { label: "Priority Competencies", value: String(weak.length), sub: weak[0] ? weak[0].name.slice(0, 22) : "none" },
        { label: "Expiring (30d)", value: String(expiring) },
        { label: "Learners Analysed", value: String(ctx.nurses.length) },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Top Recommendations" sub="rule-derived — each traces to a live figure">
          {recommendations.length ? (
            <ol className="space-y-1.5">
              {recommendations.map((r, i) => (
                <li key={i}>
                  <Link href={r.href} className="text-[11px] text-gray-700 hover:text-purple-700">{i + 1}. {r.text} →</Link>
                </li>
              ))}
            </ol>
          ) : <p className="text-xs text-gray-400">No pressing recommendations — cohort is on track. ✅</p>}
        </Card>
        <Card title="AI Cohort Narrative" sub="Claude, grounded in live learner-support figures">
          <AskAi endpoint="/api/ai/insights" body={{ scope: "overview" }} label="Generate cohort insight" />
        </Card>
      </div>

      <Card title="Per-Learner AI Plan" sub="the coach engine — grounded in the learner's own gaps and linked resources">
        <form action="/educator/ai-insights" className="flex items-center gap-2 mb-3">
          <select name="n" defaultValue={sel?.id ?? ""}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-purple-400">
            <option value="">Choose a learner…</option>
            {ctx.nurses.map(x => <option key={x.id} value={x.id}>{x.name} · {x.dept}</option>)}
          </select>
          <button type="submit" className="text-xs font-semibold text-white bg-purple-600 rounded-lg px-3 py-1.5 hover:bg-purple-700">Select</button>
        </form>
        {sel
          ? <AskAi endpoint="/api/ai/coach" body={{ nurse_id: sel.id }} label={`Generate plan for ${sel.name.split(" ")[0]}`} />
          : <p className="text-xs text-gray-400">Select a learner to generate a personalised development plan.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: &quot;competency forecast&quot; percentages and ML risk prediction need outcome history at scale — flags here trace to real records,
        and every AI generation is quota-limited and audit-logged.
      </p>
    </div>
  );
}
