/**
 * Reschedule / drag-and-drop harness -- rescheduleAppointment + checkPlacement.
 *
 * WHAT IT PROVES:
 *   1. AN APPOINTMENT CAN BE MOVED AT ALL. Nothing in this product could change WHEN an appointment
 *      was, only its status -- while the calendar footer claimed "Every change audited. Who moved what,
 *      and when."
 *   2. THE MOVE IS AUDITED WITH BOTH ENDS. "It moved" is useless; "from 09:00 to 14:00" is the record.
 *   3. AN APPOINTMENT DOES NOT COLLIDE WITH ITSELF. Without the exclusion every small drag would refuse,
 *      naming the very appointment in the practitioner's hand.
 *   4. A DRAG CANNOT DO WHAT TYPING CANNOT. Double-booking and travel conflicts are refused on a MOVE
 *      exactly as on a booking, because both go through one placement check.
 *   5. MOVING TO ANOTHER HOSPITAL IS A REAL MOVE, and is refused when there is no time to get there.
 *   6. A TERMINAL APPOINTMENT IS HISTORY. Completed, cancelled and no-show cannot be moved.
 *   7. AN ARRIVED PATIENT IS STANDING THERE. That is a cancellation, not a reschedule.
 *   8. A DAY THAT HAS ALREADY BEEN cannot be moved into -- judged on the practice's calendar, not a clock.
 *   9. A STALE CALENDAR CANNOT WIN. Two people dragging the same appointment: the second is told.
 *  10. A DRAG THAT LANDS WHERE IT STARTED writes nothing and audits nothing.
 *  11. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-reschedule-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { bookAppointment, rescheduleAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// Hex only -- 'r' is not a hex digit, and a malformed UUID here fails as an insert error that is easy
// to mistake for a logic bug (it has cost this project a debugging session before).
const OWNER = "00000000-0000-4000-8000-0000000cc001";
const OTHER = "00000000-0000-4000-8000-0000000cc002";

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
    idempotency_key: `harness-rc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-rc",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-rc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
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

/** A fixed future day, so the harness never straddles "now". Kampala is UTC+3 with no DST. */
const futureDay = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); };
const at = (hhmm: string) => `${futureDay()}T${hhmm}:00.000Z`;

async function auditFor(wsId: string, appointmentId: string) {
  // THE ERROR IS CHECKED, not discarded. The first version of this ordered by `created_at` -- a column
  // practice_audit_event does not have; it is `occurred_at` -- and swallowing that error turned "the
  // query was malformed" into "nothing was audited", which reads as a missing feature.
  const { data, error } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", wsId)
    .eq("event_type", "practice.appointment_rescheduled").order("occurred_at", { ascending: false });
  if (error) throw new Error(`audit read failed: ${error.message}`);
  type Moved = {
    appointmentId?: string; forced?: boolean;
    from?: { scheduledAt?: string; durationMinutes?: number; locationId?: string | null };
    to?: { scheduledAt?: string; durationMinutes?: number; locationId?: string | null };
  };
  return ((data ?? []) as { event_type: string; payload: Moved }[])
    .filter(e => e.payload?.appointmentId === appointmentId);
}

async function main() {
  console.log("\n=== RESCHEDULE / DRAG-AND-DROP ===\n");
  await cleanup();

  const wsA = await provision(OWNER, "Dr Reschedule A", "a");
  const wsB = await provision(OTHER, "Dr Reschedule B", "b");

  const mk = async (wsId: string, name: string, type: string, travel = 30) => {
    const { data, error } = await admin.from("practice_location")
      .insert({ workspace_id: wsId, name, type, active: true, travel_buffer_minutes: travel })
      .select("id").single();
    if (error || !data) throw new Error(`location insert failed: ${error?.message}`);
    return data.id as string;
  };
  const siteA = await mk(wsA, "Mulago Hospital", "hospital", 40);
  const siteB = await mk(wsA, "Nsambya Hospital", "hospital", 40);

  const book = async (name: string, time: string, opts: Record<string, unknown> = {}) => {
    const r = await bookAppointment(admin, {
      workspaceId: wsA, patientName: name, appointmentType: "hospital_consultation",
      scheduledAt: at(time), actorId: OWNER, correlationId: "rc-setup", ...opts,
    });
    if (!r.ok) throw new Error(`setup booking "${name}" failed: ${r.code} ${r.message}`);
    return r.data.id;
  };

  // ---- 1 + 2. A move happens, and both ends are recorded ------------------------------------------
  const moving = await book("Moving Patient", "09:00", { locationId: siteA });
  const moved = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("14:00"),
    actorId: OWNER, correlationId: "rc-1",
  });
  ok("1a an appointment can be moved", moved.ok, JSON.stringify(moved));
  ok("1b the new time is returned",
    moved.ok && Date.parse(moved.data.scheduledAt) === Date.parse(at("14:00")), JSON.stringify(moved));
  ok("1c the OLD time is returned too, so a screen can say what changed",
    moved.ok && Date.parse(moved.data.from.scheduledAt) === Date.parse(at("09:00")), JSON.stringify(moved));

  const trail = await auditFor(wsA, moving);
  ok("2a the move is audited", trail.length === 1, JSON.stringify(trail));
  ok("2b the audit carries BOTH ends",
    Date.parse(trail[0]?.payload?.from?.scheduledAt ?? "") === Date.parse(at("09:00")) &&
    Date.parse(trail[0]?.payload?.to?.scheduledAt ?? "") === Date.parse(at("14:00")),
    JSON.stringify(trail[0]?.payload));

  // ---- 3. An appointment does not collide with itself ----------------------------------------------
  const nudged = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("14:10"),
    actorId: OWNER, correlationId: "rc-3",
  });
  ok("3 a small drag does not collide with the appointment being dragged", nudged.ok, JSON.stringify(nudged));

  // ---- 4. A drag cannot do what typing cannot ------------------------------------------------------
  const occupied = await book("Occupier", "11:00", { locationId: siteA });
  const ontoOccupied = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("11:05"),
    actorId: OWNER, correlationId: "rc-4",
  });
  ok("4a dragging onto a taken slot is refused",
    !ontoOccupied.ok && ontoOccupied.code === "DOUBLE_BOOKED", JSON.stringify(ontoOccupied));

  const forced = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("11:05"), allowOverlap: true,
    actorId: OWNER, correlationId: "rc-4b",
  });
  ok("4b CONTROL: a deliberate double-book still goes through", forced.ok, JSON.stringify(forced));
  const forcedTrail = await auditFor(wsA, moving);
  ok("4c the deliberate override is recorded as forced",
    forcedTrail[0]?.payload?.forced === true, JSON.stringify(forcedTrail[0]?.payload));

  // Put it back somewhere clear before the travel tests.
  const parked = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("14:00"),
    actorId: OWNER, correlationId: "rc-4d",
  });
  ok("4d CONTROL: moving back to a clear time works", parked.ok, JSON.stringify(parked));

  // ---- 5. Moving to another hospital ---------------------------------------------------------------
  // Occupier is 11:00-11:20 at Mulago. Nsambya needs 40 minutes.
  const tooClose = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("11:40"), locationId: siteB,
    actorId: OWNER, correlationId: "rc-5",
  });
  ok("5a moving to another hospital with no time to get there is refused",
    !tooClose.ok && tooClose.code === "TRAVEL_CONFLICT", JSON.stringify(tooClose));

  const farEnough = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("13:00"), locationId: siteB,
    actorId: OWNER, correlationId: "rc-5b",
  });
  ok("5b CONTROL: the same move with room to travel is allowed", farEnough.ok, JSON.stringify(farEnough));
  ok("5c the hospital actually changed",
    farEnough.ok && farEnough.data.locationId === siteB && farEnough.data.from.locationId === siteA,
    JSON.stringify(farEnough));

  // ---- 6. A terminal appointment is history --------------------------------------------------------
  const doomed = await book("Cancelled Patient", "16:00", { locationId: siteA });
  await transitionAppointment(admin, {
    workspaceId: wsA, appointmentId: doomed, to: "CANCELLED", actorId: OWNER, correlationId: "rc-6",
  });
  const moveCancelled = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: doomed, scheduledAt: at("17:00"),
    actorId: OWNER, correlationId: "rc-6b",
  });
  ok("6 a cancelled appointment cannot be moved",
    !moveCancelled.ok && moveCancelled.code === "NOT_RESCHEDULABLE", JSON.stringify(moveCancelled));

  // ---- 7. An arrived patient is standing there -----------------------------------------------------
  const here = await book("Arrived Patient", "18:00", { locationId: siteA });
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: here, to: "CONFIRMED", actorId: OWNER, correlationId: "rc-7" });
  const arrived = await transitionAppointment(admin, { workspaceId: wsA, appointmentId: here, to: "ARRIVED", actorId: OWNER, correlationId: "rc-7b" });
  ok("7a CONTROL: the patient did arrive, so 7b is not vacuous", arrived.ok, JSON.stringify(arrived));
  const movePresent = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: here, scheduledAt: at("19:00"),
    actorId: OWNER, correlationId: "rc-7c",
  });
  ok("7b an arrived patient's appointment cannot be moved",
    !movePresent.ok && movePresent.code === "PATIENT_PRESENT", JSON.stringify(movePresent));

  // ---- 8. A day that has already been ---------------------------------------------------------------
  const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const intoPast = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: `${yesterday.toISOString().slice(0, 10)}T10:00:00.000Z`,
    actorId: OWNER, correlationId: "rc-8",
  });
  ok("8 an appointment cannot be moved into a day that is over",
    !intoPast.ok && intoPast.code === "IN_THE_PAST", JSON.stringify(intoPast));

  // ---- 9. A stale calendar cannot win ---------------------------------------------------------------
  const { data: current } = await admin.from("practice_appointment")
    .select("record_version").eq("id", moving).maybeSingle();
  const staleVersion = (current?.record_version ?? 1) - 1;
  const stale = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("15:30"), expectedVersion: staleVersion,
    actorId: OWNER, correlationId: "rc-9",
  });
  ok("9a a drag from a stale calendar is refused", !stale.ok && stale.code === "STALE", JSON.stringify(stale));

  const fresh = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("15:30"),
    expectedVersion: current?.record_version, actorId: OWNER, correlationId: "rc-9b",
  });
  ok("9b CONTROL: the same drag with the current version works", fresh.ok, JSON.stringify(fresh));
  ok("9c the version advances, so the next stale drag is caught too",
    fresh.ok && fresh.data.recordVersion === (current?.record_version ?? 0) + 1, JSON.stringify(fresh));

  // ---- 10. A drag that lands where it started -------------------------------------------------------
  const before = (await auditFor(wsA, moving)).length;
  const noMove = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("15:30"),
    actorId: OWNER, correlationId: "rc-10",
  });
  ok("10a a drag back to the same place is refused", !noMove.ok && noMove.code === "NO_CHANGE", JSON.stringify(noMove));
  ok("10b and writes no audit entry claiming it moved", (await auditFor(wsA, moving)).length === before);

  // ---- 11. Cross-workspace isolation, non-vacuously --------------------------------------------------
  const crossTenant = await rescheduleAppointment(admin, {
    workspaceId: wsB, appointmentId: moving, scheduledAt: at("16:30"),
    actorId: OTHER, correlationId: "rc-11",
  });
  ok("11a another practice cannot move our appointment",
    !crossTenant.ok && crossTenant.code === "NOT_FOUND", JSON.stringify(crossTenant));

  // ── THE SAME REFUSAL, WITH ONLY ONE CHECK LEFT TO PRODUCE IT ─────────────────────────────────────
  //
  // 11a above is TRUE but UNDER-SPECIFIED, and a failability run proved it: deleting the workspace
  // filter from the appointment read broke nothing, because the appointment had a location and
  // checkPlacement refused the cross-tenant LOCATION instead. Two guards, one assertion, no way to tell
  // which was standing. An appointment with NO location removes the second guard -- and then only the
  // read's tenancy scoping stops practice B rewriting practice A's diary, because the UPDATE itself is
  // keyed on id and record_version alone.
  const placeless = await book("No Location Here", "20:00");
  const crossTenantPlaceless = await rescheduleAppointment(admin, {
    workspaceId: wsB, appointmentId: placeless, scheduledAt: at("20:30"),
    actorId: OTHER, correlationId: "rc-11c",
  });
  ok("11c a placeless appointment is still out of another practice's reach",
    !crossTenantPlaceless.ok && crossTenantPlaceless.code === "NOT_FOUND", JSON.stringify(crossTenantPlaceless));
  const { data: untouched } = await admin.from("practice_appointment")
    .select("scheduled_at").eq("id", placeless).maybeSingle();
  ok("11d and was not moved behind the refusal",
    Date.parse(untouched?.scheduled_at ?? "") === Date.parse(at("20:00")), JSON.stringify(untouched));
  const placelessOurs = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: placeless, scheduledAt: at("20:30"),
    actorId: OWNER, correlationId: "rc-11e",
  });
  ok("11e CONTROL: we can move it, so 11c is about tenancy and not about placelessness",
    placelessOurs.ok, JSON.stringify(placelessOurs));
  const ours = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, scheduledAt: at("16:30"),
    actorId: OWNER, correlationId: "rc-11b",
  });
  ok("11b CONTROL: we can, so 11a is not vacuous", ours.ok, JSON.stringify(ours));

  // ---- Duration, the other half of a drag (resizing the block) ---------------------------------------
  const resized = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, durationMinutes: 45,
    actorId: OWNER, correlationId: "rc-12",
  });
  ok("12a an appointment can be lengthened without moving it",
    resized.ok && resized.data.durationMinutes === 45 &&
    Date.parse(resized.data.scheduledAt) === Date.parse(at("16:30")), JSON.stringify(resized));
  const absurd = await rescheduleAppointment(admin, {
    workspaceId: wsA, appointmentId: moving, durationMinutes: 900,
    actorId: OWNER, correlationId: "rc-12b",
  });
  ok("12b an absurd length is refused", !absurd.ok && absurd.code === "VALIDATION_ERROR", JSON.stringify(absurd));

  // Keep the setup honest: prove the occupier really was where the conflict tests assumed.
  const { data: occ } = await admin.from("practice_appointment").select("scheduled_at, status").eq("id", occupied).maybeSingle();
  // ⚠ THE PROPERTY IS "LIVE", NOT "REQUESTED". This pinned the creation status, so it reddened the day
  // staff bookings began confirming themselves -- against an occupier that was still exactly as live, and
  // still blocking, as it had always been. What the conflict tests rely on is that it participates in the
  // overlap check, and that is the LIVE set the exclusion constraint uses.
  const LIVE = ["REQUESTED", "CONFIRMED", "ARRIVED"];
  ok("CONTROL: the blocking appointment was live at the time the tests assumed",
    !!occ && LIVE.includes(occ.status) && Date.parse(occ.scheduled_at) === Date.parse(at("11:00")), JSON.stringify(occ));

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
