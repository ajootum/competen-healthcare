import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Exceptions & Governance Analytics (UMW-WFM-008 §6.6) — exception volume, ageing, approval
// performance and recurrence over Exceptions & Approvals (WFM-006). Real. Approval cycle-time
// percentiles + recurrence root-cause need decision-timestamp history → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ExceptionsAnalytics() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Exceptions &amp; Governance</h1><p className="text-sm text-gray-500">Exception volume, ageing, approval performance and recurrence.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No exception data</p></div></div>;

  const k = d.kpis;
  const catTotal = d.cats.reduce((n: number, c: any) => n + c.count, 0) || 1;
  const decided = d.approvals.filter((a: any) => ["approved", "rejected"].includes(a.status));
  const rejected = d.approvals.filter((a: any) => a.status === "rejected").length;
  const slaCompliance = decided.length ? Math.round(((decided.length - k.overdue) / decided.length) * 100) : null;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open exceptions" value={k.openExceptions} sub={`${k.exceptionCount} raised`} foot="WF-EXC-001" />
        <Kpi label="Critical" value={k.critical} tone={k.critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Overdue" value={k.overdue} tone={k.overdue ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Escalated" value={k.escalated} tone={k.escalated ? "text-orange-600" : undefined} />
        <Kpi label="SLA compliance" value={slaCompliance != null ? `${slaCompliance}%` : "—"} tone={slaCompliance != null && slaCompliance >= 90 ? "text-emerald-600" : "text-amber-600"} foot="WF-EXC-001" />
        <Kpi label="Rejection rate" value={decided.length ? `${Math.round((rejected / decided.length) * 100)}%` : "—"} sub={`${decided.length} decided`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exception volume by category <span className="text-[10px] text-gray-400 font-normal">WA-EX-001</span></h3>
          {d.cats.length === 0 ? <p className="text-sm text-gray-400">No exceptions.</p> : <div className="space-y-2">{d.cats.map((c: any) => (<div key={c.category} className="flex items-center gap-3 text-xs"><span className="text-gray-600 w-32 truncate">{c.category}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(c.count / catTotal) * 100}%` }} /></div><span className="font-semibold text-gray-700 w-6 text-right">{c.count}</span></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Active exceptions <span className="text-[10px] text-gray-400 font-normal">critical first</span></h3>
          {d.exceptions.length === 0 ? <p className="text-sm text-gray-400">No active exceptions. 🎉</p> : <div className="space-y-1.5">{d.exceptions.slice(0, 8).map((e: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 p-2"><div className="min-w-0"><p className="text-gray-800 font-medium capitalize truncate">{e.title}</p><p className="text-[10px] text-gray-400">{e.source}</p></div><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${e.severity === "critical" ? "bg-rose-50 text-rose-700" : e.severity === "high" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>{e.severity}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Cycle-time percentiles + recurrence root-cause need decision-timestamp history → next-phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Exceptions &amp; Governance (UMW-WFM-008 §6.6) over Workforce Exceptions &amp; Approvals. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">Open Exceptions &amp; Approvals ↗</Link> · <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
