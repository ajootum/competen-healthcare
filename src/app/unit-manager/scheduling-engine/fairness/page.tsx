import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadFairnessEngine } from "@/lib/operations/fairness-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";
import { KpiTile as Kpi } from "../../../../components/ui/primitives";
import { estateRolesOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Fairness Engine (WSE-001E) — equitable workforce distribution across the generated
// roster. Per-staff shift/night/weekend/consecutive-day equity, an equity heatmap, bias
// alerts and recommended rebalancing swaps — all from real op_roster_assignments.
// Fairness runs after safety + competency (never overrides a hard constraint). Public-
// holiday equity, leave/preference equity and historical balancing are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Overview", "Shift Distribution", "Weekend & Holiday", "Night Balance", "Overtime", "Workload", "Bias Alerts", "Rebalancing", "Audit & History", "Settings"];
const SEV: Record<string, string> = { High: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", Medium: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" };
const heat = (v: number, max: number) => { const p = max ? v / max : 0; return p >= 0.8 ? "bg-[var(--cmp-surface-error)] text-rose-800" : p >= 0.55 ? "bg-[var(--cmp-surface-warning)] text-amber-800" : p > 0 ? "bg-[var(--cmp-surface-success)] text-emerald-800" : "bg-gray-50 text-gray-300"; };

export default async function FairnessEngine() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadFairnessEngine(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Fairness Engine</h1><p className="text-sm text-gray-500">Equitable distribution of shifts, nights and weekends across staff.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
      <div className="flex gap-1 overflow-x-auto -mt-1">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-full font-medium ${i === 0 ? "bg-[var(--cmp-surface-success)] text-emerald-700" : "text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>080</code> and generate a roster — the Fairness Engine analyses it.</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className={`${card} p-8 text-center`}><p className="text-3xl mb-2">⚖️</p><p className="text-sm font-semibold text-gray-700">No roster to analyse for week of {d.weekStart}</p><p className="text-xs text-gray-400 mt-1">Generate a roster in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> — fairness analysis runs over it.</p></div></div>;

  const k = d.kpis;
  const maxTotal = Math.max(1, ...d.staff.map((s: any) => s.total));
  const maxNight = Math.max(1, ...d.staff.map((s: any) => s.night));
  const maxWe = Math.max(1, ...d.staff.map((s: any) => s.weekend));
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Overall fairness" value={`${k.overall}%`} sub={k.overall >= 85 ? "Equitable" : "Rebalance"} icon="⚖️" tone={k.overall >= 85 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Kpi label="Shift equity" value={`${k.shiftEquity}%`} sub="Total shift spread" icon="📊" />
        <Kpi label="Night equity" value={`${k.nightEquity}%`} sub="Night distribution" icon="🌙" />
        <Kpi label="Weekend equity" value={`${k.weekendEquity}%`} sub="Weekend spread" icon="📅" />
        <Kpi label="Bias alerts" value={k.biasAlerts} sub="Unequal allocations" icon="🚩" tone={k.biasAlerts ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Over limit" value={k.overLimit} sub=">4 shifts / week" icon="⏰" tone={k.overLimit ? "text-[var(--cmp-text-error)]" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Shift equity heatmap */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift equity heatmap <span className="text-[10px] text-gray-400 font-normal">per staff · week {d.weekStart}</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-2 font-medium capitalize">Role</th><th className="py-2 px-2 font-medium text-center">Total</th><th className="py-2 px-2 font-medium text-center">Day</th><th className="py-2 px-2 font-medium text-center">Night</th><th className="py-2 px-2 font-medium text-center">Weekend</th><th className="py-2 px-2 font-medium text-center">Consec</th></tr></thead>
            <tbody>{d.staff.slice(0, 14).map((s: any) => (
              <tr key={s.id} className="border-b border-gray-50">
                <td className="py-1.5 pr-3 text-gray-700 truncate max-w-[130px]">{s.name}</td>
                <td className="py-1.5 pr-2 text-gray-500 capitalize">{s.role}</td>
                <td className="py-1 px-1 text-center"><span className={`inline-block w-7 rounded py-0.5 font-semibold ${heat(s.total, maxTotal)}`}>{s.total}</span></td>
                <td className="py-1.5 px-2 text-center text-gray-600">{s.day}</td>
                <td className="py-1 px-1 text-center"><span className={`inline-block w-7 rounded py-0.5 ${heat(s.night, maxNight)}`}>{s.night}</span></td>
                <td className="py-1 px-1 text-center"><span className={`inline-block w-7 rounded py-0.5 ${heat(s.weekend, maxWe)}`}>{s.weekend}</span></td>
                <td className={`py-1.5 px-2 text-center ${s.consecutive >= 5 ? "text-[var(--cmp-text-error)] font-semibold" : "text-gray-500"}`}>{s.consecutive}</td>
              </tr>
            ))}</tbody>
          </table>{d.staff.length > 14 && <p className="text-[10px] text-gray-400 mt-1">Showing 14 of {d.staff.length}.</p>}</div>
          <p className="text-[10px] text-gray-400 mt-2">Colour = intensity vs the busiest staff. Fairness optimises only after safety &amp; competency are satisfied — it never overrides a hard constraint.</p>
        </div>

        {/* Bias alerts + AI */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Bias alerts</h3>
            {d.alerts.length === 0 ? <p className="text-sm text-gray-400">No allocation bias detected. 🎉</p> : <div className="space-y-2">{d.alerts.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">🚩</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-gray-800 truncate">{a.staff}</span><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV[a.sev]}`}>{a.sev}</span></div><p className="text-[11px] text-gray-500">{a.reason}</p></div></div>))}</div>}
          </div>
          <div className={`${card} p-5 bg-gradient-to-br from-emerald-50/40 to-white`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>Fairness insights</h3>
            {d.insights.length === 0 ? <p className="text-sm text-gray-400">No insights.</p> : <div className="space-y-2">{d.insights.map((x: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{x.icon}</span><p className="text-xs text-gray-700 flex-1">{x.text}</p></div>))}</div>}
          </div>
        </div>
      </div>

      {/* Recommended rebalancing */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Recommended rebalancing actions</h3>
        {d.recs.length === 0 ? <p className="text-sm text-gray-400">Distribution is balanced — no rebalancing needed.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{d.recs.map((r: any, i: number) => (<div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5"><div><p className="text-xs font-semibold text-gray-800 capitalize">{r.role}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div><span className="text-xs text-gray-700">{r.from} <span className="text-[var(--cmp-text-success)]">→</span> {r.to}</span></div>))}</div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Managers may apply or override rebalancing with mandatory audit justification (inline apply is next-phase — regenerate for a fresh balanced roster).</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Fairness Engine (WSE-001E) scores equity over the generated roster: shift, night and weekend distribution (spread across staff), consecutive-day fatigue and over-limit detection — all from real op_roster_assignments. Bias alerts flag over-allocated / night-heavy / fatigued staff, and rebalancing recommends a same-role swap from the busiest to the lightest-loaded clinician. Fairness optimises only after safety &amp; competency are satisfied, never overriding a hard constraint. Public-holiday equity, leave/preference equity and cross-roster historical balancing need those stores (holiday calendar, leave records, roster history) — honest next-phase. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
