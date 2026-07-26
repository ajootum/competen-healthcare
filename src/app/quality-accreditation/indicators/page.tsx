import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Gauge, Ring, Table, Foot } from "../_ui";
import { loadIndicators } from "@/lib/qaw/indicators";

export const dynamic = "force-dynamic";

// QAW-006 Quality Indicators & Measurement Centre — enterprise KPI engine over real measurements.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Indicator Library", "Dashboards", "Scorecards", "Data Collection", "Analysis", "Benchmarking", "Reports"];
const ST_TONE: Record<string, string> = { met: "emerald", near: "amber", below: "rose", nodata: "slate" };
const ST_LABEL: Record<string, string> = { met: "Met", near: "Near", below: "Below", nodata: "No data" };

export default async function IndicatorsPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadIndicators(admin, hid, isSuper);
  const head = <Head code="QAW-006 · Quality & Accreditation" title="Quality Indicators & Measurement Centre" sub="Measure, monitor and improve quality performance across the organization." action={{ label: "+ New indicator", href: "/admin/quality" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">Quality indicators are not provisioned yet.</p></Card></div>;
  if (d.empty) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">No active indicators for this scope yet. Define indicators against quality objects to populate the measurement engine.</p></Card></div>;
  const k = d.kpis;
  const pctOf = (n: number) => (k.total ? Math.round((n / k.total) * 100) : 0);

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📏" tone="teal" label="Total indicators" value={k.total} sub="active" />
        <Stat icon="✅" tone="emerald" label="Met target" value={k.met} sub={`${pctOf(k.met)}%`} />
        <Stat icon="🟡" tone="amber" label="Near target" value={k.near} sub={`${pctOf(k.near)}%`} />
        <Stat icon="🔴" tone="rose" label="Below target" value={k.below} sub={`${pctOf(k.below)}%`} />
        <Stat icon="⚪" tone="slate" label="No data" value={k.nodata} sub={`${pctOf(k.nodata)}%`} />
        <Stat icon="🎯" tone="blue" label="Overall performance" value={k.overall != null ? `${k.overall}%` : "—"} sub="mean achievement" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Performance by domain">
          <Bars items={d.byDomain.slice(0, 8).map((x: any) => ({ label: x.label, pct: x.pct, value: `${x.pct}%` }))} />
        </Card>

        <Card title="Indicator performance trend" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="teal" suffix="%" /><p className="text-[10px] text-gray-400 text-center mt-1">% of measurements meeting target, by month (live).</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough measurement history yet.</p>}
        </Card>

        <Card title="Indicators by status">
          <div className="flex items-center gap-2">
            <Donut segments={d.statusDonut} total={k.total} label="Total" size={130} />
            <Legend items={d.statusDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: pctOf(s.value) }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top indicators below target" className="xl:col-span-2">
          <Table cols={["Indicator", "Domain", "Current", "Target", "Achievement", "Status"]} rows={d.topBelow.map((c: any) => [
            <span key="n" className="font-medium text-gray-800">{c.name}</span>,
            <span key="d" className="text-gray-500">{c.domain}</span>,
            <span key="v" className="tabular-nums text-gray-700">{c.value}</span>,
            <span key="t" className="tabular-nums text-gray-400">{c.target}</span>,
            <span key="a" className="tabular-nums text-gray-600">{c.achievement != null ? `${c.achievement}%` : "—"}</span>,
            <Pill key="s" text={ST_LABEL[c.status]} tone={ST_TONE[c.status]} />,
          ])} empty="All indicators at or above target. ✅" />
        </Card>

        <Card title="Overall achievement">
          <div className="flex flex-col items-center">
            <Gauge pct={k.overall ?? 0} label="mean achievement" tone={k.overall == null ? "gray" : undefined} />
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-3">
              <Ring pct={k.completeness} size={54} tone="blue" />
              <div className="text-[12px]"><p className="font-medium text-gray-800">Data completeness</p><p className="text-gray-400 text-[11px]">{k.total - k.nodata} of {k.total} indicators have a recorded value</p></div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Key indicators" className="xl:col-span-2" right="sample">
          <Table cols={["Indicator", "Domain", "Current", "Target", "Status"]} rows={d.sample.map((c: any) => [
            <span key="n" className="font-medium text-gray-800">{c.name}</span>,
            <span key="d" className="text-gray-500">{c.domain}</span>,
            <span key="v" className="tabular-nums text-gray-700">{c.value}</span>,
            <span key="t" className="tabular-nums text-gray-400">{c.target}</span>,
            <Pill key="s" text={ST_LABEL[c.status]} tone={ST_TONE[c.status]} />,
          ])} empty="No indicators." />
        </Card>

        <Card title="Benchmarking">
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <span className="text-2xl mb-1">📈</span>
            <p className="text-[12px] text-gray-500">External benchmarking is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Internal performance vs target is fully live above; peer/national comparators require a benchmark dataset (e.g. the balanced-scorecard <code>pa_benchmarks</code> layer).</p>
          </div>
        </Card>
      </div>

      <Foot>QAW-006 — live over <code>quality_indicators</code> + <code>indicator_measurements</code> (real value time-series). RAG status is computed from each indicator&apos;s latest measurement against its target and escalation thresholds, honouring direction (higher/lower is better). Scorecards and external benchmarking are the next build phase.</Foot>
    </div>
  );
}
