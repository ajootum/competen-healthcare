import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, competencyProfile } from "@/lib/analytics";
import { StatTiles, Card, PctChip } from "../../reports/ui";
import { AiHeader } from "../ui";
import AskAi from "../AskAi";

// Competency Intelligence — deep view of competency performance and gaps,
// with an AI reading of the same figures. Decay analysis needs longitudinal
// re-scoring data that doesn't exist yet and is stated as such.

export const dynamic = "force-dynamic";

export default async function CompetencyIntelligencePage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const comps = competencyProfile(ctx.latest);
  const rated = comps.filter(c => c.total >= 2);
  const weak = [...rated].sort((a, b) => a.pct - b.pct).slice(0, 6);
  const strong = [...rated].sort((a, b) => b.pct - a.pct).slice(0, 6);
  const expiring = comps.reduce((s, c) => s + c.expSoon, 0);

  return (
    <div className="max-w-4xl">
      <AiHeader icon="🧠" title="Competency Intelligence" sub="Deep intelligence on competency performance and gaps across the organisation." />
      <StatTiles tiles={[
        { label: "Total Competencies", value: String(comps.length), sub: "with ≥1 decision" },
        { label: "Strong (≥80%)", value: String(comps.filter(c => c.pct >= 80).length) },
        { label: "At Risk (<60%)", value: String(comps.filter(c => c.pct < 60).length), alert: comps.some(c => c.pct < 60) },
        { label: "Expiring (90d)", value: String(expiring), alert: expiring > 0 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Top Weak Competencies" sub="≥2 decisions">
          {weak.length ? weak.map(c => (
            <div key={c.name} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1 truncate">{c.name}</span>
              <span className="text-gray-300">{c.total} dec.</span>
              <PctChip v={c.pct} />
            </div>
          )) : <p className="text-xs text-gray-400">Needs ≥2 decisions per competency.</p>}
        </Card>
        <Card title="Strongest Competencies" sub="≥2 decisions">
          {strong.length ? strong.map(c => (
            <div key={c.name} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1 truncate">{c.name}</span>
              <span className="text-gray-300">{c.total} dec.</span>
              <PctChip v={c.pct} />
            </div>
          )) : <p className="text-xs text-gray-400">—</p>}
        </Card>
      </div>

      <Card title="AI Reading" sub="Claude, grounded in the live competency profile">
        <AskAi endpoint="/api/ai/insights" body={{ scope: "competency" }} label="Analyse competency performance" />
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Full tables live in <Link href="/assessor/reports/competencies" className="text-indigo-500 hover:underline">Competency Analytics</Link>.
        Honest scope: competency <em>decay</em> analysis needs repeated re-scoring of the same competency over time — that longitudinal data doesn&apos;t exist yet, so no decay curve is shown.
      </p>
    </div>
  );
}
