import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Coverage & Deployment Analytics (UMW-WFM-008 §6.2) — requirement → rostered → attended →
// deployed coverage bridge, role/skill coverage, float use over the workforce ops engine. Real.
// Assignment-integrity + workload-distribution detail draw on Team Assignments → cross-linked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ST: Record<string, string> = { Good: "bg-emerald-50 text-emerald-700", "At Risk": "bg-amber-50 text-amber-700", "Below Required": "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function CoverageAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Coverage &amp; Deployment</h1><p className="text-sm text-gray-500">Requirement → rostered → attended → deployed coverage.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p></div></div>;

  const t = d.overviewTotal;
  const bridge = [
    { label: "Required", n: t.required ?? 0, tone: "bg-gray-300" },
    { label: "Rostered", n: t.planned, tone: "bg-sky-400" },
    { label: "Confirmed", n: t.confirmed, tone: "bg-sky-500" },
    { label: "Present", n: t.present, tone: "bg-emerald-500" },
  ];
  const bMax = Math.max(1, ...bridge.map(b => b.n));
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Coverage" value={t.coverage != null ? `${t.coverage}%` : "—"} tone={t.coverage != null && t.coverage >= 90 ? "text-emerald-600" : "text-amber-600"} foot="WF-COV-001" />
        <Kpi label="Present / required" value={`${t.present}/${t.required ?? "—"}`} sub={t.variance != null ? `${t.variance >= 0 ? "+" : ""}${t.variance}` : ""} />
        <Kpi label="Skill-mix" value={d.skillMix?.pct != null ? `${d.skillMix.pct}%` : "—"} sub="Competency compliance" foot="WF-CMP-001" />
        <Kpi label="Open shifts" value={d.openShiftCount ?? 0} tone={(d.openShiftCount ?? 0) ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Float pool" value={(d.floatPool ?? []).length} sub="Available" tone="text-violet-600" foot="WA-CV-006" />
        <Kpi label="Critical gaps" value={d.kpis.criticalGaps ?? 0} tone={(d.kpis.criticalGaps ?? 0) ? "text-rose-600" : "text-emerald-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Coverage bridge <span className="text-[10px] text-gray-400 font-normal">WA-CV-001</span></h3>
          <div className="space-y-2">{bridge.map(b => (<div key={b.label} className="flex items-center gap-3 text-xs"><span className="text-gray-600 w-24 truncate">{b.label}</span><div className="flex-1 h-4 rounded bg-gray-50 overflow-hidden"><div className={`h-full ${b.tone} flex items-center justify-end pr-2`} style={{ width: `${Math.max(6, (b.n / bMax) * 100)}%` }}><span className="text-[10px] font-semibold text-white">{b.n}</span></div></div></div>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Role / skill coverage <span className="text-[10px] text-gray-400 font-normal">WA-CV-002</span></h3>
          {(d.staffingOverview ?? []).length === 0 ? <p className="text-sm text-gray-400">No role data.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Present</th><th className="py-2 pr-3 font-medium text-right">Required</th><th className="py-2 pr-3 font-medium text-right">Coverage</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{d.staffingOverview.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.label}</td><td className="py-2 pr-3 text-right text-gray-700 font-semibold">{r.present}</td><td className="py-2 pr-3 text-right text-gray-600">{r.required ?? "—"}</td><td className="py-2 pr-3 text-right">{r.coverage != null ? `${r.coverage}%` : "—"}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[r.status] ?? ST["—"]}`}>{r.status}</span></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Assignment integrity + workload distribution draw on Team Assignments → cross-linked.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Coverage &amp; Deployment (UMW-WFM-008 §6.2). <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">Open Team Assignments ↗</Link> · <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
