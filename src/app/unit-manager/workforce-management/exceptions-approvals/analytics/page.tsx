import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import WfmExcTabs from "../WfmExcTabs";

export const dynamic = "force-dynamic";

// Analytics & Reports (UMW-WFM-006 §31) — real indicators over approval_requests + the exception
// register (rejection rate, overdue rate, escalation rate, conditional/retrospective). Trend
// history + formatted report export need a reporting store → honest next-phase. §21.3-style
// safeguards apply (no misconduct inference, no medical detail).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const REPORTS = ["Open exceptions", "Approval queue", "Overdue approvals", "Staffing exceptions", "Roster-change approvals", "Overtime approvals", "Attendance correction", "Redeployment approvals", "Agency staffing", "Competency exception", "Emergency action", "Retrospective approval", "Approval turnaround", "Rejection reasons", "Financial exposure", "Approval by authority level", "Repeat exception", "Policy exception trend"];

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function AnalyticsReports() {
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

  const appr = d.approvals as any[];
  const decided = appr.filter(a => ["approved", "rejected"].includes(a.status));
  const rejected = appr.filter(a => a.status === "rejected").length;
  const escalated = appr.filter(a => a.status === "escalated").length;
  const rejectionRate = decided.length ? Math.round((rejected / decided.length) * 100) : null;
  const overdueRate = d.openApprovals.length ? Math.round((d.kpis.overdue / d.openApprovals.length) * 100) : null;
  const escalationRate = appr.length ? Math.round((escalated / appr.length) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exceptions &amp; Approvals · Analytics</h1><p className="text-sm text-gray-500">Workforce governance indicators and standard reports.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Rejection rate" value={rejectionRate != null ? `${rejectionRate}%` : "—"} sub="Rejected ÷ decided" tone={rejectionRate != null && rejectionRate > 25 ? "text-amber-600" : undefined} />
        <Kpi label="Overdue rate" value={overdueRate != null ? `${overdueRate}%` : "—"} sub="Overdue ÷ open" tone={overdueRate ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Escalation rate" value={escalationRate != null ? `${escalationRate}%` : "—"} sub="Escalated ÷ all" tone={escalationRate ? "text-orange-600" : undefined} />
        <Kpi label="Open exceptions" value={d.kpis.exceptionCount} />
        <Kpi label="Decided" value={decided.length} sub="Approved / rejected" />
        <Kpi label="Critical" value={d.kpis.critical} tone={d.kpis.critical ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Indicators <span className="text-[10px] text-gray-400 font-normal">§31.2 · point-in-time</span></h3>
          <p className="text-[11px] text-gray-500">Rejection, overdue and escalation rates are real over approval_requests. Approval turnaround time, first-level resolution, retrospective and emergency-override rates, and repeated/avoidable-exception rates need decision-timestamp history + an emergency register → next-phase.</p>
          <p className="text-[10px] text-gray-400 mt-2">Analytics must not infer misconduct, expose medical detail or rank staff publicly (§21.3-style safeguards).</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Standard reports <span className="text-[10px] text-gray-400 font-normal">§31.1</span></h3>
          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto pr-1">{REPORTS.map(r => (<div key={r} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1"><span className="text-[10px] text-gray-700">{r}</span><span className="text-[8px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">Soon</span></div>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Analytics &amp; Reports (UMW-WFM-006 §31). Point-in-time rates are real; trend reports + exports are next-phase. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
