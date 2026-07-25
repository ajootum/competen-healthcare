import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadQualityCommand } from "@/lib/operations/quality-command";
import { loadClinicalIndicators } from "@/lib/operations/clinical-indicators";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, StackedTrend, TrendLegend, Pipe, NextPhase } from "../widgets";

export const dynamic = "force-dynamic";

// Quality Analytics (UMG-QS-010) — the analytics cut across the quality domains, composing loadQualityCommand
// (incidents / audits / CAPA / risk) with loadClinicalIndicators (indicator attainment). Real: the KPI
// summary, the incident trend by severity, CAPA effectiveness, audit-compliance and risk-profile breakdowns
// and indicator attainment. Honest next-phase: the 12-month composite quality trend and peer benchmarking,
// which need a persisted analytics-snapshot history (§7). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TREND_META = [
  { key: "critical", label: "Critical", color: "#ef4444" },
  { key: "major", label: "Major", color: "#f59e0b" },
  { key: "moderate", label: "Moderate", color: "#eab308" },
  { key: "minor", label: "Minor", color: "#22c55e" },
  { key: "nearMiss", label: "Near Miss", color: "#14b8a6" },
];
const pctTone = (p: number | null) => (p == null ? "text-gray-300" : p >= 85 ? "text-emerald-600" : p >= 70 ? "text-amber-600" : "text-rose-600");

export default async function QualityAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, ind, departments] = await Promise.all([
    loadQualityCommand(admin, hid, isSuper) as Promise<any>,
    loadClinicalIndicators(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-010" title="Quality Analytics" subtitle="Cross-domain quality analytics and performance breakdowns" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No quality data yet</p><p className="text-sm text-amber-800 mt-1">Analytics populate once incidents, audits, CAPA or risks exist.</p></div></div>;

  const k = d.kpis, inc = d.incidents, au = d.audits, capa = d.capa, risk = d.risks;
  const capaEff = capa.total ? Math.round((capa.completed / capa.total) * 100) : null;
  const indKpis = ind?.kpis;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="⭐" tint="bg-sky-50" label="Quality Score" value={k.qualityScore != null ? `${k.qualityScore}%` : "—"} tone={pctTone(k.qualityScore)} sub="composite" />
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Safety Index" value={k.safetyIndex != null ? `${k.safetyIndex}%` : "—"} tone={pctTone(k.safetyIndex)} sub="composite" />
        <Kpi icon="📋" tint="bg-indigo-50" label="Audit Compliance" value={au.avgCompliance != null ? `${au.avgCompliance}%` : "—"} tone={pctTone(au.avgCompliance)} sub={`${au.completed} audits`} />
        <Kpi icon="🗂️" tint="bg-amber-50" label="CAPA Effectiveness" value={capaEff != null ? `${capaEff}%` : "—"} tone={pctTone(capaEff)} sub={`${capa.completed}/${capa.total} closed`} />
        <Kpi icon="⚠️" tint="bg-orange-50" label="High Risks" value={risk.high} tone={risk.high ? "text-orange-600" : "text-gray-400"} sub={`of ${risk.total}`} />
        <Kpi icon="📈" tint="bg-teal-50" label="Indicators On Target" value={indKpis ? `${indKpis.onTarget}/${indKpis.total}` : "—"} sub={indKpis && indKpis.atEscalation ? `${indKpis.atEscalation} at escalation` : "RAG"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5 xl:col-span-2`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Incident Trend <span className="text-[10px] text-gray-400 font-normal">6 months · by severity</span></h3>
          {inc.provisioned ? <><StackedTrend months={inc.trend.months} series={inc.trend.series} meta={TREND_META} /><TrendLegend meta={TREND_META} totals={inc.totals} /></> : <p className="text-sm text-gray-400 py-10 text-center">Incident register not provisioned.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">CAPA Flow</h3>
          {capa.provisioned && capa.total > 0 ? <div className="space-y-2">
            <Pipe label="Open" n={capa.open} total={capa.total} color="#3b82f6" />
            <Pipe label="In progress" n={capa.inProgress} total={capa.total} color="#10b981" />
            <Pipe label="Overdue" n={capa.overdue} total={capa.total} color="#ef4444" />
            <Pipe label="Completed" n={capa.completed} total={capa.total} color="#94a3b8" />
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No CAPA actions.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Incidents by Type</h3>
          {inc.provisioned && inc.byType.length ? <div className="space-y-1.5">{inc.byType.slice(0, 6).map((t: any) => (<div key={t.type} className="flex items-center justify-between text-xs"><span className="text-gray-600">{t.label}</span><b className="tabular-nums text-gray-800">{t.n}</b></div>))}</div> : <p className="text-sm text-gray-400 py-4">No incidents.</p>}
        </div>
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Risk Profile</h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-gray-600">Total open</span><b className="tabular-nums text-gray-800">{risk.total}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">High (≥15)</span><b className="tabular-nums text-orange-600">{risk.high}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Top score</span><b className="tabular-nums text-rose-600">{risk.top[0]?.score ?? 0}</b></div>
          </div>
        </div>
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Audit Summary</h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-gray-600">Completed</span><b className="tabular-nums text-gray-800">{au.completed}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Pending</span><b className="tabular-nums text-amber-600">{au.pending}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Open findings</span><b className="tabular-nums text-rose-600">{au.findingsOpen}</b></div>
          </div>
        </div>
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Indicator RAG</h3>
          {indKpis ? <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-gray-600">On target</span><b className="tabular-nums text-emerald-600">{indKpis.onTarget}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Watch</span><b className="tabular-nums text-amber-600">{indKpis.warning}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">At escalation</span><b className="tabular-nums text-rose-600">{indKpis.atEscalation}</b></div>
          </div> : <p className="text-sm text-gray-400 py-4">No indicators.</p>}
        </div>
      </div>

      <NextPhase>Quality Analytics (UMG-QS-010) composes the live quality domains — incidents, audits, CAPA and risk (loadQualityCommand) with clinical-indicator attainment (quality_indicators). Real: the KPI summary, incident trend by severity, CAPA flow, incident/audit/risk breakdowns and indicator RAG. Honest next-phase: the 12-month composite quality trend and peer/national benchmarking, which need a persisted analytics-snapshot history. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
