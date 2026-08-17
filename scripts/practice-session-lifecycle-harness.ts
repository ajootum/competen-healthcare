/**
 * CPR-V5-004 SESSION LIFECYCLE: Start, Run, PAUSE, RESUME, Close, Generate Summary. Migration 235.
 *
 * WHAT THIS HAS TO PROVE, taken from the spec rather than from what the code happens to do:
 *   "Session Lifecycle: Start / Run / Pause / Resume / Close / Generate Summary"
 *   "Handle interruptions naturally" (Design Principles)
 *   CPR-CORE-001 s6.2, one rung up: interruption time must not be counted as active time
 *   s16: no widget independently calculates a conflicting version of a shared metric
 *
 * ⚠ THE ONE WORTH THE TROUBLE IS SECTION 5, and it is asserted through `sessionMetrics` rather than by
 * reading a pause row back. A workflow assertion ("the pause was recorded") passes perfectly well while
 * the progress bar the practitioner is actually looking at keeps burning through lunch -- which was the
 * state of this codebase before migration 235. The numbers there are hand-checkable on purpose.
 *
 * ⚠ SECTION 6 IS THE OTHER ONE. A pause ledger that cannot be read must report NULL paused minutes, not
 * nought: nought is a claim that the clinic ran without interruption, it is subtracted from the clock,
 * and it is indistinguishable from the truth for everything downstream.
 *
 *   npx --yes tsx scripts/practice-session-lifecycle-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  planActivity, startActivity, endActivity, pauseActivity, resumeActivity, sessionSummary,
  pauseLedger, todaysPlan, runningActivityId, ACTIVITY_CAPABILITIES,
} from "../src/lib/practice/activity";
import { sessionMetrics } from "../src/lib/practice/session";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

// Hex only -- a readable id like "sl001" is not a uuid and PostgREST rejects the whole fixture over it.
const USER_A = "00000000-0000-4000-8000-0000000051a1";
const USER_B = "00000000-0000-4000-8000-0000000051b2";
const TZ = "Africa/Kampala";
const CORR = "harness-session-lifecycle";

const ALL_CAPS = ["practice.home.view", "appointment.manage", "practice.calendar.view", "encounter.list",
  "followup.view"];

const ctxFor = (workspaceId: string, userId: string, capabilities: string[] = ALL_CAPS): WorkspaceContext => ({
  userId, workspaceId, workspaceName: "H", workspaceType: "individual_practice", workspaceStatus: "active",
  roleCodes: ["owner"], capabilities, entitled: true, entitlementStatus: "trial",
  onboardingComplete: true, onboardingStep: null,
});

/** Idempotent teardown, run before AND after: a harness that cannot be run twice is run once. */
async function cleanup(...users: string[]) {
  for (const u of users) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      // Deleted explicitly though the workspace cascades: if the workspace delete below ever fails,
      // pauses belonging to a practice that no longer exists are exactly what must not be left behind.
      await admin.from("practice_activity_pause").delete().eq("workspace_id", w.id);
      await admin.from("practice_domain_event").delete().eq("workspace_id", w.id);
      await admin.from("practice_activity").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, users);
}

/** A practice provisioned through the real saga. NEVER an inserted workspace: half a practice is not one. */
async function provision(user: string, name: string, suffix: string) {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-sl-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const payload: IndividualRequest = {
    displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
    defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1",
    source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function main() {
  console.log("\n=== SESSION LIFECYCLE: PAUSE / RESUME / SUMMARY (CPR-V5-004, migration 235) ===\n");

  // ⚠ THE MIGRATION GATE. Without it every "the pause was refused" assertion below would pass against an
  // unapplied migration -- the engine returns READ_FAILED and a test that only checked `!result.ok`
  // would certify a feature that does not exist. The subset that needs no DDL still runs.
  const probe = await admin.from("practice_activity_pause").select("id").limit(1);
  const ddl = !probe.error;
  ok("0. control -- migration 235 is applied", ddl,
    probe.error ? `${probe.error.message} -- apply supabase/migrations/235-practice-session-pause.sql` : "");

  await cleanup(USER_A, USER_B);
  const wsA = await provision(USER_A, "Harness Session Lifecycle A", "a");
  const wsB = await provision(USER_B, "Harness Session Lifecycle B", "b");
  const ctxA = ctxFor(wsA, USER_A);
  const ctxB = ctxFor(wsB, USER_B);

  const today = (await todaysPlan(admin, ctxA)).date;
  // Kampala is UTC+3, and every hour used below is at or after 03:00 local so the subtraction stays on
  // the same calendar day. Hand-checkable on purpose: these instants appear in the arithmetic in s5.
  const at = (h: number, m = 0) =>
    new Date(`${today}T${String(h - 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);

  const plan = (ctx: WorkspaceContext, title: string, s: number, e: number) =>
    planActivity(admin, ctx, {
      activityType: "outpatient_clinic", title, planDate: today,
      plannedStartMinute: s, plannedEndMinute: e,
    }, { source: "system" });

  // ── 1. CAPABILITY CODES ARE REAL ─────────────────────────────────────────────────────────────────
  //
  // A capability code is a STRING compared against practice_role_capabilities. An invented one costs
  // nothing at compile time and returns 403 for every user including the owner, which this codebase has
  // shipped three times. Checked against the ENGINE's exported constants, never a list re-typed here:
  // a re-typed list can invent the same fiction the engine did and agree with it forever.
  const { data: caps, error: capErr } = await admin.from("practice_role_capabilities")
    .select("capability_code").in("capability_code", ACTIVITY_CAPABILITIES);
  const known = new Set(((caps ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  ok("1a. every capability the lifecycle gates on EXISTS in practice_role_capabilities",
    !capErr && ACTIVITY_CAPABILITIES.every(c => known.has(c)),
    capErr?.message ?? `missing: ${ACTIVITY_CAPABILITIES.filter(c => !known.has(c)).join(", ") || "none"}`);
  ok("1a-control. and the check can fail -- an invented code is NOT in the table",
    !known.has("practice.session.pause"));

  // ── 2. THE REFUSALS THAT NEED NO LEDGER ──────────────────────────────────────────────────────────
  //
  // These run whether or not migration 235 is applied: every one of them is decided from the ACTIVITY's
  // own two timestamps, before the pause table is ever read.
  const planned = await plan(ctxA, "Never Started Clinic", 14 * 60, 16 * 60);
  ok("2-setup. an activity can be planned", planned.ok, planned.ok ? "" : planned.message);
  if (!planned.ok) { report(); return; }

  const pauseUnstarted = await pauseActivity(admin, ctxA, planned.value.id, { source: "system" });
  ok("2a. REFUSES pausing an activity that has not started",
    !pauseUnstarted.ok && pauseUnstarted.code === "NOT_STARTED", JSON.stringify(pauseUnstarted));
  const resumeUnstarted = await resumeActivity(admin, ctxA, planned.value.id, { source: "system" });
  ok("2b. REFUSES resuming an activity that has not started",
    !resumeUnstarted.ok && resumeUnstarted.code === "NOT_STARTED", JSON.stringify(resumeUnstarted));

  const noCap = ctxFor(wsA, USER_A, ["practice.home.view"]);
  const pauseNoCap = await pauseActivity(admin, noCap, planned.value.id, { source: "system" });
  ok("2c. REFUSES a caller without the write capability, and says which one",
    !pauseNoCap.ok && pauseNoCap.code === "FORBIDDEN" && pauseNoCap.message.includes("appointment.manage"),
    JSON.stringify(pauseNoCap));

  const pauseMissing = await pauseActivity(admin, ctxA, "00000000-0000-4000-8000-00000000dead",
    { source: "system" });
  ok("2d. REFUSES an activity that does not exist",
    !pauseMissing.ok && pauseMissing.code === "NOT_FOUND", JSON.stringify(pauseMissing));

  // Tenancy, from the same guard: practice B's context cannot reach practice A's activity.
  const crossPause = await pauseActivity(admin, ctxB, planned.value.id, { source: "system" });
  ok("2e. REFUSES reaching into another practice's session",
    !crossPause.ok && crossPause.code === "NOT_FOUND", JSON.stringify(crossPause));

  const summaryUnstarted = await sessionSummary(admin, ctxA, planned.value.id);
  ok("2f. a session that never started has no summary, and says so rather than inventing one",
    !summaryUnstarted.ok && summaryUnstarted.code === "NOT_STARTED", JSON.stringify(summaryUnstarted));

  // ── 2A. ⚠ THE ARITHMETIC, PROVED WITHOUT THE DDL ─────────────────────────────────────────────────
  //
  // Section 5 asserts the same thing end to end against real pause rows, and cannot run until migration
  // 235 is applied. THIS one can run today, because the deduction is a pure function of the rows the
  // ledger returns -- so the ledger is stubbed at the boundary the engine actually uses and the numbers
  // are asserted against a session that really is running in the database.
  //
  // Stubbing the READ and not the writes is what keeps this honest: everything else on the path --
  // todaysPlan, the activity row, the window, the appointment count -- is the real thing.
  //
  //   clinic planned 09:00-13:00 (240 min), started 09:00, one pause 10:00-10:40, read at 11:00
  //     wall clock elapsed   120 min
  //     minutesElapsed        80   120 - 40   (120 with no pause -- the control below)
  //     progressPercent       33   80 / 240   (50 with no pause)
  //     minutesRemaining     160   13:40 - 11:00 (120 with no pause)
  const stubClinic = await plan(ctxA, "Stub Ledger Clinic", 9 * 60, 13 * 60);
  ok("2A-setup. a clinic is planned and started at 09:00", stubClinic.ok, JSON.stringify(stubClinic));
  if (stubClinic.ok) {
    const stubStart = await startActivity(admin, ctxA, stubClinic.value.id, { at: at(9), source: "system" });
    ok("2A-setup-b. and it is running", stubStart.ok, stubStart.ok ? "" : JSON.stringify(stubStart));

    /** An admin whose pause ledger returns exactly the intervals given, and is otherwise the real one. */
    const withPauses = (rows: { paused_at: string; resumed_at: string | null }[]) => ({
      from: (table: string) => table === "practice_activity_pause"
        ? {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({
                  data: rows.map((r, i) => ({ id: `stub-${i}`, reason: null, ...r })), error: null,
                }),
              }),
            }),
          }),
        }
        : admin.from(table),
    });

    const stubPlan = await todaysPlan(admin, ctxA, { date: today, at: at(11) });
    ok("2A-setup-c. the stub clinic is the current activity",
      stubPlan.current?.id === stubClinic.value.id, JSON.stringify(stubPlan.current));

    const none = await sessionMetrics(withPauses([]), ctxA, stubPlan, at(11));
    ok("2A-control. with NO pause the session reads the raw clock: 120 elapsed, 50%, 120 remaining",
      none?.minutesElapsed === 120 && none?.progressPercent === 50 && none?.minutesRemaining === 120,
      `${none?.minutesElapsed}/${none?.progressPercent}/${none?.minutesRemaining}`);
    ok("2A-control-b. and reports nought paused minutes, which is a reading and not a failure",
      none?.pausedMinutes === 0 && none?.isPaused === false, JSON.stringify(none?.pausedMinutes));

    const withOne = await sessionMetrics(
      withPauses([{ paused_at: at(10).toISOString(), resumed_at: at(10, 40).toISOString() }]),
      ctxA, stubPlan, at(11));
    ok("2Aa. a 40-minute pause is subtracted from ELAPSED: 80, not 120",
      withOne?.minutesElapsed === 80, `${withOne?.minutesElapsed} min`);
    ok("2Ab. and from PROGRESS: 33%, not 50%", withOne?.progressPercent === 33,
      `${withOne?.progressPercent}%`);
    ok("2Ac. and it PUSHES OUT the finish: 160 remaining, not 120",
      withOne?.minutesRemaining === 160, `${withOne?.minutesRemaining} min`);
    ok("2Ad. the paused total is reported alongside, so a screen can say why the bar is short",
      withOne?.pausedMinutes === 40, `${withOne?.pausedMinutes}`);

    // TWO pauses, which is what a single paused_at/resumed_at pair on the activity could not express:
    // it would hold the second and forget the first, and half a correction looks like no bug at all.
    const withTwo = await sessionMetrics(
      withPauses([
        { paused_at: at(9, 30).toISOString(), resumed_at: at(9, 45).toISOString() },
        { paused_at: at(10).toISOString(), resumed_at: at(10, 40).toISOString() },
      ]), ctxA, stubPlan, at(11));
    ok("2Ae. EVERY pause is subtracted, not just the most recent one: 15 + 40 = 55",
      withTwo?.pausedMinutes === 55 && withTwo?.minutesElapsed === 65,
      `${withTwo?.pausedMinutes} paused, ${withTwo?.minutesElapsed} elapsed`);

    // An OPEN pause accrues to now, and that is what makes the clock stand still while stopped.
    const openA = await sessionMetrics(
      withPauses([{ paused_at: at(10).toISOString(), resumed_at: null }]), ctxA,
      await todaysPlan(admin, ctxA, { date: today, at: at(11) }), at(11));
    const openB = await sessionMetrics(
      withPauses([{ paused_at: at(10).toISOString(), resumed_at: null }]), ctxA,
      await todaysPlan(admin, ctxA, { date: today, at: at(12) }), at(12));
    ok("2Af. while a pause is OPEN the session clock stands still -- an hour later, same figures",
      openA?.minutesElapsed === openB?.minutesElapsed && openA?.minutesElapsed === 60
      && openA?.progressPercent === openB?.progressPercent
      && openA?.minutesRemaining === openB?.minutesRemaining,
      `${openA?.minutesElapsed}/${openA?.progressPercent}/${openA?.minutesRemaining} vs ` +
      `${openB?.minutesElapsed}/${openB?.progressPercent}/${openB?.minutesRemaining}`);
    ok("2Ag. and it says it is paused, and since when",
      openB?.isPaused === true && openB?.pausedSince === at(10).toISOString(),
      JSON.stringify([openB?.isPaused, openB?.pausedSince]));

    // ⚠ AN UNREADABLE LEDGER IS NULL, NEVER NOUGHT -- and the figures fall back to the raw clock, which
    // is the case a screen must be able to detect. Nought would be a claim the clinic ran uninterrupted.
    const brokenNow = {
      from: (table: string) => table === "practice_activity_pause"
        ? { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) }) }
        : admin.from(table),
    };
    const unreadable = await sessionMetrics(brokenNow, ctxA, stubPlan, at(11));
    ok("2Ah. an UNREADABLE ledger reports null paused minutes, never nought",
      unreadable?.pausedMinutes === null, `${unreadable?.pausedMinutes}`);
    ok("2Ah-control. and 2Ah is not passing on nothing -- a working ledger over the same session says 40",
      withOne?.pausedMinutes === 40, `${withOne?.pausedMinutes}`);

    // Left closed so section 3 starts from a clean day rather than from a switch.
    await endActivity(admin, ctxA, stubClinic.value.id, { at: at(13), source: "system" });
  }

  if (!ddl) {
    console.log("\n  -- migration 235 is NOT applied: sections 3-9 need the DDL and were SKIPPED --");
    await cleanup(USER_A, USER_B);
    report();
    return;
  }

  // ── 3. PAUSE AND RESUME, THE HAPPY PATH ──────────────────────────────────────────────────────────
  const clinic = await plan(ctxA, "Pause Morning Clinic", 9 * 60, 13 * 60);
  ok("3-setup. the morning clinic is planned", clinic.ok, clinic.ok ? "" : clinic.message);
  if (!clinic.ok) { report(); return; }
  const id = clinic.value.id;

  const started = await startActivity(admin, ctxA, id, { at: at(9), source: "system" });
  ok("3-setup-b. and started", started.ok, started.ok ? "" : started.message);

  const beforePause = await pauseLedger(admin, wsA, id, { at: at(10) });
  ok("3a-control. a session nobody paused reports NOUGHT paused minutes, and is readable",
    !beforePause.unavailable && beforePause.pausedMinutes === 0 && !beforePause.isPaused,
    JSON.stringify(beforePause));

  const paused = await pauseActivity(admin, ctxA, id, { at: at(10), reason: "Theatre call", source: "system" });
  ok("3b. a running session can be paused", paused.ok, paused.ok ? "" : JSON.stringify(paused));
  ok("3b-control. and it reported no outbox trouble",
    paused.ok && paused.value.eventWarnings.length === 0,
    paused.ok ? paused.value.eventWarnings.join("; ") : "");

  const openLedger = await pauseLedger(admin, wsA, id, { at: at(10, 25) });
  // ⚠ INSTANTS, NOT STRINGS. PostgREST returns `2026-08-05T08:00:00+00:00` and Date#toISOString returns
  // `2026-08-05T08:00:00.000Z` -- the same moment, written two ways, and `===` says they differ. Four
  // assertions in this file failed against working code for that reason alone. A timestamp comparison
  // that goes through a string is comparing a FORMAT, and the format belongs to whoever serialised it.
  const sameInstant = (a: string | null | undefined, b: Date) =>
    !!a && Date.parse(a) === b.getTime();

  ok("3c. the session reads as paused, since the instant it stopped",
    openLedger.isPaused && sameInstant(openLedger.pausedSince, at(10)),
    JSON.stringify(openLedger));
  ok("3d. and an OPEN pause accrues minutes against the clock -- 25 by 10:25",
    openLedger.pausedMinutes === 25, `${openLedger.pausedMinutes} min`);
  ok("3e. the reason is kept, so the summary can say what stopped the clinic",
    openLedger.intervals[0]?.reason === "Theatre call", JSON.stringify(openLedger.intervals));

  // ⚠ A PAUSED SESSION IS STILL THE CURRENT ACTIVITY. Clearing the context would leave the next thing
  // the practitioner records with no session to belong to -- stepping out of a clinic is not leaving it.
  const stillCurrent = await runningActivityId(admin, wsA, USER_A);
  ok("3f. a paused session is STILL the current activity, so encounters keep their context",
    stillCurrent.error === null && stillCurrent.id === id, JSON.stringify(stillCurrent));

  const doublePause = await pauseActivity(admin, ctxA, id, { at: at(10, 30), source: "system" });
  ok("3g. REFUSES pausing a session that is already paused",
    !doublePause.ok && doublePause.code === "ALREADY_PAUSED", JSON.stringify(doublePause));
  // ⚠ WHICH GUARD FIRED IS PART OF THE CLAIM. Deleting the engine's pre-check changes nothing
  // observable, because the partial index catches the same case and the engine maps 23505 to the same
  // code. The two paths word themselves differently and 3h is what makes that difference load-bearing.
  const rawSecond = await admin.from("practice_activity_pause").insert({
    workspace_id: wsA, activity_id: id, paused_at: at(10, 30).toISOString(), paused_by: USER_A,
  });
  ok("3h. the DATABASE refuses a second OPEN pause, not just the engine",
    !!rawSecond.error && rawSecond.error.code === "23505",
    rawSecond.error ? `expected 23505, got ${rawSecond.error.code}` : "the write SUCCEEDED");

  const resumed = await resumeActivity(admin, ctxA, id, { at: at(10, 40), source: "system" });
  ok("3i. a paused session can be resumed", resumed.ok, resumed.ok ? "" : JSON.stringify(resumed));

  const closedLedger = await pauseLedger(admin, wsA, id, { at: at(11) });
  ok("3j. and the interval STOPS accruing -- 40 minutes, not 60, twenty minutes later",
    closedLedger.pausedMinutes === 40 && !closedLedger.isPaused, JSON.stringify(closedLedger));

  const doubleResume = await resumeActivity(admin, ctxA, id, { at: at(10, 45), source: "system" });
  ok("3k. REFUSES resuming a session that is not paused",
    !doubleResume.ok && doubleResume.code === "NOT_PAUSED", JSON.stringify(doubleResume));

  // ── 4. THE EVENTS AND THE AUDIT TRAIL ────────────────────────────────────────────────────────────
  type EventRow = { event_type: string; occurred_at: string; actor_id: string; practitioner_id: string;
    session_id: string | null; activity_instance_id: string | null; source: string;
    payload: Record<string, unknown> };
  const { data: evData, error: evErr } = await admin.from("practice_domain_event")
    .select("event_type, occurred_at, actor_id, practitioner_id, session_id, activity_instance_id, source, payload")
    .eq("activity_instance_id", id).like("event_type", "session.%");
  const events = (evData ?? []) as EventRow[];
  ok("4-control. the event log is readable", !evErr, evErr?.message ?? "");
  const pauseEv = events.find(e => e.event_type === "session.paused");
  const resumeEv = events.find(e => e.event_type === "session.resumed");
  ok("4a. pausing and resuming each announce themselves in s9's vocabulary",
    !!pauseEv && !!resumeEv, events.map(e => e.event_type).join(", ") || "nothing");
  ok("4b. the pause event is stamped with WHEN the session stopped, not when the row was written",
    !!pauseEv && Date.parse(pauseEv.occurred_at) === at(10).getTime(),
    `${pauseEv?.occurred_at} vs ${at(10).toISOString()}`);
  ok("4c. it carries the actor, the practitioner and the session",
    !!pauseEv && pauseEv.actor_id === USER_A && pauseEv.practitioner_id === USER_A
    && pauseEv.session_id === id, JSON.stringify(pauseEv));
  ok("4d. it records the channel the caller declared rather than a hardcoded one",
    !!pauseEv && pauseEv.source === "system", pauseEv?.source ?? "-");
  ok("4e. the pause event says WHY", pauseEv?.payload?.reason === "Theatre call",
    JSON.stringify(pauseEv?.payload));
  ok("4f. and the resume event says how long the session was stopped",
    resumeEv?.payload?.pausedMinutes === 40, JSON.stringify(resumeEv?.payload));

  const { data: auditRows, error: auditErr } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("actor_id", USER_A).like("event_type", "practice.activity_%");
  const auditTypes = new Set(((auditRows ?? []) as { event_type: string }[]).map(r => r.event_type));
  ok("4g. every lifecycle rung leaves an AUDIT entry, which is not the event log",
    !auditErr && auditTypes.has("practice.activity_paused") && auditTypes.has("practice.activity_resumed"),
    auditErr?.message ?? [...auditTypes].join(", "));

  // ── 5. ⚠ PAUSED TIME COMES OUT OF THE SESSION'S ARITHMETIC ───────────────────────────────────────
  //
  // THE ASSERTION THE WHOLE MIGRATION EXISTS FOR, and it is made through sessionMetrics -- the figures
  // a practitioner actually reads -- rather than by inspecting the pause row. Hand-checkable:
  //
  //   clinic planned 09:00-13:00 (240 min), started 09:00, paused 10:00-10:40 (40 min), read at 11:00
  //     wall clock elapsed   120 min
  //     minutesElapsed        80   120 - 40   (was 120 before this feature)
  //     progressPercent       33   80 / 240   (was 50)
  //     minutesRemaining     160   13:40 - 11:00, the planned end pushed out by the pause (was 120)
  const readAt = at(11);
  const planNow = await todaysPlan(admin, ctxA, { date: today, at: readAt });
  ok("5-setup. the clinic is the current activity in today's plan", planNow.current?.id === id,
    JSON.stringify(planNow.current));
  const m = await sessionMetrics(admin, ctxA, planNow, readAt);
  ok("5a. the session's paused minutes are reported", m?.pausedMinutes === 40, `${m?.pausedMinutes}`);
  ok("5b. ELAPSED is time the session actually ran -- 80, not the 120 on the wall clock",
    m?.minutesElapsed === 80, `${m?.minutesElapsed} min`);
  ok("5c. PROGRESS is net of the pause -- 33%, not 50%",
    m?.progressPercent === 33, `${m?.progressPercent}%`);
  ok("5d. REMAINING is measured against the pause-adjusted end -- 160, not 120",
    m?.minutesRemaining === 160, `${m?.minutesRemaining} min`);
  ok("5e-control. the planned window is NOT moved, so the metric scope is unchanged",
    m?.windowEndIso === at(13).toISOString(), `${m?.windowEndIso} vs ${at(13).toISOString()}`);

  // ⚠ WHILE A SESSION IS PAUSED NEITHER FIGURE MOVES, because the paused total grows at the wall
  // clock's own rate. This is the property that makes the correction visible without arithmetic.
  const pausedAgain = await pauseActivity(admin, ctxA, id, { at: at(11), source: "system" });
  ok("5f-setup. the clinic is paused again at 11:00", pausedAgain.ok, JSON.stringify(pausedAgain));
  const frozenA = await sessionMetrics(admin, ctxA, await todaysPlan(admin, ctxA, { date: today, at: at(11, 10) }), at(11, 10));
  const frozenB = await sessionMetrics(admin, ctxA, await todaysPlan(admin, ctxA, { date: today, at: at(11, 50) }), at(11, 50));
  ok("5f. the session clock STANDS STILL while it is paused",
    frozenA?.minutesElapsed === frozenB?.minutesElapsed
    && frozenA?.progressPercent === frozenB?.progressPercent
    && frozenA?.minutesRemaining === frozenB?.minutesRemaining,
    `${frozenA?.minutesElapsed}/${frozenA?.progressPercent}/${frozenA?.minutesRemaining} vs ` +
    `${frozenB?.minutesElapsed}/${frozenB?.progressPercent}/${frozenB?.minutesRemaining}`);
  ok("5g. and it reports itself paused, and since when",
    frozenB?.isPaused === true && sameInstant(frozenB?.pausedSince, at(11)),
    JSON.stringify([frozenB?.isPaused, frozenB?.pausedSince]));
  await resumeActivity(admin, ctxA, id, { at: at(11, 50), source: "system" });

  // ── 6. ⚠ AN UNREADABLE LEDGER IS NULL, NEVER NOUGHT ──────────────────────────────────────────────
  //
  // Injected at the boundary the engine actually uses: an admin client that behaves normally except that
  // the pause table is broken -- which is exactly what every caller sees before migration 235 is
  // applied. Nought would be a claim that the clinic ran without interruption, and it is SUBTRACTED
  // from the clock, so the failure would be invisible and would silently restore the old wrong numbers.
  const brokenLedger = {
    from: (table: string) => table === "practice_activity_pause"
      ? {
        select: () => ({
          eq: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }),
        }),
      }
      : admin.from(table),
  };
  const blind = await sessionMetrics(brokenLedger, ctxA, planNow, readAt);
  ok("6a. an unreadable pause ledger reports NULL paused minutes, not nought",
    blind?.pausedMinutes === null, `${blind?.pausedMinutes}`);
  ok("6a-control. and the SAME session with a working ledger reports 40, so 6a is not passing on nothing",
    m?.pausedMinutes === 40, `${m?.pausedMinutes}`);
  ok("6b. a write that cannot read the ledger REFUSES rather than pausing blind",
    await (async () => {
      const r = await pauseActivity(brokenLedger, ctxA, id, { at: at(12), source: "system" });
      return !r.ok && r.code === "READ_FAILED" && r.message.includes("relation does not exist");
    })(), "");
  ok("6c. and so does a resume", await (async () => {
    const r = await resumeActivity(brokenLedger, ctxA, id, { at: at(12), source: "system" });
    return !r.ok && r.code === "READ_FAILED";
  })(), "");

  // ── 7. GENERATE SUMMARY ──────────────────────────────────────────────────────────────────────────
  //
  // The clinic ran 09:00-13:00 planned, started 09:00, was stopped 10:00-10:40 and 11:00-11:50, and is
  // closed at 12:30:
  //   elapsed  210 min (09:00 to 12:30)
  //   paused    90 min (40 + 50)
  //   active   120 min
  const closed = await endActivity(admin, ctxA, id, { at: at(12, 30), source: "system" });
  ok("7-setup. the session closes", closed.ok, closed.ok ? "" : JSON.stringify(closed));

  const summary = await sessionSummary(admin, ctxA, id, { at: at(13, 30) });
  ok("7a. a finished session has a summary", summary.ok, summary.ok ? "" : JSON.stringify(summary));
  if (summary.ok) {
    const s = summary.value;
    ok("7b. it reports the wall clock the session covered", s.elapsedMinutes === 210, `${s.elapsedMinutes}`);
    ok("7c. and the minutes it was stopped", s.pausedMinutes === 90, `${s.pausedMinutes}`);
    ok("7d. and the time it was actually running", s.activeMinutes === 120, `${s.activeMinutes}`);
    ok("7e. it lists every pause, not just the last one -- two columns would have forgotten the first",
      s.pauseCount === 2 && s.pauses.length === 2, JSON.stringify(s.pauses.map(p => p.minutes)));
    ok("7f. with the reason the practitioner gave",
      s.pauses[0]?.reason === "Theatre call", JSON.stringify(s.pauses[0]));
    ok("7g. the session is reported as done", s.state === "done" && sameInstant(s.endedAtIso, at(12, 30)),
      JSON.stringify([s.state, s.endedAtIso]));
    // OVERRUN AGAINST THE PAUSE-ADJUSTED END. Planned end 13:00 plus 90 paused minutes is 14:30, and the
    // clinic finished at 12:30 -- so it did not overrun. Measured against the raw 13:00 it also would
    // not have, which is why 7i exists.
    ok("7h. a clinic that finished before its adjusted end did not overrun", s.overrunMinutes === null,
      `${s.overrunMinutes}`);
    // s16: the summary does not count patients itself. The figures arrive from metrics.ts carrying their
    // own status, so an unreadable one is "unreadable" rather than a confident nought on a document.
    ok("7i. the patient figures come from the metric engine, with their status intact",
      !!s.metrics && s.metrics.metrics.patients_seen.key === "patients_seen"
      && typeof s.metrics.metrics.patients_seen.status === "string",
      JSON.stringify(s.metrics?.metrics?.patients_seen));
    ok("7j. and they are scoped to the SESSION rather than the whole day",
      s.metrics.metrics.patients_seen.scopeKind === "session",
      s.metrics?.metrics?.patients_seen?.scopeKind);
  }

  const pauseClosed = await pauseActivity(admin, ctxA, id, { at: at(13), source: "system" });
  ok("7k. REFUSES pausing a session that is over",
    !pauseClosed.ok && pauseClosed.code === "ALREADY_ENDED", JSON.stringify(pauseClosed));
  const resumeClosed = await resumeActivity(admin, ctxA, id, { at: at(13), source: "system" });
  ok("7l. REFUSES resuming a session that is over",
    !resumeClosed.ok && resumeClosed.code === "ALREADY_ENDED", JSON.stringify(resumeClosed));

  // ── 8. CLOSING A PAUSED SESSION CLOSES THE PAUSE ─────────────────────────────────────────────────
  //
  // Otherwise the interval stays open on a clock that stopped and keeps accruing minutes for ever, and
  // the summary of a clinic abandoned during an interruption gets worse the longer you leave it.
  const round = await plan(ctxA, "Abandoned Ward Round", 14 * 60, 16 * 60);
  if (round.ok) {
    await startActivity(admin, ctxA, round.value.id, { at: at(14), source: "system" });
    await pauseActivity(admin, ctxA, round.value.id, { at: at(14, 20), reason: "Emergency", source: "system" });
    const endedPaused = await endActivity(admin, ctxA, round.value.id, { at: at(14, 50), source: "system" });
    ok("8a. a PAUSED session can still be closed -- that is not a refusal", endedPaused.ok,
      endedPaused.ok ? "" : JSON.stringify(endedPaused));
    const ledgerAfter = await pauseLedger(admin, wsA, round.value.id, { at: at(18) });
    ok("8b. and closing it closed the open pause, at the instant the session ended",
      !ledgerAfter.isPaused && sameInstant(ledgerAfter.intervals[0]?.resumedAtIso, at(14, 50)),
      JSON.stringify(ledgerAfter));
    ok("8c. so the paused total stops growing -- 30 minutes, hours later",
      ledgerAfter.pausedMinutes === 30, `${ledgerAfter.pausedMinutes}`);
  }

  // ── 9. SWITCHING AWAY FROM A PAUSED SESSION ──────────────────────────────────────────────────────
  const teach = await plan(ctxA, "Switch From Paused", 16 * 60, 17 * 60);
  const next = await plan(ctxA, "Switched To", 17 * 60, 18 * 60);
  if (teach.ok && next.ok) {
    await startActivity(admin, ctxA, teach.value.id, { at: at(16), source: "system" });
    await pauseActivity(admin, ctxA, teach.value.id, { at: at(16, 10), source: "system" });
    const switched = await startActivity(admin, ctxA, next.value.id, { at: at(16, 30), source: "system" });
    ok("9a. starting the next activity closes the paused one", switched.ok
      && switched.value.endedPrevious === teach.value.id, JSON.stringify(switched));
    const afterSwitch = await pauseLedger(admin, wsA, teach.value.id, { at: at(20) });
    ok("9b. and the switch closed its open pause too",
      !afterSwitch.isPaused && afterSwitch.pausedMinutes === 20, JSON.stringify(afterSwitch));
    await endActivity(admin, ctxA, next.value.id, { at: at(17), source: "system" });
  }

  // Tenancy on the ledger itself: practice B sees none of practice A's pauses.
  const bLedger = await pauseLedger(admin, wsB, id, { at: at(13) });
  ok("9c. another practice reads NO pauses for A's session, and reads them successfully",
    !bLedger.unavailable && bLedger.pausedMinutes === 0 && bLedger.intervals.length === 0,
    JSON.stringify(bLedger));

  await cleanup(USER_A, USER_B);
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
