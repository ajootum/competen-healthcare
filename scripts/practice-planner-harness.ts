/**
 * CPR-V5-005 PRACTICE PLANNER: the seven-day week, s5's actions, s7's conflict detection. Migration 236.
 *
 * WHAT THIS HAS TO PROVE, taken from the specification rather than from what the code happens to do:
 *   s2  "Weekly planning with all seven days always visible"
 *   s4  "Each day displays activities, location, workload summary and travel indicators"
 *   s5  Move, Duplicate, Split, Extend, Shorten, Cancel, Change Location, Add Notes
 *   s6  "The daily plan overrides the template without destroying it"
 *   s7  "Conflict detection" and "Travel-time validation between locations"
 *   s10 "Drag-and-drop scheduling with conflict validation"
 *   CPR-CORE-001 s13: deleted records are VOIDED or superseded, never physically removed
 *
 * ⚠ SECTION 4 IS THE ONE WORTH THE TROUBLE. The workload and travel figures are hand-checkable on
 * purpose, because a workflow assertion ("the week came back") passes perfectly well while the Day
 * Summary a practitioner reads is adding up the wrong minutes.
 *
 * ⚠ SECTION 5 IS THE OTHER ONE. It is the bug CPR-SET-002 shipped, one layer down: an overlap check that
 * only refuses the SAME location lets a practitioner be at two hospitals at nine o'clock.
 *
 * ⚠ AND SECTION 9. A week that could not be read must report `unavailable`, never seven confidently
 * empty days -- "you have nothing on Thursday" and "I could not find out" are different sentences.
 *
 *   npx --yes tsx scripts/practice-planner-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  plannerWeek, activityConflict, weekStartDate, isoWeekday,
  moveActivity, duplicateActivity, splitActivity, extendActivity, shortenActivity,
  cancelActivity, changeActivityLocation, addActivityNotes,
  PLANNER_CAPABILITIES, PLANNER_ACTIONS, PLANNER_QUICK_ACTIONS,
} from "../src/lib/practice/planner";
import { QUICK_ACTION_LABELS_S9 } from "../src/lib/practice/planner-constants";
import { ACTIVITY_TYPES } from "../src/lib/practice/activity-constants";
import { planActivity, startActivity, endActivity, todaysPlan } from "../src/lib/practice/activity";
import { addSession } from "../src/lib/practice/availability-config";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped, and the
   fault-injecting stubs below deliberately implement only the slice of its chain the engine calls. */

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

// Hex only -- a readable id like "pl001" is not a uuid and PostgREST rejects the whole fixture over it.
const USER_A = "00000000-0000-4000-8000-0000000052a1";
const USER_B = "00000000-0000-4000-8000-0000000052b2";
const TZ = "Africa/Kampala";
const CORR = "harness-planner";

const ALL_CAPS = ["practice.home.view", "appointment.manage", "practice.calendar.view", "encounter.list",
  "practice.locations.manage", "followup.view"];

const ctxFor = (workspaceId: string, userId: string, capabilities: string[] = ALL_CAPS): WorkspaceContext => ({
  // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
  // whose ctx claims one zone while its row holds another tests a state that cannot exist.
  workspaceTimezone: TZ,
  userId, workspaceId, workspaceName: "H", workspaceType: "individual_practice", workspaceStatus: "active",
  roleCodes: ["owner"], capabilities, entitled: true, entitlementStatus: "trial",
  onboardingComplete: true, onboardingStep: null,
  // A fixture stands in for a resolved context; nothing here exercises invalidation.
  contextVersion: "harness",
});

/** Idempotent teardown, run before AND after: a harness that cannot be run twice is run once. */
async function cleanup(...users: string[]) {
  for (const u of users) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      // Deleted explicitly though the workspace cascades: if the workspace delete below ever fails,
      // activities pointing at a practice that no longer exists are exactly what must not be left.
      await admin.from("practice_activity_pause").delete().eq("workspace_id", w.id);
      await admin.from("practice_domain_event").delete().eq("workspace_id", w.id);
      await admin.from("practice_activity").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_clinic").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    // ⚠ THE AUDIT TRAIL IS NOT DELETED, AND THE LINE THAT TRIED TO WAS A SILENT NO-OP FROM THE DAY
    // MIGRATION 247 SHIPPED. 247 s3 makes practice_audit_event append-only with a BEFORE DELETE trigger
    // -- deliberately, so that "deletion events are never removable" is true -- and the delete here
    // raised P0001 on every run while its error was discarded.
    //
    // The consequence was not cosmetic. Section 7 below read EVERY audit row this user had ever written,
    // so after the second run `.find(event_type === cancelled)` returned some previous run's block and
    // 7c failed, while 7a passed on rows an earlier run had left behind -- vacuously green whatever the
    // engine did. Section 7 is now scoped to THIS run's workspace, which is what makes it an assertion
    // about this run at all.
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, users);
}

/** A practice provisioned through the real saga. NEVER an inserted workspace: half a practice is not one. */
async function provision(user: string, name: string, suffix: string) {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pl-${suffix}-${Date.now()}`, request_type: "pilot",
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

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * ⚠ A QUERY THAT FAILS AT WHATEVER DEPTH IT IS CHAINED TO.
 *
 * The engine's reads are six and seven calls long, and a stub that spells the chain out by hand stops
 * injecting a fault the moment the engine adds a `.order()` -- it throws a TypeError instead, which
 * looks like a harness bug and is usually "fixed" by weakening the assertion. This mirrors any shape.
 */
function failingQuery(message = "relation does not exist") {
  const result = { data: null, error: { message, code: "42P01" } };
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return () => chain;
    },
  });
  return chain;
}

async function main() {
  console.log("\n=== PRACTICE PLANNER: WEEK, ACTIONS, CONFLICTS (CPR-V5-005, migration 236) ===\n");

  // ⚠ THE MIGRATION GATE. Without it, every "the planner refused that" assertion below would pass
  // against an UNAPPLIED migration -- the engine returns READ_FAILED for a missing column and a test
  // that only checked `!result.ok` would certify a feature that does not exist. The subset that needs no
  // DDL still runs.
  const probe = await admin.from("practice_activity").select("id, cancelled_at, notes").limit(1);
  const ddl = !probe.error;
  ok("0. control -- migration 236 is applied", ddl,
    probe.error ? `${probe.error.message} -- apply supabase/migrations/236-practice-planner.sql` : "");

  await cleanup(USER_A, USER_B);
  const wsA = await provision(USER_A, "Harness Planner A", "a");
  const wsB = await provision(USER_B, "Harness Planner B", "b");
  const ctxA = ctxFor(wsA, USER_A);
  const ctxB = ctxFor(wsB, USER_B);

  // ── 1. CAPABILITY CODES ARE REAL ─────────────────────────────────────────────────────────────────
  //
  // A capability code is a STRING compared against practice_role_capabilities. An invented one costs
  // nothing at compile time and returns 403 for every user including the owner -- so the screen hides
  // the control and the feature is simply unreachable. Four have shipped in this codebase. Checked
  // against the ENGINE's exported constants, never a list re-typed here: a re-typed list can invent the
  // same fiction the engine did and agree with it forever.
  const { data: caps, error: capErr } = await admin.from("practice_role_capabilities")
    .select("capability_code").in("capability_code", PLANNER_CAPABILITIES);
  const known = new Set(((caps ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  ok("1a. every capability the planner gates on EXISTS in practice_role_capabilities",
    !capErr && PLANNER_CAPABILITIES.every(c => known.has(c)),
    capErr?.message ?? `missing: ${PLANNER_CAPABILITIES.filter(c => !known.has(c)).join(", ") || "none"}`);
  ok("1b-control. and the check can fail -- an invented code is NOT in the table",
    !known.has("practice.planner.manage"));

  // ── 2. THE THINGS THAT NEED NO DDL ───────────────────────────────────────────────────────────────
  const monday = weekStartDate("2026-08-05");   // a Wednesday
  ok("2a. every day of a week resolves to the SAME Monday",
    [0, 1, 2, 3, 4, 5, 6].every(i => weekStartDate(addDays(monday, i)) === monday) && monday === "2026-08-03",
    monday);
  ok("2b. the weekday numbering is ISO -- Monday 1, Sunday 7",
    isoWeekday(monday) === 1 && isoWeekday(addDays(monday, 6)) === 7,
    `${isoWeekday(monday)} / ${isoWeekday(addDays(monday, 6))}`);

  // Every action the menu offers has an engine behind it. A button wired to nothing is the failure this
  // catches, and it is invisible to the compiler because the menu is data.
  const implemented: Record<string, unknown> = {
    move: moveActivity, duplicate: duplicateActivity, split: splitActivity, extend: extendActivity,
    shorten: shortenActivity, cancel: cancelActivity, change_location: changeActivityLocation,
    add_notes: addActivityNotes,
  };
  ok("2c. every action PLANNER_ACTIONS calls implemented has an exported function",
    PLANNER_ACTIONS.filter(a => a.implemented).every(a => typeof implemented[a.key] === "function"),
    PLANNER_ACTIONS.filter(a => a.implemented && typeof implemented[a.key] !== "function")
      .map(a => a.key).join(", "));
  // s9's quick actions name activity types, and migration 232's CHECK is closed. "Add Travel" and "Add
  // Custom Activity" are absent from PLANNER_QUICK_ACTIONS on purpose -- neither has a type.
  ok("2d. every quick action names a type the activity CHECK constraint actually accepts",
    PLANNER_QUICK_ACTIONS.every(q => (ACTIVITY_TYPES as readonly string[]).includes(q.key)),
    PLANNER_QUICK_ACTIONS.filter(q => !(ACTIVITY_TYPES as readonly string[]).includes(q.key))
      .map(q => q.key).join(", "));
  // ⚠ AND THAT THE LIST IS COMPLETE, which is the half that was missing. This module shipped with six of
  // s9's eight quick actions, withholding Add Travel and Add Custom Activity because migration 232 had
  // no type for either -- correct then, and silently wrong the moment migration 237 added five types.
  // "Every entry is valid" passes just as well on a list that is too short.
  ok("2d-b. ⚠ and s9's EIGHT quick actions are all offered -- a list that is too short still 'validates'",
    QUICK_ACTION_LABELS_S9.every(l => PLANNER_QUICK_ACTIONS.some(q => q.label === l))
    && PLANNER_QUICK_ACTIONS.length === QUICK_ACTION_LABELS_S9.length,
    `missing: ${QUICK_ACTION_LABELS_S9.filter(l => !PLANNER_QUICK_ACTIONS.some(q => q.label === l)).join(", ") || "none"}`);
  // The types the constraint accepts but s9 gives no button to are reached through Add Activity. Named
  // so that a screen offering only the quick actions is an obvious omission rather than a silent one.
  ok("2d-c. control -- the type catalogue is WIDER than the quick actions, and both are readable",
    ACTIVITY_TYPES.length > PLANNER_QUICK_ACTIONS.length,
    `${ACTIVITY_TYPES.length} types, ${PLANNER_QUICK_ACTIONS.length} quick actions`);

  // The capability guard fires BEFORE any read, so these run with or without the DDL.
  const noCap = ctxFor(wsA, USER_A, ["practice.home.view"]);
  const fakeId = "00000000-0000-4000-8000-00000000dead";
  const moveNoCap = await moveActivity(admin, noCap, fakeId, { plannedStartMinute: 600 }, { source: "system" });
  ok("2e. a caller without the write capability is refused, and told which one",
    !moveNoCap.ok && moveNoCap.code === "FORBIDDEN" && moveNoCap.message.includes("appointment.manage"),
    JSON.stringify(moveNoCap));
  const cancelNoCap = await cancelActivity(admin, noCap, fakeId, {}, { source: "system" });
  ok("2f. and so is a cancellation",
    !cancelNoCap.ok && cancelNoCap.code === "FORBIDDEN", JSON.stringify(cancelNoCap));
  const weekNoView = await plannerWeek(admin, ctxFor(wsA, USER_A, ["appointment.manage"]));
  ok("2g. a caller who cannot READ gets an unavailable week, not an empty one",
    weekNoView.unavailable && weekNoView.workload === null && weekNoView.days.length === 7,
    JSON.stringify([weekNoView.unavailable, weekNoView.workload, weekNoView.days.length]));

  if (!ddl) {
    console.log("\n  -- migration 236 is NOT applied: sections 3-9 need the DDL and were SKIPPED --");
    await cleanup(USER_A, USER_B);
    report();
    return;
  }

  // ── FIXTURES ─────────────────────────────────────────────────────────────────────────────────────
  //
  // A FUTURE week, so that nothing here depends on which day the harness is run and so that "today" is
  // outside it -- the running-activity assertions in section 6 need today, and they must not disturb
  // the arithmetic in section 4.
  const today = (await todaysPlan(admin, ctxA)).date;
  const W = weekStartDate(addDays(today, 14));
  const d = (n: number) => addDays(W, n);

  const { data: l1 } = await admin.from("practice_location").insert({
    workspace_id: wsA, name: "Mulago Hospital", type: "hospital", active: true, travel_buffer_minutes: 0,
  }).select("id").single();
  const { data: l2 } = await admin.from("practice_location").insert({
    workspace_id: wsA, name: "TMR International Hospital", type: "hospital", active: true,
    travel_buffer_minutes: 30,
  }).select("id").single();
  const { data: lB } = await admin.from("practice_location").insert({
    workspace_id: wsB, name: "Another Practice's Clinic", type: "clinic", active: true,
    travel_buffer_minutes: 15,
  }).select("id").single();
  const L1 = l1!.id as string, L2 = l2!.id as string, LB = lB!.id as string;

  const plan = async (
    ctx: WorkspaceContext, type: string, title: string, date: string, s: number, e: number,
    locationId: string | null = null,
  ) => {
    const r = await planActivity(admin, ctx, {
      activityType: type, title, planDate: date,
      plannedStartMinute: s, plannedEndMinute: e, locationId,
    }, { source: "system" });
    if (!r.ok) throw new Error(`fixture "${title}" refused: ${r.code} ${r.message}`);
    return r.value.id;
  };

  // ── 3. SEVEN DAYS, ALWAYS ────────────────────────────────────────────────────────────────────────
  const emptyWeek = await plannerWeek(admin, ctxA, { date: d(3) });
  ok("3a. an EMPTY week still has seven days -- s2, and a day with nothing on it is a row",
    emptyWeek.days.length === 7, `${emptyWeek.days.length}`);
  ok("3b. Monday to Sunday, consecutive, starting on the week's Monday",
    // Optional-chained on purpose: a week that came back SHORT must be reported as a failed assertion,
    // not as a thrown TypeError that stops the rest of the harness from running.
    emptyWeek.weekStartDate === W && emptyWeek.days.every((day, i) => day.date === d(i))
    && emptyWeek.days[0]?.weekday === 1 && emptyWeek.days[6]?.weekday === 7,
    `${emptyWeek.weekStartDate} vs ${W}`);
  ok("3c. it is READABLE, and says so -- an empty week is not an unavailable one",
    !emptyWeek.unavailable && emptyWeek.detail === null && emptyWeek.workload !== null,
    JSON.stringify([emptyWeek.unavailable, emptyWeek.detail]));
  ok("3d. an empty DAY reports a workload of nought, which is a reading rather than a null",
    emptyWeek.days[0].workload !== null && emptyWeek.days[0].workload!.activityCount === 0
    && emptyWeek.days[0].workload!.spanMinutes === null,
    JSON.stringify(emptyWeek.days[0].workload));
  const thisWeek = await plannerWeek(admin, ctxA);
  ok("3e. exactly one day in the CURRENT week is marked today",
    thisWeek.days.filter(x => x.isToday).length === 1
    && thisWeek.days.find(x => x.isToday)?.date === today,
    thisWeek.days.filter(x => x.isToday).map(x => x.date).join(", "));

  // ── 4. ⚠ THE DAY SUMMARY'S ARITHMETIC ────────────────────────────────────────────────────────────
  //
  // Hand-checkable on purpose:
  //   TUE  A outpatient 09:00-13:00 at Mulago (240) + B ward round 14:00-15:00 at TMR (60)
  //        planned 300, committed 300, span 09:00-15:00 = 360, gap 60
  //        travel: one hop to TMR, buffer 30, gap 60 -- sufficient
  //   WED  C outpatient 09:00-12:00 at Mulago (180) + D theatre 12:10-13:00 at TMR (50)
  //        planned 230, committed 230, span 240, gap 10
  //        travel: one hop to TMR, buffer 30, gap 10 -- SHORT by 20
  //   THU  E outpatient 09:00-11:00 + F administration 10:00-12:00, both at Mulago
  //        planned 240, committed 180 (they overlap), span 180, gap 0, one OVERLAP conflict
  const A = await plan(ctxA, "outpatient_clinic", "Tuesday Clinic", d(1), 540, 780, L1);
  await plan(ctxA, "ward_round", "Tuesday Ward Round", d(1), 840, 900, L2);
  await plan(ctxA, "outpatient_clinic", "Wednesday Clinic", d(2), 540, 720, L1);
  await plan(ctxA, "theatre", "Wednesday Theatre", d(2), 730, 780, L2);
  const E = await plan(ctxA, "outpatient_clinic", "Thursday Clinic", d(3), 540, 660, L1);
  const F = await plan(ctxA, "administration", "Thursday Admin", d(3), 600, 720, L1);

  // s6's template half: the regular week, read beside the plan and never rewritten here.
  const tueTemplate = await addSession(admin, ctxA, {
    locationId: L1, weekday: 2, startsMinute: 540, endsMinute: 780,
    actorId: USER_A, correlationId: "pl-tmpl-tue",
  });
  const monTemplate = await addSession(admin, ctxA, {
    locationId: L1, weekday: 1, startsMinute: 540, endsMinute: 660,
    actorId: USER_A, correlationId: "pl-tmpl-mon",
  });
  ok("4-setup. the regular week has a Tuesday and a Monday session",
    tueTemplate.ok && monTemplate.ok, JSON.stringify([tueTemplate, monTemplate]));

  const week = await plannerWeek(admin, ctxA, { date: d(3) });
  ok("4-setup-b. the week reads", !week.unavailable && !week.truncated, week.detail ?? "");
  const tue = week.days[1], wed = week.days[2], thu = week.days[3];

  ok("4a. every activity lands on its own day",
    tue.activities.length === 2 && wed.activities.length === 2 && thu.activities.length === 2
    && week.days[0].activities.length === 0,
    week.days.map(x => x.activities.length).join(","));
  ok("4b. TUESDAY: 300 planned, 300 committed, a 360-minute span and a 60-minute gap",
    tue.workload!.plannedMinutes === 300 && tue.workload!.committedMinutes === 300
    && tue.workload!.spanMinutes === 360 && tue.workload!.gapMinutes === 60,
    JSON.stringify(tue.workload));
  ok("4c. ⚠ THURSDAY's two OVERLAPPING blocks are 240 planned but only 180 committed",
    thu.workload!.plannedMinutes === 240 && thu.workload!.committedMinutes === 180,
    JSON.stringify([thu.workload!.plannedMinutes, thu.workload!.committedMinutes]));
  ok("4d. and the overlap is reported as a conflict naming both blocks",
    thu.conflicts.some(c => c.code === "ACTIVITY_OVERLAP"
      && c.activityIds.includes(E) && c.activityIds.includes(F)),
    JSON.stringify(thu.conflicts));
  ok("4e. the day's workload is broken down by activity type",
    tue.workload!.byType.length === 2
    && tue.workload!.byType.find(t => t.activityType === "outpatient_clinic")?.minutes === 240
    && tue.workload!.byType.find(t => t.activityType === "ward_round")?.minutes === 60,
    JSON.stringify(tue.workload!.byType));
  ok("4f. the day is a ROUTE: two locations in clock order, with the practice's names",
    tue.locations.length === 2 && tue.locations[0].name === "Mulago Hospital"
    && tue.locations[1].name === "TMR International Hospital",
    JSON.stringify(tue.locations.map(l => l.name)));
  ok("4g. consecutive blocks at ONE place are ONE visit, not two",
    thu.locations.length === 1 && thu.locations[0].activityCount === 2,
    JSON.stringify(thu.locations));

  // ⚠ THE TRAVEL FIGURE. The comp asks for "2h 45m Travel Time" and "20m travel". This is the sum of
  // travel_buffer_minutes -- numbers the practitioner TYPED -- and the payload has to say so, because a
  // figure believed to be measured will be trusted against the practitioner's own judgement.
  ok("4h. the day's travel figure is the sum of the TYPED buffers: 30 minutes to reach TMR",
    tue.travel.bufferMinutes === 30 && tue.travel.hops.length === 1
    && tue.travel.hops[0].neededMinutes === 30 && tue.travel.hops[0].gapMinutes === 60,
    JSON.stringify(tue.travel));
  ok("4i. ⚠ and the payload SAYS it was typed and not measured",
    tue.travel.basis === "typed_buffer" && tue.travel.measured === false
    && tue.travel.note.length > 0, JSON.stringify([tue.travel.basis, tue.travel.measured]));
  ok("4j. TUESDAY's hop fits, so there is no shortfall and no conflict",
    tue.travel.shortfalls.length === 0 && tue.travel.hops[0].sufficient && tue.conflicts.length === 0,
    JSON.stringify(tue.conflicts));
  ok("4k. ⚠ WEDNESDAY's 10-minute gap does NOT fit the 30 minutes typed for TMR",
    wed.travel.shortfalls.length === 1 && wed.travel.shortfalls[0].gapMinutes === 10
    && wed.travel.shortfalls[0].neededMinutes === 30 && !wed.travel.shortfalls[0].sufficient,
    JSON.stringify(wed.travel));
  ok("4l. and that shortfall is raised as a travel conflict, naming both places",
    wed.conflicts.some(c => c.code === "ACTIVITY_TRAVEL_CONFLICT"
      && /Mulago/.test(c.message) && /TMR/.test(c.message)),
    JSON.stringify(wed.conflicts));

  ok("4m. the WEEK rolls up: 6 activities, 770 planned, 710 committed, 3 days used",
    week.workload!.activityCount === 6 && week.workload!.plannedMinutes === 770
    && week.workload!.committedMinutes === 710 && week.workload!.daysWithActivities === 3,
    JSON.stringify(week.workload));
  ok("4n. and the week's travel total is 60 typed minutes across two hops, still not measured",
    week.workload!.travelBufferMinutes === 60 && week.workload!.travelMeasured === false
    && week.workload!.travelBasis === "typed_buffer" && week.workload!.travelShortfallCount === 1,
    JSON.stringify(week.workload));
  ok("4o. two conflicts across the week -- one overlap, one travel",
    week.workload!.conflictCount === 2 && week.workload!.locationCount === 2,
    `${week.workload!.conflictCount} conflicts, ${week.workload!.locationCount} locations`);

  // ---- s6: TEMPLATE BESIDE REALITY --------------------------------------------------------------
  ok("4p. the regular week is shown beside the plan, per weekday",
    tue.templateSessions.length === 1 && week.days[0].templateSessions.length === 1
    && wed.templateSessions.length === 0,
    JSON.stringify(week.days.map(x => x.templateSessions.length)));
  ok("4q. a template session the plan COVERS is marked covered",
    tue.templateSessions[0].coveredByPlan === true, JSON.stringify(tue.templateSessions[0]));
  ok("4r. ⚠ and one the plan does NOT cover is an override, not a missing row",
    week.days[0].templateSessions[0].coveredByPlan === false,
    JSON.stringify(week.days[0].templateSessions[0]));

  // ── 5. ⚠ CONFLICT DETECTION ON THE WRITE PATH (s7, s10) ──────────────────────────────────────────
  const G = await plan(ctxA, "outpatient_clinic", "Friday Clinic", d(4), 540, 780, L1);
  const H = await plan(ctxA, "teaching", "Sunday Teaching", d(6), 720, 780, L1);
  const I = await plan(ctxA, "virtual_clinic", "Sunday Telemedicine", d(6), 540, 600, L2);

  const ontoBusy = await moveActivity(admin, ctxA, H, { planDate: d(4), plannedStartMinute: 600 },
    { source: "system" });
  ok("5a. moving a block onto an occupied window is REFUSED",
    !ontoBusy.ok && ontoBusy.code === "ACTIVITY_OVERLAP", JSON.stringify(ontoBusy));

  // ⚠ THE BUG CPR-SET-002 SHIPPED, one layer down. An overlap check that only refuses the SAME location
  // accepts 09:00 at Mulago and 09:00 at TMR on one day, and the first two patients to take them send
  // the practitioner to two hospitals at once.
  const twoPlacesAtOnce = await moveActivity(admin, ctxA, I,
    { planDate: d(4), plannedStartMinute: 570, plannedEndMinute: 630 }, { source: "system" });
  ok("5b. ⚠ and it is refused at a DIFFERENT hospital too, not only the same one",
    !twoPlacesAtOnce.ok && twoPlacesAtOnce.code === "ACTIVITY_OVERLAP", JSON.stringify(twoPlacesAtOnce));
  ok("5c. the refusal names both places, so the practitioner knows which two",
    !twoPlacesAtOnce.ok && /Mulago/.test(twoPlacesAtOnce.message) && /TMR/.test(twoPlacesAtOnce.message),
    !twoPlacesAtOnce.ok ? twoPlacesAtOnce.message : "");

  // TRAVEL, for two blocks that do NOT overlap: 13:00 at Mulago then 13:10 at TMR needs 30 minutes.
  const tooTight = await moveActivity(admin, ctxA, I,
    { planDate: d(4), plannedStartMinute: 790, plannedEndMinute: 840 }, { source: "system" });
  ok("5d. two sites ten minutes apart, with thirty minutes typed, is REFUSED",
    !tooTight.ok && tooTight.code === "ACTIVITY_TRAVEL_CONFLICT", JSON.stringify(tooTight));

  // A block must not conflict with ITSELF while being moved -- the same excludeId problem sessionConflict
  // solves. Without it, every move of a block onto a window it already partly occupies would be refused.
  const slide = await moveActivity(admin, ctxA, G, { plannedStartMinute: 600 }, { source: "system" });
  ok("5e. a block does not conflict with itself: sliding it an hour later is allowed",
    slide.ok && slide.value.plannedStartMinute === 600 && slide.value.plannedEndMinute === 840,
    JSON.stringify(slide));
  ok("5f. ⚠ and the DURATION is preserved -- dragging a block slides it, it does not stretch it",
    slide.ok && slide.value.plannedEndMinute - slide.value.plannedStartMinute === 240,
    JSON.stringify(slide));

  const direct = await activityConflict(admin, ctxA, {
    planDate: d(4), plannedStartMinute: 660, plannedEndMinute: 700, locationId: L1,
  });
  ok("5g. the conflict rule is callable on its own, and refuses a clash with no block to exclude",
    direct !== null && direct.code === "ACTIVITY_OVERLAP", JSON.stringify(direct));
  const clear = await activityConflict(admin, ctxA, {
    planDate: d(0), plannedStartMinute: 660, plannedEndMinute: 700, locationId: L1,
  });
  ok("5g-control. and returns null on a clear day, so 5g is not passing on everything",
    clear === null, JSON.stringify(clear));

  // ── 6. THE ACTIONS (s5) ──────────────────────────────────────────────────────────────────────────

  // ---- CANCEL, and CPR-CORE-001 s13's void-rather-than-delete ------------------------------------
  const cancelled = await cancelActivity(admin, ctxA, G, { reason: "Theatre list pulled" },
    { source: "system" });
  ok("6a. a planned block can be cancelled", cancelled.ok, JSON.stringify(cancelled));
  const { data: stillThere } = await admin.from("practice_activity")
    .select("id, cancelled_at, cancelled_by, cancellation_reason").eq("id", G).maybeSingle();
  ok("6b. ⚠ and the ROW IS STILL THERE -- voided, never deleted (CORE-001 s13)",
    !!stillThere && !!stillThere.cancelled_at && stillThere.cancelled_by === USER_A
    && stillThere.cancellation_reason === "Theatre list pulled", JSON.stringify(stillThere));
  const afterCancel = await plannerWeek(admin, ctxA, { date: d(4) });
  const fri = afterCancel.days[4];
  ok("6c. the cancelled block is STILL ON THE WEEK, in the cancelled state",
    fri.activities.some(x => x.id === G && x.state === "cancelled"
      && x.cancellationReason === "Theatre list pulled"),
    JSON.stringify(fri.activities.map(x => [x.id === G, x.state])));
  ok("6d. and it is OUT of the arithmetic -- nought committed minutes, one counted as cancelled",
    fri.workload!.activityCount === 0 && fri.workload!.cancelledCount === 1
    && fri.workload!.committedMinutes === 0, JSON.stringify(fri.workload));
  const overCancelled = await moveActivity(admin, ctxA, I,
    { planDate: d(4), plannedStartMinute: 600, plannedEndMinute: 660 }, { source: "system" });
  ok("6e. ⚠ and it no longer holds the time hostage -- something else can be planned over it",
    overCancelled.ok, JSON.stringify(overCancelled));
  const twice = await cancelActivity(admin, ctxA, G, {}, { source: "system" });
  ok("6f. REFUSES cancelling something already cancelled",
    !twice.ok && twice.code === "ALREADY_CANCELLED", JSON.stringify(twice));

  // ---- DUPLICATE ---------------------------------------------------------------------------------
  const dup = await duplicateActivity(admin, ctxA, A, { toDates: [d(5), d(1)] }, { source: "system" });
  ok("6g. Duplicate copies onto a free date", dup.ok && dup.value.created.length === 1
    && dup.value.created[0].date === d(5), JSON.stringify(dup));
  ok("6h. ⚠ and DECIDES EACH DATE SEPARATELY -- the clashing one is refused with a reason, not the batch",
    dup.ok && dup.value.refused.length === 1 && dup.value.refused[0].date === d(1)
    && dup.value.refused[0].reason.length > 0, JSON.stringify(dup.ok ? dup.value.refused : dup));
  const copyId = dup.ok ? dup.value.created[0].id : "";
  const { data: copyRow } = await admin.from("practice_activity")
    .select("id, duplicated_from_id, cancelled_at, started_at, title").eq("id", copyId).maybeSingle();
  ok("6i. the copy remembers where it came from, and is neither started nor cancelled",
    !!copyRow && copyRow.duplicated_from_id === A && copyRow.started_at === null
    && copyRow.cancelled_at === null && copyRow.title === "Tuesday Clinic", JSON.stringify(copyRow));
  const dupNone = await duplicateActivity(admin, ctxA, A, { toDates: [] }, { source: "system" });
  ok("6j. REFUSES a copy with no dates", !dupNone.ok && dupNone.code === "VALIDATION_ERROR",
    JSON.stringify(dupNone));

  // ---- SPLIT -------------------------------------------------------------------------------------
  const split = await splitActivity(admin, ctxA, copyId, { atMinute: 660, secondTitle: "Afternoon half" },
    { source: "system" });
  ok("6k. Split makes two blocks that abut at the split point",
    split.ok && split.value.firstEndMinute === 660 && split.value.secondStartMinute === 660,
    JSON.stringify(split));
  const { data: halves } = await admin.from("practice_activity")
    .select("id, title, planned_start_minute, planned_end_minute, split_from_id")
    .eq("plan_date", d(5)).eq("workspace_id", wsA).order("planned_start_minute");
  ok("6l. the day now holds 09:00-11:00 and 11:00-13:00, and the second names its parent",
    (halves ?? []).length === 2
    && (halves as any[])[0].planned_end_minute === 660
    && (halves as any[])[1].planned_start_minute === 660
    && (halves as any[])[1].planned_end_minute === 780
    && (halves as any[])[1].split_from_id === copyId
    && (halves as any[])[1].title === "Afternoon half",
    JSON.stringify(halves));
  const splitOutside = await splitActivity(admin, ctxA, copyId, { atMinute: 540 }, { source: "system" });
  ok("6m. REFUSES a split point that is not INSIDE the block",
    !splitOutside.ok && splitOutside.code === "VALIDATION_ERROR", JSON.stringify(splitOutside));

  // ---- EXTEND AND SHORTEN ------------------------------------------------------------------------
  const secondHalf = (halves as any[])[1].id as string;
  const ext = await extendActivity(admin, ctxA, secondHalf, { byMinutes: 30 }, { source: "system" });
  ok("6n. Extend moves the planned end later", ext.ok && ext.value.plannedEndMinute === 810,
    JSON.stringify(ext));
  const extPastMidnight = await extendActivity(admin, ctxA, secondHalf, { byMinutes: 1000 },
    { source: "system" });
  ok("6o. REFUSES an extension that would run past midnight, rather than silently clipping it",
    !extPastMidnight.ok && extPastMidnight.code === "VALIDATION_ERROR", JSON.stringify(extPastMidnight));
  const extIntoNeighbour = await extendActivity(admin, ctxA, (halves as any[])[0].id, { byMinutes: 60 },
    { source: "system" });
  ok("6p. ⚠ and one that would run into the next block, which is what makes Extend conflict-checked",
    !extIntoNeighbour.ok && extIntoNeighbour.code === "ACTIVITY_OVERLAP", JSON.stringify(extIntoNeighbour));
  const short = await shortenActivity(admin, ctxA, secondHalf, { byMinutes: 30 }, { source: "system" });
  ok("6q. Shorten moves it back", short.ok && short.value.plannedEndMinute === 780, JSON.stringify(short));
  const shortToNothing = await shortenActivity(admin, ctxA, secondHalf, { byMinutes: 500 },
    { source: "system" });
  ok("6r. REFUSES shortening a block out of existence",
    !shortToNothing.ok && shortToNothing.code === "VALIDATION_ERROR", JSON.stringify(shortToNothing));
  // ⚠ SHORTEN IS NOT CONFLICT-CHECKED, on purpose: Thursday is already double-booked, and if taking time
  // OUT of a day could be refused by the clash it is fixing, the day could never be tidied up.
  const shortenOnClash = await shortenActivity(admin, ctxA, F, { byMinutes: 30 }, { source: "system" });
  ok("6s. ⚠ shortening a block on an ALREADY double-booked day is allowed -- it is the fix, not the fault",
    shortenOnClash.ok, JSON.stringify(shortenOnClash));

  // ---- CHANGE LOCATION ---------------------------------------------------------------------------
  const relocateTight = await changeActivityLocation(admin, ctxA, secondHalf, { locationId: L2 },
    { source: "system" });
  ok("6t. ⚠ Change Location is conflict-checked even though the CLOCK did not move",
    !relocateTight.ok && relocateTight.code === "ACTIVITY_TRAVEL_CONFLICT", JSON.stringify(relocateTight));
  const relocateRoom = await changeActivityLocation(admin, ctxA, secondHalf, { room: "Theatre 2" },
    { source: "system" });
  ok("6u. and a room change with no move of place is allowed",
    relocateRoom.ok && relocateRoom.value.changed.join() === "room", JSON.stringify(relocateRoom));
  const relocateNoChange = await changeActivityLocation(admin, ctxA, secondHalf, { room: "Theatre 2" },
    { source: "system" });
  ok("6v. REFUSES a change that changes nothing, rather than writing a no-op",
    !relocateNoChange.ok && relocateNoChange.code === "NO_CHANGE", JSON.stringify(relocateNoChange));
  const crossTenantLocation = await changeActivityLocation(admin, ctxA, secondHalf, { locationId: LB },
    { source: "system" });
  ok("6w. ⚠ REFUSES another practice's location -- a block cannot point outside its own workspace",
    !crossTenantLocation.ok && crossTenantLocation.code === "NOT_FOUND",
    JSON.stringify(crossTenantLocation));

  // ---- NOTES -------------------------------------------------------------------------------------
  const noted = await addActivityNotes(admin, ctxA, secondHalf, { notes: "  Bring the ultrasound  " },
    { source: "system" });
  ok("6x. a note is stored, trimmed", noted.ok && noted.value.notes === "Bring the ultrasound",
    JSON.stringify(noted));
  const cleared = await addActivityNotes(admin, ctxA, secondHalf, { notes: "   " }, { source: "system" });
  ok("6y. an empty note CLEARS it, stored as null rather than an empty string",
    cleared.ok && cleared.value.notes === null && cleared.value.cleared, JSON.stringify(cleared));
  const noteOnCancelled = await addActivityNotes(admin, ctxA, G, { notes: "Rebooked for next week" },
    { source: "system" });
  ok("6z. ⚠ a CANCELLED block can still be annotated -- that is exactly when the explanation is wanted",
    noteOnCancelled.ok, JSON.stringify(noteOnCancelled));
  const noteTooLong = await addActivityNotes(admin, ctxA, secondHalf, { notes: "x".repeat(2001) },
    { source: "system" });
  ok("6aa. REFUSES a note longer than the column allows, rather than letting the database say it",
    !noteTooLong.ok && noteTooLong.code === "VALIDATION_ERROR", JSON.stringify(noteTooLong));

  // ---- A RUNNING BLOCK ---------------------------------------------------------------------------
  //
  // On TODAY, because startActivity refuses an activity planned for another day, and outside the week
  // above so none of section 4's arithmetic moves.
  //
  // ⚠ PLANNED AT A LOCATION, BECAUSE STARTING WITHOUT ONE IS NOW REFUSED -- 2026-08-28. activity.ts
  // gained the rule that a practice WITH locations must record one before a session RUNS (planning
  // without one stays legitimate; every encounter the running session creates inherits the location and
  // a blank cannot be reconstructed later). This fixture predated the rule, passed null, and the four
  // REFUSES checks below failed as a cascade behind a 422 LOCATION_REQUIRED that never let the activity
  // start. L2 rather than L1, so 6ad's relocate-to-L1 attempt stays a genuine change of location.
  const live = await plan(ctxA, "outpatient_clinic", "Today Clinic", today, 540, 780, L2);
  const started = await startActivity(admin, ctxA, live, { source: "system" });
  ok("6ab-setup. an activity is running", started.ok, JSON.stringify(started));
  const moveRunning = await moveActivity(admin, ctxA, live, { plannedStartMinute: 600 },
    { source: "system" });
  ok("6ab. REFUSES moving an activity that has started", !moveRunning.ok
    && moveRunning.code === "ALREADY_STARTED", JSON.stringify(moveRunning));
  const splitRunning = await splitActivity(admin, ctxA, live, { atMinute: 660 }, { source: "system" });
  ok("6ac. REFUSES splitting one -- there is no honest answer to which half you are in",
    !splitRunning.ok && splitRunning.code === "ALREADY_STARTED", JSON.stringify(splitRunning));
  const relocateRunning = await changeActivityLocation(admin, ctxA, live, { locationId: L1 },
    { source: "system" });
  ok("6ad. REFUSES relocating one -- encounters recorded in it inherited it as their context",
    !relocateRunning.ok && relocateRunning.code === "ALREADY_STARTED", JSON.stringify(relocateRunning));
  const cancelRunning = await cancelActivity(admin, ctxA, live, {}, { source: "system" });
  ok("6ae. REFUSES cancelling one, and says to end it instead",
    !cancelRunning.ok && cancelRunning.code === "ALREADY_STARTED"
    && /end it/.test(cancelRunning.message), JSON.stringify(cancelRunning));
  // ⚠ WHICH GUARD FIRED IS PART OF THE CLAIM. Deleting the engine's pre-check would change nothing
  // observable if the database did not also refuse it, so the database is asked directly.
  const rawCancel = await admin.from("practice_activity")
    .update({ cancelled_at: new Date().toISOString(), cancelled_by: USER_A }).eq("id", live);
  ok("6af. ⚠ the DATABASE refuses it too, not just the engine (practice_activity_cancel_before_start)",
    !!rawCancel.error && rawCancel.error.code === "23514",
    rawCancel.error ? `expected 23514, got ${rawCancel.error.code}` : "the write SUCCEEDED");
  // Extend IS allowed while running: a clinic overrunning is the normal case, and extending the plan is
  // how a practitioner says "this will take until one".
  const extendRunning = await extendActivity(admin, ctxA, live, { byMinutes: 30 }, { source: "system" });
  ok("6ag. ⚠ but EXTEND is allowed while running -- overrunning is the normal case, not an error",
    extendRunning.ok && extendRunning.value.plannedEndMinute === 810, JSON.stringify(extendRunning));
  await endActivity(admin, ctxA, live, { source: "system" });
  const noteOnFinished = await addActivityNotes(admin, ctxA, live, { notes: "Ran over, three rebooked" },
    { source: "system" });
  ok("6ah. and a FINISHED block can still be annotated", noteOnFinished.ok, JSON.stringify(noteOnFinished));
  const moveFinished = await moveActivity(admin, ctxA, live, { plannedStartMinute: 600 },
    { source: "system" });
  ok("6ai. but not moved -- the plan is not rewritten to match what happened",
    !moveFinished.ok && moveFinished.code === "ALREADY_STARTED", JSON.stringify(moveFinished));

  // ── 7. THE AUDIT TRAIL ───────────────────────────────────────────────────────────────────────────
  //
  // Every action writes state, and CPR-CORE-001 s13 wants an actor, a timestamp, a source and an entry
  // for each. This engine emits no domain event -- migration 236 s7 says why -- so the trail is the ONLY
  // record that a block was moved, and a hole in it is indistinguishable from a quiet week.
  // ⚠ SCOPED TO THIS RUN'S WORKSPACE, NOT TO THE USER. practice_audit_event is append-only (migration
  // 247) so the fixtures' trail survives every teardown; reading by actor alone reads every run this
  // machine has ever done, which makes 7a pass on somebody else's rows and 7c compare against somebody
  // else's block. The workspace id is fresh on every run, so this is the only honest filter.
  const { data: auditRows, error: auditErr } = await admin.from("practice_audit_event")
    .select("event_type, source, actor_id, payload").eq("actor_id", USER_A).eq("workspace_id", wsA)
    .like("event_type", "practice.activity_%");
  const types = new Set(((auditRows ?? []) as { event_type: string }[]).map(r => r.event_type));
  const expected = ["practice.activity_moved", "practice.activity_duplicated", "practice.activity_split",
    "practice.activity_extended", "practice.activity_shortened", "practice.activity_cancelled",
    "practice.activity_relocated", "practice.activity_notes_changed"];
  ok("7a. every one of s5's actions leaves an audit entry",
    !auditErr && expected.every(t => types.has(t)),
    auditErr?.message ?? `missing: ${expected.filter(t => !types.has(t)).join(", ") || "none"}`);
  const cancelAudit = ((auditRows ?? []) as any[]).find(r => r.event_type === "practice.activity_cancelled");
  ok("7b. it records the channel the caller declared rather than a hardcoded one",
    cancelAudit?.source === "system", cancelAudit?.source ?? "-");
  ok("7c. and the cancellation entry carries the reason and the block it was about",
    cancelAudit?.payload?.reason === "Theatre list pulled" && cancelAudit?.payload?.activityId === G,
    JSON.stringify(cancelAudit?.payload));
  const noteAudit = ((auditRows ?? []) as any[]).find(r => r.event_type === "practice.activity_notes_changed");
  ok("7d. ⚠ but the note's TEXT is not copied into the compliance trail -- only its length",
    !!noteAudit && noteAudit.payload?.notes === undefined && typeof noteAudit.payload?.length === "number",
    JSON.stringify(noteAudit?.payload));

  // ── 8. TENANCY ───────────────────────────────────────────────────────────────────────────────────
  const crossMove = await moveActivity(admin, ctxB, A, { plannedStartMinute: 600 }, { source: "system" });
  ok("8a. another practice cannot move this one's block, and gets the same 404 an absent one would",
    !crossMove.ok && crossMove.code === "NOT_FOUND", JSON.stringify(crossMove));
  const crossCancel = await cancelActivity(admin, ctxB, A, {}, { source: "system" });
  ok("8b. nor cancel it", !crossCancel.ok && crossCancel.code === "NOT_FOUND", JSON.stringify(crossCancel));
  const bWeek = await plannerWeek(admin, ctxB, { date: d(3) });
  ok("8c. and B's week is readable and holds NONE of A's activities",
    !bWeek.unavailable && bWeek.days.every(x => x.activities.length === 0)
    && bWeek.workload!.activityCount === 0, JSON.stringify(bWeek.workload));

  // ── 9. ⚠ AN UNREADABLE WEEK IS UNAVAILABLE, NEVER EMPTY ──────────────────────────────────────────
  //
  // Injected at the boundary the engine actually uses: an admin client that behaves normally except that
  // practice_activity is broken -- which is what every caller sees before migration 236 is applied.
  // Seven empty days would be a confident claim that the practitioner has nothing on all week, from a
  // query that never succeeded, and nothing downstream could tell that from a quiet week.
  // ⚠ SHAPE-INDEPENDENT, AND IT WAS NOT. This stub used to spell out the engine's exact chain --
  // select().eq().eq().gte().lte().order().order().limit() -- and the moment plannerWeek's read gained a
  // tie-breaking .order("id") and .range() for paging, the stub threw a TypeError instead of injecting a
  // fault. A fault-injection test that breaks when the CALLER changes is a test that will eventually be
  // "fixed" by deleting it. The proxy below fails at whatever depth it is chained to.
  const brokenAdmin = { from: (table: string) => table === "practice_activity" ? failingQuery() : admin.from(table) };
  const blind = await plannerWeek(brokenAdmin, ctxA, { date: d(3) });
  ok("9a. an unreadable week says UNAVAILABLE and carries the database's own words",
    blind.unavailable && blind.detail === "relation does not exist", JSON.stringify(blind.detail));
  ok("9b. and its week workload is NULL, never a zeroed summary of a week nobody read",
    blind.workload === null, JSON.stringify(blind.workload));
  ok("9c. ⚠ but there are still SEVEN days (s2), each flagged unreadable rather than confidently empty",
    blind.days.length === 7 && blind.days.every(x => x.unavailable && x.workload === null),
    JSON.stringify(blind.days.map(x => [x.unavailable, x.workload === null])));
  ok("9d-control. and the SAME week through the real client is available, so 9a is not passing on nothing",
    !week.unavailable && week.workload !== null, JSON.stringify(week.unavailable));

  // A write that cannot read the block REFUSES rather than guessing.
  const blindMove = await moveActivity(brokenAdmin, ctxA, A, { plannedStartMinute: 600 },
    { source: "system" });
  ok("9e. a move that cannot read the block refuses rather than writing blind",
    !blindMove.ok && blindMove.code === "READ_FAILED", JSON.stringify(blindMove));

  await cleanup(USER_A, USER_B);
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
