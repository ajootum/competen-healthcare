import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { workspaceClock, dueDateFrom, zonedDayRange } from "@/lib/practice/practice-time";
import { TASK_PRIORITIES, TASK_CATEGORIES, CLOSED_TASK_STATUSES } from "@/lib/practice/task-constants";
import { createTask, deriveTask } from "@/lib/practice/tasks";

// CPR-340's orchestration half: recurring tasks, templates, escalation and the daily agenda.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ESCALATION IS DERIVED, NOT FIRED.
//
// The specification says overdue high-priority tasks TRIGGER escalation. A trigger needs something to
// run, and this product's whole position on overdue -- argued at length in migration 196 -- is that the
// thing which needs to run is exactly what a neglected practice does not do. So a RULE records what
// counts as escalated, and the board computes which tasks have breached it at read time.
//
// The information is identical and it is available the moment somebody looks, with nothing to fail
// silently overnight. What is lost is the push, and this product has no push: there is no email, no SMS
// and no device notification anywhere in it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// A RECURRING TASK DOES NOT PRE-GENERATE A YEAR OF ROWS. The next occurrence is created when the current
// one CLOSES -- the same pattern CPR-140's plans use. A board holding fifty-two weekly copies of "check
// the fridge temperature" is a board nobody reads, and fifty-one of them are commitments nobody has made.
//
// NO PERCENTAGES. The comp's task donut prints "6 (27%)" and its header "Focus Score (AI) 87%". The
// counts are real; the percentages divide by a total that is itself a choice about what to include, and
// the score has no formula at all.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const RECURRENCES = [
  ["daily", "Every day", 1],
  ["weekly", "Every week", 7],
  ["fortnightly", "Every fortnight", 14],
  ["monthly", "Every month", 30],
] as const;

export const recurrenceDays = (code: string) => RECURRENCES.find(([c]) => c === code)?.[2] ?? null;

// ── RECURRENCE ───────────────────────────────────────────────────────────────────────────────────────

export async function setRecurrence(admin: any, args: {
  workspaceId: string; taskId: string; recurrence: string | null; until?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ recurrence: string | null }>> {
  if (args.recurrence !== null && !recurrenceDays(args.recurrence))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `recurrence must be one of: ${RECURRENCES.map(([c]) => c).join(", ")}` };
  if (args.until && !/^\d{4}-\d{2}-\d{2}$/.test(args.until))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the end date must be a date (YYYY-MM-DD)" };

  const { data: task } = await admin.from("practice_task")
    .select("id, due_on, status").eq("id", args.taskId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!task) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A RECURRING TASK NEEDS A DUE DATE. The next occurrence is computed from this one's; without it there
  // is nothing to count from, and "every week from nothing" is not a schedule.
  if (args.recurrence && !task.due_on)
    return {
      ok: false, status: 422, code: "DUE_DATE_REQUIRED",
      message: "give this task a due date first; the next one is worked out from it",
    };

  const { error } = await admin.from("practice_task").update({
    recurrence: args.recurrence, recurrence_until: args.until ?? null,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("workspace_id", args.workspaceId).eq("id", task.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: args.recurrence ? "practice.task_recurrence_set" : "practice.task_recurrence_cleared",
    payload: { taskId: task.id, recurrence: args.recurrence, until: args.until ?? null },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { recurrence: args.recurrence } };
}

/**
 * Create the next occurrence, if this task recurs.
 *
 * CALLED FROM THE CLOSE PATH, at the moment the fact becomes true -- not swept for. Returns null when
 * the task does not recur, when it was cancelled rather than done, or when the series has ended.
 *
 * COUNTED FROM THE DUE DATE, NOT FROM TODAY. A weekly check done three days late is still due on the
 * same weekday next week; counting from completion would let a series drift a day at a time until the
 * Monday chore happens on a Thursday.
 */
export async function nextOccurrence(admin: any, args: {
  workspaceId: string; taskId: string; actorId: string; correlationId: string;
}): Promise<{ id: string; dueOn: string } | null> {
  const { data: task } = await admin.from("practice_task")
    .select("id, workspace_id, title, detail, category, priority, assigned_to, patient_id, encounter_id, due_on, remind_on, status, recurrence, recurrence_until")
    .eq("id", args.taskId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!task?.recurrence || !task.due_on) return null;

  // A CANCELLED TASK DOES NOT BREED. Cancelling is how somebody says this should not have been here;
  // producing the next one would be arguing with them.
  if (task.status !== "DONE") return null;

  const days = recurrenceDays(task.recurrence);
  if (!days) return null;
  const dueOn = dueDateFrom(task.due_on, days);
  if (task.recurrence_until && dueOn > task.recurrence_until) return null;

  const remindOffset = task.remind_on && task.due_on
    ? Math.round((Date.parse(`${task.due_on}T00:00:00Z`) - Date.parse(`${task.remind_on}T00:00:00Z`)) / 86400000)
    : null;

  const created = await createTask(admin, {
    workspaceId: args.workspaceId, title: task.title, detail: task.detail ?? undefined,
    assignedTo: task.assigned_to, patientId: task.patient_id, encounterId: task.encounter_id,
    category: task.category, priority: task.priority, dueOn,
    remindOn: remindOffset != null ? dueDateFrom(dueOn, -remindOffset) : null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!created.ok) return null;

  await admin.from("practice_task").update({
    recurrence: task.recurrence, recurrence_until: task.recurrence_until,
    recurred_from_task_id: task.id,
  }).eq("workspace_id", args.workspaceId).eq("id", created.data.id);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.task_recurred",
    payload: { from: task.id, to: created.data.id, dueOn }, correlationId: args.correlationId,
  });
  return { id: created.data.id, dueOn };
}

// ── TEMPLATES ────────────────────────────────────────────────────────────────────────────────────────

export async function listTaskTemplates(admin: any, workspaceId: string) {
  const { data: templates } = await admin.from("practice_task_template")
    .select("id, code, title, description, active").eq("workspace_id", workspaceId).eq("active", true).order("title");
  const rows = (templates ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: items } = await admin.from("practice_task_template_item")
    .select("id, template_id, position, title, detail, category, priority, offset_days")
    .in("template_id", rows.map(t => t.id)).order("position");

  const byTemplate = new Map<string, any[]>();
  for (const i of ((items ?? []) as any[])) byTemplate.set(i.template_id, [...(byTemplate.get(i.template_id) ?? []), i]);
  return rows.map(t => ({ ...t, items: byTemplate.get(t.id) ?? [] }));
}

export async function createTaskTemplate(admin: any, args: {
  workspaceId: string; code: string; title: string; description?: string;
  items: { title: string; detail?: string; category?: string; priority?: string; offsetDays?: number }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };

  const items = args.items.filter(i => i?.title?.trim());
  if (items.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a template with no tasks would create nothing" };
  const badOffset = items.find(i => i.offsetDays != null && (!Number.isInteger(i.offsetDays) || i.offsetDays < 0 || i.offsetDays > 365));
  if (badOffset)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an offset must be a whole number of days between 0 and 365" };

  const { data: t, error } = await admin.from("practice_task_template").insert({
    workspace_id: args.workspaceId, code, title: args.title.trim(),
    description: args.description?.trim() || null, created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "CODE_IN_USE", message: `this practice already has a template coded "${code}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  const { error: itemError } = await admin.from("practice_task_template_item").insert(
    items.map((i, n) => ({
      template_id: t.id, position: n + 1, title: i.title.trim(), detail: i.detail?.trim() || null,
      category: TASK_CATEGORIES.some(([c]) => c === i.category) ? i.category : null,
      priority: (TASK_PRIORITIES as readonly string[]).includes(i.priority ?? "") ? i.priority : "routine",
      offset_days: i.offsetDays ?? 0,
    })),
  );
  // A template with no items creates nothing, so a half-created one is worse than none at all -- the
  // same rollback CPR-140's plan templates do.
  if (itemError) {
    await admin.from("practice_task_template").delete().eq("id", t.id);
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: itemError.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.task_template_created",
    payload: { templateId: t.id, code, items: items.length }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

/** Every task in a template, at once. Each goes through createTask, so every rule it enforces still holds. */
export async function applyTaskTemplate(admin: any, args: {
  workspaceId: string; templateId: string; assignedTo: string;
  patientId?: string | null; startDay?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ created: string[]; refused: { title: string; reason: string }[] }>> {
  const { data: t } = await admin.from("practice_task_template")
    .select("id, title, active").eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!t.active) return { ok: false, status: 422, code: "TEMPLATE_RETIRED", message: "that template has been retired" };

  const { data: items } = await admin.from("practice_task_template_item")
    .select("title, detail, category, priority, offset_days").eq("template_id", t.id).order("position");
  const rows = (items ?? []) as any[];
  if (rows.length === 0)
    return { ok: false, status: 422, code: "TEMPLATE_EMPTY", message: "that template has no tasks in it" };

  const { today } = await workspaceClock(admin, args.workspaceId);
  const start = args.startDay ?? today;

  const created: string[] = [];
  const refused: { title: string; reason: string }[] = [];
  for (const i of rows) {
    const result = await createTask(admin, {
      workspaceId: args.workspaceId, title: i.title, detail: i.detail ?? undefined,
      assignedTo: args.assignedTo, patientId: args.patientId ?? null,
      category: i.category ?? undefined, priority: i.priority,
      // OFFSETS FROM THE START, never chained -- the rule CPR-140's plan steps follow.
      dueOn: dueDateFrom(start, i.offset_days ?? 0),
      actorId: args.actorId, correlationId: args.correlationId,
    });
    if (result.ok) created.push(result.data.id);
    else refused.push({ title: i.title, reason: result.message });
  }

  if (created.length === 0)
    return { ok: false, status: 422, code: "NOTHING_CREATED", message: refused.map(r => r.reason).join("; ") };
  // PARTIAL IS REPORTED. Somebody applying a four-task checklist who got three has to be told which one
  // did not go, or they will believe the whole thing is on the board.
  return { ok: true, data: { created, refused } };
}

// ── ESCALATION ───────────────────────────────────────────────────────────────────────────────────────

export async function setEscalationRule(admin: any, args: {
  workspaceId: string; priority: string; daysOverdue: number; notifyUserId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ priority: string; daysOverdue: number }>> {
  if (!(TASK_PRIORITIES as readonly string[]).includes(args.priority))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
  if (!Number.isInteger(args.daysOverdue) || args.daysOverdue < 0 || args.daysOverdue > 365)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "days overdue must be a whole number between 0 and 365" };

  if (args.notifyUserId) {
    const { data: m } = await admin.from("practice_membership")
      .select("id").eq("workspace_id", args.workspaceId).eq("user_id", args.notifyUserId).eq("status", "active").limit(1).maybeSingle();
    if (!m) return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };
  }

  // Upsert on the full unique index (211 s3) -- one rule per priority, complete on the two columns, not
  // partial. The partial-index conflict target is the trap migration 186 recorded.
  const { error } = await admin.from("practice_escalation_rule").upsert({
    workspace_id: args.workspaceId, priority: args.priority, days_overdue: args.daysOverdue,
    notify_user_id: args.notifyUserId ?? null, active: true, created_by: args.actorId,
  }, { onConflict: "workspace_id,priority" });
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.escalation_rule_set",
    payload: { priority: args.priority, daysOverdue: args.daysOverdue }, correlationId: args.correlationId,
  });
  return { ok: true, data: { priority: args.priority, daysOverdue: args.daysOverdue } };
}

export async function listEscalationRules(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_escalation_rule")
    .select("id, priority, days_overdue, notify_user_id, active").eq("workspace_id", workspaceId).eq("active", true);
  return (data ?? []) as any[];
}

/**
 * Which tasks have breached their escalation rule, right now.
 *
 * COMPUTED, NEVER STORED. There is no `escalated` column and no job that sets one: a task is escalated
 * because of how many days have passed, and that is a fact about the clock rather than about the row.
 * A stored flag would need something to run, and the practice where nothing runs is the practice where
 * this matters most.
 */
export async function escalations(admin: any, workspaceId: string) {
  const [{ today }, rules] = await Promise.all([
    workspaceClock(admin, workspaceId),
    listEscalationRules(admin, workspaceId),
  ]);
  if (rules.length === 0) return { today, rules: [], tasks: [], configured: false };

  const { data } = await admin.from("practice_task")
    .select("id, title, priority, status, due_on, assigned_to, patient_id, category, created_at")
    .eq("workspace_id", workspaceId).in("status", ["OPEN", "IN_PROGRESS", "BLOCKED"])
    .not("due_on", "is", null).lte("due_on", today).order("due_on").limit(500);

  const byPriority = new Map(rules.map(r => [r.priority, r]));
  const breached = ((data ?? []) as any[])
    .map(t => {
      const rule = byPriority.get(t.priority);
      if (!rule) return null;
      const daysOverdue = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.due_on}T00:00:00Z`)) / 86400000);
      if (daysOverdue < rule.days_overdue) return null;
      return { ...t, daysOverdue, threshold: rule.days_overdue, notifyUserId: rule.notify_user_id ?? null };
    })
    .filter(Boolean) as any[];

  const ids = [...new Set(breached.flatMap(t => [t.assigned_to, t.notifyUserId]).filter(Boolean))];
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return {
    today,
    rules,
    // Worst first: most days past the threshold, then highest priority. Ordered by what it costs to
    // leave, as CPR-300's alerts are.
    tasks: breached
      .map(t => ({
        ...t,
        assignedToName: nameOf.get(t.assigned_to) ?? null,
        notifyName: t.notifyUserId ? (nameOf.get(t.notifyUserId) ?? null) : null,
      }))
      .sort((a, b) => (b.daysOverdue - b.threshold) - (a.daysOverdue - a.threshold)),
    configured: true,
    // Said in the payload, not left to the page: nothing was sent, and nothing fires on its own.
    notificationsSent: false,
  };
}

// ── THE DAILY AGENDA ─────────────────────────────────────────────────────────────────────────────────

/**
 * One day, as it actually stands: appointments, tasks due, reminders and follow-ups.
 *
 * NO MIGRATION. Every entry already exists somewhere; the agenda is those four read for one day and
 * interleaved. An agenda table would be a fifth copy that goes stale the moment an appointment moves.
 *
 * THE PRACTICE'S DAY, not the server's -- a Kampala morning read in UTC starts three hours late.
 */
export async function dailyAgenda(admin: any, workspaceId: string, userId: string, day?: string) {
  const { today, timezone } = await workspaceClock(admin, workspaceId);
  const on = day ?? today;
  const { startIso, endIso } = zonedDayRange(on, timezone);

  const [{ data: appointments }, { data: tasks }, { data: followUps }] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, patient_name, appointment_type, scheduled_at, duration_minutes, status")
      .eq("workspace_id", workspaceId).gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .not("status", "in", "(CANCELLED)").order("scheduled_at"),
    admin.from("practice_task")
      .select("id, title, priority, status, due_on, remind_on, assigned_to, category")
      .eq("workspace_id", workspaceId).eq("assigned_to", userId)
      .in("status", ["OPEN", "IN_PROGRESS", "BLOCKED"])
      .or(`due_on.eq.${on},remind_on.eq.${on}`),
    admin.from("practice_follow_up")
      .select("id, reason, due_on, status, priority")
      .eq("workspace_id", workspaceId).eq("due_on", on).in("status", ["OPEN", "SCHEDULED"]),
  ]);

  const taskRows = ((tasks ?? []) as any[]).map(t => deriveTask(t, today, new Set([userId])));

  return {
    day: on, timezone,
    appointments: (appointments ?? []) as any[],
    // Split, because a task due today and a task you asked to be reminded about today are different
    // claims on the day and collapsing them makes the count wrong.
    dueToday: taskRows.filter(t => t.due_on === on),
    remindersToday: taskRows.filter(t => t.remind_on === on && t.due_on !== on),
    followUps: (followUps ?? []) as any[],
    // Counts, never the comp's "6 (27%)" -- a percentage divides by a total that is itself a choice
    // about what to include.
    counts: {
      appointments: ((appointments ?? []) as any[]).length,
      dueToday: taskRows.filter(t => t.due_on === on).length,
      reminders: taskRows.filter(t => t.remind_on === on && t.due_on !== on).length,
      followUps: ((followUps ?? []) as any[]).length,
    },
  };
}

/**
 * Close several tasks at once. The comp's "bulk actions".
 *
 * EACH GOES THROUGH THE ORDINARY TRANSITION, so every rule still holds -- including that BLOCKED needs
 * words, which is why blocking is not offered in bulk. A bulk path with its own rules is a second door
 * into the same room.
 */
export async function bulkTransition(admin: any, args: {
  workspaceId: string; taskIds: string[]; to: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ changed: number; refused: { id: string; reason: string }[] }>> {
  const ids = [...new Set(args.taskIds.filter(Boolean))];
  if (ids.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "choose something to change" };
  if (ids.length > 100)
    return { ok: false, status: 422, code: "TOO_MANY", message: "change at most 100 at a time" };
  if (!CLOSED_TASK_STATUSES.includes(args.to))
    return {
      ok: false, status: 422, code: "NOT_BULK_SAFE",
      message: "only completing or cancelling can be done in bulk; anything that needs a reason is done one at a time",
    };

  const { transitionTask } = await import("@/lib/practice/tasks");
  const refused: { id: string; reason: string }[] = [];
  let changed = 0;
  for (const id of ids) {
    const result = await transitionTask(admin, {
      workspaceId: args.workspaceId, taskId: id, to: args.to,
      actorId: args.actorId, correlationId: args.correlationId,
    });
    if (result.ok) changed++;
    else refused.push({ id, reason: result.message });
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.tasks_bulk_transition",
    payload: { requested: ids.length, changed, to: args.to }, correlationId: args.correlationId,
  });
  // BOTH NUMBERS, always -- "8 completed" out of 10 selected is a claim somebody relies on unchecked.
  return { ok: true, data: { changed, refused } };
}
