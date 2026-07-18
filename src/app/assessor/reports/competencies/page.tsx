import { loadAnalytics, requireAnalyticsAccess, competencyProfile } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";

// Competency Analytics module — per-competency performance from latest
// decisions plus 8-week assessment scores, with a real 90-day expiry outlook.

export const dynamic = "force-dynamic";

export default async function CompetencyAnalyticsPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const comps = competencyProfile(ctx.latest);
  const nameById = new Map<string, string>();
  for (const d of ctx.latest) nameById.set(d.competency_id, d.name);

  // Avg assessment score per competency (8 weeks)
  const scoreAgg = new Map<string, { sum: number; n: number }>();
  for (const a of ctx.assess) {
    if (!a.competency_id) continue;
    const s = scoreAgg.get(a.competency_id) ?? { sum: 0, n: 0 };
    s.sum += a.score; s.n++;
    scoreAgg.set(a.competency_id, s);
  }
  const avgByName = new Map<string, number>();
  for (const [id, s] of scoreAgg) {
    const name = nameById.get(id);
    if (name) avgByName.set(name, Math.round(s.sum / s.n * 10) / 10);
  }

  const above80 = comps.filter(c => c.pct >= 80).length;
  const below60 = comps.filter(c => c.pct < 60).length;
  const expiring90 = comps.reduce((s, c) => s + c.expSoon, 0);
  const rows = [...comps].sort((a, b) => b.total - a.total).slice(0, 12);
  const weakest = [...comps].filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 5);

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="🧩" title="Competency Analytics" sub="Performance of competencies across the organisation — latest decisions, assessment scores and expiry outlook." />
      <StatTiles tiles={[
        { label: "Competencies Decided", value: String(comps.length), sub: "with ≥1 decision" },
        { label: "Above 80% Pass", value: String(above80) },
        { label: "Below 60% Pass", value: String(below60), alert: below60 > 0 },
        { label: "Expiring (90 days)", value: String(expiring90), sub: "real expiry dates", alert: expiring90 > 0 },
      ]} />

      <Card title="Competency Performance" sub="top by decision volume">
        {rows.length ? (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                <th className="pb-1.5">Competency</th><th className="pb-1.5 text-center">Pass rate</th>
                <th className="pb-1.5 text-center">Avg score (8w)</th><th className="pb-1.5 text-center">Decisions</th>
                <th className="pb-1.5 text-center">Expiring 90d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(c => (
                <tr key={c.name}>
                  <td className="py-1.5 text-gray-700">{c.name}</td>
                  <td className="py-1.5 text-center"><PctChip v={c.pct} /></td>
                  <td className="py-1.5 text-center text-gray-600">{avgByName.get(c.name) ?? "—"}</td>
                  <td className="py-1.5 text-center text-gray-600">{c.total}</td>
                  <td className="py-1.5 text-center">{c.expSoon ? <span className="font-bold text-amber-600">{c.expSoon}</span> : <span className="text-gray-300">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-xs text-gray-400">No competency decisions on record yet.</p>}
      </Card>

      <div className="mt-4">
        <Card title="Lowest Performing Competencies" sub="≥2 decisions — competency gaps to target">
          {weakest.length ? (
            <div className="space-y-1.5">
              {weakest.map(c => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-gray-700">{c.name}</span>
                    <span className="font-bold text-red-600">{c.pct}% <span className="font-normal text-gray-300">of {c.total}</span></span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">Needs at least 2 decisions per competency.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Pass rates use each clinician&apos;s latest decision per competency; expiry counts are real expiry dates, not projections.
        Reassessment trends grow richer as more decision cycles complete.
      </p>
    </div>
  );
}
