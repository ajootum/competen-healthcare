import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadSchedulingEngine } from "@/lib/operations/scheduling-engine";
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import RosterControls from "./RosterControls";
import SchedulingTabs from "./SchedulingTabs";

export const dynamic = "force-dynamic";

// AI Workforce Scheduling Engine (WSE-001) — the platform scheduling service's tenant
// dashboard. Scores coverage, competency match, cost, fairness and constraint risk from
// the Establishment engine's demand + live operational data, with rule-based AI
// recommendations. The optimising roster GENERATOR (named staff → future shift slots),
// what-if scenarios and publish/approve need a roster store + solver → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const STATE_BADGE: Record<string, string> = { "Fully Covered": "bg-emerald-50 text-emerald-700", "At Risk": "bg-amber-50 text-amber-700", "Uncovered": "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };
const SEV: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };
const TAG: Record<string, string> = { "High Impact": "bg-emerald-50 text-emerald-700", Cost: "bg-blue-50 text-blue-700", Supervisor: "bg-violet-50 text-violet-700", Risk: "bg-rose-50 text-rose-700", OK: "bg-gray-100 text-gray-500" };

function Ring({ pct, label, tone }: { pct: number | null; label: string; tone: string }) {
  return <div className="relative w-20 h-20 shrink-0"><div className="w-20 h-20 rounded-full" style={{ background: pct != null ? `conic-gradient(${tone} ${pct}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[20%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{pct != null ? `${pct}%` : "—"}</span><span className="text-[7px] text-gray-400 text-center leading-tight">{label}</span></div></div>;
}
function Metric({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function SchedulingEngine({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rshift = sp.rshift === "night" ? "night" : "day";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const weekStart = mondayOf();

  const [d, departments, rosterData] = await Promise.all([
    loadSchedulingEngine(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
    loadRosterForWeek(admin, hid, isSuper, weekStart) as Promise<any>,
  ]);
  const roster = rosterData?.provisioned ? rosterData.roster : null;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🗓️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI Workforce Scheduling Engine</h1><p className="text-sm text-gray-500">Intelligent scheduling that matches the right people to the right shifts — demand, competency &amp; contract aware.</p></div></div>
        <div className="flex items-center gap-2"><span className="flex items-center gap-1.5 text-[11px] text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" />Online</span><UnitFilters departments={departments} /><RosterControls week={weekStart} roster={roster} /></div>
      </div>
      <SchedulingTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Insufficient planning data</p><p className="text-sm text-amber-800 mt-1">The scheduling engine needs establishment demand (op_beds / op_staffing_standards) and live assignments to compute a schedule.</p></div></div>;

  const c = d.coverage, dm = d.demand, cm = d.competency, cost = d.cost, f = d.fairness, km = d.keyMetrics;

  // Persisted roster grid (real, solver-generated) for the selected shift
  const rAsg = (rosterData?.assignments ?? []).filter((a: any) => a.shift_type === rshift);
  const rDays: string[] = rosterData?.days ?? [];
  const roleRank: Record<string, number> = { charge: 0, nurse: 1, doctor: 2, therapist: 3, support: 4 };
  const gridUnits = [...new Set(rAsg.map((a: any) => a.unit_name))];
  const gridRows = gridUnits.flatMap((unit: any) => {
    const uRoles = [...new Set(rAsg.filter((a: any) => a.unit_name === unit).map((a: any) => a.role))].sort((a: any, b: any) => (roleRank[a] ?? 9) - (roleRank[b] ?? 9));
    return uRoles.map((role: any) => ({
      unit, role, isSup: role === "charge",
      cells: rDays.map(date => {
        const slots = rAsg.filter((a: any) => a.unit_name === unit && a.role === role && a.shift_date === date);
        const filled = slots.filter((s: any) => s.status === "assigned");
        return { required: slots.length, filled: filled.length, names: filled.map((s: any) => s.staff_name), validated: filled.length > 0 && filled.every((s: any) => s.competency_validated) };
      }),
    }));
  });
  const roleLabel: Record<string, string> = { charge: "Shift Supervisor", nurse: "RN", support: "Support", doctor: "Doctor", therapist: "Allied" };
  return (
    <div className="space-y-4">
      {header}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Coverage summary</p><div className="flex items-center gap-3"><Ring pct={c.score} label="Coverage" tone="#10b981" /><div className="text-[11px] space-y-0.5"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Fully covered <b>{c.fullyCovered}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />At risk <b>{c.atRisk}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Uncovered <b>{c.uncovered}</b></div></div></div></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Required vs assigned</p><div className="flex items-center justify-around"><div className="text-center"><p className="text-2xl font-bold text-gray-900">{dm.required}</p><p className="text-[10px] text-gray-400">Required</p></div><div className="text-center"><p className="text-2xl font-bold text-gray-900">{dm.assigned}</p><p className="text-[10px] text-gray-400">Assigned</p></div></div><p className={`text-center text-xs mt-1 ${dm.variance < 0 ? "text-rose-600" : "text-emerald-600"}`}>Variance {dm.variance > 0 ? "+" : ""}{dm.variance}</p></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Competency match</p><div className="flex items-center gap-3"><Ring pct={cm.score} label="Match" tone="#8b5cf6" /><div className="text-[11px] space-y-0.5"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Full <b>{cm.full}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />Override <b>{cm.partial}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />No match <b>{cm.none}</b></div></div></div></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Cost &amp; efficiency</p><p className="text-2xl font-bold text-gray-900">£{cost.estCost.toLocaleString()}</p><p className="text-[10px] text-gray-400">Est. weekly cost</p><div className="flex justify-between text-[11px] mt-1"><span className="text-gray-500">Overtime <b>{cost.overtimeHrsWk}h</b></span><span className="text-gray-500">Agency <b>{cost.agencyShifts}</b></span></div></div>
        <div className={`${card} p-4`}><p className="text-xs font-semibold text-gray-700 mb-2">Fairness index</p><div className="flex items-center gap-3"><Ring pct={f.score} label="Fairness" tone="#3b82f6" /><div className="text-[11px] space-y-0.5"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Balanced <b>{f.balanced}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />High load <b>{f.highLoad}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Over limit <b>{f.overLimit}</b></div></div></div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Demand by unit */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Demand by unit &amp; shift <span className="text-[10px] text-gray-400 font-normal">required per shift vs currently assigned</span></h3>
          {d.demandByUnit.length === 0 ? <p className="text-sm text-gray-400">No unit demand computed.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit / Area</th><th className="py-2 pr-3 font-medium text-right">Required</th><th className="py-2 pr-3 font-medium text-right">Assigned</th><th className="py-2 pr-3 font-medium text-right">Variance</th><th className="py-2 pr-3 font-medium text-right">Coverage</th><th className="py-2 font-medium text-right">Status</th></tr></thead>
              <tbody>{d.demandByUnit.map((u: any) => (<tr key={u.unit} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{u.unit}</td><td className="py-2 pr-3 text-right text-gray-600">{u.requiredPerShift}</td><td className="py-2 pr-3 text-right text-gray-600">{u.assigned}</td><td className={`py-2 pr-3 text-right ${u.variance < 0 ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{u.variance > 0 ? "+" : ""}{u.variance}</td><td className="py-2 pr-3 text-right font-semibold">{u.coverage != null ? `${u.coverage}%` : "—"}</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATE_BADGE[u.state]}`}>{u.state}</span></td></tr>))}</tbody>
              <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-2 pr-3 text-gray-800">Total</td><td className="py-2 pr-3 text-right">{dm.required}</td><td className="py-2 pr-3 text-right">{dm.assigned}</td><td className={`py-2 pr-3 text-right ${dm.variance < 0 ? "text-rose-600" : ""}`}>{dm.variance > 0 ? "+" : ""}{dm.variance}</td><td className="py-2 pr-3 text-right text-emerald-600">{c.score != null ? `${c.score}%` : "—"}</td><td /></tr></tfoot>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Required = per-shift posts from the Establishment engine; Assigned = distinct staff on active assignments in each unit. Day/night split &amp; the 7-day demand trend come from a generated roster (next-phase).</p>
        </div>

        {/* AI recommendations */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">AI recommendations</h3><span className="text-[10px] text-gray-400">{d.recs.length}</span></div>
          <div className="space-y-2">{d.recs.map((r: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{r.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${TAG[r.tag] ?? "bg-gray-100 text-gray-500"}`}>{r.tag}</span></div><p className="text-[11px] text-gray-500 mt-0.5">{r.sub}</p></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Advisory — no roster is published without Unit Manager approval.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Draft roster (real, solver-generated) */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-gray-900">Draft roster preview {roster && <span className={`text-[10px] px-1.5 py-0.5 rounded ${roster.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{roster.status === "published" ? "Published" : "Draft"}</span>}</h3>
            {roster && <div className="flex gap-1"><Link href="/unit-manager/scheduling-engine" className={`text-[10px] px-2 py-1 rounded-full ${rshift === "day" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}>Day (07–19)</Link><Link href="/unit-manager/scheduling-engine?rshift=night" className={`text-[10px] px-2 py-1 rounded-full ${rshift === "night" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}>Night (19–07)</Link></div>}
          </div>
          {!rosterData?.provisioned ? (
            <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-3xl mb-1">🗓️</p><p className="text-sm font-semibold text-gray-700">Roster store not provisioned</p><p className="text-[11px] text-gray-400 mt-1">Run migration <code>080</code> to enable roster generation, then use <b>Generate Roster</b>.</p></div>
          ) : !roster ? (
            <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-3xl mb-1">✨</p><p className="text-sm font-semibold text-gray-700">No roster for week of {weekStart}</p><p className="text-[11px] text-gray-400 mt-1">Press <b>Generate Roster</b> above — the solver fills each unit&apos;s day/night posts from real establishment demand + available staff, preferring competency-current clinicians.</p></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 pr-2 font-medium">Unit</th><th className="py-1.5 pr-2 font-medium">Role</th>{rDays.map(dt => <th key={dt} className="py-1.5 px-1 font-medium text-center">{dt.slice(5)}</th>)}</tr></thead>
              <tbody>{gridRows.map((row: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 pr-2 text-gray-700">{i === 0 || gridRows[i - 1].unit !== row.unit ? row.unit : ""}</td>
                  <td className={`py-1.5 pr-2 ${row.isSup ? "text-violet-700 font-medium" : "text-gray-600"}`}>{roleLabel[row.role] ?? row.role}</td>
                  {row.cells.map((cell: any, j: number) => {
                    const dot = cell.required === 0 ? "bg-gray-200" : cell.filled >= cell.required ? "bg-emerald-500" : cell.filled > 0 ? "bg-amber-400" : "bg-rose-400";
                    return <td key={j} className="py-1.5 px-1 text-center"><div className="flex items-center justify-center gap-1"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} /><span className="text-gray-700 tabular-nums" title={cell.names.join(", ")}>{cell.filled}/{cell.required}{!cell.validated && cell.filled > 0 ? "*" : ""}</span></div></td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-400"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Covered</span><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Partial</span><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Uncovered</span><span>* = override (no validated competency)</span><span className="ml-auto">{roster.slots_filled}/{roster.slots_total} posts · {roster.coverage_score}% cover · {roster.competency_score ?? "—"}% competency</span></div>
            </div>
          )}
        </div>

        {/* Constraint & risk alerts */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Constraint &amp; risk alerts</h3><span className="text-[10px] text-gray-400">{d.alerts.length}</span></div>
          {d.alerts.length === 0 ? <p className="text-sm text-gray-400">No constraint violations detected. 🎉</p> : <div className="space-y-2">{d.alerts.slice(0, 6).map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">⚠</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-800 truncate">{a.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV[a.sev]}`}>{a.sev}</span></div><p className="text-[11px] text-gray-500">{a.sub}</p></div></div>))}</div>}
        </div>
      </div>

      {/* Key metrics */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Key metrics <span className="text-[10px] text-gray-400 font-normal">this week</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
          <Metric label="Staff available" value={`${km.staffAvailableFte} FTE`} />
          <Metric label="Assigned" value={`${km.assignedFte}`} sub="staff" />
          <Metric label="Coverage score" value={km.coverageScore != null ? `${km.coverageScore}%` : "—"} />
          <Metric label="Competency match" value={km.competencyScore != null ? `${km.competencyScore}%` : "—"} />
          <Metric label="Overtime (proj.)" value={`${km.overtimeHrsWk} hrs`} />
          <Metric label="Agency (proj.)" value={`${km.agencyShifts}`} sub="shifts" />
          <Metric label="Est. cost" value={`£${km.estCost.toLocaleString()}`} />
          <Metric label="Roster fairness" value={`${km.fairnessScore}%`} />
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The AI Workforce Scheduling Engine (WSE-001) is the platform scheduling service&apos;s review dashboard. Coverage, required-vs-assigned, competency match, fairness and constraint alerts are computed from the <Link href="/unit-manager/workforce-management/establishment" className="text-emerald-700 hover:underline">Establishment engine</Link>&apos;s demand + live assignments (op_patient_assignments.competency_validated) + expiring competencies; cost/overtime/agency are derived from FTE gaps at a transparent blended rate (£{cost.rate}/hr). The roster generator is now REAL (WSE-001B, migration 080): a greedy demand-matching solver fills each unit&apos;s day/night posts from establishment demand + available staff (max 4 shifts/wk, one shift/day, competency-preferred), persists a versioned draft to op_rosters/op_roster_assignments and publishes on approval — no roster is published without Unit Manager approval, and below-safe coverage blocks publication unless an override reason is recorded. Unfilled posts are stored as &apos;uncovered&apos; (never fabricated). Availability uses the current staff pool (no future-leave store yet); the what-if simulator &amp; scenario planner remain next-phase. <Link href="/unit-manager" className="text-emerald-700 hover:underline">← Unit Manager</Link></p>
    </div>
  );
}
