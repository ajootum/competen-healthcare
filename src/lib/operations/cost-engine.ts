// Cost Optimisation Engine (WSE-001F) — analyses staffing cost over the generated roster
// without compromising safety. Prices every assigned shift from a transparent, configurable
// role-rate model (base £/hr by role + night differential + overtime premium), derives
// overtime (hours beyond the 37.5h contract), projected agency spend to cover uncovered
// posts, an establishment-based budget with variance, cost-per-patient-day and month-end
// projection, plus rule-based savings recommendations. Real pay grades / shift
// differentials / agency contracts / department budgets need a payroll+finance store →
// the rate assumptions are shown verbatim so the numbers are auditable, not a black box.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";
import { loadEstablishment } from "@/lib/operations/establishment";

// Configurable cost model (defaults — a per-tenant payroll/finance store is next-phase).
export const COST_MODEL = {
  roleRate: { charge: 32, nurse: 25, doctor: 45, therapist: 28, support: 15, float: 27, educator: 30, assessor: 30 } as Record<string, number>,
  nightMultiplier: 1.3,
  overtimeMultiplier: 1.5,
  agencyMultiplier: 1.8,
  shiftHours: 12,
  contractHoursWeek: 37.5,
  blendedRate: 25,
};

export async function loadCostEngine(admin: any, hid: string | null, isSuper: boolean) {
  const weekStart = mondayOf();
  const [r, est] = await Promise.all([loadRosterForWeek(admin, hid, isSuper, weekStart), loadEstablishment(admin, hid, isSuper) as Promise<any>]);
  if (!(r as any).provisioned) return { ready: true as const, provisioned: false as const, weekStart };
  const roster = (r as any).roster;
  if (!roster) return { ready: true as const, provisioned: true as const, hasRoster: false as const, weekStart };

  const m = COST_MODEL;
  const rate = (role: string) => m.roleRate[role] ?? m.blendedRate;
  const asg: any[] = ((r as any).assignments ?? []);
  const assigned = asg.filter(a => a.status === "assigned");
  const uncovered = asg.filter(a => a.status === "uncovered");

  // Base labour cost (with night differential) + per-role breakdown
  let grossCost = 0;
  const byRole = new Map<string, { hours: number; cost: number }>();
  for (const a of assigned) {
    const c = m.shiftHours * rate(a.role) * (a.shift_type === "night" ? m.nightMultiplier : 1);
    grossCost += c;
    const cur = byRole.get(a.role) ?? { hours: 0, cost: 0 }; cur.hours += m.shiftHours; cur.cost += c; byRole.set(a.role, cur);
  }

  // Overtime — hours beyond the weekly contract, per staff
  const shiftsByStaff = new Map<string, any[]>();
  for (const a of assigned) { if (!a.staff_id) continue; if (!shiftsByStaff.has(a.staff_id)) shiftsByStaff.set(a.staff_id, []); shiftsByStaff.get(a.staff_id)!.push(a); }
  let overtimeHours = 0, overtimePremium = 0;
  for (const arr of shiftsByStaff.values()) {
    const hrs = arr.length * m.shiftHours;
    const ot = Math.max(0, hrs - m.contractHoursWeek);
    if (ot > 0) { overtimeHours += ot; overtimePremium += ot * rate(arr[0].role) * (m.overtimeMultiplier - 1); }
  }
  overtimeHours = Math.round(overtimeHours); overtimePremium = Math.round(overtimePremium);

  const totalLabour = Math.round(grossCost + overtimePremium);
  const agencyProjected = Math.round(uncovered.length * m.shiftHours * m.blendedRate * m.agencyMultiplier);

  // Establishment-based budget + variance
  const weeklyBudget = est.ready ? Math.round(est.kpis.totalRequired * m.contractHoursWeek * m.blendedRate) : null;
  const variance = weeklyBudget != null ? totalLabour - weeklyBudget : null;
  const occupied = est.ready ? est.units.reduce((n: number, u: any) => n + (u.occupied ?? 0), 0) : 0;
  const patientDays = occupied * 7;
  const costPerPatientDay = patientDays ? Math.round(totalLabour / patientDays) : null;
  const monthEnd = Math.round(totalLabour * 4.33);

  const roleBreakdown = [...byRole.entries()].map(([role, v]) => ({ role, hours: v.hours, cost: Math.round(v.cost), pct: grossCost ? Math.round((v.cost / grossCost) * 100) : 0 })).sort((a, b) => b.cost - a.cost);

  // Savings recommendations
  const recs: { title: string; sub: string; saving: number | null }[] = [];
  if (overtimePremium > 0) recs.push({ title: "Reduce premium overtime", sub: `${overtimeHours} OT hours across ${[...shiftsByStaff.values()].filter(a => a.length * m.shiftHours > m.contractHoursWeek).length} staff`, saving: overtimePremium });
  if (uncovered.length > 0) recs.push({ title: "Fill gaps with permanent staff before agency", sub: `${uncovered.length} uncovered post(s) would cost ~£${agencyProjected.toLocaleString()} via agency`, saving: Math.round(agencyProjected - uncovered.length * m.shiftHours * m.blendedRate) });
  const chargeCost = byRole.get("charge")?.cost ?? 0;
  if (grossCost && chargeCost / grossCost > 0.3) recs.push({ title: "Review senior skill-mix cost", sub: `Leadership is ${Math.round((chargeCost / grossCost) * 100)}% of labour cost`, saving: null });
  if (!recs.length) recs.push({ title: "Roster is cost-efficient", sub: "No overtime or agency exposure this week", saving: null });
  const totalSavings = recs.reduce((n, x) => n + (x.saving ?? 0), 0);

  return {
    ready: true as const, provisioned: true as const, hasRoster: true as const, weekStart, roster, model: m,
    kpis: { totalLabour, weeklyBudget, variance, overtimePremium, overtimeHours, agencyProjected, agencyShifts: uncovered.length, costPerPatientDay, monthEnd, totalSavings },
    roleBreakdown, recs,
  };
}
