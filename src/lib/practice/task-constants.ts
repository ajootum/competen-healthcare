// CPR-340's state table, in a module with NO server imports so the task board derives its buttons from
// the same source the engine enforces.
//
// BLOCKED IS A REAL STATE, not a flavour of OPEN. A task nobody can progress because it is waiting on
// somebody else is a different problem from one nobody has started, and a board that cannot tell them
// apart makes the stuck ones invisible among the merely unstarted. Entering it needs a reason.
//
// CANCELLED AND DONE ARE BOTH DEAD ENDS. Reopening a finished task would let its trail say it was
// completed twice; raising a new one linked to the same subject is the honest move, and costs one click.

export const TASK_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"],
  IN_PROGRESS: ["OPEN", "BLOCKED", "DONE", "CANCELLED"],
  BLOCKED: ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

export const CLOSED_TASK_STATUSES = ["DONE", "CANCELLED"];
export const LIVE_TASK_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED"];

export const TASK_ACTIONS: Record<string, string> = {
  start: "IN_PROGRESS", block: "BLOCKED", unblock: "OPEN", reopen: "OPEN",
  complete: "DONE", cancel: "CANCELLED",
};

export const TASK_CATEGORIES = [
  ["admin", "Administration"],
  ["clinical_admin", "Clinical admin"],
  ["supplies", "Supplies"],
  ["billing", "Billing"],
  ["referral", "Referral"],
  ["equipment", "Equipment"],
  ["other", "Other"],
] as const;

export const TASK_PRIORITIES = ["routine", "soon", "urgent"] as const;

/** Entering this state needs words. Being stuck is worth explaining; being finished is self-evident. */
export const REASON_REQUIRED_FOR = ["BLOCKED"];

export function taskLabelFor(to: string): string {
  return ({
    OPEN: "Reopen",
    IN_PROGRESS: "Start",
    BLOCKED: "Mark blocked",
    DONE: "Done",
    CANCELLED: "Not needed",
  } as Record<string, string>)[to] ?? to;
}

/** In-app only. There is no channel here because there is nothing to send with -- migration 198 s3. */
export const NOTIFICATION_LABELS: Record<string, string> = {
  task_assigned: "assigned you a task",
  task_reassigned: "passed you a task",
  task_blocked: "marked a task blocked",
  document_amended: "amended a document you wrote",
};
