// What is still open on a shift that is about to be closed? (XWI P2-14)
//
// THE DEFECT. Closing a shift wrote one field -- `status` -- and nothing else. Everything hanging off that
// shift stayed exactly as it was: tasks still `assigned` or `in_progress`, patient assignments still
// `active`, escalations still `open`, staff still `on_duty`. Nobody is on the ward, and the records say
// the work is in hand. Those rows then feed every count above them, so an orphaned task is indistinguishable
// from live work on a supervisor board.
//
// WHY THIS DOES NOT AUTO-CASCADE, WHICH IS THE OBVIOUS FIX AND THE WRONG ONE.
// Cancelling the tasks destroys the record of what was left undone. Ending the patient assignments drops
// clinical responsibility with no receiving clinician -- strictly worse than an orphan, because a patient
// with a stale carer at least has a name attached. Resolving the escalations asserts a resolution that
// never happened. Each of those is a clinical policy decision, not a tidy-up, and a system that makes them
// silently on a status change is the reason the orphans were invisible in the first place.
//
// So the defect being fixed is the INVISIBILITY, not the orphans. Closing a shift with outstanding work
// now refuses with a 409 and an itemised list, exactly as the COMP-027 readiness gate refuses a
// deployment, and proceeds only on an explicit acknowledgement that is written to the audit trail.

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Open" per table, taken from the statuses these tables actually carry rather than assumed.
export const OPEN_TASK_STATUSES = ["created", "assigned", "in_progress"];
export const OPEN_ASSIGNMENT_STATUSES = ["active", "pending_acceptance"];
export const OPEN_ESCALATION_STATUSES = ["open"];
export const ON_DUTY_STATUSES = ["on_duty"];

export type Outstanding = {
  tasks: number;
  assignments: number;
  escalations: number;
  onDuty: number;
  total: number;
  /** a short human list, so the refusal says what is outstanding rather than that something is */
  summary: string;
};

const countFor = async (admin: any, table: string, shiftId: string, statuses: string[]): Promise<number> => {
  const { count, error } = await admin.from(table)
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .in("status", statuses);
  // A table this deployment lacks must not silently read as "nothing outstanding" -- that would turn a
  // missing migration into a clean bill of health, which is the failure mode this codebase keeps hitting.
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
};

export async function outstandingForShift(admin: any, shiftId: string): Promise<Outstanding> {
  const [tasks, assignments, escalations, onDuty] = await Promise.all([
    countFor(admin, "op_tasks", shiftId, OPEN_TASK_STATUSES),
    countFor(admin, "op_patient_assignments", shiftId, OPEN_ASSIGNMENT_STATUSES),
    countFor(admin, "op_escalations", shiftId, OPEN_ESCALATION_STATUSES),
    countFor(admin, "op_shift_staff", shiftId, ON_DUTY_STATUSES),
  ]);
  return { tasks, assignments, escalations, onDuty, total: tasks + assignments + escalations + onDuty, summary: describe({ tasks, assignments, escalations, onDuty }) };
}

export function describe(o: { tasks: number; assignments: number; escalations: number; onDuty: number }): string {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (o.escalations) parts.push(plural(o.escalations, "unresolved escalation", "unresolved escalations"));
  if (o.assignments) parts.push(plural(o.assignments, "active patient assignment", "active patient assignments"));
  if (o.tasks) parts.push(plural(o.tasks, "open task", "open tasks"));
  if (o.onDuty) parts.push(plural(o.onDuty, "clinician still on duty", "clinicians still on duty"));
  return parts.join(", ");
}

/** Statuses that end a shift. Anything else is an ordinary edit and is not gated. */
export const CLOSING_STATUSES = ["completed", "cancelled"];
