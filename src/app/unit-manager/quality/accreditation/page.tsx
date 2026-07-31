import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAccreditationReadiness } from "@/lib/operations/accreditation-readiness";
import QualityTabs from "../QualityTabs";

export const dynamic = "force-dynamic";

// Accreditation Readiness Centre (UMG-QS-005) — aligned to the detailed spec + mockup. Consolidation over the
// real accreditation stores (gov_standard_assessments / quality_standards / quality_frameworks / gov_surveys /
// gov_obligations / capa_actions); no store forked. Real: framework readiness + trend (recomputed from the
// insert-only assessment history), the compliance-status breakdown, standards-at-risk, gap analysis, evidence
// completeness, survey readiness, the calendar and AI insights. Honest next-phase (spec §9 entities with no
// store): the ActionPlan work queue owner/due/progress, the EvidenceItem repository, PolicyLink and training.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (p: number | null) => (p == null ? "text-gray-300" : p >= 85 ? "text-[var(--cmp-text-success)]" : p >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const barTone = (p: number) => (p >= 85 ? "#10b981" : p >= 70 ? "#f59e0b" : "#ef4444");
const riskTone = (r: string) => (r === "High" ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : r === "Medium" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-success)] text-emerald-700");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthAbbr = (dateStr: string) => { const mi = Number((dateStr ?? "").slice(5, 7)) - 1; return mi >= 0 && mi < 12 ? MONTHS[mi] : ""; };
const QUICK = [
  { label: "Standards Library", icon: "📚", tint: "bg-[var(--cmp-surface-information)]" }, { label: "Measurable Elements", icon: "📋", tint: "bg-indigo-50" },
  { label: "Evidence Repository", icon: "📁", tint: "bg-violet-50" }, { label: "Mock Surveys", icon: "👥", tint: "bg-teal-50" },
  { label: "Gap Analysis", icon: "🔍", tint: "bg-[var(--cmp-surface-error)]" }, { label: "Action Plans", icon: "✅", tint: "bg-[var(--cmp-surface-success)]" },
  { label: "Document Manager", icon: "🗂️", tint: "bg-[var(--cmp-surface-warning)]" }, { label: "Survey Readiness", icon: "🎯", tint: "bg-[var(--cmp-surface-warning)]" },
  { label: "Reports & Analytics", icon: "📊", tint: "bg-pink-50" }, { label: "AI Insights", icon: "🧠", tint: "bg-fuchsia-50" },
];

function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2 || series.every(v => v === series[0])) return <div className="h-5" />;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${18 - ((v - min) / rng) * 16}`).join(" ");
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
function Delta({ v, unit = "%", invert }: { v: number | null | undefined; unit?: string; invert?: boolean }) {
  if (v == null || v === 0) return <span className="text-[10px] text-gray-400">vs last period</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={`text-[10px] font-medium ${good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{v > 0 ? "↑" : "↓"} {Math.abs(v)}{unit} vs Apr</span>;
}
function Kpi({ icon, tint, label, value, unit, sub, tone, spark, sparkColor, delta, deltaUnit, deltaInvert }: any) {
  return (
    <div className={`${card} p-3.5`}>
      <div className="flex items-center gap-1.5 mb-1"><span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0 ${tint}`}>{icon}</span><span className="text-[9px] font-medium text-gray-500 uppercase tracking-wide truncate">{label}</span></div>
      <div className={`text-xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}</div>
      {spark ? <div className="mt-0.5"><Spark series={spark} color={sparkColor} /></div> : sub && <div className="text-[9px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
      {delta !== undefined && <div className="mt-0.5"><Delta v={delta} unit={deltaUnit} invert={deltaInvert} /></div>}
    </div>
  );
}
function SegDonut({ segs, total, label }: { segs: { n: number; color: string }[]; total: number; label: string }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1;
  const active = segs.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(before / sum) * 360}deg ${((before + s.n) / sum) * 360}deg`; }).join(", ")})` : "#f1f5f9";
  return <div className="relative w-32 h-32 shrink-0"><div className="w-32 h-32 rounded-full" style={{ background: grad }} /><div className="absolute inset-[24%] rounded-full bg-white flex flex-col items-center justify-center text-center"><span className="text-2xl font-bold text-gray-900 leading-none">{total}</span><span className="text-[8px] text-gray-400 leading-tight px-1">{label}</span></div></div>;
}

export default async function AccreditationReadiness() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadAccreditationReadiness(admin).catch(() => null) as any;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-lg">🏅</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Accreditation Readiness Centre</h1><p className="text-sm text-gray-500">Monitor, manage and improve accreditation readiness across all standards · enterprise programme</p></div></div>
        <div className="flex items-center gap-2"><Link href="/unit-manager/quality/accreditation" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link><Link href="/quality-accreditation" className="text-xs bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700 font-medium">+ Add Evidence</Link></div>
      </div>
      <QualityTabs />
    </>
  );

  if (!d || !d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Accreditation self-assessments not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 061 (gov_standard_assessments) and record framework self-assessments to compute readiness.</p></div></div>;

  const k = d.kpis;

  return (
    <div className="space-y-4">
      {header}

      {/* ── KPI ribbon (7) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
        <Kpi icon="🎯" tint="bg-teal-50" label="Overall Readiness" value={k.overall != null ? `${k.overall}%` : "—"} tone={pctTone(k.overall)} spark={k.trendSpark} sparkColor="#14b8a6" delta={k.overallDelta} />
        <Kpi icon="🏥" tint="bg-[var(--cmp-surface-success)]" label="SafeCare" value={k.safecare?.readiness != null ? `${k.safecare.readiness}%` : "—"} tone={pctTone(k.safecare?.readiness ?? null)} delta={k.safecare?.delta} />
        <Kpi icon="⚕️" tint="bg-violet-50" label="JCI Readiness" value={k.jci?.readiness != null ? `${k.jci.readiness}%` : "—"} tone={pctTone(k.jci?.readiness ?? null)} delta={k.jci?.delta} />
        <Kpi icon="🏛️" tint="bg-[var(--cmp-surface-warning)]" label="National Standards" value={k.national?.readiness != null ? `${k.national.readiness}%` : "—"} tone={pctTone(k.national?.readiness ?? null)} delta={k.national?.delta} />
        <Kpi icon="📁" tint="bg-[var(--cmp-surface-information)]" label="Evidence Complete" value={k.evidenceComplete != null ? `${k.evidenceComplete}%` : "—"} tone={pctTone(k.evidenceComplete)} delta={k.evidenceDelta} />
        <Kpi icon="🚩" tint="bg-[var(--cmp-surface-error)]" label="High Risk Standards" value={k.highRisk} tone={k.highRisk ? "text-[var(--cmp-text-error)]" : "text-gray-400"} delta={k.highRiskDelta} deltaUnit="" deltaInvert />
        <Kpi icon="📅" tint="bg-indigo-50" label="Survey Countdown" value={k.surveyCountdown != null ? k.surveyCountdown : "—"} unit={k.surveyCountdown != null ? "d" : ""} sub={k.nextSurveyName ? `to ${k.nextSurveyName} survey` : "no survey scheduled"} />
      </div>

      {/* ── Frameworks · compliance status · standards at risk ─────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Readiness by Framework</h3>
          {d.perFramework.length ? <div className="space-y-2.5">{d.perFramework.map((f: any) => (
            <div key={f.id} className="flex items-center gap-2 text-xs"><span className="text-gray-600 w-28 truncate" title={f.name}>{f.code}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${f.readiness ?? 0}%`, background: barTone(f.readiness ?? 0) }} /></div><b className={`tabular-nums w-9 text-right ${pctTone(f.readiness)}`}>{f.readiness != null ? `${f.readiness}%` : "—"}</b><span className={`w-10 text-right tabular-nums text-[10px] ${f.delta == null ? "text-gray-300" : f.delta >= 0 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{f.delta == null ? "—" : `${f.delta >= 0 ? "↑" : "↓"}${Math.abs(f.delta)}%`}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No frameworks assessed.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance Status Overview</h3>
          {d.totalElements > 0 ? <div className="flex items-center gap-4">
            <SegDonut total={d.totalElements} label="Measurable Elements" segs={d.complianceStatus.map((s: any) => ({ n: s.n, color: s.color }))} />
            <div className="text-[11px] text-gray-600 space-y-1.5 flex-1 min-w-0">{d.complianceStatus.map((s: any) => <div key={s.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1">{s.label}</span><b className="tabular-nums text-gray-700">{s.n}</b><span className="text-gray-300 tabular-nums">({s.pct}%)</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No measurable elements assessed.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Top Standards at Risk</h3>
          {d.atRisk.length ? <div className="space-y-1.5">{d.atRisk.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs"><div className="min-w-0 flex-1"><p className="text-gray-700 truncate" title={a.title}>{a.ref}</p><p className="text-[10px] text-gray-400 truncate">{a.framework}</p></div><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${riskTone(a.risk)}`}>{a.risk}</span><div className="w-10 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0"><div className="h-full rounded-full" style={{ width: `${a.compliance}%`, background: barTone(a.compliance) }} /></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No standards at risk. 🎉</p>}
        </div>
      </div>

      {/* ── Work queue · gap analysis · survey readiness ───────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><h3 className="font-semibold text-gray-900 text-sm">Accreditation Work Queue</h3><div className="flex gap-1 text-[10px]"><span className="px-2 py-0.5 rounded-full bg-teal-600 text-white">All {d.queueCounts.all}</span><span className="px-2 py-0.5 rounded-full bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]">At Risk {d.queueCounts.atRisk}</span><span className="px-2 py-0.5 rounded-full bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]">Awaiting Verif. {d.queueCounts.awaitingVerification}</span></div></div>
          {d.workQueue.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">ID</th><th className="py-1.5 font-medium">Title</th><th className="py-1.5 font-medium">Framework</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Priority</th><th className="py-1.5 font-medium">Status</th></tr></thead>
                <tbody>{d.workQueue.slice(0, 8).map((w: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400 tabular-nums whitespace-nowrap font-mono text-[10px]">{w.id}</td>
                    <td className="py-2 text-gray-700 max-w-[160px] truncate" title={w.title}>{w.title}</td>
                    <td className="py-2 text-gray-500">{w.framework}</td>
                    <td className="py-2 text-gray-500">{w.type}</td>
                    <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${riskTone(w.priority)}`}>{w.priority}</span></td>
                    <td className="py-2 text-gray-500">{w.status}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Derived from real assessment gaps. Owner / due date / progress (the ActionPlan store) are next-phase.</p>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No open accreditation gaps. 🎉</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Gap Analysis Summary</h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm"><span className="text-gray-600">Total Gaps Identified</span><b className="tabular-nums text-gray-900">{d.gap.total}</b></div>
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-error)]" />High Priority Gaps</span><b className="tabular-nums text-[var(--cmp-text-error)]">{d.gap.high}</b></div>
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-warning)]" />Medium Priority Gaps</span><b className="tabular-nums text-[var(--cmp-text-warning)]">{d.gap.medium}</b></div>
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-information)]" />Not Yet Assessed</span><b className="tabular-nums text-gray-600">{d.gap.low}</b></div>
            <div className="border-t border-gray-100 pt-2 flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)]" />Closed This Month</span><b className="tabular-nums text-[var(--cmp-text-success)]">{d.gap.closedThisMonth}</b></div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Survey Readiness</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0" style={{ background: `conic-gradient(#10b981 ${(d.surveyReadiness ?? 0) * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}><div className="absolute inset-[18%] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900">{d.surveyReadiness != null ? `${d.surveyReadiness}%` : "—"}</span><span className="text-[8px] text-gray-400">Ready</span></div></div>
            <div className="text-[11px] space-y-1 flex-1 min-w-0">{d.readinessChecklist.map((c: any) => <div key={c.label} className="flex items-center gap-1.5"><span className={c.pct != null ? "text-emerald-500" : "text-gray-300"}>{c.pct != null ? "✓" : "○"}</span><span className="text-gray-600 flex-1 truncate">{c.label}</span><b className={`tabular-nums ${c.pct != null ? "text-gray-700" : "text-gray-300"}`}>{c.pct != null ? `${c.pct}%` : "—"}</b></div>)}</div>
          </div>
          <p className="text-[9px] text-gray-400 mt-2">Policies / training completeness need policy &amp; learning linkage (next-phase).</p>
        </div>
      </div>

      {/* ── Calendar · quick access · AI insights ──────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Accreditation Calendar</h3>
          {d.calendar.length ? <div className="space-y-2">{d.calendar.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs"><div className="w-10 shrink-0 text-center"><p className="text-[9px] text-gray-400 uppercase">{monthAbbr(c.date)}</p><p className="text-sm font-bold text-gray-700 leading-none">{(c.date ?? "").slice(8, 10)}</p></div><div className="min-w-0 flex-1"><p className="text-gray-700 truncate">{c.title}</p><p className="text-[10px] text-gray-400 capitalize truncate">{c.type}</p></div><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${c.status === "overdue" ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : c.dueSoon ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]"}`}>{c.status === "overdue" ? "Overdue" : c.dueSoon ? "Due Soon" : "Scheduled"}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No scheduled surveys or obligations.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Quick Access</h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{QUICK.map(q => (
            <Link key={q.label} href="/quality-accreditation" className="rounded-lg border border-gray-100 p-2 hover:border-teal-200 hover:bg-teal-50/40 transition-all text-center"><span className={`w-8 h-8 rounded-lg ${q.tint} flex items-center justify-center text-sm mx-auto mb-1`}>{q.icon}</span><p className="text-[9px] font-medium text-gray-700 leading-tight">{q.label}</p></Link>
          ))}</div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span><h3 className="font-semibold text-gray-900 text-sm">AI Accreditation Insights</h3></div>
          {d.ai.length ? <div className="space-y-2">{d.ai.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.tone === "rose" ? "bg-[var(--cmp-color-error)]" : a.tone === "amber" ? "bg-[var(--cmp-color-warning)]" : a.tone === "sky" ? "bg-[var(--cmp-color-information)]" : "bg-[var(--cmp-color-success)]"}`} /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 leading-snug">{a.text}</p><p className="text-[10px] text-gray-400 truncate">{a.detail}</p></div><span className="text-[10px] text-gray-400 shrink-0">conf {a.confidence}%</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No accreditation signals to action right now.</p>}
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-gray-400 pb-4">
        <span>Data sources: Audit &amp; Compliance · CAPA &amp; Improvement · Incident Management · Risk Register · Clinical Indicators · Learning &amp; Competency</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)]" /> Enterprise accreditation programme · consolidation over gov_standard_assessments (migration 061)</span>
      </div>
    </div>
  );
}
