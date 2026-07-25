import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadClinicalIndicators } from "@/lib/operations/clinical-indicators";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, Rag, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Clinical Indicators Centre (UMG-QS-008) — aligned to the high-fidelity spec + mockup. A manager LENS over the
// clinical-quality indicators (quality_indicators / indicator_measurements, migration 019) grouped by category
// (quality_objects). Real: 8-KPI ribbon (overall attainment, meeting/below target, trending-down, high-risk,
// composite AI risk), performance-summary donut, per-category attainment trend, top underperformers, category
// breakdown, data-quality metrics, rule-based AI insights and threshold-breach alerts. Peer benchmarking and a
// dedicated improvement-projects store are honest next-phase. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (p: string) => { const d = new Date(p); return isNaN(+d) ? p : MONTHS[d.getUTCMonth()]; };
const fmt = (v: number | null, unit: string) => { if (v == null) return "—"; if (unit === "percent") return `${v}%`; if (unit === "rate_per_1000") return `${v}/1k`; if (unit === "minutes") return `${v}m`; if (unit === "days") return `${v}d`; return `${v}`; };
const ragTone = (s: string): "green" | "amber" | "red" | "gray" => (s === "green" ? "green" : s === "amber" ? "amber" : s === "red" ? "red" : "gray");
const ragLabel: Record<string, string> = { green: "On target", amber: "Watch", red: "Critical", gray: "No data" };
const scoreTone = (s: number | null) => (s == null ? "text-gray-400" : s >= 85 ? "text-emerald-600" : s >= 70 ? "text-amber-600" : "text-rose-600");
const scoreWord = (s: number | null) => (s == null ? "—" : s >= 85 ? "Good" : s >= 70 ? "Fair" : "Needs focus");
const SEG = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", gray: "#cbd5e1" };
const CAT_COLORS = ["#6366f1", "#10b981", "#8b5cf6", "#f59e0b", "#0ea5e9"];

// Multi-segment donut (prefix-sum conic arcs).
function SegDonut({ segments, center, sub }: { segments: { n: number; color: string }[]; center: string | number; sub?: string }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const b = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(b / sum) * 360}deg ${((b + s.n) / sum) * 360}deg`; }).join(", ")})` : "#e5e7eb";
  return <div className="relative shrink-0" style={{ width: 132, height: 132 }}><div className="rounded-full w-full h-full" style={{ background: grad }} /><div className="absolute inset-[16px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-2xl font-bold text-gray-900 tabular-nums">{center}</span>{sub && <span className="text-[10px] text-gray-400">{sub}</span>}</div></div>;
}
// Data-quality ring gauge.
function Gauge({ pct, label }: { pct: number; label: string }) {
  const tone = pct >= 90 ? "#10b981" : pct >= 75 ? "#f59e0b" : "#ef4444";
  const word = pct >= 90 ? "Good" : pct >= 75 ? "Fair" : "Low";
  return <div className="flex flex-col items-center"><div className="relative" style={{ width: 74, height: 74 }}><div className="rounded-full w-full h-full" style={{ background: `conic-gradient(${tone} ${pct * 3.6}deg, #f1f5f9 0deg)` }} /><div className="absolute inset-[9px] bg-white rounded-full flex items-center justify-center"><span className="text-sm font-bold tabular-nums" style={{ color: tone }}>{pct}%</span></div></div><p className="text-[11px] font-medium text-gray-700 mt-1.5">{label}</p><p className="text-[9px] text-gray-400">{word}</p></div>;
}
// Overlaid multi-line attainment trend.
function MultiLine({ periods, series, meta }: { periods: string[]; series: Record<string, (number | null)[]>; meta: { key: string; color: string }[] }) {
  const W = 320, Hh = 130, pad = 4;
  const x = (i: number) => periods.length < 2 ? W / 2 : (i / (periods.length - 1)) * (W - pad * 2) + pad;
  const y = (v: number) => Hh - 8 - (Math.max(0, Math.min(100, v)) / 100) * (Hh - 16);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" style={{ height: 150 }}>
      {[0, 25, 50, 75, 100].map(g => <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="#f1f5f9" strokeWidth="1" />)}
      {meta.map(m => { const pts = (series[m.key] ?? []).map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean).join(" "); return <polyline key={m.key} points={pts} fill="none" stroke={m.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />; })}
      {meta.map(m => (series[m.key] ?? []).map((v, i) => v == null ? null : <circle key={`${m.key}-${i}`} cx={x(i)} cy={y(v)} r="2.5" fill={m.color} />))}
    </svg>
  );
}

export default async function ClinicalIndicatorsCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadClinicalIndicators(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-008" title="Clinical Indicators Centre" subtitle="Monitor, analyze and improve clinical performance across the unit" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality indicators not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 019 (quality_indicators / indicator_measurements), then seed indicators (scripts/seed-clinical-indicators.mjs).</p></div></div>;
  if (!d.hasData) return <div className="space-y-4">{header}<div className={`${qcard} p-8 text-center`}><p className="text-sm text-gray-500">No clinical indicators are defined for this unit yet.</p><p className="text-xs text-gray-400 mt-1">Define indicators + measurements in the quality workspace, or run scripts/seed-clinical-indicators.mjs for the AMU demo ward.</p></div></div>;

  const k = d.kpis;
  const meetPct = k.total ? Math.round((k.onTarget / k.total) * 100) : 0;
  const belowPct = k.total ? Math.round((k.below / k.total) * 100) : 0;
  const downPct = k.total ? Math.round((k.trendingDown / k.total) * 100) : 0;
  const riskWord = k.riskScore >= 0.7 ? "High Risk" : k.riskScore >= 0.4 ? "Moderate Risk" : "Low Risk";
  const trendMeta = Object.keys(d.trend.series).slice(0, 5).map((key, i) => ({ key, label: key === "Overall" ? "Overall" : key.replace(/ Indicators$/, ""), color: CAT_COLORS[i % CAT_COLORS.length] }));
  const summarySegs = [{ n: k.onTarget, color: SEG.green }, { n: k.below, color: SEG.red }, { n: k.trendingDown, color: SEG.amber }, { n: k.noData, color: SEG.gray }];

  // Rule-based AI insights from the real breaches / declines.
  const aiInsights = [
    ...d.topUnderperformers.filter((i: any) => i.status === "red").slice(0, 2).map((i: any) => ({ text: `${i.name} is breaching its escalation threshold (${fmt(i.value, i.unit)} vs ${fmt(i.target, i.unit)} target) — clinical review advised.`, conf: 88, tone: "red" })),
    ...d.indicators.filter((i: any) => i.worsening && i.status === "amber").slice(0, 2).map((i: any) => ({ text: `${i.name} is below target and declining — trend likely to worsen without intervention.`, conf: 76, tone: "amber" })),
    ...(d.kpis.overallScore != null && d.kpis.overallScore >= 80 ? [{ text: `Overall attainment (${d.kpis.overallScore}%) is healthy; ${d.kpis.onTarget} of ${d.kpis.total} indicators are on target.`, conf: 82, tone: "low" }] : []),
  ].slice(0, 4);
  const aiTint: Record<string, string> = { red: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-600", low: "bg-emerald-50 text-emerald-600" };
  const maxCat = Math.max(1, ...d.byCategory.map((c: any) => c.total));

  return (
    <div className="space-y-4">
      {header}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Overall Quality Score" value={k.overallScore != null ? `${k.overallScore}%` : "—"} tone={scoreTone(k.overallScore)} sub={scoreWord(k.overallScore)} />
        <Kpi icon="🎯" tint="bg-indigo-50" label="Meeting Target" value={`${k.onTarget}/${k.total}`} sub={`${meetPct}%`} />
        <Kpi icon="⛔" tint="bg-rose-50" label="Below Target" value={k.below} tone={k.below ? "text-rose-600" : "text-gray-400"} sub={`${belowPct}%`} />
        <Kpi icon="📉" tint="bg-amber-50" label="Trending Down" value={k.trendingDown} tone={k.trendingDown ? "text-amber-600" : "text-gray-400"} sub={`${downPct}%`} />
        <Kpi icon="⚠️" tint="bg-orange-50" label="High-Risk Indicators" value={k.highRisk} tone={k.highRisk ? "text-rose-600" : "text-gray-400"} sub="critical attention" />
        <Kpi icon="🚀" tint="bg-sky-50" label="Improvement Projects" value={k.improvementProjects} sub="open CAPA (proxy)" />
        <Kpi icon="📊" tint="bg-violet-50" label="At/Above Target" value={`${k.benchmarkPct}%`} sub="internal benchmark" />
        <Kpi icon="🧠" tint="bg-fuchsia-50" label="AI Clinical Risk" value={k.riskScore} tone={scoreTone(k.riskScore < 0.4 ? 90 : k.riskScore < 0.7 ? 75 : 50)} sub={riskWord} />
      </div>

      {/* Summary donut · trend · top underperformers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Indicator Performance Summary</h3>
          <div className="flex items-center gap-4">
            <SegDonut segments={summarySegs} center={k.total} sub="Indicators" />
            <div className="space-y-1.5 text-xs flex-1">
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SEG.green }} />Meeting Target</span><span className="tabular-nums text-gray-600">{k.onTarget} ({meetPct}%)</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SEG.red }} />Below Target</span><span className="tabular-nums text-gray-600">{k.below} ({belowPct}%)</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SEG.amber }} />Trending Down</span><span className="tabular-nums text-gray-600">{k.trendingDown} ({downPct}%)</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SEG.gray }} />No Data</span><span className="tabular-nums text-gray-600">{k.noData}</span></div>
            </div>
          </div>
        </div>

        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-900 text-sm">Indicator Performance Trend</h3><span className="text-[10px] text-gray-400">attainment % vs target</span></div>
          <MultiLine periods={d.trend.periods} series={d.trend.series} meta={trendMeta} />
          <div className="flex items-center justify-between mt-1"><div className="flex flex-wrap gap-2">{trendMeta.map(m => <span key={m.key} className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: m.color }} />{m.label}</span>)}</div><div className="flex gap-1.5 text-[9px] text-gray-400">{d.trend.periods.map((p: string) => <span key={p}>{monthLabel(p)}</span>)}</div></div>
        </div>

        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Top Underperforming</h3><CrossLink href="/quality-accreditation">Quality workspace</CrossLink></div>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Indicator</th><th className="py-1 font-medium text-right">Perf.</th><th className="py-1 font-medium text-right">Target</th><th className="py-1 font-medium">Status</th></tr></thead>
            <tbody>{d.topUnderperformers.slice(0, 10).map((i: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 max-w-[150px] truncate" title={i.name}>{i.name}<span className="block text-[9px] text-gray-400">{i.category.replace(/ Indicators$/, "")}</span></td><td className="py-1.5 text-right tabular-nums font-semibold text-gray-800">{fmt(i.value, i.unit)}</td><td className="py-1.5 text-right tabular-nums text-gray-400">{fmt(i.target, i.unit)}</td><td className="py-1.5"><Rag tone={ragTone(i.status)} label={ragLabel[i.status]} /></td></tr>
            ))}{!d.topUnderperformers.length && <tr><td colSpan={4} className="py-6 text-center text-gray-400">All indicators on target 🎉</td></tr>}</tbody></table></div>
        </div>
      </div>

      {/* Category breakdown · benchmarking · high impact */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Indicators by Category</h3>
          <div className="space-y-2">{d.byCategory.map((c: any) => (
            <div key={c.category}><div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-gray-600 truncate">{c.category.replace(/ Indicators$/, "")}</span><span className="text-gray-400 tabular-nums">{c.total}</span></div>
              <div className="flex h-3.5 rounded overflow-hidden bg-gray-100" style={{ width: `${Math.max(20, (c.total / maxCat) * 100)}%` }}>{c.meeting > 0 && <div style={{ background: SEG.green, flex: c.meeting }} title={`${c.meeting} meeting`} />}{c.below > 0 && <div style={{ background: SEG.red, flex: c.below }} title={`${c.below} below`} />}{c.noData > 0 && <div style={{ background: SEG.gray, flex: c.noData }} title={`${c.noData} no data`} />}</div>
            </div>
          ))}</div>
          <div className="flex gap-3 text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-100"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SEG.green }} />Meeting</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SEG.red }} />Below</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SEG.gray }} />No data</span></div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Benchmarking · Your Unit</h3>
          <p className="text-[10px] text-gray-400 mb-3">Attainment by category (this unit). Peer &amp; hospital comparison is next-phase.</p>
          <div className="space-y-2">{trendMeta.filter(m => m.key !== "Overall").map(m => { const s = d.trend.series[m.key] ?? []; const v = [...s].reverse().find((x: any) => x != null) ?? 0; return (
            <div key={m.key}><div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-gray-600">{m.label}</span><span className="tabular-nums text-gray-500">{v}%</span></div><div className="h-2.5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.min(100, v)}%`, background: m.color }} /></div></div>
          ); })}</div>
          <NextPhase>Peer-unit and hospital-average benchmarking need a cross-unit benchmark store — next-phase. Your unit&apos;s attainment above is live.</NextPhase>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">High Impact Indicators</h3>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Indicator</th><th className="py-1 font-medium">Impact</th><th className="py-1 font-medium text-right">Perf.</th><th className="py-1 font-medium text-right">Target</th></tr></thead>
            <tbody>{d.highImpact.map((i: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 max-w-[150px] truncate" title={i.name}>{i.name}</td><td className="py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${i.impact === "High" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{i.impact}</span></td><td className="py-1.5 text-right tabular-nums font-semibold text-gray-800">{fmt(i.value, i.unit)}</td><td className="py-1.5 text-right tabular-nums text-gray-400">{fmt(i.target, i.unit)}</td></tr>
            ))}{!d.highImpact.length && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No high-impact breaches.</td></tr>}</tbody></table></div>
        </div>
      </div>

      {/* Data quality · improvement tracker · AI · alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Data Quality Status</h3>
          <div className="grid grid-cols-2 gap-3">
            <Gauge pct={d.dataQuality.completeness} label="Completeness" />
            <Gauge pct={d.dataQuality.timeliness} label="Timeliness" />
            <Gauge pct={d.dataQuality.accuracy} label="Accuracy" />
            <Gauge pct={d.dataQuality.consistency} label="Consistency" />
          </div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Improvement Tracker</h3>
          <div className="flex flex-col items-center py-2"><span className="text-3xl font-bold text-gray-900 tabular-nums">{k.improvementProjects}</span><span className="text-[11px] text-gray-400">open CAPA / quality actions</span></div>
          <CrossLink href="/unit-manager/capa">Open CAPA Centre →</CrossLink>
          <NextPhase>Project status breakdown (on-track / at-risk / delayed) needs a dedicated improvement-project store — next-phase. The open count is live from CAPA.</NextPhase>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">AI Clinical Intelligence</h3>
          <div className="space-y-2">{aiInsights.map((a, i) => (
            <div key={i} className="flex items-start gap-2"><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${aiTint[a.tone]}`}>{a.conf}%</span><p className="text-[11px] text-gray-600 leading-snug">{a.text}</p></div>
          ))}{!aiInsights.length && <p className="text-[11px] text-gray-400">No signals requiring attention.</p>}</div>
          <p className="text-[9px] text-gray-300 mt-2">Rule-based — derived from live breaches &amp; trends.</p>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent Indicator Alerts</h3>
          <div className="space-y-1.5">{d.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="mt-0.5 text-xs">{a.status === "red" ? "🔴" : "🟠"}</span><div className="flex-1 min-w-0"><p className="text-[11px] text-gray-700 leading-snug">{a.message}</p></div><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.severity === "Critical" ? "bg-rose-100 text-rose-700" : a.severity === "High" ? "bg-orange-100 text-orange-700" : "bg-amber-100 text-amber-700"}`}>{a.severity}</span></div>
          ))}{!d.alerts.length && <p className="text-[11px] text-gray-400">No active alerts — all indicators within threshold.</p>}</div>
        </div>
      </div>

      <NextPhase>Clinical Indicators Centre (UMG-QS-008) over quality_indicators / indicator_measurements (migration 019), grouped by category via the hospital&apos;s quality_objects. Live: the 8-KPI ribbon (overall attainment, meeting/below target, trending-down, high-risk, composite AI risk), performance-summary donut, per-category attainment trend, top underperformers, category breakdown, data-quality metrics, rule-based AI insights and threshold-breach alerts. Honest next-phase: peer-unit &amp; hospital benchmarking (needs a benchmark store), the improvement-project status tracker (needs a project store), the indicator builder, predictive analytics and root-cause drill-down. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
