import { loadPaDashboard } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, Ring, Radar, Donut, HBar, Pill, RagDot, TrendArrow, Provision, Foot } from "./_ui";

export const dynamic = "force-dynamic";

// UMW-PA-001 Unit Performance Dashboard — the executive performance cockpit consolidating operational, workforce,
// quality, patient, financial and learning KPIs into one balanced-scorecard view. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
const fmtVal = (v: any, unit: string) => (v == null ? "—" : unit === "$" ? `$${Number(v).toLocaleString()}` : unit === "%" ? `${v}%` : `${v}${unit && !["rate", "score", "index", "count"].includes(unit) ? ` ${unit}` : ""}`);
const PROJ_TONE: Record<string, string> = { on_track: "#10b981", at_risk: "#f59e0b", overdue: "#ef4444", on_hold: "#94a3b8", completed: "#14b8a6" };

export default async function PerformanceDashboardPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaDashboard(admin, hid, isSuper) as any;

  const head = <Head code="UMW-PA-001 · Performance Analytics" title="Unit Performance Dashboard" sub="Executive performance cockpit — overall unit health, balanced scorecard, KPIs vs targets, benchmarking and improvement, with operational KPIs live from real snapshots." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="001" /><Provision module="the Performance Dashboard" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="001" /><div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">Performance stores are provisioned but empty — run <code className="font-mono">node scripts/seed-performance-analytics.mjs</code>.</div></div>;

  const r = d.ribbon;
  const maxTrend = Math.max(1, ...d.overallTrend);
  const minTrend = Math.min(...d.overallTrend, 0);
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}
      <Tabs active="001" />

      {/* Executive KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2">
          <Ring pct={r.overall} size={62} />
          <div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Overall Performance</p><p className="text-[11px] text-[var(--cmp-text-success)] font-medium mt-0.5">{r.overall >= 85 ? "Excellent" : r.overall >= 70 ? "Good" : "Needs focus"}</p></div>
        </div>
        <Kpi label="KPI Achievement" value={`${r.kpiAchievement}%`} sub="on target" status={r.kpiAchievement >= 80 ? "green" : "amber"} />
        <Kpi label="Strategic Goal Achv." value={`${r.strategicGoal}%`} sub="mean vs target" status={r.strategicGoal >= 90 ? "green" : "amber"} />
        <Kpi label="Improvement Projects" value={r.activeProjects} sub="active" />
        <Kpi label="Risks Needing Attention" value={r.risks} sub="off-target + risk" status={r.risks > 3 ? "red" : r.risks ? "amber" : "green"} />
        <Kpi label="Staff Engagement" value={r.staffEngagement != null ? `${r.staffEngagement}%` : "—"} sub="workforce" status={r.staffEngagement != null && r.staffEngagement >= 80 ? "green" : "amber"} />
        <Kpi label="Patient Satisfaction" value={r.patientSatisfaction != null ? `${r.patientSatisfaction}%` : "—"} sub="experience" status={r.patientSatisfaction != null && r.patientSatisfaction >= 85 ? "green" : "amber"} />
        <Kpi label="Quality Rating" value={r.qualityScore != null ? `${r.qualityScore}%` : "—"} sub="clinical quality" status={r.qualityScore != null && r.qualityScore >= 85 ? "green" : "amber"} />
      </div>

      {/* Balanced scorecard + performance trend + executive alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Balanced Scorecard" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">6 perspectives</span>}>
          <div className="flex flex-col md:flex-row items-center gap-3">
            <Radar points={d.scorecard.map((s: any) => ({ label: s.name, value: s.score }))} />
            <div className="flex-1 w-full space-y-1.5">
              {d.scorecard.map((s: any) => (
                <div key={s.id} className="flex items-center gap-2 text-[12px]">
                  <RagDot status={s.status} /><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-gray-700 flex-1 truncate">{s.name}</span>
                  <span className="text-gray-400 text-[10px]">{s.green}/{s.kpiCount}</span>
                  <span className="font-semibold text-gray-900 tabular-nums w-10 text-right">{s.score}%</span>
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-gray-100 pt-1.5 mt-1.5 text-[12px]"><span className="text-gray-500 flex-1 font-medium">Overall</span><span className="font-bold text-gray-900 tabular-nums">{r.overall}/100</span></div>
            </div>
          </div>
        </Card>

        <Card title="Performance Trend" right={<span className="text-[11px] text-gray-400">13 mo · composite</span>}>
          {d.overallTrend.length >= 2 ? (
            <>
              <svg viewBox="0 0 260 90" className="w-full h-28">
                <polyline points={d.overallTrend.map((v: number, i: number) => `${(i / (d.overallTrend.length - 1)) * 260},${88 - ((v - minTrend) / (maxTrend - minTrend || 1)) * 80}`).join(" ")} fill="none" stroke="#4f46e5" strokeWidth="2" />
                {d.overallTrend.map((v: number, i: number) => <circle key={i} cx={(i / (d.overallTrend.length - 1)) * 260} cy={88 - ((v - minTrend) / (maxTrend - minTrend || 1)) * 80} r="2" fill="#4f46e5" />)}
              </svg>
              <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>13 mo ago</span><span className="font-semibold text-indigo-600">now {d.overallTrend[d.overallTrend.length - 1]}%</span></div>
            </>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No trend data.</p>}
        </Card>

        <Card title="Executive Alerts" right={<span className="text-[11px] text-gray-400">{d.alerts.length}</span>}>
          {d.alerts.length ? <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className={`mt-0.5 text-xs ${a.sev === "high" ? "text-rose-500" : "text-amber-500"}`}>{a.sev === "high" ? "⛔" : "⚠️"}</span><div className="min-w-0"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.title}</p><p className="text-[10px] text-gray-400 truncate">{a.detail}</p></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No alerts. ✅</p>}
        </Card>
      </div>

      {/* Headline KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {d.kpis6.map((k: any) => (
          <Kpi key={k.name} label={k.name} value={fmtVal(k.value, k.unit)} sub={`target ${fmtVal(k.target, k.unit)}`} status={k.status} delta={k.deltaPct != null ? `${k.deltaPct}%` : undefined} deltaUp={k.deltaUp} series={k.trend} />
        ))}
      </div>

      {/* Improvement + benchmarking + AI insight */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Improvement Projects" right={<span className="text-[11px] text-gray-400">{d.projects.length}</span>}>
          <div className="flex items-center gap-3">
            <Donut segs={d.projectStatus.map((p: any) => ({ n: p.n, color: PROJ_TONE[p.status] }))} total={d.projects.length} centre={d.projects.length} sub="projects" size={96} />
            <div className="flex-1 space-y-1 text-[11px]">{d.projectStatus.map((p: any) => <div key={p.status} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: PROJ_TONE[p.status] }} /><span className="text-gray-600 flex-1 capitalize">{p.status.replace(/_/g, " ")}</span><span className="font-semibold text-gray-900">{p.n}</span></div>)}</div>
          </div>
          <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500">Benefits: <b className="text-gray-800">{money(d.totalBenefit)}</b> total · <b className="text-[var(--cmp-text-success)]">{money(d.realisedBenefit)}</b> realised</div>
        </Card>

        <Card title="Benchmarking" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">overall vs peers</span>}>
          <div className="space-y-2">{d.benchmarking.map((b: any) => (
            <div key={b.label} className={`flex items-center gap-2 text-[12px] ${b.you ? "font-semibold" : ""}`}>
              <span className={`w-32 truncate ${b.you ? "text-indigo-700" : "text-gray-600"}`}>{b.label}</span>
              <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.value}%`, background: b.tone }} /></div>
              <span className="text-gray-900 tabular-nums w-10 text-right">{b.value}</span>
            </div>
          ))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Composite unit score = mean KPI achievement vs target for each comparator group.</p>
        </Card>

        <Card title="AI Performance Insight">
          {d.insight ? (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
              <div className="flex items-center gap-1.5 mb-1"><span>🤖</span><Pill text={`${d.insight.confidence}% confidence`} tone="violet" /></div>
              <p className="text-[13px] font-medium text-gray-900">{d.insight.title}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">{d.insight.detail}</p>
              {d.insight.benefit && <p className="text-[11px] text-emerald-700 font-medium mt-1">Est. benefit {money(Number(d.insight.benefit))}</p>}
            </div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No AI insights available.</p>}
        </Card>
      </div>

      {/* Top KPI performance + recent improvements */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top 5 KPI Performance">
          <div className="space-y-1.5">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">KPI</span><span className="w-24">Perspective</span><span className="w-16 text-right">Value</span><span className="w-14 text-right">Target</span><span className="w-8 text-center">RAG</span><span className="w-8 text-center">Tr</span></div>
            {d.topKpis.map((k: any) => (
              <div key={k.name} className="flex items-center gap-1 border border-gray-100 rounded-lg px-2 py-1.5 text-[12px]"><span className="text-gray-800 flex-1 truncate">{k.name}</span><span className="text-gray-500 w-24 truncate text-[11px]">{k.perspective}</span><span className="text-gray-900 font-semibold tabular-nums w-16 text-right">{fmtVal(k.value, k.unit)}</span><span className="text-gray-400 tabular-nums w-14 text-right">{fmtVal(k.target, k.unit)}</span><span className="w-8 text-center"><RagDot status={k.status} /></span><span className="w-8 text-center"><TrendArrow up={k.deltaUp} /></span></div>
            ))}
          </div>
        </Card>

        <Card title="Recent Improvements">
          <div className="space-y-2">{d.projects.slice(0, 6).map((p: any) => (
            <div key={p.id} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: PROJ_TONE[p.status] }} /><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{p.name}</p><div className="mt-1"><HBar label="" value={Number(p.progress_pct)} max={100} tone={PROJ_TONE[p.status]} right={`${Math.round(Number(p.progress_pct))}%`} /></div></div><Pill text={p.status} tone={p.status === "completed" ? "teal" : p.status === "on_track" ? "emerald" : p.status === "overdue" ? "rose" : "amber"} /></div>
          ))}</div>
        </Card>
      </div>

      <Foot>UMW-PA-001 — executive cockpit over the performance stores (pa_perspectives / pa_kpis / pa_kpi_values / pa_benchmarks / pa_improvement_projects / pa_predictions). {d.liveCount} operational KPIs resolve <strong>live</strong> from the latest op_ops_snapshots{d.snapshotPeriod ? ` (${d.snapshotPeriod})` : ""}; the rest carry seeded values. No-code KPI/scorecard/widget authoring is the next build phase (PA-009).</Foot>
    </div>
  );
}
