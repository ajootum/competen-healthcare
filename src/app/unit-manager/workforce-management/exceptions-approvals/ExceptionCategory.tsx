import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import WfmExcTabs from "./WfmExcTabs";

export const dynamic = "force-dynamic";

// Shared category view (UMW-WFM-006 §13-18) — renders a filtered slice of the aggregated
// workforce exceptions + approval requests. exTabs=null shows all exception sources; apprCats=
// null shows all workforce approvals; [] shows none of that kind. Keeps the category tabs DRY.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", moderate: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-500" };
const DOT: Record<string, string> = { critical: "bg-rose-500", high: "bg-amber-500", moderate: "bg-sky-500", low: "bg-gray-400" };
const PRI: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", medium: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-500" };

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function ExceptionCategory({ title, subtitle, exTabs, apprCats, note }: { title: string; subtitle: string; exTabs: string[] | null; apprCats: string[] | null; note?: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceExceptions(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const exceptions = exTabs === null ? d.exceptions : d.exceptions.filter((e: any) => exTabs.includes(e.tab));
  const approvals = apprCats === null ? d.openApprovals : d.openApprovals.filter((a: any) => apprCats.includes(a.category));
  const critical = exceptions.filter((e: any) => e.severity === "critical").length + approvals.filter((a: any) => a.priority === "critical").length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1><p className="text-sm text-gray-500">{subtitle}</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Exceptions" value={exceptions.length} tone={exceptions.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Approvals" value={approvals.length} tone={approvals.length ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Critical" value={critical} tone={critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Total open" value={exceptions.length + approvals.length} />
      </div>

      {(exTabs === null || exTabs.length > 0) && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exceptions <span className="text-[10px] text-gray-400 font-normal">critical first</span></h3>
          {exceptions.length === 0 ? <p className="text-sm text-gray-400">No exceptions in this category. 🎉</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Exception</th><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Detail</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{exceptions.map((e: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-500">{e.source}</td><td className="py-2 pr-3 text-gray-800 capitalize">{e.title}</td><td className="py-2 pr-3 text-gray-500">{e.staff ?? "—"}</td><td className="py-2 pr-3 text-gray-500 truncate max-w-[160px]">{e.detail ?? "—"}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[e.severity] ?? "bg-gray-400"}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[e.severity] ?? "bg-gray-100 text-gray-500"}`}>{e.severity}</span></span></td><td className="py-2 text-gray-500 capitalize">{(e.status ?? "").replace(/_/g, " ")}</td></tr>))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {(apprCats === null || apprCats.length > 0) && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Approval requests <span className="text-[10px] text-gray-400 font-normal">open</span></h3>
          {approvals.length === 0 ? <p className="text-sm text-gray-400">No open approval requests in this category.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Request</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Requester</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{approvals.map((a: any) => (<tr key={a.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{a.title}</td><td className="py-2 pr-3 text-gray-500 capitalize">{a.category}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${PRI[a.priority] ?? PRI.medium}`}>{a.priority}</span></td><td className="py-2 pr-3 text-gray-500">{a.requester_name ?? "—"}</td><td className="py-2 text-gray-500 capitalize">{(a.status ?? "").replace(/_/g, " ")}</td></tr>))}</tbody>
            </table></div>
          )}
          <Link href="/unit-manager/workforce-management/exceptions-approvals/queue" className="mt-2 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Decide in My Approval Queue →</Link>
        </div>
      )}

      {note && <p className="text-[11px] text-gray-400 pb-1">{note}</p>}
      <p className="text-[11px] text-gray-400 pb-4">Aggregated over approval_requests + the workforce exception stores. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
