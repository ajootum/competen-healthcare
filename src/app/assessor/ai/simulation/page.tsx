import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, passRateOf, avgScoreOf } from "@/lib/analytics";
import { StatTiles, Card } from "../../reports/ui";
import { AiHeader } from "../ui";
import AskAi from "../AskAi";

// Simulation Intelligence — AI insight over real simulation performance
// (simulation-method assessments), plus the scenario designer.

export const dynamic = "force-dynamic";

export default async function SimulationIntelligencePage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const sims = ctx.assess.filter(a => a.method === "simulation");
  const nameById = new Map(ctx.latest.map(d => [d.competency_id, d.name]));
  const failAgg = new Map<string, { fails: number; n: number }>();
  for (const a of sims) {
    if (!a.competency_id) continue;
    const name = nameById.get(a.competency_id) ?? "Competency";
    const v = failAgg.get(name) ?? { fails: 0, n: 0 };
    v.n++; if (a.score < 3) v.fails++;
    failAgg.set(name, v);
  }
  const byScenario = [...failAgg.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const improvement = [...failAgg.entries()].filter(([, v]) => v.fails > 0).sort((a, b) => b[1].fails - a[1].fails).slice(0, 4);

  return (
    <div className="max-w-4xl">
      <AiHeader icon="🧪" title="Simulation Intelligence" sub="AI insights from simulation performance — real simulation-method assessments, 8-week window." />
      <StatTiles tiles={[
        { label: "Simulations Scored", value: String(sims.length), sub: "8 weeks" },
        { label: "Pass Rate", value: passRateOf(sims) != null ? `${passRateOf(sims)}%` : "—" },
        { label: "Average Score", value: avgScoreOf(sims) != null ? `${avgScoreOf(sims)}` : "—", sub: "Benner 0–6" },
        { label: "Fails", value: String(sims.filter(s => s.score < 3).length), alert: sims.some(s => s.score < 3) },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Performance by Competency" sub="simulation assessments per competency">
          {byScenario.length ? (
            <div className="space-y-2">
              {byScenario.map(([name, v]) => {
                const pct = Math.round((v.n - v.fails) / v.n * 100);
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="text-gray-700 truncate">{name}</span>
                      <span className="font-bold text-gray-900">{pct}% <span className="font-normal text-gray-300">of {v.n}</span></span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-gray-400">No simulation assessments in the window — run sessions from the Simulation Centre.</p>}
        </Card>
        <Card title="Top Improvement Areas" sub="most failed in simulation">
          {improvement.length ? (
            <ul className="space-y-1.5">
              {improvement.map(([name, v]) => (
                <li key={name} className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-700 flex-1 truncate">{name}</span>
                  <span className="text-[9px] font-bold bg-red-50 text-red-600 rounded px-1.5 py-0.5">{v.fails} fail{v.fails === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No failed simulations on record. ✅</p>}
          <Link href="/assessor/simulation" className="mt-3 inline-block text-[11px] font-semibold text-indigo-600 hover:underline">Open Simulation Centre →</Link>
        </Card>
      </div>

      <Card title="AI Reading" sub="Claude, grounded in the simulation figures">
        <AskAi endpoint="/api/ai/insights" body={{ scope: "simulation" }} label="Analyse simulation performance" />
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Team-communication analytics and critical-error timelines shown in the mockup need in-session event capture that doesn&apos;t exist —
        figures here come from recorded simulation scores only. Draft new scenarios with the{" "}
        <Link href="/assessor/simulation" className="text-indigo-500 hover:underline">AI Scenario Designer</Link>.
      </p>
    </div>
  );
}
