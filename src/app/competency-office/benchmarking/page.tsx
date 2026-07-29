import { cmoGuard, Head, Card, Kpi, Pill, Donut, Bars, Progress, Foot } from "../_cmo-ui";
import { loadBenchmarking } from "@/lib/competency/benchmarking";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-026 Competency Operational Analytics — Benchmarking & Comparison. Internal peer comparison of competency
// readiness across the workforce's clinical/professional domains: a ranked league table, quartile bands,
// percentiles and the widest gaps — computed live from the competency analytics engine's domain scorecards.
// No fabricated peers: external / network / regional benchmarking needs comparator data that isn't present.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function BenchmarkingPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadBenchmarking(admin, hid, isSuper);
  const head = <Head code="COMP-026 · Competency Office" title="Benchmarking & Comparison" sub="Peer comparison of competency readiness across the workforce's clinical domains — a ranked league table, quartile bands, percentiles and the widest gaps, computed live from the competency analytics engine." />;

  if (!d.provisioned)
    return <div className="max-w-[1400px] space-y-4">{head}<Card><p className="text-sm text-gray-400">The competency analytics engine (frameworks + competency decisions + logbook) is not available — benchmarking cannot be computed.</p></Card></div>;

  if (d.empty)
    return (
      <div className="max-w-[1400px] space-y-4">{head}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[12px] text-blue-800">No competency domains carry recorded readiness yet — as frameworks are populated and competencies are achieved, this engine ranks each clinical area against its internal peers. {d.frameworksTotal ? `(${d.frameworksTotal} competencies defined; none yet attributed to a scored domain.)` : ""}</div>
        <Foot>COMP-026 — internal domain-vs-domain benchmarking over the competency analytics engine&rsquo;s readiness (mean competency achievement per clinical domain). External / network / regional benchmarking and industry percentiles need peer-hospital comparator data that isn&rsquo;t present — next-phase.</Foot>
      </div>
    );

  const k = d.kpis;
  const s = d.stats;
  const tolTone = (v: number) => (v >= 0 ? "text-emerald-600" : "text-rose-600");

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      {(d.singleUnit || d.noVariance) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-800">
          {d.singleUnit
            ? "Only one clinical domain currently carries readiness — meaningful benchmarking needs at least two comparable peers. The single area is shown below for reference."
            : "Every clinical domain currently shares the same readiness — there is no spread to rank yet. Bands and percentiles will separate as achievement diverges."}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Areas compared" value={k.unitsCompared} sub="clinical domains" />
        <Kpi label="Median readiness" value={`${k.median}%`} sub="peer midpoint" />
        <Kpi label="Top-quartile ≥" value={`${k.topQuartile}%`} sub="75th percentile" tone="text-emerald-600" />
        <Kpi label="Best area" value={`${k.bestPct}%`} sub={k.bestName} tone="text-teal-600" />
        <Kpi label="Widest gap" value={`${k.widestGap} pts`} sub="best vs worst spread" tone={k.widestGap >= 25 ? "text-rose-600" : "text-gray-900"} />
        <Kpi label="Below target" value={k.belowTarget} sub={`< ${s.target}% readiness`} tone={k.belowTarget ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* League table */}
        <Card title="Readiness league table" className="xl:col-span-2" right={<Link href="/competency-office/analytics" className="text-[11px] text-teal-600 hover:underline">Competency analytics →</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-2 font-medium">#</th><th className="pb-2 pr-3 font-medium">Clinical domain</th><th className="pb-2 pr-3 font-medium">Readiness</th><th className="pb-2 pr-3 font-medium text-right">Gap</th><th className="pb-2 pr-3 font-medium text-right">vs median</th><th className="pb-2 pr-3 font-medium text-right">Pctile</th><th className="pb-2 font-medium">Band</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.ranked.map((u: any) => (
                  <tr key={u.name} className="text-gray-700">
                    <td className="py-2 pr-2 tabular-nums text-gray-400">{u.rank}</td>
                    <td className="py-2 pr-3 font-medium text-gray-800">{u.name}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-9 text-right tabular-nums font-semibold text-gray-900">{u.readiness}%</span>
                        <div className="w-20"><Progress pct={u.readiness} /></div>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{u.gapPts}%</td>
                    <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${tolTone(u.vsMedian)}`}>{u.vsMedian >= 0 ? "+" : ""}{u.vsMedian}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{u.percentile}</td>
                    <td className="py-2"><Pill text={u.band} tone={u.tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Readiness = mean competency achievement per clinical domain (the engine&rsquo;s Readiness Index measure). Median {s.median}% · top-quartile ≥ {s.p75}% · lower-quartile ≤ {s.p25}% · target {s.target}%. &ldquo;Gap&rdquo; is each area&rsquo;s shortfall to full readiness; &ldquo;vs median&rdquo; and &ldquo;Pctile&rdquo; are its position within this internal peer set.</p>
        </Card>

        {/* Band distribution */}
        <Card title="Quartile distribution" right={<span className="text-[11px] text-gray-400">{s.n} areas</span>}>
          {d.bandDist.length ? (
            <div className="flex flex-col items-center gap-3">
              <Donut segs={d.bandDist} total={s.n} centre={s.n} sub="areas" size={140} />
              <div className="w-full space-y-1">
                {d.bandDist.map((b: any) => (
                  <div key={b.label} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} /><span className="text-gray-600 flex-1 truncate">{b.label}</span><span className="tabular-nums text-gray-800 font-semibold">{b.n}</span></div>
                ))}
              </div>
              <div className="w-full border-t border-gray-100 pt-2 mt-1 text-[11px] text-gray-500 space-y-0.5">
                <div className="flex justify-between"><span>Portfolio readiness</span><span className="tabular-nums font-semibold text-gray-800">{d.engineReadiness != null ? `${d.engineReadiness}%` : "—"}</span></div>
                <div className="flex justify-between"><span>Peer mean</span><span className="tabular-nums text-gray-700">{s.mean}%</span></div>
                <div className="flex justify-between"><span>Spread (best−worst)</span><span className="tabular-nums text-gray-700">{s.spread} pts</span></div>
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No bands to plot.</p>}
        </Card>
      </div>

      {/* Top / bottom performers */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top performers" right={<span className="text-[11px] text-emerald-600">best readiness</span>}>
          <div className="space-y-2">
            {d.top.map((u: any) => (
              <div key={u.name} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">{u.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><p className="text-[12.5px] font-medium text-gray-800 truncate">{u.name}</p><span className="tabular-nums text-[12px] font-semibold text-gray-900">{u.readiness}%</span></div>
                  <Progress pct={u.readiness} />
                </div>
                <Pill text={u.band} tone={u.tone} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Reference areas — their coverage and assessment mix are the internal exemplar for lagging domains.</p>
        </Card>

        <Card title="Areas needing attention" right={<Link href="/competency-office/gaps" className="text-[11px] text-teal-600 hover:underline">Gap management →</Link>}>
          <div className="space-y-2">
            {d.bottom.map((u: any) => (
              <div key={u.name} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-rose-50 text-rose-700 text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">{u.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><p className="text-[12.5px] font-medium text-gray-800 truncate">{u.name}</p><span className="tabular-nums text-[12px] font-semibold text-gray-900">{u.readiness}%</span></div>
                  <Progress pct={u.readiness} />
                  <p className="text-[10px] text-gray-400 mt-0.5">{u.gapToLeader} pts behind the leader{u.gaps ? ` · ${u.gaps} gap${u.gaps === 1 ? "" : "s"}` : ""}{u.atRisk ? ` · ${u.atRisk} at-risk` : ""}</p>
                </div>
                <Pill text={u.band} tone={u.tone} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Lowest-ranked areas by readiness — the priority list for targeted assessment and remediation.</p>
        </Card>
      </div>

      {/* Readiness bars */}
      <Card title="Readiness by clinical domain" right={<span className="text-[11px] text-gray-400">best → worst · coloured by quartile</span>}>
        {d.bars.length ? <Bars rows={d.bars} colors={d.barColors} /> : <p className="text-sm text-gray-400 py-8 text-center">No areas to chart.</p>}
      </Card>

      {/* Honest scope note */}
      <Card title="Benchmarking scope">
        <div className="text-[12px] text-gray-600 space-y-1.5">
          <p><span className="font-semibold text-gray-800">Internal only.</span> This compares the hospital&rsquo;s own clinical domains against each other over the real competency analytics readiness. It is a like-for-like internal league table — not a comparison against other hospitals.</p>
          <p><span className="font-semibold text-gray-800">External / network / regional benchmarking</span> and industry-percentile positioning are <span className="text-gray-800">not shown</span>: they need peer-hospital comparator data (a benchmarking cohort or a shared registry) that isn&rsquo;t present in this workspace. No external figures are fabricated.</p>
        </div>
      </Card>

      <Foot>COMP-026 — internal clinical-domain benchmarking over <code>loadCompetencyAnalytics</code> (frameworks + competency scores/decisions + logbook). Readiness per area is the engine&rsquo;s own achievement measure; the league table, quartile bands, percentiles, spread and below-target flags are all real. Per-organisational-unit / department readiness rollup (the engine only exposes an aggregate readiness snapshot today) and external / network / regional / industry-percentile benchmarking are the next-phase deepening — each needs comparator data not yet in the workspace.</Foot>
    </div>
  );
}
