import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadFairnessEngine } from "@/lib/operations/fairness-engine";
import { loadCostEngine } from "@/lib/operations/cost-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Fairness, Fatigue & Cost (UMW-WFM-004 §13) — assurance that the roster is sustainable,
// equitable and financially controlled. Reuses the Fairness Engine (WSE-001E) for per-staff
// distribution + fatigue indicators (consecutive days, over-limit) and the Cost Engine
// (WSE-001F) for labour/overtime/agency cost. Real. Cost guardrails must never approve unsafe
// staffing to stay in budget (§13.7).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function FairnessFatigueCost() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [f, c, departments] = await Promise.all([
    loadFairnessEngine(admin, hid, isSuper) as Promise<any>,
    loadCostEngine(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Fairness, Fatigue &amp; Cost</h1><p className="text-sm text-gray-500">Is the roster sustainable, equitable and financially controlled?</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!f.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!f.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const k = f.kpis, ck = c?.kpis ?? {};
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Fairness index" value={`${k.overall}`} sub="0–100 equity" tone={k.overall >= 85 ? "text-emerald-600" : k.overall >= 70 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Night equity" value={`${k.nightEquity}`} sub="Night distribution" />
        <Kpi label="Bias alerts" value={k.biasAlerts} sub="Allocation / fatigue" tone={k.biasAlerts ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Over shift limit" value={k.overLimit} sub=">4 shifts/week" tone={k.overLimit ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Est. labour" value={ck.totalLabour != null ? `£${(ck.totalLabour / 1000).toFixed(1)}k` : "—"} sub={ck.variance != null ? `${ck.variance >= 0 ? "+" : ""}£${Math.round(ck.variance / 100) / 10}k vs plan` : "planning est."} />
        <Kpi label="Overtime" value={ck.overtimeHours != null ? `${ck.overtimeHours}h` : "—"} sub={ck.agencyProjected ? `£${ck.agencyProjected.toLocaleString()} agency` : "no agency"} tone={ck.overtimeHours ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Staff distribution + fatigue */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Staff distribution &amp; fatigue <span className="text-[10px] text-gray-400 font-normal">this cycle</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Shifts</th><th className="py-2 pr-3 font-medium text-right">Nights</th><th className="py-2 pr-3 font-medium text-right">Weekends</th><th className="py-2 font-medium text-right">Max consec.</th></tr></thead>
            <tbody>{f.staff.slice(0, 14).map((s: any) => (<tr key={s.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{s.name}</td><td className="py-2 pr-3 text-gray-500 capitalize">{s.role}</td><td className={`py-2 pr-3 text-right font-semibold ${s.total > 4 ? "text-rose-600" : "text-gray-700"}`}>{s.total}</td><td className="py-2 pr-3 text-right text-gray-600">{s.night || "—"}</td><td className="py-2 pr-3 text-right text-gray-600">{s.weekend || "—"}</td><td className={`py-2 text-right ${s.consecutive >= 5 ? "text-rose-600 font-semibold" : "text-gray-600"}`}>{s.consecutive}</td></tr>))}</tbody>
          </table></div>
          <p className="text-[10px] text-gray-400 mt-2">Fatigue indicators (§13.4): short rest, excessive consecutive shifts/nights, &gt;4 shifts/week. The fatigue score never makes a clinical fitness determination (§13.5).</p>
        </div>

        {/* Bias alerts + rebalance + cost breakdown */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Bias &amp; fatigue alerts</h3>
            {f.alerts.length === 0 ? <p className="text-sm text-gray-400">No bias or fatigue alerts. 🎉</p> : <div className="space-y-1.5">{f.alerts.map((al: any, i: number) => (<div key={i} className="flex items-start justify-between gap-2 text-xs rounded-lg border border-gray-100 p-2"><div><p className="text-gray-800 font-medium">{al.staff}</p><p className="text-[11px] text-gray-500">{al.reason}</p></div><span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded ${SEV[al.sev] ?? "bg-gray-100 text-gray-500"}`}>{al.sev}</span></div>))}</div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Cost by role</h3>
            {(c?.roleBreakdown ?? []).length === 0 ? <p className="text-sm text-gray-400">No cost data.</p> : <div className="space-y-1.5">{c.roleBreakdown.slice(0, 6).map((r: any) => (<div key={r.role} className="flex items-center gap-2 text-xs"><span className="text-gray-600 w-16 capitalize truncate">{r.role}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${r.pct}%` }} /></div><span className="text-gray-600 w-14 text-right">£{r.cost.toLocaleString()}</span></div>))}</div>}
            <p className="text-[10px] text-gray-400 mt-2">Cost guardrails must never approve unsafe staffing to stay in budget (§13.7 / BR-012).</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Fairness, Fatigue &amp; Cost (UMW-WFM-004 §13) reuses the Fairness (WSE-001E) and Cost (WSE-001F) engines over the current roster. Multi-period fairness comparison, allowances and agency-rate detail need pay-rate + historical stores → next-phase. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
