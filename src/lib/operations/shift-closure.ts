// Shift snapshots & command transfer (SSW-002 §18 / §8). Immutable point-in-time
// captures of operational state, and the record of who accepted command for the
// next shift. Fail-soft: report not-provisioned before migration 067 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const SNAPSHOT_KINDS = ["activation", "closure", "adhoc"];
export const TRANSFER_REASONS = ["scheduled_end", "illness", "emergency", "reassignment", "relief", "escalation", "other"];
export const TRANSFER_REASON_LABEL: Record<string, string> = {
  scheduled_end: "Scheduled end of shift", illness: "Illness", emergency: "Emergency", reassignment: "Reassignment",
  relief: "Approved relief", escalation: "Operational escalation", other: "Other",
};

const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export async function loadShiftClosure(admin: any, shiftId: string | null) {
  if (!shiftId) return { provisioned: true as const, snapshots: [], transfers: [] };
  const [snapRes, transRes] = await Promise.all([
    admin.from("shift_snapshots")
      .select("id, kind, census, occupied_beds, total_beds, present_staff, rostered_staff, open_alerts, active_escalations, open_tasks, overdue_tasks, completed_tasks, high_risk_patients, captured_by_name, captured_at")
      .eq("shift_id", shiftId).order("captured_at", { ascending: false }).limit(10),
    admin.from("command_transfer_records")
      .select("id, from_name, to_name, reason, status, outstanding_summary, initiated_at, accepted_at, rejected_reason")
      .eq("shift_id", shiftId).order("initiated_at", { ascending: false }).limit(10),
  ]);
  if (snapRes.error && missing(snapRes.error)) return { provisioned: false as const };
  return {
    provisioned: true as const,
    snapshots: snapRes.error ? [] : (snapRes.data ?? []),
    transfers: transRes.error ? [] : (transRes.data ?? []),
  };
}
