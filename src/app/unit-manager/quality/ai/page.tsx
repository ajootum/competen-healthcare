import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadQualityCommand } from "@/lib/operations/quality-command";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, riskCellTone, NextPhase } from "../widgets";

export const dynamic = "force-dynamic";

// AI Quality Intelligence (UMG-QS-011) — the dedicated surface for the explainable, rule-based quality
// recommendations generated from the live incident / audit / CAPA / risk state (loadQualityCommand). Real:
// the prioritised recommendations (each with a "why" and a deep link) and the signals feeding them (top
// risks, alerts, key metrics). Honest next-phase: PREDICTIVE analytics (incident-probability forecasting,
// audit-gap prediction) — these need a persisted analytics-snapshot history and models, not yet available.
/* eslint-disable @typescript-eslint/no-explicit-any */
const prTone: Record<string, string> = { high: "border-rose-200 bg-rose-50/40", medium: "border-amber-200 bg-amber-50/40", low: "border-emerald-200 bg-emerald-50/40" };
const prDot: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-400", low: "bg-emerald-500" };

export default async function AiQualityIntelligence() {
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
    loadQualityCommand(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-011" title="AI Quality Intelligence" subtitle="Explainable quality recommendations from live safety state" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No quality signals yet</p><p className="text-sm text-amber-800 mt-1">Recommendations are generated from live incident, audit, CAPA and risk state.</p></div></div>;

  const ai = d.ai ?? [], k = d.kpis;
  const byPr = (p: string) => ai.filter((a: any) => a.priority === p);

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon="🤖" tint="bg-violet-50" label="Recommendations" value={ai.length} sub="explainable" />
        <Kpi icon="🔴" tint="bg-rose-50" label="High Priority" value={byPr("high").length} tone={byPr("high").length ? "text-rose-600" : "text-gray-400"} sub="act now" />
        <Kpi icon="⚠️" tint="bg-orange-50" label="Open Risk Signals" value={d.risks.high} tone={d.risks.high ? "text-orange-600" : "text-gray-400"} sub="high risks" />
        <Kpi icon="🔔" tint="bg-amber-50" label="Active Alerts" value={d.alerts.length} sub="quality/safety" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5 xl:col-span-2`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span><h3 className="font-semibold text-gray-900 text-sm">Recommended Actions</h3><span className="text-[10px] text-gray-400">rule-based · explainable</span></div>
          {ai.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{ai.map((a: any, i: number) => (
              <Link key={i} href={a.href} className={`block rounded-lg border p-3 hover:shadow-sm transition-shadow ${prTone[a.priority] ?? "border-gray-200"}`}>
                <div className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${prDot[a.priority] ?? "bg-gray-300"}`} />
                  <div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-snug">{a.text}</p><p className="text-[10px] text-gray-500 mt-1">{a.why}</p><span className="inline-block mt-1.5 text-[10px] font-semibold text-violet-700">{a.action} →</span></div>
                </div>
              </Link>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No quality signals to action right now — the unit is in good standing. 🎉</p>}
        </div>

        <div className="space-y-4">
          <div className={`${qcard} p-5`}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Top Risk Signals</h3>
            {d.risks.top.length ? <div className="space-y-1.5">{d.risks.top.slice(0, 5).map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs"><span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${riskCellTone(r.score)}`}>{r.score}</span><span className="text-gray-700 truncate flex-1">{r.title}</span></div>
            ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No open risks.</p>}
          </div>
          <div className={`${qcard} p-5`}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Quality Signals</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">Critical incidents</span><b className={`tabular-nums ${k.criticalIncidents ? "text-rose-600" : "text-gray-800"}`}>{k.criticalIncidents}</b></div>
              <div className="flex justify-between"><span className="text-gray-600">Open CAPAs</span><b className="tabular-nums text-gray-800">{k.openCapa}</b></div>
              <div className="flex justify-between"><span className="text-gray-600">Audit compliance</span><b className="tabular-nums text-gray-800">{k.complianceScore != null ? `${k.complianceScore}%` : "—"}</b></div>
              <div className="flex justify-between"><span className="text-gray-600">High risks</span><b className={`tabular-nums ${k.highRisks ? "text-orange-600" : "text-gray-800"}`}>{k.highRisks}</b></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-violet-900">🔮 Predictive analytics — next phase</p>
        <p className="text-xs text-violet-700 mt-0.5">The current recommendations are explainable and rule-based from live state. Predictive intelligence — incident-probability forecasting, audit-gap prediction and readiness projection — needs a persisted analytics-snapshot history and trained models; it is honestly deferred rather than simulated.</p>
      </div>

      <NextPhase>AI Quality Intelligence (UMG-QS-011) over the live quality state (loadQualityCommand). Real: the prioritised, explainable rule-based recommendations (each with a rationale and a deep link) and the signals feeding them — top risks, alerts and key quality metrics. Honest next-phase: predictive analytics (incident-probability forecasting, audit-gap prediction), which need a persisted analytics-snapshot history and models. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
