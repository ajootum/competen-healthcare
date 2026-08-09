/**
 * CP-PLAN-002 sections 3-7: PRACTICE PLANNER NAVIGATION, CONTENT CONTROLS, THE FOUR VIEWS AND THE
 * CONTEXTUAL PANEL.
 *
 * WHAT THIS HAS TO PROVE, taken from the specification rather than from what the code happens to do:
 *   s3  Today, previous/next by the unit of the ACTIVE VIEW, a period label, Go to date, the Day | Week
 *       | Month | Agenda switcher, and all six quick periods.
 *   s4  Show / Location / Activity type / Appointment type / Status, SEPARATE from the range controls,
 *       plus a schedule search that finds a known booking without paging week by week.
 *   s5  Four views over ONE schedule.
 *   s6  Month cells with booked and free counts WHERE CALCULABLE, a day off that is visually distinct
 *       without being a record, and a click-through to the day.
 *   s7  Header, capacity summary, time-ordered appointment list, quick actions and a CONFLICT STATE when
 *       a schedule override lands on top of existing appointments.
 *   s8  "Do not create independent appointment stores for each surface."
 *
 * ⚠ SECTION 3 IS THE ONE WORTH THE TROUBLE. A fortnightly clinic must be absent from its off weeks in
 * EVERY view, and a month grid is the easiest place in this product to draw it on all of them -- the
 * week view only ever shows one occurrence, so the bug is invisible there.
 *
 * ⚠ AND SECTION 4's ARITHMETIC. "8 booked - 4 free" is the sentence a practitioner plans against. A
 * workflow assertion ("the month came back") passes perfectly well while the counts are wrong.
 *
 * ⚠ THE THREE VACUITY TRAPS THIS HARNESS WAS WRITTEN AGAINST, all three found in this repo:
 *   (a) scanning source for a phrase that also appears in the scanner's own comment -- comments are
 *       stripped before every source scan below;
 *   (b) asserting over an EMPTY LIST -- every "it is not on those dates" assertion is preceded by a
 *       COUNT CONTROL proving the dates exist, and the dates are derived from what the engine returned
 *       rather than typed in;
 *   (c) re-implementing the rule under test -- the recurrence assertions call occursOn/occurrencesBetween
 *       from recurrence.ts, and the filter assertions call the very predicates the screen calls.
 *
 *   npx --yes tsx scripts/practice-planner-navigation-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import {
  plannerRange, plannerWeek, plannerForPeriod, scheduleSearch, weekStartDate, RANGE_DAY_CAP,
  PLANNER_CAPABILITIES,
} from "../src/lib/practice/planner";
import {
  PLANNER_VIEWS, PLANNER_QUICK_PERIODS, QUICK_PERIOD_LABELS_S3,
  PLANNER_SHOW_OPTIONS, SHOW_LABELS_S4,
  APPOINTMENT_TYPE_LABEL, APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUSES_BOOKED, APPOINTMENT_STATUSES_VOID,
  plannerPeriod, plannerPeriodLabel, shiftPlannerPeriod, quickPeriodTarget,
  addMonthsIso, addDaysIso, monthEndOf, daysBetweenIso, isPlannerDate,
  appointmentPasses, activityPasses, sessionPasses, NO_PLANNER_FILTERS, plannerFiltersActive,
  appointmentOutcome, OUTCOME_LABEL, WHAT_HAPPENED_LIMITS,
  type PlannerFilters,
} from "../src/lib/practice/planner-constants";
import { APPOINTMENT_KINDS } from "../src/lib/practice/calendar";
import { occurrencesBetween } from "../src/lib/practice/recurrence";
import { filterDay } from "../src/app/practice/(shell)/calendar/planner-ui";
import { defaultAppointmentMinutes } from "../src/lib/practice/configuration";
import { zonedDayRange } from "../src/lib/practice/practice-time";
import { planActivity, todaysPlan } from "../src/lib/practice/activity";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped, and the
   fault-injecting stub below deliberately implements only the slice of its chain the engine calls. */

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const pend = (name: string, why: string) => console.log(`  PEND  ${name} -- ${why}`);

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

// ⚠ ONE OWNER ID, AND IT IS THIS ONE. Other harnesses run concurrently and a shared owner id makes one
// harness's cleanup purge another's fixtures mid-run -- which presents as an engine bug in a file nobody
// touched. Everything this harness creates hangs off this uuid and is deleted by it.
const OWNER = "00000000-0000-4000-8000-00000000dad0";
const TZ = "Africa/Kampala";                     // UTC+3, so a UTC-day bug is visible rather than latent
const CORR = "harness-planner-nav";

const ALL_CAPS = ["practice.home.view", "appointment.manage", "practice.calendar.view", "encounter.list",
  "practice.locations.manage", "followup.view"];

const ctxFor = (workspaceId: string, capabilities: string[] = ALL_CAPS): WorkspaceContext => ({
  userId: OWNER, workspaceId, workspaceName: "H", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities, entitled: true,
  entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
});

/** Idempotent teardown, run before AND after: a harness that cannot be run twice is run once. */
async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    // Deleted explicitly though the workspace cascades: if the workspace delete below ever fails, rows
    // pointing at a practice that no longer exists are exactly what must not be left behind.
    await admin.from("practice_arrival").delete().eq("workspace_id", w.id);
    await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_exception").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_activity_pause").delete().eq("workspace_id", w.id);
    await admin.from("practice_domain_event").delete().eq("workspace_id", w.id);
    await admin.from("practice_activity").delete().eq("workspace_id", w.id);
    await admin.from("practice_clinic").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  // ⚠ THE AUDIT TRAIL IS NOT DELETED AND CANNOT BE. Migration 247 s3 makes practice_audit_event
  // append-only with a BEFORE DELETE trigger, on purpose: "deletion events are never removable". A
  // delete here would raise P0001 and, if its error were discarded the way the sibling harness's was,
  // would look like a working teardown for ever. Nothing in this harness reads the audit trail, so the
  // rows are simply left where they belong.
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

/** A practice provisioned through the real saga. NEVER an inserted workspace: half a practice is not one. */
async function provision(): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-plan-nav-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const payload: IndividualRequest = {
    displayName: "Harness Planner Navigation", countryCode: "UG", timezone: TZ,
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

/** An instant, from a practice-local date and minute. The reverse of what the engine does when reading. */
const instantAt = (dateIso: string, minute: number) =>
  new Date(Date.parse(zonedDayRange(dateIso, TZ).startIso) + minute * 60000).toISOString();

/**
 * ⚠ A QUERY THAT FAILS AT WHATEVER DEPTH IT IS CHAINED TO. The engine's reads are five and six calls
 * long and a hand-written stub has to mirror each shape exactly -- which is how a fault-injection test
 * comes to pass because the STUB was wrong rather than because the engine was right.
 */
function failingQuery(message: string) {
  const result = { data: null, error: { message, code: "42P01" } };
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return () => chain;
    },
  });
  return chain;
}
const brokenOn = (table: string) => ({
  from: (t: string) => (t === table ? failingQuery("relation does not exist") : admin.from(t)),
});

/** Walks a payload and reports every path holding a value React cannot serialise across the boundary. */
function unserialisablePaths(value: unknown, path = "$", out: string[] = [], depth = 0): string[] {
  if (depth > 12 || out.length > 20) return out;
  if (typeof value === "function") { out.push(`${path} is a function`); return out; }
  if (typeof value === "symbol") { out.push(`${path} is a symbol`); return out; }
  if (value instanceof Date) { out.push(`${path} is a Date`); return out; }
  if (value instanceof Map || value instanceof Set) { out.push(`${path} is a ${value.constructor.name}`); return out; }
  if (Array.isArray(value)) {
    value.forEach((v, i) => unserialisablePaths(v, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) unserialisablePaths(v, `${path}.${k}`, out, depth + 1);
  }
  return out;
}

/** ⚠ Comments stripped FIRST. A scan for a phrase that also appears in a comment quoting it is the
 *  commonest cause of a vacuous source assertion in this codebase. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

async function main() {
  console.log("\n=== CP-PLAN-002 s3-s7: PLANNER NAVIGATION, VIEWS, FILTERS, SEARCH, PANEL ===\n");

  // ══ 1. THE NAVIGATOR'S ARITHMETIC. No database, so it runs on any checkout. ═══════════════════════
  //
  // Every one of these is the function the SERVER uses to choose which days to read and the BROWSER uses
  // to draw the label and the arrows. Getting them wrong puts a header over the wrong fortnight.

  const W = plannerPeriod("week", "2026-08-05");            // a Wednesday
  ok("1a. Week is Monday to Sunday, whichever day inside it is asked for",
    W.fromDate === "2026-08-03" && W.toDate === "2026-08-09"
    && daysBetweenIso(W.fromDate, W.toDate) === 7,
    JSON.stringify([W.fromDate, W.toDate]));

  const D = plannerPeriod("day", "2026-08-05");
  ok("1b. Day is one day", D.fromDate === "2026-08-05" && D.toDate === "2026-08-05", JSON.stringify(D));

  const M = plannerPeriod("month", "2026-08-05");
  ok("1c. ⚠ Month reads the WHOLE GRID, not the month -- otherwise the first and last rows are blank "
    + "cells indistinguishable from empty days",
    M.fromDate === "2026-07-27" && daysBetweenIso(M.fromDate, M.toDate) % 7 === 0
    && M.fromDate < "2026-08-01" && M.toDate >= "2026-08-31",
    JSON.stringify([M.fromDate, M.toDate, daysBetweenIso(M.fromDate, M.toDate)]));
  ok("1d. and it still knows which days are the month ITSELF, so a grid can grey the rest",
    M.focusFromDate === "2026-08-01" && M.focusToDate === "2026-08-31",
    JSON.stringify([M.focusFromDate, M.focusToDate]));

  const A = plannerPeriod("agenda", "2026-08-05", { from: "2026-08-10", to: "2026-08-14" });
  ok("1e. Agenda takes an arbitrary period", A.fromDate === "2026-08-10" && A.toDate === "2026-08-14",
    JSON.stringify(A));
  const Abad = plannerPeriod("agenda", "2026-08-05", { from: "2026-08-20", to: "2026-08-10" });
  ok("1f. and a backwards period is repaired rather than read backwards",
    Abad.fromDate <= Abad.toDate, JSON.stringify(Abad));

  // ---- s3's "move by ONE UNIT OF THE SELECTED VIEW" ----
  ok("1g. Previous/Next moves a Day by a day and a Week by a week",
    shiftPlannerPeriod(D, 1).anchorDate === "2026-08-06"
    && shiftPlannerPeriod(D, -1).anchorDate === "2026-08-04"
    && shiftPlannerPeriod(W, 1).anchorDate === "2026-08-12"
    && shiftPlannerPeriod(W, -1).anchorDate === "2026-07-29",
    JSON.stringify([shiftPlannerPeriod(D, 1).anchorDate, shiftPlannerPeriod(W, 1).anchorDate]));
  ok("1h. and a Month by a month",
    shiftPlannerPeriod(M, 1).anchorDate === "2026-09-01"
    && shiftPlannerPeriod(M, -1).anchorDate === "2026-07-01",
    JSON.stringify([shiftPlannerPeriod(M, 1).anchorDate, shiftPlannerPeriod(M, -1).anchorDate]));
  const shiftedAgenda = shiftPlannerPeriod(A, 1);
  ok("1i. ⚠ and an Agenda by ITS OWN LENGTH -- s3: 'Agenda uses the active range'",
    shiftedAgenda.from === "2026-08-15" && shiftedAgenda.to === "2026-08-19",
    JSON.stringify(shiftedAgenda));

  // ⚠ THE MONTH CLAMP. `new Date().setUTCMonth(+1)` on 31 January is 3 MARCH -- the overflow rolls
  // forward silently -- so Next month pressed on the last day of January would skip February entirely.
  const jan31 = addMonthsIso("2026-01-31", 1);
  ok("1j. ⚠ month arithmetic CLAMPS: 31 Jan + 1 month is 28 Feb, not 3 March",
    jan31 === "2026-02-28", jan31);
  const naive = new Date(Date.UTC(2026, 0, 31));
  naive.setUTCMonth(naive.getUTCMonth() + 1);
  ok("1j-control. and the naive implementation really does overflow, so 1j is not a tautology",
    naive.toISOString().slice(0, 10) === "2026-03-03", naive.toISOString().slice(0, 10));

  // ---- s3's period label ----
  ok("1k. the period label reads as s3 asks: 'August 2026' and '03-09 Aug 2026'",
    plannerPeriodLabel(M) === "August 2026" && plannerPeriodLabel(W) === "03-09 Aug 2026",
    `${plannerPeriodLabel(M)} | ${plannerPeriodLabel(W)}`);
  ok("1l. a Day names the weekday, and a period across two months names both",
    plannerPeriodLabel(D) === "Wednesday 05 Aug 2026"
    && plannerPeriodLabel(plannerPeriod("agenda", "2026-08-05", { from: "2026-08-28", to: "2026-09-03" }))
      === "28 Aug - 03 Sep 2026",
    `${plannerPeriodLabel(D)} | ${plannerPeriodLabel(plannerPeriod("agenda", "2026-08-05", { from: "2026-08-28", to: "2026-09-03" }))}`);

  // ---- s3's six quick periods, COMPLETE and not merely valid ----
  ok("1m. all four views are offered: Day, Week, Month, Agenda",
    PLANNER_VIEWS.length === 4
    && ["day", "week", "month", "agenda"].every(k => PLANNER_VIEWS.some(v => v.key === k)),
    PLANNER_VIEWS.map(v => v.key).join(","));
  ok("1n. ⚠ and s3's SIX quick periods are ALL offered -- a list that is too short still 'validates'",
    QUICK_PERIOD_LABELS_S3.every(l => PLANNER_QUICK_PERIODS.some(q => q.label === l))
    && PLANNER_QUICK_PERIODS.length === QUICK_PERIOD_LABELS_S3.length,
    `missing: ${QUICK_PERIOD_LABELS_S3.filter(l => !PLANNER_QUICK_PERIODS.some(q => q.label === l)).join(", ") || "none"}`);

  const T = "2026-08-05";   // a Wednesday, used as "today" for the quick periods
  const qp = (k: any) => quickPeriodTarget(k, T);
  ok("1o. Last week, This week and Next week land on the right Mondays",
    plannerPeriod("week", qp("last_week").anchorDate).fromDate === "2026-07-27"
    && plannerPeriod("week", qp("this_week").anchorDate).fromDate === "2026-08-03"
    && plannerPeriod("week", qp("next_week").anchorDate).fromDate === "2026-08-10",
    JSON.stringify([qp("last_week").anchorDate, qp("this_week").anchorDate, qp("next_week").anchorDate]));
  ok("1p. This month and Next month land on the right months",
    qp("this_month").anchorDate === "2026-08-01" && qp("next_month").anchorDate === "2026-09-01"
    && qp("this_month").view === "month",
    JSON.stringify([qp("this_month").anchorDate, qp("next_month").anchorDate]));
  ok("1q. Custom period opens an Agenda on a real period rather than inventing one",
    qp("custom").view === "agenda" && qp("custom").from === "2026-08-01"
    && qp("custom").to === monthEndOf(T), JSON.stringify(qp("custom")));

  // ══ 2. s4's CONTENT CONTROLS -- the RULE, called exactly as the screen calls it. ══════════════════
  //
  // ⚠ THESE ARE THE PREDICATES THE COMPONENTS IMPORT. A harness that re-typed the "Walk-ins" rule here
  // would stay green under every break to the real one.

  ok("2a. ⚠ all EIGHT of s4's Show options are offered, and none invented",
    SHOW_LABELS_S4.every(l => PLANNER_SHOW_OPTIONS.some(o => o.label === l))
    && PLANNER_SHOW_OPTIONS.length === SHOW_LABELS_S4.length,
    `missing: ${SHOW_LABELS_S4.filter(l => !PLANNER_SHOW_OPTIONS.some(o => o.label === l)).join(", ") || "none"}`);

  // ⚠ THE APPOINTMENT VOCABULARY IS ONE VOCABULARY IN TWO FILES, and this checks it against the OTHER
  // file rather than against a list re-typed here. planner-constants duplicates calendar.ts's labels
  // because calendar.ts is a server engine a client filter bar must not import; a copy that drifted
  // would offer a type the diary cannot store.
  ok("2b. ⚠ the planner's appointment types are exactly calendar.ts's, so the copy cannot drift",
    Object.keys(APPOINTMENT_TYPE_LABEL).sort().join(",") === Object.keys(APPOINTMENT_KINDS).sort().join(","),
    `${Object.keys(APPOINTMENT_TYPE_LABEL).sort().join(",")} vs ${Object.keys(APPOINTMENT_KINDS).sort().join(",")}`);
  ok("2c. every appointment status is either counted as booked or counted as void, and none is both",
    Object.keys(APPOINTMENT_STATUS_LABEL).every(s =>
      APPOINTMENT_STATUSES_BOOKED.includes(s) !== APPOINTMENT_STATUSES_VOID.includes(s)),
    JSON.stringify([APPOINTMENT_STATUSES_BOOKED, APPOINTMENT_STATUSES_VOID]));

  const walkIn = {
    appointmentType: "walk_in", status: "CONFIRMED", locationId: "L1", locationName: "Mulago",
    voided: false, isWalkIn: true, isFollowUp: false, patientName: "Achen Grace", reason: null,
  };
  const followUp = {
    appointmentType: "scheduled_followup", status: "CONFIRMED", locationId: "L2", locationName: "TMR",
    voided: false, isWalkIn: false, isFollowUp: true, patientName: "Okello John", reason: null,
  };
  const cancelled = { ...followUp, status: "CANCELLED", voided: true, patientName: "Nabirye Sarah" };
  const clinicBlock = {
    activityType: "outpatient_clinic", title: "Tuesday Clinic", state: "planned",
    locationId: "L1", locationName: "Mulago",
  };
  const cancelledBlock = { ...clinicBlock, state: "cancelled", title: "Called-off Clinic" };
  const openSession = {
    slotKind: "clinic", status: "OPEN", locationId: "L1", locationName: "Mulago",
    blocked: false, available: 4, note: null,
  };
  const ungenerated = { ...openSession, available: null };
  const blockedSession = { ...openSession, status: "BLOCKED", blocked: true, available: 0 };

  const f = (over: Partial<PlannerFilters>): PlannerFilters => ({ ...NO_PLANNER_FILTERS, ...over });

  ok("2d-control. with no filters, everything passes -- so every refusal below is the FILTER's doing",
    appointmentPasses(NO_PLANNER_FILTERS, walkIn) && appointmentPasses(NO_PLANNER_FILTERS, cancelled)
    && activityPasses(NO_PLANNER_FILTERS, clinicBlock) && sessionPasses(NO_PLANNER_FILTERS, ungenerated)
    && !plannerFiltersActive(NO_PLANNER_FILTERS));
  ok("2e. Show: Walk-ins keeps a walk-in and drops a follow-up, an activity and a session",
    appointmentPasses(f({ show: "walk_ins" }), walkIn)
    && !appointmentPasses(f({ show: "walk_ins" }), followUp)
    && !activityPasses(f({ show: "walk_ins" }), clinicBlock)
    && !sessionPasses(f({ show: "walk_ins" }), openSession));
  ok("2f. Show: Follow-ups is the mirror of it",
    appointmentPasses(f({ show: "follow_ups" }), followUp)
    && !appointmentPasses(f({ show: "follow_ups" }), walkIn));
  ok("2g. Show: Cancelled keeps voided bookings and cancelled blocks, and NOTHING live",
    appointmentPasses(f({ show: "cancelled" }), cancelled)
    && !appointmentPasses(f({ show: "cancelled" }), followUp)
    && activityPasses(f({ show: "cancelled" }), cancelledBlock)
    && !activityPasses(f({ show: "cancelled" }), clinicBlock));
  ok("2h. Show: Appointments drops the cancelled ones -- a void booking is not an appointment",
    appointmentPasses(f({ show: "appointments" }), walkIn)
    && !appointmentPasses(f({ show: "appointments" }), cancelled));
  ok("2i. ⚠ Show: Available time drops a session whose free count is UNKNOWN, not only a full one",
    sessionPasses(f({ show: "available" }), openSession)
    && !sessionPasses(f({ show: "available" }), ungenerated)
    && !sessionPasses(f({ show: "available" }), { ...openSession, available: 0 })
    && !sessionPasses(f({ show: "available" }), blockedSession));
  ok("2j. Show: Blocked time keeps only the blocked session",
    sessionPasses(f({ show: "blocked" }), blockedSession)
    && !sessionPasses(f({ show: "blocked" }), openSession));
  ok("2k. Location narrows every kind of thing on the day",
    appointmentPasses(f({ locationId: "L1" }), walkIn)
    && !appointmentPasses(f({ locationId: "L1" }), followUp)
    && activityPasses(f({ locationId: "L1" }), clinicBlock)
    && !activityPasses(f({ locationId: "L2" }), clinicBlock)
    && sessionPasses(f({ locationId: "L1" }), openSession));
  ok("2l. Appointment type and Status narrow bookings",
    appointmentPasses(f({ appointmentType: "walk_in" }), walkIn)
    && !appointmentPasses(f({ appointmentType: "walk_in" }), followUp)
    && appointmentPasses(f({ status: "CANCELLED" }), cancelled)
    && !appointmentPasses(f({ status: "CANCELLED" }), followUp));
  ok("2m. Activity type narrows blocks",
    activityPasses(f({ activityType: "outpatient_clinic" }), clinicBlock)
    && !activityPasses(f({ activityType: "theatre" }), clinicBlock));
  ok("2n. the free-text search matches a patient name and a location, case-insensitively",
    appointmentPasses(f({ query: "achen" }), walkIn)
    && appointmentPasses(f({ query: "MULAGO" }), walkIn)
    && !appointmentPasses(f({ query: "zzz" }), walkIn)
    && activityPasses(f({ query: "tuesday" }), clinicBlock));
  ok("2o. and any of them counts as 'filters are active', so a screen can offer to clear them",
    plannerFiltersActive(f({ show: "walk_ins" })) && plannerFiltersActive(f({ query: "a" }))
    && plannerFiltersActive(f({ locationId: "L1" })));

  // ══ 3. THE ENGINE, OVER REAL ROWS. ═══════════════════════════════════════════════════════════════

  const probe = await admin.from("practice_availability_slot").select("id, slot_kind").limit(1);
  ok("3-control. migration 227/230's availability columns are present", !probe.error,
    probe.error?.message ?? "");

  await cleanup();
  const ws = await provision();
  const ctx = ctxFor(ws);

  const today = (await todaysPlan(admin, ctx)).date;
  const minutes = await defaultAppointmentMinutes(admin, ws);
  ok("3-control-b. the practice's configured appointment length is 20 minutes, which every count below "
    + "is hand-checked against", minutes === 20, String(minutes));

  const { data: l1 } = await admin.from("practice_location").insert({
    workspace_id: ws, name: "Mulago Hospital", type: "hospital", active: true, travel_buffer_minutes: 0,
  }).select("id").single();
  const { data: l2 } = await admin.from("practice_location").insert({
    workspace_id: ws, name: "TMR International Hospital", type: "hospital", active: true,
    travel_buffer_minutes: 30,
  }).select("id").single();
  const L1 = l1!.id as string, L2 = l2!.id as string;

  // A month entirely in the future, so nothing here depends on the day the harness runs and nothing
  // collides with today's fixtures further down.
  const anchorMonth = `${addDaysIso(today, 60).slice(0, 7)}-01`;
  const month = plannerPeriod("month", anchorMonth);

  // ---- THE PROGRAM: a weekly Saturday session, a FORTNIGHTLY Saturday session, and a Tuesday one ----
  const firstSaturday = (() => {
    let d = month.focusFromDate;
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = addDaysIso(d, 1);
    return d;
  })();

  const tmpl = async (row: Record<string, unknown>) =>
    admin.from("practice_availability_template").insert({ workspace_id: ws, ...row }).select("id").single();

  const weeklySat = await tmpl({
    location_id: L1, weekday: 6, starts_minute: 900, ends_minute: 1020, slot_kind: "clinic",
    note: "Weekly Saturday", status: "active", active: true,
  });
  const tuesday = await tmpl({
    location_id: L1, weekday: 2, starts_minute: 540, ends_minute: 780, slot_kind: "clinic",
    note: "Tuesday clinic", status: "active", active: true,
  });
  ok("3-setup. the regular week has a weekly Saturday and a Tuesday session",
    !weeklySat.error && !tuesday.error, (weeklySat.error ?? tuesday.error)?.message ?? "");

  // ⚠ MIGRATION 274 IS APPLIED BY HAND, so the fortnightly fixture is probed rather than assumed. The
  // rest of the harness runs either way; only the recurrence assertions need it.
  const fortnightly = await tmpl({
    location_id: L2, weekday: 6, starts_minute: 540, ends_minute: 780, slot_kind: "clinic",
    note: "Alternate Saturdays at TMR", status: "active", active: true,
    recurrence_weeks: 2, recurrence_anchor_date: firstSaturday,
  });
  const hasRecurrence = !fortnightly.error;

  const monthRange = await plannerForPeriod(admin, ctx, month);
  ok("3a. the month read returns one entry per day of the grid, in order and with no gaps",
    monthRange.days.length === daysBetweenIso(month.fromDate, month.toDate)
    && monthRange.days.every((d, i) => d.date === addDaysIso(month.fromDate, i))
    && !monthRange.unavailable,
    `${monthRange.days.length} days, ${monthRange.detail ?? "no detail"}`);

  // ---- ⚠ RECURRENCE ACROSS A MONTH AND AN AGENDA. The reason this harness exists. ----
  if (!hasRecurrence) {
    pend("3b..3e", `migration 274 is not applied (${fortnightly.error?.message}) -- recurrence assertions skipped`);
  } else {
    const FORT = fortnightly.data!.id as string;
    const WEEK = weeklySat.data!.id as string;

    // ⚠ THE DATES COME OUT OF recurrence.ts, NOT OUT OF THIS FILE. occurrencesBetween is the same
    // function the slot generator uses, so this compares the planner against the diary's own rule
    // rather than against a second opinion written here.
    const allSaturdays = occurrencesBetween(month.fromDate, month.toDate, 6, { everyWeeks: 1, anchorDate: null });
    const onWeeks = occurrencesBetween(month.fromDate, month.toDate, 6, { everyWeeks: 2, anchorDate: firstSaturday });
    const offWeeks = allSaturdays.filter(d => !onWeeks.includes(d));

    // ⚠ COUNT CONTROL FIRST. "It is not drawn on the off weeks" is trivially true when there are no off
    // weeks -- which is exactly how a booking harness in this repo once "proved" that booking removes a
    // time by observing that a time never on the list was still not on it.
    ok("3b-control. the month really does contain several Saturdays, and several OFF weeks",
      allSaturdays.length >= 4 && onWeeks.length >= 2 && offWeeks.length >= 2
      && onWeeks.length < allSaturdays.length,
      `${allSaturdays.length} Saturdays, ${onWeeks.length} on, ${offWeeks.length} off`);

    const drawn = (id: string) => monthRange.days
      .filter(d => d.templateSessions.some(t => t.id === id)).map(d => d.date);
    ok("3b. ⚠ MONTH: the fortnightly clinic is drawn on its ON weeks and on NO off week",
      drawn(FORT).join(",") === onWeeks.join(","),
      `drawn ${drawn(FORT).join(",")} / expected ${onWeeks.join(",")}`);
    ok("3c-control. and the WEEKLY Saturday session IS on every Saturday, so 3b is not passing because "
      + "Saturdays are missing from the month altogether",
      drawn(WEEK).join(",") === allSaturdays.join(","),
      `drawn ${drawn(WEEK).join(",")} / expected ${allSaturdays.join(",")}`);

    const agendaPeriod = plannerPeriod("agenda", month.focusFromDate,
      { from: month.focusFromDate, to: addDaysIso(month.focusFromDate, 55) });
    const agenda = await plannerForPeriod(admin, ctx, agendaPeriod);
    const agendaAll = occurrencesBetween(agendaPeriod.fromDate, agendaPeriod.toDate, 6, { everyWeeks: 1, anchorDate: null });
    const agendaOn = occurrencesBetween(agendaPeriod.fromDate, agendaPeriod.toDate, 6, { everyWeeks: 2, anchorDate: firstSaturday });
    const agendaDrawn = agenda.days.filter(d => d.templateSessions.some(t => t.id === FORT)).map(d => d.date);
    ok("3d-control. the 56-day agenda holds at least eight Saturdays and skips at least four",
      agendaAll.length >= 8 && agendaAll.length - agendaOn.length >= 4,
      `${agendaAll.length} Saturdays, ${agendaOn.length} on`);
    ok("3d. ⚠ AGENDA: the same, over an arbitrary period -- one filter, all four views",
      agendaDrawn.join(",") === agendaOn.join(","),
      `drawn ${agendaDrawn.length} / expected ${agendaOn.length}`);
    ok("3e. and a DAY read of one off-week Saturday shows the weekly session and not the fortnightly one",
      await (async () => {
        const off = offWeeks[0];
        const one = await plannerRange(admin, ctx, { fromDate: off, toDate: off });
        return one.days.length === 1
          && one.days[0].templateSessions.some(t => t.id === WEEK)
          && !one.days[0].templateSessions.some(t => t.id === FORT);
      })(), offWeeks[0]);
  }

  // ---- CAPACITY: booked and free, over a real slot and real appointments ----
  //
  //   A generated clinic slot 09:00-13:00 at Mulago = 240 minutes = 12 appointments of 20.
  //   09:00 CONFIRMED, 09:40 COMPLETED, 10:00 CANCELLED.
  //   booked 2 (the cancelled one is not a booking), free 10 (the cancelled one does not consume).
  const capDate = (() => {
    let d = month.focusFromDate;
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 2) d = addDaysIso(d, 1);   // a Tuesday
    return d;
  })();

  const { data: slot, error: slotErr } = await admin.from("practice_availability_slot").insert({
    workspace_id: ws, location_id: L1, slot_kind: "clinic", status: "OPEN",
    starts_at: instantAt(capDate, 540), ends_at: instantAt(capDate, 780),
    generated_from_template_id: tuesday.data!.id,
  }).select("id").single();
  const { error: blockedErr } = await admin.from("practice_availability_slot").insert({
    workspace_id: ws, location_id: L1, slot_kind: "clinic", status: "BLOCKED",
    starts_at: instantAt(capDate, 840), ends_at: instantAt(capDate, 900),
  });
  const appt = async (minute: number, status: string, type: string, name: string) =>
    admin.from("practice_appointment").insert({
      workspace_id: ws, location_id: L1, slot_id: slot!.id, patient_name: name,
      appointment_type: type, scheduled_at: instantAt(capDate, minute), duration_minutes: 20, status,
    }).select("id").single();
  const a1 = await appt(540, "CONFIRMED", "new_consultation", "Achen Grace");
  const a2 = await appt(580, "COMPLETED", "scheduled_followup", "Okello John");
  const a3 = await appt(600, "CANCELLED", "walk_in", "Nabirye Sarah");
  ok("3f-setup. the fixture session and its three bookings were written",
    !slotErr && !blockedErr && !a1.error && !a2.error && !a3.error,
    (slotErr ?? blockedErr ?? a1.error ?? a2.error ?? a3.error)?.message ?? "");

  const capRange = await plannerRange(admin, ctx, { fromDate: capDate, toDate: capDate });
  const capDay = capRange.days[0];
  const capSession = capDay.sessions.find(s => s.id === slot!.id);
  ok("3f. the generated session is on the day, at the practice's own clock",
    !!capSession && capSession.startMinute === 540 && capSession.endMinute === 780
    && capSession.source === "generated" && capSession.locationName === "Mulago Hospital",
    JSON.stringify(capSession && [capSession.startMinute, capSession.endMinute, capSession.source]));
  ok("3g. ⚠ 240 minutes of 20 is TWELVE slots, TWO booked and TEN free",
    !!capSession && capSession.capacity.slots === 12 && capSession.capacity.booked === 2
    && capSession.capacity.available === 10,
    JSON.stringify(capSession?.capacity));
  ok("3h. ⚠ a COMPLETED appointment counts as booked and consumes its time -- a clinic that saw twelve "
    + "patients yesterday must not read '12 booked, 12 free'",
    !!capSession && capSession.appointmentIds.length === 2
    && capDay.appointments.filter(a => !a.voided).map(a => a.status).sort().join(",") === "COMPLETED,CONFIRMED",
    capDay.appointments.map(a => `${a.status}:${a.voided}`).join(" "));
  ok("3i. ⚠ and a CANCELLED one is SHOWN but neither booked nor consuming",
    capDay.appointments.some(a => a.status === "CANCELLED" && a.voided)
    && !capSession!.appointmentIds.includes(a3.data!.id as string),
    JSON.stringify(capSession?.appointmentIds));
  ok("3j. ⚠ every figure is the length of a list you can open: the ids behind `booked` are on the day",
    !!capSession && capSession.appointmentIds.length === capSession.capacity.booked
    && capSession.appointmentIds.every(id => capDay.appointments.some(a => a.id === id)),
    JSON.stringify(capSession?.appointmentIds));

  const blockedSess = capDay.sessions.find(s => s.status === "BLOCKED");
  ok("3k. a BLOCKED session is blocked, offers nought and is not free time",
    !!blockedSess && blockedSess.capacity.blocked && blockedSess.capacity.available === 0,
    JSON.stringify(blockedSess?.capacity));

  // ---- ⚠ A PROGRAM SESSION WITH NO GENERATED TIMES: null, not nought ----
  const satDate = firstSaturday;
  const satRange = await plannerRange(admin, ctx, { fromDate: satDate, toDate: satDate });
  const satDay = satRange.days[0];
  const programSession = satDay.sessions.find(s => s.source === "program");
  ok("3l-control. that Saturday really does carry a program session, so 3l is not asserting over nothing",
    satDay.sessions.length > 0 && !!programSession, JSON.stringify(satDay.sessions.map(s => s.source)));
  ok("3l. ⚠ a session with no generated times reports free as NULL with a reason, never as nought -- "
    + "'0 free' reads as a full clinic",
    !!programSession && programSession.capacity.available === null
    && programSession.capacity.slots === null
    && (programSession.capacity.availableUnknownReason ?? "").length > 0,
    JSON.stringify(programSession?.capacity));
  ok("3m-control. and the generated one DOES carry a number, so 3l is a property of the session and "
    + "not of the engine",
    capSession!.capacity.available !== null && capSession!.capacity.slots !== null);
  ok("3m. the day's capacity rolls the sessions up and names how many could not be counted",
    !!satDay.capacity && satDay.capacity.sessionsNotGenerated === satDay.sessions.length
    && satDay.capacity.available === null
    && capDay.capacity!.available === 10 && capDay.capacity!.booked === 2,
    JSON.stringify([satDay.capacity, capDay.capacity]));

  // ---- s6's DAY OFF: distinct, and not a record ----
  const offDate = (() => {
    let d = month.focusFromDate;
    // A weekday the program says nothing about: not Tuesday (2) and not Saturday (6).
    while ([2, 6].includes(((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1)) d = addDaysIso(d, 1);
    return d;
  })();
  const offRange = await plannerRange(admin, ctx, { fromDate: offDate, toDate: offDate });
  ok("3n. a day the program does not cover is a DAY OFF: a flag, with no session and no record",
    offRange.days[0].dayOff && !offRange.days[0].hasProgram
    && offRange.days[0].sessions.length === 0 && offRange.days[0].capacity === null,
    JSON.stringify([offRange.days[0].dayOff, offRange.days[0].sessions.length]));
  ok("3n-control. and a day the program DOES cover is not one",
    !capDay.dayOff && capDay.hasProgram, JSON.stringify([capDay.dayOff, capDay.hasProgram]));

  // ---- s7's CONFLICT STATE: an override on top of existing appointments ----
  const { error: exErr } = await admin.from("practice_availability_exception").insert({
    workspace_id: ws, location_id: L1, kind: "leave", from_date: capDate, to_date: capDate,
    reason: "Conference",
  });
  const { error: exEmptyErr } = await admin.from("practice_availability_exception").insert({
    workspace_id: ws, location_id: L1, kind: "leave", from_date: offDate, to_date: offDate,
    reason: "Nothing booked that day",
  });
  ok("3o-setup. two leave overrides were written -- one over a booked day, one over an empty one",
    !exErr && !exEmptyErr, (exErr ?? exEmptyErr)?.message ?? "");

  const conflicted = await plannerRange(admin, ctx, { fromDate: capDate, toDate: capDate });
  const override = conflicted.days[0].conflicts.find(c => c.code === "SCHEDULE_OVERRIDE_CONFLICT");
  ok("3o. ⚠ s7's conflict state: leave over a day with patients booked is REPORTED, naming them",
    !!override && (override.appointmentIds ?? []).length === 2
    && (override.appointmentIds ?? []).includes(a1.data!.id as string),
    JSON.stringify(override));
  const quiet = await plannerRange(admin, ctx, { fromDate: offDate, toDate: offDate });
  ok("3o-control. and the SAME override over a day with nobody booked raises nothing -- so 3o is about "
    + "the patients and not about the override",
    !quiet.days[0].conflicts.some(c => c.code === "SCHEDULE_OVERRIDE_CONFLICT"),
    JSON.stringify(quiet.days[0].conflicts));
  ok("3o-b. nothing was moved: the appointments are still there, still booked",
    conflicted.days[0].appointments.filter(a => !a.voided).length === 2,
    JSON.stringify(conflicted.days[0].appointments.map(a => a.status)));

  // ---- ⚠ THE PRACTICE'S OWN DAY, NOT UTC'S ----
  //
  // Kampala is UTC+3. An appointment at 22:00Z belongs to the NEXT calendar day there, at 01:00. Sliced
  // by UTC it lands a day early -- the exact bug CPR-300 found on the operations home.
  const tzDate = addDaysIso(capDate, 3);
  const { error: tzErr } = await admin.from("practice_appointment").insert({
    workspace_id: ws, location_id: L1, patient_name: "Midnight Patient",
    appointment_type: "emergency", scheduled_at: `${addDaysIso(tzDate, -1)}T22:00:00.000Z`,
    duration_minutes: 30, status: "CONFIRMED",
  });
  const tzRange = await plannerRange(admin, ctx, { fromDate: addDaysIso(tzDate, -1), toDate: tzDate });
  const early = tzRange.days.find(d => d.date === addDaysIso(tzDate, -1));
  const late = tzRange.days.find(d => d.date === tzDate);
  ok("3p. ⚠ a 22:00Z booking is on the NEXT day at 01:00 in Kampala, not on the previous one",
    !tzErr && !!late && !!early
    && late.appointments.some(a => a.patientName === "Midnight Patient" && a.startMinute === 60)
    && !early.appointments.some(a => a.patientName === "Midnight Patient"),
    JSON.stringify([tzErr?.message, late?.appointments.map(a => [a.patientName, a.startMinute])]));

  // ---- ⚠ ONE COMPUTATION. plannerWeek IS plannerRange over seven days. ----
  const weekOf = weekStartDate(capDate);
  const viaWeek = await plannerWeek(admin, ctx, { date: capDate });
  const viaRange = await plannerRange(admin, ctx, { fromDate: weekOf, toDate: addDaysIso(weekOf, 6) });
  ok("3q. ⚠ s8: the Week view and the range engine return the SAME DAYS -- there is one computation, "
    + "not one per surface",
    viaWeek.days.length === 7
    && JSON.stringify(viaWeek.days) === JSON.stringify(viaRange.days),
    `${viaWeek.days.length} vs ${viaRange.days.length}`);
  const viaMonth = await plannerForPeriod(admin, ctx, plannerPeriod("month", capDate));
  const monthDay = viaMonth.days.find(d => d.date === capDate);
  ok("3q-b. and the Month view's cell for that day is the same day again -- the counts a month cell "
    + "shows are the length of the list the day view opens",
    JSON.stringify(monthDay) === JSON.stringify(viaWeek.days.find(d => d.date === capDate)),
    capDate);

  // ---- THE RANGE CAP, NAMED RATHER THAN SILENT ----
  const long = await plannerRange(admin, ctx, { fromDate: capDate, toDate: addDaysIso(capDate, 400) });
  ok("3r. a period longer than the cap is CUT AND SAID SO, never silently trimmed",
    long.rangeCapped && long.days.length === RANGE_DAY_CAP
    && long.toDate === addDaysIso(capDate, RANGE_DAY_CAP - 1),
    JSON.stringify([long.rangeCapped, long.days.length]));
  ok("3r-control. and an ordinary period is not flagged", !capRange.rangeCapped);

  // ---- ⚠ AN UNREADABLE PERIOD IS UNAVAILABLE, NEVER EMPTY ----
  //
  // Injected on practice_appointment specifically, because that is the read whose silent loss is most
  // dangerous: a period drawn from activities alone looks like a week with nothing booked into it, which
  // is what a practitioner checks before agreeing to be somewhere else.
  const blind = await plannerRange(brokenOn("practice_appointment"), ctx,
    { fromDate: capDate, toDate: addDaysIso(capDate, 6) });
  ok("3s. ⚠ a period whose APPOINTMENTS could not be read is unavailable, with the database's own words",
    blind.unavailable && blind.detail === "relation does not exist" && blind.workload === null,
    JSON.stringify([blind.unavailable, blind.detail]));
  ok("3t. ⚠ and every day of it is flagged unreadable rather than confidently empty -- and NOT a day off",
    blind.days.length === 7
    && blind.days.every(d => d.unavailable && d.workload === null && d.capacity === null && !d.dayOff),
    JSON.stringify(blind.days.map(d => [d.unavailable, d.dayOff])));
  ok("3t-control. the SAME period through the real client is available, so 3s is not passing on nothing",
    !viaWeek.unavailable && viaWeek.workload !== null);
  ok("3u. ⚠ a period nobody could count reports free as NULL, never as nought",
    blind.workload === null
    && (await plannerRange(admin, ctx, { fromDate: offDate, toDate: offDate })).workload!.availableCount === null,
    JSON.stringify(blind.workload));
  ok("3u-control. and a period that COULD be counted reports the number",
    capRange.workload!.availableCount === 10 && capRange.workload!.appointmentCount === 2,
    JSON.stringify([capRange.workload!.availableCount, capRange.workload!.appointmentCount]));

  // ---- TENANCY ----
  //
  // ⚠ A SECOND PROVISIONED PRACTICE IS NOT USED, and the reason is a harness one: the fixture owner is
  // pinned to a single uuid so concurrent harnesses cannot purge each other, and provisioning gives one
  // individual practice per owner. So the second tenant is a `managed_practice` row under the same
  // owner -- a real workspace with a real id, which is what the scoping is actually against.
  const { data: other } = await admin.from("practice_workspace").insert({
    type: "managed_practice", name: "Another Practice", owner_person_id: OWNER, status: "ACTIVE",
    country: "UG", timezone: TZ,
  }).select("id").single();
  const otherCtx = ctxFor(other!.id as string);
  const otherRange = await plannerRange(admin, otherCtx, { fromDate: capDate, toDate: capDate });
  ok("3v. another practice's planner holds NONE of this one's sessions, appointments or activities",
    !otherRange.unavailable && otherRange.days[0].appointments.length === 0
    && otherRange.days[0].sessions.length === 0 && otherRange.days[0].activities.length === 0,
    JSON.stringify(otherRange.days[0].appointments.length));
  ok("3v-control. while this one's does, so 3v is not passing because the date is empty",
    capDay.appointments.length === 3 && capDay.sessions.length === 2,
    `${capDay.appointments.length} appointments, ${capDay.sessions.length} sessions`);

  // ---- s4's Show, applied to a REAL day through the SAME predicates the screen uses ----
  const walkInApp = await admin.from("practice_appointment").insert({
    workspace_id: ws, location_id: L1, patient_name: "Walk In Wilson", appointment_type: "walk_in",
    scheduled_at: instantAt(capDate, 660), duration_minutes: 20, status: "ARRIVED",
  }).select("id").single();
  await planActivity(admin, ctx, {
    activityType: "teaching", title: "Registrar teaching", planDate: capDate,
    plannedStartMinute: 960, plannedEndMinute: 1020, locationId: L1,
  }, { source: "system" });
  const filtered = await plannerRange(admin, ctx, { fromDate: capDate, toDate: capDate });
  const fd = filtered.days[0];
  ok("3w-control. the day now holds appointments, sessions AND an activity, so every filter below has "
    + "something to remove",
    !walkInApp.error && fd.appointments.length === 4 && fd.sessions.length === 2
    && fd.activities.length === 1,
    `${fd.appointments.length} / ${fd.sessions.length} / ${fd.activities.length}`);
  const shownWalkIns = filterDay(fd, f({ show: "walk_ins" }));
  ok("3w. Show: Walk-ins leaves one booking and nothing else, and SAYS how much it hid",
    shownWalkIns.appointments.length === 1
    && shownWalkIns.appointments[0].patientName === "Walk In Wilson"
    && shownWalkIns.activities.length === 0 && shownWalkIns.sessions.length === 0
    && shownWalkIns.hidden === 6,
    JSON.stringify([shownWalkIns.appointments.length, shownWalkIns.hidden]));
  const shownAll = filterDay(fd, NO_PLANNER_FILTERS);
  ok("3w-control-b. and with no filter nothing is hidden",
    shownAll.hidden === 0 && shownAll.appointments.length === 4);
  const shownLocation = filterDay(fd, f({ locationId: L2 }));
  ok("3x. ⚠ FILTERING CHANGES WHAT IS DRAWN AND NOT WHICH DAYS WERE READ -- s2's frozen principle",
    shownLocation.appointments.length === 0 && filtered.days.length === 1
    && filtered.fromDate === capDate && filtered.toDate === capDate,
    JSON.stringify([shownLocation.appointments.length, filtered.fromDate]));

  // ══ 4. s4's SEARCH ═══════════════════════════════════════════════════════════════════════════════
  //
  // "Searching for a future patient must return the appointment date, time, location and session with a
  // direct 'View appointment' / 'Go to date' action. The user should not have to navigate week-by-week."

  const past = addDaysIso(today, -30);
  await admin.from("practice_appointment").insert({
    workspace_id: ws, location_id: L2, patient_name: "Achen Grace",
    appointment_type: "scheduled_followup", scheduled_at: instantAt(past, 600),
    duration_minutes: 20, status: "COMPLETED",
  });

  const found = await scheduleSearch(admin, ctx, "Achen");
  ok("4a-control. the search ran and found something", !found.unavailable && found.hits.length >= 2,
    `${found.hits.length} hits, ${found.detail ?? ""}`);
  const futureHit = found.hits.find(h => h.date === capDate);
  ok("4a. it returns the DATE, TIME, LOCATION and SESSION s4 asks for, plus somewhere to go",
    !!futureHit && futureHit.startMinute === 540 && futureHit.locationName === "Mulago Hospital"
    && (futureHit.sessionLabel ?? "").startsWith("Clinic 09:00")
    && futureHit.goToDate === capDate
    // Booked as a name with no patient record, so there is nothing to open -- and the payload says so
    // with a null rather than a link that would 404.
    && futureHit.href === null,
    JSON.stringify(futureHit));
  ok("4b. ⚠ and it finds a booking OUTSIDE the week on screen -- the whole point of the requirement",
    !!futureHit && futureHit.date > addDaysIso(weekStartDate(today), 6),
    `${futureHit?.date} vs week ending ${addDaysIso(weekStartDate(today), 6)}`);
  ok("4c. the future one comes before the past one, because 'when are they next in' is the question",
    found.hits.findIndex(h => !h.past) < found.hits.findIndex(h => h.past)
    && found.hits.some(h => h.past), found.hits.map(h => `${h.date}${h.past ? "(past)" : ""}`).join(" "));
  ok("4d. an activity is searchable by its title too",
    (await scheduleSearch(admin, ctx, "Registrar")).hits.some(h => h.kind === "activity"),
    JSON.stringify((await scheduleSearch(admin, ctx, "Registrar")).hits.map(h => h.kind)));

  const wild = await scheduleSearch(admin, ctx, "%%");
  ok("4e. ⚠ a query of wildcards matches NOTHING rather than everything",
    !wild.unavailable && wild.hits.length === 0, JSON.stringify(wild.hits.length));
  ok("4e-control. while a real two-letter fragment of the same name does match",
    (await scheduleSearch(admin, ctx, "Ach")).hits.length > 0);

  const blindSearch = await scheduleSearch(brokenOn("practice_appointment"), ctx, "Achen");
  ok("4f. ⚠ a search that could not run says UNAVAILABLE -- it is never reported as 'no results', "
    + "which is how a practitioner comes to cancel a clinic that was going ahead",
    blindSearch.unavailable && blindSearch.hits.length === 0 && blindSearch.detail !== null,
    JSON.stringify([blindSearch.unavailable, blindSearch.detail]));
  const noCapSearch = await scheduleSearch(admin, ctxFor(ws, ["appointment.manage"]), "Achen");
  // ⚠ THE CODE IT NAMES MUST BE A REAL ONE. A capability code is a string compared against
  // practice_role_capabilities; an invented one compiles perfectly and 403s every user including the
  // owner, and five have shipped in this product. Checked against the ENGINE's own exported list rather
  // than a code re-typed here, which could invent the same fiction and agree with it for ever.
  ok("4g. a caller who cannot read the planner is refused, and told which REAL capability is missing",
    noCapSearch.unavailable && noCapSearch.hits.length === 0
    && PLANNER_CAPABILITIES.some(c => (noCapSearch.detail ?? "").includes(c)),
    JSON.stringify(noCapSearch.detail));
  const { data: realCaps } = await admin.from("practice_role_capabilities")
    .select("capability_code").in("capability_code", PLANNER_CAPABILITIES);
  ok("4g-control. and those codes exist in practice_role_capabilities",
    new Set(((realCaps ?? []) as { capability_code: string }[]).map(c => c.capability_code)).size
      === PLANNER_CAPABILITIES.length,
    JSON.stringify(realCaps));
  const otherSearch = await scheduleSearch(admin, otherCtx, "Achen");
  ok("4h. another practice searching the same name finds nothing",
    !otherSearch.unavailable && otherSearch.hits.length === 0, JSON.stringify(otherSearch.hits.length));

  // ══ 5. THE PRACTICE OWNER'S ADDITION ═════════════════════════════════════════════════════════════
  //
  //   "Make the calendar selectable i.e. I should be able to select any day of the week or month or year
  //    and it be able to see what was booked for the day AND WHAT HAPPENED ON THAT DAY. This feature
  //    would be good to have on all screens where there is a possibility of reviewing the data."
  //
  // Three things: a period control that is not the planner's private property, a YEAR that actually
  // works, and a past day that answers what happened WITHOUT INVENTING IT.

  // ---- 5A. THE SHARED MODULE IS SHARED, AND IT IMPORTS NOTHING ----
  const periodSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "period-range.ts"), "utf8");
  const periodImports = stripComments(periodSrc).split("\n")
    .filter(l => /^\s*import\s/.test(l) || /\brequire\(/.test(l));
  ok("5A-a. ⚠ period-range.ts imports NOTHING, so any client component on any screen can use it",
    periodImports.length === 0, periodImports.join(" | "));
  ok("5A-a-control. and it is the real module -- it exports the resolver and the views, so 5A-a is not "
    + "passing on an empty file",
    /export function resolvePeriod\(/.test(periodSrc) && /export const PERIOD_VIEWS/.test(periodSrc));

  const navSrc = stripComments(readFileSync(
    join(process.cwd(), "src", "components", "practice", "PeriodNavigator.tsx"), "utf8"));
  const navPracticeImports = [...navSrc.matchAll(/from\s+["'](@\/lib\/practice\/[^"']+)["']/g)]
    .map(m => m[1]);
  ok("5A-b-control. the shared control really does import from the practice library",
    navPracticeImports.length >= 1, navPracticeImports.join(", "));
  ok("5A-b. ⚠ and period-range is the ONLY practice module it touches -- a control mounted on six "
    + "screens must not drag a server engine into six bundles",
    navPracticeImports.every(i => i === "@/lib/practice/period-range"), navPracticeImports.join(", "));
  ok("5A-c. the planner's own navigator is an ADAPTER over it, not a second control",
    /from\s+["']@\/components\/practice\/PeriodNavigator["']/.test(stripComments(readFileSync(
      join(process.cwd(), "src", "app", "practice", "(shell)", "calendar", "PlannerNavigator.tsx"), "utf8"))));

  // ---- 5B. A YEAR ----
  const yearTarget = quickPeriodTarget("this_year", "2026-08-05");
  const yearPeriod = plannerPeriod(yearTarget.view, yearTarget.anchorDate,
    { from: yearTarget.from, to: yearTarget.to });
  ok("5B-a. 'This year' is 1 January to 31 December, as an agenda",
    yearPeriod.fromDate === "2026-01-01" && yearPeriod.toDate === "2026-12-31"
    && yearPeriod.view === "agenda", JSON.stringify(yearPeriod));
  ok("5B-b. and it reads as the year rather than as two dates",
    plannerPeriodLabel(yearPeriod) === "2026", plannerPeriodLabel(yearPeriod));
  ok("5B-c. ⚠ a LEAP year is 366 days and is NOT capped -- the cap admits a whole year because the "
    + "owner asked for one",
    daysBetweenIso("2028-01-01", "2028-12-31") === 366 && RANGE_DAY_CAP >= 366,
    `${daysBetweenIso("2028-01-01", "2028-12-31")} days, cap ${RANGE_DAY_CAP}`);
  const wholeYear = await plannerRange(admin, ctx, { fromDate: "2028-01-01", toDate: "2028-12-31" });
  ok("5B-d. and a whole leap year really is read, day by day, without being cut",
    wholeYear.days.length === 366 && !wholeYear.rangeCapped && !wholeYear.unavailable,
    `${wholeYear.days.length} days, capped=${wholeYear.rangeCapped}, ${wholeYear.detail ?? ""}`);
  ok("5B-e. shifting a year-long agenda moves it by a YEAR, not by a month",
    shiftPlannerPeriod(yearPeriod, 1).from === "2027-01-01",
    JSON.stringify(shiftPlannerPeriod(yearPeriod, 1)));

  // ---- 5C. WHAT HAPPENED ----
  //
  // ⚠ THE RULE FIRST, AS A PURE FUNCTION, because the eight answers are the whole claim and the last two
  // are the ones that must never be merged.
  const outcome = (o: Partial<Parameters<typeof appointmentOutcome>[0]>) => appointmentOutcome({
    status: "CONFIRMED", date: "2026-01-01", todayDate: "2026-06-01",
    arrived: false, encounterStatus: null, ...o,
  });
  ok("5C-a. a signed or completed encounter means SEEN",
    outcome({ encounterStatus: "SIGNED" }) === "seen"
    && outcome({ encounterStatus: "COMPLETED" }) === "seen");
  ok("5C-b. a live one means the consultation was started and not finished",
    outcome({ encounterStatus: "ACTIVE" }) === "consultation_started"
    && outcome({ encounterStatus: "DRAFT" }) === "consultation_started");
  ok("5C-c. ⚠ COMPLETED with NO encounter is 'marked complete', not 'seen' -- somebody moved the "
    + "booking on and no clinical record was made, and a practice needs to know which it is looking at",
    outcome({ status: "COMPLETED" }) === "marked_complete");
  ok("5C-d. an arrival is an arrival",
    outcome({ arrived: true }) === "arrived" && outcome({ status: "ARRIVED" }) === "arrived");
  ok("5C-e. cancelled and no-show are what somebody recorded",
    outcome({ status: "CANCELLED" }) === "cancelled"
    && outcome({ status: "NO_SHOW" }) === "did_not_attend");
  ok("5C-f. ⚠ A FUTURE BOOKING IS EXPECTED AND A PAST ONE NOBODY TOUCHED IS 'NOTHING RECORDED' -- it is "
    + "NOT a did-not-attend, because nobody said so, and inferring one from the calendar would be a "
    + "clinical claim no human made",
    outcome({ date: "2026-09-01" }) === "expected"
    && outcome({ date: "2026-01-01" }) === "not_recorded",
    `${outcome({ date: "2026-09-01" })} / ${outcome({ date: "2026-01-01" })}`);
  ok("5C-g. every outcome has a label, and 'nothing recorded' says exactly that",
    Object.keys(OUTCOME_LABEL).length === 8
    && OUTCOME_LABEL.not_recorded === "Nothing was recorded"
    && !/did not attend/i.test(OUTCOME_LABEL.not_recorded),
    JSON.stringify(OUTCOME_LABEL.not_recorded));
  ok("5C-h. and the gap is stated on the payload rather than in a document nobody opens",
    WHAT_HAPPENED_LIMITS.length >= 4
    && WHAT_HAPPENED_LIMITS.some(l => /nothing was recorded/i.test(l)),
    String(WHAT_HAPPENED_LIMITS.length));

  // ---- AND THE SAME RULE, THROUGH THE ENGINE, OVER REAL ROWS ON A PAST DAY ----
  const gone = addDaysIso(today, -14);
  const { data: p1 } = await admin.from("practice_patient")
    .insert({ workspace_id: ws, display_name: "Seen Patient" }).select("id").single();
  const { data: p2 } = await admin.from("practice_patient")
    .insert({ workspace_id: ws, display_name: "Started Patient" }).select("id").single();

  const pastAppt = async (minute: number, status: string, name: string, patientId?: string) =>
    admin.from("practice_appointment").insert({
      workspace_id: ws, location_id: L1, patient_name: name, patient_id: patientId ?? null,
      appointment_type: "new_consultation", scheduled_at: instantAt(gone, minute),
      duration_minutes: 20, status,
    }).select("id").single();

  const untouched = await pastAppt(540, "CONFIRMED", "Nobody Wrote Anything");
  const noShow = await pastAppt(560, "NO_SHOW", "Did Not Come");
  const completedOnly = await pastAppt(580, "COMPLETED", "Marked Off");
  const arrivedOnly = await pastAppt(600, "CONFIRMED", "Checked In");
  const seenOne = await pastAppt(620, "CONFIRMED", "Seen Patient", p1!.id as string);
  const startedOne = await pastAppt(640, "CONFIRMED", "Started Patient", p2!.id as string);

  const { error: arrErr } = await admin.from("practice_arrival").insert({
    workspace_id: ws, appointment_id: arrivedOnly.data!.id, status: "ARRIVED",
    arrived_at: instantAt(gone, 592),
  });
  const { error: encErr } = await admin.from("practice_encounter").insert({
    workspace_id: ws, patient_id: p1!.id, appointment_id: seenOne.data!.id, status: "SIGNED",
    started_at: instantAt(gone, 620), completed_at: instantAt(gone, 645), signed_at: instantAt(gone, 646),
  });
  const { error: encErr2 } = await admin.from("practice_encounter").insert({
    workspace_id: ws, patient_id: p2!.id, appointment_id: startedOne.data!.id, status: "ACTIVE",
    started_at: instantAt(gone, 640),
  });
  ok("5C-i-setup. six past bookings, one arrival and two encounters were written",
    !arrErr && !encErr && !encErr2 && !untouched.error && !noShow.error && !completedOnly.error,
    (arrErr ?? encErr ?? encErr2 ?? untouched.error)?.message ?? "");

  const pastDay = (await plannerRange(admin, ctx, { fromDate: gone, toDate: gone })).days[0];
  const outcomeOf = (id: string) => pastDay.appointments.find(a => a.id === id)?.outcome;
  ok("5C-i-control. the past day really does hold those six bookings",
    pastDay.appointments.length === 6 && pastDay.isPast,
    `${pastDay.appointments.length} appointments, isPast=${pastDay.isPast}`);
  ok("5C-i. the engine reads what happened off the recorded facts, one booking at a time",
    outcomeOf(seenOne.data!.id) === "seen"
    && outcomeOf(startedOne.data!.id) === "consultation_started"
    && outcomeOf(arrivedOnly.data!.id) === "arrived"
    && outcomeOf(noShow.data!.id) === "did_not_attend"
    && outcomeOf(completedOnly.data!.id) === "marked_complete",
    pastDay.appointments.map(a => `${a.patientName}:${a.outcome}`).join(" "));
  ok("5C-j. ⚠ and the one nobody touched reads 'nothing was recorded' -- not attended, not missed",
    outcomeOf(untouched.data!.id) === "not_recorded"
    && pastDay.appointments.find(a => a.id === untouched.data!.id)?.outcomeLabel === "Nothing was recorded",
    String(outcomeOf(untouched.data!.id)));
  ok("5C-k. the arrival TIME and the consultation are on the payload, so a screen can link to them",
    pastDay.appointments.find(a => a.id === arrivedOnly.data!.id)?.arrivedMinute === 592
    && (pastDay.appointments.find(a => a.id === seenOne.data!.id)?.encounterHref ?? "")
      .startsWith("/practice/encounters/"),
    JSON.stringify(pastDay.appointments.map(a => [a.arrivedMinute, a.encounterHref])));
  ok("5C-l. the day's summary counts them, and names the gap as its own number",
    !!pastDay.happened && pastDay.happened.seen === 1 && pastDay.happened.consultationStarted === 1
    && pastDay.happened.arrived === 1 && pastDay.happened.didNotAttend === 1
    && pastDay.happened.markedComplete === 1 && pastDay.happened.notRecorded === 1
    && pastDay.happened.isPast,
    JSON.stringify(pastDay.happened));
  const futureDay = (await plannerRange(admin, ctx, { fromDate: capDate, toDate: capDate })).days[0];
  ok("5C-m-control. a FUTURE day's bookings are 'expected' and none of them is 'not recorded' -- so "
    + "5C-j is about the past and not about every booking",
    futureDay.happened!.expected > 0 && futureDay.happened!.notRecorded === 0
    && !futureDay.happened!.isPast,
    JSON.stringify(futureDay.happened));
  const blindHappened = await plannerRange(brokenOn("practice_encounter"), ctx,
    { fromDate: gone, toDate: gone });
  ok("5C-n. ⚠ an unreadable ENCOUNTER read makes the day unavailable rather than reporting six "
    + "bookings nobody wrote up -- a screen accusing a practitioner of not writing up a clinic they did",
    blindHappened.unavailable && blindHappened.days[0].happened === null,
    JSON.stringify([blindHappened.unavailable, blindHappened.days[0].happened]));

  // ══ 5. THE PAYLOAD AND THE BUNDLE ════════════════════════════════════════════════════════════════
  //
  // ⚠ A FUNCTION ON A PAYLOAD PASSED TO A CLIENT COMPONENT KILLS THE PAGE. tsc passes, the API is fine,
  // and the screen is dead. So the payload is WALKED rather than trusted.
  const bad = unserialisablePaths(filtered);
  ok("5a. ⚠ every value the range payload carries into a client component is serialisable",
    bad.length === 0, bad.slice(0, 5).join("; "));
  ok("5a-control. and the walker really does find one when it is there",
    unserialisablePaths({ days: [{ capacity: { note: () => 1 } }] }).length === 1,
    JSON.stringify(unserialisablePaths({ days: [{ capacity: { note: () => 1 } }] })));
  ok("5b. the payload survives the boundary React actually uses",
    JSON.parse(JSON.stringify(filtered)).days[0].sessions.length === fd.sessions.length);

  // ⚠ A "use client" COMPONENT IMPORTING A VALUE FROM planner.ts DRAGS next/headers INTO THE BROWSER.
  // Only `import type` is safe, and the difference is one word.
  //
  // ⚠ THE SCAN IS RESTRICTED TO CLIENT COMPONENTS ON PURPOSE. page.tsx is a SERVER component and imports
  // plannerForPeriod and scheduleSearch as values, which is exactly right -- accusing it would make this
  // assertion something a developer has to work around rather than obey.
  //
  // ⚠ AND THE CLAUSE CANNOT CROSS ANOTHER `from`. The first version of this regex used a lazy `[\s\S]*?`
  // and matched from the FIRST import in the file to the planner one, so every client component was
  // reported as an offender by its own `import Link from "next/link"`. The negative lookahead below
  // anchors the clause to the nearest preceding `import`.
  const dir = join(process.cwd(), "src", "app", "practice", "(shell)", "calendar");
  const files = walk(dir).filter(f => /\.tsx?$/.test(f));
  const clientImporters: string[] = [];
  const valueImporters: string[] = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const code = stripComments(raw);
    const isClient = /^\s*["']use client["']/m.test(code);
    const re = /import\s+((?:(?!\bfrom\b)[\s\S])*?)\s+from\s+["']@\/lib\/practice\/planner["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const short = file.replace(process.cwd() + sep, "");
      const clause = m[1].trim();
      if (!isClient) continue;
      clientImporters.push(short);
      // Safe when the whole clause is `type {...}` or every named specifier is marked `type X`.
      const wholeClauseIsType = clause.startsWith("type ");
      const inner = clause.replace(/^\{|\}$/g, "");
      const everySpecifierIsType = clause.startsWith("{")
        && inner.split(",").map(s => s.trim()).filter(Boolean).every(s => s.startsWith("type "));
      if (!wholeClauseIsType && !everySpecifierIsType)
        valueImporters.push(`${short}: ${clause.slice(0, 60)}`);
    }
  }
  ok("5c-control. the planner's CLIENT components really do import from planner.ts, so 5c is not "
    + "scanning nothing",
    clientImporters.length >= 4,
    `${clientImporters.length} client imports across ${files.length} files`);
  ok("5c. ⚠ and EVERY ONE of them is type-only -- a value import here fails `next build` on pages "
    + "nobody touched, with tsc and eslint both passing",
    valueImporters.length === 0, valueImporters.join(" | "));

  // ⚠ THE ROUTE IS NOT RENAMED. navigation.ts:160 records why -- a URL rename is churn through bookmarks
  // and links to buy a tidiness nobody asked for -- and this specification does not change it.
  const nav = stripComments(readFileSync(join(process.cwd(), "src", "lib", "practice", "navigation.ts"), "utf8"));
  ok("5d. /practice/calendar is still the route, still labelled Practice Planner",
    /href:\s*"\/practice\/calendar"[^}]*label:\s*"Practice Planner"/.test(nav),
    nav.split("\n").filter(l => l.includes("/practice/calendar")).slice(0, 2).join(" | "));

  // ⚠ "WAITING" IS IN s4's STATUS LIST AND IS NOT AN APPOINTMENT STATE. It belongs to the queue. A
  // filter offering it would return nothing for ever, which is the quietest kind of broken control.
  const waiting = await admin.from("practice_appointment").insert({
    workspace_id: ws, patient_name: "Queue Person", scheduled_at: instantAt(capDate, 700),
    status: "WAITING",
  });
  ok("5e. ⚠ the database refuses an appointment status of WAITING, which is why the Status filter does "
    + "not offer it -- it is a queue state, not an appointment one",
    !!waiting.error && waiting.error.code === "23514",
    waiting.error ? `expected 23514, got ${waiting.error.code}` : "the write SUCCEEDED");
  ok("5e-control. and it accepts the six that ARE appointment statuses",
    Object.keys(APPOINTMENT_STATUS_LABEL).length === 6
    && !Object.keys(APPOINTMENT_STATUS_LABEL).includes("WAITING"),
    Object.keys(APPOINTMENT_STATUS_LABEL).join(","));

  // ══ 6. CLEANUP, AND THE ASSERTION THAT IT WORKED ═════════════════════════════════════════════════
  await cleanup();
  const { data: leftWs } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  const { data: leftAppt } = await admin.from("practice_appointment").select("id").eq("workspace_id", ws);
  ok("6a. the fixtures are gone, and that is ASSERTED rather than assumed",
    (leftWs ?? []).length === 0 && (leftAppt ?? []).length === 0,
    `${(leftWs ?? []).length} workspaces, ${(leftAppt ?? []).length} appointments left`);
  ok("6a-control. and `isPlannerDate` still refuses a date that does not exist, so this file's own "
    + "helpers were not what made anything pass",
    !isPlannerDate("2026-02-30") && isPlannerDate("2026-02-28"));

  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(async e => {
  console.error(e);
  try { await cleanup(); } catch { /* the original error is the one worth reporting */ }
  process.exitCode = 1;
});
