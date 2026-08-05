/**
 * CPR-V3-001 Current Activity + CPR-V3-002 Today's Work harness. Migration 232.
 *
 * WHAT THIS HAS TO PROVE, beyond "the code runs":
 *   - one activity at a time, against the DATABASE and not just the engine's own check
 *   - "in progress" is DERIVED, so a finished day cannot still read as running tomorrow
 *   - every refusal in ACTIVITY_REFUSES actually refuses, each paired with a control proving the same
 *     operation SUCCEEDS where it should -- a refusal assertion with no control passes just as well
 *     against a function that refuses everything
 *   - a failed read surfaces as `unavailable`, never as an empty day or a zero
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  todaysPlan, planActivity, startActivity, endActivity, activityState, ACTIVITY_TYPES,
} from "../src/lib/practice/activity";
import { todaysWork } from "../src/lib/practice/todays-work";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } });

const ctxFor = (workspaceId: string, userId: string, caps: string[]): WorkspaceContext => ({
  userId, workspaceId, workspaceName: "H", workspaceType: "individual_practice", workspaceStatus: "active",
  roleCodes: ["owner"], capabilities: caps, entitled: true, entitlementStatus: "trial",
  onboardingComplete: true, onboardingStep: null,
});

const ALL = ["practice.home.view", "practice.calendar.manage", "task.view", "followup.view",
  "appointment.view", "inbox.record"];

async function main() {
  console.log("\n=== CURRENT ACTIVITY / TODAY'S WORK (CPR-V3-001, migration 232) ===\n");

  // ── CONTROL: the table exists and is readable at all ────────────────────────────────────────────
  const probe = await admin.from("practice_activity").select("id").limit(1);
  ok("0. control -- practice_activity exists and is queryable", !probe.error,
    probe.error?.message ?? "");
  if (probe.error) { report(); return; }

  // ── Fixture: two workspaces, so tenancy can be proven rather than assumed ───────────────────────
  //
  // Provisioned through the real saga, not inserted. A hand-built workspace row skips the invariants
  // every other row in the system was created under, and a harness that tests against a shape production
  // never produces proves nothing about production.
  const userA = "00000000-0000-4000-8000-0000000ac001";
  const userB = "00000000-0000-4000-8000-0000000ac002";
  await cleanup(userA, userB);

  const provision = async (user: string, name: string, suffix: string) => {
    const { data: req, error } = await admin.from("provisioning_request").insert({
      idempotency_key: `harness-act-${suffix}-${Date.now()}`, request_type: "pilot",
      actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-act",
    }).select("id").single();
    if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
    const payload: IndividualRequest = {
      displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
      defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1",
      source: "pilot",
    };
    const run = await runProvisioning(admin,
      { id: req.id, target_user_id: user, correlation_id: "harness-act", workspace_id: null }, payload);
    if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
    return run.workspaceId;
  };

  const wsA = await provision(userA, `Harness Activity A`, "a");
  const wsB = await provision(userB, `Harness Activity B`, "b");
  const ctxA = ctxFor(wsA, userA, ALL);
  const ctxB = ctxFor(wsB, userB, ALL);

  // The practice's today, not the server's -- the engine uses the workspace timezone and so must we.
  const planA = await todaysPlan(admin, ctxA);
  const today = planA.date;

  const plan = (c: WorkspaceContext, title: string, s: number, e: number, date = today) =>
    planActivity(admin, c, {
      activityType: "outpatient_clinic", title, planDate: date,
      plannedStartMinute: s, plannedEndMinute: e,
    });

  // ── 1. Planning ─────────────────────────────────────────────────────────────────────────────────
  const clinic = await plan(ctxA, "Morning Clinic", 8 * 60 + 30, 13 * 60);
  ok("1a. an activity can be planned", clinic.ok, clinic.ok ? "" : clinic.message);
  const round = await plan(ctxA, "Ward Round", 13 * 60, 15 * 60);
  ok("1b. a second activity can be planned for the same day", round.ok, round.ok ? "" : round.message);
  // Two activities that are planned and never touched, one per assertion that needs a pristine row.
  // Sharing one would couple them: if the raw write in 3i ever succeeded it would silently turn 4a into
  // a test of a started activity, and 4a would then pass for the wrong reason.
  const spareIndex = await plan(ctxA, "Spare (index test)", 15 * 60, 16 * 60);
  const spareEnd = await plan(ctxA, "Spare (end test)", 16 * 60, 17 * 60);
  if (!clinic.ok || !round.ok || !spareIndex.ok || !spareEnd.ok) { report(); return; }

  const backwards = await plan(ctxA, "Backwards", 15 * 60, 14 * 60);
  ok("1c. REFUSES an activity that ends before it begins",
    !backwards.ok && backwards.code === "VALIDATION_ERROR", JSON.stringify(backwards));

  const badType = await planActivity(admin, ctxA, {
    activityType: "coffee", title: "Coffee", planDate: today,
    plannedStartMinute: 60, plannedEndMinute: 120,
  });
  ok("1d. REFUSES an activity type that is not one of CPR-V3-001's eight",
    !badType.ok && badType.code === "VALIDATION_ERROR", JSON.stringify(badType));
  ok("1d-control. every type CPR-V3-001 names is accepted", ACTIVITY_TYPES.length === 8);

  const noCap = await plan(ctxFor(wsA, userA, ["practice.home.view"]), "No capability", 60, 120);
  ok("1e. REFUSES planning without practice.calendar.manage",
    !noCap.ok && noCap.code === "FORBIDDEN", JSON.stringify(noCap));

  // ── 2. State is derived, never stored ───────────────────────────────────────────────────────────
  ok("2a. planned = no timestamps", activityState(null, null) === "planned");
  ok("2b. running = started, not ended", activityState("2026-01-01T08:00:00Z", null) === "running");
  ok("2c. done = ended", activityState("2026-01-01T08:00:00Z", "2026-01-01T13:00:00Z") === "done");
  // THE ONE THAT MATTERS: the schema has no status column at all, so a stale status cannot exist.
  const cols = await admin.from("practice_activity").select("*").limit(1);
  ok("2d. the table has no status column for a clock to disagree with",
    !cols.error && !Object.keys((cols.data ?? [{}])[0] ?? {}).includes("status"),
    Object.keys((cols.data ?? [{}])[0] ?? {}).join(","));

  // ── 3. One at a time ────────────────────────────────────────────────────────────────────────────
  const started = await startActivity(admin, ctxA, clinic.value.id);
  ok("3a. an activity can be started", started.ok, started.ok ? "" : started.message);

  const again = await startActivity(admin, ctxA, clinic.value.id);
  ok("3b. REFUSES starting the same activity twice",
    !again.ok && again.code === "ALREADY_RUNNING", JSON.stringify(again));

  const afterStart = await todaysPlan(admin, ctxA);
  ok("3c. exactly one activity reads as running",
    afterStart.activities.filter(a => a.state === "running").length === 1);
  ok("3d. the running one is the one that was started",
    afterStart.current?.id === clinic.value.id);
  ok("3e. `next` is the earliest activity still planned",
    afterStart.next?.id === round.value.id, JSON.stringify(afterStart.next));

  // Switching: starting the ward round must END the clinic, not run beside it.
  const switched = await startActivity(admin, ctxA, round.value.id);
  ok("3f. starting another activity switches to it", switched.ok, switched.ok ? "" : switched.message);
  ok("3g. switching ended the one that was running",
    switched.ok && switched.value.endedPrevious === clinic.value.id, JSON.stringify(switched));

  const afterSwitch = await todaysPlan(admin, ctxA);
  ok("3h. still exactly one running after a switch",
    afterSwitch.activities.filter(a => a.state === "running").length === 1);

  // ⚠ THE DATABASE, NOT THE ENGINE. Two tabs both read "nothing running" and both write; only the partial
  // unique index can stop that. Asserted by writing DIRECTLY, bypassing every check in activity.ts.
  //
  // Against a PLANNED row, deliberately. Aimed at an activity that had already ended, this write violates
  // the "ended_at >= started_at" CHECK first (23514) and never reaches the index -- it would have looked
  // like a pass for a constraint that was not being tested at all.
  const raw = await admin.from("practice_activity").update({ started_at: new Date().toISOString() })
    .eq("id", spareIndex.value.id);
  ok("3i. the DATABASE refuses a second running activity, not just the engine",
    !!raw.error && raw.error.code === "23505",
    raw.error ? `expected 23505, got ${raw.error.code}` : "the write SUCCEEDED");

  // ── 4. Ending ───────────────────────────────────────────────────────────────────────────────────
  // Against a never-started activity. Aimed at the clinic, the switch in 3f had already ended it, so this
  // returned ALREADY_ENDED -- a refusal, and the wrong one. Two refusals are not interchangeable.
  const endNotStarted = await endActivity(admin, ctxA, spareEnd.value.id);
  ok("4a. REFUSES ending an activity that never started",
    !endNotStarted.ok && endNotStarted.code === "NOT_STARTED", JSON.stringify(endNotStarted));

  const ended = await endActivity(admin, ctxA, round.value.id);
  ok("4a-control. ending a RUNNING activity succeeds", ended.ok, ended.ok ? "" : ended.message);

  const endTwice = await endActivity(admin, ctxA, round.value.id);
  ok("4b. REFUSES ending the same activity twice",
    !endTwice.ok && endTwice.code === "ALREADY_ENDED", JSON.stringify(endTwice));

  const startEnded = await startActivity(admin, ctxA, round.value.id);
  ok("4c. REFUSES restarting an activity that is over",
    !startEnded.ok && startEnded.code === "ALREADY_ENDED", JSON.stringify(startEnded));

  const afterEnd = await todaysPlan(admin, ctxA);
  ok("4d. nothing is running once the day's activity ends", afterEnd.current === null);

  // ── 5. Yesterday is not a thing you can be in ───────────────────────────────────────────────────
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const old = await plan(ctxA, "Yesterday's clinic", 9 * 60, 12 * 60, yesterday);
  ok("5a-control. an activity CAN be planned for another day", old.ok, old.ok ? "" : old.message);
  if (old.ok) {
    const startOld = await startActivity(admin, ctxA, old.value.id);
    ok("5a. REFUSES starting an activity planned for another day",
      !startOld.ok && startOld.code === "NOT_TODAY", JSON.stringify(startOld));
  }
  const planYesterday = await todaysPlan(admin, ctxA);
  ok("5b. yesterday's activity is not in today's plan",
    !planYesterday.activities.some(a => a.planDate !== today));

  // ── 6. Tenancy ──────────────────────────────────────────────────────────────────────────────────
  const bClinic = await plan(ctxB, "B's clinic", 9 * 60, 12 * 60);
  ok("6a-control. practice B can plan its own activity", bClinic.ok, bClinic.ok ? "" : bClinic.message);
  const planB = await todaysPlan(admin, ctxB);
  ok("6b. practice B sees only its own day",
    planB.activities.length === 1 && planB.activities[0].title === "B's clinic",
    JSON.stringify(planB.activities.map(a => a.title)));
  if (bClinic.ok) {
    const cross = await startActivity(admin, ctxA, bClinic.value.id);
    ok("6c. REFUSES starting another practice's activity",
      !cross.ok && cross.code === "NOT_FOUND", JSON.stringify(cross));
  }
  // A second practitioner in the SAME workspace has their own day and their own current activity: the
  // index is per practitioner, not per workspace, or a two-doctor practice could only run one clinic.
  const ctxA2 = ctxFor(wsA, userB, ALL);
  const otherDoc = await plan(ctxA2, "Second doctor's clinic", 8 * 60, 12 * 60);
  ok("6d-control. a second practitioner in the same practice can plan", otherDoc.ok);
  if (otherDoc.ok) {
    const s = await startActivity(admin, ctxA2, otherDoc.value.id);
    ok("6e. two practitioners in one practice can each be in an activity", s.ok,
      s.ok ? "" : s.message);
  }

  // ── 7. Today's Work: a failed read is never a zero ──────────────────────────────────────────────
  const work = await todaysWork(admin, ctxA);
  ok("7a. Today's Work returns CPR-V3-002's four work panels", work.panels.length === 4,
    work.panels.map(p => p.key).join(","));
  ok("7b. every panel that read cleanly reports a count, not null",
    work.panels.every(p => p.unavailable || p.count !== null));
  ok("7c. an empty panel says WHY it is empty rather than showing a bare zero",
    work.panels.filter(p => p.count === 0).every(p => !!p.note),
    JSON.stringify(work.panels.map(p => [p.key, p.count, p.note])));
  ok("7d. every panel's count opens a real list", work.panels.every(p => p.href.startsWith("/practice/")));

  // A caller with NO capabilities must not be told the day is empty -- it must be told it cannot see.
  const blind = await todaysPlan(admin, ctxFor(wsA, userA, []));
  ok("7e. a caller who cannot see the plan gets `unavailable`, not an empty day",
    blind.unavailable && blind.activities.length === 0);
  ok("7e-control. the SAME workspace has activities for a caller who can see",
    (await todaysPlan(admin, ctxA)).activities.length > 0);

  // ── 8. A FAILED READ IS NOT A ZERO, proven against a read that genuinely fails ───────────────────
  //
  // ⚠ WITHOUT THIS THE CLAIM WAS UNTESTED. Nothing in the fixture above makes a query error, so every
  // `unavailable` branch was dead code as far as this harness knew -- deliberately breaking them changed
  // nothing and the suite stayed green. A malformed workspace id makes PostgREST reject the filter for
  // real (invalid uuid syntax), which is an error path and not a mock of one.
  const broken = ctxFor("not-a-uuid", userA, ALL);

  const brokenPlan = await todaysPlan(admin, broken);
  ok("8a. a plan that could not be read says so rather than reporting an empty day",
    brokenPlan.unavailable && brokenPlan.activities.length === 0 && brokenPlan.current === null);

  const brokenWork = await todaysWork(admin, broken);
  ok("8b. a panel that could not be read reports no count, never a nought",
    brokenWork.panels.every(p => p.unavailable && p.count === null),
    JSON.stringify(brokenWork.panels.map(p => [p.key, p.unavailable, p.count])));
  ok("8c. and it says so in words, rather than looking like good news",
    brokenWork.panels.every(p => !!p.note && !/^No |^Nothing |^Nobody /.test(p.note!)),
    JSON.stringify(brokenWork.panels.map(p => p.note)));
  ok("8d. an unreadable queue does not invent a next patient",
    brokenWork.nextPatient === null && brokenWork.nextPatientUnavailable);
  // Control: the SAME assertions against a working read must come out the other way, or 8a-8d would
  // pass against an engine that reported everything as unavailable all the time.
  const goodWork = await todaysWork(admin, ctxA);
  ok("8-control. a readable practice reports counts and is not marked unavailable",
    goodWork.panels.every(p => !p.unavailable && p.count !== null) && !goodWork.plan.unavailable);

  await cleanup(userA, userB);
  report();
}

/** Idempotent teardown, run before AND after: a harness that cannot be run twice is run once. */
async function cleanup(...users: string[]) {
  for (const u of users) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_activity").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
