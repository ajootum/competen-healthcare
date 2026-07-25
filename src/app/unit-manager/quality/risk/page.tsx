import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadRiskRegister } from "@/lib/operations/risk-register";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, RiskHeat, riskCellTone, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Enterprise Risk Register (UMG-QS-006) — the 5×5 register (gov_risks + gov_controls, migration 060), scoped
// to the manager's hospital plus platform-wide risks. Real: KPIs, the inherent-risk heat map, risk-by-
// category, the register ranked by residual/inherent score and the controls-library summary. Risks are
// registered and treated in the Governance & Compliance workspace (authoritative). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const bandTone = (b: string) => (b === "critical" ? "bg-rose-100 text-rose-700" : b === "high" ? "bg-orange-100 text-orange-700" : b === "medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700");

export default async function RiskRegister() {
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
    loadRiskRegister(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-006" title="Enterprise Risk Register" subtitle="5×5 risk register, heat map and internal controls" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Risk register not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 060 (gov_risks / gov_controls) to enable the risk register.</p></div></div>;

  const k = d.kpis, c = d.controls;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="⚠️" tint="bg-orange-50" label="Open Risks" value={k.total} sub="on register" />
        <Kpi icon="🔴" tint="bg-rose-50" label="Critical" value={k.critical} tone={k.critical ? "text-rose-600" : "text-gray-400"} sub="score ≥ 16" />
        <Kpi icon="🟠" tint="bg-orange-50" label="High" value={k.high} tone={k.high ? "text-orange-600" : "text-gray-400"} sub="score 10–15" />
        <Kpi icon="🛠️" tint="bg-sky-50" label="Mitigating" value={k.mitigating} sub={`${k.escalated} escalated`} />
        <Kpi icon="📅" tint="bg-amber-50" label="Review Overdue" value={k.reviewOverdue} tone={k.reviewOverdue ? "text-amber-600" : "text-gray-400"} sub="past review date" />
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Controls" value={k.controls} sub={`${c.effective} effective`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Heat Map <span className="text-[10px] text-gray-400 font-normal">inherent · 5×5</span></h3>
          {d.hasData ? <RiskHeat count={(l, im) => d.heat[`${l}-${im}`] ?? 0} /> : <p className="text-sm text-gray-400 py-8 text-center">No open risks.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk by Category</h3>
          {d.byCategory.length ? <div className="space-y-2">{d.byCategory.map((cat: any) => (
            <div key={cat.name} className="flex items-center gap-2 text-xs">
              <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${riskCellTone(cat.peak)}`}>{cat.peak}</span>
              <span className="text-gray-700 capitalize flex-1 truncate">{cat.name}</span>
              <b className="tabular-nums text-gray-800">{cat.n}</b>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No categorised risks.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Controls Library</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between"><span className="text-gray-600">Effective</span><b className="tabular-nums text-emerald-600">{c.effective}</b></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Partially effective</span><b className="tabular-nums text-amber-600">{c.partial}</b></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Ineffective</span><b className="tabular-nums text-rose-600">{c.ineffective}</b></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Not tested</span><b className="tabular-nums text-gray-500">{c.notTested}</b></div>
            <div className="border-t border-gray-100 pt-2 flex items-center justify-between"><span className="text-gray-500">Risks with a control</span><b className="tabular-nums text-gray-800">{c.linked}</b></div>
          </div>
        </div>
      </div>

      <div className={`${qcard} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Risk Register <span className="text-[10px] text-gray-400 font-normal">ranked by residual score</span></h3><CrossLink href="/super-admin/governance/risk">Governance risk workspace</CrossLink></div>
        {d.register.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Risk</th><th className="py-1.5 font-medium">Category</th><th className="py-1.5 font-medium text-center">L×I</th><th className="py-1.5 font-medium text-center">Inherent</th><th className="py-1.5 font-medium text-center">Residual</th><th className="py-1.5 font-medium">Treatment</th><th className="py-1.5 font-medium">Owner</th><th className="py-1.5 font-medium">Status</th></tr></thead>
              <tbody>{d.register.map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700 max-w-[200px] truncate" title={r.title}>{r.title}{r.reviewOverdue && <span className="ml-1 text-[9px] text-amber-500">review due</span>}</td>
                  <td className="py-2 text-gray-500 capitalize">{r.category}</td>
                  <td className="py-2 text-center text-gray-400 tabular-nums">{r.likelihood}×{r.impact}</td>
                  <td className="py-2 text-center"><span className={`inline-block w-7 rounded text-[11px] font-bold tabular-nums ${riskCellTone(r.inherent)}`}>{r.inherent}</span></td>
                  <td className="py-2 text-center"><span className={r.residual != null ? `inline-block w-7 rounded text-[11px] font-bold tabular-nums ${riskCellTone(r.residual)}` : "text-gray-300"}>{r.residual ?? "—"}</span></td>
                  <td className="py-2 text-gray-500 capitalize">{r.treatment}</td>
                  <td className="py-2 text-gray-500 truncate max-w-[110px]">{r.owner ?? "—"}</td>
                  <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${bandTone(r.band)}`}>{r.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No risks on the register.</p>}
      </div>

      <NextPhase>Enterprise Risk Register (UMG-QS-006) over gov_risks / gov_controls (migration 060), scoped to this hospital plus platform-wide risks. Real: KPIs, the inherent-risk 5×5 heat map, risk by category, the register ranked by residual (else inherent) score, and the controls-library summary. Bands: 1–4 low · 5–9 medium · 10–15 high · 16–25 critical; high risks (≥ 15) escalate to Executive Actions. Risks are registered, scored and treated (with residual re-scoring and control linkage) in the Governance &amp; Compliance risk workspace. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
