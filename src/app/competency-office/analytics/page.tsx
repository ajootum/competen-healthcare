import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAnalyticsHub } from "@/lib/analytics-hub";

export const dynamic = "force-dynamic";

// Competency Analytics (CMO-006) — the enterprise competency-intelligence hub. Aggregates readiness,
// compliance, assessment, credential and workforce metrics computed across the CMO modules. Real:
// the cross-domain KPIs, competency heatmap by unit, readiness by domain, the enterprise readiness
// trend (from daily snapshots) and rule-based explainable AI forecast. Honest next-phase: benchmarking
// (needs a peer/enterprise comparison dataset), radar/forecast charts and configurable saved reports.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const cellTone = (n: number) => (n >= 90 ? "bg-emerald-500" : n >= 80 ? "bg-amber-400" : n >= 70 ? "bg-orange-400" : "bg-rose-500");
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </Link>
  );
}

function Line({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2) return <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center"><p className="text-xs text-gray-400">Enterprise readiness trend builds from daily snapshots — appears once ≥2 days are recorded (per-hospital).</p></div>;
  const w = 300, h = 90, max = Math.max(...series), min = Math.min(...series), range = (max - min) || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / range) * (h - 10) - 5}`).join(" ");
  return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" /></svg>;
}

export default async function CompetencyAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadAnalyticsHub(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><h1 className="text-2xl font-bold text-gray-900">Competency Analytics</h1><p className="text-sm text-gray-500">Enterprise competency intelligence — operational, executive and predictive, drill-down to individual.</p></div>
      <span className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-400">☰ Filters</span>
    </div>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Competency analytics activate once competency decisions are recorded for this tenant.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Overall Readiness" value={`${d.readiness}%`} tone={pctTone(d.readiness)} sub="enterprise→unit" href="/competency-office" />
        <Kpi icon="✔️" tint="bg-teal-50" label="Compliance Rate" value={`${d.compliance}%`} tone={pctTone(d.compliance)} sub="mandatory" href="/competency-office/compliance" />
        <Kpi icon="📝" tint="bg-sky-50" label="Assessment Success" value={d.assessmentSuccess != null ? `${d.assessmentSuccess}%` : "—"} tone={d.assessmentSuccess != null ? pctTone(d.assessmentSuccess) : "text-gray-300"} sub={d.assessmentSuccess != null ? "pass rate" : "no scored data"} href="/competency-office/assessments" />
        <Kpi icon="🎓" tint="bg-violet-50" label="Credential Validity" value={d.credentialValidity != null ? `${d.credentialValidity}%` : "—"} tone={d.credentialValidity != null ? pctTone(d.credentialValidity) : "text-gray-300"} sub={d.credentialValidity != null ? "valid" : "no credentials"} href="/competency-office/credentialing" />
        <Kpi icon="⚠️" tint="bg-rose-50" label="High-Risk Units" value={d.highRiskUnits.length} tone={d.highRiskUnits.length ? "text-rose-600" : "text-gray-400"} sub="below threshold" href="/competency-office/readiness" />
        <Kpi icon="📊" tint="bg-gray-50" label="Benchmark Score" value="—" tone="text-gray-300" sub="peer dataset next-phase" href="/competency-office/analytics" />
      </div>

      {/* Heatmap + domain + trend */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Competency Heatmap <span className="text-[10px] font-normal text-gray-400">by unit</span></h3>
          {d.heatmap.length === 0 ? <p className="text-sm text-gray-400">No unit readiness data yet.</p> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{d.heatmap.slice(0, 9).map((u: any) => (<div key={u.id} className={`rounded-lg p-2.5 text-white ${cellTone(u.pct)}`}><p className="text-[10px] font-medium truncate opacity-90">{u.name}</p><p className="text-lg font-bold tabular-nums">{u.pct}%</p></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Readiness by Domain</h3>
          {d.domains.length === 0 ? <p className="text-sm text-gray-400">Domain mapping needed.</p> : (
            <div className="space-y-2">{d.domains.map((dom: any) => (<div key={dom.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{dom.name}</span><span className={`tabular-nums font-semibold ${pctTone(dom.pct)}`}>{dom.pct}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${cellTone(dom.pct)}`} style={{ width: `${dom.pct}%` }} /></div></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Readiness Trend</h3><span className="text-[10px] text-gray-400">daily snapshots</span></div>
          <Line series={d.trends?.readiness?.series ?? []} color="#10b981" />
        </div>
      </div>

      {/* High-risk + AI forecast */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Matrix <span className="text-[10px] font-normal text-gray-400">units below threshold</span></h3>
          {d.highRiskUnits.length === 0 ? <p className="text-sm text-gray-400">No high-risk units. 🎉</p> : (
            <div className="space-y-1.5">{d.highRiskUnits.slice(0, 8).map((u: any) => (<div key={u.id} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{u.name}</span><span className="flex items-center gap-2"><span className="text-rose-600 font-semibold tabular-nums">{u.pct}%</span><span className="text-gray-400">({u.current}/{u.total})</span></span></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5 bg-gradient-to-br from-teal-50/40 to-white`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">✨ AI Risk Forecast <span className="text-[10px] font-normal text-gray-400">explainable</span></h3>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority forecast actions.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 4).map((a: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.priority === "high" ? "bg-rose-50 text-rose-700" : a.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>))}</div>
          )}
        </div>
      </div>

      {/* Analytics modules + benchmark */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Analytics Modules</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {d.modules.map((m: any) => (<Link key={m.name} href={m.href} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors"><span className="truncate">{m.name}</span><span className="text-gray-300">→</span></Link>))}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Benchmarking</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">📊</p><p className="text-xs text-gray-500">Organisation comparison against peers/enterprise needs a benchmark dataset.</p><p className="text-[10px] text-gray-400 mt-1">Honest next-phase.</p></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Competency Analytics (CMO-006) aggregates the metrics computed across the CMO modules (competency_decisions + assessments + professional_credentials + framework governance). Real: cross-domain KPIs (readiness, compliance, assessment success, credential validity), competency heatmap by unit, readiness by domain, the enterprise readiness trend (daily snapshots, migration 088) and rule-based explainable AI forecast. Honest next-phase: benchmarking (needs a peer comparison dataset), radar/forecast charts, individual drill-down and configurable saved reports/exports. Every value is live or an honest state. Source: competency analytics services; calculated {todayLabel()}.</p>
    </div>
  );
}
