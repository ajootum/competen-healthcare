import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot, T } from "../_ui";
import { loadExecPerformance } from "@/lib/hex/performance";

export const dynamic = "force-dynamic";

// HEX-003 Performance Management Centre (executive lens) over the pa_* balanced scorecard.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Balanced Scorecard", "KPI Management", "Targets & Goals", "Departments & Services", "Benchmarking", "Variance Analysis", "Reviews", "Action Tracking"];
const ST_TONE: Record<string, string> = { green: "emerald", amber: "amber", red: "rose" };
const ST_LABEL: Record<string, string> = { green: "Good", amber: "At risk", red: "Critical" };

export default async function ExecPerformancePage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecPerformance(admin, hid, isSuper);
  const head = <Head code="HEX-003 · Hospital Executive" title="Performance Management Centre" sub="Monitor. Measure. Analyse. Act. Drive superior organisational performance." action={{ label: "Strategy →", href: "/hospital-executive/strategy" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The performance framework (<code>pa_*</code>) is not provisioned yet.</p></Card></div>;
  if (!d.hasData) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">Performance framework provisioned but no KPIs configured yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🎯" tone={k.overall >= 75 ? "emerald" : "amber"} label="Overall performance index" value={`${k.overall}%`} />
        <Stat icon="🎖️" tone="blue" label="Objectives on track" value={k.objOnTrack != null ? `${k.objOnTrack}%` : "—"} />
        <Stat icon="📊" tone="teal" label="Enterprise KPIs met" value={k.kpisMet != null ? `${k.kpisMet}%` : "—"} sub={`${k.kpiTotal} KPIs`} />
        <Stat icon="🚀" tone="violet" label="Initiatives on track" value={k.initOnTrack != null ? `${k.initOnTrack}%` : "—"} />
        <Stat icon="⚠️" tone={k.variance ? "rose" : "emerald"} label="Variance alerts" value={k.variance} sub="KPIs off target" />
        <Stat icon="🔻" tone={k.objAtRisk ? "amber" : "emerald"} label="Objectives at risk" value={k.objAtRisk} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Balanced scorecard" className="xl:col-span-2">
          <Table cols={["Perspective", "Score", "KPIs", "On target", "Status"]} rows={d.scorecard.map((s: any) => [
            <span key="n" className="font-medium text-gray-800">{s.name}</span>,
            <span key="s" className={`font-bold tabular-nums ${T(ST_TONE[s.status] ?? "slate").text}`}>{s.score}%</span>,
            <span key="c" className="text-gray-500 tabular-nums">{s.kpiCount}</span>,
            <span key="g" className="text-gray-500 tabular-nums">{s.green}/{s.kpiCount}</span>,
            <Pill key="st" text={ST_LABEL[s.status] ?? s.status} tone={ST_TONE[s.status] ?? "slate"} />,
          ])} empty="No perspectives configured." />
        </Card>

        <Card title="Variance summary">
          <div className="flex items-center gap-2">
            <Donut segments={d.varianceDonut} total={k.kpiTotal} label="KPIs" size={130} />
            <Legend items={d.varianceDonut.map((v: any) => ({ label: v.label, value: v.value, tone: v.tone, pct: k.kpiTotal ? Math.round((v.value / k.kpiTotal) * 100) : 0 }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="KPI heat map" className="xl:col-span-2" right="perspective × status">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400"><th className="pb-1 pr-3 font-medium">Perspective</th><th className="pb-1 px-2 font-medium text-center">On target</th><th className="pb-1 px-2 font-medium text-center">Watch</th><th className="pb-1 px-2 font-medium text-center">Off target</th></tr></thead>
              <tbody>
                {d.heat.map((h: any, i: number) => (
                  <tr key={i}><td className="py-1 pr-3 text-gray-700">{h.perspective}</td>
                    {[["green", h.green], ["amber", h.amber], ["red", h.red]].map(([tone, val]: any) => (
                      <td key={tone} className="py-1 px-2"><div className="h-7 rounded flex items-center justify-center font-bold tabular-nums" style={{ backgroundColor: T(ST_TONE[tone]).hex + (val ? "26" : "10"), color: val ? T(ST_TONE[tone]).hex : "#cbd5e1" }}>{val}</div></td>
                    ))}
                  </tr>
                ))}
                {!d.heat.length && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No KPIs mapped to perspectives.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Top & bottom performers" right="perspectives">
          <p className="text-[10px] text-gray-400 mb-1">Top</p>
          <div className="space-y-1 mb-3">{d.topPerformers.map((p: any, i: number) => <div key={i} className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 w-4">{i + 1}</span><span className="text-gray-700 flex-1 truncate">{p.name}</span><span className={`font-semibold tabular-nums ${T(ST_TONE[p.status] ?? "slate").text}`}>{p.score}%</span></div>)}</div>
          <p className="text-[10px] text-gray-400 mb-1">Needs attention</p>
          <div className="space-y-1">{d.bottomPerformers.map((p: any, i: number) => <div key={i} className="flex items-center gap-2 text-[12px]"><span className="text-gray-700 flex-1 truncate">{p.name}</span><span className={`font-semibold tabular-nums ${T(ST_TONE[p.status] ?? "slate").text}`}>{p.score}%</span></div>)}</div>
          <p className="text-[10px] text-gray-400 mt-2">Ranked by balanced-scorecard perspective; department-level performers are the next phase.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Strategic objectives progress">
          {d.objectives.length ? <Bars items={d.objectives.map((o: any) => ({ label: o.title, pct: o.progress, value: `${o.progress}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">{d.frameworkProvisioned ? "No published objectives yet." : "Strategy framework not provisioned."}</p>}
        </Card>

        <Card title="Executive action centre">
          <Table cols={["Type", "Item", "Detail"]} rows={d.actions.map((a: any) => [
            <Pill key="t" text={a.type} tone={a.tone} />,
            <span key="i" className="font-medium text-gray-800">{a.item}</span>,
            <span key="d" className="text-gray-500">{a.detail}</span>,
          ])} empty="Nothing off-track. ✅" />
        </Card>
      </div>

      <Foot>HEX-003 — live over the <code>pa_*</code> balanced scorecard (<code>fetchPerformance</code>, with KPI values resolving from the daily <code>op_ops_snapshots</code>) and strategic objectives from <code>ppe_*</code> (<code>fetchFramework</code>). Scorecard, KPI heat map, variance and objective progress are real and tenant-scoped. Department-level performers, YoY trend history and executive review workflows are the next build phase.</Foot>
    </div>
  );
}
