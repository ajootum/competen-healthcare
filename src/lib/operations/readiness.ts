// Shift readiness checklist (SSW-002 §6.4 / §9.3). The item catalogue lives here
// (not in the DB) so it can evolve without a migration; shift_readiness_records
// stores per-(shift,item) status. Mandatory items gate activation (§10.1) — the
// engine will not let a shift go ACTIVE while a mandatory item is outstanding.
// Everything is fail-soft: before migration 064 runs, loadReadiness reports the
// feature as not provisioned rather than throwing, and the gate falls back to
// inferred preconditions.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ReadinessItem = { code: string; label: string; mandatory: boolean };

// SSW-002 §6.4 readiness domains. `mandatory` = must be satisfied to activate.
export const READINESS_ITEMS: ReadinessItem[] = [
  { code: "supervisor_confirmed", label: "Supervisor confirmed", mandatory: true },
  { code: "staffing_confirmed", label: "Staffing confirmed", mandatory: true },
  { code: "competency_coverage", label: "Competency coverage confirmed", mandatory: true },
  { code: "census_reviewed", label: "Patient census reviewed", mandatory: true },
  { code: "high_risk_identified", label: "High-risk patients identified", mandatory: false },
  { code: "equipment_checked", label: "Equipment readiness checked", mandatory: false },
  { code: "emergency_equipment", label: "Emergency equipment checked", mandatory: true },
  { code: "bed_status_confirmed", label: "Bed status confirmed", mandatory: false },
  { code: "isolation_reviewed", label: "Isolation capacity reviewed", mandatory: false },
  { code: "escalations_reviewed", label: "Pending escalations reviewed", mandatory: true },
  { code: "tasks_reviewed", label: "Unresolved tasks reviewed", mandatory: false },
  { code: "handover_received", label: "Handover received", mandatory: true },
  { code: "safety_huddle_prepared", label: "Safety huddle prepared", mandatory: false },
];
export const READINESS_CODES = READINESS_ITEMS.map(i => i.code);
export const READINESS_STATUSES = ["pending", "complete", "exception", "not_applicable"];

// complete / not_applicable / documented exception all satisfy the gate (§10.1
// permits activation with an authorised, documented exception).
const isDone = (s: string) => s === "complete" || s === "not_applicable" || s === "exception";

export async function loadReadiness(admin: any, shiftId: string | null) {
  const mandatoryTotal = READINESS_ITEMS.filter(i => i.mandatory).length;
  if (!shiftId) {
    return { provisioned: true, noShift: true, items: READINESS_ITEMS.map(i => ({ ...i, status: "pending", responsible: null, completedAt: null, exception: null })), mandatoryTotal, mandatoryComplete: 0, allComplete: false };
  }
  const res = await admin.from("shift_readiness_records")
    .select("item_code, status, responsible_name, completed_at, exception_reason, escalation_required")
    .eq("shift_id", shiftId);
  if (res.error) {
    if (/does not exist|schema cache/i.test(String(res.error.message))) return { provisioned: false as const };
    return { provisioned: true, error: true, items: [], mandatoryTotal, mandatoryComplete: 0, allComplete: false };
  }
  const byCode = new Map((res.data ?? []).map((r: any) => [r.item_code, r]));
  const items = READINESS_ITEMS.map(i => {
    const r: any = byCode.get(i.code);
    return { ...i, status: r?.status ?? "pending", responsible: r?.responsible_name ?? null, completedAt: r?.completed_at ?? null, exception: r?.exception_reason ?? null };
  });
  const mand = items.filter(i => i.mandatory);
  const mandatoryComplete = mand.filter(i => isDone(i.status)).length;
  return { provisioned: true as const, items, mandatoryTotal, mandatoryComplete, allComplete: mand.every(i => isDone(i.status)) };
}
