/**
 * CPR-V5-007 PHASE 2 -- Changes & Exceptions, and the affected-booking workflow. Migration 242.
 *
 * WHAT IT PROVES:
 *   1. s5.3 STEP 1 -- the affected bookings are the RIGHT bookings, ASSERTED BY ID rather than counted.
 *      The fixture deliberately contains bookings that must NOT be found: a different day, a different
 *      location, a cancelled one, a no-show, a completed one and one outside a narrowed window. A count
 *      assertion would pass against half of them; naming the ids cannot.
 *   2. A FAILED READ IS NEVER A ZERO. With practice_appointment unreadable the preview reports
 *      UNREADABLE, the commit REFUSES, and no exception row is written -- with a control proving the
 *      identical commit succeeds against a working table.
 *   3. AC-04 -- before committing a change the system identifies affected bookings and REQUIRES a
 *      resolution strategy. Five refusals with five different codes, and a control that commits.
 *   4. `keep_pending` IS NOT RESOLVED, in the engine and in the database's own CHECK.
 *   5. `impact_reviewed_at` NULL MEANS NOT REVIEWED, NEVER "nobody was affected" -- the two states are
 *      drawn differently, with a control for each.
 *   6. THE SAME EXCEPTION APPLIED TWICE DOES NOT CREATE TWO ACTION ROWS FOR ONE BOOKING, with a control
 *      proving a booking made afterwards IS picked up.
 *   7. s5.2's three new kinds do something: an emergency interruption removes the day, a location change
 *      MOVES the generated slot, an activity substitution BLOCKS it -- each with a control.
 *   8. Patient names are withheld without patient.view AND THE COUNT IS NOT.
 *   9. Permission and cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-schedule-exception-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { zonedDayRange, dueDateFrom, practiceToday } from "../src/lib/practice/practice-time";
import {
  calculateImpact, commitScheduleChange, resolveAffectedBooking, affectedBookingQueue,
  recalculateImpact, scheduleChanges, impactReadingValue,
  type ScheduleChangeView, type QueuedAction,
} from "../src/lib/practice/schedule-exceptions";
import { addException, generateSlots } from "../src/lib/practice/availability-config";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ec001";
const OTHER = "00000000-0000-4000-8000-0000000ec002";
const TZ = "Africa/Kampala";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-exc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-exc",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-exc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_affected_booking_action").delete().eq("workspace_id", w.id);
      await admin.from("practice_follow_up").delete().eq("workspace_id", w.id);
      await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
      await admin.from("practice_arrival").delete().eq("workspace_id", w.id);
      await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_exception").delete().eq("workspace_id", w.id);
      await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

/**
 * An admin client on which one table cannot be read.
 *
 * ⚠ THE ONLY WAY TO TEST THE FIRST DOCTRINE. "A failed read is never a zero" is a claim about what
 * happens when a query FAILS, and a passing database never produces one -- so an assertion that only
 * ever sees a working table is asserting nothing about the branch it is aimed at.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function adminWithUnreadable(real: any, table: string) {
  const failing = (): any => {
    const p: any = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: any) => resolve({ data: null, error: { message: "simulated read failure" }, count: null });
        return () => p;
      },
    });
    return p;
  };
  return new Proxy(real, {
    get(t: any, prop: string) {
      if (prop === "from") return (name: string) => (name === table ? failing() : t.from(name));
      const v = t[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

const ACT = { actorId: OWNER, correlationId: "harness-exc" };
/** An instant, expressed as a minute of a given date IN THE PRACTICE'S OWN CLOCK. */
const at = (date: string, minute: number) =>
  new Date(Date.parse(zonedDayRange(date, TZ).startIso) + minute * 60000).toISOString();

async function main() {
  console.log("\n=== CPR-V5-007 PHASE 2: CHANGES & EXCEPTIONS (migration 242) ===\n");

  // ---- 0. MIGRATION GATE -------------------------------------------------------------------------
  //
  // ⚠ PROBES COLUMNS MIGRATION 242 ADDS AND KEEPS. A gate here recently probed a column a LATER
  // migration dropped and then reported "run 240" against a database where 240 had run; the fix is to
  // probe the load-bearing shape rather than whichever column happened to be newest.
  const probeTable = await admin.from("practice_affected_booking_action")
    .select("id, exception_id, appointment_id, patient_id, resolution, resolved, decided_at").limit(1);
  const probeCols = await admin.from("practice_availability_exception")
    .select("id, replacement_location_id, replacement_activity_type, impact_reviewed_at, impact_reviewed_by").limit(1);
  if (probeTable.error || probeCols.error) {
    console.error("\n  run 242\n");
    console.error(`  (${probeTable.error?.message ?? probeCols.error?.message})`);
    process.exit(1);
  }
  console.log("  migration 242 is applied.\n");

  await cleanup();

  const wsA = await provision(OWNER, "Dr Exception A", "a");
  const wsB = await provision(OTHER, "Dr Exception B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");
  const A = ctxA.ctx, B = ctxB.ctx;

  const { data: locRows, error: locErr } = await admin.from("practice_location").insert([
    { workspace_id: wsA, name: "TMR International Hospital", type: "hospital", active: true },
    { workspace_id: wsA, name: "Kololo Consulting Rooms", type: "clinic", active: true },
  ]).select("id, name");
  if (locErr || !locRows) throw new Error(`location fixture failed: ${locErr?.message}`);
  const LOC_MAIN = locRows.find(l => l.name.startsWith("TMR"))!.id as string;
  const LOC_OTHER = locRows.find(l => l.name.startsWith("Kololo"))!.id as string;

  const today = practiceToday(TZ);
  const DAY_X = dueDateFrom(today, 14);
  const DAY_Y = dueDateFrom(today, 15);

  const { data: patRow } = await admin.from("practice_patient")
    .insert({ workspace_id: wsA, display_name: "Aisha Nakato" }).select("id").single();
  const PATIENT = patRow!.id as string;

  // ── THE FIXTURE. ARRANGED SO THE WRONG ANSWER IS THE ONE A LAZY IMPLEMENTATION WOULD GIVE.
  //
  // Six of these nine MUST NOT be found by a whole-day change at TMR on DAY_X, each for a different
  // reason: the wrong day, the wrong place, cancelled, a no-show, completed, and (for the narrowed
  // window) too early. A `count === 3` assertion is true of a dozen wrong implementations; naming the
  // ids is true of one.
  //
  // ⚠ `acknowledged` IS WHY THIS FIXTURE STILL LOADS. Migration 255 added a WORKSPACE-SCOPED exclusion
  // constraint: one clinician cannot hold two live appointments over one instant, and it deliberately
  // carries no location term, because nobody can be at TMR and Kololo at 10:00. C1_OTHER_LOC is exactly
  // that pair with A1_IN_WINDOW -- ON PURPOSE, since 1f and 1g exist to prove that a change scoped to one
  // location leaves the other location's booking alone, and they need both bookings in the same hour to
  // mean anything. Migration 255 gives that decision a column: `overlap_acknowledged` is the deliberate
  // double-book s14 permits with a reason. Setting it on the one row that needs it keeps every time in
  // this fixture exactly as it was, so no assertion below is quietly measuring a different diary.
  //
  // Without it the whole file died at this insert -- before assertion 1a -- which is a harness reporting
  // no coverage at all in the shape of a stack trace.
  const rows = [
    { tag: "A1_IN_WINDOW", location_id: LOC_MAIN, patient_id: PATIENT, patient_name: "Aisha Nakato", scheduled_at: at(DAY_X, 10 * 60), status: "CONFIRMED", acknowledged: false },
    { tag: "A2_REQUESTED", location_id: LOC_MAIN, patient_id: null, patient_name: "Brian Okello", scheduled_at: at(DAY_X, 11 * 60), status: "REQUESTED", acknowledged: false },
    { tag: "A3_NO_LOCATION", location_id: null, patient_id: null, patient_name: "Claire Ayebazibwe", scheduled_at: at(DAY_X, 12 * 60), status: "CONFIRMED", acknowledged: false },
    { tag: "A4_EARLY", location_id: LOC_MAIN, patient_id: null, patient_name: "Daniel Ssemakula", scheduled_at: at(DAY_X, 7 * 60), status: "CONFIRMED", acknowledged: false },
    { tag: "A5_CANCELLED", location_id: LOC_MAIN, patient_id: null, patient_name: "Esther Nabirye", scheduled_at: at(DAY_X, 10 * 60 + 30), status: "CANCELLED", acknowledged: false },
    { tag: "A6_NO_SHOW", location_id: LOC_MAIN, patient_id: null, patient_name: "Francis Mugisha", scheduled_at: at(DAY_X, 10 * 60 + 45), status: "NO_SHOW", acknowledged: false },
    { tag: "A7_COMPLETED", location_id: LOC_MAIN, patient_id: null, patient_name: "Grace Atim", scheduled_at: at(DAY_X, 11 * 60 + 15), status: "COMPLETED", acknowledged: false },
    { tag: "B1_OTHER_DAY", location_id: LOC_MAIN, patient_id: null, patient_name: "Henry Kalule", scheduled_at: at(DAY_Y, 10 * 60), status: "CONFIRMED", acknowledged: false },
    { tag: "C1_OTHER_LOC", location_id: LOC_OTHER, patient_id: null, patient_name: "Irene Nassuna", scheduled_at: at(DAY_X, 10 * 60), status: "CONFIRMED", acknowledged: true },
  ];
  const { data: apptRows, error: apptErr } = await admin.from("practice_appointment").insert(
    rows.map(r => ({
      workspace_id: wsA, location_id: r.location_id, patient_id: r.patient_id,
      patient_name: r.patient_name, appointment_type: "new_consultation",
      scheduled_at: r.scheduled_at, duration_minutes: 30, status: r.status,
      overlap_acknowledged: r.acknowledged,
    })),
  ).select("id, patient_name");
  if (apptErr || !apptRows) throw new Error(`appointment fixture failed: ${apptErr?.message}`);
  const ID: Record<string, string> = {};
  for (const r of rows) ID[r.tag] = apptRows.find(a => a.patient_name === r.patient_name)!.id as string;

  // s5.3's "follow-up-linked". One of the affected bookings carries a live follow-up.
  const { error: fupErr } = await admin.from("practice_follow_up").insert({
    workspace_id: wsA, patient_id: PATIENT, kind: "review", reason: "Blood pressure review",
    due_on: DAY_X, status: "SCHEDULED", appointment_id: ID.A1_IN_WINDOW,
  });
  if (fupErr) throw new Error(`follow-up fixture failed: ${fupErr.message}`);

  const idsOf = (r: any) => (r.state === "ok" ? r.value.bookings.map((b: any) => b.appointmentId).sort() : []);
  const sorted = (...tags: string[]) => tags.map(t => ID[t]).sort();
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ══ 1. s5.3 STEP 1 -- THE RIGHT BOOKINGS, BY ID ════════════════════════════════════════════════
  const wholeDay = await calculateImpact(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN,
  });
  ok("1a a whole-day change at one location finds exactly the four live bookings there, BY ID",
    same(idsOf(wholeDay), sorted("A1_IN_WINDOW", "A2_REQUESTED", "A3_NO_LOCATION", "A4_EARLY")),
    JSON.stringify(idsOf(wholeDay)));
  ok("1b a CANCELLED booking is not affected -- it is not a person expecting to be seen",
    !idsOf(wholeDay).includes(ID.A5_CANCELLED));
  ok("1c nor a NO_SHOW", !idsOf(wholeDay).includes(ID.A6_NO_SHOW));
  ok("1d nor a COMPLETED one", !idsOf(wholeDay).includes(ID.A7_COMPLETED));
  ok("1e a booking on the NEXT DAY is not affected", !idsOf(wholeDay).includes(ID.B1_OTHER_DAY));
  ok("1f a booking at ANOTHER LOCATION is not affected", !idsOf(wholeDay).includes(ID.C1_OTHER_LOC));

  const practiceWide = await calculateImpact(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: null,
  });
  ok("1g CONTROL: a practice-wide change DOES find the other location, so 1f is about the scope and not about that booking being invisible",
    idsOf(practiceWide).includes(ID.C1_OTHER_LOC)
    && same(idsOf(practiceWide), sorted("A1_IN_WINDOW", "A2_REQUESTED", "A3_NO_LOCATION", "A4_EARLY", "C1_OTHER_LOC")),
    JSON.stringify(idsOf(practiceWide)));

  const narrowed = await calculateImpact(admin, A, {
    kind: "closure", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN,
    startsMinute: 9 * 60, endsMinute: 13 * 60,
  });
  ok("1h a change to PART of the day excludes the 07:00 booking, which the whole-day one included",
    same(idsOf(narrowed), sorted("A1_IN_WINDOW", "A2_REQUESTED", "A3_NO_LOCATION")),
    JSON.stringify(idsOf(narrowed)));

  ok("1i the count is the LENGTH OF THE LIST, never a second query",
    wholeDay.state === "ok" && wholeDay.value.count === wholeDay.value.bookings.length && wholeDay.value.count === 4,
    JSON.stringify(wholeDay.state === "ok" ? wholeDay.value.count : wholeDay));
  ok("1j the booking with no location recorded is INCLUDED and FLAGGED, not silently dropped",
    wholeDay.state === "ok"
    && wholeDay.value.bookings.find(b => b.appointmentId === ID.A3_NO_LOCATION)?.locationUncertain === true
    && wholeDay.value.bookings.find(b => b.appointmentId === ID.A1_IN_WINDOW)?.locationUncertain === false,
    JSON.stringify(wholeDay.state === "ok" ? wholeDay.value.bookings.map(b => [b.reference, b.locationUncertain]) : null));
  ok("1k s5.3's follow-up-linked booking is marked, and the others are not",
    wholeDay.state === "ok"
    && wholeDay.value.bookings.find(b => b.appointmentId === ID.A1_IN_WINDOW)?.followUpLinked === true
    && wholeDay.value.bookings.find(b => b.appointmentId === ID.A2_REQUESTED)?.followUpLinked === false,
    JSON.stringify(wholeDay.state === "ok" ? wholeDay.value.bookings.map(b => [b.reference, b.followUpLinked]) : null));

  // ══ 2. A KIND THAT ONLY ADDS TIME CANNOT STRAND ANYBODY ════════════════════════════════════════
  const adding = await calculateImpact(admin, A, {
    kind: "extra_session", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN,
    startsMinute: 9 * 60, endsMinute: 13 * 60,
  });
  ok("2a a one-off session over the same window affects NOBODY, and says the nought is derived from the kind",
    adding.state === "ok" && adding.value.count === 0 && adding.value.addsTimeOnly === true
    && adding.value.notes.some(n => /derived from the kind/.test(n)),
    JSON.stringify(adding.state === "ok" ? adding.value : adding));
  ok("2b CONTROL: the identical window as a CLOSURE finds three, so 2a is about the kind and not about an empty diary",
    narrowed.state === "ok" && narrowed.value.count === 3);

  // ══ 3. A FAILED READ IS NEVER A ZERO ═══════════════════════════════════════════════════════════
  const blind = adminWithUnreadable(admin, "practice_appointment");
  const blindImpact = await calculateImpact(blind, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN,
  });
  ok("3a an unreadable bookings table reports UNREADABLE, not nought",
    blindImpact.state === "unreadable", JSON.stringify(blindImpact));

  const { count: excBefore } = await admin.from("practice_availability_exception")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  const blindCommit = await commitScheduleChange(blind, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN, resolution: "keep_pending", ...ACT,
  });
  ok("3b and the commit REFUSES rather than cancelling a clinic and reporting nobody was in it",
    !blindCommit.ok && blindCommit.code === "IMPACT_UNREADABLE",
    blindCommit.ok ? "committed" : blindCommit.code);
  ok("3c and it says an unread booking is not an absent one",
    !blindCommit.ok && /unread booking is not an absent one/.test(blindCommit.message),
    blindCommit.ok ? "" : blindCommit.message);
  const { count: excAfterBlind } = await admin.from("practice_availability_exception")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("3d and NOTHING was written", (excBefore ?? 0) === (excAfterBlind ?? -1),
    `${excBefore} -> ${excAfterBlind}`);

  // ══ 4. AC-04 -- A RESOLUTION IS REQUIRED BEFORE THE CHANGE IS COMMITTED ════════════════════════
  const noStrategy = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN, ...ACT,
  });
  ok("4a committing a change with four patients in it and NO resolution is refused",
    !noStrategy.ok && noStrategy.code === "RESOLUTION_REQUIRED",
    noStrategy.ok ? "committed" : noStrategy.code);
  ok("4b and the refusal says HOW MANY, so it is an instruction rather than a wall",
    !noStrategy.ok && /4 bookings are in the time you are changing/.test(noStrategy.message),
    noStrategy.ok ? "" : noStrategy.message);

  const falseClaim = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN, resolution: "no_patient_impact", ...ACT,
  });
  ok("4c claiming NO PATIENT IMPACT when four are affected is refused",
    !falseClaim.ok && falseClaim.code === "PATIENTS_ARE_AFFECTED",
    falseClaim.ok ? "committed" : falseClaim.code);

  const perPatient = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN, resolution: "bulk_reschedule", ...ACT,
  });
  ok("4d a per-patient decision cannot be applied to a group at commit time",
    !perPatient.ok && perPatient.code === "RESOLUTION_PER_PATIENT",
    perPatient.ok ? "committed" : perPatient.code);

  const notBuilt = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN, resolution: "waiting_list", ...ACT,
  });
  ok("4e a resolution this build cannot carry out is refused with the reason, not stored as a word",
    !notBuilt.ok && notBuilt.code === "RESOLUTION_NOT_BUILT" && /waiting list/i.test(notBuilt.message),
    notBuilt.ok ? "committed" : `${notBuilt.code} ${notBuilt.message}`);

  const { count: excStill } = await admin.from("practice_availability_exception")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("4f none of those four refusals wrote anything", (excStill ?? -1) === (excBefore ?? 0),
    `${excBefore} -> ${excStill}`);

  // THE CONTROL. The same change, with a decision, goes through.
  const committed = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN,
    reason: "Conference", resolution: "keep_pending", note: "Ring them on Monday", ...ACT,
  });
  ok("4g CONTROL: the same change WITH a resolution is accepted, so 4a-4e refuse the missing decision and not the change",
    committed.ok, committed.ok ? "" : `${committed.code} ${committed.message}`);
  if (!committed.ok) throw new Error("cannot continue without the committed change");
  const EXC = committed.data.exceptionId;
  ok("4h and the commit reports the number it acted on",
    committed.data.affected === 4 && committed.data.actionsCreated === 4,
    JSON.stringify(committed.data));

  // A change nobody is booked into: the only permitted answer is s5.3's own "no patient impact".
  const emptyWrong = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: dueDateFrom(today, 40), toDate: dueDateFrom(today, 40),
    locationId: LOC_MAIN, resolution: "cancel_and_notify", ...ACT,
  });
  ok("4i a resolution that acts on patients is refused when there are none",
    !emptyWrong.ok && emptyWrong.code === "NOBODY_IS_AFFECTED",
    emptyWrong.ok ? "committed" : emptyWrong.code);
  const emptyOk = await addException(admin, A, {
    kind: "leave", fromDate: dueDateFrom(today, 40), toDate: dueDateFrom(today, 40),
    locationId: LOC_MAIN, reason: "Public holiday", ...ACT,
  });
  ok("4j CONTROL: with nobody affected the legacy door still works and records no patient impact",
    emptyOk.ok && emptyOk.data.affected === 0 && emptyOk.data.resolution === "no_patient_impact",
    emptyOk.ok ? JSON.stringify(emptyOk.data) : `${emptyOk.code} ${emptyOk.message}`);
  const EXC_EMPTY = emptyOk.ok ? emptyOk.data.id : "";

  // ══ 5. `keep_pending` IS NOT RESOLVED ══════════════════════════════════════════════════════════
  {
    const { data: actions } = await admin.from("practice_affected_booking_action")
      .select("id, appointment_id, resolution, resolved, decided_at").eq("exception_id", EXC);
    const list = (actions ?? []) as any[];
    ok("5a one action row per affected booking, and they are THE four affected bookings by id",
      same(list.map(a => a.appointment_id as string).sort(),
        sorted("A1_IN_WINDOW", "A2_REQUESTED", "A3_NO_LOCATION", "A4_EARLY")),
      JSON.stringify(list.map(a => a.appointment_id)));
    ok("5b keep_pending leaves `resolved` FALSE -- parking a patient is a decision, not a resolution",
      list.length === 4 && list.every(a => a.resolution === "keep_pending" && a.resolved === false && a.decided_at === null),
      JSON.stringify(list.map(a => [a.resolution, a.resolved])));
  }

  const queue1 = await affectedBookingQueue(admin, A);
  ok("5c and they appear in the action queue, by appointment id",
    queue1.state === "ok"
    && same(queue1.value.map(q => q.appointmentId).sort(), sorted("A1_IN_WINDOW", "A2_REQUESTED", "A3_NO_LOCATION", "A4_EARLY")),
    JSON.stringify(queue1.state === "ok" ? queue1.value.map(q => q.reference) : queue1));

  // THE DATABASE ENFORCES IT TOO. A hand-written row that calls keep_pending resolved must be refused.
  const { error: lieErr } = await admin.from("practice_affected_booking_action").insert({
    workspace_id: wsA, exception_id: EXC, appointment_id: ID.B1_OTHER_DAY,
    resolution: "keep_pending", resolved: true, decided_at: new Date().toISOString(),
  });
  ok("5d migration 242's CHECK refuses a keep_pending row that calls itself resolved",
    !!lieErr, "the database accepted it");
  const { error: honestErr } = await admin.from("practice_affected_booking_action").insert({
    workspace_id: wsA, exception_id: EXC, appointment_id: ID.B1_OTHER_DAY,
    resolution: "keep_pending", resolved: false,
  });
  ok("5e CONTROL: the honest version of the same row is accepted, so 5d is the CHECK and not the insert",
    !honestErr, honestErr?.message ?? "");
  await admin.from("practice_affected_booking_action")
    .delete().eq("exception_id", EXC).eq("appointment_id", ID.B1_OTHER_DAY);

  // Resolving one: real, and it really cancels.
  const oneAction = (queue1.state === "ok" ? queue1.value : []).find(q => q.appointmentId === ID.A2_REQUESTED)!;
  const resolvedOne = await resolveAffectedBooking(admin, A, {
    actionId: oneAction.id, resolution: "cancel_and_notify", note: "Clinic cancelled, patient rung", ...ACT,
  });
  ok("5f a booking can be resolved by cancelling it", resolvedOne.ok && resolvedOne.data.resolved === true,
    resolvedOne.ok ? "" : `${resolvedOne.code} ${resolvedOne.message}`);
  {
    const { data: appt } = await admin.from("practice_appointment")
      .select("status, reason").eq("id", ID.A2_REQUESTED).maybeSingle();
    ok("5g and the appointment is REALLY cancelled -- not a word written into a queue",
      appt?.status === "CANCELLED", JSON.stringify(appt));
  }
  const queue2 = await affectedBookingQueue(admin, A);
  ok("5h and the queue loses exactly that booking and keeps the other three",
    queue2.state === "ok"
    && same(queue2.value.map(q => q.appointmentId).sort(), sorted("A1_IN_WINDOW", "A3_NO_LOCATION", "A4_EARLY")),
    JSON.stringify(queue2.state === "ok" ? queue2.value.map(q => q.reference) : queue2));

  // Back to pending: the flag follows the resolution, not the act of pressing a button.
  const backToPending = await resolveAffectedBooking(admin, A, {
    actionId: oneAction.id, resolution: "keep_pending", note: "Reopened, wrong patient", ...ACT,
  });
  ok("5i moving a decision back to keep_pending sets `resolved` false again",
    backToPending.ok && backToPending.data.resolved === false,
    backToPending.ok ? "" : `${backToPending.code} ${backToPending.message}`);

  const badReschedule = await resolveAffectedBooking(admin, A, {
    actionId: oneAction.id, resolution: "bulk_reschedule", ...ACT,
  });
  ok("5j a reschedule with no destination is refused -- it is a word, not a move",
    !badReschedule.ok && badReschedule.code === "VALIDATION_ERROR",
    badReschedule.ok ? "accepted" : badReschedule.code);
  const deadReschedule = await resolveAffectedBooking(admin, A, {
    actionId: oneAction.id, resolution: "bulk_reschedule", rescheduledAppointmentId: ID.A5_CANCELLED, ...ACT,
  });
  ok("5k nor one that points at a CANCELLED appointment -- that patient has not been moved to it",
    !deadReschedule.ok && deadReschedule.code === "DESTINATION_NOT_LIVE",
    deadReschedule.ok ? "accepted" : deadReschedule.code);
  const goodReschedule = await resolveAffectedBooking(admin, A, {
    actionId: oneAction.id, resolution: "bulk_reschedule", rescheduledAppointmentId: ID.B1_OTHER_DAY, ...ACT,
  });
  ok("5l CONTROL: pointing at a LIVE appointment is accepted, so 5j and 5k are about the destination",
    goodReschedule.ok && goodReschedule.data.resolved === true,
    goodReschedule.ok ? "" : `${goodReschedule.code} ${goodReschedule.message}`);

  // ══ 6. `impact_reviewed_at` NULL MEANS NOT REVIEWED ════════════════════════════════════════════
  {
    const { data: row } = await admin.from("practice_availability_exception")
      .select("impact_reviewed_at, impact_reviewed_by").eq("id", EXC).maybeSingle();
    ok("6a a committed change records WHO reviewed the impact and WHEN",
      !!row?.impact_reviewed_at && row?.impact_reviewed_by === OWNER, JSON.stringify(row));
  }

  // A row written straight into the table, as every exception created before migration 242 was.
  const { data: legacyRow } = await admin.from("practice_availability_exception").insert({
    workspace_id: wsA, location_id: LOC_MAIN, kind: "closure",
    from_date: dueDateFrom(today, 20), to_date: dueDateFrom(today, 20), reason: "Written directly",
  }).select("id").single();
  const EXC_LEGACY = legacyRow!.id as string;

  {
    const view = await scheduleChanges(admin, A);
    const list = impactReadingValue(view.changes, [] as ScheduleChangeView[]);
    const legacy = list.find(c => c.id === EXC_LEGACY);
    const emptyOne = list.find(c => c.id === EXC_EMPTY);
    ok("6b a change whose impact was never reviewed is drawn UNREVIEWED, not `nobody affected`",
      legacy?.impactState === "unreviewed" && legacy?.impactReviewedAt === null,
      JSON.stringify(legacy));
    ok("6c CONTROL: a change that WAS reviewed and found nobody is drawn CLEAR -- so `unreviewed` is about the null, not about having no action rows",
      emptyOne?.impactState === "clear" && emptyOne?.actions === 0 && emptyOne?.impactReviewedAt !== null,
      JSON.stringify(emptyOne));
    ok("6d and a change with somebody still waiting is drawn PENDING",
      list.find(c => c.id === EXC)?.impactState === "pending",
      JSON.stringify(list.find(c => c.id === EXC)));
    ok("6e the unreviewed figure counts it, and is not nought",
      view.unreviewed === 1, String(view.unreviewed));
  }

  // ══ 7. THE SAME EXCEPTION APPLIED TWICE DOES NOT DUPLICATE ═════════════════════════════════════
  //
  // ⚠ THE NUMBER HERE IS THREE, NOT FOUR, AND THAT IS THE ENGINE BEING RIGHT. Section 5 cancelled one of
  // the four appointments, so a live recalculation finds three -- while the FOURTH KEEPS ITS ACTION ROW,
  // because a decision already recorded about a patient does not evaporate when the appointment changes.
  const again = await recalculateImpact(admin, A, { exceptionId: EXC, ...ACT });
  ok("7a re-running the calculation for the same change creates NO new action rows",
    again.ok && again.data.created === 0 && again.data.affected === 3 && again.data.alreadyPresent === 3,
    again.ok ? JSON.stringify(again.data) : `${again.code} ${again.message}`);
  {
    const { data: all } = await admin.from("practice_affected_booking_action")
      .select("appointment_id").eq("exception_id", EXC);
    const ids = ((all ?? []) as any[]).map(a => a.appointment_id as string);
    ok("7b and there is still exactly one row per booking, including the one that was cancelled",
      ids.length === 4 && new Set(ids).size === 4
      && same(ids.sort(), sorted("A1_IN_WINDOW", "A2_REQUESTED", "A3_NO_LOCATION", "A4_EARLY")),
      JSON.stringify(ids));
  }
  // A booking made AFTER the change was recorded. The queue has to catch up, or it is not a queue.
  const { data: lateRow } = await admin.from("practice_appointment").insert({
    workspace_id: wsA, location_id: LOC_MAIN, patient_name: "Late Booking",
    appointment_type: "new_consultation", scheduled_at: at(DAY_X, 15 * 60),
    duration_minutes: 30, status: "CONFIRMED",
  }).select("id").single();
  const LATE = lateRow!.id as string;
  const caughtUp = await recalculateImpact(admin, A, { exceptionId: EXC, ...ACT });
  ok("7c CONTROL: a booking made after the change IS picked up, so 7a is idempotence and not a no-op",
    caughtUp.ok && caughtUp.data.created === 1 && caughtUp.data.affected === 4,
    caughtUp.ok ? JSON.stringify(caughtUp.data) : `${caughtUp.code} ${caughtUp.message}`);
  {
    const { data: late } = await admin.from("practice_affected_booking_action")
      .select("resolution, resolved").eq("exception_id", EXC).eq("appointment_id", LATE).maybeSingle();
    ok("7d and it arrives UNDECIDED rather than inheriting a strategy chosen before it existed",
      late?.resolution === "keep_pending" && late?.resolved === false, JSON.stringify(late));
  }
  const { error: dupErr } = await admin.from("practice_affected_booking_action").insert({
    workspace_id: wsA, exception_id: EXC, appointment_id: LATE, resolution: "keep_pending", resolved: false,
  });
  ok("7e migration 242's unique index refuses a second row for one booking and one change",
    !!dupErr, "the database accepted a duplicate");

  // ══ 8. s5.2's THREE NEW KINDS DO SOMETHING ═════════════════════════════════════════════════════
  //
  // A Wednesday session, generated into real slots, then reshaped. The slot's id is NAMED before and
  // after so the assertions are about that row rather than about a count of rows.
  const WED = (() => {
    for (let d = 21; d < 35; d++) {
      const date = dueDateFrom(today, d);
      if ((((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1) === 3) return date;
    }
    throw new Error("no Wednesday found");
  })();
  const wedSession = await saveSession(admin, A, {
    weekday: 3, startsMinute: 9 * 60, endsMinute: 13 * 60, locationId: LOC_MAIN,
    sessionName: "Wednesday Clinic", activityType: "outpatient_clinic", ...ACT,
  });
  if (!wedSession.ok) throw new Error(`wednesday session fixture failed: ${wedSession.message}`);
  await generateSlots(admin, A, { fromDate: WED, toDate: WED, ...ACT });
  const { data: wedSlotBefore } = await admin.from("practice_availability_slot")
    .select("id, location_id, slot_kind").eq("workspace_id", wsA).eq("generated_for_date", WED).maybeSingle();
  ok("8a-setup the Wednesday session generated a slot at the main location",
    wedSlotBefore?.location_id === LOC_MAIN && wedSlotBefore?.slot_kind === "clinic",
    JSON.stringify(wedSlotBefore));
  const WED_SLOT = wedSlotBefore!.id as string;

  // ⚠ EVERY ONE OF THESE CARRIES A WINDOW, and the refusal messages are asserted rather than only the
  // codes. All four validation failures share the code VALIDATION_ERROR, so a code-only assertion would
  // stay green if the engine refused them for the wrong reason -- and it WOULD have: without a window
  // these three kinds are refused for the missing window (a migration-230 constraint this build cannot
  // widen), which would have made 8b, 8c and 8d pass while proving nothing about the destination.
  const SESSION_WINDOW = { startsMinute: 9 * 60, endsMinute: 13 * 60 };
  const noWhere = await commitScheduleChange(admin, A, {
    kind: "location_change", fromDate: WED, toDate: WED, locationId: LOC_MAIN, ...SESSION_WINDOW, ...ACT,
  });
  ok("8b a location change that does not say where is refused, for the destination and not the window",
    !noWhere.ok && noWhere.code === "VALIDATION_ERROR" && /where the session moves to/.test(noWhere.message),
    noWhere.ok ? "committed" : `${noWhere.code} ${noWhere.message}`);
  const sameWhere = await commitScheduleChange(admin, A, {
    kind: "location_change", fromDate: WED, toDate: WED, locationId: LOC_MAIN,
    replacementLocationId: LOC_MAIN, ...SESSION_WINDOW, ...ACT,
  });
  ok("8c nor one that moves the session to where it already is",
    !sameWhere.ok && sameWhere.code === "VALIDATION_ERROR" && /already there/.test(sameWhere.message),
    sameWhere.ok ? "committed" : `${sameWhere.code} ${sameWhere.message}`);
  const badActivity = await commitScheduleChange(admin, A, {
    kind: "activity_substitution", fromDate: WED, toDate: WED, locationId: LOC_MAIN,
    replacementActivityType: "outreach", ...SESSION_WINDOW, ...ACT,
  });
  ok("8d an activity substitution to a type the activity table would reject is refused, by name",
    !badActivity.ok && badActivity.code === "VALIDATION_ERROR" && /"outreach" is not an activity/.test(badActivity.message),
    badActivity.ok ? "committed" : `${badActivity.code} ${badActivity.message}`);

  const moved = await commitScheduleChange(admin, A, {
    kind: "location_change", fromDate: WED, toDate: WED, locationId: LOC_MAIN,
    replacementLocationId: LOC_OTHER, reason: "Room being painted", ...SESSION_WINDOW, ...ACT,
  });
  ok("8e CONTROL: a location change that names somewhere else is accepted, so 8b and 8c are about the destination",
    moved.ok, moved.ok ? "" : `${moved.code} ${moved.message}`);
  await generateSlots(admin, A, { fromDate: WED, toDate: WED, ...ACT });
  {
    const { data: after } = await admin.from("practice_availability_slot")
      .select("id, location_id, slot_kind, note").eq("id", WED_SLOT).maybeSingle();
    ok("8f THAT SLOT moved to the replacement location -- the same row, not a new one",
      after?.id === WED_SLOT && after?.location_id === LOC_OTHER,
      JSON.stringify(after));
    const { count } = await admin.from("practice_availability_slot")
      .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", WED);
    ok("8g and it was not duplicated in the process", (count ?? 0) === 1, String(count));
  }

  // An activity substitution on a different Wednesday, so the two reshapes are independent.
  const WED2 = dueDateFrom(WED, 7);
  await generateSlots(admin, A, { fromDate: WED2, toDate: WED2, ...ACT });
  const { data: wed2Before } = await admin.from("practice_availability_slot")
    .select("id, slot_kind, location_id").eq("workspace_id", wsA).eq("generated_for_date", WED2).maybeSingle();
  ok("8h-setup the following Wednesday generated a bookable clinic slot",
    wed2Before?.slot_kind === "clinic", JSON.stringify(wed2Before));
  const WED2_SLOT = wed2Before!.id as string;
  const substituted = await commitScheduleChange(admin, A, {
    kind: "activity_substitution", fromDate: WED2, toDate: WED2, locationId: LOC_MAIN,
    replacementActivityType: "theatre", reason: "Emergency list", ...SESSION_WINDOW, ...ACT,
  });
  ok("8i an activity substitution to a real activity is accepted", substituted.ok,
    substituted.ok ? "" : `${substituted.code} ${substituted.message}`);
  await generateSlots(admin, A, { fromDate: WED2, toDate: WED2, ...ACT });
  {
    const { data: after } = await admin.from("practice_availability_slot")
      .select("id, slot_kind, location_id, note").eq("id", WED2_SLOT).maybeSingle();
    ok("8j THAT SLOT became blocked, so the booking engine stops offering it, and it names what replaced it",
      after?.slot_kind === "blocked" && /Theatre/.test(String(after?.note)),
      JSON.stringify(after));
    ok("8k and it did NOT move location -- a substitution changes what, not where",
      after?.location_id === LOC_MAIN, JSON.stringify(after));
    const { count } = await admin.from("practice_availability_slot")
      .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", WED2);
    // The same trap as 8g. A reshaping change must not also be treated as time being ADDED.
    ok("8k2 and no second slot was created beside it", (count ?? 0) === 1, String(count));
  }

  // An emergency interruption takes the day, like leave does.
  // ⚠ THIS FIXTURE PASSED SIX DAYS A WEEK AND FAILED ON FRIDAYS.
  //
  // WED3 was `dueDateFrom(WED, 14)` flat. WED is the first Wednesday at least three weeks out, so on a
  // Friday it lands on today+26 and WED3 on today+40 -- which is the exact day this same fixture takes
  // as LEAVE at :346. The harness then cancelled the day it was about to assert a slot on, and 8l-setup
  // found nought. Nothing was wrong with the engine.
  //
  // A date-dependent fixture is worse than a flaky one: it is green on the day you write it and red on
  // some later Friday, by which time the change under suspicion is whatever landed most recently. This
  // one was written on a Thursday and accused Phase 3, which had not touched it.
  //
  // Stepped explicitly off the collision rather than pushed further out and hoped: "further out" is what
  // produced the overlap in the first place.
  const LEAVE_DAY = dueDateFrom(today, 40);
  const WED3 = dueDateFrom(WED, 14) === LEAVE_DAY ? dueDateFrom(WED, 21) : dueDateFrom(WED, 14);
  await generateSlots(admin, A, { fromDate: WED3, toDate: WED3, ...ACT });
  const { count: wed3Before } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", WED3);
  ok("8l-setup the third Wednesday generated a slot", (wed3Before ?? 0) === 1, String(wed3Before));
  const interrupted = await commitScheduleChange(admin, A, {
    kind: "emergency_interruption", fromDate: WED3, toDate: WED3, locationId: LOC_MAIN,
    reason: "Called to theatre", ...SESSION_WINDOW, ...ACT,
  });
  ok("8m an emergency interruption is accepted", interrupted.ok,
    interrupted.ok ? "" : `${interrupted.code} ${interrupted.message}`);
  await generateSlots(admin, A, { fromDate: WED3, toDate: WED3, ...ACT });
  {
    const { count } = await admin.from("practice_availability_slot")
      .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", WED3);
    ok("8n and it takes the day's availability away, as leave does", (count ?? -1) === 0, String(count));
  }

  // ══ 9. PATIENT NAMES ARE A PERMISSION, THE COUNT IS NOT ════════════════════════════════════════
  const noNames = { ...A, capabilities: A.capabilities.filter(c => c !== "patient.view") };
  const sameMoment = { kind: "leave", fromDate: DAY_X, toDate: DAY_X, locationId: LOC_MAIN };
  // ⚠ BOTH READ NOW. The earlier `wholeDay` was taken before section 5 cancelled a booking and section 7
  // added one; comparing against it would be comparing two different diaries and calling the difference
  // a permission effect.
  const withNames = await calculateImpact(admin, A, sameMoment);
  const blindNames = await calculateImpact(admin, noNames, sameMoment);
  ok("9a without patient.view every name is withheld",
    blindNames.state === "ok" && blindNames.value.bookings.every(b => b.patientName === null)
    && blindNames.value.namesVisible === false,
    JSON.stringify(blindNames.state === "ok" ? blindNames.value.bookings.map(b => b.patientName) : null));
  ok("9b but every booking still carries a reference somebody can act on",
    blindNames.state === "ok" && blindNames.value.bookings.every(b => /^[0-9A-F]{6}$/.test(b.reference)),
    JSON.stringify(blindNames.state === "ok" ? blindNames.value.bookings.map(b => b.reference) : null));
  ok("9c and the COUNT and the ids are unchanged -- hiding a name does not hide a patient",
    blindNames.state === "ok" && withNames.state === "ok"
    && blindNames.value.count === withNames.value.count
    && same(idsOf(blindNames), idsOf(withNames)),
    JSON.stringify([idsOf(blindNames), idsOf(withNames)]));
  ok("9d CONTROL: with patient.view the names ARE there, so 9a is the capability and not an empty column",
    withNames.state === "ok" && withNames.value.bookings.some(b => b.patientName === "Aisha Nakato"),
    JSON.stringify(withNames.state === "ok" ? withNames.value.bookings.map(b => b.patientName) : null));

  // ══ 10. PERMISSION AND ISOLATION ═══════════════════════════════════════════════════════════════
  const noEdit = { ...A, capabilities: A.capabilities.filter(c => c !== "appointment.manage") };
  const refusedCommit = await commitScheduleChange(admin, noEdit, {
    kind: "leave", fromDate: dueDateFrom(today, 60), toDate: dueDateFrom(today, 60), ...ACT,
  });
  ok("10a s14: creating an exception needs the permission",
    !refusedCommit.ok && refusedCommit.code === "FORBIDDEN",
    refusedCommit.ok ? "committed" : refusedCommit.code);
  const refusedResolve = await resolveAffectedBooking(admin, noEdit, {
    actionId: oneAction.id, resolution: "keep_pending", ...ACT,
  });
  ok("10b and so does deciding what happens to a patient",
    !refusedResolve.ok && refusedResolve.code === "FORBIDDEN",
    refusedResolve.ok ? "resolved" : refusedResolve.code);
  const allowedCommit = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: dueDateFrom(today, 60), toDate: dueDateFrom(today, 60), ...ACT,
  });
  ok("10c CONTROL: the same change with the permission is accepted",
    allowedCommit.ok, allowedCommit.ok ? "" : `${allowedCommit.code} ${allowedCommit.message}`);

  const crossResolve = await resolveAffectedBooking(admin, B, {
    actionId: oneAction.id, resolution: "keep_pending", ...ACT,
  });
  ok("10d practice B cannot reach practice A's action by id",
    !crossResolve.ok && crossResolve.code === "NOT_FOUND",
    crossResolve.ok ? "resolved" : crossResolve.code);
  const bQueue = await affectedBookingQueue(admin, B);
  ok("10e and practice B's queue is empty",
    bQueue.state === "ok" && bQueue.value.length === 0,
    JSON.stringify(bQueue.state === "ok" ? bQueue.value.length : bQueue));
  const aQueue = await affectedBookingQueue(admin, A);
  ok("10f CONTROL: practice A's queue is NOT empty, so 10e is isolation and not an empty feature",
    aQueue.state === "ok" && aQueue.value.length > 0,
    JSON.stringify(aQueue.state === "ok" ? aQueue.value.length : aQueue));

  // ══ 11. THE QUEUE REFUSES RATHER THAN SHORTENING ═══════════════════════════════════════════════
  const blindQueue = await affectedBookingQueue(adminWithUnreadable(admin, "practice_appointment"), A);
  ok("11a a queue whose appointments cannot be read is UNREADABLE, not shorter",
    blindQueue.state === "unreadable", JSON.stringify(blindQueue));
  ok("11b CONTROL: it reads fine against a working table, so 11a is the outage",
    aQueue.state === "ok" && aQueue.value.length > 0);
  {
    const view = await scheduleChanges(adminWithUnreadable(admin, "practice_availability_exception"), A);
    ok("11c an unreadable change list is reported as unreadable and NOT as nought changes",
      view.changes.state === "unreadable" && view.unreviewed === null,
      JSON.stringify([view.changes.state, view.unreviewed]));
    ok("11d and the failure is named so the screen can say which part is missing",
      view.readFailures.length > 0, JSON.stringify(view.readFailures));
  }
  {
    const view = await scheduleChanges(admin, A);
    ok("11e CONTROL: the same read against a working table lists the changes, so 11c is the outage",
      view.changes.state === "ok"
      && impactReadingValue(view.changes, [] as ScheduleChangeView[]).some(c => c.id === EXC),
      JSON.stringify(view.changes.state));
    const q = impactReadingValue(view.queue, [] as QueuedAction[]);
    ok("11f and the queue it returns names the bookings still waiting",
      q.some(a => a.appointmentId === ID.A1_IN_WINDOW), JSON.stringify(q.map(a => a.reference)));
  }

  // ══ 12. A CHANGE'S WINDOW IS A TIME OF DAY, NOT ANY NUMBER ═════════════════════════════════════
  //
  // starts_minute and ends_minute are MINUTES FROM MIDNIGHT. This engine tested only the order, so
  // 78000 was accepted and written -- and an exception whose window is minute 78000 describes a day that
  // does not exist, which the generator then honours.
  //
  // ⚠ EVERY WINDOW BELOW IS ORDERED CORRECTLY ON PURPOSE, so "a session must end after it starts" cannot
  // be the thing doing the refusing. The assertions compare THE SENTENCE for the same reason: a refusal
  // asserted as `!r.ok` stays green when a different validation takes over, and this repo has already
  // shipped one test that passed for that reason. The sentences are spelled out here rather than
  // imported, so the needle cannot match itself.
  const RANGE_START = (got: string) =>
    `startsMinute must be a whole number of minutes from midnight, 0 to 1439 (0 is midnight, 1439 is 23:59); got ${got}`;
  const RANGE_END = (got: string) =>
    `endsMinute must be a whole number of minutes from midnight, 1 to 1440 (1440 is midnight at the end of the day); got ${got}`;
  const why = (r: { ok: boolean; message?: string }) => (r.ok ? "ACCEPTED -- nothing was refused" : r.message ?? "");
  /** A caller that never parsed its input. The argument type says number; a JavaScript caller may lie. */
  const asMinute = (v: unknown) => v as number;
  const FAR = dueDateFrom(today, 90);
  const FAR2 = dueDateFrom(today, 92);

  const negWindow = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR, startsMinute: -1, endsMinute: 60, ...ACT,
  });
  ok("12a a NEGATIVE start is refused, naming the field and the range",
    !negWindow.ok && negWindow.code === "VALIDATION_ERROR" && negWindow.message === RANGE_START("-1"),
    why(negWindow));

  const hugeWindow = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR, startsMinute: 9 * 60, endsMinute: 78000, ...ACT,
  });
  ok("12b 78000 -- the value that was actually being written -- is refused as an ending",
    !hugeWindow.ok && hugeWindow.code === "VALIDATION_ERROR" && hugeWindow.message === RANGE_END("78000"),
    why(hugeWindow));

  const midnightStart = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR, startsMinute: 1440, endsMinute: 1440, ...ACT,
  });
  ok("12c 1440 as a START is refused -- that instant is the next day's minute 0",
    !midnightStart.ok && midnightStart.code === "VALIDATION_ERROR"
    && midnightStart.message === RANGE_START("1440"),
    why(midnightStart));

  const fractional = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR, startsMinute: 90.5, endsMinute: 13 * 60, ...ACT,
  });
  ok("12d a NON-INTEGER start is refused -- half a minute is not a minute",
    !fractional.ok && fractional.code === "VALIDATION_ERROR" && fractional.message === RANGE_START("90.5"),
    why(fractional));

  // ⚠ THE TRAP. Number("9am") is NaN, and NaN fails every comparison: `NaN > 1439` is false, `NaN < 0`
  // is false, and `endsMinute <= NaN` is false as well -- so a two-comparison range check AND the
  // ordering check both wave it through. Only Number.isInteger sees it.
  const nan = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR,
    startsMinute: Number("9am"), endsMinute: 13 * 60, ...ACT,
  });
  ok("12e NaN from a string the caller never parsed is refused, and is named as NaN",
    !nan.ok && nan.code === "VALIDATION_ERROR" && nan.message === RANGE_START("NaN"),
    why(nan));

  const rawString = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR,
    startsMinute: asMinute("0900"), endsMinute: 13 * 60, ...ACT,
  });
  ok("12f a STRING that looks like a time is refused, and the refusal shows it was a string",
    !rawString.ok && rawString.code === "VALIDATION_ERROR" && rawString.message === RANGE_START(`"0900"`),
    why(rawString));

  // ⚠ CONTROL: THE BOUND IS NOT "REFUSE EVERYTHING NEAR MIDNIGHT". A one-off session running 22:00 to
  // midnight is legitimate and must commit, or 12a-12f would be passing against an engine that had
  // simply stopped accepting changes.
  const toMidnight = await commitScheduleChange(admin, A, {
    kind: "extra_session", fromDate: FAR, toDate: FAR, startsMinute: 22 * 60, endsMinute: 1440, ...ACT,
  });
  ok("12g CONTROL: a change running TO midnight (1440) is accepted, so the bound is not just severity",
    toMidnight.ok, why(toMidnight));
  const { data: midnightRow } = await admin.from("practice_availability_exception")
    .select("starts_minute, ends_minute")
    .eq("id", toMidnight.ok ? toMidnight.data.exceptionId : "00000000-0000-4000-8000-000000000000")
    .maybeSingle();
  ok("12h and 1440 really is on disk -- the database's own check agrees with the engine's",
    midnightRow?.starts_minute === 1320 && midnightRow?.ends_minute === 1440, JSON.stringify(midnightRow));

  // ⚠ CONTROL: A WHOLE DAY IS STILL A LEGAL WINDOW. Leave carries no minutes at all, and a guard that
  // refused null would have taken every day of leave in the product with it.
  const wholeDayLeave = await commitScheduleChange(admin, A, {
    kind: "leave", fromDate: FAR2, toDate: FAR2, ...ACT,
  });
  ok("12i CONTROL: a whole-day change with NO window still commits -- null is not out of range",
    wholeDayLeave.ok, why(wholeDayLeave));

  // ⚠ AND NOTHING GOT THROUGH. The refusals are only worth having if the disk agrees, so every stored
  // window in the practice is read back rather than the rows these assertions happen to know about.
  const { data: allExceptions } = await admin.from("practice_availability_exception")
    .select("id, starts_minute, ends_minute").eq("workspace_id", wsA);
  const outOfRange = ((allExceptions ?? []) as { id: string; starts_minute: number | null; ends_minute: number | null }[])
    .filter(e => (e.starts_minute !== null
        && (!Number.isInteger(e.starts_minute) || e.starts_minute < 0 || e.starts_minute > 1439))
      || (e.ends_minute !== null
        && (!Number.isInteger(e.ends_minute) || e.ends_minute < 1 || e.ends_minute > 1440)));
  ok("12j no change in the whole practice holds a window that is not a time of day",
    (allExceptions ?? []).length > 0 && outOfRange.length === 0, JSON.stringify(outOfRange));

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
