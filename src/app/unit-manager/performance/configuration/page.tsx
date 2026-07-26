import { loadPaConfig } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, HBar, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-PA-009 Performance Configuration & KPI Administration Centre — the config/admin overview of the KPI catalogue,
// perspectives, benchmarks, data quality and publishing. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const MODULES = [
  ["📇", "KPI Catalogue Admin", "Create, edit and manage KPI definitions, sources and ownership."],
  ["Σ", "Formula Designer", "Design KPI formulas, calculations and aggregation rules."],
  ["🎯", "Scorecard Admin", "Configure balanced scorecards and perspectives."],
  ["📊", "Benchmark Admin", "Configure benchmark groups and comparison settings."],
  ["🖥️", "Dashboard Config", "Build and configure dashboards and widget layouts."],
  ["🤖", "AI Configuration", "Configure AI models, predictions, rules and thresholds."],
  ["🧾", "Report Administration", "Create report templates, schedules and distribution."],
  ["🛡️", "Governance Admin", "Manage workflows, approvals, owners and policies."],
  ["🗄️", "Data Quality & Validation", "Configure validation rules and data-quality monitoring."],
  ["🚀", "Publishing Centre", "Review, approve and publish configuration changes."],
];

export default async function ConfigurationPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaConfig(admin, hid, isSuper) as any;
  const head = <Head code="UMW-PA-009 · Performance Analytics" title="Performance Configuration & KPI Administration Centre" sub="Design, configure, govern and publish all performance analytics — KPIs, formulas, scorecards, benchmarks, dashboards and AI policies — no-code." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="009" /><Provision module="Performance Configuration" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="009" /><div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-sm text-blue-800">Seed the performance stores first.</div></div>;

  const t = d.totals;
  const health = Math.round((d.dataQuality.reduce((a: number, q: any) => a + q.pct, 0) / d.dataQuality.length));
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="009" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Total KPIs" value={t.kpis} sub={`${t.active} active`} />
        <Kpi label="Live KPIs" value={t.live} sub="from snapshots" status="green" />
        <Kpi label="Perspectives" value={t.perspectives} sub="scorecard" />
        <Kpi label="Benchmarks" value={t.benchmarks} sub="comparators" />
        <Kpi label="Reports" value={t.reports} sub={`${t.published} published`} />
        <Kpi label="With Owner" value={`${Math.round((t.withOwner / t.kpis) * 100)}%`} sub="KPIs" status={t.withOwner / t.kpis >= 0.9 ? "green" : "amber"} />
        <Kpi label="With Target" value={`${Math.round((t.withTarget / t.kpis) * 100)}%`} sub="KPIs" status="green" />
        <div className="bg-white border border-gray-200 rounded-xl p-3.5"><p className="text-[11px] text-gray-500 uppercase tracking-wide">Config Health</p><p className={`text-2xl font-bold tabular-nums mt-1 ${health >= 85 ? "text-emerald-600" : "text-amber-600"}`}>{health}%</p><p className="text-[11px] text-gray-400">good</p></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="KPIs by Perspective">
          <div className="space-y-2">{d.byPersp.map((p: any) => <HBar key={p.name} label={p.name} value={p.n} max={Math.max(...d.byPersp.map((x: any) => x.n))} tone={p.color} right={`${p.n}`} />)}</div>
        </Card>
        <Card title="KPIs by Data Source">
          <div className="space-y-2">{d.bySource.map((s: any) => <HBar key={s.source} label={s.source} value={s.n} max={Math.max(...d.bySource.map((x: any) => x.n))} right={`${s.n}`} />)}</div>
        </Card>
        <Card title="Data Quality & Validation">
          <div className="space-y-3">{d.dataQuality.map((q: any) => (
            <div key={q.label}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-600">{q.label}</span><span className="font-semibold text-gray-900">{q.pct}%</span></div><div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${q.pct >= 90 ? "bg-emerald-500" : q.pct >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${q.pct}%` }} /></div></div>
          ))}</div>
        </Card>
      </div>

      <Card title="Configuration Modules" right={<span className="text-[11px] text-gray-400">no-code administration</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {MODULES.map(([icon, name, desc]) => (
            <div key={name} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1"><span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-sm">{icon}</span><p className="text-[12px] font-semibold text-gray-900 leading-tight">{name}</p></div>
              <p className="text-[11px] text-gray-500">{desc}</p>
              <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wider mt-1.5">Config UI · soon</p>
            </div>
          ))}
        </div>
      </Card>

      <Foot>UMW-PA-009 — the configuration &amp; administration overview over the live performance catalogue (pa_kpis / pa_perspectives / pa_benchmarks / pa_reports). Counts, coverage and data-quality indicators are real; the no-code KPI/formula/scorecard/AI authoring &amp; publishing workflow (Draft→Review→Publish→Archive with versioning) is the next build phase — this surfaces what is configured today.</Foot>
    </div>
  );
}
