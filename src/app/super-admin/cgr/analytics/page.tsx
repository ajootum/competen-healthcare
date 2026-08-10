import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceAnalytics } from "@/lib/cgr/analytics";
import { Kpi } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-016 — Competency Governance Analytics, Metrics & Continuous Improvement. The trend + improvement layer:
// governance readiness/compliance over time, maturity progression, and the ranked continuous-improvement
// opportunities from the registry gaps. Deep analytics cross-link to Performance. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const IMPACT_META: Record<string, { label: string; cls: string }> = {
  high: { label: "High", cls: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]" },
  medium: { label: "Medium", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" },
  low: { label: "Low", cls: "text-slate-600 bg-slate-50 border-slate-200" },
};
const deltaFmt = (v: number | null) => (v == null ? "—" : v > 0 ? `+${v}` : `${v}`);
const deltaTone = (v: number | null) => (v == null ? "text-gray-900" : v > 0 ? "text-[var(--cmp-text-success)]" : v < 0 ? "text-[var(--cmp-text-error)]" : "text-gray-900");

function polyline(trend: any[], key: string): string {
  if (trend.length < 2) return "";
  return trend.map((p, i) => `${((i / (trend.length - 1)) * 300).toFixed(1)},${(80 - (p[key] / 100) * 70).toFixed(1)}`).join(" ");
}

export default async function GovernanceAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadGovernanceAnalytics(admin) as any;
  const m = d.metrics;
  const hasTrend = d.trend.length >= 2;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-016 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Analytics, Metrics &amp; Continuous Improvement</h1>
          <p className="text-gray-400 text-sm mt-0.5">Is our governance system improving over time, and where should leaders focus? Governance trends, maturity progression and ranked improvement opportunities.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/performance" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Performance →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance data to analyse yet — once competencies exist and readiness snapshots accrue, trends and improvement opportunities compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Assurance score" value={m ? m.assurance : "—"} sub="/100 current" tone={m && m.assurance >= 75 ? "text-[var(--cmp-text-success)]" : m && m.assurance >= 45 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"} />
            <Kpi label="Maturity" value={d.maturity ? `L${d.maturity.num}` : "—"} sub={d.maturity ? d.maturity.label : "needs data"} tone="text-[var(--cmp-text-success)]" />
            <Kpi label="Compliance trend" value={deltaFmt(d.complianceDelta)} sub={hasTrend ? "over the series" : "needs snapshots"} tone={deltaTone(d.complianceDelta)} />
            <Kpi label="At-risk" value={m ? m.atRisk : "—"} sub="current exposure" tone={m && m.atRisk ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Improvement ops" value={d.opportunities.length} sub="opportunities" tone={d.opportunities.length ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} />
            <Kpi label="Governance activity" value={d.activity.last30} sub={`${deltaFmt(d.activity.delta)} vs prior 30d`} tone={deltaTone(d.activity.delta)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Governance trend */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Governance trend</p>
                <div className="flex gap-3 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-success)]" />Readiness {deltaFmt(d.readinessDelta)}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-information)]" />Compliance {deltaFmt(d.complianceDelta)}</span>
                </div>
              </div>
              {!hasTrend ? (
                <div className="h-24 flex items-center justify-center"><p className="text-[12px] text-gray-400">Trend needs at least two readiness snapshots. Current metrics and improvement opportunities are shown regardless.</p></div>
              ) : (
                <>
                  <svg viewBox="0 0 300 80" className="w-full h-24" preserveAspectRatio="none">
                    {[20, 40, 60].map((y) => <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="#f3f4f6" strokeWidth="0.5" />)}
                    <polyline points={polyline(d.trend, "readiness")} fill="none" stroke="#10b981" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    <polyline points={polyline(d.trend, "compliance")} fill="none" stroke="#3b82f6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <div className="flex justify-between text-[9px] text-gray-400 mt-1"><span>{d.trend[0].date}</span><span>{d.trend[d.trend.length - 1].date}</span></div>
                </>
              )}
            </div>

            {/* Maturity progression */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Maturity progression (§7)</p>
              <div className="space-y-1">
                {d.maturityModel.slice().reverse().map((lv: any) => {
                  const active = d.maturity && lv.num === d.maturity.num;
                  const reached = d.maturity && lv.num <= d.maturity.num;
                  return (
                    <div key={lv.num} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${active ? "bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)]" : ""}`}>
                      <span className={`text-[10px] font-bold rounded w-6 text-center ${reached ? "bg-[var(--cmp-color-success)] text-white" : "bg-gray-100 text-gray-400"}`}>L{lv.num}</span>
                      <span className={`text-[11px] ${active ? "font-bold text-emerald-800" : reached ? "text-gray-700" : "text-gray-400"}`}>{lv.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Continuous improvement opportunities */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Continuous improvement opportunities <span className="text-[10px] font-normal text-gray-400">— §8, ranked</span></p>
              <p className="text-[10px] text-gray-400">from the governance registry gaps</p>
            </div>
            {d.opportunities.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-[var(--cmp-text-success)] font-medium">No open improvement opportunities — governance is fully covered.</p></div>
            ) : (
              <div className="divide-y divide-gray-50">
                {d.opportunities.map((o: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[13px] font-bold text-gray-300 tabular-nums w-5">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-gray-800">{o.action}</p>
                        <p className="text-[10px] text-gray-400">{o.lever}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[13px] font-bold text-gray-700 tabular-nums">{o.count}</span>
                      <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${(IMPACT_META[o.impact] ?? IMPACT_META.low).cls}`}>{(IMPACT_META[o.impact] ?? IMPACT_META.low).label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current metrics */}
          {m && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governance metrics (§13)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {[
                  { label: "Assurance", v: `${m.assurance}` },
                  { label: "Regulatory", v: `${m.regulatory}%` },
                  { label: "Evidence", v: `${m.evidence}%` },
                  { label: "Ownership", v: `${m.ownership}%` },
                  { label: "Overdue", v: m.overdue, warn: !!m.overdue },
                  { label: "High-risk", v: m.highRisk, warn: !!m.highRisk },
                  { label: "At-risk", v: m.atRisk, warn: !!m.atRisk },
                ].map((x: any) => (
                  <div key={x.label} className="border border-gray-100 rounded-lg p-2 text-center">
                    <p className={`text-lg font-bold tabular-nums ${x.warn ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{x.v}</p>
                    <p className="text-[10px] text-gray-500">{x.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the trend is the enterprise-aggregated readiness snapshots over time, the metrics are computed live from the governance registry, and the improvement opportunities are the registry gaps ranked by impact and volume (§8 continuous improvement). Deep performance analytics and benchmarking are owned by <Link href="/super-admin/performance" className="text-[var(--cmp-text-success)] hover:underline">Competency Performance</Link>; the point-in-time governance rollup by the <Link href="/super-admin/cgr/dashboard" className="text-[var(--cmp-text-success)] hover:underline">Governance Dashboard</Link>. Per the CGR mandate, AI may identify trends and recommend priorities but never approves improvement actions or determines accountability.</p>
        </div>
      )}
    </div>
  );
}
