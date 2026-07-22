// Shift supervisor assignments & confirmation (SSW-002 §6.3 / §8 / §9.2). Records
// who commands a shift and their confirmation status, backing the command model
// (one accountable owner) and the supervisor_confirmed readiness item. Fail-soft:
// reports not-provisioned before migration 065 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export const ASSIGNMENT_TYPES = ["primary", "deputy", "acting", "outgoing", "incoming", "escalation"];
export const ASSIGNMENT_SOURCES = ["roster", "manual", "emergency", "shift_swap", "transfer", "recommendation"];
export const TYPE_LABEL: Record<string, string> = { primary: "Primary", deputy: "Deputy", acting: "Acting", outgoing: "Outgoing", incoming: "Incoming", escalation: "Escalation" };
export const SOURCE_LABEL: Record<string, string> = { roster: "Published roster", manual: "Manual", emergency: "Emergency", shift_swap: "Shift swap", transfer: "Transfer", recommendation: "Recommendation" };

export async function loadSupervisorAssignments(admin: any, shiftId: string | null, hid: string | null, isSuper: boolean) {
  // Candidate supervisors for the assignment picker (hospital-scoped).
  const staffQ = isSuper
    ? admin.from("profiles").select("id, full_name").order("full_name").limit(60)
    : admin.from("profiles").select("id, full_name").eq("hospital_id", hid ?? NONE).order("full_name").limit(60);
  const staffRes = await staffQ;
  const staff = (staffRes.error ? [] : (staffRes.data ?? [])).filter((s: any) => s.full_name);

  if (!shiftId) return { provisioned: true as const, assignments: [], primary: null, commandConfirmed: false, staff };

  const res = await admin.from("shift_supervisor_assignments")
    .select("id, user_id, assignment_type, assignment_source, confirmation_status, confirmed_at, declined_reason, assigned_by_name, profiles:user_id(full_name)")
    .eq("shift_id", shiftId).eq("active_status", true).order("assigned_at", { ascending: false });
  if (res.error) {
    if (/does not exist|schema cache/i.test(String(res.error.message))) return { provisioned: false as const, staff };
    return { provisioned: true as const, error: true, assignments: [], primary: null, commandConfirmed: false, staff };
  }
  const assignments = (res.data ?? []).map((a: any) => ({
    id: a.id, userId: a.user_id, name: a.profiles?.full_name ?? "Staff",
    type: a.assignment_type, source: a.assignment_source, status: a.confirmation_status,
    confirmedAt: a.confirmed_at, declinedReason: a.declined_reason, assignedBy: a.assigned_by_name,
  }));
  const primary = assignments.find((a: any) => a.type === "primary") ?? null;
  return { provisioned: true as const, assignments, primary, commandConfirmed: primary?.status === "confirmed", staff };
}
