import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceAnalytics } from "@/lib/operations/workforce-analytics";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import AnalyticsTabs from "./AnalyticsTabs";

export const dynamic = "force-dynamic";

// Live Overview (UMW-WFM-008 §5) — the analytics landing: current workforce position, coverage,
// attendance, readiness, overtime and exceptions, composed from the governed WFM-suite modules.
// A read layer — every widget links back to the source workflow. Trend snapshot + heatmap need
// time-series stores → honest. Source footnotes per §9.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const COV: Record<string, string> = { "Fully covered": "text-emerald-600", "Below target": "text-amber-600", "Below minimum": "text-rose-600", "—": "text-gray-400" };

function Kpi({ label, value, sub, tone, foot, href }: { label: string; value: any; sub?: string; tone?: string; foot?: string; href?: string }) {
  const inner = <><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</>;
  return href ? <Link href={href} className={`${card} p-4 block hover:border-emerald-200`}>{inner}</Link> : <div className={`${card} p-4`}>{inner}</div>;
}

export default async function AnalyticsOverview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceAnalytics(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Analytics &amp; Reports</h1><p className="text-sm text-gray-500">Workforce position, pressure, risk and trend — the read layer over the WFM suite.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">Analytics activate once operational shifts, attendance and competency records exist.</p></div></div>;

  const k = d.kpis;
  const funnelMax = Math.max(1, ...d.funnel.map((f: any) => f.n));
  return (
    <div className="space-y-4">
      {header}

      {/* Row 1 — 6 KPI cards (§5.1) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Workforce position" value={`${k.present}/${k.expected}`} sub={k.gap ? `${k.gap} gap` : "no gap"} tone={k.gap ? "text-amber-600" : "text-emerald-600"} foot="ⁱ" href="/unit-manager/workforce-management/analytics/coverage" />
        <Kpi label="Coverage" value={k.coveragePct != null ? `${k.coveragePct}%` : "—"} sub={k.coverageState} tone={COV[k.coverageState]} foot="WF-COV-001" href="/unit-manager/workforce-management/analytics/coverage" />
        <Kpi label="Attendance" value={k.presentRate != null ? `${k.presentRate}%` : "—"} sub={`${k.absent} absent · ${k.late} late`} tone={k.presentRate != null && k.presentRate >= 90 ? "text-emerald-600" : "text-amber-600"} foot="WF-ATT-001" href="/unit-manager/workforce-management/analytics/attendance" />
        <Kpi label="Readiness" value={k.readinessScore != null ? `${k.readinessScore}` : "—"} sub={k.readinessBand} tone={k.readinessBand === "Ready" || k.readinessBand === "Mostly ready" ? "text-emerald-600" : "text-amber-600"} foot="WF-RDY-001" href="/unit-manager/workforce-management/analytics/readiness" />
        <Kpi label="Overtime" value={k.overtimeHours != null ? `${k.overtimeHours}h` : "—"} sub={k.overtimePremium ? `£${k.overtimePremium.toLocaleString()} premium` : "this cycle"} tone={k.overtimeHours ? "text-amber-600" : undefined} foot="WF-OT-001" href="/unit-manager/workforce-management/analytics/cost" />
        <Kpi label="Open exceptions" value={k.openExceptions} sub={`${k.criticalExceptions} critical · ${k.overdueExceptions} overdue`} tone={k.criticalExceptions ? "text-rose-600" : k.openExceptions ? "text-amber-600" : "text-emerald-600"} foot="WF-EXC-001" href="/unit-manager/workforce-management/analytics/exceptions" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Workforce position funnel (§5.1 row 2) */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Workforce position <span className="text-[9px] text-gray-300">ⁱ planned → attended → deployable</span></h3>
          {d.funnel.length === 0 ? <p className="text-sm text-gray-400">No position data.</p> : <div className="space-y-2">{d.funnel.map((f: any) => (<div key={f.label} className="flex items-center gap-3 text-xs"><span className="text-gray-600 w-36 truncate">{f.label}</span><div className="flex-1 h-4 rounded bg-gray-50 overflow-hidden"><div className={`h-full ${f.tone} flex items-center justify-end pr-2`} style={{ width: `${Math.max(6, (f.n / funnelMax) * 100)}%` }}><span className="text-[10px] font-semibold text-white">{f.n}</span></div></div></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Distinguishes planned vs attended vs deployable workforce (§1.1). Deployed vs productive-coverage refinement needs assignment-level joins → next-phase.</p>
        </div>

        {/* Top drivers (§WA-OV-009) */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Top drivers <span className="text-[9px] text-gray-300">of gap</span></h3>
          {d.drivers.length === 0 ? <p className="text-sm text-gray-400">No material drivers. 🎉</p> : <div className="space-y-2">{d.drivers.slice(0, 6).map((dr: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 p-2"><div><p className="text-gray-800 font-medium">{dr.label}</p><p className="text-[10px] text-gray-400">{dr.note}</p></div><span className="font-bold text-gray-700">{dr.value}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Association, not proven causation (§11).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Manager narrative (§WA-OV-012) */}
        <div className={`${card} p-5 xl:col-span-2 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <div className="flex items-start gap-2.5"><span className="text-lg">✨</span><div><p className="text-sm font-bold text-gray-900">Manager narrative</p><ul className="mt-1 space-y-0.5">{d.narrative.map((n: string, i: number) => (<li key={i} className="text-xs text-gray-600">• {n}</li>))}</ul><p className="text-[10px] text-gray-400 mt-2">Rules-based; every statement traces to a metric — no invented explanation (§11).</p></div></div>
        </div>

        {/* Data quality (§WA-OV-011) */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Data quality <span className="text-[9px] text-gray-300">WF-DQ-001</span></h3>
          <div className="flex items-center gap-3"><div className="relative w-16 h-16 shrink-0"><div className="w-16 h-16 rounded-full" style={{ background: d.completeness != null ? `conic-gradient(${d.completeness >= 90 ? "#10b981" : "#f59e0b"} ${d.completeness}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[20%] rounded-full bg-white flex items-center justify-center text-xs font-bold">{d.completeness != null ? `${d.completeness}%` : "—"}</div></div><div className="text-[11px] text-gray-500"><p>Attendance status completeness.</p><p className="text-[10px] text-gray-400 mt-1">Sources: {Object.entries(d.sources).filter(([, v]) => v).map(([s]) => s).join(", ") || "none"}. Estimated/provisional/final states never silently substituted (§2).</p></div></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Analytics &amp; Reports (UMW-WFM-008 §5) is a read layer composing Attendance (WFM-005), Readiness (WFM-007), Exceptions (WFM-006) and Cost. Every metric carries its key (WF-COV-001 etc., see <Link href="/unit-manager/workforce-management/analytics/metrics" className="text-emerald-700 hover:underline">Metric Dictionary</Link>) and links back to its source workflow. Trend snapshot, heatmap, forecasts and the report builder need time-series + report stores → next-phase. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
