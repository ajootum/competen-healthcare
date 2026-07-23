import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import WfmExcTabs from "../WfmExcTabs";
import QueueActions from "./QueueActions";

export const dynamic = "force-dynamic";

// My Approval Queue (UMW-WFM-006 §10) — workforce approval requests awaiting a decision, real
// over approval_requests with audited per-row decisions (approve/reject/return/escalate) via
// the existing /api/operations/approvals API. Delegated-authority routing (who is the required
// approver) is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function MyApprovalQueue() {
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

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exceptions &amp; Approvals · My Approval Queue</h1><p className="text-sm text-gray-500">Workforce requests awaiting your decision.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />
    </>
  );

  if (!d.apprProvisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Approval store not provisioned</p><p className="text-sm text-amber-800 mt-1">Migration 077 (approval_requests) is required.</p></div></div>;

  const q = d.openApprovals;
  const overdue = q.filter((a: any) => a.due_at && d.priority.some((p: any) => p.id === a.id && p.overdue)).length;
  const critical = q.filter((a: any) => a.priority === "critical").length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="In my queue" value={q.length} tone={q.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical" value={critical} tone={critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Overdue" value={overdue} tone={overdue ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Escalated" value={q.filter((a: any) => a.status === "escalated").length} tone={q.filter((a: any) => a.status === "escalated").length ? "text-orange-600" : undefined} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Approval queue <span className="text-[10px] text-gray-400 font-normal">{q.length} awaiting decision</span></h3>
        <QueueActions rows={q} />
        <p className="text-[10px] text-gray-400 mt-2">Decisions are audited via approval_requests. A rejection records a reason (BR-EXA-007); a requester can&apos;t approve their own request (BR-EXA-003). Bulk approval, conditional approval and delegated-authority routing are next-phase. Requests also appear in <Link href="/unit-manager/approvals" className="text-emerald-700 hover:underline">Executive Actions › Approvals</Link>.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">My Approval Queue (UMW-WFM-006 §10) is real over approval_requests. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
