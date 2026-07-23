// AI Scheduling Engine solver (WSE-001B). A real, deterministic greedy demand-matching
// scheduler: it takes the Establishment engine's per-shift demand by unit + the available
// staff pool + competency status, then fills each unit × day × shift × role post for the
// week — preferring competency-current staff and distributing shifts fairly, under a
// max-shifts-per-week and one-shift-per-day (rest) constraint. Posts it can't fill are
// recorded as 'uncovered' (never fabricated), so coverage/competency scores reflect
// reality. Availability uses the current rostered staff pool (no future leave store yet →
// stated assumption). Pure compute (computeRoster) + input gathering + persisted-roster
// readback, so the API just orchestrates + audits.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
export const ROSTER = { maxShiftsWeek: 4, shiftHours: 12, ratePerHour: 25 }; // 4×12h = 48h cap
const SHIFTS: ("day" | "night")[] = ["day", "night"];

export function mondayOf(d = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay(); // 0 Sun..6 Sat
  dt.setUTCDate(dt.getUTCDate() - ((day + 6) % 7));
  return dt.toISOString().slice(0, 10);
}
function weekDates(weekStart: string): string[] {
  const out: string[] = []; const base = new Date(weekStart + "T00:00:00Z");
  for (let i = 0; i < 7; i++) { const d = new Date(base); d.setUTCDate(base.getUTCDate() + i); out.push(d.toISOString().slice(0, 10)); }
  return out;
}

type Staff = { id: string; name: string; role: string };
type Plan = { assignments: any[]; scores: { coverage: number; competency: number; fairness: number; quality: number; estCost: number }; slotsTotal: number; slotsFilled: number };

// Allocation priority (spec §Workflow): mandatory leadership → critical competency
// (RN) → remaining roles. Guarantees mandatory roles fill first when resources are scarce.
const rolePriority = (role: string) => (role === "charge" ? 0 : role === "nurse" ? 1 : 2);

// Pure greedy solver. Ordered allocation, competency-first with continuity-of-care and
// fairness balancing in candidate scoring.
export function computeRoster(units: any[], pool: Staff[], validSet: Set<string>, weekStart: string, deptIdByName: Map<string, string>): Plan {
  const days = weekDates(weekStart);
  const assignments: any[] = [];
  const shiftCount = new Map<string, number>();
  const dayUsed = new Map<string, Set<string>>(); // staffId → dates worked
  const unitByStaff = new Map<string, Set<string>>(); // staffId → units worked (continuity)
  let slotsTotal = 0, slotsFilled = 0, validatedFilled = 0;

  // Flatten (unit, roleReq) into slot groups, ordered by role priority so leadership and
  // critical-competency positions are allocated across all units before remaining roles.
  const groups = units.flatMap((u: any) => u.roleReq.map((rr: any) => ({ u, rr }))).sort((a: any, b: any) => rolePriority(a.rr.role) - rolePriority(b.rr.role));

  for (const { u, rr } of groups) {
    const isSup = rr.role === "charge";
    const rolePool = pool.filter(s => s.role === rr.role);
    for (const date of days) {
      for (const shift of SHIFTS) {
        for (let k = 0; k < rr.perShift; k++) {
          slotsTotal++;
          const cands = rolePool.filter(s => (shiftCount.get(s.id) ?? 0) < ROSTER.maxShiftsWeek && !(dayUsed.get(s.id)?.has(date)));
          cands.sort((a, b) => {
            const va = validSet.has(a.id) ? 1 : 0, vb = validSet.has(b.id) ? 1 : 0;
            if (vb !== va) return vb - va;                                    // 1. competency
            const cua = unitByStaff.get(a.id)?.has(u.unit) ? 1 : 0, cub = unitByStaff.get(b.id)?.has(u.unit) ? 1 : 0;
            if (cub !== cua) return cub - cua;                                // 2. continuity of care
            return (shiftCount.get(a.id) ?? 0) - (shiftCount.get(b.id) ?? 0); // 3. fairness (fewest shifts)
          });
          const pick = cands[0];
          const base = { department_id: deptIdByName.get(u.unit) ?? null, unit_name: u.unit, shift_date: date, shift_type: shift, role: rr.role, is_supervisor: isSup };
          if (pick) {
            const valid = validSet.has(pick.id);
            slotsFilled++; if (valid) validatedFilled++;
            shiftCount.set(pick.id, (shiftCount.get(pick.id) ?? 0) + 1);
            if (!dayUsed.has(pick.id)) dayUsed.set(pick.id, new Set());
            dayUsed.get(pick.id)!.add(date);
            if (!unitByStaff.has(pick.id)) unitByStaff.set(pick.id, new Set());
            unitByStaff.get(pick.id)!.add(u.unit);
            assignments.push({ ...base, staff_id: pick.id, staff_name: pick.name, competency_validated: valid, override_reason: valid ? null : "No current validated competency (solver auto-fill)", status: "assigned" });
          } else {
            assignments.push({ ...base, staff_id: null, staff_name: null, competency_validated: false, override_reason: null, status: "uncovered" });
          }
        }
      }
    }
  }

  const worked = [...shiftCount.values()];
  const mean = worked.length ? worked.reduce((a, b) => a + b, 0) / worked.length : 0;
  const withinRange = worked.filter(c => Math.abs(c - mean) <= 1).length;
  const fairness = worked.length ? Math.round((withinRange / worked.length) * 100) : 100;
  const coverage = slotsTotal ? Math.round((slotsFilled / slotsTotal) * 100) : 0;
  const competency = slotsFilled ? Math.round((validatedFilled / slotsFilled) * 100) : 0;

  return {
    assignments,
    scores: {
      coverage, competency, fairness,
      quality: qualityScore(coverage, competency, fairness),
      estCost: Math.round(slotsFilled * ROSTER.shiftHours * ROSTER.ratePerHour),
    },
    slotsTotal, slotsFilled,
  };
}

// Overall schedule quality score (spec: calculated for every roster) — a weighted blend
// of coverage (safety), competency (safe skill mix) and fairness.
export function qualityScore(coverage: number | null, competency: number | null, fairness: number | null): number {
  return Math.round(0.4 * (coverage ?? 0) + 0.35 * (competency ?? 0) + 0.25 * (fairness ?? 0));
}

// Gather solver inputs from live data.
export async function gatherRosterInputs(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [est, ops] = await Promise.all([loadEstablishment(admin, hid, isSuper) as Promise<any>, loadOpsConsoleData(admin, hid, isSuper)]);
  if (!est.ready || !ops.ready) return null;
  const seen = new Set<string>(); const pool: Staff[] = [];
  for (const s of ops.data.shiftStaff) { if (s.staff_id && !seen.has(s.staff_id)) { seen.add(s.staff_id); pool.push({ id: s.staff_id, name: s.profiles?.full_name ?? "Staff", role: s.role }); } }
  const today = new Date().toISOString().slice(0, 10);
  const validSet = new Set<string>();
  try { const { data } = await scope(admin.from("competency_decisions").select("nurse_id, outcome, expiry_date").in("outcome", PASSING)); for (const d of data ?? []) if (d.nurse_id && (!d.expiry_date || d.expiry_date >= today)) validSet.add(d.nurse_id); } catch { /* fail-soft */ }
  const deptIdByName = new Map<string, string>();
  try { const { data } = await scope(admin.from("departments").select("id, name")); for (const d of data ?? []) if (d.name) deptIdByName.set(d.name, d.id); } catch { /* fail-soft */ }
  return { units: est.units, pool, validSet, deptIdByName };
}

// Read the latest persisted roster for a week, grouped for the grid.
export async function loadRosterForWeek(admin: any, hid: string | null, isSuper: boolean, weekStart: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("op_rosters").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };
  const { data: rosters } = await scope(admin.from("op_rosters").select("*").eq("week_start", weekStart).order("generated_at", { ascending: false })).limit(1);
  const roster = (rosters ?? [])[0] ?? null;
  if (!roster) return { provisioned: true as const, roster: null };
  const { data: asg } = await admin.from("op_roster_assignments").select("*").eq("roster_id", roster.id).limit(5000);
  return { provisioned: true as const, roster, assignments: asg ?? [], days: weekDates(weekStart) };
}
