import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, passRateOf, avgScoreOf, deltaLabel, riskBuckets } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";

// Learner Performance module — group learner analytics. The 360° per-learner
// profile (history, evidence timeline, feedback) lives in the Learners
// workspace side panel; this module is the analytics layer above it.

export const dynamic = "force-dynamic";

export default async function LearnerPerformancePage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const d60 = new Date(now - 60 * 86400000).toISOString();
  const cur = ctx.assess.filter(a => a.assessed_at >= d30);
  const prev = ctx.assess.filter(a => a.assessed_at >= d60 && a.assessed_at < d30);
  const assessedNurses = new Set(cur.map(a => a.nurse_id));
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);

  // Per-learner profile from latest decisions + 30d assessments.
  const byNurse = new Map<string, { pass: number; total: number }>();
  for (const d of ctx.latest) {
    const a = byNurse.get(d.nurse_id) ?? { pass: 0, total: 0 };
    a.total++;
    if (d.passing && !d.expired) a.pass++;
    byNurse.set(d.nurse_id, a);
  }
  const profiles = ctx.nurses.map(n => {
    const dec = byNurse.get(n.id);
    const mine = cur.filter(a => a.nurse_id === n.id);
    return {
      ...n,
      decided: dec?.total ?? 0,
      pct: dec?.total ? Math.round(dec.pass / dec.total * 100) : null,
      a30: mine.length,
      avg30: avgScoreOf(mine),
      risk: risk.byNurse.get(n.id) ?? null,
    };
  });
  const top = profiles.filter(p => p.pct != null && p.decided >= 3).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 5);
  const atRisk = profiles.filter(p => p.risk).sort((a, b) => (a.risk === "high" ? 0 : 1) - (b.risk === "high" ? 0 : 1)).slice(0, 6);

  // Department trend table
  const deptAgg = new Map<string, { pass: number; total: number; a30: number; n: number }>();
  for (const p of profiles) {
    const a = deptAgg.get(p.dept) ?? { pass: 0, total: 0, a30: 0, n: 0 };
    a.n++;
    a.a30 += p.a30;
    if (p.pct != null) { a.pass += p.pct; a.total++; }
    deptAgg.set(p.dept, a);
  }

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="👩‍⚕️" title="Learner Performance" sub="Individual and group performance insights — latest decisions plus 30-day assessment activity." />
      <StatTiles tiles={[
        { label: "Active Learners", value: String(ctx.nurses.length), sub: "in your hospital" },
        { label: "Assessed (30d)", value: String(assessedNurses.size), sub: `${cur.length} assessments` },
        { label: "Pass Rate (30d)", value: passRateOf(cur) != null ? `${passRateOf(cur)}%` : "—", d: deltaLabel(passRateOf(cur), passRateOf(prev)) },
        { label: "At-Risk Learners", value: String(risk.high + risk.medium), sub: `${risk.high} high risk`, alert: risk.high > 0 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Top Performers" sub="≥3 decided competencies">
          {top.length ? top.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-800 font-medium flex-1 truncate">{p.name}</span>
              <span className="text-gray-400">{p.dept}</span>
              <PctChip v={p.pct} />
            </div>
          )) : <p className="text-xs text-gray-400">Not enough decision data yet.</p>}
        </Card>
        <Card title="At-Risk Learners" sub="from decision records">
          {atRisk.length ? atRisk.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-800 font-medium flex-1 truncate">{p.name}</span>
              <span className="text-gray-400">{p.dept}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${p.risk === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{p.risk}</span>
            </div>
          )) : <p className="text-xs text-gray-400">No learners carry risk flags. ✅</p>}
          <Link href="/assessor/remediation" className="mt-2 inline-block text-[11px] font-semibold text-indigo-600 hover:underline">Open Risk &amp; Remediation →</Link>
        </Card>
      </div>

      <Card title="Performance by Department">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
              <th className="pb-1.5">Department</th><th className="pb-1.5 text-center">Learners</th>
              <th className="pb-1.5 text-center">Avg pass</th><th className="pb-1.5 text-center">Assessments 30d</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {[...deptAgg.entries()].sort((a, b) => b[1].n - a[1].n).map(([dep, v]) => (
              <tr key={dep}>
                <td className="py-1.5 text-gray-700">{dep}</td>
                <td className="py-1.5 text-center text-gray-600">{v.n}</td>
                <td className="py-1.5 text-center"><PctChip v={v.total ? Math.round(v.pass / v.total) : null} /></td>
                <td className="py-1.5 text-center text-gray-600">{v.a30}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        For the full 360° learner profile — assessment history, evidence timeline, feedback and drill-down — open a learner in the{" "}
        <Link href="/assessor/nurses" className="text-indigo-500 hover:underline">Learners workspace</Link>.
      </p>
    </div>
  );
}
