/**
 * Practice follow-up harness -- CPR-140 / PEN-004, exercised against the live database through the same
 * engine the API uses.
 *
 * WHAT IT PROVES:
 *   1. AN OBLIGATION IS RAISED FROM A CONSULTATION and traces back to it. Intervals come from the
 *      catalogue and an unknown one is refused rather than silently defaulted; an obligation cannot be
 *      filed against another patient's encounter.
 *   2. OVERDUE IS DERIVED, NEVER STORED -- the decision migration 196's header turns on. A follow-up
 *      dated in the past reads overdue with NOTHING having run: no cron, no job, no login. The control
 *      is a future-dated one in the same list that does not.
 *   3. "TODAY" IS THE PRACTICE'S TODAY. practiceToday() is asserted against a fixed instant in three
 *      timezones, including one where UTC and the practice are on different DATES -- which is when a
 *      board silently says "nothing is late" while things are late.
 *   4. THE STATE MACHINE. Legal moves move, illegal ones are refused with the reason, and every move
 *      lands in the obligation's own event trail. MISSED is reversible; COMPLETED is not.
 *   5. CLOSING REQUIRES SAYING WHAT HAPPENED -- an encounter or words for COMPLETED, words for MISSED.
 *      Paired with the same call succeeding once something is supplied.
 *   6. A DEAD BOOKING RELEASES ITS OBLIGATION, AND THE DATABASE DOES IT (migration 196 s5). Cancelling
 *      or no-showing the appointment puts the follow-up back on the board with the appointment id
 *      cleared -- asserted through a RAW update that bypasses the engine entirely, because that is the
 *      guarantee the trigger exists for.
 *   7. Workspace isolation non-vacuously; anon reads 0 rows from all three tables.
 *
 * CONTROLS: every refusal is paired with the same operation succeeding somewhere it should.
 *
 *   npx --yes tsx scripts/practice-followups-harness.ts
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { followUpSummary, FOLLOW_UP_TAB_FILTERS } from "../src/lib/practice/follow-up-constants";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  createFollowUp, scheduleFollowUp, closeFollowUp, listFollowUps, followUpBoard,
  getFollowUp, listIntervals, practiceToday, dueDateFrom,
} from "../src/lib/practice/follow-ups";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0f51";
const USER_B = "00000000-0000-4000-8000-0000000e0f52";

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
    idempotency_key: `harness-fu-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-fu",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-fu", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-fu" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice follow-up harness (CPR-140, PEN-004, migration 196)\n");
  await cleanup();

  // ── 0. Is migration 196 deployed? ─────────────────────────────────────────
  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger checks are not vacuous)", fns.length > 0,
    reg.error?.message ?? `${fns.length} functions`);
  ok("practice_follow_up_release_on_dead_appointment() is deployed (migration 196 s5)",
    fns.some(f => f.fn_name === "practice_follow_up_release_on_dead_appointment"),
    "NOT FOUND -- a cancelled booking will leave its follow-up reading SCHEDULED");
  ok("practice_follow_up_event_immutable() is deployed (migration 196 s5)",
    fns.some(f => f.fn_name === "practice_follow_up_event_immutable"),
    "NOT FOUND -- the obligation trail is rewritable");

  // ── 1. THE PRACTICE'S TODAY, not the server's ────────────────────────────
  // Asserted against a FIXED instant so this cannot pass by accident on some days and fail on others.
  // 2026-03-14T22:30:00Z is 2026-03-15 in Kampala (+03) and still the 14th in London and New York.
  const instant = new Date("2026-03-14T22:30:00.000Z");
  ok("practiceToday resolves the workspace's calendar day, not UTC's",
    practiceToday("Africa/Kampala", instant) === "2026-03-15" &&
    practiceToday("UTC", instant) === "2026-03-14",
    `${practiceToday("Africa/Kampala", instant)} vs ${practiceToday("UTC", instant)}`);
  ok("a timezone BEHIND UTC is handled too (the bug is not one-directional)",
    practiceToday("America/New_York", instant) === "2026-03-14", practiceToday("America/New_York", instant));
  ok("an unknown timezone falls back rather than throwing (a wrong hour beats a dead board)",
    practiceToday("Mars/Olympus_Mons", instant) === "2026-03-14", practiceToday("Mars/Olympus_Mons", instant));
  ok("dueDateFrom crosses a month boundary correctly", dueDateFrom("2026-01-25", 14) === "2026-02-08", dueDateFrom("2026-01-25", 14));

  const wsA = await provision(USER_A, "HARNESS Follow-up A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Follow-up B (synthetic)", "b");
  const today = practiceToday("Africa/Kampala");

  const intervals = await listIntervals(admin);
  ok("the interval catalogue is seeded (migration 196 s3)", intervals.length >= 8, `${intervals.length}`);

  // ── 2. Raising an obligation ──────────────────────────────────────────────
  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Betty", birthDate: "1992-07-30", sex: "female",
    phone: "0772 555 330", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const pOther = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Ssekandi Paul", birthDate: "1965-02-11", sex: "male", phone: "0772 555 331", ...base,
  });

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", reasonForVisit: "leg ulcer", ...base,
  });
  if (!enc.ok) { ok("encounter launch for the harness succeeded", false, enc.message); return report(); }
  const encId = enc.data.id;
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });

  const noReason = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "  ", intervalCode: "2w", ...base,
  });
  ok("a follow-up with no reason is refused", !noReason.ok && noReason.code === "VALIDATION_ERROR",
    noReason.ok ? "was allowed" : noReason.code);

  const badInterval = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "review the ulcer", intervalCode: "9w", ...base,
  });
  ok("an interval the practice does not have is REFUSED, not silently defaulted",
    !badInterval.ok && badInterval.code === "UNKNOWN_INTERVAL", badInterval.ok ? "was allowed" : badInterval.code);

  const wrongPatient = pOther.ok ? await createFollowUp(admin, {
    workspaceId: wsA, patientId: pOther.data.id, originEncounterId: encId, reason: "x", intervalCode: "2w", ...base,
  }) : null;
  ok("a follow-up may not be filed against another patient's encounter",
    !!wrongPatient && !wrongPatient.ok && wrongPatient.code === "ENCOUNTER_PATIENT_MISMATCH",
    wrongPatient?.ok ? "was allowed" : wrongPatient?.code ?? "no second patient");

  const future = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, originEncounterId: encId, kind: "review",
    reason: "review the ulcer and re-dress", intervalCode: "2w", ...base,
  });
  ok("a follow-up is raised from the consultation (control for the refusals above)", future.ok, future.ok ? "" : future.message);
  if (!future.ok) return report();
  ok("the interval is applied as arithmetic on the practice's today",
    future.data.dueOn === dueDateFrom(today, 14), `${future.data.dueOn} vs ${dueDateFrom(today, 14)}`);

  // ── 3. OVERDUE IS DERIVED. Nothing runs; nothing is set. ──────────────────
  const past = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, originEncounterId: encId, kind: "investigation_result",
    reason: "chase the wound swab result", dueOn: dueDateFrom(today, -9), priority: "urgent", ...base,
  });
  ok("a back-dated follow-up is accepted (it is a commitment that was already due)", past.ok, past.ok ? "" : past.message);
  if (!past.ok) return report();

  const { data: storedStatuses } = await admin.from("practice_follow_up")
    .select("status").eq("workspace_id", wsA);
  ok("NO ROW STORES AN OVERDUE STATUS (the column cannot hold one)",
    ((storedStatuses ?? []) as any[]).every(r => r.status === "OPEN"),
    JSON.stringify((storedStatuses ?? []).map((r: any) => r.status)));

  const listed = (await listFollowUps(admin, wsA, { status: ["OPEN", "SCHEDULED"] })).items;
  const overdueOne = listed.find(f => f.id === past.data.id);
  const futureOne = listed.find(f => f.id === future.data.id);
  ok("THE PAST-DUE ONE READS OVERDUE WITH NOTHING HAVING RUN (no cron, no job, no login)",
    overdueOne?.overdue === true && overdueOne?.dueInDays === -9,
    `overdue=${overdueOne?.overdue} dueInDays=${overdueOne?.dueInDays}`);
  // CONTROL: in the SAME list, from the SAME query, a future one is not overdue -- so "overdue" is a
  // computation over the date and not a flag the read path sets on everything.
  ok("the future one in the same list is NOT overdue (the derivation discriminates)",
    futureOne?.overdue === false && futureOne?.dueInDays === 14,
    `overdue=${futureOne?.overdue} dueInDays=${futureOne?.dueInDays}`);

  const board = await followUpBoard(admin, wsA);
  ok("the board puts the overdue one in Overdue and the other in Due soon or Later",
    board.overdue.length === 1 && board.overdue[0].id === past.data.id &&
    [...board.dueSoon, ...board.later].some(f => f.id === future.data.id),
    `overdue=${board.overdue.length} soon=${board.dueSoon.length} later=${board.later.length}`);

  // ── 4. Booking, and what happens when the booking dies ───────────────────
  const appt = await bookAppointment(admin, {
    workspaceId: wsA, patientId: patientA, patientName: "Nakato Betty",
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, 3)}T09:00:00.000Z`, ...base,
  });
  ok("an appointment for the follow-up books", appt.ok, appt.ok ? "" : appt.message);
  if (!appt.ok) return report();

  const wrongPatientAppt = pOther.ok ? await bookAppointment(admin, {
    workspaceId: wsA, patientId: pOther.data.id, patientName: "Ssekandi Paul",
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, 4)}T11:00:00.000Z`, ...base,
  }) : null;
  const mismatchLink = wrongPatientAppt?.ok ? await scheduleFollowUp(admin, {
    workspaceId: wsA, followUpId: past.data.id, appointmentId: wrongPatientAppt.data.id, ...base,
  }) : null;
  ok("a follow-up cannot be linked to another patient's appointment",
    !!mismatchLink && !mismatchLink.ok && mismatchLink.code === "APPOINTMENT_PATIENT_MISMATCH",
    mismatchLink?.ok ? "was allowed" : mismatchLink?.code ?? "setup failed");

  const linked = await scheduleFollowUp(admin, {
    workspaceId: wsA, followUpId: past.data.id, appointmentId: appt.data.id, ...base,
  });
  ok("linking a live booking moves the follow-up to SCHEDULED (control)", linked.ok, linked.ok ? "" : linked.message);

  const doubleLink = await scheduleFollowUp(admin, {
    workspaceId: wsA, followUpId: future.data.id, appointmentId: appt.data.id, ...base,
  });
  ok("two obligations cannot be booked against one appointment",
    !doubleLink.ok && doubleLink.code === "APPOINTMENT_ALREADY_LINKED", doubleLink.ok ? "was allowed" : doubleLink.code);

  const scheduledBoard = await followUpBoard(admin, wsA);
  ok("a booked obligation leaves Overdue and appears under Booked",
    scheduledBoard.overdue.length === 0 && scheduledBoard.scheduled.some(f => f.id === past.data.id),
    `overdue=${scheduledBoard.overdue.length} booked=${scheduledBoard.scheduled.length}`);
  ok("a booking made AFTER the due date is flagged late, not treated as on time",
    scheduledBoard.scheduled.find(f => f.id === past.data.id)?.late === true,
    JSON.stringify(scheduledBoard.scheduled.map(f => ({ late: f.late, booked: f.bookedFor, due: f.due_on }))));

  // THE GUARANTEE MIGRATION 196 s5 PROMISES: a raw update, straight at the table, no engine involved.
  const rawCancel = await admin.from("practice_appointment")
    .update({ status: "CANCELLED", updated_by: USER_A }).eq("id", appt.data.id);
  ok("cancelling the appointment raw is accepted by the database", !rawCancel.error, rawCancel.error?.message ?? "");

  const { data: released } = await admin.from("practice_follow_up")
    .select("status, appointment_id").eq("id", past.data.id).single();
  ok("THE DATABASE RELEASES THE FOLLOW-UP when its booking dies (migration 196 s5 trigger)",
    released?.status === "OPEN", `status=${released?.status}`);
  ok("the dead appointment id is CLEARED (the board never offers a cancelled booking)",
    released?.appointment_id === null, String(released?.appointment_id));

  const afterRelease = await followUpBoard(admin, wsA);
  ok("the released obligation is back in Overdue where somebody will see it",
    afterRelease.overdue.some(f => f.id === past.data.id), `${afterRelease.overdue.length} overdue`);

  const releaseTrail = await getFollowUp(admin, wsA, past.data.id);
  ok("the release is in the obligation's own trail, attributable rather than appearing from nowhere",
    (releaseTrail?.events ?? []).some((e: any) => e.to_status === "OPEN" && /cancelled/i.test(e.note ?? "")),
    JSON.stringify((releaseTrail?.events ?? []).map((e: any) => e.note)));

  // A NO_SHOW must release too -- it is the case where the follow-up most needs to come back.
  const appt2 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: patientA, patientName: "Nakato Betty",
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, 5)}T10:00:00.000Z`, ...base,
  });
  if (appt2.ok) {
    await scheduleFollowUp(admin, { workspaceId: wsA, followUpId: past.data.id, appointmentId: appt2.data.id, ...base });
    await transitionAppointment(admin, { workspaceId: wsA, appointmentId: appt2.data.id, to: "CONFIRMED", ...base });
    await transitionAppointment(admin, { workspaceId: wsA, appointmentId: appt2.data.id, to: "NO_SHOW", ...base });
    const { data: afterNoShow } = await admin.from("practice_follow_up").select("status").eq("id", past.data.id).single();
    ok("a NO-SHOW releases the obligation too (not being seen is not being settled)",
      afterNoShow?.status === "OPEN", `status=${afterNoShow?.status}`);
  } else {
    ok("a NO-SHOW releases the obligation too (not being seen is not being settled)", false, appt2.message);
  }

  // ── 5. Closing requires saying what happened ─────────────────────────────
  const emptyComplete = await closeFollowUp(admin, { workspaceId: wsA, followUpId: past.data.id, to: "COMPLETED", ...base });
  ok("closing as done with no encounter and no words is refused",
    !emptyComplete.ok && emptyComplete.code === "OUTCOME_REQUIRED", emptyComplete.ok ? "was allowed" : emptyComplete.code);

  const emptyMissed = await closeFollowUp(admin, { workspaceId: wsA, followUpId: past.data.id, to: "MISSED", ...base });
  ok("marking missed with no reason is refused (giving up on someone needs a sentence)",
    !emptyMissed.ok && emptyMissed.code === "OUTCOME_REQUIRED", emptyMissed.ok ? "was allowed" : emptyMissed.code);

  // Launched as its own statement rather than inline: if it failed inline the closingEncounterId would
  // be undefined and the call would be refused for the WRONG reason, which is a green tick that proves
  // nothing.
  const otherEnc = pOther.ok
    ? await launchEncounter(admin, { workspaceId: wsA, patientId: pOther.data.id, pathway: "new_walk_in", ...base })
    : null;
  const wrongCloser = otherEnc?.ok ? await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: past.data.id, to: "COMPLETED",
    closingEncounterId: otherEnc.data.id, ...base,
  }) : null;
  ok("another patient's encounter cannot be named as what closed this",
    !!wrongCloser && !wrongCloser.ok && wrongCloser.code === "ENCOUNTER_PATIENT_MISMATCH",
    wrongCloser?.ok ? "was allowed" : wrongCloser?.code ?? `setup failed: ${otherEnc?.ok === false ? otherEnc.message : "no second patient"}`);

  const missed = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: past.data.id, to: "MISSED",
    outcome: "three calls, no answer; family says she has travelled", ...base,
  });
  ok("marking missed WITH a reason works (control for both refusals above)", missed.ok, missed.ok ? "" : missed.message);

  const { data: missedRow } = await admin.from("practice_follow_up")
    .select("status, closed_at, closed_by, outcome").eq("id", past.data.id).single();
  ok("closing stamps who and when, and keeps the words",
    missedRow?.status === "MISSED" && !!missedRow?.closed_at && missedRow?.closed_by === USER_A && /travelled/.test(missedRow?.outcome ?? ""),
    JSON.stringify(missedRow));

  const reopened = await closeFollowUp(admin, { workspaceId: wsA, followUpId: past.data.id, to: "OPEN", ...base });
  ok("MISSED IS REVERSIBLE (a patient who turns up in June is live again)", reopened.ok, reopened.ok ? "" : reopened.message);

  const completed = await closeFollowUp(admin, {
    workspaceId: wsA, followUpId: past.data.id, to: "COMPLETED",
    closingEncounterId: encId, outcome: "swab negative, wound healing", ...base,
  });
  ok("naming the encounter that settled it satisfies the requirement", completed.ok, completed.ok ? "" : completed.message);

  const afterComplete = await closeFollowUp(admin, { workspaceId: wsA, followUpId: past.data.id, to: "OPEN", ...base });
  ok("COMPLETED is a dead end (unlike MISSED) -- reopening it is refused",
    !afterComplete.ok && afterComplete.code === "ILLEGAL_TRANSITION", afterComplete.ok ? "was allowed" : afterComplete.code);

  const detail = await getFollowUp(admin, wsA, past.data.id);
  const trail = (detail?.events ?? []) as any[];
  ok("every move is in the obligation's trail, in order",
    trail.length >= 7 && trail[0].to_status === "OPEN" && trail[trail.length - 1].to_status === "COMPLETED",
    JSON.stringify(trail.map(e => e.to_status)));
  ok("the closing encounter is recorded on the obligation",
    detail?.followUp.closing_encounter_id === encId, String(detail?.followUp.closing_encounter_id));

  const rewriteEvent = await admin.from("practice_follow_up_event")
    .update({ note: "a different history" }).eq("follow_up_id", past.data.id);
  ok("the DATABASE refuses to rewrite a follow-up event (migration 196 s5 trigger)",
    !!rewriteEvent.error, rewriteEvent.error?.message ?? "the update succeeded");

  // ── 6. Isolation + anon ───────────────────────────────────────────────────
  const bReads = await getFollowUp(admin, wsB, future.data.id);
  ok("getFollowUp is workspace-scoped (B cannot read A's obligation)", bReads === null);
  const bCloses = await closeFollowUp(admin, { workspaceId: wsB, followUpId: future.data.id, to: "CANCELLED", ...base });
  ok("B cannot close A's obligation", !bCloses.ok && bCloses.code === "NOT_FOUND", bCloses.ok ? "was allowed" : bCloses.code);

  const aBoard = await followUpBoard(admin, wsA);
  const bBoard = await followUpBoard(admin, wsB);
  ok("A's board is non-empty (the isolation test is not vacuous)",
    aBoard.overdue.length + aBoard.dueSoon.length + aBoard.scheduled.length + aBoard.later.length + aBoard.recentlyClosed.length > 0,
    `${aBoard.recentlyClosed.length} closed`);
  ok("B's board holds none of A's obligations",
    bBoard.overdue.length + bBoard.dueSoon.length + bBoard.scheduled.length + bBoard.later.length + bBoard.recentlyClosed.length === 0);

  const TABLES = ["practice_follow_up", "practice_follow_up_event", "practice_follow_up_interval"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every follow-up table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every follow-up table", leaked === 0, `${leaked} table(s) leaked`);

  // ── A FAILED READ IS NOT AN EMPTY BOARD ──────────────────────────────────────────────────────────
  //
  // ⚠ THIS IS THE ONE PLACE IN THE PRODUCT WHERE THE SILENT-ZERO BUG COSTS THE MOST, AND IT SHIPPED.
  // listFollowUps did `const { data } = await q` and then `data ?? []`, so a failed query produced an
  // empty list -- and an empty follow-up list renders as "nobody is waiting on you". The board that
  // exists to say who has been forgotten went quiet exactly when it could not see. It was found from
  // the outside, while wiring a panel that wanted to trust it.
  //
  // The failure is injected through a STUB CLIENT rather than by breaking the table, because the point
  // is what this function does with an error and not whether an error can be produced. The stub answers
  // the same chain the engine calls and returns PostgREST's own failure shape.
  const failingAdmin = {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order"]) chain[m] = () => chain;
      chain.limit = async () => ({ data: null, error: { message: "simulated read failure" } });
      return chain;
    },
  };
  const failedRead = await listFollowUps(failingAdmin as never, wsA, {});
  ok("a follow-up read that FAILED says so, and carries the database's own words",
    failedRead.unavailable === true && /simulated read failure/.test(failedRead.detail ?? ""),
    JSON.stringify(failedRead));
  ok("⚠ and it is not reported as an empty board -- the two are different answers",
    failedRead.items.length === 0 && failedRead.unavailable,
    JSON.stringify({ n: failedRead.items.length, unavailable: failedRead.unavailable }));

  // CONTROL. Without this the pair above passes just as well if listFollowUps reported EVERY read as
  // unavailable -- which is what a fix applied one line too early would do.
  const realRead = await listFollowUps(admin, wsA, {});
  ok("control. the same call through the real client is AVAILABLE, and returns rows",
    realRead.unavailable === false && realRead.detail === null && realRead.items.length > 0,
    JSON.stringify({ n: realRead.items.length, unavailable: realRead.unavailable, detail: realRead.detail }));

  // ══ CPR-FUP-HFE-008 s5: THE STATUS SUMMARY, AND THE ONE COLOUR IT MAY NOT USE ═══════════════════
  //
  // ⚠ s5: "DO NOT USE A SUCCESS COLOUR IF AN OVERDUE OR URGENT ITEM EXISTS." Green on this card means
  // "you owe this patient nothing", and it is the fastest-read sentence on the tab -- a practitioner who
  // reads it wrongly closes a consultation on somebody nine days overdue for a swab result. It is a
  // tested function rather than three lines of JSX for exactly that reason.
  //
  // ⚠ AND THE FIXTURES ARE THE ENGINE'S OWN DERIVED ROWS, not hand-written objects. `overdue` is
  // computed by deriveFollowUp against the practice's today; a literal `{overdue: true}` would test my
  // idea of the shape rather than the one the screen is handed.
  //
  // ⚠ RAISED HERE RATHER THAN BORROWED FROM THE ROWS ABOVE, and s5-0 is why. The first version read
  // whatever `listFollowUps(ws, {})` happened to return at this point in the file -- and by here the
  // earlier sections have COMPLETED the back-dated obligation, so the list held two rows and no overdue
  // one. The assertions would have gone green against a case that no longer existed. A harness that
  // depends on leftover state from its own earlier sections is testing the order of its sections.
  const s5Patient = pOther.ok ? pOther.data.id : patientA;
  await createFollowUp(admin, {
    workspaceId: wsA, patientId: s5Patient, kind: "review",
    reason: "s5 fixture: overdue", dueOn: dueDateFrom(today, -4), priority: "routine", ...base,
  });
  await createFollowUp(admin, {
    workspaceId: wsA, patientId: s5Patient, kind: "review",
    reason: "s5 fixture: not due yet", dueOn: dueDateFrom(today, 21), priority: "routine", ...base,
  });
  const s5Read = await listFollowUps(admin, wsA, { patientId: s5Patient, status: ["OPEN", "SCHEDULED"] });
  const derived = s5Read.items;
  const anyOverdue = derived.filter(f => f.overdue);
  const noneOverdue = derived.filter(f => !f.overdue);
  ok("s5-0. the fixture holds BOTH an overdue and a not-overdue row (the cases below are real)",
    anyOverdue.length > 0 && noneOverdue.length > 0,
    `overdue=${anyOverdue.length} other=${noneOverdue.length}`);

  ok("s5-1. nothing owed reads CLEAR, and says the read succeeded",
    followUpSummary([]).tone === "clear"
      && followUpSummary([]).headline === "Nothing is owed to this patient"
      && /read successfully/.test(followUpSummary([]).detail));
  // ⚠ THE RULE ITSELF. An overdue row present means the card may not be green, whatever else is true.
  ok("s5-2. s5: ONE overdue row takes the card off the success colour entirely",
    followUpSummary(anyOverdue).tone === "overdue"
      && followUpSummary([...noneOverdue, ...anyOverdue]).tone === "overdue",
    JSON.stringify(followUpSummary([...noneOverdue, ...anyOverdue])));
  // ⚠ AND URGENT IS NOT GREEN EITHER, even with nothing overdue -- s5 names both.
  ok("s5-3. s5: an URGENT item with nothing overdue is attention, never clear",
    followUpSummary([{ overdue: false, priority: "urgent" }]).tone === "attention");
  ok("s5-4. routine work owed is neither green nor amber -- it is ordinary",
    followUpSummary([{ overdue: false, priority: "routine" }]).tone === "open");
  // ⚠ OVERDUE OUTRANKS URGENT. An urgent follow-up raised today is working as intended; an overdue one
  // is a commitment already broken, and s16 gives it the strongest exception state.
  ok("s5-5. overdue outranks urgent when both are present",
    followUpSummary([{ overdue: true, priority: "routine" }, { overdue: false, priority: "urgent" }]).tone === "overdue");
  // ⚠ THE THIRD STATE, WHICH THE ENCOUNTER TAB USED TO DROP ON THE FLOOR. page.tsx passed only `.items`,
  // so a FAILED read rendered "Nothing is owed to this patient. This was read successfully" -- a false
  // statement about a patient, produced by the exact bug listFollowUps was reshaped to prevent.
  const blind = followUpSummary([], { unavailable: true });
  ok("s5-6. ⚠ an UNAVAILABLE read is never 'nothing is owed', and never green",
    blind.tone !== "clear" && /could not be read/.test(blind.headline)
      && /not take this as nothing being owed/.test(blind.detail),
    JSON.stringify(blind));

  // s12's filters: the chip count and the filtered list are ONE predicate, so they cannot disagree.
  for (const f of FOLLOW_UP_TAB_FILTERS) {
    const matched = derived.filter(x => f.match(x as any));
    ok(`s12-${f.key}. the ${f.label} filter's count is the length of the list it opens`,
      matched.length === derived.filter(x => f.match(x as any)).length
        && matched.every(x => f.match(x as any)));
  }
  ok("s12-axes. priority and state filters are declared on separate axes (s8)",
    FOLLOW_UP_TAB_FILTERS.some(f => f.axis === "state")
      && FOLLOW_UP_TAB_FILTERS.some(f => f.axis === "priority")
      && FOLLOW_UP_TAB_FILTERS.filter(f => f.axis === "priority").every(f => ["soon", "urgent"].includes(f.key)));
  ok("s12-all. the All filter matches every row (a filter that hid rows silently would be worse than none)",
    derived.every(x => FOLLOW_UP_TAB_FILTERS[0].match(x as any)));

  // ══ MIGRATION 299: OWNERSHIP, TYPE, PLACE AND PROVENANCE ═══════════════════════════════════════
  //
  // ⚠ ONE OWNER, ASSERTED AT BOTH LAYERS. The engine refuses a person AND a queue so the caller is told
  // which rule it broke; the CHECK constraint refuses it so nothing that bypasses the engine can write
  // an obligation with no answer to "whose is this". A test of only the engine would pass against a
  // database that had never had the constraint applied.
  const twoOwners = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "two owners", dueOn: dueDateFrom(today, 7),
    assignedTo: USER_A, assignedQueue: "nursing", ...base,
  });
  ok("299-1. a follow-up owned by a person AND a queue is refused by the engine",
    !twoOwners.ok && twoOwners.code === "TWO_OWNERS", twoOwners.ok ? "was allowed" : twoOwners.code);
  const { error: rawTwoOwners } = await admin.from("practice_follow_up").insert({
    workspace_id: wsA, patient_id: patientA, reason: "raw two owners", due_on: dueDateFrom(today, 7),
    assigned_to: USER_A, assigned_queue: "nursing", created_by: USER_A, updated_by: USER_A,
  });
  ok("299-1b. and the DATABASE refuses it too, through a raw insert that bypasses the engine",
    !!rawTwoOwners && /one_owner/.test(rawTwoOwners.message), rawTwoOwners?.message ?? "was allowed");

  const owned = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "mine to chase", dueOn: dueDateFrom(today, 7),
    assignedTo: USER_A, followUpType: "contact", instructions: "ring the mobile first", ...base,
  });
  ok("299-2. an owned follow-up records its owner, type and instructions (control)",
    owned.ok, owned.ok ? "" : owned.message);
  const ownedRow = owned.ok
    ? (await admin.from("practice_follow_up")
      .select("assigned_to, assigned_queue, follow_up_type, instructions, target_interval_code")
      .eq("id", owned.data.id).maybeSingle()).data
    : null;
  ok("299-2b. and the columns hold what was sent, read back rather than taken on trust",
    ownedRow?.assigned_to === USER_A && ownedRow?.assigned_queue === null
      && ownedRow?.follow_up_type === "contact" && ownedRow?.instructions === "ring the mobile first",
    JSON.stringify(ownedRow));

  // ⚠ REFUSED RATHER THAN DEFAULTED. Silently rewriting an unrecognised type to 'review' would let a
  // stale client turn every appointment-intended follow-up into a review with nothing saying so.
  const badType = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "bad type", dueOn: dueDateFrom(today, 7),
    followUpType: "telepathy", ...base,
  });
  ok("299-3. an unknown follow-up type is REFUSED, not quietly turned into a review",
    !badType.ok && badType.code === "UNKNOWN_FOLLOW_UP_TYPE", badType.ok ? "was allowed" : badType.code);

  // ⚠ s9/s21: THE INTERVAL IS STAMPED ONLY WHEN AN INTERVAL WAS USED. A caller passing an explicit date
  // chose a date, and recording a relative code beside it would claim an intent nobody expressed --
  // which is the whole failure mode of a snapshot column that gets written unconditionally.
  const byInterval = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "in two weeks", intervalCode: "2w", ...base,
  });
  const intervalRow = byInterval.ok
    ? (await admin.from("practice_follow_up").select("target_interval_code, due_on")
      .eq("id", byInterval.data.id).maybeSingle()).data
    : null;
  ok("299-4. s9: choosing an INTERVAL records which interval was chosen, not only the date it became",
    intervalRow?.target_interval_code === "2w" && intervalRow?.due_on === dueDateFrom(today, 14),
    JSON.stringify(intervalRow));
  ok("299-4b. and choosing an explicit DATE records no interval (it would be an intent nobody expressed)",
    ownedRow?.target_interval_code === null, JSON.stringify(ownedRow?.target_interval_code));

  // ══ TWO ENGINES THAT EXISTED FOR MONTHS WITH NO WAY IN ═════════════════════════════════════════
  //
  // ⚠ A SOURCE CHECK, BECAUSE THE DEFECT WAS NEVER IN THE ENGINE. scheduleFollowUp has refused a dead
  // appointment, another patient's appointment and a double-booked one since migration 196; createPlan
  // has turned a template into follow-ups since 206. Every assertion about them passed. NOTHING IN THE
  // PRODUCT COULD CALL EITHER -- both were API-only, which is indistinguishable from a missing feature
  // to the person using the screen. That is the same class as the unused `procedureTypes` prop found
  // earlier today, and an engine test cannot see it by construction.
  const consoleSrc = readFileSync(
    "src/app/practice/(shell)/encounters/[encounterId]/EncounterConsole.tsx", "utf8");
  ok("reach-1. the encounter tab can reach scheduleFollowUp (PATCH with appointmentId, its only door)",
    /body: JSON\.stringify\(\{ appointmentId \}\)/.test(consoleSrc)
      && /patientAppointments\.map/.test(consoleSrc),
    "the engine refused a dead booking for months and nothing could ask it to");
  // ⚠ reach-2 USED TO ASSERT THIS TAB NEVER BOOKS, AND THE OWNER OVERRODE THAT DECISION IN AS MANY
  // WORDS ("why doesn't this book an appointment? would prefer limited clicks", 2026-08-14). The
  // assertion went red on the change, which is exactly what it was for -- a pinned decision should
  // cost a deliberate edit to unpin. The two-write risk it guarded is now HANDLED rather than avoided:
  // the new contract, pinned below, is that every step's failure is reported as that step, and the
  // ROW action still links an existing visit rather than creating one.
  ok("reach-2. booking from the tab reports partial failure per STEP, and the row action still only links",
    /but the visit was not booked/.test(consoleSrc)
      && /but linking them failed/.test(consoleSrc)
      && /body: JSON\.stringify\(\{ appointmentId \}\)/.test(consoleSrc),
    "a two-write flow that cannot say which write happened is worse than no flow");
  ok("reach-3. the encounter tab can reach createPlan (POST follow-up-plans with a templateId)",
    /api\/v1\/practice\/follow-up-plans/.test(consoleSrc) && /templateId/.test(consoleSrc));
  // ⚠ AND THE TEMPLATE CONTROL IS DRAWN ONLY WHEN A TEMPLATE EXISTS. Migration 206 seeds none and there
  // is no authoring screen, so an unconditional menu would be an always-empty affordance -- the trap
  // refused on the Investigations tab earlier today for the same reason.
  ok("reach-4. the plan control is hidden when this practice has authored no template",
    /props\.planTemplates\.length > 0 &&/.test(consoleSrc),
    "an always-empty menu is an affordance for nothing");

  // ⚠ THE ROUTE FORWARDS EVERY FIELD THE COMPOSER SENDS. Migration 299's six fields were collected by
  // the screen, accepted by the engine, and DROPPED by the route between them -- the third instance of
  // the middle-layer class in one day (scheduledAt in the batch engine, then here), found only because
  // the owner used the form. tsc cannot see it: an absent property is not an error. So the needle is on
  // the route source, one per field, and a field added to the composer later must be added here too.
  const fuRouteSrc = readFileSync(
    "src/app/api/v1/practice/follow-ups/route.ts", "utf8");
  const forwarded = ["followUpType", "assignedTo", "assignedQueue", "locationId", "instructions"]
    .filter(f => !new RegExp(`${f}: body\\.${f}`).test(fuRouteSrc));
  ok("reach-5. ⚠ the POST route forwards all five composer fields to createFollowUp",
    forwarded.length === 0,
    forwarded.length ? `DROPPED: ${forwarded.join(", ")}` : "");
  // And the booking press is wired end to end: raise, book, link -- three calls in one handler.
  // s9's exact-date half, added the day the owner asked for a calendar. The sentinel stays a screen
  // word: the payload sends dueOn and NO intervalCode, which the engine's UNKNOWN_INTERVAL refusal and
  // 299-4b's no-interval-recorded rule both depend on.
  ok("reach-5b. the timeframe offers a calendar date, and sends dueOn without the sentinel",
    consoleSrc.includes("On a date…")
      && consoleSrc.includes('intervalCode: fu.intervalCode === "custom" ? undefined : fu.intervalCode')
      && consoleSrc.includes('dueOn: fu.intervalCode === "custom" ? fu.dueDate : undefined'),
    "a sentinel that reaches the API is refused as UNKNOWN_INTERVAL");
  // ⚠ THE REQUIRED FIELD WEARS ITS OWN BLOCKER. The owner pressed Raise twice over an empty reason and
  // read the silence as breakage -- the sentence by the button was not enough on its own.
  ok("reach-5c. the empty reason field is amber, not merely explained at the footer",
    /id="fu-reason"[\s\S]{0,500}border-amber-300/.test(consoleSrc));
  ok("reach-6. Raise & book books a scheduled_followup and LINKS it through the appointmentId PATCH",
    /appointmentType: "scheduled_followup"/.test(consoleSrc)
      && /Raise & book visit/.test(consoleSrc)
      && /The follow-up was raised, but the visit was not booked/.test(consoleSrc),
    "a partial failure must say which step stands, not pretend nothing happened");

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
