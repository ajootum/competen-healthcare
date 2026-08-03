import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { workspaceClock } from "@/lib/practice/practice-time";
import {
  TASK_TRANSITIONS, CLOSED_TASK_STATUSES, LIVE_TASK_STATUSES, TASK_CATEGORIES,
  TASK_PRIORITIES, REASON_REQUIRED_FOR, NOTIFICATION_LABELS,
} from "@/lib/practice/task-constants";
import { enabledEventTypes } from "@/lib/practice/preference-constants";
import { resolvePreferences } from "@/lib/practice/preferences";

// CPR-340 TASKS, REMINDERS AND NOTIFICATIONS. Migration 198's header carries the three boundary
// decisions this module exists to hold; the short forms are:
//
//   A TASK IS NOT A FOLLOW-UP. A follow-up is a clinical obligation to a patient and lives in their
//   record. A task is a piece of work assigned to a person. Letting tasks absorb follow-ups gives you
//   two systems each holding half the commitments and a patient in the gap between them.
//
//   A REMINDER IS NOT A THIRD OBJECT. `remind_on` is a column; the reminder IS the task surfacing.
//
//   THERE IS NO SENDING. Notifications appear in the app to a member of this practice and nowhere else.
//   No email, no SMS, no patient messaging. Nothing in this file addresses an outside world.
//
// OVERDUE IS DERIVED, AS IT IS FOR FOLLOW-UPS, and for the same reason: a stored flag needs something
// to run, and a practice that has not opened the app for a week is exactly where nothing runs.
//
// SO IS "ASSIGNED TO SOMEBODY WHO CANNOT SEE IT". A membership can be revoked long after a task is
// assigned, and the task does not know. Computing it at read time means the board says so the moment it
// becomes true, rather than at whatever point somebody remembers to run a sweep.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/**
 * Active members, with names where the platform has them.
 *
 * NAMES COME FROM `profiles`, WHICH IS PLATFORM DATA, and a practice-only user may have no row there.
 * The practice tenancy has no name of its own for a member -- a real gap, named here rather than
 * papered over with an email address the practice may not be entitled to show. Callers get null and
 * render it as an unnamed member.
 */
export async function listMembers(admin: any, workspaceId: string) {
  const { data: memberships } = await admin.from("practice_membership")
    .select("user_id, role_code, status").eq("workspace_id", workspaceId).eq("status", "active");
  const rows = (memberships ?? []) as any[];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map(m => m.user_id))];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);
  const nameById = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  // One entry per PERSON, not per membership: provisioning gives the owner two memberships and an
  // assignee picker listing them twice is a bug the first time somebody picks the wrong one.
  type Member = { userId: string; name: string | null; roles: string[] };
  const byUser = new Map<string, Member>();
  for (const m of rows) {
    const e: Member = byUser.get(m.user_id)
      ?? { userId: m.user_id, name: nameById.get(m.user_id) ?? null, roles: [] };
    e.roles.push(m.role_code);
    byUser.set(m.user_id, e);
  }
  return [...byUser.values()];
}

async function isActiveMember(admin: any, workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  return !!data;
}

async function recordEvent(admin: any, workspaceId: string, taskId: string, args: {
  from?: string | null; to: string; fromAssignee?: string | null; toAssignee?: string | null;
  note?: string; actorId: string;
}) {
  await admin.from("practice_task_event").insert({
    workspace_id: workspaceId, task_id: taskId,
    from_status: args.from ?? null, to_status: args.to,
    from_assignee: args.fromAssignee ?? null, to_assignee: args.toAssignee ?? null,
    note: args.note ?? null, actor_id: args.actorId,
  });
}

/**
 * Raise a notification, for the small set of things that cannot be recovered from current state.
 *
 * NEVER TO YOURSELF. Assigning yourself a task is not news, and a feed that tells you what you just did
 * is a feed people stop reading -- at which point the one that matters is missed too.
 *
 * A failure here is logged into the audit trail and swallowed, deliberately: migration 198 s4 explains
 * that a missed notification is a missed courtesy, not a false record. Failing the assignment because
 * the nudge did not write would be the wrong trade.
 */
async function notify(admin: any, args: {
  workspaceId: string; userId: string; actorId: string; eventType: string;
  title: string; body?: string; href: string; sourceKind?: string; sourceId?: string;
}) {
  if (args.userId === args.actorId) return;
  await admin.from("practice_notification").insert({
    workspace_id: args.workspaceId, user_id: args.userId, event_type: args.eventType,
    title: args.title, body: args.body ?? null, href: args.href,
    source_kind: args.sourceKind ?? null, source_id: args.sourceId ?? null, created_by: args.actorId,
  });
}

// ── TASKS ────────────────────────────────────────────────────────────────────────────────────────────

export async function createTask(admin: any, args: {
  workspaceId: string; title: string; detail?: string; assignedTo: string;
  patientId?: string | null; encounterId?: string | null; documentId?: string | null; followUpId?: string | null;
  category?: string; priority?: string; dueOn?: string | null; remindOn?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.title.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a task needs a title" };
  if (!args.assignedTo)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a task must be assigned to somebody" };

  // WORK ASSIGNED TO A REVOKED ACCOUNT LANDS NOWHERE. Refused rather than warned.
  if (!(await isActiveMember(admin, args.workspaceId, args.assignedTo)))
    return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };

  for (const [value, label] of [[args.dueOn, "dueOn"], [args.remindOn, "remindOn"]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a date (YYYY-MM-DD)` };
  }
  // A reminder after the deadline is a reminder that arrives too late to be one.
  if (args.dueOn && args.remindOn && args.remindOn > args.dueOn)
    return { ok: false, status: 400, code: "REMINDER_AFTER_DUE", message: "the reminder is after the due date" };

  // Named subjects must belong to this workspace. A task pointing at another practice's patient would
  // leak that the row exists.
  for (const [table, id] of [
    ["practice_patient", args.patientId], ["practice_encounter", args.encounterId],
    ["practice_clinical_document", args.documentId], ["practice_follow_up", args.followUpId],
  ] as const) {
    if (!id) continue;
    const { data } = await admin.from(table).select("id").eq("id", id).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const category = TASK_CATEGORIES.some(([c]) => c === args.category) ? args.category! : "admin";
  const priority = (TASK_PRIORITIES as readonly string[]).includes(args.priority ?? "") ? args.priority! : "routine";

  const { data: t, error } = await admin.from("practice_task").insert({
    workspace_id: args.workspaceId, title: args.title.trim(), detail: args.detail ?? null,
    assigned_to: args.assignedTo,
    patient_id: args.patientId ?? null, encounter_id: args.encounterId ?? null,
    document_id: args.documentId ?? null, follow_up_id: args.followUpId ?? null,
    category, priority, due_on: args.dueOn ?? null, remind_on: args.remindOn ?? null,
    status: "OPEN", created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await recordEvent(admin, args.workspaceId, t.id, { to: "OPEN", toAssignee: args.assignedTo, note: args.title.trim(), actorId: args.actorId });
  await notify(admin, {
    workspaceId: args.workspaceId, userId: args.assignedTo, actorId: args.actorId,
    eventType: "task_assigned", title: args.title.trim(),
    body: args.dueOn ? `Due ${args.dueOn}` : undefined,
    href: "/practice/tasks", sourceKind: "task", sourceId: t.id,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.task_created",
    payload: { taskId: t.id, assignedTo: args.assignedTo, category, priority }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

export async function transitionTask(admin: any, args: {
  workspaceId: string; taskId: string; to: string; reason?: string; outcome?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: task } = await admin.from("practice_task")
    .select("id, status, title, assigned_to, created_by, record_version")
    .eq("id", args.taskId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!task) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(TASK_TRANSITIONS[task.status] ?? []).includes(args.to))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${task.status} cannot become ${args.to}` };

  const reason = (args.reason ?? "").trim();
  if (REASON_REQUIRED_FOR.includes(args.to) && !reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say what this is blocked on" };

  const closing = CLOSED_TASK_STATUSES.includes(args.to);
  const patch: Record<string, unknown> = {
    status: args.to, record_version: task.record_version + 1, updated_at: nowIso(), updated_by: args.actorId,
    blocked_reason: args.to === "BLOCKED" ? reason : null,
    closed_at: closing ? nowIso() : null,
    closed_by: closing ? args.actorId : null,
  };
  if (args.outcome !== undefined) patch.outcome = args.outcome.trim() || null;

  const { data: updated } = await admin.from("practice_task")
    .update(patch).eq("id", task.id).eq("record_version", task.record_version).select("id").maybeSingle();
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the task changed underneath you; reload and retry" };

  await recordEvent(admin, args.workspaceId, task.id, {
    from: task.status, to: args.to, note: reason || args.outcome || undefined, actorId: args.actorId,
  });

  // Blocking is the one status the RAISER needs to hear about: they are usually the person who can
  // unblock it, and the task has just left the assignee's control.
  if (args.to === "BLOCKED" && task.created_by) {
    await notify(admin, {
      workspaceId: args.workspaceId, userId: task.created_by, actorId: args.actorId,
      eventType: "task_blocked", title: task.title, body: reason,
      href: "/practice/tasks", sourceKind: "task", sourceId: task.id,
    });
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.task_${args.to.toLowerCase()}`,
    payload: { taskId: task.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.to } };
}

/** Hand a task to somebody else. A status-preserving move, so the trail records the assignees. */
export async function reassignTask(admin: any, args: {
  workspaceId: string; taskId: string; assignedTo: string; note?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ assignedTo: string }>> {
  const { data: task } = await admin.from("practice_task")
    .select("id, status, title, assigned_to, record_version")
    .eq("id", args.taskId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!task) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (CLOSED_TASK_STATUSES.includes(task.status))
    return { ok: false, status: 422, code: "TASK_CLOSED", message: "this task is closed; raise a new one" };
  if (task.assigned_to === args.assignedTo)
    return { ok: false, status: 422, code: "ALREADY_ASSIGNED", message: "it is already with that person" };
  if (!(await isActiveMember(admin, args.workspaceId, args.assignedTo)))
    return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };

  const { data: updated } = await admin.from("practice_task")
    .update({ assigned_to: args.assignedTo, record_version: task.record_version + 1, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", task.id).eq("record_version", task.record_version).select("id").maybeSingle();
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the task changed underneath you; reload and retry" };

  await recordEvent(admin, args.workspaceId, task.id, {
    from: task.status, to: task.status, fromAssignee: task.assigned_to, toAssignee: args.assignedTo,
    note: args.note, actorId: args.actorId,
  });
  await notify(admin, {
    workspaceId: args.workspaceId, userId: args.assignedTo, actorId: args.actorId,
    eventType: "task_reassigned", title: task.title, body: args.note,
    href: "/practice/tasks", sourceKind: "task", sourceId: task.id,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.task_reassigned",
    payload: { taskId: task.id, from: task.assigned_to, to: args.assignedTo }, correlationId: args.correlationId,
  });
  return { ok: true, data: { assignedTo: args.assignedTo } };
}

/**
 * The derived view of one task. Nothing here is read from a column:
 *   overdue           past its due date and not closed
 *   reminderDue       the reminder date has arrived (this is what makes it a reminder)
 *   assigneeInactive  it is assigned to somebody who can no longer see it
 */
export function deriveTask(row: any, today: string, activeUserIds: Set<string>) {
  const closed = CLOSED_TASK_STATUSES.includes(row.status);
  return {
    ...row,
    closed,
    dueInDays: row.due_on ? daysBetween(today, row.due_on) : null,
    overdue: !closed && !!row.due_on && row.due_on < today,
    reminderDue: !closed && !!row.remind_on && row.remind_on <= today,
    assigneeInactive: !closed && !activeUserIds.has(row.assigned_to),
  };
}

export async function listTasks(admin: any, workspaceId: string, filter: {
  assignedTo?: string; status?: string[]; patientId?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_task")
    .select("id, title, detail, assigned_to, patient_id, encounter_id, document_id, follow_up_id, category, priority, due_on, remind_on, status, blocked_reason, outcome, closed_at, created_at, created_by, record_version")
    .eq("workspace_id", workspaceId);
  if (filter.assignedTo) q = q.eq("assigned_to", filter.assignedTo);
  if (filter.status?.length) q = q.in("status", filter.status);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);

  const { data } = await q.order("due_on", { nullsFirst: false }).order("created_at", { ascending: false }).limit(filter.limit ?? 200);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const [{ today }, members] = await Promise.all([
    workspaceClock(admin, workspaceId),
    listMembers(admin, workspaceId),
  ]);
  const activeUserIds = new Set(members.map(m => m.userId));
  const nameOf = new Map(members.map(m => [m.userId, m.name]));

  const patientIds = [...new Set(rows.map(r => r.patient_id).filter(Boolean))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name").in("id", patientIds)
    : { data: [] };
  const patientName = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));

  return rows.map(r => ({
    ...deriveTask(r, today, activeUserIds),
    assignee_name: nameOf.get(r.assigned_to) ?? null,
    patient_name: r.patient_id ? (patientName.get(r.patient_id) ?? null) : null,
  }));
}

/**
 * The task board, in the groups somebody at a desk actually works in.
 *
 * MINE FIRST. The board belongs to whoever opened it: a shared list sorted by date buries your own
 * three items under a colleague's thirty.
 */
export async function taskBoard(admin: any, workspaceId: string, userId: string) {
  const live = await listTasks(admin, workspaceId, { status: LIVE_TASK_STATUSES });
  const closed = await listTasks(admin, workspaceId, { status: CLOSED_TASK_STATUSES, limit: 20 });
  const mine = live.filter(t => t.assigned_to === userId);

  return {
    mineOverdue: mine.filter(t => t.overdue),
    mineDue: mine.filter(t => !t.overdue && (t.reminderDue || t.dueInDays !== null)),
    mineLater: mine.filter(t => !t.overdue && !t.reminderDue && t.dueInDays === null),
    blocked: live.filter(t => t.status === "BLOCKED"),
    // NAMED, NOT HIDDEN: work sitting with somebody who cannot open the app is work nobody is doing.
    orphaned: live.filter(t => t.assigneeInactive),
    others: live.filter(t => t.assigned_to !== userId && !t.assigneeInactive),
    recentlyClosed: closed.slice(0, 10),
  };
}

export async function getTask(admin: any, workspaceId: string, taskId: string) {
  const { data: task } = await admin.from("practice_task")
    .select("*").eq("id", taskId).eq("workspace_id", workspaceId).maybeSingle();
  if (!task) return null;

  const [{ data: events }, { today }, members] = await Promise.all([
    admin.from("practice_task_event")
      .select("from_status, to_status, from_assignee, to_assignee, note, occurred_at")
      .eq("task_id", taskId).order("occurred_at"),
    workspaceClock(admin, workspaceId),
    listMembers(admin, workspaceId),
  ]);
  return {
    task: deriveTask(task, today, new Set(members.map(m => m.userId))),
    events: events ?? [],
  };
}

// ── NOTIFICATIONS ────────────────────────────────────────────────────────────────────────────────────

/**
 * One person's unread notifications in this workspace. In-app only; nothing here was ever sent.
 *
 * CPR-360 FILTERS WHAT IS SURFACED, NOT WHAT IS WRITTEN. A category switched off hides its rows from
 * this list; it does not stop them being recorded. Switching it back on has to bring the history with
 * it, and a preference that silently destroyed records while it was off would make that impossible.
 */
export async function listNotifications(admin: any, workspaceId: string, userId: string, opts: {
  includeRead?: boolean; limit?: number;
} = {}) {
  const { effective } = await resolvePreferences(admin, workspaceId, userId);
  const allowed = enabledEventTypes(effective.notificationCategories);

  let q = admin.from("practice_notification")
    .select("id, event_type, title, body, href, source_kind, source_id, read_at, created_at, created_by")
    .eq("workspace_id", workspaceId).eq("user_id", userId)
    .in("event_type", allowed);
  if (!opts.includeRead) q = q.is("read_at", null);

  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  return ((data ?? []) as any[]).map(n => ({ ...n, label: NOTIFICATION_LABELS[n.event_type] ?? n.event_type }));
}

/**
 * Mark as read. Scoped to the CALLER's own rows -- passing somebody else's id marks nothing, because a
 * notification you can clear for a colleague is a notification they never see.
 */
export async function markNotificationsRead(admin: any, args: {
  workspaceId: string; userId: string; notificationIds?: string[];
}): Promise<EngineResult<{ marked: number }>> {
  let q = admin.from("practice_notification")
    .update({ read_at: nowIso() })
    .eq("workspace_id", args.workspaceId).eq("user_id", args.userId).is("read_at", null);
  if (args.notificationIds?.length) q = q.in("id", args.notificationIds);

  const { data, error } = await q.select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { marked: ((data ?? []) as any[]).length } };
}

/**
 * Raised when somebody amends a document another person wrote. Called by the documentation engine's
 * caller rather than from inside it, so the notification layer stays a consumer of the clinical
 * modules and never something they depend on.
 */
export async function notifyDocumentAmended(admin: any, args: {
  workspaceId: string; documentId: string; successorId: string; authorId: string;
  reason: string; actorId: string;
}) {
  await notify(admin, {
    workspaceId: args.workspaceId, userId: args.authorId, actorId: args.actorId,
    eventType: "document_amended", title: "A document you wrote was amended",
    body: args.reason, href: `/practice/documents/${args.successorId}`,
    sourceKind: "document", sourceId: args.documentId,
  });
}
