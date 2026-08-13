/**
 * CPR-SET-002 v4 Locations, Clinics & Availability Configuration harness. Migration 230.
 *
 * WHAT IT PROVES:
 *   1. THE REGULAR WEEK GENERATES REAL SLOTS, on the right weekday, at the practice's own wall-clock
 *      time -- not UTC's. A Tuesday 09:00 session in Kampala is 06:00Z, and a generator that used UTC
 *      midnight would put it on Monday.
 *   2. GENERATION IS IDEMPOTENT. Running it again produces the same diary rather than a second copy,
 *      which is what makes "update immediately after changes" implementable at all.
 *   3. ⚠ A TEMPLATE MAY NEVER CANCEL A PATIENT'S APPOINTMENT. This is the whole reason the module needs
 *      care: removing a session, or going on leave, must not delete a slot somebody is booked into.
 *      Proven both ways -- by slot_id and by a booking that carries no slot_id at all.
 *   4. A HAND-MADE SLOT IS NEVER TOUCHED by a template. The calendar's own slots are not the
 *      generator's to remove.
 *   5. LEAVE REMOVES A DAY; A ONE-OFF SESSION ADDS ONE. They are opposite instructions and the
 *      generator must tell them apart.
 *   6. BOOKING RULES REFUSE BOOKINGS. Lead time, booking horizon and the walk-in daily limit each turn
 *      a booking down -- a rule that does not refuse is worse than an absent one, because the practice
 *      believes it is holding.
 *   7. A WALK-IN IS EXEMPT FROM LEAD TIME AND HORIZON, and is NOT exempt from the walk-in limit.
 *   8. MOST SPECIFIC RULE WINS, and the refusal names which rule it was.
 *   9. THE PREVIEW SAYS WHY a slot is not offerable, and states that no patient can reach it.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-availability-config-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  addClinic, addSession, removeSession, addException, setBookingRule, editSession, duplicateSession,
  resolveBookingRule, generateSlots, bookingPreview, availabilityConfig,
} from "../src/lib/practice/availability-config";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000af001";
const OTHER = "00000000-0000-4000-8000-0000000af002";
const TZ = "Africa/Kampala"; // UTC+3, no DST -- the arithmetic is checkable by hand.

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
    idempotency_key: `harness-av-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-av",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-av", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
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

/** A Monday well in the future, so nothing here collides with "now" or with lead-time rules. */
function futureMonday(weeksAhead = 6): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while (((d.getUTCDay() + 6) % 7) + 1 !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const plusDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** A Kampala wall-clock time on a date, as the UTC instant it actually is. */
const kampala = (date: string, hh: number, mm = 0) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + (hh * 60 + mm - 180) * 60000).toISOString();

async function main() {
  console.log("\n=== AVAILABILITY CONFIGURATION (CPR-SET-002, migration 230) ===\n");
  await cleanup();

  const wsA = await provision(OWNER, "Dr Availability A", "a");
  const wsB = await provision(OTHER, "Dr Availability B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");

  const { data: loc } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Mulago Hospital", type: "hospital", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = loc!.id as string;

  const MON = futureMonday();
  const TUE = plusDays(MON, 1);
  const SUN = plusDays(MON, 6);

  // ---- Clinics ------------------------------------------------------------------------------------
  const clinic = await addClinic(admin, ctxA.ctx, {
    locationId: locId, name: "Neurology Clinic", consultationMode: "in_person",
    actorId: OWNER, correlationId: "av-0",
  });
  ok("0a a clinic can be added to a location", clinic.ok, JSON.stringify(clinic));
  const dupe = await addClinic(admin, ctxA.ctx, {
    locationId: locId, name: "  neurology clinic ", actorId: OWNER, correlationId: "av-0b",
  });
  ok("0b the same clinic name at one location is refused",
    !dupe.ok && dupe.code === "DUPLICATE_CLINIC", JSON.stringify(dupe));

  // ---- 1. The regular week generates real slots, on the practice's clock ---------------------------
  const tue = await addSession(admin, ctxA.ctx, {
    locationId: locId, clinicId: clinic.ok ? clinic.data.id : null,
    weekday: 2, startsMinute: 9 * 60, endsMinute: 13 * 60,
    actorId: OWNER, correlationId: "av-1",
  });
  ok("1a a Tuesday session can be added", tue.ok, JSON.stringify(tue));

  const gen1 = await generateSlots(admin, ctxA.ctx, {
    fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-1b",
  });
  ok("1b generation reports what it made", gen1.ok && gen1.data.slotsCreated === 1, JSON.stringify(gen1));

  const { data: made } = await admin.from("practice_availability_slot")
    .select("starts_at, ends_at, generated_for_date, generated_from_template_id")
    .eq("workspace_id", wsA).not("generated_from_template_id", "is", null);
  type SlotRow = { starts_at: string; ends_at: string; generated_for_date: string | null };
  const slot = ((made ?? []) as SlotRow[])[0];
  ok("1c it landed on the Tuesday, not the Monday", slot?.generated_for_date === TUE,
    JSON.stringify(slot?.generated_for_date));
  ok("1d at 09:00 KAMPALA, which is 06:00Z -- not 09:00Z",
    !!slot?.starts_at && Date.parse(slot.starts_at) === Date.parse(kampala(TUE, 9)),
    `${slot?.starts_at} vs ${kampala(TUE, 9)}`);
  ok("1e and ends at 13:00 Kampala",
    !!slot?.ends_at && Date.parse(slot.ends_at) === Date.parse(kampala(TUE, 13)));

  // ---- 2. Generation is idempotent ------------------------------------------------------------------
  const gen2 = await generateSlots(admin, ctxA.ctx, {
    fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-2",
  });
  ok("2a a second run creates nothing new", gen2.ok && gen2.data.slotsCreated === 0, JSON.stringify(gen2));
  const { count: afterTwice } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("2b and the diary still holds one slot", afterTwice === 1, String(afterTwice));

  // ---- 4. A hand-made slot is never touched ----------------------------------------------------------
  const { data: handMade } = await admin.from("practice_availability_slot").insert({
    workspace_id: wsA, location_id: locId,
    starts_at: kampala(MON, 14), ends_at: kampala(MON, 16),
    slot_kind: "clinic", status: "OPEN", note: "made by hand in the calendar",
  }).select("id").single();
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-4" });
  const { data: stillThere } = await admin.from("practice_availability_slot")
    .select("id").eq("id", handMade!.id).maybeSingle();
  ok("4a a hand-made slot survives generation", !!stillThere);

  // ---- 3. ⚠ A TEMPLATE MAY NEVER CANCEL A PATIENT'S APPOINTMENT --------------------------------------
  //
  // Booked INTO the generated Tuesday session, deliberately WITHOUT a slot_id -- which is how every
  // booking this product has ever made looks, because slots and bookings were never linked.
  const booking = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Booked Patient", appointmentType: "new_consultation",
    scheduledAt: kampala(TUE, 10), locationId: locId, actorId: OWNER, correlationId: "av-3",
  });
  ok("3a a patient is booked into the generated session", booking.ok, JSON.stringify(booking));

  const removed = await removeSession(admin, ctxA.ctx, {
    templateId: tue.ok ? tue.data.id : "", actorId: OWNER, correlationId: "av-3b",
  });
  ok("3b removing the session reports what it KEPT, not just what it removed",
    removed.ok && removed.data.slotsKept === 1 && removed.data.slotsRemoved === 0,
    JSON.stringify(removed));

  const { data: survived } = await admin.from("practice_availability_slot")
    .select("id").eq("workspace_id", wsA).eq("generated_for_date", TUE).maybeSingle();
  ok("3c ⚠ the slot the patient is booked into SURVIVED", !!survived, JSON.stringify(survived));

  const { count: apptStillThere } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).in("status", ["REQUESTED", "CONFIRMED"]);
  ok("3d and the appointment is untouched", apptStillThere === 1, String(apptStillThere));

  // CONTROL: an unbooked generated slot IS removed, so 3c is not just "removal never happens".
  const wed = await addSession(admin, ctxA.ctx, {
    locationId: locId, weekday: 3, startsMinute: 9 * 60, endsMinute: 11 * 60,
    actorId: OWNER, correlationId: "av-3e",
  });
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-3f" });
  const removedWed = await removeSession(admin, ctxA.ctx, {
    templateId: wed.ok ? wed.data.id : "", actorId: OWNER, correlationId: "av-3g",
  });
  ok("3e CONTROL: an UNBOOKED generated slot is removed, so 3c is not vacuous",
    removedWed.ok && removedWed.data.slotsRemoved === 1, JSON.stringify(removedWed));

  // ---- 5. Leave removes a day; a one-off session adds one ---------------------------------------------
  const thuSession = await addSession(admin, ctxA.ctx, {
    locationId: locId, weekday: 4, startsMinute: 9 * 60, endsMinute: 12 * 60,
    actorId: OWNER, correlationId: "av-5",
  });
  ok("5a-setup the Thursday session was accepted", thuSession.ok, JSON.stringify(thuSession));
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-5b" });
  const THU = plusDays(MON, 3);
  const { count: thuBefore } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", THU);
  ok("5a the Thursday session generated", thuBefore === 1, String(thuBefore));

  const leave = await addException(admin, ctxA.ctx, {
    kind: "leave", fromDate: THU, toDate: THU, reason: "Conference",
    actorId: OWNER, correlationId: "av-5c",
  });
  ok("5b leave can be recorded", leave.ok, JSON.stringify(leave));
  const genLeave = await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-5d" });
  const { count: thuAfter } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", THU);
  ok("5c leave removes that day's generated session", thuAfter === 0,
    `${thuAfter} left, report ${JSON.stringify(genLeave.ok ? genLeave.data : genLeave)}`);

  const extra = await addException(admin, ctxA.ctx, {
    kind: "extra_session", fromDate: SUN, toDate: SUN,
    startsMinute: 10 * 60, endsMinute: 12 * 60, locationId: locId,
    actorId: OWNER, correlationId: "av-5e",
  });
  ok("5d a one-off session can be recorded", extra.ok, JSON.stringify(extra));
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-5f" });
  const { count: sunSlots } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", SUN);
  ok("5e a one-off session ADDS a slot on a day with no template", sunSlots === 1, String(sunSlots));

  // ── WHAT THE REAPER'S GUARDS ACTUALLY PROTECT ──────────────────────────────────────────────────
  //
  // Found by a failability probe, not by design: a one-off session's slot carries generated_for_date
  // but NO template id, so to the stale-slot sweep it looks exactly like a template's orphan. Without
  // the not-null guards, EVERY one-off session is deleted on the next regeneration -- "I am also
  // working this Saturday" would be silently un-typed by the nightly refresh. (Hand-made calendar
  // slots are shielded separately: they carry no generated_for_date at all.)
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-5h" });
  const { count: sunAfterRegen } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("generated_for_date", SUN);
  ok("5g ⚠ the one-off session SURVIVES the next regeneration", sunAfterRegen === 1, String(sunAfterRegen));

  // ---- 11. ⚠ THE BUG A REAL PRACTICE FOUND (CPR-SETUP-003) ----------------------------------------
  //
  // CPR-SET-002 refused overlapping sessions only at the SAME location, reasoning that the travel rule
  // would catch the bookings. It does not: nothing books availability, so both sets of slots were
  // generated and the preview offered eight hours on a four-hour Tuesday. A live workspace ended up
  // with 09:00-13:00 at two different hospitals on one day.
  const other = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "TMR International Hospital", type: "hospital", active: true, travel_buffer_minutes: 30 })
    .select("id").single();
  const otherId = other.data!.id as string;

  // A FRESH PAIR ON A FREE WEEKDAY. Section 3 closes the Tuesday session, so relying on it here made
  // 11a pass vacuously against an empty day -- the harness was testing nothing.
  const satBase = await addSession(admin, ctxA.ctx, {
    locationId: locId, weekday: 6, startsMinute: 9 * 60, endsMinute: 13 * 60,
    actorId: OWNER, correlationId: "av-11base",
  });
  ok("11-setup a Saturday session exists to conflict with", satBase.ok, JSON.stringify(satBase));

  const sameTimeElsewhere = await addSession(admin, ctxA.ctx, {
    locationId: otherId, weekday: 6, startsMinute: 9 * 60, endsMinute: 13 * 60,
    actorId: OWNER, correlationId: "av-11",
  });
  ok("11a ⚠ the same hours at ANOTHER hospital on the same day is refused",
    !sameTimeElsewhere.ok && sameTimeElsewhere.code === "SESSION_OVERLAP", JSON.stringify(sameTimeElsewhere));
  ok("11b and the refusal names both places",
    !sameTimeElsewhere.ok && /TMR/.test(sameTimeElsewhere.message) && /Mulago/.test(sameTimeElsewhere.message),
    (sameTimeElsewhere as { message?: string }).message ?? "");

  // Non-overlapping but inside the travel buffer: Mulago ends 13:00, TMR needs 30 minutes.
  const tooTight = await addSession(admin, ctxA.ctx, {
    locationId: otherId, weekday: 6, startsMinute: 13 * 60 + 10, endsMinute: 15 * 60,
    actorId: OWNER, correlationId: "av-11c",
  });
  ok("11c a session too soon after one at another hospital is refused",
    !tooTight.ok && tooTight.code === "SESSION_TRAVEL_CONFLICT", JSON.stringify(tooTight));

  const farEnoughSession = await addSession(admin, ctxA.ctx, {
    locationId: otherId, weekday: 6, startsMinute: 14 * 60, endsMinute: 16 * 60,
    actorId: OWNER, correlationId: "av-11d",
  });
  ok("11d CONTROL: with enough travel time it IS allowed", farEnoughSession.ok, JSON.stringify(farEnoughSession));

  // ---- 12. Edit, move, suspend, duplicate (CPR-SETUP-003) -----------------------------------------
  const moved = await editSession(admin, ctxA.ctx, {
    templateId: farEnoughSession.ok ? farEnoughSession.data.id : "", weekday: 5,
    actorId: OWNER, correlationId: "av-12",
  });
  ok("12a a session can be moved to another day", moved.ok && moved.data.changed.includes("weekday"),
    JSON.stringify(moved));

  const noChange = await editSession(admin, ctxA.ctx, {
    templateId: farEnoughSession.ok ? farEnoughSession.data.id : "", weekday: 5,
    actorId: OWNER, correlationId: "av-12b",
  });
  ok("12b editing nothing is refused rather than audited as a change",
    !noChange.ok && noChange.code === "NO_CHANGE", JSON.stringify(noChange));

  // Moving it back onto Tuesday at a time that clashes must be refused -- the check runs on edit too.
  const moveIntoClash = await editSession(admin, ctxA.ctx, {
    templateId: farEnoughSession.ok ? farEnoughSession.data.id : "",
    weekday: 6, startsMinute: 9 * 60, endsMinute: 11 * 60,
    actorId: OWNER, correlationId: "av-12c",
  });
  ok("12c ⚠ an EDIT that creates a clash is refused, not just an add",
    !moveIntoClash.ok && moveIntoClash.code === "SESSION_OVERLAP", JSON.stringify(moveIntoClash));

  const suspended = await editSession(admin, ctxA.ctx, {
    templateId: farEnoughSession.ok ? farEnoughSession.data.id : "", status: "suspended",
    actorId: OWNER, correlationId: "av-12d",
  });
  ok("12d a session can be suspended", suspended.ok && suspended.data.changed.includes("status"),
    JSON.stringify(suspended));

  // A SUSPENDED SESSION STAYS ON THE SCREEN AND GENERATES NOTHING. Both halves matter: dropping it
  // from the read would make "suspend" a slower spelling of "delete"; still generating from it would
  // make the button do nothing at all.
  const suspendedId = farEnoughSession.ok ? farEnoughSession.data.id : "";
  const afterSuspend = await availabilityConfig(admin, ctxA.ctx);
  const onScreen = afterSuspend.templates.find(t => t.id === suspendedId);
  ok("12e a suspended session stays on the screen so it can be resumed",
    !!onScreen && onScreen.status === "suspended", JSON.stringify(onScreen));

  const { count: before5 } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA)
    .eq("generated_from_template_id", suspendedId);
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-12e" });
  const { count: after5 } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA)
    .eq("generated_from_template_id", suspendedId);
  ok("12e-gen and it generates nothing while suspended", after5 === before5,
    `${before5} -> ${after5}`);

  // Duplicate: one day free, one already taken.
  const dup = await duplicateSession(admin, ctxA.ctx, {
    templateId: satBase.ok ? satBase.data.id : "", toWeekdays: [1, 6],
    actorId: OWNER, correlationId: "av-12f",
  });
  ok("12f duplicating copies to the free day", dup.ok && dup.data.created.some(c => c.weekday === 1),
    JSON.stringify(dup));
  ok("12g ⚠ and REFUSES the day that clashes rather than refusing the whole operation",
    dup.ok && dup.data.refused.some(r => r.weekday === 6), JSON.stringify(dup));
  ok("12h the refusal for that day says why",
    dup.ok && /overlap|cannot be at/i.test(dup.data.refused.find(r => r.weekday === 6)?.reason ?? ""),
    JSON.stringify(dup.ok ? dup.data.refused : null));
  ok("5f adding time without saying when is refused",
    await addException(admin, ctxA.ctx, {
      kind: "extra_session", fromDate: SUN, toDate: SUN, actorId: OWNER, correlationId: "av-5g",
    }).then(r => !r.ok && r.code === "VALIDATION_ERROR"));

  // ---- 6 + 7 + 8. Booking rules actually refuse ------------------------------------------------------
  const noRule = await resolveBookingRule(admin, wsA, locId, "new_consultation");
  ok("8a with no rule the default is permissive and says so", noRule.source === "default" && noRule.leadTimeMinutes === 0,
    JSON.stringify(noRule));

  const ruleSet = await setBookingRule(admin, ctxA.ctx, {
    leadTimeMinutes: 24 * 60, actorId: OWNER, correlationId: "av-6",
  });
  ok("6a a practice-wide lead time can be set", ruleSet.ok, JSON.stringify(ruleSet));

  const tooSoon = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Too Soon", appointmentType: "new_consultation",
    scheduledAt: new Date(Date.now() + 60 * 60000).toISOString(), locationId: locId,
    actorId: OWNER, correlationId: "av-6b",
  });
  ok("6b a booking inside the lead time is REFUSED",
    !tooSoon.ok && tooSoon.code === "LEAD_TIME", JSON.stringify(tooSoon));
  ok("6c and the refusal says which rule it was",
    !tooSoon.ok && /practice/.test(tooSoon.message) && /1440/.test(tooSoon.message), JSON.stringify(tooSoon));

  const farEnough = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Far Enough", appointmentType: "new_consultation",
    scheduledAt: kampala(TUE, 15), locationId: locId, actorId: OWNER, correlationId: "av-6d",
  });
  ok("6d CONTROL: a booking outside the lead time is allowed", farEnough.ok, JSON.stringify(farEnough));

  // 7. A walk-in has no notice by definition.
  const walkIn = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Walk In Now", appointmentType: "walk_in",
    scheduledAt: new Date(Date.now() + 5 * 60000).toISOString(), locationId: locId,
    actorId: OWNER, correlationId: "av-7",
  });
  ok("7a a walk-in is exempt from the lead time", walkIn.ok, JSON.stringify(walkIn));

  const limit = await setBookingRule(admin, ctxA.ctx, {
    locationId: locId, appointmentType: "walk_in", walkInDailyLimit: 1,
    actorId: OWNER, correlationId: "av-7b",
  });
  ok("7b a walk-in limit can be set for one location and type", limit.ok, JSON.stringify(limit));

  const resolved = await resolveBookingRule(admin, wsA, locId, "walk_in");
  ok("8b the most specific rule wins and names itself",
    resolved.source === "location+type" && resolved.walkInDailyLimit === 1, JSON.stringify(resolved));

  const secondWalkIn = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Walk In Two", appointmentType: "walk_in",
    scheduledAt: new Date(Date.now() + 10 * 60000).toISOString(), locationId: locId,
    actorId: OWNER, correlationId: "av-7c",
  });
  ok("7c a walk-in over the daily limit IS refused -- exempt from notice, not from the limit",
    !secondWalkIn.ok && secondWalkIn.code === "WALK_IN_LIMIT", JSON.stringify(secondWalkIn));

  // Horizon.
  await setBookingRule(admin, ctxA.ctx, {
    leadTimeMinutes: 0, bookingHorizonDays: 7, actorId: OWNER, correlationId: "av-6e",
  });
  const tooFar = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Too Far", appointmentType: "new_consultation",
    scheduledAt: kampala(TUE, 16), locationId: locId, actorId: OWNER, correlationId: "av-6f",
  });
  ok("6e a booking beyond the horizon is refused",
    !tooFar.ok && tooFar.code === "BEYOND_HORIZON", JSON.stringify(tooFar));

  // ---- 9. The preview says WHY --------------------------------------------------------------------
  await setBookingRule(admin, ctxA.ctx, {
    leadTimeMinutes: 0, bookingHorizonDays: null, actorId: OWNER, correlationId: "av-9",
  });
  const preview = await bookingPreview(admin, ctxA.ctx, { fromDate: MON, toDate: SUN });
  ok("9a the preview groups by day", preview.days.length > 0, JSON.stringify(preview.days.map(d => d.date)));
  const tuePreview = preview.days.find(d => d.date === TUE);
  ok("9b a booked slot is not offerable",
    tuePreview?.entries.some(e => !e.offerable && e.withheldBecause === "already booked") === true,
    JSON.stringify(tuePreview?.entries));
  ok("9c and the preview states that no patient can reach it", preview.patientFacing === false);

  // ---- Inert field is listed, not offered -----------------------------------------------------------
  const cfg = await availabilityConfig(admin, ctxA.ctx);
  ok("9d visibility is listed as read by nothing",
    cfg.inert.some(i => i.field === "visibility" && /not built/.test(i.reason)), JSON.stringify(cfg.inert));

  // ---- 10. Cross-workspace isolation, non-vacuously -------------------------------------------------
  const bCfg = await availabilityConfig(admin, ctxB.ctx);
  ok("10a practice B sees none of our sessions", bCfg.templates.length === 0, JSON.stringify(bCfg.templates));
  ok("10b nor our clinics", bCfg.clinics.length === 0);
  ok("10c nor our booking rules", bCfg.rules.length === 0);
  const bRule = await resolveBookingRule(admin, wsB, locId, "new_consultation");
  ok("10d and our rule does not govern their bookings", bRule.source === "default", JSON.stringify(bRule));
  ok("10e CONTROL: practice A does have all three, so 10a-c are not vacuous",
    cfg.templates.length > 0 && cfg.clinics.length > 0 && cfg.rules.length > 0,
    JSON.stringify([cfg.templates.length, cfg.clinics.length, cfg.rules.length]));

  // ---- 13. ⚠ A SESSION'S HOURS CHANGE AND ITS ALREADY GENERATED WINDOWS DO NOT -------------------
  //
  // Found in the owner's live data on 2026-08-13: a window generated at 19:05:01 from a session whose
  // hours were edited at 19:13:44, still sitting at the old time five days later. The idempotency key
  // is template-and-date, so the window counted as PRESENT, and the pass that asks "is the one that is
  // there still right" compared only the place and the activity -- never the hour.
  //
  // ⚠ THE TEMPLATE IS UPDATED DIRECTLY HERE, ON PURPOSE. editSession reaps its own future slots, so
  // going through it would test the reaper and prove nothing about the generator. The generator has to
  // be correct about a template it did not watch change, because that is the state the live data was
  // actually in.
  const RETIME_DAY = 5;                                   // Friday, untouched by every section above
  const FRI = plusDays(MON, 4);
  const retimeSession = await addSession(admin, ctxA.ctx, {
    locationId: locId, weekday: RETIME_DAY, startsMinute: 9 * 60, endsMinute: 11 * 60,
    actorId: OWNER, correlationId: "av-12a",
  });
  ok("13a-setup a Friday session was accepted", retimeSession.ok, JSON.stringify(retimeSession));
  const retimeTplId = retimeSession.ok ? retimeSession.data.id : "";
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-12b" });
  // ⚠ KEYED ON THE TEMPLATE, NOT THE DATE. Other sections put sessions on these weekdays too, and a
  // count-by-date would mix their windows in with this one -- which is how 13c first passed for the
  // wrong reason: the session it was about had been refused as an overlap and never existed.
  const { data: friBefore } = await admin.from("practice_availability_slot")
    .select("id, starts_at").eq("workspace_id", wsA).eq("generated_from_template_id", retimeTplId);
  ok("13a the Friday session generated exactly one window",
    (friBefore ?? []).length === 1, JSON.stringify(friBefore));
  const friSlotId = (friBefore ?? [])[0]?.id;
  const friStartBefore = (friBefore ?? [])[0]?.starts_at;

  await admin.from("practice_availability_template")
    .update({ starts_minute: 14 * 60, ends_minute: 16 * 60 }).eq("id", retimeTplId);
  const genRetime = await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-12c" });
  ok("13b an UNBOOKED window is moved to the session's new hours",
    genRetime.ok && genRetime.data.slotsRetimed === 1, JSON.stringify(genRetime.ok ? genRetime.data : genRetime));
  const { data: friAfter } = await admin.from("practice_availability_slot")
    .select("id, starts_at").eq("workspace_id", wsA).eq("generated_from_template_id", retimeTplId);
  ok("13c it is the SAME row, moved -- not deleted and remade (an appointment's slot_id survives)",
    (friAfter ?? []).length === 1 && (friAfter ?? [])[0]?.id === friSlotId, JSON.stringify(friAfter));
  // ⚠ COMPARED AS INSTANTS. The first version of this line compared the strings and failed on a
  // CORRECT move: kampala() writes 11:00:00.000Z and PostgREST returns 11:00:00+00:00, the same moment
  // spelled two ways. I had written the warning about exactly this into 13e and then not taken it.
  ok("13d and it now starts at 14:00, not 09:00",
    Date.parse((friAfter ?? [])[0]?.starts_at ?? "") === Date.parse(kampala(FRI, 14))
      && Date.parse(friStartBefore ?? "") !== Date.parse((friAfter ?? [])[0]?.starts_at ?? ""),
    `${friStartBefore} -> ${(friAfter ?? [])[0]?.starts_at}, wanted ${kampala(FRI, 14)}`);

  // ⚠ AND RUNNING IT AGAIN MOVES NOTHING. Comparing instants rather than strings is what makes this
  // true: the same moment can be spelled several ways, and a string comparison would rewrite every
  // window on every run for ever while reporting work it did not need to do.
  const genAgain = await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-12d" });
  ok("13e a second run moves nothing (the comparison is on instants, not strings)",
    genAgain.ok && genAgain.data.slotsRetimed === 0, JSON.stringify(genAgain.ok ? genAgain.data : genAgain));

  // ---- 14. THE HALF THAT MUST NOT HAPPEN AUTOMATICALLY -------------------------------------------
  //
  // A window somebody is booked into is NOT moved. Moving it changes the hour that patient was told to
  // arrive, and nothing here can ring them to say so.
  // ⚠ SUNDAY (ISO 7), THE ONLY WEEKDAY NOTHING ELSE IN THIS FILE USES. It took two tries to find:
  // Saturday runs section 8's 09:00-13:00, and Monday is where 12f DUPLICATES that session to. Both
  // times addSession refused the overlap and the assertions below went green anyway, on a session that
  // did not exist. A setup step whose failure leaves the real assertions passing is worse than no test
  // at all -- it reports coverage it does not have. Hence the bookedTplId guards on each one now.
  const bookedSession = await addSession(admin, ctxA.ctx, {
    locationId: locId, weekday: 7, startsMinute: 9 * 60, endsMinute: 11 * 60,
    actorId: OWNER, correlationId: "av-13a",
  });
  ok("14a-setup a Sunday session was accepted", bookedSession.ok, JSON.stringify(bookedSession));
  const bookedTplId = bookedSession.ok ? bookedSession.data.id : "";
  await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-13b" });
  const { data: satBefore } = await admin.from("practice_availability_slot")
    .select("id, starts_at").eq("workspace_id", wsA).eq("generated_from_template_id", bookedTplId);
  ok("14a the Sunday session generated one window",
    bookedTplId !== "" && (satBefore ?? []).length === 1, JSON.stringify(satBefore));
  const satSlotId = (satBefore ?? [])[0]?.id;
  const satStartBefore = (satBefore ?? [])[0]?.starts_at;

  const satBooking = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Retime Patient", appointmentType: "new_consultation",
    scheduledAt: kampala(SUN, 10), locationId: locId, actorId: OWNER, correlationId: "av-13c",
  });
  ok("14b-setup a patient is booked into that window", satBooking.ok, JSON.stringify(satBooking));

  await admin.from("practice_availability_template")
    .update({ starts_minute: 15 * 60, ends_minute: 17 * 60 }).eq("id", bookedTplId);
  const genBooked = await generateSlots(admin, ctxA.ctx, { fromDate: MON, toDate: SUN, actorId: OWNER, correlationId: "av-13d" });
  const stuck = genBooked.ok ? genBooked.data.windowsNeedingAHuman : [];
  // ⚠ `slotsRetimed === 0` IS ALSO WHAT A MISSING SESSION LOOKS LIKE, which is exactly how 14c passed
  // through two broken setups. It has to require that there WAS a window and that it IS booked.
  ok("14c a BOOKED window is NOT moved",
    bookedTplId !== "" && satSlotId !== undefined && satBooking.ok
      && genBooked.ok && genBooked.data.slotsRetimed === 0,
    JSON.stringify(genBooked.ok ? genBooked.data : genBooked));
  ok("14d it is reported for a human, naming both times and the reason",
    stuck.length === 1 && stuck[0]?.slotId === satSlotId && stuck[0]?.reason === "booked"
      && Date.parse(stuck[0]?.currentStart ?? "") === Date.parse(satStartBefore ?? "")
      && Date.parse(stuck[0]?.templateStart ?? "") === Date.parse(kampala(SUN, 15)),
    JSON.stringify(stuck));
  const { data: satAfter } = await admin.from("practice_availability_slot")
    .select("starts_at").eq("workspace_id", wsA).eq("id", satSlotId).maybeSingle();
  ok("14e and the row on disk really did not move (the report is not the only thing that is honest)",
    satSlotId !== undefined && Date.parse(satAfter?.starts_at ?? "") === Date.parse(satStartBefore ?? ""),
    `${satStartBefore} -> ${satAfter?.starts_at}`);

  // ⚠ CONTROL: 13c must not pass because retiming never happens at all. Section 12 already moved a free
  // window in this same workspace, so the two together prove the difference is the BOOKING and nothing
  // else -- same generator, same run range, same practice, opposite outcomes.
  ok("14f CONTROL: the same generator DID move the unbooked window, so 14c is about the booking",
    bookedTplId !== "" && satSlotId !== undefined
      && genRetime.ok && genRetime.data.slotsRetimed === 1
      && genBooked.ok && genBooked.data.slotsRetimed === 0);

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
