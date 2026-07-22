// Workforce Operations redesign (SSW-WFO-001) — break management & supervisor
// notes loaders. Break board (scheduled → on-break → completed, overdue/missed)
// and the structured shift journal. Fail-soft: report not-provisioned before
// migration 069 runs so the workforce page never breaks.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export const BREAK_TYPES = ["rest", "meal", "comfort"];
export const BREAK_STATUSES = ["scheduled", "on_break", "completed", "overdue", "missed", "cancelled"];
export const NOTE_TYPES = ["staffing_decision", "operational_event", "coaching", "risk", "handover", "action_item", "general"];
export const NOTE_TYPE_LABEL: Record<string, string> = {
  staffing_decision: "Staffing Decision", operational_event: "Operational Event", coaching: "Coaching Note",
  risk: "Operational Risk", handover: "Handover Note", action_item: "Action Item", general: "Note",
};

export async function loadStaffBreaks(admin: any, hid: string | null, isSuper: boolean, shiftId: string | null) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("op_staff_breaks").select("id, staff_name, role, break_type, status, scheduled_at, started_at, ended_at, duration_min, relief_name"))
    .order("scheduled_at", { ascending: true, nullsFirst: false }).limit(200);
  if (res.error) {
    if (missing(res.error)) return { provisioned: false as const };
    return { provisioned: true as const, error: true };
  }
  const now = Date.now();
  const rows = (res.data ?? []).filter((r: any) => r.status !== "cancelled");
  const past = (r: any) => r.scheduled_at && new Date(r.scheduled_at).getTime() < now;
  const isOverdue = (r: any) => r.status === "overdue" || r.status === "missed" || (r.status === "scheduled" && past(r));
  const onBreak = rows.filter((r: any) => r.status === "on_break");
  const completed = rows.filter((r: any) => r.status === "completed");
  const overdue = rows.filter(isOverdue);
  const due = rows.filter((r: any) => r.status === "scheduled" && !past(r));
  const total = rows.length;
  const compliancePct = total ? Math.round(((total - overdue.length) / total) * 100) : null;
  const mins = (r: any) => (r.scheduled_at ? Math.max(1, Math.round((now - new Date(r.scheduled_at).getTime()) / 60000)) : null);
  return {
    provisioned: true as const,
    dueForBreak: due.length, onBreakNow: onBreak.length, overdue: overdue.length,
    compliance: { compliant: completed.length, atRisk: due.length + onBreak.length, overdue: overdue.length, pct: compliancePct },
    onBreakList: onBreak.map((r: any) => ({ id: r.id, name: r.staff_name, role: r.role, since: r.started_at })),
    overdueList: overdue.map((r: any) => ({ id: r.id, name: r.staff_name, role: r.role, overdueMin: mins(r), type: r.break_type })),
    upcomingList: due.slice(0, 6).map((r: any) => ({ id: r.id, name: r.staff_name, role: r.role, at: r.scheduled_at, duration: r.duration_min })),
    activeRows: rows.filter((r: any) => ["scheduled", "on_break"].includes(r.status)).map((r: any) => ({ id: r.id, name: r.staff_name, status: r.status })),
  };
}

export async function loadSupervisorNotes(admin: any, hid: string | null, isSuper: boolean, shiftId: string | null) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("op_supervisor_notes").select("id, note_type, title, body, priority, status, author_name, created_at"))
    .order("created_at", { ascending: false }).limit(40);
  if (res.error) {
    if (missing(res.error)) return { provisioned: false as const };
    return { provisioned: true as const, error: true, notes: [] };
  }
  const notes = res.data ?? [];
  const byType: Record<string, number> = {};
  notes.forEach((n: any) => { byType[n.note_type] = (byType[n.note_type] ?? 0) + 1; });
  const openActions = notes.filter((n: any) => n.note_type === "action_item" && n.status === "open").length;
  return { provisioned: true as const, notes, byType, openActions };
}
