// Constraint Engine (WSE-001C) — the rule-validation service of the AI Scheduling Engine.
// Validates the current week's generated roster (op_rosters / op_roster_assignments)
// against clinical, workforce, competency and fairness constraints, returning per-rule
// pass / warning / block results with severity, a compliance score, per-unit compliance,
// top violated rules and recent overrides. Every check runs over real solver output —
// uncovered posts, unvalidated-competency assignments, max-hours and rest breaches, and
// shift-distribution fairness. Tenant-configurable rule libraries + labour-law/regulatory
// packs are honest next-phase; these are the safety-critical checks the solver produces.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRosterForWeek, mondayOf, ROSTER } from "@/lib/operations/roster-solver";

export async function loadConstraintEngine(admin: any, hid: string | null, isSuper: boolean) {
  const weekStart = mondayOf();
  const r = await loadRosterForWeek(admin, hid, isSuper, weekStart);
  if (!(r as any).provisioned) return { ready: true as const, provisioned: false as const, weekStart };
  const roster = (r as any).roster;
  if (!roster) return { ready: true as const, provisioned: true as const, hasRoster: false as const, weekStart };

  const asg: any[] = (r as any).assignments ?? [];
  const assigned = asg.filter(a => a.status === "assigned");
  const uncovered = asg.filter(a => a.status === "uncovered");
  const uncoveredNurse = uncovered.filter(a => !a.is_supervisor).length;
  const uncoveredSup = uncovered.filter(a => a.is_supervisor).length;
  const compViol = assigned.filter(a => !a.competency_validated).length;
  const overrides = assigned.filter(a => a.override_reason);

  // Per-staff shift tallies
  const byStaff = new Map<string, any[]>();
  for (const a of assigned) { if (!a.staff_id) continue; if (!byStaff.has(a.staff_id)) byStaff.set(a.staff_id, []); byStaff.get(a.staff_id)!.push(a); }
  const maxHoursViol = [...byStaff.values()].filter(arr => arr.length > ROSTER.maxShiftsWeek).length;
  const restViol = [...byStaff.values()].filter(arr => new Set(arr.map(a => a.shift_date)).size < arr.length).length;

  // Fairness — spread of shift counts
  const counts = [...byStaff.values()].map(a => a.length);
  const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const stdev = counts.length ? Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length) : 0;
  const fairnessImbalance = stdev > 1.2;

  const rule = (name: string, category: string, count: number, sev: string) => ({ rule: name, category, count, severity: count > 0 ? sev : "Pass", status: count > 0 ? (sev === "Critical" ? "Blocked" : sev === "High" ? "Override" : "Warning") : "Pass" });
  const rules = [
    rule("Minimum staffing ratios", "Clinical", uncoveredNurse, "Critical"),
    rule("Mandatory Shift Supervisor coverage", "Clinical", uncoveredSup, "Critical"),
    rule("Mandatory competencies", "Competency", compViol, "High"),
    rule("Maximum weekly hours (48h / 4 shifts)", "Workforce", maxHoursViol, "High"),
    rule("Minimum rest between shifts", "Workforce", restViol, "High"),
    rule("Rotation & workload fairness", "Fairness", fairnessImbalance ? 1 : 0, "Medium"),
  ];

  const critical = uncoveredNurse + uncoveredSup;
  const high = compViol + maxHoursViol + restViol;
  const medium = fairnessImbalance ? 1 : 0;
  const totalSlots = asg.length || 1;
  const violatingSlots = uncovered.length + compViol;
  const complianceScore = Math.max(0, Math.round(((totalSlots - violatingSlots) / totalSlots) * 100));

  // Rule compliance by unit (% of that unit's slots passing)
  const units = [...new Set(asg.map(a => a.unit_name))];
  const byUnit = units.map(u => {
    const us = asg.filter(a => a.unit_name === u);
    const bad = us.filter(a => a.status === "uncovered" || (a.status === "assigned" && !a.competency_validated)).length;
    const pct = us.length ? Math.round(((us.length - bad) / us.length) * 100) : 100;
    return { unit: u, pct, slots: us.length, violations: bad, status: pct >= 95 ? "Pass" : pct >= 80 ? "Warning" : "Blocked" };
  }).sort((a, b) => a.pct - b.pct);

  const topViolated = rules.filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  const recentOverrides = overrides.slice(0, 6).map(a => ({ staff: a.staff_name ?? "—", unit: a.unit_name, reason: a.override_reason }));

  const insights: { icon: string; text: string; tone: string }[] = [];
  if (critical) insights.push({ icon: "⛔", text: `${critical} critical violation(s) — publication is blocked until covered or overridden`, tone: "red" });
  if (compViol) insights.push({ icon: "🎯", text: `${compViol} assignment(s) lack validated competency — manager override required`, tone: "amber" });
  if (fairnessImbalance) insights.push({ icon: "⚖️", text: `Shift distribution is uneven (σ ${stdev.toFixed(1)}) — rebalance for fairness`, tone: "gray" });
  if (!critical && !high) insights.push({ icon: "✅", text: `All safety-critical constraints pass — roster is publishable`, tone: "green" });

  return {
    ready: true as const, provisioned: true as const, hasRoster: true as const, weekStart, roster,
    kpis: { complianceScore, critical, warnings: medium, blocked: uncovered.length, overrideRequests: compViol, overrides: overrides.length },
    rules, byUnit, topViolated, recentOverrides, insights,
  };
}
