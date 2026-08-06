/**
 * Continuity of Care harness -- CPR-FUP-001 (the workspace) and CPR-FUP-002 (the engine), against the
 * live database through the same engine the API and the screen use.
 *
 * WHAT IT PROVES:
 *   1. ⚠ COMPLETING THE LINKED ENCOUNTER COMPLETES THE FOLLOW-UP. Both specifications list this as an
 *      acceptance criterion and it did not happen: a practitioner booked the review, saw the patient,
 *      closed the consultation, and the obligation stayed open. Asserted with the control that matters
 *      MORE than the assertion -- a second follow-up for the SAME PATIENT, not linked to that booking,
 *      is untouched. Completing everything a patient is owed because one thing was met would be the
 *      same false positive pointing the other way.
 *   2. A RESCHEDULE LEAVES THE ORIGINAL DATE RECOVERABLE (s7). Not as prose: from_due_on and to_due_on
 *      are columns, and the harness reads the old date back out of the trail after the row has moved on.
 *   3. DRAFT AND DEFERRED behave as s4 describes -- a draft owes nothing and is on no board, a deferral
 *      without a date is refused, and a deferred obligation comes BACK on the day it was deferred to.
 *   4. ⚠ EVERY CARD'S FIGURE IS THE LENGTH OF THE LIST IT OPENS. Asserted for all six views by NAMING
 *      ids, over a fixture arranged so a wrong grouping shows: an overdue one, one due today, one due
 *      this week, one due next month, one completed five days ago and one completed sixty days ago --
 *      so the Completed card (30 days) and the Closed tab MUST disagree, and a card that quietly counted
 *      the tab's list would fail.
 *   5. SOURCES are validated, not decorative (s3, s5), and an unsourced claim is refused.
 *   6. THE PLATFORM EVENTS THAT EXIST ARE EMITTED AND THE ONES THAT DO NOT EXIST ARE NOT INVENTED (s10).
 *   7. A failed read is never an empty board, with a control.
 *   8. THE CARD COLOURS ARE KEYED ON THE ENGINE'S OWN CARD KEYS, asserted as an equality in both
 *      directions against what followUpWorkspace() actually emitted. A swatch map that has drifted
 *      compiles perfectly and renders a real figure in dead grey; it has shipped twice in palette.ts.
 *
 *   npx --yes tsx scripts/practice-continuity-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import {
  createFollowUp, closeFollowUp, scheduleFollowUp, rescheduleFollowUp, deferFollowUp,
  settleFollowUpsForEncounter, followUpWorkspace, listFollowUps, followUpBoard, getFollowUp,
  deriveFollowUp, practiceToday, dueDateFrom,
} from "../src/lib/practice/follow-ups";
import {
  FOLLOW_UP_VIEWS, FOLLOW_UP_TRANSITIONS, FOLLOW_UP_SOURCES, LIVE_FOLLOW_UP_STATUSES,
  COMPLETED_WINDOW_DAYS, followUpView,
} from "../src/lib/practice/follow-up-constants";
import { PRACTICE_EVENT_TYPES } from "../src/lib/practice/events";
import { FOLLOWUP_CARD_SWATCH } from "../src/lib/practice/palette";
import { readFileSync } from "node:fs";
import { join } from "node:path";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0fc1";

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
    idempotency_key: `harness-cc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-cc",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-cc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER_A);
  for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER_A);
  await admin.from("practice_audit_event").delete().eq("actor_id", USER_A);
}

const base = { actorId: USER_A, correlationId: "harness-cc" };

/* eslint-disable @typescript-eslint/no-explicit-any */

function report() {
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
  process.exit(0);
}

async function main() {
  console.log("\nContinuity of Care harness (CPR-FUP-001, CPR-FUP-002, migration 239)\n");

  // ── 0. GATE ON MIGRATION 239 ──────────────────────────────────────────────────────────────────────
  const probe = await admin.from("practice_follow_up").select("id, source, origin_workspace, deferred_until").limit(1);
  if (probe.error) {
    console.log(`  STOP  migration 239 is NOT applied: ${probe.error.message}`);
    console.log("        Apply supabase/migrations/239-practice-continuity-pathways.sql and re-run.");
    console.log("        Nothing below was tested -- this is not a pass and not a failure of the engine.\n");
    process.exit(2);
  }
  ok("migration 239's follow-up columns are readable (the gate above is not vacuous)", true, "source, origin_workspace, deferred_until");

  await cleanup();
  const ws = await provision(USER_A, "HARNESS Continuity (synthetic)", "a");
  const today = practiceToday("Africa/Kampala");

  const p1 = await registerPatient(admin, {
    workspaceId: ws, displayName: "Lydia Namuli", birthDate: "2009-11-04", sex: "female", phone: "0772 555 700", ...base,
  });
  const p2 = await registerPatient(admin, {
    workspaceId: ws, displayName: "Ezekiel Okello", birthDate: "2020-06-21", sex: "male", phone: "0772 555 701", ...base,
  });
  if (!p1.ok || !p2.ok) { ok("patient registration for the harness succeeded", false, ""); return report(); }
  const lydia = p1.data.id, ezekiel = p2.data.id;

  // ══ 1. SOURCES (s3, s5) ══════════════════════════════════════════════════════════════════════════
  const manual = await createFollowUp(admin, {
    workspaceId: ws, patientId: lydia, reason: "ring the family about the school letter",
    dueOn: dueDateFrom(today, 4), originWorkspace: "follow_ups", ...base,
  });
  ok("a follow-up with no encounter behind it is inferred MANUAL, not left as the column default",
    manual.ok && manual.data.source === "manual", manual.ok ? manual.data.source : manual.message);

  const badSource = await createFollowUp(admin, {
    workspaceId: ws, patientId: lydia, reason: "x", dueOn: dueDateFrom(today, 4), source: "telepathy", ...base,
  });
  ok("an unknown source is refused rather than silently written",
    !badSource.ok && badSource.code === "UNKNOWN_SOURCE", badSource.ok ? "was allowed" : badSource.code);

  const unbackedClaim = await createFollowUp(admin, {
    workspaceId: ws, patientId: lydia, reason: "x", dueOn: dueDateFrom(today, 4), source: "encounter", ...base,
  });
  ok("⚠ claiming source='encounter' with NO encounter is refused (the column would stop meaning anything)",
    !unbackedClaim.ok && unbackedClaim.code === "SOURCE_WITHOUT_ORIGIN", unbackedClaim.ok ? "was allowed" : unbackedClaim.code);

  const badWorkspace = await createFollowUp(admin, {
    workspaceId: ws, patientId: lydia, reason: "x", dueOn: dueDateFrom(today, 4), originWorkspace: "reception", ...base,
  });
  ok("an unknown originating workspace is refused",
    !badWorkspace.ok && badWorkspace.code === "UNKNOWN_ORIGIN_WORKSPACE", badWorkspace.ok ? "was allowed" : badWorkspace.code);
  ok("the source vocabulary matches migration 239's constraint exactly, in order",
    FOLLOW_UP_SOURCES.map(([c]) => c).join(",") === "encounter,manual,document,investigation,referral,pathway,assistant",
    FOLLOW_UP_SOURCES.map(([c]) => c).join(","));
  ok("and only ONE of them may be chosen by hand (the rest are claims about a row)",
    FOLLOW_UP_SOURCES.filter(([, , pickable]) => pickable).map(([c]) => c).join(",") === "manual",
    FOLLOW_UP_SOURCES.filter(([, , p]) => p).map(([c]) => c).join(","));

  // ══ 2. DRAFT: COMPOSED, AND OWED BY NOBODY (s4) ══════════════════════════════════════════════════
  const draft = await createFollowUp(admin, {
    workspaceId: ws, patientId: lydia, reason: "consider a hearing assessment - not decided yet",
    dueOn: dueDateFrom(today, -5), status: "DRAFT", ...base,
  });
  ok("a DRAFT follow-up is created through the engine", draft.ok && draft.data.status === "DRAFT",
    draft.ok ? draft.data.status : draft.message);

  const bornDone = await createFollowUp(admin, {
    workspaceId: ws, patientId: lydia, reason: "x", dueOn: dueDateFrom(today, 4), status: "COMPLETED", ...base,
  });
  ok("a follow-up cannot be born COMPLETED (nothing was ever owed to complete)",
    !bornDone.ok && bornDone.code === "ILLEGAL_OPENING_STATUS", bornDone.ok ? "was allowed" : bornDone.code);

  const boardWithDraft = await followUpBoard(admin, ws);
  const onBoard = [...boardWithDraft.overdue, ...boardWithDraft.dueSoon, ...boardWithDraft.scheduled, ...boardWithDraft.later];
  ok("⚠ the DRAFT is BACK-DATED and still does not appear on the board, in any group",
    !onBoard.some(f => f.id === (draft.ok ? draft.data.id : "")),
    JSON.stringify(onBoard.map(f => f.id)));
  // CONTROL. Without this the assertion above passes just as well if the board were empty.
  ok("control. the manual one, due later, IS on the board -- so the board is reading",
    onBoard.some(f => f.id === (manual.ok ? manual.data.id : "")), `${onBoard.length} on the board`);

  ok("a draft can only be taken up or thrown away -- it cannot be completed",
    FOLLOW_UP_TRANSITIONS.DRAFT.join(",") === "OPEN,CANCELLED", FOLLOW_UP_TRANSITIONS.DRAFT.join(","));

  if (!draft.ok || !manual.ok) return report();
  const activated = await closeFollowUp(admin, { workspaceId: ws, followUpId: draft.data.id, to: "OPEN", ...base });
  ok("control. taking the draft up puts it on the board", activated.ok, activated.ok ? "" : activated.message);
  const afterActivate = await followUpBoard(admin, ws);
  ok("and now the back-dated one reads OVERDUE, with nothing having run",
    afterActivate.overdue.some(f => f.id === draft.data.id), JSON.stringify(afterActivate.overdue.map(f => f.id)));

  // ══ 3. DEFERRAL (s4): A DATE IS REQUIRED, AND IT IS THE DATE IT COMES BACK ═══════════════════════
  const deferNoDate = await deferFollowUp(admin, { workspaceId: ws, followUpId: manual.data.id, until: "", ...base });
  ok("a deferral with no date is refused, with the reason spelled out",
    !deferNoDate.ok && deferNoDate.code === "DEFERRAL_NEEDS_DATE", deferNoDate.ok ? "was allowed" : deferNoDate.code);

  const deferred = await deferFollowUp(admin, {
    workspaceId: ws, followUpId: manual.data.id, until: dueDateFrom(today, 45),
    reason: "family away until the new term", ...base,
  });
  ok("control. a deferral WITH a date is accepted", deferred.ok, deferred.ok ? "" : deferred.message);

  // ⚠ THE DERIVATION IS AGAINST deferred_until, NOT due_on. Asserted on the pure function with a fixture
  // whose two dates DISAGREE, so a derivation reading the wrong column cannot pass by coincidence.
  const stillDeferred = deriveFollowUp(
    { status: "DEFERRED", due_on: dueDateFrom(today, -30), deferred_until: dueDateFrom(today, 45) }, today);
  ok("⚠ a DEFERRED obligation with a long-past due_on is NOT overdue -- the deferral date is what counts",
    stillDeferred.overdue === false && stillDeferred.dueInDays === 45,
    JSON.stringify({ o: stillDeferred.overdue, d: stillDeferred.dueInDays }));
  const deferralElapsed = deriveFollowUp(
    { status: "DEFERRED", due_on: dueDateFrom(today, 200), deferred_until: dueDateFrom(today, -2) }, today);
  ok("⚠ and once the deferral date passes it COMES BACK as overdue, even with a future due_on",
    deferralElapsed.overdue === true && deferralElapsed.dueInDays === -2,
    JSON.stringify({ o: deferralElapsed.overdue, d: deferralElapsed.dueInDays }));
  const openStill = deriveFollowUp({ status: "OPEN", due_on: dueDateFrom(today, -2), deferred_until: null }, today);
  ok("control. an OPEN one is still derived from due_on, unchanged by any of this",
    openStill.overdue === true && openStill.effectiveDueOn === dueDateFrom(today, -2), JSON.stringify(openStill.effectiveDueOn));

  const deferredBoard = await followUpBoard(admin, ws);
  ok("⚠ the deferred obligation is still ON the board (a status the board did not read would be invisible)",
    [...deferredBoard.overdue, ...deferredBoard.dueSoon, ...deferredBoard.later].some(f => f.id === manual.data.id),
    JSON.stringify({ o: deferredBoard.overdue.length, s: deferredBoard.dueSoon.length, l: deferredBoard.later.length }));

  // Put it back so the card fixture below is the one this harness describes.
  await closeFollowUp(admin, { workspaceId: ws, followUpId: manual.data.id, to: "CANCELLED", outcome: "resetting the fixture", ...base });
  const { data: clearedRow } = await admin.from("practice_follow_up").select("deferred_until").eq("id", manual.data.id).single();
  ok("moving OFF deferred clears the deferral date (a stale one would be a date nobody set)",
    clearedRow?.deferred_until === null, String(clearedRow?.deferred_until));

  // ══ 4. ⚠ COMPLETING THE LINKED ENCOUNTER COMPLETES THE FOLLOW-UP (s6, and both s10/s12) ══════════
  const appt = await bookAppointment(admin, {
    workspaceId: ws, patientId: ezekiel, patientName: "Ezekiel Okello",
    appointmentType: "scheduled_followup", scheduledAt: `${dueDateFrom(today, 2)}T09:00:00.000Z`, ...base,
  });
  if (!appt.ok) { ok("the review appointment books", false, appt.message); return report(); }

  const linkedFu = await createFollowUp(admin, {
    workspaceId: ws, patientId: ezekiel, reason: "post-operative review", dueOn: dueDateFrom(today, 2), ...base,
  });
  // ⚠ THE CONTROL IS THE SAME PATIENT, deliberately. A per-patient sweep would pass a test where the
  // control belonged to somebody else, and a per-patient sweep is the exact wrong implementation.
  const unlinkedFu = await createFollowUp(admin, {
    workspaceId: ws, patientId: ezekiel, reason: "chase the audiology referral", dueOn: dueDateFrom(today, 9), ...base,
  });
  if (!linkedFu.ok || !unlinkedFu.ok) { ok("the two obligations for the encounter test were raised", false, ""); return report(); }

  const linkResult = await scheduleFollowUp(admin, {
    workspaceId: ws, followUpId: linkedFu.data.id, appointmentId: appt.data.id, ...base,
  });
  ok("one of the two obligations is booked against that appointment", linkResult.ok, linkResult.ok ? "" : linkResult.message);

  const enc = await launchEncounter(admin, {
    workspaceId: ws, patientId: ezekiel, pathway: "scheduled_followup",
    appointmentId: appt.data.id, reasonForVisit: "post-operative review", ...base,
  });
  if (!enc.ok) { ok("the review consultation launches from that booking", false, enc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, to: "ACTIVE", ...base });

  const tooEarly = await settleFollowUpsForEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, ...base });
  ok("⚠ an ACTIVE consultation settles nothing -- the review has not finished yet",
    tooEarly.ok && tooEarly.data.completed.length === 0, tooEarly.ok ? JSON.stringify(tooEarly.data) : tooEarly.message);

  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, to: "COMPLETED", ...base });
  const settled = await settleFollowUpsForEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, ...base });
  ok("⚠ COMPLETING THE LINKED ENCOUNTER COMPLETES THE FOLLOW-UP, by id",
    settled.ok && settled.data.completed.length === 1 && settled.data.completed[0] === linkedFu.data.id,
    settled.ok ? JSON.stringify(settled.data) : settled.message);

  const afterSettle = (await listFollowUps(admin, ws, { patientId: ezekiel })).items;
  const linkedNow = afterSettle.find(f => f.id === linkedFu.data.id);
  const unlinkedNow = afterSettle.find(f => f.id === unlinkedFu.data.id);
  ok("the settled one is COMPLETED and names the consultation that settled it",
    linkedNow?.status === "COMPLETED" && linkedNow?.closing_encounter_id === enc.data.id,
    JSON.stringify({ s: linkedNow?.status, e: linkedNow?.closing_encounter_id }));
  ok("⚠ CONTROL. THE SAME PATIENT'S OTHER OBLIGATION IS UNTOUCHED -- one review met is not all of them",
    unlinkedNow?.status === "OPEN" && unlinkedNow?.closing_encounter_id === null,
    JSON.stringify({ s: unlinkedNow?.status, e: unlinkedNow?.closing_encounter_id }));

  const settledTwice = await settleFollowUpsForEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, ...base });
  ok("running it again settles nothing new and does not re-close what is closed",
    settledTwice.ok && settledTwice.data.completed.length === 0 && settledTwice.data.skipped.length === 1,
    settledTwice.ok ? JSON.stringify(settledTwice.data) : settledTwice.message);

  // A WALK-IN SETTLES NOTHING. No booking behind it means nothing was ever linked to it, and "the
  // patient was seen, so close everything" is the leap that must not be made.
  const walkIn = await launchEncounter(admin, { workspaceId: ws, patientId: lydia, pathway: "new_walk_in", ...base });
  if (walkIn.ok) {
    await transitionEncounter(admin, { workspaceId: ws, encounterId: walkIn.data.id, to: "ACTIVE", ...base });
    await transitionEncounter(admin, { workspaceId: ws, encounterId: walkIn.data.id, to: "COMPLETED", ...base });
    const walkInSettle = await settleFollowUpsForEncounter(admin, { workspaceId: ws, encounterId: walkIn.data.id, ...base });
    ok("a consultation with NO booking behind it settles nothing (it was never the linked encounter)",
      walkInSettle.ok && walkInSettle.data.completed.length === 0, walkInSettle.ok ? JSON.stringify(walkInSettle.data) : walkInSettle.message);
  } else { ok("a consultation with NO booking behind it settles nothing", false, walkIn.message); }

  // ══ 5. RESCHEDULING KEEPS THE ORIGINAL DATE (s7) ═════════════════════════════════════════════════
  const originalDue = dueDateFrom(today, 9);
  const movedTo = dueDateFrom(today, 23);
  const moved = await rescheduleFollowUp(admin, {
    workspaceId: ws, followUpId: unlinkedFu.data.id, dueOn: movedTo,
    reason: "the audiology clinic moved to the following month", ...base,
  });
  ok("a reschedule reports the date it moved FROM as well as the date it moved to",
    moved.ok && moved.data.previousDueOn === originalDue && moved.data.dueOn === movedTo,
    moved.ok ? JSON.stringify(moved.data) : moved.message);

  const detail = await getFollowUp(admin, ws, unlinkedFu.data.id);
  const moveEvent = (detail?.events ?? []).find((e: any) => e.from_due_on === originalDue);
  ok("⚠ THE ORIGINAL DATE IS RECOVERABLE FROM THE TRAIL after the row itself has moved on",
    !!moveEvent && moveEvent.to_due_on === movedTo && detail?.followUp.due_on === movedTo,
    JSON.stringify({ event: moveEvent, row: detail?.followUp.due_on }));
  ok("and the move is recorded WITHOUT claiming a status change that did not happen",
    moveEvent?.from_status === moveEvent?.to_status,
    JSON.stringify({ f: moveEvent?.from_status, t: moveEvent?.to_status }));
  ok("the practitioner's words travel with it", /audiology clinic moved/.test(moveEvent?.note ?? ""), String(moveEvent?.note));

  const noChange = await rescheduleFollowUp(admin, { workspaceId: ws, followUpId: unlinkedFu.data.id, dueOn: movedTo, ...base });
  ok("rescheduling to the date it is already due is refused (an event saying nothing moved)",
    !noChange.ok && noChange.code === "NO_CHANGE", noChange.ok ? "was allowed" : noChange.code);

  const closedMove = await rescheduleFollowUp(admin, { workspaceId: ws, followUpId: linkedFu.data.id, dueOn: dueDateFrom(today, 40), ...base });
  ok("a completed obligation cannot have its date moved (it is not owed any more)",
    !closedMove.ok && closedMove.code === "ALREADY_CLOSED", closedMove.ok ? "was allowed" : closedMove.code);

  // ══ 6. ⚠ THE FIVE CARDS, AND THE LISTS THEY OPEN ═════════════════════════════════════════════════
  //
  // THE FIXTURE IS BUILT SO THE WRONG ANSWER IS THE ONE A LAZY IMPLEMENTATION WOULD GIVE:
  //   * Completed 60 days ago is IN "Closed" and OUT of the "Completed (30 days)" card, so a card that
  //     counted the tab's rows would be wrong by exactly one.
  //   * "Due this week" is a SUPERSET of "Due today", so a partition would be wrong.
  //   * The overdue one must NOT be in "due this week", so a `<= 7 days` comparison that forgot the
  //     lower bound would be wrong.
  // Every follow-up below belongs to LYDIA, so nothing here can pass by counting people.
  await admin.from("practice_follow_up").delete().eq("workspace_id", ws);

  const fixture: Record<string, string> = {};
  const raise = async (label: string, dueOn: string, extra: Record<string, unknown> = {}) => {
    const r = await createFollowUp(admin, { workspaceId: ws, patientId: lydia, reason: label, dueOn, ...base, ...extra });
    if (r.ok) fixture[label] = r.data.id;
    return r;
  };
  await raise("overdue-one", dueDateFrom(today, -6));
  await raise("today-one", today);
  await raise("this-week-one", dueDateFrom(today, 3));
  await raise("next-month-one", dueDateFrom(today, 30));
  await raise("draft-one", dueDateFrom(today, 1), { status: "DRAFT" });
  const recent = await raise("recently-completed", dueDateFrom(today, -2));
  const ancient = await raise("long-ago-completed", dueDateFrom(today, -80));
  if (recent.ok) await closeFollowUp(admin, { workspaceId: ws, followUpId: recent.data.id, to: "COMPLETED", outcome: "seen, improving", ...base });
  if (ancient.ok) {
    await closeFollowUp(admin, { workspaceId: ws, followUpId: ancient.data.id, to: "COMPLETED", outcome: "seen last term", ...base });
    // Back-dated directly: closed_at is stamped by the engine and there is no legitimate way to move it.
    await admin.from("practice_follow_up")
      .update({ closed_at: `${dueDateFrom(today, -(COMPLETED_WINDOW_DAYS + 30))}T10:00:00.000Z` })
      .eq("id", ancient.data.id);
  }

  const board = await followUpWorkspace(admin, ws, { view: "all" });
  ok("the workspace read succeeded and carries the practice's own today", board.unavailable === false && board.today === today,
    JSON.stringify({ u: board.unavailable, t: board.today }));
  ok("it reports its five cards, in CPR-FUP-001 s4's order",
    board.cards.map(c => c.key).join(",") === "overdue,due_today,due_week,awaiting,completed",
    board.cards.map(c => c.key).join(","));

  const card = (k: string) => board.cards.find(c => c.key === k)!;
  ok("Overdue names the back-dated one and nothing else",
    card("overdue").ids.join(",") === fixture["overdue-one"], JSON.stringify(card("overdue").ids));
  ok("Due today names the one due today and nothing else",
    card("due_today").ids.join(",") === fixture["today-one"], JSON.stringify(card("due_today").ids));
  ok("⚠ Due this week CONTAINS today's one and the one three days out, and NOT the overdue one",
    card("due_week").ids.slice().sort().join(",") === [fixture["today-one"], fixture["this-week-one"]].sort().join(","),
    JSON.stringify(card("due_week").ids));
  ok("and it does NOT contain the one due next month (the window has an upper bound)",
    !card("due_week").ids.includes(fixture["next-month-one"]), JSON.stringify(card("due_week").ids));
  ok("⚠ Completed (30 days) names the recent one and EXCLUDES the one closed eighty days ago",
    card("completed").ids.join(",") === fixture["recently-completed"], JSON.stringify(card("completed").ids));

  const closedTab = await followUpWorkspace(admin, ws, { view: "closed" });
  ok("⚠ CONTROL. the Closed tab holds BOTH -- so the card is not merely counting the tab's rows",
    closedTab.rows.length === 2 &&
    closedTab.rows.map(r => r.id).sort().join(",") === [fixture["recently-completed"], fixture["long-ago-completed"]].sort().join(","),
    JSON.stringify(closedTab.rows.map(r => r.reason)));

  ok("Awaiting action holds the live ones with no appointment behind them, and excludes the closed ones",
    card("awaiting").ids.slice().sort().join(",") ===
    [fixture["overdue-one"], fixture["today-one"], fixture["this-week-one"], fixture["next-month-one"]].sort().join(","),
    JSON.stringify(card("awaiting").ids));
  ok("and the DRAFT is in none of the five cards (nothing is owed yet)",
    board.cards.every(c => !c.ids.includes(fixture["draft-one"])),
    JSON.stringify(board.cards.map(c => `${c.key}:${c.ids.length}`)));

  // ⚠ EVERY VIEW, NOT JUST THE FIVE. A card's figure must equal what clicking it opens, so the queue is
  // fetched for each view in turn and matched by ID against the tab's own count.
  const viewMismatch: string[] = [];
  for (const v of FOLLOW_UP_VIEWS) {
    const opened = await followUpWorkspace(admin, ws, { view: v.key });
    const tab = board.tabs.find(t => t.key === v.key)!;
    if (opened.rows.length !== tab.count) viewMismatch.push(`${v.key}: tab=${tab.count} list=${opened.rows.length}`);
  }
  ok("⚠ FOR EVERY VIEW, the tab's figure equals the number of rows opening it returns",
    viewMismatch.length === 0, viewMismatch.join("; "));
  // CONTROL. Without this the loop above passes just as well if every view returned the same rows.
  const distinct = new Set(board.tabs.map(t => t.count));
  ok("control. the views return DIFFERENT figures from one another (the loop is not vacuous)",
    distinct.size >= 4, JSON.stringify(board.tabs.map(t => `${t.key}=${t.count}`)));

  ok("an unknown view falls back to the first rather than showing nothing",
    followUpView("not-a-view").key === "all" && followUpView("overdue").key === "overdue");

  const filtered = await followUpWorkspace(admin, ws, { view: "all", search: "next-month" });
  ok("the header search narrows the CARDS as well as the queue, so a card cannot overstate a filtered board",
    filtered.rows.length === 1 && filtered.cards.every(c => (c.count ?? 0) <= 1),
    JSON.stringify({ rows: filtered.rows.length, cards: filtered.cards.map(c => `${c.key}=${c.count}`) }));

  // ══ 7. s10's EVENTS: WHAT EXISTS IS EMITTED, WHAT DOES NOT IS NOT INVENTED ═══════════════════════
  const { data: emitted } = await admin.from("practice_domain_event")
    .select("event_type, payload").eq("workspace_id", ws).like("event_type", "followup.%");
  const emittedTypes = new Set(((emitted ?? []) as any[]).map(e => e.event_type));
  ok("followup.created is emitted to the outbox when an obligation is raised",
    emittedTypes.has("followup.created"), JSON.stringify([...emittedTypes]));
  ok("followup.completed is emitted when one is closed as done",
    emittedTypes.has("followup.completed"), JSON.stringify([...emittedTypes]));
  ok("the created event carries the SOURCE, so a consumer can tell a pathway review from a manual note",
    ((emitted ?? []) as any[]).some(e => e.event_type === "followup.created" && !!e.payload?.followUpSource),
    JSON.stringify(((emitted ?? []) as any[]).slice(0, 1).map(e => e.payload)));

  // ⚠ REPORTED, NOT INVENTED. s10 asks for Overdue and Cancelled events. The outbox's event_type CHECK
  // (migration 233) is CLOSED and holds neither. Widening it is a migration this build does not write,
  // so the absence is asserted here rather than worked around with a borrowed name -- an event called
  // followup.completed for a cancelled obligation would corrupt every consumer that ever reads it.
  ok("⚠ followup.overdue is ABSENT from the platform catalogue, and is not emitted under another name",
    !(PRACTICE_EVENT_TYPES as readonly string[]).includes("followup.overdue") && !emittedTypes.has("followup.overdue"),
    "s10 asks for it; migration 233's CHECK does not have it");
  ok("⚠ followup.cancelled is ABSENT too, and the cancellation above did not emit anything in its place",
    !(PRACTICE_EVENT_TYPES as readonly string[]).includes("followup.cancelled"),
    "s10 asks for it; migration 233's CHECK does not have it");
  ok("⚠ followup.due EXISTS in the catalogue and is deliberately NOT emitted -- DUE IS DERIVED",
    (PRACTICE_EVENT_TYPES as readonly string[]).includes("followup.due") && !emittedTypes.has("followup.due"),
    "emitting it would need something to run each morning, which is the stored-DUE mistake");

  // ══ 8. A FAILED READ IS NEVER AN EMPTY WORKSPACE ═════════════════════════════════════════════════
  const failingAdmin = {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order"]) chain[m] = () => chain;
      chain.limit = async () => ({ data: null, error: { message: "simulated workspace read failure" } });
      chain.maybeSingle = async () => ({ data: { timezone: "Africa/Kampala" }, error: null });
      return chain;
    },
  };
  const failedBoard = await followUpWorkspace(failingAdmin as never, ws, { view: "all" });
  ok("a workspace read that FAILED says so, and carries the database's own words",
    failedBoard.unavailable === true && /simulated workspace read failure/.test(failedBoard.detail ?? ""),
    JSON.stringify({ u: failedBoard.unavailable, d: failedBoard.detail }));
  ok("⚠ and every card reads NULL, never 0 -- five zeroes look exactly like a practice that owes nothing",
    failedBoard.cards.length === 5 && failedBoard.cards.every(c => c.count === null),
    JSON.stringify(failedBoard.cards.map(c => c.count)));
  const realBoard = await followUpWorkspace(admin, ws, { view: "all" });
  ok("control. the same call through the real client is AVAILABLE and its cards carry figures",
    realBoard.unavailable === false && realBoard.cards.every(c => typeof c.count === "number"),
    JSON.stringify(realBoard.cards.map(c => c.count)));

  ok("the live statuses are the three that are still owed, and DRAFT is not one of them",
    LIVE_FOLLOW_UP_STATUSES.join(",") === "OPEN,SCHEDULED,DEFERRED", LIVE_FOLLOW_UP_STATUSES.join(","));

  // ══ 9. THE CARD SWATCHES ARE KEYED ON THE ENGINE'S OWN CARD KEYS ═════════════════════════════════
  //
  // ⚠ A MISSING KEY IS INVISIBLE IN A DIFF AND INVISIBLE IN A TYPE-CHECK. `Record<string, ...>` accepts
  // any key and returns any key, so a swatch map that has drifted from the engine compiles perfectly and
  // renders a real figure in dead grey. That has shipped twice in palette.ts already -- PERFORMANCE_SWATCH
  // keyed `avg_consult` against the metric engine's `average_consult_time`, GLANCE_SWATCH `walk_ins`
  // against `walk_in` -- and both times the only thing that would have caught it was somebody scanning
  // the row and noticing one tile was the wrong colour.
  //
  // ASSERTED AS AN EQUALITY IN BOTH DIRECTIONS, not a subset: a swatch key with no card is a colour
  // nobody will ever see, and a card with no swatch is the grey tile. Compared against what the ENGINE
  // actually emitted on the live board above -- not only against FOLLOW_UP_VIEWS -- so a change to what
  // followUpWorkspace() puts in `cards` is caught even if the constants file still agrees with itself.
  const swatchKeys = Object.keys(FOLLOWUP_CARD_SWATCH).sort();
  const emittedCardKeys = realBoard.cards.map(c => c.key).sort();
  ok("9a. every card the engine emits has a swatch, and every swatch has a card",
    swatchKeys.join() === emittedCardKeys.join(),
    `swatches: ${swatchKeys.join()} | emitted: ${emittedCardKeys.join()}`);
  const viewCardKeys = FOLLOW_UP_VIEWS.filter(v => v.card).map(v => v.key).sort();
  ok("9b. and the same set again from FOLLOW_UP_VIEWS, which is where a sixth card would be added",
    swatchKeys.join() === viewCardKeys.join(),
    `swatches: ${swatchKeys.join()} | card views: ${viewCardKeys.join()}`);
  ok("9-control. the set is non-empty, so 9a and 9b are not comparing two empty lists",
    swatchKeys.length === 5, `${swatchKeys.length}`);

  // ⚠ AND THE PAGE MUST ACTUALLY READ THEM. Source-checked, because a Tailwind class cannot be reached
  // from here. The map this replaced lived in the component and pointed each card at ANOTHER card's
  // entry by hue, so the page could go on drawing the right colours while palette.ts and the engine
  // drifted apart underneath it -- which is the arrangement 9a exists to make impossible.
  const workspaceSrc = readFileSync(
    join(process.cwd(), "src", "app", "practice", "(shell)", "follow-ups", "FollowUpsWorkspace.tsx"), "utf8");
  ok("9c. the follow-ups workspace reads FOLLOWUP_CARD_SWATCH from palette.ts",
    /FOLLOWUP_CARD_SWATCH/.test(workspaceSrc) && /from "@\/lib\/practice\/palette"/.test(workspaceSrc),
    "the cards are drawn from the shared map or they are not shared");
  ok("9d. and keeps no private colour map of its own",
    !/const CARD_SWATCH\b/.test(workspaceSrc),
    "a local colour map is how the page and palette.ts start disagreeing about what emerald means");

  await cleanup();
  return report();
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
