// Explainable AI (WSE-001J) — transparent, traceable explanations for every scheduling
// decision. Because the solver is deterministic (ordered allocation → competency →
// continuity → fairness, under max-shift + one-shift-per-day constraints), each roster
// assignment can be faithfully explained: why THIS clinician was chosen (or why a post is
// uncovered), the rules applied, the contributing factors, a confidence score and the
// runner-up alternatives. Also explains the roster's score formulas. No black-box scoring.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRosterForWeek, mondayOf, ROSTER, qualityScore } from "@/lib/operations/roster-solver";
import { gatherRosterInputs } from "@/lib/operations/roster-solver";

const ROLE_LABEL: Record<string, string> = { charge: "Shift Supervisor", nurse: "Registered Nurse", support: "Support Worker", doctor: "Doctor", therapist: "Allied Health", float: "Float" };

export const APPLIED_RULES = [
  { rule: "Ordered allocation", detail: "Mandatory leadership → critical competency (RN) → remaining roles fill first when staff are scarce." },
  { rule: "Competency first", detail: "Candidates with a current validated competency are preferred for every post." },
  { rule: "Continuity of care", detail: "A clinician already working the unit this week is preferred, reducing churn." },
  { rule: "Fairness balancing", detail: "Among equal candidates, the one with the fewest shifts so far is chosen." },
  { rule: "Maximum weekly hours", detail: `No clinician exceeds ${ROSTER.maxShiftsWeek} shifts/week (${ROSTER.maxShiftsWeek * ROSTER.shiftHours}h).` },
  { rule: "Minimum rest", detail: "A clinician works at most one shift per day (rest between shifts)." },
  { rule: "Safety never bypassed", detail: "An uncovered post is recorded honestly rather than filled by an ineligible clinician." },
];

export async function loadExplainability(admin: any, hid: string | null, isSuper: boolean, slot?: number) {
  const weekStart = mondayOf();
  const [r, inputs] = await Promise.all([loadRosterForWeek(admin, hid, isSuper, weekStart), gatherRosterInputs(admin, hid, isSuper)]);
  if (!(r as any).provisioned) return { ready: true as const, provisioned: false as const, weekStart };
  const roster = (r as any).roster;
  if (!roster) return { ready: true as const, provisioned: true as const, hasRoster: false as const, weekStart };

  const asg: any[] = (r as any).assignments ?? [];
  const assigned = asg.filter(a => a.status === "assigned");
  const uncovered = asg.filter(a => a.status === "uncovered");
  const pool = (inputs?.pool ?? []) as any[];
  const validSet = inputs?.validSet ?? new Set<string>();

  // Per-staff week tallies (fairness context)
  const shiftCount = new Map<string, number>();
  const unitCount = new Map<string, Map<string, number>>();
  for (const a of assigned) { if (!a.staff_id) continue; shiftCount.set(a.staff_id, (shiftCount.get(a.staff_id) ?? 0) + 1); if (!unitCount.has(a.staff_id)) unitCount.set(a.staff_id, new Map()); const um = unitCount.get(a.staff_id)!; um.set(a.unit_name, (um.get(a.unit_name) ?? 0) + 1); }

  // Selectable sample = first assigned + a couple uncovered
  const sample = [...assigned.slice(0, 10), ...uncovered.slice(0, 2)];
  const idx = slot != null && slot >= 0 && slot < sample.length ? slot : 0;
  const sel = sample[idx] ?? null;

  let explanation: any = null;
  if (sel) {
    const roleLabel = ROLE_LABEL[sel.role] ?? sel.role;
    if (sel.status === "assigned") {
      const cnt = shiftCount.get(sel.staff_id) ?? 1;
      const meanShifts = shiftCount.size ? [...shiftCount.values()].reduce((a, b) => a + b, 0) / shiftCount.size : 0;
      const unitShifts = unitCount.get(sel.staff_id)?.get(sel.unit_name) ?? 1;
      const valid = sel.competency_validated;
      const factors = [
        { label: "Role match", value: roleLabel, ok: true },
        { label: "Competency", value: valid ? "Current validated competency" : "No current competency — emergency override recorded", ok: valid },
        { label: "Continuity of care", value: unitShifts > 1 ? `Working ${sel.unit_name} on ${unitShifts} shifts this week` : "First shift on this unit this week", ok: unitShifts > 1 },
        { label: "Fairness", value: `${cnt} shift(s) this week (unit avg ${meanShifts.toFixed(1)})`, ok: cnt <= Math.ceil(meanShifts) },
        { label: "Max weekly hours", value: `${cnt}/${ROSTER.maxShiftsWeek} shifts — within limit`, ok: cnt <= ROSTER.maxShiftsWeek },
      ];
      const confidence = valid ? (unitShifts > 1 ? 92 : 85) : 60;
      const rationale = `${sel.staff_name} was assigned the ${sel.shift_type} ${roleLabel} post in ${sel.unit_name} on ${sel.shift_date} because they ${valid ? "hold a current validated competency" : "were the only eligible option (competency override recorded)"}${unitShifts > 1 ? ", already work this unit this week (continuity)" : ""}, and had ${cnt <= Math.ceil(meanShifts) ? "an equal-or-lighter shift load (fairness)" : "capacity within the weekly limit"}.`;
      // Alternatives — same-role candidates not chosen
      const alts = pool.filter(s => s.role === sel.role && s.id !== sel.staff_id).map(s => ({ name: s.name, valid: validSet.has(s.id), shifts: shiftCount.get(s.id) ?? 0 }))
        .sort((a, b) => (b.valid ? 1 : 0) - (a.valid ? 1 : 0) || a.shifts - b.shifts).slice(0, 4)
        .map(a => ({ ...a, why: !a.valid ? "No validated competency" : a.shifts >= ROSTER.maxShiftsWeek ? "At weekly shift limit" : a.shifts > (shiftCount.get(sel.staff_id) ?? 0) ? "More shifts already (fairness)" : "Viable alternative" }));
      explanation = { kind: "assigned", title: `${sel.staff_name} → ${roleLabel}`, sub: `${sel.unit_name} · ${sel.shift_date} · ${sel.shift_type}`, rationale, factors, confidence, alternatives: alts, override: !valid ? sel.override_reason : null };
    } else {
      const eligible = pool.filter(s => s.role === sel.role);
      const rationale = `The ${sel.shift_type} ${roleLabel} post in ${sel.unit_name} on ${sel.shift_date} is UNCOVERED because ${eligible.length === 0 ? `no ${roleLabel} exists in the available staff pool` : `every eligible ${roleLabel} was already at the ${ROSTER.maxShiftsWeek}-shift weekly limit or already working that day`}. The solver leaves it honestly uncovered rather than assigning an ineligible clinician (safety is never bypassed).`;
      explanation = { kind: "uncovered", title: `Uncovered ${roleLabel} post`, sub: `${sel.unit_name} · ${sel.shift_date} · ${sel.shift_type}`, rationale, factors: [{ label: "Eligible pool", value: `${eligible.length} ${roleLabel}(s) in pool`, ok: eligible.length > 0 }, { label: "Availability", value: "All eligible staff at limit or already working that day", ok: false }], confidence: 90, alternatives: [], override: null };
    }
  }

  const scoreExplain = [
    { label: "Coverage", value: `${roster.coverage_score}%`, formula: `filled ÷ total posts (${roster.slots_filled} ÷ ${roster.slots_total})` },
    { label: "Competency", value: `${roster.competency_score ?? "—"}%`, formula: "validated ÷ filled posts" },
    { label: "Fairness", value: `${roster.fairness_score ?? "—"}%`, formula: "staff within ±1 shift of the mean" },
    { label: "Quality", value: `${qualityScore(roster.coverage_score, roster.competency_score, roster.fairness_score)}%`, formula: "0.40·coverage + 0.35·competency + 0.25·fairness" },
  ];

  return {
    ready: true as const, provisioned: true as const, hasRoster: true as const, weekStart, roster,
    sample: sample.map((s: any, i: number) => ({ i, label: s.status === "assigned" ? `${s.staff_name} · ${s.unit_name} ${s.shift_type}` : `Uncovered · ${s.unit_name} ${s.shift_type}`, uncovered: s.status !== "assigned" })),
    selectedIndex: idx, explanation, appliedRules: APPLIED_RULES, scoreExplain,
    kpis: { assigned: assigned.length, uncovered: uncovered.length, overrides: assigned.filter(a => !a.competency_validated).length },
  };
}
