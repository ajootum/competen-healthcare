/**
 * CPR-V5-007 PHASE 1 -- Practice Session harness. Migration 240.
 *
 * WHAT IT PROVES:
 *   1. s4.3's SESSION FIELDS ARE STORED AND READ BACK BY NAME. Not counted -- named. Four count
 *      assertions in this repo went stale this week because a count is true of the wrong answer as
 *      often as the right one.
 *   2. s4.3's `booking_mode` DEFAULTS TO `none`. A session created without saying otherwise is not
 *      bookable, and the control proves the field is settable so the assertion is not vacuous.
 *   3. THE PHASE GATE. Link-only and public are refused with the phase named, and internal is not --
 *      so the refusal is about Phase 4 rather than about booking.
 *   4. s4.3's ZERO-TYPES RULE FIRES BEFORE THE PHASE GATE, proven by the two refusals having different
 *      codes for the same mode with and without types.
 *   5. s7.4's STRICTER-OF-BOTH CAPACITY, in both directions, with fixtures arranged so the wrong answer
 *      differs from the right one -- and neither figure overwrites the other.
 *   6. s4.4's REFUSAL: a session with future bookings cannot be deleted, the refusal says HOW MANY, and
 *      an unbooked session deletes cleanly. Matched both by slot and by time overlap.
 *   7. A FAILED READ IS NEVER A ZERO. With the bookings table unreadable, the delete REFUSES instead of
 *      succeeding -- and the control proves the same session deletes when the table answers.
 *   8. s4.1: ENDING IS A DATE. The row survives, its occurrences survive, and the state moves.
 *   9. Appointment-type links: zero, one and several are all stored, and migration 231's single column
 *      is kept in step rather than left to disagree.
 *  10. Permission and cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-session-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  practiceSessions, saveSession, setAppointmentTypes, endSession, deleteSession,
  futureBookingsForSession, computeCapacity, readingValue, type SessionView,
} from "../src/lib/practice/practice-sessions";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ef001";
const OTHER = "00000000-0000-4000-8000-0000000ef002";

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
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-sess-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-sess",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-sess", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
      await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

/**
 * An admin client on which one table cannot be read.
 *
 * ⚠ THIS IS THE ONLY WAY TO TEST THE FIRST DOCTRINE. "A failed read is never a zero" is a claim about
 * what happens when a query FAILS, and a passing database never produces one -- so an assertion that
 * only ever sees a working table is asserting nothing about the branch it is aimed at.
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

const ACT = { actorId: OWNER, correlationId: "harness-sess" };
const iso = (daysAhead: number, hour: number) => {
  const d = new Date(Date.now() + daysAhead * 86400000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function main() {
  console.log("\n=== CPR-V5-007 PHASE 1: PRACTICE SESSIONS (migration 240) ===\n");

  // ---- 0. MIGRATION GATE ------------------------------------------------------------------------
  const probe = await admin.from("practice_availability_template")
    // ⚠ NOT capacity_manual: migration 241 dropped it, so this gate started reporting "run 240"
    // against a database where 240 had run. A migration gate must probe a column the migration adds AND
    // KEEPS -- probing one a later migration might reasonably remove turns the gate into a false alarm.
    .select("session_name, activity_type, booking_mode, walk_ins_allowed, walk_in_limit, effective_from, effective_to, session_note")
    .limit(1);
  const probeJoin = await admin.from("practice_session_appointment_type").select("id").limit(1);
  if (probe.error || probeJoin.error) {
    console.error("\n  run 240\n");
    console.error(`  (${probe.error?.message ?? probeJoin.error?.message})`);
    process.exit(1);
  }
  console.log("  migration 240 is applied.\n");

  await cleanup();

  const wsA = await provision(OWNER, "Dr Session A", "a");
  const wsB = await provision(OTHER, "Dr Session B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");
  const A = ctxA.ctx, B = ctxB.ctx;

  const { data: locRow, error: locErr } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "TMR International Hospital", type: "hospital", active: true })
    .select("id").single();
  if (locErr || !locRow) throw new Error(`location fixture failed: ${locErr?.message}`);
  const locId = locRow.id as string;

  const read = async (ctx = A) => {
    const s = await practiceSessions(admin, ctx);
    return { s, list: readingValue(s.sessions, [] as SessionView[]) };
  };
  const byId = (list: SessionView[], id: string) => list.find(x => x.id === id);

  // ══ 5. s7.4 CAPACITY -- pure, and arranged so the wrong answer differs ═════════════════════════
  //
  // 240 minutes at 30 gives 8. A manual cap of 5 must win because it is STRICTER; a manual cap of 10
  // must LOSE for the same reason. If the engine simply preferred the manual figure, the second case
  // would return 10 -- so the two cases together are what make this non-vacuous.
  const capStricterManual = computeCapacity({
    startsMinute: 540, endsMinute: 780, sessionAppointmentMinutes: 30, practiceDefaultMinutes: 20, manual: 5,
  });
  ok("5a a manual cap BELOW the derivation wins, and is named as the winner",
    capStricterManual.derived === 8 && capStricterManual.manual === 5
    && capStricterManual.effective === 5 && capStricterManual.source === "manual",
    JSON.stringify(capStricterManual));
  const capStricterDerived = computeCapacity({
    startsMinute: 540, endsMinute: 780, sessionAppointmentMinutes: 30, practiceDefaultMinutes: 20, manual: 10,
  });
  ok("5b a manual cap ABOVE the derivation loses -- the STRICTER applies, not the manual one",
    capStricterDerived.derived === 8 && capStricterDerived.manual === 10
    && capStricterDerived.effective === 8 && capStricterDerived.source === "derived",
    JSON.stringify(capStricterDerived));
  ok("5c neither figure overwrites the other -- both survive the comparison",
    capStricterDerived.derived === 8 && capStricterDerived.manual === 10);
  const capDerivedOnly = computeCapacity({
    startsMinute: 540, endsMinute: 780, sessionAppointmentMinutes: null, practiceDefaultMinutes: 20, manual: null,
  });
  ok("5d null manual means DERIVE IT, and the practice default supplies the length",
    capDerivedOnly.effective === 12 && capDerivedOnly.appointmentMinutesSource === "practice_default",
    JSON.stringify(capDerivedOnly));
  const capNothing = computeCapacity({
    startsMinute: 540, endsMinute: 780, sessionAppointmentMinutes: null, practiceDefaultMinutes: null, manual: null,
  });
  ok("5e with no length and no manual limit the capacity is UNKNOWN, not nought",
    capNothing.effective === null && capNothing.source === "none", JSON.stringify(capNothing));

  // ══ 2. BOOKING MODE DEFAULTS TO `none` ════════════════════════════════════════════════════════
  const made = await saveSession(admin, A, {
    weekday: 2, startsMinute: 540, endsMinute: 780, locationId: locId,
    sessionName: "Tuesday Outpatient Clinic", activityType: "outpatient_clinic",
    appointmentMinutes: 30, sessionNote: "Registrar sits in.", ...ACT,
  });
  if (!made.ok) throw new Error(`fixture session refused: ${made.code} ${made.message}`);
  const tuesdayId = made.data.id;

  {
    const { list } = await read();
    const t = byId(list, tuesdayId)!;
    ok("2a a session created without saying otherwise is NOT bookable",
      t.bookingMode === "none", t.bookingMode);
    // ---- 1. THE FIELDS, BY NAME ----
    ok("1a the name is stored as typed", t.sessionName === "Tuesday Outpatient Clinic", String(t.sessionName));
    ok("1b the activity type is stored, and it is one practice_activity would accept",
      t.activityType === "outpatient_clinic", String(t.activityType));
    ok("1c the day and the window are stored",
      t.weekday === 2 && t.startsMinute === 540 && t.endsMinute === 780,
      `${t.weekday} ${t.startsMinute}-${t.endsMinute}`);
    ok("1d the location is stored and its NAME resolves", t.locationId === locId && !!t.locationName,
      String(t.locationName));
    ok("1e the operational note is stored", t.sessionNote === "Registrar sits in.", String(t.sessionNote));
    ok("1f the suggestion is COMPUTED and is not what was saved",
      t.suggestedName.includes("Tuesday") && t.suggestedName !== t.sessionName,
      `${t.suggestedName} vs ${t.sessionName}`);
    ok("1g capacity derives 8 from 240 minutes at 30, with no manual limit set",
      t.capacity.derived === 8 && t.capacity.manual === null && t.capacity.effective === 8,
      JSON.stringify(t.capacity));
    ok("1h zero appointment types, so it is not patient-bookable",
      t.appointmentTypes.length === 0, JSON.stringify(t.appointmentTypes));
  }

  const toInternal = await saveSession(admin, A, {
    templateId: tuesdayId, bookingMode: "internal", appointmentTypes: ["new_consultation", "scheduled_followup"], ...ACT,
  });
  ok("2b CONTROL: the mode IS settable, so 2a is not vacuous", toInternal.ok,
    toInternal.ok ? "" : `${toInternal.code} ${toInternal.message}`);
  {
    const { list } = await read();
    const t = byId(list, tuesdayId)!;
    ok("2c and it reads back as internal", t.bookingMode === "internal", t.bookingMode);
    // ---- 9. Several types ----
    ok("9a several appointment types are all stored, by name",
      t.appointmentTypes.length === 2
      && t.appointmentTypes.includes("new_consultation") && t.appointmentTypes.includes("scheduled_followup"),
      JSON.stringify(t.appointmentTypes));
    // ⚠ 9b USED TO ASSERT THE LEGACY COLUMN WAS KEPT IN STEP. Migration 241 dropped it, so the
    // guarantee changed from "two stores agree" to "there is one store" -- and the assertion has to
    // change with it rather than be deleted, or nothing would notice the column coming back.
    const { error: goneErr } = await admin.from("practice_availability_template")
      .select("appointment_type").limit(1);
    ok("9b the legacy single column is GONE, so the join table is the only store (migration 241)",
      !!goneErr, "the dropped column still answers");
  }

  await setAppointmentTypes(admin, A, { templateId: tuesdayId, types: ["teleconsultation"] });
  {
    const { list } = await read();
    ok("9c one type reads back as that one type",
      byId(list, tuesdayId)!.appointmentTypes.join() === "teleconsultation",
      byId(list, tuesdayId)!.appointmentTypes.join());
    // CONTROL for 9b: the join table really does hold the single type, so "the column is gone" is not
    // passing because the whole feature stopped working.
    const { data: joined } = await admin.from("practice_session_appointment_type")
      .select("appointment_type").eq("template_id", tuesdayId);
    ok("9d CONTROL: the join table holds it, so 9b is not green because nothing is stored anywhere",
      (joined ?? []).map((r: { appointment_type: string }) => r.appointment_type).join() === "teleconsultation",
      JSON.stringify(joined));
  }

  // ══ 3 + 4. THE PHASE GATE, AND THE ORDER OF THE TWO REFUSALS ══════════════════════════════════
  const publicNoTypes = await saveSession(admin, A, {
    weekday: 4, startsMinute: 540, endsMinute: 720, locationId: locId,
    sessionName: "Thursday", bookingMode: "public", appointmentTypes: [], ...ACT,
  });
  ok("4a public with ZERO types is refused for the session's own incoherence",
    !publicNoTypes.ok && publicNoTypes.code === "NO_APPOINTMENT_TYPE",
    publicNoTypes.ok ? "accepted" : publicNoTypes.code);

  const publicWithTypes = await saveSession(admin, A, {
    weekday: 4, startsMinute: 540, endsMinute: 720, locationId: locId,
    sessionName: "Thursday", bookingMode: "public", appointmentTypes: ["new_consultation"], ...ACT,
  });
  ok("4b public WITH types is refused for a different reason -- the phase, not the types",
    !publicWithTypes.ok && publicWithTypes.code === "PHASE_NOT_BUILT",
    publicWithTypes.ok ? "accepted" : publicWithTypes.code);
  ok("3a and the refusal NAMES the phase, so nobody goes looking for a setting",
    !publicWithTypes.ok && /Phase 4/.test(publicWithTypes.message),
    publicWithTypes.ok ? "" : publicWithTypes.message);

  const linkOnly = await saveSession(admin, A, {
    weekday: 4, startsMinute: 540, endsMinute: 720, locationId: locId,
    bookingMode: "link_only", appointmentTypes: ["new_consultation"], ...ACT,
  });
  ok("3b link-only is refused too", !linkOnly.ok && linkOnly.code === "PHASE_NOT_BUILT",
    linkOnly.ok ? "accepted" : linkOnly.code);

  const internalOk = await saveSession(admin, A, {
    weekday: 4, startsMinute: 540, endsMinute: 720, locationId: locId,
    sessionName: "Thursday Ward Round", activityType: "ward_round",
    bookingMode: "internal", appointmentTypes: ["new_consultation"], ...ACT,
  });
  ok("3c CONTROL: internal is ACCEPTED, so 3a/3b refuse the phase rather than refusing booking",
    internalOk.ok, internalOk.ok ? "" : `${internalOk.code} ${internalOk.message}`);
  const thursdayId = internalOk.ok ? internalOk.data.id : "";

  // Nobody in two places at once -- the shared check, not a copy of it.
  const clash = await saveSession(admin, A, {
    weekday: 2, startsMinute: 600, endsMinute: 700, locationId: locId, sessionName: "Clash", ...ACT,
  });
  ok("3d the shared conflict check still refuses an overlapping session",
    !clash.ok && clash.code === "SESSION_OVERLAP", clash.ok ? "accepted" : clash.code);

  // ══ 6. s4.4 -- DELETING A SESSION WITH FUTURE BOOKINGS IS PROHIBITED ═══════════════════════════
  //
  // Two slots and two appointments, one matched BY SLOT ID and one matched only BY TIME OVERLAP -- the
  // second is the case that carries no slot_id at all, and a slot_id-only count would report one
  // booking for a session that has two.
  const { data: slotRows, error: slotErr } = await admin.from("practice_availability_slot").insert([
    { workspace_id: wsA, location_id: locId, starts_at: iso(7, 9), ends_at: iso(7, 13), slot_kind: "clinic", status: "OPEN", generated_from_template_id: tuesdayId, generated_for_date: iso(7, 9).slice(0, 10) },
    { workspace_id: wsA, location_id: locId, starts_at: iso(14, 9), ends_at: iso(14, 13), slot_kind: "clinic", status: "OPEN", generated_from_template_id: tuesdayId, generated_for_date: iso(14, 9).slice(0, 10) },
  ]).select("id, starts_at");
  if (slotErr) throw new Error(`slot fixture failed: ${slotErr.message}`);
  const slotA = (slotRows ?? [])[0];

  // ⚠ THE FIRST ONE IS SCHEDULED OUTSIDE ITS OWN SLOT, AND THAT IS THE POINT.
  //
  // The first version of this fixture put it at 10:00 inside a 09:00-13:00 slot -- so the TIME-OVERLAP
  // query found it too, and the assertion below passed with the slot_id path deleted. A failability
  // probe caught it: the break that removed the slot_id matching turned nothing red. That is the vacuous
  // assertion this repo has sat green on six times, and the fixture is now arranged so the wrong answer
  // is the one it would give.
  //
  // 14:00 on the same day is inside the outer window the byTime query scans and OUTSIDE both slots, so
  // the overlap filter rejects it and only the slot_id match can find it. It is also a real state: a
  // booking keeps its slot_id when the session's hours move under it.
  const { error: apptErr } = await admin.from("practice_appointment").insert([
    { workspace_id: wsA, location_id: locId, slot_id: slotA.id, patient_name: "Booked By Slot", appointment_type: "new_consultation", scheduled_at: iso(7, 14), duration_minutes: 30, status: "CONFIRMED" },
    // NO slot_id. Only the time overlap can find this one.
    { workspace_id: wsA, location_id: locId, patient_name: "Booked By Time", appointment_type: "new_consultation", scheduled_at: iso(14, 10), duration_minutes: 30, status: "REQUESTED" },
  ]);
  if (apptErr) throw new Error(`appointment fixture failed: ${apptErr.message}`);

  const counted = await futureBookingsForSession(admin, A, tuesdayId);
  ok("6a both bookings are found -- one by slot id, one only by time overlap",
    counted.state === "ok" && counted.value.count === 2,
    JSON.stringify(counted));

  const refused = await deleteSession(admin, A, { templateId: tuesdayId, ...ACT });
  ok("6b deleting a session with future bookings is REFUSED",
    !refused.ok && refused.code === "SESSION_HAS_FUTURE_BOOKINGS",
    refused.ok ? "deleted" : refused.code);
  ok("6c and the refusal says HOW MANY, not merely that it cannot",
    !refused.ok && /2 patients are booked/.test(refused.message),
    refused.ok ? "" : refused.message);
  ok("6d and it offers the end date as the alternative",
    !refused.ok && /end date/.test(refused.message), refused.ok ? "" : refused.message);
  {
    const { data: still } = await admin.from("practice_availability_template")
      .select("id").eq("id", tuesdayId).maybeSingle();
    ok("6e and the session is still there afterwards", !!still);
  }

  // ══ 7. A FAILED READ IS NEVER A ZERO ══════════════════════════════════════════════════════════
  //
  // The bookings table cannot be read. A count of nought would let the delete through and take two
  // patients' appointments with it.
  const blindAdmin = adminWithUnreadable(admin, "practice_appointment");
  const blindCount = await futureBookingsForSession(blindAdmin, A, tuesdayId);
  ok("7a an unreadable bookings table reports UNREADABLE, not nought",
    blindCount.state === "unreadable", JSON.stringify(blindCount));
  const blindDelete = await deleteSession(blindAdmin, A, { templateId: tuesdayId, ...ACT });
  ok("7b and the delete REFUSES rather than guessing",
    !blindDelete.ok && blindDelete.code === "BOOKINGS_UNREADABLE",
    blindDelete.ok ? "deleted" : blindDelete.code);
  ok("7c and it says an unread booking is not an absent one",
    !blindDelete.ok && /unread booking is not an absent one/.test(blindDelete.message),
    blindDelete.ok ? "" : blindDelete.message);

  // ══ 6f. THE CONTROL: an unbooked session deletes cleanly ══════════════════════════════════════
  const deleted = await deleteSession(admin, A, { templateId: thursdayId, ...ACT });
  ok("6f CONTROL: a session nobody is booked into deletes fine, so 6b is a refusal and not a wall",
    deleted.ok, deleted.ok ? "" : `${deleted.code} ${deleted.message}`);
  {
    const { data: gone } = await admin.from("practice_availability_template")
      .select("id").eq("id", thursdayId).maybeSingle();
    ok("6g and it really is gone", !gone);
    const { data: links } = await admin.from("practice_session_appointment_type")
      .select("id").eq("template_id", thursdayId);
    // ⚠ THIS OUTCOME IS GUARANTEED TWICE and the assertion is about the outcome, not about which
    // guarantee delivered it. deleteSession removes the links explicitly, and migration 240's foreign
    // key would cascade them away regardless. A probe that neutered only the explicit delete turned
    // nothing red -- the cascade covered for it -- so the explicit delete is belt over braces rather
    // than the load-bearing part, and only a break that neuters BOTH deletions makes this fail.
    ok("6h with its appointment-type links", (links ?? []).length === 0, JSON.stringify(links));
  }

  // ══ 8. s4.1 -- ENDING IS A DATE ═══════════════════════════════════════════════════════════════
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const endedFuture = await endSession(admin, A, { templateId: tuesdayId, effectiveTo: nextMonth, ...ACT });
  ok("8a a session with bookings CAN be ended -- ending is not deleting", endedFuture.ok,
    endedFuture.ok ? "" : `${endedFuture.code} ${endedFuture.message}`);
  ok("8b and it reports the bookings that fall after the end date rather than hiding them",
    endedFuture.ok && endedFuture.data.bookingsAfter === 2,
    endedFuture.ok ? String(endedFuture.data.bookingsAfter) : "");
  {
    const { list } = await read();
    // OPTIONAL, DELIBERATELY. A break that deletes the session must make this assertion go RED, not
    // make the harness throw -- a crash is not a failing test, it is a test that never ran.
    const t = byId(list, tuesdayId);
    ok("8c CONTROL: an end date in the future leaves the session CURRENT, so 8e is not vacuous",
      t?.effectiveState === "current" && t?.effectiveTo === nextMonth,
      `${t?.effectiveState} ${t?.effectiveTo}`);
  }

  const endedPast = await endSession(admin, A, { templateId: tuesdayId, effectiveTo: yesterday, ...ACT });
  ok("8d ending it yesterday is accepted", endedPast.ok, endedPast.ok ? "" : endedPast.message);
  {
    const { list } = await read();
    const t = byId(list, tuesdayId);
    ok("8e THE ROW SURVIVES -- ending keeps every past occurrence", !!t, "the session vanished");
    ok("8f and its state moves to ended", t?.effectiveState === "ended", String(t?.effectiveState));
    ok("8g and the reason is on the session, in the practitioner's words",
      (t?.warnings ?? []).some(w => /pattern has ended/.test(w)), JSON.stringify(t?.warnings));
    const { count } = await admin.from("practice_availability_slot")
      .select("*", { count: "exact", head: true }).eq("generated_from_template_id", tuesdayId);
    ok("8h and the slots it already generated survive too", (count ?? 0) === 2, String(count));
  }

  // ══ 10a. PERMISSION ═══════════════════════════════════════════════════════════════════════════
  const noEdit = { ...A, capabilities: A.capabilities.filter(c => c !== "appointment.manage") };
  const refusedSave = await saveSession(admin, noEdit, { weekday: 5, startsMinute: 540, endsMinute: 600, ...ACT });
  ok("10a a caller without appointment.manage cannot create a session",
    !refusedSave.ok && refusedSave.code === "FORBIDDEN", refusedSave.ok ? "created" : refusedSave.code);
  const refusedDelete = await deleteSession(admin, noEdit, { templateId: tuesdayId, ...ACT });
  ok("10b nor delete one", !refusedDelete.ok && refusedDelete.code === "FORBIDDEN",
    refusedDelete.ok ? "deleted" : refusedDelete.code);
  {
    const r = await practiceSessions(admin, noEdit);
    ok("10c but they can still SEE the week -- the map is not gated with the controls",
      readingValue(r.sessions, [] as SessionView[]).length > 0 && r.mayEdit === false,
      `${readingValue(r.sessions, [] as SessionView[]).length} mayEdit=${r.mayEdit}`);
  }

  // ══ 10d. CROSS-WORKSPACE ISOLATION ════════════════════════════════════════════════════════════
  const b = await read(B);
  ok("10d practice B sees none of practice A's sessions",
    b.list.length === 0, JSON.stringify(b.list.map(x => x.sessionName)));
  const crossDelete = await deleteSession(admin, B, { templateId: tuesdayId, ...ACT });
  ok("10e and cannot reach one by id", !crossDelete.ok && crossDelete.code === "NOT_FOUND",
    crossDelete.ok ? "deleted" : crossDelete.code);
  const a = await read(A);
  ok("10f CONTROL: practice A does have that session, so 10d and 10e are not vacuous",
    a.list.some(x => x.id === tuesdayId), JSON.stringify(a.list.map(x => x.sessionName)));

  // ══ 11. THE LOCATION INDICATORS (s4.2) ════════════════════════════════════════════════════════
  {
    const r = await practiceSessions(admin, A);
    const loc = readingValue(r.locations, []).find(l => l.id === locId);
    ok("11a a location whose only session is ended supports no booking",
      loc !== undefined && loc.supportsPatientBooking === false, JSON.stringify(loc));
  }
  // Give practice A a live internal session again, and the indicator must move.
  const live = await saveSession(admin, A, {
    weekday: 6, startsMinute: 480, endsMinute: 720, locationId: locId,
    sessionName: "Saturday Clinic", activityType: "outpatient_clinic",
    bookingMode: "internal", appointmentTypes: ["walk_in"], walkInsAllowed: true, walkInLimit: 4, ...ACT,
  });
  ok("11b a walk-in limit is accepted when walk-ins are allowed", live.ok,
    live.ok ? "" : `${live.code} ${live.message}`);
  {
    const r = await practiceSessions(admin, A);
    const loc = readingValue(r.locations, []).find(l => l.id === locId);
    ok("11c CONTROL: adding a live internal session moves the indicators, so 11a is not vacuous",
      loc?.supportsInternalBooking === true && loc?.supportsWalkIns === true, JSON.stringify(loc));
  }
  const badWalkIn = await saveSession(admin, A, {
    weekday: 7, startsMinute: 540, endsMinute: 600, locationId: locId,
    walkInsAllowed: false, walkInLimit: 3, ...ACT,
  });
  ok("11d a walk-in limit with walk-ins off is refused rather than silently ignored",
    !badWalkIn.ok && badWalkIn.code === "VALIDATION_ERROR", badWalkIn.ok ? "accepted" : badWalkIn.code);

  // ══ 12. ACTIVITY TYPE IS THE ACTIVITY ENGINE'S VOCABULARY ═════════════════════════════════════
  const badActivity = await saveSession(admin, A, {
    weekday: 7, startsMinute: 540, endsMinute: 600, locationId: locId, activityType: "outreach", ...ACT,
  });
  ok("12a a type the activity table would reject is refused here too -- a session nobody could start",
    !badActivity.ok && badActivity.code === "VALIDATION_ERROR", badActivity.ok ? "accepted" : badActivity.code);
  const goodActivity = await saveSession(admin, A, {
    weekday: 7, startsMinute: 540, endsMinute: 600, locationId: locId, activityType: "theatre", ...ACT,
  });
  ok("12b CONTROL: one it would accept is accepted, so 12a is about the vocabulary",
    goodActivity.ok, goodActivity.ok ? "" : goodActivity.code);

  const badType = await saveSession(admin, A, {
    templateId: tuesdayId, appointmentTypes: ["annual_review"], ...ACT,
  });
  ok("12c an appointment type no appointment may carry is refused",
    !badType.ok && badType.code === "VALIDATION_ERROR", badType.ok ? "accepted" : badType.code);

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
