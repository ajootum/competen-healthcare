import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadIncidentCentre } from "@/lib/operations/incident-centre";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, Pipe, StackedTrend, TrendLegend, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Incident Management (UMG-QS-002) — the Unit Manager's oversight lens over the incident register
// (op_incidents). Real: KPIs, the report→investigate→awaiting-action→closed lifecycle, incident-by-type and
// by-severity, the 6-month severity trend, RCA-pending flag and the named register. Incidents are created /
// investigated in the Shift Supervisor Quality & Safety centre (the authoritative surface). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TREND_META = [
  { key: "critical", label: "Critical", color: "#ef4444" },
  { key: "high", label: "High", color: "#f97316" },
  { key: "medium", label: "Medium", color: "#f59e0b" },
  { key: "low", label: "Low", color: "#22c55e" },
  { key: "nearMiss", label: "Near Miss", color: "#14b8a6" },
];
const sevTone = (s: string) => (s === "critical" ? "bg-rose-100 text-rose-700" : s === "high" ? "bg-orange-100 text-orange-700" : s === "medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700");

export default async function IncidentManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadIncidentCentre(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-002" title="Incident Management" subtitle="Incident & near-miss register, investigation lifecycle and RCA oversight" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Incident register not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 073 (op_incidents) to enable incident management.</p></div></div>;

  const k = d.kpis;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🚩" tint="bg-rose-50" label="Open Incidents" value={k.open} tone={k.open ? "text-rose-600" : "text-gray-400"} sub={`${k.total} total`} />
        <Kpi icon="❗" tint="bg-orange-50" label="Critical Open" value={k.critical} tone={k.critical ? "text-rose-600" : "text-gray-400"} sub="need RCA" />
        <Kpi icon="🔎" tint="bg-sky-50" label="Investigating" value={k.investigating} sub="under review" />
        <Kpi icon="⏳" tint="bg-amber-50" label="Awaiting Action" value={k.awaitingAction} sub="corrective action" />
        <Kpi icon="🤏" tint="bg-teal-50" label="Near Misses" value={k.nearMiss} sub="reported" />
        <Kpi icon="✅" tint="bg-emerald-50" label="Closure Rate" value={`${k.closureRate}%`} sub={k.avgClose != null ? `avg ${k.avgClose}d to close` : "—"} />
      </div>

      {d.kpis.rcaPending > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-rose-900">⚠️ {d.kpis.rcaPending} critical/sentinel incident{d.kpis.rcaPending === 1 ? "" : "s"} awaiting root-cause analysis</p>
          <p className="text-xs text-rose-700 mt-0.5">Business rule: critical incidents require an RCA and corrective action before closure.</p>
          <div className="mt-2 space-y-1">{d.rcaList.map((r: any, i: number) => <div key={i} className="text-xs text-rose-800 flex items-center gap-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${sevTone(r.severity)}`}>{r.type}</span><span className="truncate">{r.desc}</span></div>)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Incident Trend <span className="text-[10px] text-gray-400 font-normal">last 6 months</span></h3>
          {d.hasData ? <><StackedTrend months={d.trend.months} series={d.trend.series} meta={TREND_META} /><TrendLegend meta={TREND_META} /></> : <p className="text-sm text-gray-400 py-10 text-center">No incidents recorded.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Investigation Lifecycle</h3>
          <div className="space-y-2">{d.lifecycle.map((s: any) => <Pipe key={s.key} label={s.label} n={s.n} total={k.total || 1} color={s.key === "closed" ? "#94a3b8" : s.key === "awaiting_action" ? "#f59e0b" : s.key === "investigating" ? "#3b82f6" : "#ef4444"} />)}</div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">By Severity</h3>
          <div className="space-y-2">{d.bySeverity.map((s: any) => <div key={s.key} className="flex items-center justify-between text-xs"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${sevTone(s.key)}`}>{s.label}</span><span className="text-gray-500">{s.open} open <span className="text-gray-300">/ {s.n} total</span></span></div>)}</div>
          <h3 className="font-semibold text-gray-900 text-sm mt-4 mb-2">By Type</h3>
          <div className="space-y-1">{d.byType.slice(0, 6).map((t: any) => <div key={t.type} className="flex items-center justify-between text-xs"><span className="text-gray-600">{t.label}</span><b className="tabular-nums text-gray-800">{t.open}<span className="text-gray-300 font-normal"> / {t.n}</span></b></div>)}</div>
        </div>
      </div>

      <div className={`${qcard} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Incident Register <span className="text-[10px] text-gray-400 font-normal">most recent</span></h3><CrossLink href="/supervisor/quality-safety">Report / investigate incidents</CrossLink></div>
        {d.register.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Severity</th><th className="py-1.5 font-medium">Description</th><th className="py-1.5 font-medium">Patient</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium text-right">Reported</th></tr></thead>
              <tbody>{d.register.map((r: any) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700 whitespace-nowrap">{r.type}{r.nearMiss && <span className="ml-1 text-[9px] text-teal-600">near-miss</span>}</td>
                  <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${sevTone(r.severity)}`}>{r.severity}</span></td>
                  <td className="py-2 text-gray-600 max-w-[220px] truncate" title={r.desc}>{r.desc}{!r.hasAction && r.statusKey !== "closed" && <span className="ml-1 text-[9px] text-amber-500">no action</span>}</td>
                  <td className="py-2 text-gray-500">{r.patient ?? "—"}</td>
                  <td className="py-2 text-gray-500">{r.status}</td>
                  <td className="py-2 text-right text-gray-400 tabular-nums">{(r.at ?? "").slice(0, 10)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No incidents in the register yet.</p>}
      </div>

      <NextPhase>Incident Management (UMG-QS-002) over the incident register (op_incidents, migration 073). Real: KPIs, the report→investigate→awaiting-action→closed lifecycle, incident by type &amp; severity, the 6-month severity trend, the RCA-pending flag (critical/sentinel open without a corrective action — §6 business rule) and the named register. Incidents are created and investigated in the Shift Supervisor Quality &amp; Safety centre (the authoritative surface, linked above). Honest next-phase: the structured root-cause taxonomy and the full RCA workflow (fishbone / 5-whys). Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
