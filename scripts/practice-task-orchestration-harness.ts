/**
 * Practice task-orchestration harness -- CPR-340's recurrence, templates, escalation and agenda.
 * Migration 211.
 *
 * WHAT IT PROVES:
 *   1. A RECURRING TASK DOES NOT PRE-GENERATE. Setting a weekly recurrence creates NO extra rows; the
 *      next one appears when the current one is completed, and not before.
 *   2. THE NEXT DATE IS COUNTED FROM THE DUE DATE, NOT FROM TODAY -- so a weekly check done three days
 *      late is still due on the same weekday next week, instead of drifting a day at a time.
 *   3. A CANCELLED TASK DOES NOT BREED. Cancelling says this should not have been here; producing the
 *      next one would be arguing with the person who cancelled it.
 *   4. THE SERIES STOPS at recurrence_until, rather than running for ever.
 *   5. ESCALATION IS DERIVED, NEVER STORED: no column, no job. Changing the rule changes what is
 *      escalated on the next read, with nothing re-run.
 *   6. A TASK BELOW ITS THRESHOLD IS NOT ESCALATED -- paired with one above it, so the rule discriminates.
 *   7. A TEMPLATE MAKES SEVERAL TASKS with offsets FROM THE START, never chained.
 *   8. BULK ONLY CLOSES. Anything that needs a reason is refused in bulk, and both numbers are reported.
 *   9. THE AGENDA IS COMPOSED for the practice's day and counts appointments, tasks and follow-ups
 *      separately -- with no percentage anywhere.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-task-orchestration-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { createTask, transitionTask, listTasks } from "../src/lib/practice/tasks";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  setRecurrence, createTaskTemplate, applyTaskTemplate, listTaskTemplates,
  setEscalationRule, escalations, dailyAgenda, bulkTransition,
} from "../src/lib/practice/task-orchestration";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e26d1";
const OTHER = "00000000-0000-4000-8000-0000000e26d2";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-orc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-orc",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-orc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-orc" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice task-orchestration harness (CPR-340, migration 211)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Orchestration A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Orchestration B (synthetic)", "b");
  const today = practiceToday("Africa/Kampala");

  // ── 1 and 2. Recurrence ──────────────────────────────────────────────────
  // Due three days ago, so completing it TODAY is late -- which is what makes the "counted from the due
  // date, not from today" assertion meaningful.
  const dueOn = dueDateFrom(today, -3);
  const weekly = await createTask(admin, {
    workspaceId: wsA, title: "Check the fridge temperature", assignedTo: OWNER,
    priority: "routine", dueOn, ...base,
  });
  ok("a task is created", weekly.ok, weekly.ok ? "" : weekly.message);
  if (!weekly.ok) return report();

  const noDue = await createTask(admin, { workspaceId: wsA, title: "No date", assignedTo: OWNER, ...base });
  const cannotRecur = noDue.ok
    ? await setRecurrence(admin, { workspaceId: wsA, taskId: noDue.data.id, recurrence: "weekly", ...base })
    : null;
  ok("a task with no due date cannot recur -- there is nothing to count from",
    cannotRecur?.ok === false && cannotRecur.code === "DUE_DATE_REQUIRED",
    cannotRecur?.ok ? "set" : cannotRecur?.code);

  const badRule = await setRecurrence(admin, { workspaceId: wsA, taskId: weekly.data.id, recurrence: "hourly", ...base });
  ok("an unknown recurrence is refused", !badRule.ok);

  const set = await setRecurrence(admin, { workspaceId: wsA, taskId: weekly.data.id, recurrence: "weekly", ...base });
  ok("a weekly recurrence is set", set.ok, set.ok ? "" : set.message);

  const beforeClose = await listTasks(admin, wsA, {});
  ok("SETTING A RECURRENCE PRE-GENERATES NOTHING -- no board full of copies nobody has committed to",
    beforeClose.length === 2, String(beforeClose.length));

  const done = await transitionTask(admin, { workspaceId: wsA, taskId: weekly.data.id, to: "DONE", ...base });
  ok("completing it produces the next one", done.ok && !!done.data.recurred,
    done.ok ? JSON.stringify(done.data) : done.message);
  ok("COUNTED FROM THE DUE DATE, NOT FROM TODAY -- a late check does not drag the series with it",
    done.ok && done.data.recurred?.dueOn === dueDateFrom(dueOn, 7),
    done.ok ? `${done.data.recurred?.dueOn} vs ${dueDateFrom(dueOn, 7)}` : "");
  ok("and the new one carries the recurrence forward",
    (await listTasks(admin, wsA, {})).filter((t: any) => t.recurrence === "weekly" && t.status === "OPEN").length === 1);

  // ── 3. A cancelled task does not breed ───────────────────────────────────
  const next = done.ok && done.data.recurred ? done.data.recurred.id : null;
  if (!next) { ok("the next occurrence exists", false); return report(); }
  const cancelled = await transitionTask(admin, { workspaceId: wsA, taskId: next, to: "CANCELLED", ...base });
  ok("A CANCELLED TASK DOES NOT BREED -- cancelling says it should not have been here",
    cancelled.ok && !cancelled.data.recurred, cancelled.ok ? JSON.stringify(cancelled.data) : cancelled.message);

  // ── 4. The series stops ──────────────────────────────────────────────────
  const ending = await createTask(admin, {
    workspaceId: wsA, title: "Ends soon", assignedTo: OWNER, dueOn: today, ...base,
  });
  if (!ending.ok) { ok("bounded task created", false, ending.message); return report(); }
  await setRecurrence(admin, {
    workspaceId: wsA, taskId: ending.data.id, recurrence: "weekly", until: dueDateFrom(today, 3), ...base,
  });
  const past = await transitionTask(admin, { workspaceId: wsA, taskId: ending.data.id, to: "DONE", ...base });
  ok("THE SERIES STOPS at its end date rather than running for ever",
    past.ok && !past.data.recurred, past.ok ? JSON.stringify(past.data) : past.message);

  // ── 5 and 6. Escalation, derived ─────────────────────────────────────────
  const none = await escalations(admin, wsA);
  ok("with no rule configured, nothing is escalated and it says so",
    none.configured === false && none.tasks.length === 0, JSON.stringify({ c: none.configured }));

  const urgentLate = await createTask(admin, {
    workspaceId: wsA, title: "Chase the biopsy", assignedTo: OWNER, priority: "urgent",
    dueOn: dueDateFrom(today, -5), ...base,
  });
  const urgentRecent = await createTask(admin, {
    workspaceId: wsA, title: "Order gloves", assignedTo: OWNER, priority: "urgent",
    dueOn: dueDateFrom(today, -1), ...base,
  });
  ok("two overdue urgent tasks exist, one older than the other",
    urgentLate.ok && urgentRecent.ok, [urgentLate, urgentRecent].map(r => r.ok ? "ok" : r.message).join("; "));

  const rule = await setEscalationRule(admin, { workspaceId: wsA, priority: "urgent", daysOverdue: 3, ...base });
  ok("an escalation rule is set", rule.ok, rule.ok ? "" : rule.message);
  const badPriority = await setEscalationRule(admin, { workspaceId: wsA, priority: "critical", daysOverdue: 1, ...base });
  ok("a priority outside this product's vocabulary is refused", !badPriority.ok);

  const escalated = await escalations(admin, wsA);
  ok("ESCALATION IS DERIVED: the five-day-overdue task is escalated the moment the rule exists, with nothing re-run",
    escalated.tasks.length === 1 && escalated.tasks[0].title === "Chase the biopsy",
    escalated.tasks.map((t: any) => t.title).join(", "));
  ok("A TASK BELOW THE THRESHOLD IS NOT ESCALATED -- the rule discriminates",
    !escalated.tasks.some((t: any) => t.title === "Order gloves"),
    escalated.tasks.map((t: any) => `${t.title}:${t.daysOverdue}`).join(", "));
  ok("and it says nothing was sent",
    escalated.notificationsSent === false && escalated.configured === true);

  // Change the rule; the answer changes on the next READ, with nothing re-run.
  await setEscalationRule(admin, { workspaceId: wsA, priority: "urgent", daysOverdue: 1, ...base });
  const widened = await escalations(admin, wsA);
  ok("CHANGING THE RULE CHANGES WHAT IS ESCALATED, immediately and with nothing re-run",
    widened.tasks.length === 2, widened.tasks.map((t: any) => t.title).join(", "));
  const { data: columns } = await admin.from("practice_task").select("*").eq("id", urgentLate.ok ? urgentLate.data.id : "").maybeSingle();
  ok("THERE IS NO `escalated` COLUMN -- it is a fact about the clock, not about the row",
    !Object.keys(columns ?? {}).some(k => /escalat/i.test(k)),
    Object.keys(columns ?? {}).filter(k => /escalat/i.test(k)).join(","));

  // ── 7. Templates ─────────────────────────────────────────────────────────
  const emptyTemplate = await createTaskTemplate(admin, {
    workspaceId: wsA, code: "empty", title: "Nothing", items: [], ...base,
  });
  ok("a template with no tasks is refused", !emptyTemplate.ok);

  const template = await createTaskTemplate(admin, {
    workspaceId: wsA, code: "onboarding", title: "New patient onboarding",
    items: [
      { title: "Register and verify identity", offsetDays: 0, priority: "soon" },
      { title: "Book the first appointment", offsetDays: 1 },
      { title: "Send the welcome pack", offsetDays: 3 },
      { title: "Check they attended", offsetDays: 14 },
    ],
    ...base,
  });
  ok("CONTROL: a real template is created", template.ok, template.ok ? "" : template.message);
  if (!template.ok) return report();
  ok("a template makes SEVERAL tasks, not one collapsed into a word",
    (await listTaskTemplates(admin, wsA))[0]?.items.length === 4);

  const applied = await applyTaskTemplate(admin, {
    workspaceId: wsA, templateId: template.data.id, assignedTo: OWNER, startDay: today, ...base,
  });
  ok("applying it creates every task in it",
    applied.ok && applied.data.created.length === 4 && applied.data.refused.length === 0,
    applied.ok ? JSON.stringify({ c: applied.data.created.length, r: applied.data.refused.length }) : applied.message);
  if (!applied.ok) return report();

  const madeTasks = await listTasks(admin, wsA, {});
  const welcome = madeTasks.find((t: any) => t.title === "Send the welcome pack");
  const attended = madeTasks.find((t: any) => t.title === "Check they attended");
  ok("OFFSETS RUN FROM THE START, never chained -- 3 days and 14 days from today, not 3 then 17",
    welcome?.due_on === dueDateFrom(today, 3) && attended?.due_on === dueDateFrom(today, 14),
    `${welcome?.due_on} / ${attended?.due_on}`);

  // ── 8. Bulk ──────────────────────────────────────────────────────────────
  const blockInBulk = await bulkTransition(admin, {
    workspaceId: wsA, taskIds: applied.data.created, to: "BLOCKED", ...base,
  });
  ok("BULK ONLY CLOSES -- anything that needs a reason is refused in bulk",
    !blockInBulk.ok && blockInBulk.code === "NOT_BULK_SAFE", blockInBulk.ok ? "changed" : blockInBulk.code);

  const bulkDone = await bulkTransition(admin, {
    workspaceId: wsA, taskIds: [...applied.data.created, "00000000-0000-4000-8000-00000000beef"], to: "DONE", ...base,
  });
  ok("a bulk close works and REPORTS BOTH NUMBERS",
    bulkDone.ok && bulkDone.data.changed === 4 && bulkDone.data.refused.length === 1,
    bulkDone.ok ? JSON.stringify({ c: bulkDone.data.changed, r: bulkDone.data.refused.length }) : bulkDone.message);
  const bulkEmpty = await bulkTransition(admin, { workspaceId: wsA, taskIds: [], to: "DONE", ...base });
  ok("closing nothing is refused", !bulkEmpty.ok);

  // ── 9. The agenda ────────────────────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nsubuga Peter", sex: "male", birthDate: "1982-12-01",
    phone: "0772 555 800", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }
  await bookAppointment(admin, {
    workspaceId: wsA, patientId: p1.data.id, patientName: "Nsubuga Peter",
    appointmentType: "scheduled_followup", scheduledAt: `${today}T08:00:00.000Z`, allowOverlap: true, ...base,
  });
  await createTask(admin, {
    workspaceId: wsA, title: "Due today", assignedTo: OWNER, dueOn: today, ...base,
  });
  await createTask(admin, {
    workspaceId: wsA, title: "Reminded today, due later", assignedTo: OWNER,
    dueOn: dueDateFrom(today, 10), remindOn: today, ...base,
  });

  const agenda = await dailyAgenda(admin, wsA, OWNER);
  ok("the agenda is composed for the practice's day",
    agenda.day === today && agenda.timezone === "Africa/Kampala", `${agenda.day} ${agenda.timezone}`);
  ok("it counts appointments, tasks due and reminders SEPARATELY",
    agenda.counts.appointments === 1 && agenda.counts.dueToday >= 1 && agenda.counts.reminders === 1,
    JSON.stringify(agenda.counts));
  ok("a task reminded today but due later is a REMINDER, not something due",
    agenda.remindersToday.some((t: any) => t.title === "Reminded today, due later") &&
    !agenda.dueToday.some((t: any) => t.title === "Reminded today, due later"));
  ok("THE AGENDA CONTAINS NO PERCENTAGE ANYWHERE",
    !/\d+(\.\d+)?%/.test(JSON.stringify(agenda)) && !/"(focusScore|rate|percent)"/i.test(JSON.stringify(agenda)));

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossRecur = await setRecurrence(admin, {
    workspaceId: wsB, taskId: weekly.data.id, recurrence: "daily", actorId: OTHER, correlationId: "h",
  });
  ok("another workspace's task cannot be made to recur", !crossRecur.ok && crossRecur.code === "NOT_FOUND");
  const crossBulk = await bulkTransition(admin, {
    workspaceId: wsB, taskIds: applied.data.created, to: "DONE", actorId: OTHER, correlationId: "h",
  });
  ok("A BULK CLOSE CANNOT REACH ANOTHER WORKSPACE'S TASKS",
    crossBulk.ok && crossBulk.data.changed === 0, crossBulk.ok ? JSON.stringify(crossBulk.data) : crossBulk.message);
  ok("B's agenda is empty", (await dailyAgenda(admin, wsB, OTHER)).counts.appointments === 0);
  ok("A's is not (the isolation test is not vacuous)", agenda.counts.appointments > 0);
  ok("B escalates none of A's tasks", (await escalations(admin, wsB)).tasks.length === 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
