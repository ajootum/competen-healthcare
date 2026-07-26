import { loadPaScorecard } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, Donut, Spark, RagDot, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-PA-002 KPI & Balanced Scorecard Centre — the KPI catalogue + balanced-scorecard engine (perspectives, targets,
// RAG, benchmarks, trends). Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtVal = (v: any, unit: string) => (v == null ? "—" : unit === "$" ? `$${Number(v).toLocaleString()}` : unit === "%" ? `${v}%` : `${v}`);

export default async function ScorecardPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaScorecard(admin, hid, isSuper) as any;

  const head = <Head code="UMW-PA-002 · Performance Analytics" title="KPI & Balanced Scorecard Centre" sub="Define, govern and monitor every strategic and operational KPI across six balanced-scorecard perspectives — with targets, RAG thresholds, benchmarks and trends." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="002" /><Provision module="the Scorecard Centre" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="002" /><div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-sm text-blue-800">Seed with <code className="font-mono">node scripts/seed-performance-analytics.mjs</code>.</div></div>;

  const t = d.totals;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}
      <Tabs active="002" />

      {/* Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi label="Total KPIs" value={t.total} sub={`${t.live} live`} />
        <Kpi label="On Target" value={t.onTarget} sub={`${Math.round((t.onTarget / t.total) * 100)}%`} status="green" />
        <Kpi label="At Risk" value={t.atRisk} sub={`${Math.round((t.atRisk / t.total) * 100)}%`} status="amber" />
        <Kpi label="Off Target" value={t.offTarget} sub={`${Math.round((t.offTarget / t.total) * 100)}%`} status="red" />
        <Kpi label="Data Quality" value={`${t.dataQuality}%`} sub="good" status="green" />
        <Kpi label="Overall Score" value={`${t.overall}`} sub="/100" status={t.overall >= 85 ? "green" : "amber"} />
        <Kpi label="Scorecard Progress" value={`${Math.round((t.onTarget / t.total) * 100)}%`} sub="KPIs green" status={t.onTarget / t.total >= 0.7 ? "green" : "amber"} />
      </div>

      {/* Scorecard overview + map + top KPIs */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Balanced Scorecard Overview">
          <div className="space-y-1.5">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide"><span className="flex-1">Perspective</span><span className="w-12 text-right">Score</span><span className="w-14 text-right">KPIs</span><span className="w-8 text-center">RAG</span></div>
            {d.scorecard.map((s: any) => (
              <div key={s.id} className="flex items-center gap-1 text-[12px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-700 flex-1 truncate">{s.name}</span><span className="font-semibold text-gray-900 tabular-nums w-12 text-right">{s.score}%</span><span className="text-gray-400 tabular-nums w-14 text-right">{s.green}/{s.kpiCount}</span><span className="w-8 text-center"><RagDot status={s.status} /></span></div>
            ))}
            <div className="flex items-center border-t border-gray-100 pt-1.5 mt-1 text-[12px]"><span className="text-gray-500 flex-1 font-medium">Overall Balanced Score</span><span className="font-bold text-gray-900 tabular-nums">{t.overall}/100</span></div>
          </div>
        </Card>

        <Card title="Scorecard Map">
          <div className="rounded-lg bg-indigo-600 text-white text-center py-2.5 px-2 mb-2"><p className="text-[11px] opacity-80">Strategic Goal</p><p className="text-[13px] font-semibold">High Quality, Safe &amp; Efficient Care</p><p className="text-lg font-bold mt-0.5">{t.overall}%</p></div>
          <div className="grid grid-cols-3 gap-1.5">
            {d.scorecard.map((s: any) => (
              <div key={s.id} className="rounded-lg border border-gray-200 p-1.5 text-center" style={{ borderTopColor: s.color, borderTopWidth: 3 }}>
                <p className="text-[9px] text-gray-500 leading-tight truncate">{s.name}</p>
                <p className="text-sm font-bold text-gray-900">{s.score}%</p>
                <p className="text-[9px] text-gray-400">{s.kpiCount} KPIs</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Top 5 KPI Performance">
          <div className="space-y-1.5">
            {d.topKpis.map((k: any) => (
              <div key={k.name} className="flex items-center gap-1.5 text-[12px]"><span className="text-gray-800 flex-1 truncate">{k.name}</span><span className="text-gray-500 text-[10px] w-20 truncate">{k.perspective}</span><span className="font-semibold text-gray-900 tabular-nums w-14 text-right">{fmtVal(k.value, k.unit)}</span><RagDot status={k.status} /></div>
            ))}
          </div>
        </Card>
      </div>

      {/* KPI catalogue + health/quality donuts */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="KPI Catalogue" className="xl:col-span-3" right={<span className="text-[11px] text-gray-400">{d.catalogue.length} KPIs</span>}>
          <div className="overflow-x-auto">
            <div className="min-w-[720px] space-y-1">
              <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-2"><span className="w-14">Code</span><span className="flex-1">KPI</span><span className="w-28">Perspective</span><span className="w-20 text-right">Value</span><span className="w-16 text-right">Target</span><span className="w-14 text-center">RAG</span><span className="w-16 text-center">Trend</span></div>
              {d.catalogue.map((k: any) => (
                <div key={k.code} className="flex items-center px-2 py-1.5 rounded-lg border border-gray-100 text-[12px]">
                  <span className="w-14 text-gray-400 font-mono text-[10px]">{k.code}</span>
                  <span className="flex-1 text-gray-800 truncate">{k.name}{k.isLive && <span className="ml-1 text-[8px] text-emerald-600 font-bold uppercase">live</span>}</span>
                  <span className="w-28 flex items-center gap-1 text-gray-500 text-[11px]"><span className="w-1.5 h-1.5 rounded-full" style={{ background: k.perspectiveColor }} />{k.perspective}</span>
                  <span className="w-20 text-right font-semibold text-gray-900 tabular-nums">{fmtVal(k.value, k.unit)}</span>
                  <span className="w-16 text-right text-gray-400 tabular-nums">{fmtVal(k.target, k.unit)}</span>
                  <span className="w-14 flex justify-center"><RagDot status={k.status} /></span>
                  <span className="w-16"><Spark series={k.trend} tone={k.status === "green" ? "#10b981" : k.status === "amber" ? "#f59e0b" : "#f43f5e"} /></span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="KPI Health">
            <div className="flex items-center gap-3">
              <Donut segs={[{ n: t.onTarget, color: "#10b981" }, { n: t.atRisk, color: "#f59e0b" }, { n: t.offTarget, color: "#ef4444" }]} total={t.total} centre={t.total} sub="KPIs" size={96} />
              <div className="flex-1 space-y-1 text-[11px]">
                {[["On Target", t.onTarget, "#10b981"], ["At Risk", t.atRisk, "#f59e0b"], ["Off Target", t.offTarget, "#ef4444"]].map(([l, n, c]: any) => <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900">{n}</span></div>)}
              </div>
            </div>
          </Card>
          <Card title="Perspectives">
            <div className="space-y-1.5 text-[12px]">{d.perspectives.map((p: any) => <div key={p.id} className="flex items-center gap-1.5"><span className="text-base">{p.icon}</span><span className="text-gray-700 flex-1 truncate">{p.name}</span><span className="text-gray-400 text-[10px]">×{p.weight}</span></div>)}</div>
          </Card>
        </div>
      </div>

      <Foot>UMW-PA-002 — the KPI catalogue &amp; balanced-scorecard engine over pa_kpis + pa_perspectives + pa_benchmarks + pa_kpi_values. RAG status derives from each KPI&apos;s value vs target/amber/red thresholds honouring direction; scorecard scores are weighted target-achievement per perspective. Live KPIs pull from real snapshots. No-code KPI/formula authoring is PA-009.</Foot>
    </div>
  );
}
