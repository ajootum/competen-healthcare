import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMortalityMorbidity } from "@/lib/operations/mortality-morbidity";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Mortality & Morbidity Centre (UMG-QS-009) — aligned to the high-fidelity spec + mockup. A manager LENS over the
// M&M case register (mm_cases / mm_contributory_factors / mm_period_stats, migration 100). Real: 9-KPI ribbon
// (mortality/morbidity RATE per 1000 discharges + MoM deltas, deaths, serious morbidity, pending reviews, RCA/CAPA
// completion, preventable deaths, composite AI risk), case-mix donut, 6-month rate trend, case-status summary,
// top causes of death, recent registers, preventability distribution, top contributory factors, RCA gauge,
// benchmarking (your unit real; peers reference) and derived alerts + rule-based AI insights. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SEG = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", gray: "#cbd5e1", blue: "#3b82f6", violet: "#8b5cf6", orange: "#fb923c", indigo: "#6366f1" };
const PREV_COLOR: Record<string, string> = { definitely: "#ef4444", probably: "#fb923c", possibly: "#f59e0b", probably_not: "#3b82f6", not: "#10b981", insufficient: "#cbd5e1" };
const FACTOR_COLORS = ["#ef4444", "#fb923c", "#8b5cf6", "#3b82f6", "#10b981", "#14b8a6"];
const CAUSE_COLORS = ["#ef4444", "#8b5cf6", "#fb923c", "#3b82f6", "#10b981"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (p: string) => { const d = new Date(p); return isNaN(+d) ? p : MONTHS[d.getUTCMonth()]; };
const pill: Record<string, { c: string; l: string }> = { new: { c: "bg-gray-100 text-gray-600", l: "New" }, initial_review: { c: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", l: "Under Review" }, rca_in_progress: { c: "bg-[var(--cmp-surface-information)] text-blue-700", l: "RCA in Progress" }, peer_review: { c: "bg-violet-100 text-violet-700", l: "Peer Review" }, pending_capa: { c: "bg-[var(--cmp-surface-warning)] text-orange-700", l: "Pending CAPA" }, closed: { c: "bg-[var(--cmp-surface-success)] text-emerald-700", l: "Closed" } };
const sevPill: Record<string, string> = { New: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", Overdue: "bg-[var(--cmp-surface-warning)] text-orange-700", Critical: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", Info: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", Warning: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" };

function KpiCard({ icon, tint, label, value, unit, delta, deltaGood, sub, tone }: { icon: string; tint: string; label: string; value: any; unit?: string; delta?: number | null; deltaGood?: "down" | "up"; sub?: string; tone?: string }) {
  const good = delta != null && delta !== 0 ? ((delta < 0 && deltaGood === "down") || (delta > 0 && deltaGood === "up")) : null;
  return (
    <div className={`${qcard} p-3`}>
      <div className="flex items-center gap-2 mb-1"><span className={`w-7 h-7 rounded-lg ${tint} flex items-center justify-center text-sm shrink-0`}>{icon}</span><span className="text-[10px] text-gray-500 leading-tight">{label}</span></div>
      <p className={`text-xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{unit && <span className="text-[11px] text-gray-400 font-normal ml-0.5">{unit}</span>}</p>
      {delta != null ? <p className={`text-[10px] ${good == null ? "text-gray-400" : good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{delta < 0 ? "▼" : delta > 0 ? "▲" : ""} {Math.abs(delta)} vs last month</p> : sub ? <p className="text-[10px] text-gray-400">{sub}</p> : null}
    </div>
  );
}
function SegDonut({ segments, center, sub, size = 128 }: { segments: { n: number; color: string }[]; center: any; sub?: string; size?: number }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const b = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(b / sum) * 360}deg ${((b + s.n) / sum) * 360}deg`; }).join(", ")})` : "#e5e7eb";
  return <div className="relative shrink-0" style={{ width: size, height: size }}><div className="rounded-full w-full h-full" style={{ background: grad }} /><div className="absolute bg-white rounded-full flex flex-col items-center justify-center" style={{ inset: size * 0.13 }}><span className="text-2xl font-bold text-gray-900 tabular-nums">{center}</span>{sub && <span className="text-[10px] text-gray-400">{sub}</span>}</div></div>;
}
function RingGauge({ pct }: { pct: number }) {
  const tone = pct >= 85 ? "#10b981" : pct >= 70 ? "#f59e0b" : "#ef4444";
  return <div className="flex flex-col items-center"><div className="relative" style={{ width: 120, height: 120 }}><div className="rounded-full w-full h-full" style={{ background: `conic-gradient(${tone} ${pct * 3.6}deg, #f1f5f9 0deg)` }} /><div className="absolute inset-[14px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-2xl font-bold tabular-nums" style={{ color: tone }}>{pct}%</span><span className="text-[9px] text-gray-400">RCA Completed</span></div></div><div className="flex justify-between w-full text-[9px] text-gray-400 mt-1 px-2"><span>0%</span><span>100%</span></div></div>;
}
function MultiLine({ periods, series, meta, max = 10 }: { periods: string[]; series: Record<string, number[]>; meta: { key: string; color: string }[]; max?: number }) {
  const W = 320, Hh = 130, pad = 6;
  const x = (i: number) => periods.length < 2 ? W / 2 : (i / (periods.length - 1)) * (W - pad * 2) + pad;
  const y = (v: number) => Hh - 10 - (Math.max(0, Math.min(max, v)) / max) * (Hh - 20);
  return <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" style={{ height: 150 }}>{[0, 0.25, 0.5, 0.75, 1].map(g => <line key={g} x1={0} x2={W} y1={y(g * max)} y2={y(g * max)} stroke="#f1f5f9" strokeWidth="1" />)}{meta.map(m => { const pts = (series[m.key] ?? []).map((v, i) => `${x(i)},${y(v)}`).join(" "); return <polyline key={m.key} points={pts} fill="none" stroke={m.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />; })}{meta.map(m => (series[m.key] ?? []).map((v, i) => <circle key={`${m.key}-${i}`} cx={x(i)} cy={y(v)} r="2.5" fill={m.color} />))}</svg>;
}
function HBars({ rows }: { rows: { label: string; n: number; pct?: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return <div className="space-y-1.5">{rows.map((r, i) => (
    <div key={i} className="flex items-center gap-2 text-[11px]"><span className="w-32 truncate text-gray-600 shrink-0">{r.label}</span><div className="flex-1 h-2.5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} /></div><span className="tabular-nums text-gray-500 w-14 text-right shrink-0">{r.n}{r.pct != null ? ` (${r.pct}%)` : ""}</span></div>
  ))}</div>;
}

export default async function MortalityMorbidityCentre() {
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
    loadMortalityMorbidity(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-009" title="Mortality & Morbidity Centre" subtitle="Review. Learn. Improve. Save Lives." />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ M&amp;M store not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 100 (mm_cases / mm_contributory_factors / mm_period_stats), then seed (scripts/seed-mortality-morbidity.mjs).</p></div></div>;
  if (!d.hasData) return <div className="space-y-4">{header}<div className={`${qcard} p-8 text-center`}><p className="text-sm text-gray-500">No M&amp;M cases registered for this unit yet.</p><p className="text-xs text-gray-400 mt-1">Register cases in the M&amp;M workspace, or run scripts/seed-mortality-morbidity.mjs for the AMU demo ward.</p></div></div>;

  const k = d.kpis;
  const riskWord = k.aiRisk >= 0.7 ? "High Risk" : k.aiRisk >= 0.4 ? "Moderate Risk" : "Low Risk";
  const riskTone = k.aiRisk >= 0.7 ? "text-[var(--cmp-text-error)]" : k.aiRisk >= 0.4 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]";
  const bench = [{ label: "Your Unit", v: d.benchmarking.yourUnit, color: SEG.violet }, { label: "Similar Units", v: d.benchmarking.peerAvg, color: SEG.blue }, { label: "Hospital Avg", v: d.benchmarking.hospitalAvg, color: SEG.green }, { label: "National Avg", v: d.benchmarking.nationalAvg, color: SEG.orange }];
  const benchMax = Math.max(1, ...bench.map(b => b.v));
  const aiTint: Record<string, string> = { red: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", amber: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", low: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" };

  return (
    <div className="space-y-4">
      {header}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2.5">
        <KpiCard icon="📉" tint="bg-violet-50" label="Mortality Rate" value={k.mortalityRate} unit="/1k" delta={k.mortalityDelta} deltaGood="down" />
        <KpiCard icon="💗" tint="bg-pink-50" label="Morbidity Rate" value={k.morbidityRate} unit="/1k" delta={k.morbidityDelta} deltaGood="down" />
        <KpiCard icon="🫀" tint="bg-[var(--cmp-surface-error)]" label="Deaths This Month" value={k.deaths} delta={k.deathsDelta} deltaGood="down" tone="text-[var(--cmp-text-error)]" />
        <KpiCard icon="🧬" tint="bg-[var(--cmp-surface-warning)]" label="Serious Morbidity" value={k.seriousMorbidity} delta={k.seriousDelta} deltaGood="down" tone="text-[var(--cmp-text-warning)]" />
        <KpiCard icon="📋" tint="bg-[var(--cmp-surface-warning)]" label="Pending Reviews" value={k.pendingReviews} sub={`${k.pendingMortality} mortality · ${k.pendingMorbidity} morbidity`} />
        <KpiCard icon="🎯" tint="bg-[var(--cmp-surface-information)]" label="RCA Completion" value={`${k.rcaCompletion}%`} tone="text-[var(--cmp-text-information)]" sub="of required" />
        <KpiCard icon="✅" tint="bg-[var(--cmp-surface-success)]" label="CAPA Completion" value={`${k.capaCompletion}%`} tone="text-[var(--cmp-text-success)]" sub="of required" />
        <KpiCard icon="⚠️" tint="bg-[var(--cmp-surface-error)]" label="Preventable Deaths" value={k.preventableDeaths} tone="text-[var(--cmp-text-error)]" sub={`${k.preventablePct}% of deaths`} />
        <KpiCard icon="🧠" tint="bg-fuchsia-50" label="AI Clinical Risk" value={k.aiRisk} tone={riskTone} sub={riskWord} />
      </div>

      {/* Overview · trend · status · causes */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">M&amp;M Overview</h3>
          <div className="flex items-center gap-3">
            <SegDonut segments={[{ n: d.overview.deaths, color: SEG.red }, { n: d.overview.seriousMorbidity, color: SEG.orange }, { n: d.overview.underReview, color: SEG.blue }, { n: d.overview.closed, color: SEG.green }]} center={d.overview.total} sub="Total Cases" />
            <div className="space-y-1 text-[11px] flex-1">
              {[["Deaths", d.overview.deaths, SEG.red], ["Serious Morbidity", d.overview.seriousMorbidity, SEG.orange], ["Under Review", d.overview.underReview, SEG.blue], ["Completed", d.overview.completed, SEG.green], ["Closed", d.overview.closed, SEG.gray]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</span><span className="tabular-nums text-gray-600">{n} ({d.overview.total ? Math.round((n / d.overview.total) * 100) : 0}%)</span></div>
              ))}
            </div>
          </div>
        </div>

        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-900 text-sm">Trends Over Time</h3><span className="text-[10px] text-gray-400">per 1000 discharges</span></div>
          <MultiLine periods={d.trend.periods} series={{ mortality: d.trend.mortality, morbidity: d.trend.morbidity }} meta={[{ key: "mortality", color: SEG.violet }, { key: "morbidity", color: "#ec4899" }]} max={Math.max(4, ...d.trend.morbidity, ...d.trend.mortality)} />
          <div className="flex items-center justify-between mt-1"><div className="flex gap-3"><span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: SEG.violet }} />Mortality Rate</span><span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: "#ec4899" }} />Morbidity Rate</span></div><div className="flex gap-1.5 text-[9px] text-gray-400">{d.trend.periods.map((p: string) => <span key={p}>{monthLabel(p)}</span>)}</div></div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Case Status Summary</h3>
          <div className="space-y-2">{d.caseStatus.map((s: any) => (
            <div key={s.label} className="flex items-center justify-between text-[11px] border-b border-gray-50 pb-1.5"><span className="text-gray-600">{s.label}</span><span className="w-7 h-6 rounded bg-gray-50 flex items-center justify-center font-semibold text-gray-700 tabular-nums">{s.n}</span></div>
          ))}</div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Top Causes of Death <span className="text-gray-300 font-normal text-[10px]">This Month</span></h3>
          <div className="mt-3">{d.topCauses.length ? <HBars rows={d.topCauses.map((c: any, i: number) => ({ label: c.label, n: c.n, pct: c.pct, color: CAUSE_COLORS[i % CAUSE_COLORS.length] }))} /> : <p className="text-[11px] text-gray-400 py-4">No deaths recorded this month.</p>}</div>
        </div>
      </div>

      {/* Registers · alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Recent Mortality Cases</h3><CrossLink href="/unit-manager/capa">Case reviews</CrossLink></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Case</th><th className="py-1 font-medium">Unit</th><th className="py-1 font-medium">Diagnosis</th><th className="py-1 font-medium">Status</th></tr></thead>
            <tbody>{d.recentMortality.map((c: any) => (<tr key={c.ref} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{c.ref}<span className="block text-[9px] text-gray-400">{c.patient}</span></td><td className="py-1.5 text-gray-500">{c.unit}</td><td className="py-1.5 text-gray-600 max-w-[90px] truncate">{c.diagnosis}</td><td className="py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded ${pill[c.status]?.c}`}>{pill[c.status]?.l}</span></td></tr>))}</tbody></table></div>
        </div>

        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Recent Morbidity Cases</h3><CrossLink href="/unit-manager/capa">Case reviews</CrossLink></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Case</th><th className="py-1 font-medium">Event</th><th className="py-1 font-medium">Unit</th><th className="py-1 font-medium">Status</th></tr></thead>
            <tbody>{d.recentMorbidity.map((c: any) => (<tr key={c.ref} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{c.ref}</td><td className="py-1.5 text-gray-600 max-w-[110px] truncate">{c.event}</td><td className="py-1.5 text-gray-500">{c.unit}</td><td className="py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded ${pill[c.status]?.c}`}>{pill[c.status]?.l}</span></td></tr>))}</tbody></table></div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">High Priority Alerts</h3>
          <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="mt-0.5 text-xs">{a.sev === "Critical" || a.sev === "Overdue" ? "🔴" : a.sev === "New" ? "🆕" : a.sev === "Warning" ? "🟠" : "🔵"}</span><p className="text-[11px] text-gray-600 flex-1 leading-snug">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${sevPill[a.sev]}`}>{a.sev}</span></div>
          ))}{!d.alerts.length && <p className="text-[11px] text-gray-400">No active alerts.</p>}</div>
        </div>
      </div>

      {/* Preventability · factors · RCA · benchmarking · AI */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Preventability <span className="text-gray-300 font-normal text-[10px]">This Month</span></h3>
          <div className="flex flex-col items-center">
            <SegDonut segments={d.preventability.breakdown.map((b: any) => ({ n: b.n, color: PREV_COLOR[b.key] }))} center={d.preventability.reviewed} sub="Reviewed" size={112} />
            <div className="space-y-0.5 mt-3 w-full">{d.preventability.breakdown.map((b: any) => (<div key={b.key} className="flex items-center justify-between text-[10px]"><span className="flex items-center gap-1 text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: PREV_COLOR[b.key] }} />{b.label}</span><span className="tabular-nums text-gray-500">{b.n} ({b.pct}%)</span></div>))}</div>
          </div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Contributory Factors <span className="text-gray-300 font-normal text-[10px]">Top 6</span></h3>
          {d.contributoryFactors.length ? <HBars rows={d.contributoryFactors.map((f: any, i: number) => ({ label: f.label, n: f.n, pct: f.pct, color: FACTOR_COLORS[i % FACTOR_COLORS.length] }))} /> : <p className="text-[11px] text-gray-400 py-4">No contributory factors recorded.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">RCA Completion Rate</h3>
          <div className="flex justify-center pt-2"><RingGauge pct={k.rcaCompletion} /></div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Benchmarking <span className="text-gray-300 font-normal text-[10px]">Mortality Rate</span></h3>
          <p className="text-[9px] text-gray-400 mb-3">per 1000 discharges</p>
          <div className="flex items-end justify-between gap-2 h-28">{bench.map(b => (
            <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full"><span className="text-[10px] font-semibold text-gray-700 tabular-nums mb-0.5">{b.v}</span><div className="w-full rounded-t" style={{ height: `${(b.v / benchMax) * 100}%`, background: b.color, minHeight: 4 }} /><span className="text-[8px] text-gray-400 mt-1 text-center leading-tight">{b.label}</span></div>
          ))}</div>
          <p className="text-[9px] text-gray-300 mt-2">Your unit live; peer/hospital/national are reference — external feed next-phase.</p>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">AI Clinical Intelligence</h3>
          <div className="space-y-2">{d.aiInsights.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${aiTint[a.tone]}`}>{a.conf}%</span><p className="text-[10px] text-gray-600 leading-snug">{a.text}</p></div>
          ))}{!d.aiInsights.length && <p className="text-[11px] text-gray-400">No signals requiring attention.</p>}</div>
          <p className="text-[9px] text-gray-300 mt-2">Rule-based — derived from live case data.</p>
        </div>
      </div>

      <NextPhase>Mortality &amp; Morbidity Centre (UMG-QS-009) over mm_cases / mm_contributory_factors / mm_period_stats (migration 100). Live: the 9-KPI ribbon (real /1000-discharge rates + MoM deltas, RCA/CAPA completion, preventable deaths, composite AI risk), case-mix overview, 6-month rate trend, case-status summary, top causes of death, recent registers, preventability distribution, top contributory factors, RCA gauge and rule-based AI insights. Honest next-phase: the multidisciplinary review-meeting manager, the RCA workspace (fishbone / 5-whys), reviewer assignment + consensus preventability, the learning repository + recommendations tracker, and external peer/national benchmarking (reference values shown until a benchmark feed is connected). Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
