import { loadPaTrends } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, RagDot, TrendArrow, Progress, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-PA-003 Performance Trends & Benchmarking Centre — longitudinal trends, SPC, benchmarking, ranking and
// improvement impact over the KPI trend series. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);

export default async function TrendsPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaTrends(admin, hid, isSuper) as any;
  const head = <Head code="UMW-PA-003 · Performance Analytics" title="Performance Trends & Benchmarking Centre" sub="Longitudinal trends, statistical process control, peer benchmarking, ranking and improvement-impact analysis for evidence-based decisions." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="003" /><Provision module="Trends & Benchmarking" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="003" /><div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-sm text-blue-800">Seed the performance stores first.</div></div>;

  const r = d.ribbon, t = d.overallTrend, s = d.spc;
  const tMax = Math.max(...t, 1), tMin = Math.min(...t, 0);
  const sMax = Math.max(s.ucl, ...s.series) * 1.05, sMin = Math.min(s.lcl, ...s.series) * 0.95;
  const sy = (v: number) => 78 - ((v - sMin) / (sMax - sMin || 1)) * 70;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="003" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Overall Performance" value={r.overall} sub="/100 composite" status={r.overall >= 85 ? "green" : "amber"} series={t} />
        <Kpi label="vs Hospital Average" value={`${r.vsHospital >= 0 ? "+" : ""}${r.vsHospital}`} sub="points" status={r.vsHospital >= 0 ? "green" : "red"} />
        <Kpi label="KPIs Improving" value={r.improving} sub="rising vs last" status="green" />
        <Kpi label="KPIs Declining" value={r.declining} sub="falling vs last" status={r.declining ? "amber" : "green"} />
        <Kpi label="Benchmark Percentile" value={`${r.percentile}th`} sub="vs best unit" />
        <Kpi label="Predicted Goal" value={`${r.predictedGoal}%`} sub="attainment" status="green" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Overall Trend" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">rolling 13 months</span>}>
          <svg viewBox="0 0 400 100" className="w-full h-32">
            <polyline points={t.map((v: number, i: number) => `${(i / (t.length - 1)) * 400},${92 - ((v - tMin) / (tMax - tMin || 1)) * 84}`).join(" ")} fill="none" stroke="#4f46e5" strokeWidth="2" />
            {t.map((v: number, i: number) => <circle key={i} cx={(i / (t.length - 1)) * 400} cy={92 - ((v - tMin) / (tMax - tMin || 1)) * 84} r="2.5" fill="#4f46e5" />)}
          </svg>
          <p className="text-[11px] text-gray-500 mt-1">Composite = mean KPI achievement vs target · now <b className="text-indigo-600">{t[t.length - 1]}%</b></p>
        </Card>

        <Card title="Statistical Process Control" right={<span className="text-[11px] text-gray-400">X-bar</span>}>
          <p className="text-[11px] text-gray-500 mb-1">{s.name}</p>
          <svg viewBox="0 0 260 82" className="w-full h-24">
            <line x1="0" y1={sy(s.ucl)} x2="260" y2={sy(s.ucl)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" />
            <line x1="0" y1={sy(s.mean)} x2="260" y2={sy(s.mean)} stroke="#22c55e" strokeWidth="1" strokeDasharray="4 3" />
            <line x1="0" y1={sy(s.lcl)} x2="260" y2={sy(s.lcl)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" />
            <polyline points={s.series.map((v: number, i: number) => `${(i / (s.series.length - 1)) * 260},${sy(v)}`).join(" ")} fill="none" stroke="#4f46e5" strokeWidth="1.5" />
            {s.series.map((v: number, i: number) => <circle key={i} cx={(i / (s.series.length - 1)) * 260} cy={sy(v)} r="2" fill="#4f46e5" />)}
          </svg>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span className="text-rose-500">UCL {s.ucl}</span><span className="text-emerald-600">CL {s.mean}</span><span className="text-rose-500">LCL {s.lcl}</span></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Benchmarking Summary">
          <div className="space-y-2">{d.benchmarks.map((b: any) => (
            <div key={b.label} className={`flex items-center gap-2 text-[12px] ${b.you ? "font-semibold" : ""}`}><span className={`w-28 truncate ${b.you ? "text-indigo-700" : "text-gray-600"}`}>{b.label}</span><div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.value}%`, background: b.you ? "#4f46e5" : "#94a3b8" }} /></div><span className="text-gray-900 tabular-nums w-9 text-right">{b.value}</span></div>
          ))}</div>
        </Card>

        <Card title="Comparative Ranking" right={<span className="text-[11px] text-gray-400">by achievement</span>}>
          <div className="space-y-1">{d.ranking.map((k: any) => (
            <div key={k.name} className="flex items-center gap-1.5 text-[12px]"><span className="w-5 text-gray-400 tabular-nums">{k.rank}</span><span className="text-gray-800 flex-1 truncate">{k.name}</span><span className="font-semibold text-gray-900 tabular-nums w-10 text-right">{k.achievement}%</span><RagDot status={k.status} /><TrendArrow up={k.deltaUp} /></div>
          ))}</div>
        </Card>

        <Card title="Improvement Impact">
          <div className="space-y-2">{d.improvement.map((p: any) => (
            <div key={p.name}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700 truncate">{p.name}</span><span className="text-emerald-600 font-medium">{money(p.benefit)}</span></div><Progress pct={p.progress} /></div>
          ))}</div>
        </Card>
      </div>

      <Foot>UMW-PA-003 — trends &amp; benchmarking over pa_kpi_values + pa_benchmarks. The composite trend and SPC control limits (mean ± 3σ) are computed live from real KPI history; benchmark scores are the mean achievement of each comparator group. Forecast models &amp; configurable benchmark groups are the next phase.</Foot>
    </div>
  );
}
