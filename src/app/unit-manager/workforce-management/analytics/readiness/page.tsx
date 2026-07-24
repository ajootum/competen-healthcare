import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Readiness & Development Analytics (UMW-WFM-008 §6.4) — role readiness, competency compliance,
// credential expiry over Workforce Development & Readiness (WFM-007). Real. Readiness trend +
// development-plan progress need history + development stores → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ReadinessAnalytics() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Readiness &amp; Development</h1><p className="text-sm text-gray-500">Role readiness, competency compliance and credential expiry.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No readiness data</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Readiness score" value={d.score != null ? d.score : "—"} sub={d.band} tone={d.band === "Ready" || d.band === "Mostly ready" ? "text-emerald-600" : "text-amber-600"} foot="WF-RDY-001" />
        <Kpi label="Fully deployable" value={k.fullyDeployable} sub={`of ${k.total}`} tone="text-emerald-600" />
        <Kpi label="Requiring supervision" value={k.requiringSupervision} tone={k.requiringSupervision ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Competency match" value={k.matchScore != null ? `${k.matchScore}%` : "—"} foot="WF-CMP-001" />
        <Kpi label="Credentials expiring" value={k.credentialsExpiring} sub={k.credentialsExpired ? `${k.credentialsExpired} expired` : "≤30d"} tone={k.credentialsExpired ? "text-rose-600" : k.credentialsExpiring ? "text-amber-600" : "text-emerald-600"} foot="WF-CMP-001" />
        <Kpi label="Critical gaps" value={k.criticalGaps} tone={k.criticalGaps ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Competency compliance by role <span className="text-[10px] text-gray-400 font-normal">WA-RD-002</span></h3>
          {d.roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No competency data.</p> : <div className="space-y-2">{d.roleCoverage.map((r: any) => (<div key={r.role} className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-28 truncate">{r.label}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(r.pct ?? 0) >= 90 ? "bg-emerald-500" : (r.pct ?? 0) >= 60 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${r.pct ?? 0}%` }} /></div><span className="text-gray-600 w-14 text-right">{r.current}/{r.total}</span></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Readiness gap drivers <span className="text-[10px] text-gray-400 font-normal">WA-RD-007</span></h3>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400">No readiness risks. 🎉</p> : <div className="space-y-1.5">{d.risks.slice(0, 6).map((r: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 p-2"><span className="text-gray-700 truncate">{r.title}</span><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${r.severity === "critical" ? "bg-rose-50 text-rose-700" : r.severity === "high" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>{r.severity}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Readiness trend + development-plan progress need history + development stores → next-phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Readiness &amp; Development (UMW-WFM-008 §6.4) over Workforce Development &amp; Readiness. <Link href="/unit-manager/workforce-management/development" className="text-emerald-700 hover:underline">Open Development &amp; Readiness ↗</Link> · <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
