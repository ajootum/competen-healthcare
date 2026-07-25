import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadAuditCentre } from "@/lib/operations/audit-centre";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, Donut, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Audit & Compliance Centre (UMG-QS-003) — clinical-audit oversight over audits + audit_findings (034).
// Real: KPIs, compliance by type & by area, the 6-month compliance trend, the recent-audit register and the
// open critical-finding list. Audits run through the /api/quality routes; the accreditation workspace is the
// fuller surface. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const statusTone = (s: string) => (s === "completed" ? "bg-emerald-100 text-emerald-700" : s === "in_progress" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700");
const pctTone = (p: number | null) => (p == null ? "text-gray-300" : p >= 85 ? "text-emerald-600" : p >= 70 ? "text-amber-600" : "text-rose-600");
const barTone = (p: number) => (p >= 85 ? "#10b981" : p >= 70 ? "#f59e0b" : "#ef4444");

export default async function AuditCentre() {
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
    loadAuditCentre(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-003" title="Audit & Compliance Centre" subtitle="Clinical audits, compliance scoring and finding management" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 034 (audits / audit_findings) to enable the audit centre.</p></div></div>;

  const k = d.kpis;
  const trendMax = 100;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🔍" tint="bg-indigo-50" label="Total Audits" value={k.total} sub={`${k.completed} completed`} />
        <Kpi icon="📊" tint="bg-emerald-50" label="Avg Compliance" value={k.avgCompliance != null ? `${k.avgCompliance}%` : "—"} tone={pctTone(k.avgCompliance)} sub="completed audits" />
        <Kpi icon="⏳" tint="bg-amber-50" label="Pending" value={k.pending} sub={`${k.planned} planned · ${k.inProgress} in progress`} />
        <Kpi icon="📌" tint="bg-rose-50" label="Open Findings" value={k.findingsOpen} tone={k.findingsOpen ? "text-rose-600" : "text-gray-400"} sub="not met" />
        <Kpi icon="❗" tint="bg-orange-50" label="Critical Findings" value={k.findingsCritical} tone={k.findingsCritical ? "text-rose-600" : "text-gray-400"} sub="auto-CAPA" />
        <Kpi icon="✅" tint="bg-sky-50" label="Completed" value={k.completed} sub={k.total ? `${Math.round((k.completed / k.total) * 100)}% of audits` : "—"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Compliance Trend <span className="text-[10px] text-gray-400 font-normal">last 6 months</span></h3>
          {d.trend.some((t: any) => t.pct != null) ? (
            <div className="flex items-end justify-between gap-2 h-40 pt-2">
              {d.trend.map((t: any, i: number) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="w-full flex flex-col justify-end items-center" style={{ height: "128px" }}>
                    {t.pct != null ? <div className="w-6 rounded-t" style={{ height: `${(t.pct / trendMax) * 120}px`, background: barTone(t.pct) }} title={`${t.pct}%`} /> : <div className="w-6 h-0.5 bg-gray-100 rounded" />}
                  </div>
                  <span className="text-[10px] text-gray-500 tabular-nums">{t.pct != null ? `${t.pct}%` : "—"}</span>
                  <span className="text-[10px] text-gray-400">{t.label}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-10 text-center">No completed audits with a compliance score yet.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance by Audit Type</h3>
          {d.byType.length ? <div className="space-y-2.5">{d.byType.map((t: any) => (
            <div key={t.name}><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{t.name} <span className="text-gray-300">({t.n})</span></span><b className={`tabular-nums ${pctTone(t.pct)}`}>{t.pct}%</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${t.pct}%`, background: barTone(t.pct) }} /></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No scored audits yet.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Lowest-Scoring Areas</h3>
          {d.byArea.length ? <div className="space-y-2.5">{d.byArea.map((a: any) => (
            <div key={a.name}><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 truncate max-w-[160px]" title={a.name}>{a.name}</span><b className={`tabular-nums ${pctTone(a.pct)}`}>{a.pct}%</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${a.pct}%`, background: barTone(a.pct) }} /></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No audit areas recorded.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Recent Audits</h3><CrossLink href="/quality-accreditation">Quality &amp; Accreditation workspace</CrossLink></div>
          {d.register.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Audit</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Area</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium text-right">Compliance</th><th className="py-1.5 font-medium text-right">Date</th></tr></thead>
                <tbody>{d.register.map((a: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700 max-w-[200px] truncate" title={a.title}>{a.title}</td>
                    <td className="py-2 text-gray-500">{a.type}</td>
                    <td className="py-2 text-gray-500">{a.area ?? "—"}</td>
                    <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${statusTone(a.status)}`}>{a.status.replace("_", " ")}</span></td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${pctTone(a.pct)}`}>{a.pct != null ? `${a.pct}%` : "—"}</td>
                    <td className="py-2 text-right text-gray-400 tabular-nums">{(a.at ?? "").slice(0, 10)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No audits recorded yet.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Open Critical Findings</h3>
          {d.criticalFindings.length ? <div className="space-y-2">{d.criticalFindings.map((f: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-gray-800 leading-snug">{f.item}</p><p className="text-[10px] text-gray-400 truncate">{f.audit}</p></div></div>
          ))}</div> : <div className="flex items-center gap-3 py-4"><Donut pct={100} color="#10b981" center="0" sub="critical" size={72} /><p className="text-sm text-gray-400">No open critical findings.</p></div>}
        </div>
      </div>

      <NextPhase>Audit &amp; Compliance Centre (UMG-QS-003) over the audit store (audits / audit_findings, migration 034). Real: KPIs, compliance by audit type and by area, the 6-month compliance trend, the recent-audit register and open critical findings (a failed critical criterion auto-creates a CAPA). Audits are conducted via the audited /api/quality routes and the checklists are drawn dynamically from the competency framework. Honest next-phase: the audit scheduling calendar and per-standard drill-down. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
