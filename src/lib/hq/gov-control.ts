import { controlAssurance, type EffectivenessValue, type ControlAssurance } from "@/lib/hq/gov-evidence";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 §6 — CONTROLS AND ASSURANCE, read side.
//
// ⚠ EFFECTIVENESS IS DERIVED HERE AND STORED NOWHERE. Migration 322 gives gov_control no effectiveness
// columns at all, so this module is the only place either value is produced, and it produces them from
// the newest test of each basis.
//
// The two absence values are what the derivation is FOR:
//   no design test    -> "not_assessed"   (§6's design vocabulary)
//   no operating test -> "not_tested"     (§6's operating vocabulary, and §22's rule)
//
// ⚠ AND THE TWO VOCABULARIES ARE NOT INTERCHANGEABLE, WHICH IS WHY THEY ARE SEPARATE LISTS. A design
// nobody has reviewed is "not assessed"; an operation nobody has observed is "not tested". Collapsing
// them into one "unknown" would make a control that was designed well but never once run look the same
// as one nobody has thought about — and §6 separates the two questions precisely because a control can
// be in the first state indefinitely while everybody assumes it is working.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const CONTROL_TYPE_LABEL: Record<string, string> = {
  preventive: "Preventive", detective: "Detective", corrective: "Corrective",
};
export const EXECUTION_LABEL: Record<string, string> = {
  automated: "Automated", manual: "Manual", hybrid: "Hybrid",
};
export const FREQUENCY_LABEL: Record<string, string> = {
  continuous: "Continuous", event_driven: "Event-driven", daily: "Daily", weekly: "Weekly",
  monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", ad_hoc: "Ad hoc",
};

export type ControlRow = {
  controlId: string; reference: string; name: string; objective: string | null;
  controlType: string; execution: string; frequency: string;
  ownerName: string | null; evidenceRequirement: string | null;
  requiresIndependentTest: boolean; requiresApproval: boolean;
  nextTestDue: string | null; isActive: boolean;
  /** ⚠ DERIVED. There is no column behind either of these. */
  designEffectiveness: EffectivenessValue;
  operatingEffectiveness: EffectivenessValue;
  lastDesignTestAt: string | null;
  lastOperatingTestAt: string | null;
  /** §6: a control whose most recent operating test failed. Feeds §17's risk-reassessment trigger. */
  adverse: boolean;
  testCount: number;
};

export type ControlsRead = {
  rows: ControlRow[];
  assurance: ControlAssurance;
  truncated: boolean;
  /** ⚠ Overdue is computed only over controls that CARRY a due date. Nothing without one can be late. */
  testOverdue: number;
  withoutDueDate: number;
} | null;

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Every control with its derived assurance state.
 *
 * ⚠ RETURNS null ON A FAILED READ, NEVER AN EMPTY LIST. "No control exists" and "the control store
 * could not be read" produce identical screens if a loader collapses them, and one of the two is a
 * reason to build controls while the other is a reason to fix a database.
 */
export async function loadControls(admin: Admin): Promise<ControlsRead> {
  const PAGE = 500;
  const res = await admin.from("gov_control")
    .select("control_id, reference, name, objective, control_type, execution, frequency, owner_name,"
      + " evidence_requirement, requires_independent_test, requires_approval, next_test_due, is_active")
    .order("reference")
    .limit(PAGE + 1);
  if (res.error) return null;

  const raw = (res.data ?? []) as Record<string, unknown>[];
  const truncated = raw.length > PAGE;
  const controls = raw.slice(0, PAGE);

  // ⚠ ONE READ FOR EVERY TEST RATHER THAN ONE PER CONTROL. A per-control query would be N round trips
  // and — the part that actually bites — a failure on any one of them would silently leave that control
  // looking untested, which is a governance conclusion produced by a network error.
  const tests = await admin.from("gov_control_test")
    .select("control_id, basis, result, tested_at")
    .order("tested_at", { ascending: false })
    .limit(5000);
  if (tests.error) return null;

  const newest = new Map<string, { result: string; testedAt: string }>();
  const counts = new Map<string, number>();
  for (const t of (tests.data ?? []) as Record<string, unknown>[]) {
    const key = `${String(t.control_id)}:${String(t.basis)}`;
    // rows arrive newest first, so the first one seen for a key is the current state
    if (!newest.has(key)) newest.set(key, { result: String(t.result), testedAt: String(t.tested_at) });
    counts.set(String(t.control_id), (counts.get(String(t.control_id)) ?? 0) + 1);
  }

  const today = new Date().toISOString().slice(0, 10);
  let testOverdue = 0, withoutDueDate = 0;

  const rows: ControlRow[] = controls.map(c => {
    const id = String(c.control_id);
    const design = newest.get(`${id}:design`);
    const operating = newest.get(`${id}:operating`);
    const due = s(c.next_test_due);
    const active = c.is_active !== false;
    if (active && !due) withoutDueDate += 1;
    if (active && due && due < today) testOverdue += 1;

    return {
      controlId: id, reference: String(c.reference), name: String(c.name),
      objective: s(c.objective),
      controlType: String(c.control_type), execution: String(c.execution), frequency: String(c.frequency),
      ownerName: s(c.owner_name), evidenceRequirement: s(c.evidence_requirement),
      requiresIndependentTest: c.requires_independent_test === true,
      requiresApproval: c.requires_approval === true,
      nextTestDue: due, isActive: active,
      // ⚠ THE TWO ABSENCES, EACH IN ITS OWN VOCABULARY
      designEffectiveness: (design?.result as EffectivenessValue) ?? "not_assessed",
      operatingEffectiveness: (operating?.result as EffectivenessValue) ?? "not_tested",
      lastDesignTestAt: design?.testedAt ?? null,
      lastOperatingTestAt: operating?.testedAt ?? null,
      adverse: operating?.result === "ineffective" || operating?.result === "partial",
      testCount: counts.get(id) ?? 0,
    };
  });

  return {
    rows,
    assurance: controlAssurance(rows),
    truncated,
    testOverdue,
    withoutDueDate,
  };
}
