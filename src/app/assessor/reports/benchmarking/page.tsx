import { loadAnalytics, requireAnalyticsAccess, passRateOf, avgScoreOf, deltaLabel } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";

// Benchmarking module — real period-over-period comparison (this 30 days vs
// the previous 30) across the organisation, assessors and departments.
// Cross-hospital benchmarking needs multiple tenants' data and is marked out.

export const dynamic = "force-dynamic";

export default async function BenchmarkingPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const d60 = new Date(now - 60 * 86400000).toISOString();
  const cur = ctx.assess.filter(a => a.assessed_at >= d30);
  const prev = ctx.assess.filter(a => a.assessed_at >= d60 && a.assessed_at < d30);

  // Per-assessor period comparison
  const key = (m: Map<string, { c: { score: number }[]; p: { score: number }[] }>, id: string) => {
    const v = m.get(id) ?? { c: [], p: [] };
    m.set(id, v);
    return v;
  };
  const byAssessor = new Map<string, { c: { score: number }[]; p: { score: number }[] }>();
  for (const a of cur) if (a.assessor_id) key(byAssessor, a.assessor_id).c.push({ score: a.score });
  for (const a of prev) if (a.assessor_id) key(byAssessor, a.assessor_id).p.push({ score: a.score });
  const assessorRows = [...byAssessor.entries()]
    .map(([id, v]) => ({
      name: ctx.staffName.get(id) ?? "—",
      n: v.c.length, nPrev: v.p.length,
      pass: passRateOf(v.c), passPrev: passRateOf(v.p),
      avg: avgScoreOf(v.c),
    }))
    .filter(r => r.n + r.nPrev > 0)
    .sort((a, b) => b.n - a.n).slice(0, 10);

  // Per-department period comparison
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));
  const byDept = new Map<string, { c: { score: number }[]; p: { score: number }[] }>();
  for (const a of cur) key(byDept, deptOf.get(a.nurse_id) ?? "General").c.push({ score: a.score });
  for (const a of prev) key(byDept, deptOf.get(a.nurse_id) ?? "General").p.push({ score: a.score });
  const deptRows = [...byDept.entries()]
    .map(([dep, v]) => ({ dep, n: v.c.length, pass: passRateOf(v.c), passPrev: passRateOf(v.p) }))
    .sort((a, b) => b.n - a.n).slice(0, 8);

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="⚖️" title="Benchmarking" sub="Compare performance across periods, assessors and departments — this 30 days vs the previous 30." />
      <StatTiles tiles={[
        { label: "Assessments", value: String(cur.length), d: deltaLabel(cur.length, prev.length), sub: `prev: ${prev.length}` },
        { label: "Pass Rate", value: passRateOf(cur) != null ? `${passRateOf(cur)}%` : "—", d: deltaLabel(passRateOf(cur), passRateOf(prev)), sub: `prev: ${passRateOf(prev) != null ? `${passRateOf(prev)}%` : "—"}` },
        { label: "Average Score", value: avgScoreOf(cur) != null ? `${avgScoreOf(cur)}` : "—", d: deltaLabel(avgScoreOf(cur), avgScoreOf(prev)), sub: `prev: ${avgScoreOf(prev) ?? "—"}` },
        { label: "Active Assessors", value: String(new Set(cur.map(a => a.assessor_id).filter(Boolean)).size), sub: `prev: ${new Set(prev.map(a => a.assessor_id).filter(Boolean)).size}` },
      ]} />

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Assessor Comparison" sub="this month vs last month">
          {assessorRows.length ? (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                  <th className="pb-1.5">Assessor</th><th className="pb-1.5 text-center">n</th>
                  <th className="pb-1.5 text-center">Pass</th><th className="pb-1.5 text-center">Prev</th>
                  <th className="pb-1.5 text-center">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assessorRows.map(r => (
                  <tr key={r.name}>
                    <td className="py-1.5 text-gray-700">{r.name}</td>
                    <td className="py-1.5 text-center text-gray-600">{r.n}</td>
                    <td className="py-1.5 text-center"><PctChip v={r.pass} /></td>
                    <td className="py-1.5 text-center text-gray-400">{r.passPrev != null ? `${r.passPrev}%` : "—"}</td>
                    <td className="py-1.5 text-center text-[10px] font-bold">
                      {r.pass != null && r.passPrev != null
                        ? <span className={r.pass >= r.passPrev ? "text-green-600" : "text-red-500"}>{r.pass >= r.passPrev ? "▲" : "▼"} {Math.abs(r.pass - r.passPrev)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-xs text-gray-400">No assessments in either period.</p>}
        </Card>
        <Card title="Department Comparison" sub="this month vs last month">
          {deptRows.length ? (
            <div className="space-y-2">
              {deptRows.map(r => (
                <div key={r.dep} className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-600 flex-1">{r.dep} <span className="text-gray-300">({r.n})</span></span>
                  <PctChip v={r.pass} />
                  <span className="text-gray-300">←</span>
                  <span className="text-gray-400 text-[10px]">{r.passPrev != null ? `${r.passPrev}%` : "—"}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No assessments in either period.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: cross-hospital benchmarking needs data from multiple tenants — this instance has one hospital&apos;s records, so only period,
        assessor and department comparisons are shown. Assessor differences reflect different caseloads, not necessarily different standards.
      </p>
    </div>
  );
}
