import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import WfmExcTabs from "./WfmExcTabs";

export const dynamic = "force-dynamic";

// Live Overview (UMW-WFM-006 §8) — operational summary of active workforce exceptions and
// approvals, aggregated across the WFM suite. Real over approval_requests + op_* exception
// stores. Cost exposure needs a workforce-cost store → honest. Every widget carries a footnote.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", moderate: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-500" };
const DOT: Record<string, string> = { critical: "bg-rose-500", high: "bg-amber-500", moderate: "bg-sky-500", low: "bg-gray-400" };
const PRI: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", medium: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-500" };
const fmtWhen = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ExceptionsApprovalsOverview() {
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
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Exceptions &amp; Approvals</h1><p className="text-sm text-gray-500">The governance layer — identify, review, approve, escalate and audit workforce deviations.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />
    </>
  );

  const k = d.kpis;
  const catTotal = d.cats.reduce((n: number, c: any) => n + c.count, 0) || 1;
  return (
    <div className="space-y-4">
      {header}

      {/* KPI cards (§8.1) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open exceptions" value={k.openExceptions} sub={`${k.exceptionCount} raised + ${k.awaitingApproval} approvals`} foot="¹" />
        <Kpi label="Awaiting approval" value={k.awaitingApproval} sub="In the queue" tone={k.awaitingApproval ? "text-amber-600" : "text-emerald-600"} foot="²" />
        <Kpi label="Critical risks" value={k.critical} sub="Safety / staffing" tone={k.critical ? "text-rose-600" : "text-emerald-600"} foot="³" />
        <Kpi label="Overdue decisions" value={k.overdue} sub="Past SLA" tone={k.overdue ? "text-rose-600" : "text-emerald-600"} foot="⁴" />
        <Kpi label="Escalated" value={k.escalated} sub="Higher review" tone={k.escalated ? "text-orange-600" : undefined} foot="⁷" />
        <Kpi label="Finance exposure" value={k.financeExposure} sub="Cost approvals" foot="⁵" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Priority decision panel (§9) */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Priority decision panel <span className="text-[9px] text-gray-300">⁸</span></h3>
          {!d.apprProvisioned ? <p className="text-sm text-gray-400">Approval store (migration 077) not provisioned.</p> : d.priority.length === 0 ? <p className="text-sm text-gray-400">No approvals awaiting a decision. 🎉</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Request</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Requester</th><th className="py-2 font-medium">Due</th></tr></thead>
              <tbody>{d.priority.map((a: any) => (<tr key={a.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{a.title}</td><td className="py-2 pr-3 text-gray-500 capitalize">{a.category}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${PRI[a.priority] ?? PRI.medium}`}>{a.priority}</span></td><td className="py-2 pr-3 text-gray-500 truncate max-w-[100px]">{a.requester_name ?? "—"}</td><td className={`py-2 ${a.overdue ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{fmtWhen(a.due_at)}{a.overdue ? " ⚠" : ""}</td></tr>))}</tbody>
            </table></div>
          )}
          <Link href="/unit-manager/workforce-management/exceptions-approvals/queue" className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Open my approval queue →</Link>
        </div>

        {/* Exception distribution (§33) */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exceptions by category</h3>
          {d.cats.length === 0 ? <p className="text-sm text-gray-400">No workforce exceptions raised.</p> : <div className="space-y-2">{d.cats.map((c: any) => (<div key={c.category} className="flex items-center gap-3 text-xs"><span className="text-gray-600 w-32 truncate">{c.category}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(c.count / catTotal) * 100}%` }} /></div><span className="font-semibold text-gray-700 w-6 text-right">{c.count}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-3">Aggregated from replacement, attendance, roster, escalation and leave exceptions.</p>
        </div>
      </div>

      {/* All exceptions snapshot */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Active workforce exceptions <span className="text-[10px] text-gray-400 font-normal">critical first</span></h3><Link href="/unit-manager/workforce-management/exceptions-approvals/all" className="text-[11px] font-semibold text-emerald-700 hover:underline">View all →</Link></div>
        {d.exceptions.length === 0 ? <p className="text-sm text-gray-400">No active workforce exceptions across the suite. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Exception</th><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 font-medium">Status</th></tr></thead>
            <tbody>{d.exceptions.slice(0, 10).map((e: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-500">{e.source}</td><td className="py-2 pr-3 text-gray-800 capitalize">{e.title}</td><td className="py-2 pr-3 text-gray-500">{e.staff ?? "—"}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[e.severity] ?? "bg-gray-400"}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[e.severity] ?? "bg-gray-100 text-gray-500"}`}>{e.severity}</span></span></td><td className="py-2 text-gray-500 capitalize">{(e.status ?? "").replace(/_/g, " ")}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Exceptions &amp; Approvals (UMW-WFM-006 §8) aggregates approval_requests (the workflow engine) with exceptions raised across Staffing, Roster Governance, Attendance and Redeployment. Footnotes: ¹ exception register + approvals · ² approval workflow engine · ³ severity rules · ⁴ SLA timestamps · ⁵ cost rules (next-phase) · ⁷ escalation service · ⁸ priority engine. Cost exposure + delegated-authority routing are next-phase. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
