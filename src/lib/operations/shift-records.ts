// Safety huddles & shift decisions (SSW-002 §6.7 / §6.8). Per-shift operational
// records that feed the timeline and audit trail. Fail-soft: report not-provisioned
// before migration 066 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const DECISION_TYPES = ["redeploy_staff", "delay_break", "open_surge_capacity", "escalate_patient", "transfer_patient", "reallocate_beds", "additional_observations", "activate_emergency_staffing", "other"];
export const DECISION_TYPE_LABEL: Record<string, string> = {
  redeploy_staff: "Redeploy staff", delay_break: "Delay a break", open_surge_capacity: "Open surge capacity",
  escalate_patient: "Escalate a patient", transfer_patient: "Transfer a patient", reallocate_beds: "Reallocate beds",
  additional_observations: "Additional observations", activate_emergency_staffing: "Activate emergency staffing", other: "Other",
};
export const DECISION_STATUSES = ["active", "under_review", "closed", "reversed"];
export const HUDDLE_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"];

const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export async function loadSafetyHuddle(admin: any, shiftId: string | null) {
  if (!shiftId) return { provisioned: true as const, huddle: null };
  const res = await admin.from("safety_huddles").select("*").eq("shift_id", shiftId).maybeSingle();
  if (res.error) {
    if (missing(res.error)) return { provisioned: false as const };
    return { provisioned: true as const, huddle: null };
  }
  return { provisioned: true as const, huddle: res.data ?? null };
}

export async function loadShiftDecisions(admin: any, shiftId: string | null) {
  if (!shiftId) return { provisioned: true as const, decisions: [] };
  const res = await admin.from("shift_decisions")
    .select("id, decision_type, decision_summary, decision_reason, decision_maker_name, authorised_by_name, decided_at, status, review_outcome")
    .eq("shift_id", shiftId).order("decided_at", { ascending: false }).limit(30);
  if (res.error) {
    if (missing(res.error)) return { provisioned: false as const };
    return { provisioned: true as const, decisions: [] };
  }
  return { provisioned: true as const, decisions: res.data ?? [] };
}
