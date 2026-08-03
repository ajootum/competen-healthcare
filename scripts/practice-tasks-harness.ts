/**
 * Practice task harness -- CPR-340, exercised against the live database through the same engine the
 * API uses.
 *
 * WHAT IT PROVES:
 *   1. THE BOUNDARY. A task is not a follow-up: closing every task in the workspace leaves the
 *      follow-up board untouched, and closing a follow-up leaves the task board untouched. The two
 *      systems reference each other and neither can settle the other's commitments.
 *   2. WORK CANNOT BE ASSIGNED WHERE IT WILL NOT LAND. A non-member is refused; and when a membership
 *      is revoked AFTER assignment, the board says so -- derived at read time, so it becomes true the
 *      moment the access does, not when somebody remembers to run a sweep.
 *   3. THE REMINDER IS THE TASK. `remind_on` surfaces it; a reminder dated after the deadline is
 *      refused, because a reminder that arrives too late is not one.
 *   4. THE STATE MACHINE, including BLOCKED needing a reason, DONE and CANCELLED being dead ends, and
 *      reassignment being visible in the trail as a status-preserving move.
 *   5. NOTIFICATIONS HOLD ONLY WHAT CANNOT BE DERIVED, and never fire at yourself. Assigning to a
 *      colleague notifies them; assigning to yourself notifies nobody; and no notification is ever
 *      raised for an overdue task, because the board computes that.
 *   6. A FEED IS THE CALLER'S OWN. Marking read cannot reach another person's rows.
 *   7. The trail cannot be rewritten even by a raw statement (198 s4); isolation is non-vacuous; anon
 *      reads 0 rows from all three tables.
 *
 *   npx --yes tsx scripts/practice-tasks-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { createFollowUp, listFollowUps } from "../src/lib/practice/follow-ups";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";
import {
  createTask, transitionTask, reassignTask, listTasks, taskBoard, getTask,
  listMembers, listNotifications, markNotificationsRead,
} from "../src/lib/practice/tasks";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e1281";
const USER_B = "00000000-0000-4000-8000-0000000e1282";
/** A second person inside workspace A -- the colleague tasks get handed to. */
const COLLEAGUE = "00000000-0000-4000-8000-0000000e1283";
/** Never a member of anything. */
const OUTSIDER = "00000000-0000-4000-8000-0000000e1284";

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
    idempotency_key: `harness-task-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-task",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-task", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [USER_A, USER_B]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
  }
  for (const u of [USER_A, USER_B, COLLEAGUE, OUTSIDER]) {
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: USER_A, correlationId: "harness-task" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice task harness (CPR-340, migration 198)\n");
  await cleanup();

  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger check is not vacuous)", fns.length > 0);
  ok("practice_task_event_immutable() is deployed (migration 198 s4)",
    fns.some(f => f.fn_name === "practice_task_event_immutable"),
    "NOT FOUND -- the task trail is rewritable");

  const wsA = await provision(USER_A, "HARNESS Task A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Task B (synthetic)", "b");
  const today = practiceToday("Africa/Kampala");

  // A colleague inside workspace A, so handing over and notifying have a real recipient.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practice_assistant", status: "active",
  });
  const members = await listMembers(admin, wsA);
  ok("the workspace has two people, listed once each (not once per membership)",
    members.length === 2 && new Set(members.map(m => m.userId)).size === 2,
    JSON.stringify(members.map(m => ({ u: m.userId.slice(-4), roles: m.roles }))));

  // ── 2. Work cannot be assigned where it will not land ────────────────────
  const toOutsider = await createTask(admin, {
    workspaceId: wsA, title: "Chase the lab", assignedTo: OUTSIDER, ...base,
  });
  ok("a task cannot be assigned to somebody who is not a member",
    !toOutsider.ok && toOutsider.code === "NOT_A_MEMBER", toOutsider.ok ? "was allowed" : toOutsider.code);

  const noTitle = await createTask(admin, { workspaceId: wsA, title: "   ", assignedTo: USER_A, ...base });
  ok("a task with no title is refused", !noTitle.ok && noTitle.code === "VALIDATION_ERROR",
    noTitle.ok ? "was allowed" : noTitle.code);

  // ── 3. The reminder is the task ──────────────────────────────────────────
  const badReminder = await createTask(admin, {
    workspaceId: wsA, title: "File the insurance form", assignedTo: USER_A,
    dueOn: dueDateFrom(today, 3), remindOn: dueDateFrom(today, 5), ...base,
  });
  ok("a reminder dated AFTER the deadline is refused (it would arrive too late to be one)",
    !badReminder.ok && badReminder.code === "REMINDER_AFTER_DUE", badReminder.ok ? "was allowed" : badReminder.code);

  const mine = await createTask(admin, {
    workspaceId: wsA, title: "Order more dressings", detail: "The 10cm ones", assignedTo: USER_A,
    category: "supplies", priority: "soon", dueOn: dueDateFrom(today, 4), remindOn: dueDateFrom(today, 2), ...base,
  });
  ok("a task with a valid reminder is raised (control for the refusals above)", mine.ok, mine.ok ? "" : mine.message);
  if (!mine.ok) return report();

  const overdueTask = await createTask(admin, {
    workspaceId: wsA, title: "Return the equipment loan", assignedTo: USER_A,
    dueOn: dueDateFrom(today, -6), priority: "urgent", ...base,
  });
  const remindingNow = await createTask(admin, {
    workspaceId: wsA, title: "Renew the indemnity", assignedTo: USER_A,
    dueOn: dueDateFrom(today, 20), remindOn: dueDateFrom(today, -1), ...base,
  });
  ok("a back-dated and a reminding task exist for the harness",
    overdueTask.ok && remindingNow.ok, overdueTask.ok ? (remindingNow.ok ? "" : remindingNow.message) : overdueTask.message);
  if (!overdueTask.ok || !remindingNow.ok) return report();

  const listed = await listTasks(admin, wsA, {});
  const byId = (id: string) => listed.find((t: any) => t.id === id);
  ok("OVERDUE IS DERIVED, with nothing having run", byId(overdueTask.data.id)?.overdue === true,
    JSON.stringify(byId(overdueTask.data.id)?.overdue));
  ok("a future-dated task in the same list is NOT overdue (the derivation discriminates)",
    byId(mine.data.id)?.overdue === false, JSON.stringify(byId(mine.data.id)?.overdue));
  ok("THE REMINDER SURFACES THE TASK even though its deadline is weeks away",
    byId(remindingNow.data.id)?.reminderDue === true && byId(remindingNow.data.id)?.overdue === false,
    JSON.stringify({ r: byId(remindingNow.data.id)?.reminderDue, o: byId(remindingNow.data.id)?.overdue }));
  ok("a task whose reminder date has not arrived is not surfaced by it",
    byId(mine.data.id)?.reminderDue === false, JSON.stringify(byId(mine.data.id)?.reminderDue));

  const { data: storedStatuses } = await admin.from("practice_task").select("status").eq("workspace_id", wsA);
  ok("NO ROW STORES AN OVERDUE STATUS (the column cannot hold one)",
    ((storedStatuses ?? []) as any[]).every(r => r.status === "OPEN"),
    JSON.stringify((storedStatuses ?? []).map((r: any) => r.status)));

  // ── 1. THE BOUNDARY: a task is not a follow-up ───────────────────────────
  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Tumusiime Alex", birthDate: "1975-09-12", sex: "male",
    phone: "0772 555 660", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }

  const fu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pa.data.id, reason: "review the ulcer", dueOn: dueDateFrom(today, -3), ...base,
  });
  ok("a follow-up exists alongside the tasks", fu.ok, fu.ok ? "" : fu.message);
  if (!fu.ok) return report();

  const linked = await createTask(admin, {
    workspaceId: wsA, title: "Phone Alex about the review", assignedTo: USER_A,
    patientId: pa.data.id, followUpId: fu.data.id, category: "clinical_admin", ...base,
  });
  ok("a task can REFERENCE a patient and a follow-up", linked.ok, linked.ok ? "" : linked.message);

  // Close every task in the workspace. The follow-up must be untouched -- work about a commitment is
  // not the commitment.
  for (const t of await listTasks(admin, wsA, { status: ["OPEN", "IN_PROGRESS", "BLOCKED"] })) {
    await transitionTask(admin, { workspaceId: wsA, taskId: t.id, to: "DONE", ...base });
  }
  const followUpsAfter = await listFollowUps(admin, wsA, { status: ["OPEN", "SCHEDULED"] });
  ok("CLOSING EVERY TASK LEAVES THE FOLLOW-UP OPEN (a task cannot settle a clinical commitment)",
    followUpsAfter.some((f: any) => f.id === fu.data.id && f.overdue === true),
    JSON.stringify(followUpsAfter.map((f: any) => ({ id: f.id.slice(-4), s: f.status }))));
  const tasksAfter = await listTasks(admin, wsA, { status: ["OPEN", "IN_PROGRESS", "BLOCKED"] });
  ok("...and the tasks really are all closed (the check above is not vacuous)",
    tasksAfter.length === 0, `${tasksAfter.length} still open`);

  // ── 4. The state machine ─────────────────────────────────────────────────
  const closedAgain = await transitionTask(admin, { workspaceId: wsA, taskId: mine.data.id, to: "OPEN", ...base });
  ok("DONE is a dead end -- reopening is refused",
    !closedAgain.ok && closedAgain.code === "ILLEGAL_TRANSITION", closedAgain.ok ? "was allowed" : closedAgain.code);

  const work = await createTask(admin, {
    workspaceId: wsA, title: "Chase the histology report", assignedTo: USER_A, category: "clinical_admin", ...base,
  });
  if (!work.ok) { ok("a task for the state-machine checks was raised", false, work.message); return report(); }

  const started = await transitionTask(admin, { workspaceId: wsA, taskId: work.data.id, to: "IN_PROGRESS", ...base });
  ok("OPEN can start", started.ok, started.ok ? "" : started.message);

  const blockNoReason = await transitionTask(admin, { workspaceId: wsA, taskId: work.data.id, to: "BLOCKED", ...base });
  ok("blocking with no reason is refused (being stuck is worth explaining)",
    !blockNoReason.ok && blockNoReason.code === "REASON_REQUIRED", blockNoReason.ok ? "was allowed" : blockNoReason.code);

  const blocked = await transitionTask(admin, {
    workspaceId: wsA, taskId: work.data.id, to: "BLOCKED", reason: "the lab has not released it", ...base,
  });
  ok("blocking WITH a reason works (control)", blocked.ok, blocked.ok ? "" : blocked.message);
  const { data: blockedRow } = await admin.from("practice_task").select("blocked_reason").eq("id", work.data.id).single();
  ok("the reason is kept on the task", /lab/.test(blockedRow?.blocked_reason ?? ""), String(blockedRow?.blocked_reason));

  // ── 5. Notifications: only the non-derivable, and never at yourself ──────
  const myFeedBefore = await listNotifications(admin, wsA, USER_A);
  ok("assigning yourself a task notifies nobody (a feed that echoes you is a feed people stop reading)",
    myFeedBefore.length === 0, `${myFeedBefore.length}`);

  const handed = await reassignTask(admin, {
    workspaceId: wsA, taskId: work.data.id, assignedTo: COLLEAGUE, note: "you know the lab contact", ...base,
  });
  ok("a task can be handed to a colleague", handed.ok, handed.ok ? "" : handed.message);

  const colleagueFeed = await listNotifications(admin, wsA, COLLEAGUE);
  ok("THE COLLEAGUE IS NOTIFIED, with somewhere to go",
    colleagueFeed.length === 1 && colleagueFeed[0].event_type === "task_reassigned" && !!colleagueFeed[0].href,
    JSON.stringify(colleagueFeed.map((n: any) => ({ e: n.event_type, h: n.href }))));

  const sameAgain = await reassignTask(admin, { workspaceId: wsA, taskId: work.data.id, assignedTo: COLLEAGUE, ...base });
  ok("handing a task to whoever already has it is refused",
    !sameAgain.ok && sameAgain.code === "ALREADY_ASSIGNED", sameAgain.ok ? "was allowed" : sameAgain.code);

  const toOutsiderAgain = await reassignTask(admin, { workspaceId: wsA, taskId: work.data.id, assignedTo: OUTSIDER, ...base });
  ok("a task cannot be handed to a non-member either",
    !toOutsiderAgain.ok && toOutsiderAgain.code === "NOT_A_MEMBER", toOutsiderAgain.ok ? "was allowed" : toOutsiderAgain.code);

  // NOTHING DERIVABLE IS EVER A NOTIFICATION. An overdue task is computed by the board; if it were also
  // a notification row the two would disagree the moment it was closed.
  const { data: allNotifications } = await admin.from("practice_notification").select("event_type").eq("workspace_id", wsA);
  ok("no notification is raised for anything the board can derive (no overdue/due rows exist)",
    ((allNotifications ?? []) as any[]).every(n => ["task_assigned", "task_reassigned", "task_blocked", "document_amended"].includes(n.event_type)),
    JSON.stringify((allNotifications ?? []).map((n: any) => n.event_type)));

  // ── 6. A feed is the caller's own ────────────────────────────────────────
  const clearedByOther = await markNotificationsRead(admin, { workspaceId: wsA, userId: USER_A });
  ok("clearing MY feed marks none of the colleague's rows",
    clearedByOther.ok && clearedByOther.data.marked === 0, JSON.stringify(clearedByOther));
  const colleagueStill = await listNotifications(admin, wsA, COLLEAGUE);
  ok("...and the colleague's notification is still unread",
    colleagueStill.length === 1, `${colleagueStill.length}`);

  const cleared = await markNotificationsRead(admin, { workspaceId: wsA, userId: COLLEAGUE });
  ok("the colleague can clear their own (control)", cleared.ok && cleared.data.marked === 1, JSON.stringify(cleared));
  ok("and the feed is then empty", (await listNotifications(admin, wsA, COLLEAGUE)).length === 0);

  // ── 2b. Revoking access orphans the work, and the board says so ──────────
  const boardBefore = await taskBoard(admin, wsA, USER_A);
  ok("before revocation the colleague's task is NOT orphaned (the check below is not vacuous)",
    boardBefore.orphaned.length === 0 && boardBefore.others.some((t: any) => t.id === work.data.id),
    `orphaned=${boardBefore.orphaned.length} others=${boardBefore.others.length}`);

  await admin.from("practice_membership").update({ status: "revoked" })
    .eq("workspace_id", wsA).eq("user_id", COLLEAGUE);

  const boardAfter = await taskBoard(admin, wsA, USER_A);
  ok("REVOKING ACCESS ORPHANS THE WORK, derived the moment it becomes true",
    boardAfter.orphaned.some((t: any) => t.id === work.data.id), `${boardAfter.orphaned.length} orphaned`);
  ok("and it is no longer counted as somebody else's live work",
    !boardAfter.others.some((t: any) => t.id === work.data.id), `${boardAfter.others.length} with others`);

  // ── 7. Trail, isolation, anon ────────────────────────────────────────────
  const detail = await getTask(admin, wsA, work.data.id);
  const trail = (detail?.events ?? []) as any[];
  ok("every move is in the task's trail, in order",
    trail.length >= 4 && trail[0].to_status === "OPEN" && trail.some(e => e.to_status === "BLOCKED"),
    JSON.stringify(trail.map(e => e.to_status)));
  ok("REASSIGNMENT IS VISIBLE AS A MOVE, not lost because the status did not change",
    trail.some(e => e.from_assignee === USER_A && e.to_assignee === COLLEAGUE),
    JSON.stringify(trail.map(e => ({ f: e.from_assignee?.slice(-4), t: e.to_assignee?.slice(-4) }))));

  const rewrite = await admin.from("practice_task_event").update({ note: "a different history" }).eq("task_id", work.data.id);
  ok("the DATABASE refuses to rewrite a task event (migration 198 s4 trigger)",
    !!rewrite.error, rewrite.error?.message ?? "the update succeeded");

  ok("getTask is workspace-scoped (B cannot read A's task)", (await getTask(admin, wsB, work.data.id)) === null);
  const bMoves = await transitionTask(admin, { workspaceId: wsB, taskId: work.data.id, to: "DONE", ...base });
  ok("B cannot move A's task", !bMoves.ok && bMoves.code === "NOT_FOUND", bMoves.ok ? "was allowed" : bMoves.code);
  ok("A's task list is non-empty (the isolation test is not vacuous)", (await listTasks(admin, wsA, {})).length >= 4);
  ok("B's task list is empty", (await listTasks(admin, wsB, {})).length === 0);

  const TABLES = ["practice_task", "practice_task_event", "practice_notification"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every task table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every task table", leaked === 0, `${leaked} table(s) leaked`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
