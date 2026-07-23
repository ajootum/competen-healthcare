// What-if Simulator (WSE-001H) — interactive workforce simulation. Re-runs the real
// solver with user-set parameters (staff absences, census surge %, added bank capacity)
// and returns a before-vs-after comparison plus fatigue and patient-safety risk — all
// transient, never touching a live roster (isolated from production, per acceptance).
// Distinct from the Scenario Planner's pre-modelled library: here the manager sets the
// levers. Applying a simulation regenerates the live roster from real data (hypothetical
// inputs are planning-only).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { gatherRosterInputs, computeRoster, mondayOf, ROSTER } from "@/lib/operations/roster-solver";

export type WhatIfParams = { absent: number; surge: number; bank: number };

function maxConsecutive(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0, run = 0, prev: number | null = null;
  for (const d of sorted) { const t = new Date(d + "T00:00:00Z").getTime() / 864e5; if (prev != null && t - prev === 1) run++; else run = 1; prev = t; best = Math.max(best, run); }
  return best;
}
function riskFrom(plan: any) {
  const assigned = plan.assignments.filter((a: any) => a.status === "assigned" && a.staff_id);
  const uncovered = plan.assignments.filter((a: any) => a.status === "uncovered");
  const byStaff = new Map<string, string[]>();
  for (const a of assigned) { if (!byStaff.has(a.staff_id)) byStaff.set(a.staff_id, []); byStaff.get(a.staff_id)!.push(a.shift_date); }
  const fatigued = [...byStaff.values()].filter(ds => ds.length > ROSTER.maxShiftsWeek || maxConsecutive(ds) >= 5).length;
  const uncoveredSup = uncovered.filter((a: any) => a.is_supervisor).length;
  const coverage = plan.scores.coverage;
  return {
    fatigued, uncovered: uncovered.length, uncoveredSup,
    fatigueRisk: fatigued >= 3 ? "High" : fatigued > 0 ? "Medium" : "Low",
    safetyRisk: uncoveredSup > 0 || coverage < 75 ? "High" : coverage < 90 ? "Medium" : "Low",
  };
}

export async function loadWhatIf(admin: any, hid: string | null, isSuper: boolean, p: WhatIfParams) {
  const inputs = await gatherRosterInputs(admin, hid, isSuper);
  if (!inputs || inputs.units.length === 0) return { ready: false as const };
  const weekStart = mondayOf();

  const base = computeRoster(inputs.units, inputs.pool, inputs.validSet, weekStart, inputs.deptIdByName);

  // Apply parameters
  let units = inputs.units, pool = inputs.pool; const validSet = new Set(inputs.validSet);
  if (p.surge > 0) { const f = 1 + p.surge / 100; units = units.map((u: any) => ({ ...u, roleReq: u.roleReq.map((r: any) => ({ ...r, perShift: r.role === "charge" ? r.perShift : Math.max(r.perShift, Math.ceil(r.perShift * f)) })) })); }
  if (p.absent > 0) { const order = [...pool].sort((a, b) => (a.role === "charge" ? 1 : 0) - (b.role === "charge" ? 1 : 0)); const rm = new Set(order.slice(order.length - p.absent).map(s => s.id)); pool = pool.filter(s => !rm.has(s.id)); }
  if (p.bank > 0) { const extra = Array.from({ length: p.bank }, (_, j) => ({ id: `bank-${j}`, name: `Bank RN ${j + 1}`, role: "nurse" })); pool = [...pool, ...extra]; extra.forEach(s => validSet.add(s.id)); }
  const after = computeRoster(units, pool, validSet, weekStart, inputs.deptIdByName);

  const risk = riskFrom(after);
  const baseRisk = riskFrom(base);
  const metrics = [
    { label: "Coverage", before: base.scores.coverage, after: after.scores.coverage, unit: "%", invert: false },
    { label: "Competency", before: base.scores.competency, after: after.scores.competency, unit: "%", invert: false },
    { label: "Fairness", before: base.scores.fairness, after: after.scores.fairness, unit: "%", invert: false },
    { label: "Quality", before: base.scores.quality, after: after.scores.quality, unit: "%", invert: false },
    { label: "Est. cost", before: base.scores.estCost, after: after.scores.estCost, unit: "£", invert: true },
    { label: "Uncovered posts", before: base.slotsTotal - base.slotsFilled, after: after.slotsTotal - after.slotsFilled, unit: "", invert: true },
  ].map(m => ({ ...m, delta: m.after - m.before }));

  const changed = p.absent > 0 || p.surge > 0 || p.bank > 0;
  const insights: { icon: string; text: string; tone: string }[] = [];
  if (!changed) insights.push({ icon: "🎛️", text: "Set parameters to simulate — nothing changes the live roster", tone: "gray" });
  else {
    const covDelta = after.scores.coverage - base.scores.coverage;
    if (covDelta < 0) insights.push({ icon: "⚠", text: `Coverage falls ${covDelta} pts to ${after.scores.coverage}% — ${risk.uncovered} post(s) uncovered`, tone: "red" });
    else if (covDelta > 0) insights.push({ icon: "📈", text: `Coverage rises ${covDelta} pts to ${after.scores.coverage}%`, tone: "green" });
    if (risk.fatigueRisk !== "Low") insights.push({ icon: "😴", text: `${risk.fatigued} staff at fatigue risk (>4 shifts or ≥5 consecutive days)`, tone: "amber" });
    if (risk.uncoveredSup) insights.push({ icon: "⛔", text: `${risk.uncoveredSup} shift(s) without a supervisor — patient-safety critical`, tone: "red" });
    const costDelta = after.scores.estCost - base.scores.estCost;
    if (costDelta !== 0) insights.push({ icon: "💷", text: `Estimated cost ${costDelta > 0 ? "up" : "down"} £${Math.abs(costDelta).toLocaleString()}`, tone: "gray" });
  }

  return { ready: true as const, weekStart, params: p, changed, metrics, risk, baseRisk, insights, staffPool: inputs.pool.length };
}
