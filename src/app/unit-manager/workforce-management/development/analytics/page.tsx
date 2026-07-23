import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import DevTabs from "../DevTabs";

export const dynamic = "force-dynamic";

// Analytics & Reports (UMW-WFM-007 §31) — real readiness indicators (deployable rate, critical
// coverage, supervision dependency, critical-skill concentration) over the Competency system.
// Trend history + learning-impact/time-to-readiness reports need learning + assessment stores →
// honest next-phase. Readiness data supports development + safe deployment, not staff ranking.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const REPORTS = ["Unit readiness", "Competency coverage", "Critical competency gap", "Mandatory learning compliance", "Overdue learning", "Credential expiry", "Orientation progress", "Supervision requirement", "Staff deployability", "Development-plan status", "Assessment backlog", "Cross-training pipeline", "Succession readiness", "Critical-role dependency", "Readiness exception", "Learning impact", "Time-to-readiness", "Data completeness"];

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function DevAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceReadiness(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Development &amp; Readiness · Analytics</h1><p className="text-sm text-gray-500">Readiness indicators and standard reports.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const k = d.kpis;
  const deployableRate = k.total ? Math.round((k.fullyDeployable / k.total) * 100) : null;
  const supervisionDep = k.total ? Math.round((k.requiringSupervision / k.total) * 100) : null;
  const totalRoles = d.roleCoverage.length || 1;
  const criticalCoverage = Math.round(((totalRoles - d.noCoverage.length) / totalRoles) * 100);
  const concentration = Math.round(((d.noCoverage.length + d.singleDep.length) / totalRoles) * 100);

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Fully deployable rate" value={deployableRate != null ? `${deployableRate}%` : "—"} sub="Deployable ÷ active" tone={deployableRate != null && deployableRate >= 80 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Critical coverage" value={`${criticalCoverage}%`} sub="Roles with coverage" tone={criticalCoverage >= 90 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Credential currency" value={k.matchScore != null ? `${k.matchScore}%` : "—"} sub="Current ÷ required" />
        <Kpi label="Supervision dependency" value={supervisionDep != null ? `${supervisionDep}%` : "—"} sub="Requiring supervision" tone={supervisionDep && supervisionDep > 25 ? "text-amber-600" : undefined} />
        <Kpi label="Critical-skill concentration" value={`${concentration}%`} sub="Single/no-dep roles" tone={concentration ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Expired credentials" value={k.credentialsExpired} tone={k.credentialsExpired ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Indicators <span className="text-[10px] text-gray-400 font-normal">§31.2 · point-in-time</span></h3>
          <p className="text-[11px] text-gray-500">Deployable rate, critical coverage, credential currency, supervision dependency and critical-skill concentration are real over the Competency system. Mandatory-learning compliance, orientation completion, development-action completion, assessment backlog, time-to-readiness and learning impact need learning + assessment + development stores → next-phase.</p>
          <p className="text-[10px] text-gray-400 mt-2">Readiness data supports development + safe deployment, not public staff ranking (§29). Predictive scores never replace validated assessment (BR-WDR-014).</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Standard reports <span className="text-[10px] text-gray-400 font-normal">§31.1</span></h3>
          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto pr-1">{REPORTS.map(r => (<div key={r} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1"><span className="text-[10px] text-gray-700">{r}</span><span className="text-[8px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">Soon</span></div>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Analytics &amp; Reports (UMW-WFM-007 §31). Point-in-time readiness rates are real; trend reports + exports are next-phase. <Link href="/unit-manager/workforce-management/development" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
