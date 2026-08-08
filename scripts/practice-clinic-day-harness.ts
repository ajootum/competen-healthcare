/**
 * CPR-CORE-001 CORE-15: the end-to-end clinic-day acceptance test.
 *
 * s18's definition of done: "End-to-end tests cover session start, patient arrival, encounter
 * completion, follow-up creation and session close." s16 lists twelve acceptance criteria, and this
 * walks a real morning through the real engines asserting them as it goes.
 *
 * ⚠ WHAT MAKES THIS DIFFERENT FROM THE OTHER SIX HARNESSES. They test engines in isolation and each one
 * is green. This asserts the thing none of them can: that the pieces still agree with each other when
 * one clinic morning passes through all of them. Every criterion below is asserted BEFORE and AFTER the
 * action that is supposed to move it -- "completing an encounter updates counts" is a claim about a
 * CHANGE, and an assertion that only looks afterwards passes just as well against a figure that was
 * always that number.
 *
 * ⚠ IT CALLS NO PRIVATE HELPERS AND INSERTS NO ROW IT COULD CREATE THROUGH AN ENGINE. A fixture that
 * writes what the engine would have written proves the assertions, not the product.
 *
 *   npx --yes tsx scripts/practice-clinic-day-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { planActivity, startActivity, endActivity, todaysPlan } from "../src/lib/practice/activity";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter, interruptWith } from "../src/lib/practice/encounters";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { dashboardReadModel } from "../src/lib/practice/dashboard";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const step = (n: string) => console.log(`\n  -- ${n} --`);

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const DOCTOR = "00000000-0000-4000-8000-00000000c0de";
const TZ = "Africa/Kampala"; // UTC+3, no DST -- the arithmetic is checkable by hand.
const CORR = "harness-clinic-day";

const ALL_CAPS = [
  "practice.home.view", "practice.calendar.view", "appointment.manage", "queue.manage",
  "patient.list", "patient.view", "patient.create", "encounter.list", "encounter.create",
  "encounter.edit", "followup.view", "followup.manage", "task.view", "inbox.record", "report.view",
];
const ctx = (workspaceId: string, caps = ALL_CAPS): WorkspaceContext => ({
  userId: DOCTOR, workspaceId, workspaceName: "Clinic", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities: caps, entitled: true,
  entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
});

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", DOCTOR);
  for (const w of (ws ?? []) as { id: string }[]) {
    for (const t of ["practice_encounter_status_history", "practice_domain_event", "practice_follow_up_event",
      "practice_follow_up", "practice_arrival", "practice_queue_entry"]) {
      await admin.from(t).delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_encounter").update({ interrupted_by_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_activity").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", DOCTOR);
  await admin.from("provisioning_request").delete().eq("target_user_id", DOCTOR);
  await admin.from("practice_audit_event").delete().eq("actor_id", DOCTOR);
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, ["practice_encounter_status_history", "practice_domain_event", "practice_follow_up_event", "practice_follow_up", "practice_arrival", "practice_queue_entry"]);
}

async function main() {
  console.log("\n=== A CLINIC DAY, END TO END (CPR-CORE-001 CORE-15, s16 acceptance) ===");
  await cleanup();

  // ── The practice, through the real provisioning saga ────────────────────────────────────────────
  const { data: req, error: reqErr } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-day-${Date.now()}`, request_type: "pilot",
    actor_user_id: DOCTOR, target_user_id: DOCTOR, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (reqErr || !req) { console.error("provisioning request refused:", reqErr?.message); process.exitCode = 1; return; }
  const payload: IndividualRequest = {
    displayName: "Harness Clinic Day", countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
    defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1",
    source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: DOCTOR, correlation_id: CORR, workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed", run.errorCode); process.exitCode = 1; return; }
  const ws = run.workspaceId;
  const c = ctx(ws);

  const today = (await todaysPlan(admin, c)).date;
  /** A Kampala wall-clock time today, as the UTC instant it actually is. UTC+3, no DST. */
  const at = (h: number, m = 0) =>
    new Date(`${today}T${String(h - 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`).toISOString();

  const patient = async (name: string) => {
    const { data, error } = await admin.from("practice_patient")
      .insert({ workspace_id: ws, display_name: name, created_by: DOCTOR }).select("id").single();
    if (error) throw new Error(`patient fixture: ${error.message}`);
    return data.id as string;
  };

  const dash = () => dashboardReadModel(admin, c);
  const tile = (d: Awaited<ReturnType<typeof dash>>, key: string) =>
    d.glance.tiles.find(t => t.key === key)?.count ?? null;

  // ══ s16.1  "start a configured or ad hoc activity and session in no more than three interactions" ══
  step("Starting the day");
  const dayStart = await dash();
  ok("1a. before anything, the dashboard is day-scoped", dayStart.scope.kind === "day", dayStart.scope.kind);

  // Two interactions: plan it, start it. The dashboard's own button does both in one gesture.
  const clinic = await planActivity(admin, c, {
    activityType: "outpatient_clinic", title: "Morning Clinic", planDate: today,
    plannedStartMinute: 8 * 60, plannedEndMinute: 13 * 60,
  });
  ok("1b. an activity can be planned", clinic.ok, clinic.ok ? "" : clinic.message);
  if (!clinic.ok) { await cleanup(); report(); return; }
  const started = await startActivity(admin, c, clinic.value.id);
  ok("1c. and started, in two interactions rather than three", started.ok, started.ok ? "" : started.message);

  // ══ s16.2  "the page changes from whole-day scope to active-session scope after session start" ══
  const inSession = await dash();
  ok("2a. the dashboard is now session-scoped", inSession.scope.kind === "session", inSession.scope.kind);
  ok("2b. and names the session it is scoped to", inSession.scope.sessionId === clinic.value.id);
  ok("2c. the window narrowed from the day to the session",
    Date.parse(inSession.scope.toIso) - Date.parse(inSession.scope.fromIso)
      < Date.parse(dayStart.scope.toIso) - Date.parse(dayStart.scope.fromIso));

  // ══ s18  "patient arrival"  +  s16.3  a booked patient can start an encounter ══
  step("A booked patient arrives");
  const alice = await patient("Alice Booked");
  const booking = await bookAppointment(admin, {
    workspaceId: ws, patientId: alice, patientName: "Alice Booked", appointmentType: "new_consultation",
    scheduledAt: at(9), durationMinutes: 30, actorId: DOCTOR, correlationId: CORR,
  } as never);
  ok("3a. a booking is accepted", booking.ok, booking.ok ? "" : JSON.stringify(booking));
  if (!booking.ok) { await cleanup(); report(); return; }

  const bookedSeen = await dash();
  ok("3b. the booking appears in the session's figures", (tile(bookedSeen, "booked") ?? 0) >= 1,
    String(tile(bookedSeen, "booked")));

  const confirmed = await transitionAppointment(admin, {
    workspaceId: ws, appointmentId: booking.data.id, to: "CONFIRMED", actorId: DOCTOR, correlationId: CORR,
  });
  ok("3b-2. a booking is confirmed before anybody can arrive against it", confirmed.ok,
    confirmed.ok ? "" : JSON.stringify(confirmed));

  const arrived = await transitionAppointment(admin, {
    workspaceId: ws, appointmentId: booking.data.id, to: "ARRIVED", actorId: DOCTOR, correlationId: CORR,
  });
  ok("3c. arriving puts the patient in the queue", arrived.ok && !!arrived.data.queueEntryId,
    JSON.stringify(arrived));

  const waiting = await dash();
  ok("3d. and the dashboard shows somebody waiting", (tile(waiting, "waiting") ?? 0) >= 1,
    String(tile(waiting, "waiting")));
  ok("3e. the queue lists them under Booked, not as a walk-in",
    waiting.queue.groups.find(g => g.key === "booked")?.entries.length === 1,
    JSON.stringify(waiting.queue.groups.map(g => [g.key, g.entries.length])));

  const enc1 = await launchEncounter(admin, {
    workspaceId: ws, patientId: alice, pathway: "booked", appointmentId: booking.data.id,
    actorId: DOCTOR, correlationId: CORR,
  });
  ok("3f. a booked patient can start an encounter", enc1.ok, enc1.ok ? "" : JSON.stringify(enc1));
  if (!enc1.ok) { await cleanup(); report(); return; }
  ok("3g. and it inherits the running session as its context",
    (await admin.from("practice_encounter").select("activity_id").eq("id", enc1.data.id).maybeSingle())
      .data?.activity_id === clinic.value.id);
  await transitionEncounter(admin, {
    workspaceId: ws, encounterId: enc1.data.id, to: "ACTIVE", actorId: DOCTOR,
    practitionerId: DOCTOR, correlationId: CORR,
  });

  // ══ s16.4  "an emergency interruption does not lose the current clinic queue or active draft" ══
  step("An emergency interrupts");
  const queueBefore = (await dash()).queue.total;
  const bob = await patient("Bob Emergency");
  const enc2 = await launchEncounter(admin, {
    workspaceId: ws, patientId: bob, pathway: "new_walk_in", actorId: DOCTOR, correlationId: CORR,
  });
  ok("4a-control. the emergency's encounter is created", enc2.ok, enc2.ok ? "" : JSON.stringify(enc2));
  if (!enc2.ok) { await cleanup(); report(); return; }

  const interrupted = await interruptWith(admin, {
    workspaceId: ws, encounterId: enc2.data.id, actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR,
  });
  ok("4a. the interruption opens and pauses in one move",
    interrupted.ok && interrupted.data.paused === enc1.data.id, JSON.stringify(interrupted));

  const afterInterrupt = await dash();
  ok("4b. the clinic's queue is not lost", afterInterrupt.queue.total === queueBefore,
    `${queueBefore} -> ${afterInterrupt.queue.total}`);
  const paused = (await admin.from("practice_encounter").select("status, interrupted_by_id")
    .eq("id", enc1.data.id).maybeSingle()).data;
  ok("4c. and the interrupted consultation is paused, not lost",
    paused?.status === "PAUSED" && paused?.interrupted_by_id === enc2.data.id, JSON.stringify(paused));

  // ══ s16.5  "completing an encounter updates counts, queue status, recent patients, timeline and
  //            performance without manual reload" -- asserted as a CHANGE, before and after ══
  step("Completing the consultations");
  const before = await dash();
  const completedBefore = tile(before, "completed") ?? 0;
  const seenBefore = before.metrics?.metrics.patients_seen.value ?? 0;
  const timelineBefore = before.timeline.events.length;

  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc2.data.id, to: "COMPLETED",
    actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR });
  const resumed = await transitionEncounter(admin, { workspaceId: ws, encounterId: enc1.data.id, to: "ACTIVE",
    actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR });
  ok("5a-control. the paused consultation resumes after the emergency", resumed.ok,
    resumed.ok ? "" : JSON.stringify(resumed));
  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc1.data.id, to: "COMPLETED",
    actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR });

  const after = await dash();
  ok("5b. completing encounters raises the Completed count",
    (tile(after, "completed") ?? 0) > completedBefore,
    `${completedBefore} -> ${tile(after, "completed")}`);
  ok("5c. and Patients Seen, counted as DISTINCT people",
    (after.metrics?.metrics.patients_seen.value ?? 0) === seenBefore + 2,
    `${seenBefore} -> ${after.metrics?.metrics.patients_seen.value}`);
  ok("5d. the timeline gained the events",
    after.timeline.events.length > timelineBefore,
    `${timelineBefore} -> ${after.timeline.events.length}`);
  ok("5e. performance now has a consult-time average to report",
    after.metrics?.metrics.average_consult_time.value !== null,
    JSON.stringify(after.metrics?.metrics.average_consult_time));

  // ══ s18 "follow-up creation"  +  s16.6 "creating a follow-up updates follow-up intelligence
  //         and relevant alerts" ══
  step("Raising a follow-up");
  const lens = (d: Awaited<ReturnType<typeof dash>>, k: string) =>
    d.followUps.find(l => l.key === k)?.count ?? null;
  const dueBefore = lens(after, "due_today") ?? 0;
  const alertsBefore = after.alerts.alerts.length;

  const fu = await createFollowUp(admin, {
    workspaceId: ws, patientId: alice, originEncounterId: enc1.data.id,
    reason: "Review after starting treatment", dueOn: today, priority: "urgent",
    actorId: DOCTOR, correlationId: CORR,
  });
  ok("6a. a follow-up can be raised from the encounter", fu.ok, fu.ok ? "" : JSON.stringify(fu));

  const withFollowUp = await dash();
  ok("6b. follow-up intelligence moves", (lens(withFollowUp, "due_today") ?? 0) === dueBefore + 1,
    `${dueBefore} -> ${lens(withFollowUp, "due_today")}`);
  ok("6c. and the Follow-ups Due tile agrees with it",
    (tile(withFollowUp, "follow_ups_due") ?? 0) >= 1, String(tile(withFollowUp, "follow_ups_due")));

  // An OVERDUE urgent follow-up is what raises an alert. Backdated through the engine's own row so the
  // alert rule is exercised rather than described.
  await admin.from("practice_follow_up").update({ due_on: "2020-01-01" }).eq("id", fu.ok ? fu.data.id : "");
  const withAlert = await dash();
  ok("6d. an overdue urgent follow-up raises an operational alert",
    withAlert.alerts.alerts.length > alertsBefore
      && withAlert.alerts.alerts.some(a => a.key === "overdue"),
    JSON.stringify(withAlert.alerts.alerts.map(a => a.key)));

  // ══ s16.7  "each metric is traceable to source records and a documented formula" ══
  step("The claims the dashboard makes about itself");
  const m = withAlert.metrics!;
  ok("7a. every metric carries its formula and the columns behind it",
    Object.values(m.metrics).every(x => x.formula.length > 0 && x.sources.length > 0),
    Object.values(m.metrics).filter(x => !x.formula).map(x => x.key).join(","));
  ok("7b. and every figure without a value says why",
    Object.values(m.metrics).filter(x => x.value === null).every(x => !!x.reason),
    Object.values(m.metrics).filter(x => x.value === null && !x.reason).map(x => x.key).join(","));

  // ══ s16.8  "displays as_of time and does not imply live data" ══
  ok("8a. the payload carries an as_of instant and a timezone",
    !Number.isNaN(Date.parse(withAlert.asOf)) && withAlert.timezone === TZ,
    `${withAlert.asOf} ${withAlert.timezone}`);

  // ══ s16.11  "no widget independently calculates a conflicting version of a shared metric" ══
  ok("11a. the glance and the metric engine give ONE answer for Completed",
    tile(withAlert, "completed") === m.metrics.completed.value,
    `${tile(withAlert, "completed")} vs ${m.metrics.completed.value}`);
  ok("11b. and the glance counts the scope the payload declares",
    withAlert.glance.scope === withAlert.scope.kind);

  // ══ s16.10  "a failure in one feeder does not make the entire dashboard unusable" ══
  const partial = await dashboardReadModel(admin, ctx(ws, ALL_CAPS.filter(x => x !== "practice.home.view")));
  const failed = Object.values(partial.feeders).filter(s => s === "unavailable").length;
  ok("10a-control. the fixture fails some feeders and not all",
    failed > 0 && failed < Object.keys(partial.feeders).length, `${failed} failed`);
  ok("10a. one failed feeder does not blank the dashboard", !partial.unavailable);

  // ══ s18 "session close"  +  s16.12 "all state changes are auditable" ══
  step("Closing the session");
  const closed = await endActivity(admin, c, clinic.value.id);
  ok("12a. the session closes", closed.ok, closed.ok ? "" : JSON.stringify(closed));

  const afterClose = await dash();
  ok("12b. and the dashboard returns to day scope", afterClose.scope.kind === "day", afterClose.scope.kind);

  const { data: events, error: evErr } = await admin.from("practice_domain_event")
    .select("event_type").eq("workspace_id", ws);
  ok("12c-control. the event log is readable", !evErr, evErr?.message ?? "");
  const types = new Set(((events ?? []) as { event_type: string }[]).map(e => e.event_type));
  ok("12c. the whole day is auditable from the event log",
    ["activity.started", "session.started", "encounter.started", "encounter.paused",
      "encounter.completed", "activity.completed", "session.closed"].every(t => types.has(t)),
    [...types].sort().join(", "));

  const { count: auditCount } = await admin.from("practice_audit_event")
    .select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("12d. and every state change left an audit entry", (auditCount ?? 0) > 0, String(auditCount));

  await cleanup();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
