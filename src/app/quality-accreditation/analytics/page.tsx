import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, Foot, T } from "../_ui";
import { loadAnalytics } from "@/lib/qaw/analytics";
import Link from "next/link";

export const dynamic = "force-dynamic";

// QAW-007 Quality Analytics & Reporting Centre — exec quality intelligence, 12-month trends, rule-based
// forecasting and automated reporting over the daily quality_score_snapshots + the report builder.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Dashboards", "Analytics", "Reports", "Data Explorer", "Predictive Insights", "Benchmarking", "Data Quality", "Scheduled Reports"];
const FREQ_TONE: Record<string, string> = { daily: "blue", weekly: "indigo", monthly: "violet" };
const IND_TONE: Record<string, string> = { met: "emerald", near: "amber", below: "rose", nodata: "slate" };
const IND_LABEL: Record<string, string> = { met: "Met", near: "Near", below: "Below", nodata: "No data" };
const statusTone = (s: string) => { const x = (s || "").toLowerCase(); if (/(succ|sent|ok|deliver|complet)/.test(x)) return "emerald"; if (/(fail|error|miss)/.test(x)) return "rose"; return "slate"; };
const fmtDate = (v: any) => (v ? String(v).slice(0, 10) : "—");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export default async function AnalyticsPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadAnalytics(admin, hid, isSuper);
  const head = <Head code="QAW-007 · Quality & Accreditation" title="Quality Analytics & Reporting Centre" sub="Enterprise quality intelligence, advanced analytics and automated reporting." action={{ label: "+ New report", href: "/admin/quality" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The quality snapshot history (<code>quality_score_snapshots</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📊" tone="teal" label="Overall quality score" value={k.qualityScore != null ? `${k.qualityScore}%` : "—"} sub="latest snapshot" />
        <Stat icon="🎯" tone="blue" label="Indicators tracked" value={k.indicatorsTracked ?? "—"} sub="active KPIs" />
        <Stat icon="📄" tone="indigo" label="Reports generated" value={k.reportsGenerated} sub="saved definitions" />
        <Stat icon="🔌" tone="violet" label="Data sources" value={k.dataSources} sub="wired stores" />
        <Stat icon="🚨" tone="rose" label="Alerts triggered" value={k.alerts ?? "—"} sub="critical + high-risk" />
        <Stat icon="⏱️" tone="emerald" label="Scheduled reports" value={k.scheduledActive} sub="active schedules" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Quality performance trend" className="xl:col-span-2" right="last 12 months">
          {d.hasHistory
            ? <><Trend points={d.qualityTrend.map(t => t.value)} labels={d.qualityTrend.map(t => t.label)} tone="teal" suffix="%" /><p className="text-[10px] text-gray-400 text-center mt-1">Overall quality score per month (latest daily snapshot in each month).</p></>
            : <p className="text-sm text-gray-400 py-10 text-center">Not enough snapshot history yet for a trend.</p>}
        </Card>

        <Card title="Performance by dimension" right="latest snapshot">
          {d.domain
            ? <div className="flex items-center gap-2"><Donut segments={d.domain.segments} total={d.domain.center} label="Health" size={130} /><Legend items={d.domain.items} /></div>
            : <p className="text-sm text-gray-400 py-8 text-center">No snapshot scores captured yet.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Composite quality / safety / compliance / health indices from the latest daily snapshot.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Key highlights" right="rule-based">
          {d.highlights.length
            ? <ul className="space-y-2.5">{d.highlights.map((h, i) => <li key={i} className="flex items-start gap-2 text-[12.5px] text-gray-700"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${T(h.tone).dot}`} />{h.text}</li>)}</ul>
            : <p className="text-sm text-gray-400 py-8 text-center">Building trend history — highlights appear once two months of snapshots exist.</p>}
        </Card>

        <Card title="Top underperforming indicators" className="xl:col-span-2" right={d.indicatorsLive ? "below / near target" : undefined}>
          {d.indicatorsLive
            ? <Table cols={["Indicator", "Domain", "Current", "Target", "Achievement", "Status"]} rows={d.topBelow.map((c: any) => [
              <span key="n" className="font-medium text-gray-800">{c.name}</span>,
              <span key="d" className="text-gray-500">{c.domain}</span>,
              <span key="v" className="tabular-nums text-gray-700">{c.value}</span>,
              <span key="t" className="tabular-nums text-gray-400">{c.target}</span>,
              <span key="a" className="tabular-nums text-gray-600">{c.achievement != null ? `${c.achievement}%` : "—"}</span>,
              <Pill key="s" text={IND_LABEL[c.status] ?? c.status} tone={IND_TONE[c.status] ?? "slate"} />,
            ])} empty="All tracked indicators are at or above target." />
            : <div className="flex flex-col items-center justify-center py-8 text-center"><span className="text-2xl mb-1">🎯</span><p className="text-[12px] text-gray-500">Indicator analytics light up once the Quality Indicators register is populated.</p><p className="text-[10px] text-gray-400 mt-1">The below-target ranking reuses the live QAW-006 engine.</p></div>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Predictive risk forecast" right="rule-based · not ML">
          <Table cols={["Signal", "Latest", "3-mo Δ", "Outlook"]} rows={d.forecast.map((f, i) => [
            <span key={`s${i}`} className="text-gray-700">{f.label}</span>,
            <span key={`c${i}`} className="tabular-nums text-gray-700">{f.current ?? "—"}</span>,
            <span key={`dl${i}`} className={`tabular-nums ${f.dir === "up" ? "text-rose-600" : f.dir === "down" ? "text-emerald-600" : "text-gray-400"}`}>{f.delta == null ? "—" : signed(f.delta)}</span>,
            <Pill key={`o${i}`} text={f.outlook} tone={f.tone} />,
          ])} empty="No snapshot history yet." />
          <p className="text-[10px] text-gray-400 mt-2">Direction of each risk signal over the last ~3 months of snapshots. Rule-based projection — statistical / ML forecasting is next-phase.</p>
        </Card>

        <Card title="Reports by dataset" right={`${d.reportsTotal} definitions`}>
          {d.reportsByDataset.length
            ? <div className="flex items-center gap-2"><Donut segments={d.reportsByDataset} total={d.reportsTotal} label="Reports" size={130} /><Legend items={d.reportsByDataset.slice(0, 7).map(r => ({ label: r.label, value: r.value, tone: r.tone }))} /></div>
            : <p className="text-sm text-gray-400 py-8 text-center">No saved report definitions yet.</p>}
        </Card>
      </div>

      <Card title="Scheduled reports" right={`${k.scheduledActive} active`}>
        <Table cols={["Report", "Frequency", "Next run", "Last status"]} rows={d.scheds.map((s: any, i: number) => [
          <span key={`n${i}`} className="font-medium text-gray-800">{s.name}</span>,
          <Pill key={`f${i}`} text={s.frequency} tone={FREQ_TONE[s.frequency] ?? "slate"} />,
          <span key={`r${i}`} className="tabular-nums text-gray-500">{fmtDate(s.next_run_at)}</span>,
          s.last_status ? <Pill key={`l${i}`} text={s.last_status} tone={statusTone(s.last_status)} /> : <span key={`l${i}`} className="text-gray-400">—</span>,
        ])} empty="No scheduled reports configured yet." />
      </Card>

      <Card title="Data quality & completeness" right="last 30 snapshots">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
          <Bars items={d.dataQuality.slice(0, 4)} />
          <Bars items={d.dataQuality.slice(4)} />
        </div>
        <p className="text-[10px] text-gray-400 mt-3">Field-level completeness — share of the last {Math.min(30, d.snapCount)} daily snapshots where each executive KPI field is populated.</p>
      </Card>

      <Foot>QAW-007 — live over <code>quality_score_snapshots</code> (daily executive KPI history) plus the report builder (<code>report_definitions</code> / <code>report_schedules</code>). Quality trend, dimension mix, data-quality completeness, reports-by-dataset and scheduled reports are all real and tenant-scoped; indicators tracked and the below-target ranking reuse the live <Link href="/quality-accreditation/indicators" className="text-teal-600 hover:underline">Quality Indicators</Link> engine. Key highlights and the predictive risk forecast are <em>rule-based</em> projections over the snapshot trend — statistical / ML forecasting and external benchmarking are next-phase. No figures are fabricated.</Foot>
    </div>
  );
}
