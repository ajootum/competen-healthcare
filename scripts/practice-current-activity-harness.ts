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
 *   - every capability code the feature gates on EXISTS in practice_role_capabilities -- an invented one
 *     never fails, it just returns false forever, and a denied read looks exactly like an empty clinic
 *   - CPR-V5-001 s9: an encounter INHERITS the running activity, proven on the stored row -- and an
 *     encounter opened with nothing running still succeeds, carrying null, because working outside a
 *     planned session is normal and a lookup that failed is not the same thing as one
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  todaysPlan, planActivity, startActivity, endActivity, activityState, ACTIVITY_TYPES,
  ACTIVITY_CAPABILITIES,
} from "../src/lib/practice/activity";
import { todaysWork, TODAYS_WORK_CAPABILITIES } from "../src/lib/practice/todays-work";
import { sessionMetrics, activeFollowUps, waitingQueue, operationalAlerts } from "../src/lib/practice/session";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { PRACTICE_NAV, primaryNav, childrenOf, orphanedNav, SIDEBAR_SECTIONS } from "../src/lib/practice/navigation";
import { dashboardReadModel } from "../src/lib/practice/dashboard";
import { GLANCE_SWATCH } from "../src/lib/practice/palette";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { existsSync } from "node:fs";
import { join } from "node:path";

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

// ⚠ THIS LIST FABRICATED THE FICTION IT WAS MEANT TO CATCH. It used to name `practice.calendar.manage`
// and `appointment.view`, neither of which is in practice_role_capabilities -- so the harness handed the
// engine capabilities no real user can ever hold, and stayed green against a shape production cannot
// produce. Assertion 0b now checks every one of these against the table itself.
const ALL = ["practice.home.view", "appointment.manage", "task.view", "followup.view",
  "queue.manage", "inbox.record",
  // ⚠ WITHOUT THESE TWO the metric engine refuses most tiles as not_permitted, and every assertion
  // about an UNREADABLE glance was quietly testing a permission refusal instead of a failed read.
  // Two different answers, one em dash, and the fixture could not tell them apart.
  "practice.calendar.view", "encounter.list"];

async function main() {
  console.log("\n=== CURRENT ACTIVITY / TODAY'S WORK (CPR-V3-001, migration 232) ===\n");

  // ── CONTROL: the table exists and is readable at all ────────────────────────────────────────────
  const probe = await admin.from("practice_activity").select("id").limit(1);
  ok("0. control -- practice_activity exists and is queryable", !probe.error,
    probe.error?.message ?? "");
  if (probe.error) { report(); return; }

  // ── 0b. EVERY CAPABILITY CODE THIS FEATURE GATES ON MUST EXIST ──────────────────────────────────
  //
  // ⚠ THE BUG CLASS THIS CLOSES. A capability code is a string compared against a table. Misspell one,
  // or invent a plausible one, and the check does not fail -- it returns false forever. `CAN_PLAN` was
  // `practice.calendar.manage` and `appointment.view` gated the Walk-in Queue; both were fictions, so
  // planning returned 403 for the practice owner and the queue reported a settled nought. Nothing went
  // red, because "denied" and "there is nothing" render the same.
  //
  // Read from the ENGINE's own constants, never from a list re-typed here: a copy can hold the same
  // fiction as the code it is checking and agree with it indefinitely.
  const capRows = await admin.from("practice_role_capabilities").select("capability_code");
  const granted = new Set(((capRows.data ?? []) as { capability_code: string }[]).map(r => r.capability_code));
  // The control comes FIRST. Against an unreadable or empty table the set is empty, every membership
  // test below is vacuous, and the assertion passes by knowing nothing.
  ok("0b-control. the capability catalogue is readable and non-empty",
    !capRows.error && granted.size > 0, capRows.error?.message ?? `${granted.size} codes`);

  const usedCaps = [...new Set([...ACTIVITY_CAPABILITIES, ...TODAYS_WORK_CAPABILITIES, ...ALL])];
  const invented = usedCaps.filter(c => !granted.has(c));
  ok("0b. every capability this feature gates on exists in practice_role_capabilities",
    granted.size > 0 && invented.length === 0,
    invented.length ? `invented: ${invented.join(", ")}` : `${usedCaps.length} checked`);

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
  ok("1e. REFUSES planning without appointment.manage",
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

  // ── 10. CPR-V5-001 SESSION ENGINE: the window is the session, and estimates are earned ───────────
  //
  // "The dashboard should no longer revolve around appointments. It should revolve around the
  // practitioner's current operational context." That is a claim about SCOPE, so it is tested by
  // scope: the same eight tiles must count a different window depending on whether a session is running.
  const noSession = await todaysPlan(admin, ctxA);
  ok("10a. no session running means no session metrics",
    (await sessionMetrics(admin, ctxA, noSession)) === null);

  const sessionAct = await plan(ctxA, "Metrics clinic", 9 * 60, 17 * 60);
  if (sessionAct.ok) {
    await startActivity(admin, ctxA, sessionAct.value.id);
    const withSession = await todaysPlan(admin, ctxA);
    const m = await sessionMetrics(admin, ctxA, withSession);
    ok("10b. a running session produces metrics", m !== null);
    if (m) {
      ok("10c. the window is the SESSION's, not the day's",
        m.windowStartIso < m.windowEndIso
        && Date.parse(m.windowEndIso) - Date.parse(m.windowStartIso) === 8 * 3600 * 1000,
        `${m.windowStartIso} -> ${m.windowEndIso}`);
      ok("10d. progress is a clamped percentage, never negative or past 100",
        m.progressPercent >= 0 && m.progressPercent <= 100, String(m.progressPercent));

      // ⚠ THE ASSERTION THAT KEEPS THE COMP HONEST. The mockup prints "18 min" average and "12 min"
      // behind. With no completed encounter both are UNKNOWABLE, and a default would make the one
      // figure somebody reschedules an afternoon over into a guess. Null, not a number.
      // 10e-10g moved to metrics.ts with the figures themselves -- sessionMetrics no longer counts
      // patients, so asserting it here would be asserting against a function that cannot fail.

      // ⚠ THE GLANCE MOVED. `todayAtAGlance` counted these eight itself and disagreed with s8 in five
      // places; it is deleted, and the tiles are now a view of metrics.ts assembled in dashboard.ts.
      // Asserted through the ASSEMBLER, because that is what the page renders.
      const dash = await dashboardReadModel(admin, ctxA);
      ok("10h. the glance reports the scope it counted over", dash.glance.scope === "session",
        dash.glance.scope);
      ok("10i. and returns s7's eight tiles", dash.glance.tiles.length === 8,
        dash.glance.tiles.map(t => t.key).join(","));
      ok("10j. every tile opens the list behind its number",
        dash.glance.tiles.every(t => t.href.startsWith("/practice/")));
      // s16: every metric traceable to a formula and its sources. Carried ON the tile, so the claim is
      // checkable at the point of use rather than in a document.
      ok("10i-b. and each carries its formula and the columns it came from",
        dash.glance.tiles.every(t => t.formula.length > 0 && t.sources.length > 0),
        JSON.stringify(dash.glance.tiles.map(t => [t.key, t.sources.length])));
      // ⚠ THE SWATCH IS LOOKED UP BY METRIC KEY. A key with no swatch falls back silently and the tile
      // wears another metric's colour -- which is exactly what happened when `walk_in` was renamed on
      // the wrong map. A missing colour is invisible in a diff and obvious only to whoever is scanning
      // the row at 08:00.
      ok("10i-c. every tile key has its own swatch, none falling back to another metric's colour",
        dash.glance.tiles.every(t => Object.prototype.hasOwnProperty.call(GLANCE_SWATCH, t.key)),
        dash.glance.tiles.filter(t => !Object.prototype.hasOwnProperty.call(GLANCE_SWATCH, t.key))
          .map(t => t.key).join(","));
      const lenses = await activeFollowUps(admin, ctxA, today);
      ok("10k. follow-ups return s6's five lenses", lenses.length === 5,
        lenses.map(l => l.key).join(","));
      // "Waiting Results" must be a real kind rather than a label over nothing.
      ok("10l. 'Waiting Results' is a real follow-up kind, not an invented bucket",
        lenses.some(l => l.key === "waiting_results" && l.count !== null));

      const q = await waitingQueue(admin, ctxA);
      ok("10m. the queue splits into booked, walk-ins and emergency",
        q.groups.map(g => g.key).join() === "booked,walk_ins,emergency", q.groups.map(g => g.key).join());

      const al = await operationalAlerts(admin, ctxA, today);
      ok("10n. a quiet practice raises no alerts rather than four reassurances",
        !al.unavailable && al.alerts.length === 0, JSON.stringify(al.alerts));

      await endActivity(admin, ctxA, sessionAct.value.id);
    }
  }

  // A failed read must leave the figures unknown rather than reporting an idle clinic.
  const brokenDash = await dashboardReadModel(admin, ctxFor("not-a-uuid", userA, ALL));
  ok("10o. an unreadable glance reports no counts, never eight noughts",
    brokenDash.glance.unavailable && brokenDash.glance.tiles.every(t => t.count === null),
    JSON.stringify(brokenDash.glance.tiles.map(t => t.count)));
  ok("10o-control. a readable practice reports counts",
    (await dashboardReadModel(admin, ctxA)).glance.tiles.some(t => t.count !== null));
  // ── 11. CPR-V5-001 s9 / CPR-V3-001 s6: the encounter INHERITS the context ────────────────────────
  //
  // The claim is that a practitioner who has said what they are doing is never asked again -- so it is
  // proven on the stored row, through the same engine the API calls, and not on a screen's props.
  //
  // Both halves matter and neither is the other's control. An encounter made inside a session must carry
  // THAT session; an encounter made outside every session must carry null AND SUCCEED, because refusing
  // to open a consultation because nobody had planned it would be a worse product than no inheritance
  // at all. A build that always wrote null would pass the second on its own.
  const encPatient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Inherit Test One", birthDate: "1980-03-04", sex: "male",
    phone: "0772 555 901", actorId: userA, correlationId: "harness-act",
  });
  const noCtxPatient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Inherit Test Two", birthDate: "1991-07-19", sex: "female",
    phone: "0772 555 902", actorId: userA, correlationId: "harness-act",
  });
  const failPatient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Inherit Test Three", birthDate: "1975-01-30", sex: "male",
    phone: "0772 555 903", actorId: userA, correlationId: "harness-act",
  });
  const setupFails = [encPatient, noCtxPatient, failPatient].filter(p => !p.ok);
  ok("11-setup. three patients register for the inheritance assertions", setupFails.length === 0,
    setupFails.map(p => (p.ok ? "" : p.message)).join("; "));

  /** The stored value, read back raw -- and a failed read is reported, never shrugged off as "null". */
  const storedActivityId = async (encounterId: string) => {
    const { data, error } = await admin.from("practice_encounter")
      .select("activity_id").eq("id", encounterId).maybeSingle();
    if (error) return { id: null, readFailed: true, detail: error.message };
    return { id: (data?.activity_id ?? null) as string | null, readFailed: false, detail: "" };
  };

  if (encPatient.ok && noCtxPatient.ok && failPatient.ok) {
    // (a) inside a session.
    const ctxAct = await plan(ctxA, "Inheritance clinic", 10 * 60, 12 * 60);
    ok("11-setup-b. the session activity is planned", ctxAct.ok, ctxAct.ok ? "" : ctxAct.message);
    if (ctxAct.ok) {
      const startedCtx = await startActivity(admin, ctxA, ctxAct.value.id);
      ok("11a-control. the session is actually running before the encounter is opened",
        startedCtx.ok && (await todaysPlan(admin, ctxA)).current?.id === ctxAct.value.id,
        JSON.stringify(startedCtx));

      const inSession = await launchEncounter(admin, {
        workspaceId: wsA, patientId: encPatient.data.id, pathway: "new_walk_in",
        actorId: userA, correlationId: "harness-act",
      });
      ok("11a-control2. an encounter opens inside a session", inSession.ok,
        inSession.ok ? "" : inSession.message);
      if (inSession.ok) {
        const stored = await storedActivityId(inSession.data.id);
        ok("11a. an encounter opened during a session carries THAT activity",
          !stored.readFailed && stored.id === ctxAct.value.id,
          stored.readFailed ? stored.detail : `stored ${stored.id}, expected ${ctxAct.value.id}`);
      }

      // ⚠ THE READ THAT FAILED IS NOT "NO SESSION". A practitioner id PostgREST cannot parse makes the
      // context lookup error for real (invalid uuid syntax), and the launch must refuse rather than file
      // a clinical record as context-less -- the two are indistinguishable once the row is written.
      const brokenCtx = await launchEncounter(admin, {
        workspaceId: wsA, patientId: failPatient.data.id, pathway: "new_walk_in",
        actorId: "not-a-uuid", correlationId: "harness-act",
      });
      ok("11b. a context lookup that FAILED refuses the launch instead of writing null",
        !brokenCtx.ok && brokenCtx.code === "CONTEXT_READ_FAILED", JSON.stringify(brokenCtx));

      const endedCtx = await endActivity(admin, ctxA, ctxAct.value.id);
      ok("11c-control. the session ends", endedCtx.ok, endedCtx.ok ? "" : endedCtx.message);
    }

    // (c) outside every session. Null here is the RIGHT answer, and the launch must still succeed.
    const idle = await todaysPlan(admin, ctxA);
    ok("11c-control2. nothing is running before the second encounter", idle.current === null,
      JSON.stringify(idle.current));

    const outOfSession = await launchEncounter(admin, {
      workspaceId: wsA, patientId: noCtxPatient.data.id, pathway: "new_walk_in",
      actorId: userA, correlationId: "harness-act",
    });
    ok("11c. an encounter opened with no session running is NOT refused", outOfSession.ok,
      outOfSession.ok ? "" : outOfSession.message);
    if (outOfSession.ok) {
      const stored = await storedActivityId(outOfSession.data.id);
      ok("11d. and it carries a null activity rather than a borrowed one",
        !stored.readFailed && stored.id === null,
        stored.readFailed ? stored.detail : `stored ${stored.id}`);
    }
  }

  // ── 9. CPR-V5-001 s8 navigation: eight sections, and NOTHING unreachable ─────────────────────────
  //
  // ⚠ THE WHOLE RISK OF ADOPTING V3's NINE. This build has twenty-five routes; the volume names nine.
  // Rendering only the nine leaves sixteen working screens with no way in -- which is precisely the
  // defect that made /practice/setup and the settings cards dead ends, found by a person and not by a
  // test. This asserts it cannot happen again, on the SAME functions the sidebar calls.
  const orphans = orphanedNav();
  ok("9a. no built module is unreachable from the sidebar", orphans.length === 0,
    orphans.map(o => `${o.label} (${o.href}) has no parent section`).join("; "));

  const sections = PRACTICE_NAV.filter(i => i.primary);
  ok("9b. the sidebar declares eleven sections", sections.length === 11,
    `${sections.length}: ${sections.map(i => i.label).join(", ")}`);

  // 9b-order. THE ORDER IS PART OF THE SPECIFICATION, not an accident of where entries sit in the array.
  // s8 lists them, and "Encounters becomes the central workspace" is a claim about position as much as
  // about function -- it is fourth, right after the three ways a practitioner reaches one.
  const V5_ORDER = ["/practice/home", "/practice/today", "/practice/calendar", "/practice/patients",
    "/practice/encounters", "/practice/documents", "/practice/follow-ups", "/practice/assistant",
    "/practice/intelligence", "/practice/setup", "/practice/documentation"];
  const rendered = primaryNav([...new Set(PRACTICE_NAV.map(i => i.capability).filter(Boolean))] as string[]);
  ok("9b-order. and renders them in the order the specifications list",
    rendered.map(i => i.href).join() === V5_ORDER.join(), rendered.map(i => i.href).join(" "));

  // A section that is not built must not render, and must not be used as a parent -- a module filed under
  // an unbuilt section is an orphan with extra steps.
  const parents = new Set(PRACTICE_NAV.filter(i => i.parent).map(i => i.parent!));
  const unbuiltParents = [...parents].filter(p =>
    !PRACTICE_NAV.some(i => i.href === p && i.primary && i.built));
  ok("9c. every parent section is itself primary AND built", unbuiltParents.length === 0,
    unbuiltParents.join(", "));

  // Non-vacuity: an owner with everything must actually SEE nine sections and their modules, or 9a-9c
  // would pass just as well against a navigation that rendered nothing at all.
  const allCaps = [...new Set(PRACTICE_NAV.map(i => i.capability).filter(Boolean))] as string[];
  const shown = primaryNav(allCaps);
  ok("9d-control. an owner sees the built sections, not an empty sidebar",
    shown.length === sections.filter(i => i.built).length && shown.length === 11, `${shown.length} shown`);
  // EVERY built non-primary module appears exactly once, under its parent. Asserted as an EQUALITY
  // against the catalogue rather than a threshold: ">= 15" went stale the moment V5-002 promoted
  // Current Session out of the children, and a stale threshold fails for the right reason once and
  // then gets nudged instead of read.
  const childCount = shown.reduce((n, s) => n + childrenOf(s.href, allCaps).length, 0);
  const expectedChildren = PRACTICE_NAV.filter(i => i.built && !i.primary).length;
  ok("9e-control. every built non-primary module appears under a section, exactly once",
    childCount === expectedChildren, `${childCount} rendered vs ${expectedChildren} in the catalogue`);

  // Every href a section or module points at must be a real page, or the sidebar is back to promising
  // routes that do not exist. Checked on the FILE SYSTEM, since a 307 to sign-in cannot tell them apart.
  // 9g. V5-002 removes three from PRIMARY and says in the same breath they "remain available
  // contextually". Both halves are asserted, because doing only the first is how a module gets
  // orphaned and doing only the second is how the freeze quietly gains a tenth section.
  // ⚠ CPR-V5-003 MOVED ONE OF THESE. V5-002 removed Tasks, Analytics and Patient Insights from primary;
  // V5-003 then made Analytics into the Practice Intelligence SECTION, with Patient Insights inside it.
  // The assertion follows the later specification rather than continuing to guard a rule that product
  // change control has since amended -- a test that outlives its own decision is how a freeze becomes
  // a thing people work around.
  const REMOVED = ["/practice/tasks", "/practice/reports"];
  ok("9g. Tasks and Patient Intelligence are not primary navigation",
    REMOVED.every(h => !PRACTICE_NAV.find(i => i.href === h)?.primary),
    REMOVED.filter(h => PRACTICE_NAV.find(i => i.href === h)?.primary).join(", "));
  ok("9g-b. and each is still reachable from the section that owns it",
    REMOVED.every(h => {
      const parent = PRACTICE_NAV.find(i => i.href === h)?.parent;
      return !!parent && !!PRACTICE_NAV.find(i => i.href === parent && i.primary && i.built);
    }), REMOVED.map(h => `${h} -> ${PRACTICE_NAV.find(i => i.href === h)?.parent ?? "NOTHING"}`).join("; "));

  const missing = PRACTICE_NAV.filter(i => i.built).filter(i => {
    const seg = i.href.replace(/^\/practice\//, "");
    return !existsSync(join(process.cwd(), "src", "app", "practice", "(shell)", seg, "page.tsx"));
  });
  // 9h. The sections themselves. V5-003 draws three groups, and the separation carries meaning:
  // everything in Workspace can change a record and Practice Intelligence cannot.
  ok("9h. the sidebar has the three declared sections, in order",
    SIDEBAR_SECTIONS.map(x => x.label).join() === "Workspace,Insights,Administration,Documentation",
    SIDEBAR_SECTIONS.map(x => x.label).join());
  ok("9h-b. and every primary section belongs to exactly one of them",
    PRACTICE_NAV.filter(i => i.primary).every(i =>
      SIDEBAR_SECTIONS.filter(x => x.hrefs.includes(i.href)).length === 1),
    PRACTICE_NAV.filter(i => i.primary)
      .filter(i => SIDEBAR_SECTIONS.filter(x => x.hrefs.includes(i.href)).length !== 1)
      .map(i => i.href).join(", "));

  ok("9f. every built nav entry points at a page that exists", missing.length === 0,
    missing.map(m => m.href).join(", "));

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
