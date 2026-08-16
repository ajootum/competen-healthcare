import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import DevTabs from "../DevTabs";
import { Kpi } from "../../_kit";
import { estateRolesOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Competency Coverage (UMW-WFM-007 §12) — required vs validated coverage + dependency analysis
// (single-person dependency, no coverage) over the Competency system. Real. Critical competency
// coverage considers actual availability, not only qualified headcount (BR-WDR-015).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const COV = (pct: number | null, total: number, current: number) => current === 0 ? { label: "No validated coverage", tone: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" } : current === 1 ? { label: "Covered but concentrated", tone: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" } : (pct ?? 0) >= 90 ? { label: "Fully covered", tone: "bg-[var(--cmp-surface-success)] text-emerald-700" } : (pct ?? 0) >= 60 ? { label: "Marginal coverage", tone: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" } : { label: "Gap exists", tone: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" };
const SKILL_TONE: Record<string, string> = { Current: "bg-[var(--cmp-color-success)]", Expiring: "bg-[var(--cmp-color-warning)]", Expired: "bg-[var(--cmp-color-error)]", None: "bg-gray-300" };

export default async function CompetencyCoverage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceReadiness(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Development &amp; Readiness · Competency Coverage</h1><p className="text-sm text-gray-500">Required vs validated coverage, and dependency concentration.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const skillTotal = d.skillMix.reduce((n: number, s: any) => n + s.n, 0) || 1;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Roles covered" value={d.roleCoverage.filter((r: any) => r.current >= 2).length} tone="text-[var(--cmp-text-success)]" />
        <Kpi label="No coverage" value={d.noCoverage.length} tone={d.noCoverage.length ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Single-person dependency" value={d.singleDep.length} tone={d.singleDep.length ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Match score" value={d.kpis.matchScore != null ? `${d.kpis.matchScore}%` : "—"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Coverage matrix */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Coverage matrix <span className="text-[10px] text-gray-400 font-normal">by role</span></h3>
          {d.roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No competency data.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Total</th><th className="py-2 pr-3 font-medium text-right">Competent</th><th className="py-2 pr-3 font-medium text-right">Coverage</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{d.roleCoverage.map((r: any) => { const c = COV(r.pct, r.total, r.current); return (<tr key={r.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.label}</td><td className="py-2 pr-3 text-right text-gray-600">{r.total}</td><td className="py-2 pr-3 text-right text-gray-700 font-semibold">{r.current}</td><td className="py-2 pr-3 text-right">{r.pct != null ? `${r.pct}%` : "—"}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${c.tone}`}>{c.label}</span></td></tr>); })}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Coverage considers actual currency, not only qualified headcount (BR-WDR-015). Per-competency (not just per-role) coverage needs the unit competency requirement matrix → next-phase.</p>
        </div>

        {/* Dependency + skill mix */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Dependency risk <span className="text-[10px] text-gray-400 font-normal">§12.3</span></h3>
            {d.noCoverage.length === 0 && d.singleDep.length === 0 ? <p className="text-sm text-gray-400">No single-person dependencies. 🎉</p> : <div className="space-y-1.5">{[...d.noCoverage.map((r: any) => ({ ...r, kind: "No coverage" })), ...d.singleDep.map((r: any) => ({ ...r, kind: "Single-person" }))].map((r: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 p-2"><span className="text-gray-700">{r.label}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${r.kind === "No coverage" ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>{r.kind}</span></div>))}</div>}
            <p className="text-[10px] text-gray-400 mt-2">Single-person dependency is a key workforce risk (BR-WDR-016) — cross-train to reduce concentration.</p>
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Competency currency mix</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-2">{d.skillMix.map((s: any) => (<div key={s.label} className={SKILL_TONE[s.label]} style={{ width: `${(s.n / skillTotal) * 100}%` }} title={`${s.label}: ${s.n}`} />))}</div>
            <div className="space-y-1">{d.skillMix.map((s: any) => (<div key={s.label} className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${SKILL_TONE[s.label]}`} />{s.label}</span><span className="font-semibold text-gray-700">{s.n}</span></div>))}</div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Competency Coverage (UMW-WFM-007 §12) over competency_decisions. <Link href="/unit-manager/workforce-management/development" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
