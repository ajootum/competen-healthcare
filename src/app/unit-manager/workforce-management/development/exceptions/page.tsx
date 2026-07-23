import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import DevTabs from "../DevTabs";

export const dynamic = "force-dynamic";

// Readiness Exceptions (UMW-WFM-007 §20) — connects development/readiness gaps to
// UMW-WFM-006. Derived live from the readiness risk engine over competency data; the stateful
// exception lifecycle + approval routing is owned by Exceptions & Approvals (BR-WDR-012).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", moderate: "bg-sky-50 text-sky-700" };
const DOT: Record<string, string> = { critical: "bg-rose-500", high: "bg-amber-500", moderate: "bg-sky-500" };

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function ReadinessExceptions() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Development &amp; Readiness · Readiness Exceptions</h1><p className="text-sm text-gray-500">Development and readiness gaps requiring action.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const critical = d.risks.filter((r: any) => r.severity === "critical").length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Readiness exceptions" value={d.risks.length} tone={d.risks.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical" value={critical} tone={critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Expired credentials" value={d.kpis.credentialsExpired} tone={d.kpis.credentialsExpired ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Single-person deps" value={d.singleDep.length} tone={d.singleDep.length ? "text-amber-600" : "text-emerald-600"} />
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
