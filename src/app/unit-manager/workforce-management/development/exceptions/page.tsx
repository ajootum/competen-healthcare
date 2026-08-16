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

// Readiness Exceptions (UMW-WFM-007 §20) — connects development/readiness gaps to
// UMW-WFM-006. Derived live from the readiness risk engine over competency data; the stateful
// exception lifecycle + approval routing is owned by Exceptions & Approvals (BR-WDR-012).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { critical: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", high: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", moderate: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" };
const DOT: Record<string, string> = { critical: "bg-[var(--cmp-color-error)]", high: "bg-[var(--cmp-color-warning)]", moderate: "bg-[var(--cmp-color-information)]" };

export default async function ReadinessExceptions() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Development &amp; Readiness · Readiness Exceptions</h1><p className="text-sm text-gray-500">Development and readiness gaps requiring action.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const critical = d.risks.filter((r: any) => r.severity === "critical").length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Readiness exceptions" value={d.risks.length} tone={d.risks.length ? "text-gray-900" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Critical" value={critical} tone={critical ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Expired credentials" value={d.kpis.credentialsExpired} tone={d.kpis.credentialsExpired ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Single-person deps" value={d.singleDep.length} tone={d.singleDep.length ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Readiness exception register <span className="text-[10px] text-gray-400 font-normal">derived · critical first</span></h3>
        {d.risks.length === 0 ? <p className="text-sm text-gray-400">No readiness exceptions — the workforce is ready. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Exception</th><th className="py-2 pr-3 font-medium">Detail</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 font-medium">Recommended action</th></tr></thead>
            <tbody>{d.risks.map((r: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{r.title}</td><td className="py-2 pr-3 text-gray-500">{r.detail}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[r.severity]}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.severity]}`}>{r.severity}</span></span></td><td className="py-2 text-gray-500">{r.action}</td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Detection is live over the readiness risk engine (competency coverage, dependency, credential expiry). Readiness exceptions requiring approval (supervised-practice, learning waiver, credential exception, role-expansion) route through <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">Exceptions &amp; Approvals</Link> (UMW-WFM-006 / BR-WDR-012).</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Readiness Exceptions (UMW-WFM-007 §20) derived over competency data; the stateful lifecycle is owned by UMW-WFM-006. <Link href="/unit-manager/workforce-management/development" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
