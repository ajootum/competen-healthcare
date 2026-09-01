/**
 * CPB-001 -- PATIENT-FACING AVAILABILITY, AND MANAGING A BOOKING WITHOUT AN ACCOUNT.
 *
 * The comp's panel 8 ("MANAGE BOOKING (NO LOGIN)") and the specification's s13, plus the panel-13
 * go-live line "Real-time availability & slot selection" that had no patient-facing read at all.
 *
 * ⚠ THE STANDARD THIS FILE IS HELD TO. Three refusals that happen to fire together are indistinguishable
 * from one refusal wearing three names. So every control below fixes EXACTLY ONE condition and shows the
 * action succeed, and every refusal is reached with everything else already satisfied. A deliberate break
 * that reds more than its own assertion means the fixture is not isolating what it claims to isolate.
 *
 * WHAT IT PROVES:
 *   1. ⚠ THE PATIENT AVAILABILITY READ SHOWS ONLY FREE TIMES AND SAYS NOTHING ABOUT THE REST. Booking a
 *      time removes exactly that time, and no field of the payload counts, names or explains what was
 *      withheld -- with a control proving the time was on offer a moment earlier.
 *   2. THE LEAD TIME AND THE PAGE'S OWN OFFER LISTS ARE HONOURED, each with a control.
 *   3. ⚠ A BOOKING REFERENCE IS AN IDENTIFIER AND NEVER A CREDENTIAL. A correct reference held by somebody
 *      who verified a different inbox opens nothing -- with a control opening it for the right one.
 *   4. ⚠ A PATIENT RESCHEDULE NEVER ACKNOWLEDGES AN OVERLAP, so migration 255 still refuses a
 *      double-book -- with a control moving to a free time.
 *   5. A RESCHEDULE MUST LAND ON A TIME THE PRACTICE WOULD HAVE OFFERED, with a control.
 *   6. CANCELLING FREES THE TIME, and the freed time is offered again.
 *   7. THE CANCELLATION NOTICE REFUSES ON ITS OWN GROUND, with a control at zero notice.
 *   8. ⚠ NOTHING CLAIMS A MESSAGE WAS SENT, on any of the three payloads.
 *   9. THE PUBLIC ENTRY PAYLOAD IS PLAIN DATA, carries no rating, no review count, no years of
 *      experience and no photograph -- and names the missing patient screen rather than offering a button.
 *
 *   npx --yes tsx scripts/practice-patient-manage-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { issueIdentity, claimHandle, updateIdentity } from "../src/lib/practice/identity-service";
import { saveSession, setAppointmentTypes } from "../src/lib/practice/practice-sessions";
import { generateSlots } from "../src/lib/practice/availability-config";
import { saveBookingAccess, setPublishState } from "../src/lib/practice/patient-access";
import { saveBookingRule } from "../src/lib/practice/booking-rules";
import {
  requestBookingCode, confirmBookingCode, submitBookingRequest,
  bookableSlots, requestManageCode, managedBookings,
  rescheduleManagedBooking, cancelManagedBooking, publicBookingEntry,
  bookingReference, BOOKING_REFERENCE_NOTE, PATIENT_BOOKING_SCREENS_BUILT,
} from "../src/lib/practice/patient-booking";
import type { Transport } from "../src/lib/practice/messaging";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000fc009";
const TZ = "Africa/Kampala";
const CORR = "harness-manage";
const HANDLE = "harnessmanage";

let phoneSeq = 0;
// ⚠ A FRESH NUMBER PER SESSION. issueOtp rate-limits per destination per hour, correctly -- so reusing
// one number would make TOO_MANY_CODES the thing this file measures instead of what it claims to.
const nextPhone = () => `+2567725558${String(10 + phoneSeq++).padStart(2, "0")}`;

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);
const report = () => {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`    FAILED: ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-manage-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    const { data: reqs } = await admin.from("practice_booking_request").select("challenge_id").eq("workspace_id", w.id);
    await admin.from("practice_booking_request").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);
    for (const r of (reqs ?? []) as any[])
      if (r.challenge_id) await admin.from("practice_patient_session").delete().eq("challenge_id", r.challenge_id);
    await admin.from("practice_otp_challenge").delete().eq("workspace_id", w.id);
    await admin.from("practice_message").delete().eq("workspace_id", w.id);
    await admin.from("practice_message_channel").delete().eq("workspace_id", w.id);
    await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_arrival").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
    await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_registration_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_otp_challenge").delete().like("destination", "+256772555%");
  // ⚠ NO practice_audit_event DELETE. Migration 247 makes it append-only and REFUSES the delete; nothing
  // in this file counts audit rows, so nothing needs it.
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

/** Everything "sent" lands here. No request leaves the process, and no code is ever printed. */
const outbox: { kind: string; destination: string; body: string }[] = [];
const recorder: Transport = async (kind, destination, body) => {
  outbox.push({ kind, destination, body });
  return { ok: true, providerMessageId: `harness-${outbox.length}`, response: '{"harness":true}' };
};
const codeFrom = (body: string) => (body.match(/\b(\d{6})\b/) ?? [])[1] ?? "";

/** Ask for a code and complete it, returning a live session token for that number. */
async function freshSession(destination: string): Promise<string> {
  const req = await requestBookingCode(admin, {
    handle: HANDLE, channel: "sms", destination, correlationId: CORR, transport: recorder,
  });
  if (!req.ok) throw new Error(`code request refused: ${req.code} ${req.message}`);
  const confirmed = await confirmBookingCode(admin, {
    challengeId: req.data.challengeId, code: codeFrom(outbox[outbox.length - 1]?.body ?? ""),
  });
  if (!confirmed.ok) throw new Error(`code confirm refused: ${confirmed.code} ${confirmed.message}`);
  return confirmed.data.token;
}

/** The same, through the MANAGE door, so the manage path is exercised end to end rather than borrowed. */
async function manageSession(destination: string): Promise<string> {
  const req = await requestManageCode(admin, {
    handle: HANDLE, channel: "sms", destination, correlationId: CORR, transport: recorder,
  });
  if (!req.ok) throw new Error(`manage code refused: ${req.code} ${req.message}`);
  const confirmed = await confirmBookingCode(admin, {
    challengeId: req.data.challengeId, code: codeFrom(outbox[outbox.length - 1]?.body ?? ""),
  });
  if (!confirmed.ok) throw new Error(`manage confirm refused: ${confirmed.code} ${confirmed.message}`);
  return confirmed.data.token;
}

const intake = (over: Record<string, any> = {}) => ({
  givenName: "Amina", familyName: "Nabirye", birthDate: "1994-03-02", sex: "female",
  reasonForVisit: "persistent headache",
  consentDataCapture: true, consentCommunication: true, ...over,
});

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Walk a payload and return every value that is a function. The Follow-ups board died on one of these. */
function functionsIn(value: unknown, path = "$"): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => functionsIn(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => functionsIn(v, `${path}.${k}`));
  return [];
}

async function main() {
  console.log("\nCPB-001 -- patient availability, and managing a booking without an account\n");
  await cleanup();

  // ══ 0. A PRACTICE THAT CAN ACTUALLY TAKE AND HOLD A PATIENT BOOKING ═══════════════════════════
  section("0. Fixture");

  const ws = await provision(OWNER, "Manage Harness", "a");
  const res = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!res.ok) { ok("0-control. context resolves", false); return report(); }
  const ctx: WorkspaceContext = res.ctx;

  const { data: locRow } = await admin.from("practice_location")
    .insert({ workspace_id: ws, name: "Kampala Rooms", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = locRow!.id as string;

  const identity = await issueIdentity(admin, { userId: OWNER, displayName: "Dr Manage Harness", workspaceId: ws, correlationId: CORR });
  ok("0a-control. an identity was issued", identity.ok, identity.ok ? "" : (identity as any).message);
  const claimed = await claimHandle(admin, { userId: OWNER, handle: HANDLE, correlationId: CORR });
  ok("0b-control. the handle was claimed", claimed.ok, claimed.ok ? "" : (claimed as any).message);
  // The public page only resolves for a discoverable, active identity.
  await updateIdentity(admin, { userId: OWNER, discovery: "link_only", correlationId: CORR });
  await admin.from("practice_practitioner_identity").update({ status: "active" }).eq("user_id", OWNER);

  // A narrow session on every weekday, so any near date works whenever this runs. 08:00-10:00 local at
  // 20 minutes an appointment is six offerable times a day -- few enough to reason about.
  let sessionsMade = 0;
  for (let weekday = 1; weekday <= 7; weekday++) {
    const saved = await saveSession(admin, ctx, {
      weekday, startsMinute: 8 * 60, endsMinute: 10 * 60, locationId: locId,
      sessionName: `Clinic ${weekday}`, bookingMode: "link_only",
      // ⚠ s4.3: ZERO LINKED TYPES MEANS NOT PATIENT-BOOKABLE, and saveSession refuses a patient-facing
      // session with none -- so the types are given here rather than added afterwards.
      appointmentTypes: ["new_consultation"],
      actorId: OWNER, correlationId: CORR,
    });
    if (!saved.ok) continue;
    // Read back through the same engine the availability read uses, so a link that did not land is a
    // fixture failure here rather than an empty diary five sections later.
    const linked = await setAppointmentTypes(admin, ctx, { templateId: saved.data.id, types: ["new_consultation"] });
    if (linked.ok) sessionsMade++;
  }
  ok("0c-control. seven bookable sessions exist, each offering new_consultation -- otherwise every later refusal is just an empty diary",
    sessionsMade === 7, String(sessionsMade));

  await admin.from("practice_registration_template").insert({
    workspace_id: ws, name: "Booking intake", status: "published", is_default: true,
  });

  const generated = await generateSlots(admin, ctx, {
    fromDate: isoDate(new Date()), toDate: isoDate(new Date(Date.now() + 30 * 86400000)),
    actorId: OWNER, correlationId: CORR,
  });
  ok("0d-control. the diary has generated session windows -- bookableSlots reads these, and with none every availability assertion below would be vacuous",
    generated.ok && generated.data.slotsCreated > 0,
    generated.ok ? JSON.stringify(generated.data) : (generated as any).message);

  const savedAccess = await saveBookingAccess(admin, ctx, {
    mode: "link_only", otpRequired: true, visibleLocationIds: [locId],
    visibleAppointmentTypes: ["new_consultation"], consentRequired: true,
    brandDisplayName: "Kampala Rooms", instructions: "Please arrive ten minutes early.",
    actorId: OWNER, correlationId: CORR,
  });
  ok("0e-control. a booking page was configured", savedAccess.ok, savedAccess.ok ? "" : (savedAccess as any).message);
  await admin.from("practice_booking_access").update({ handle: HANDLE }).eq("workspace_id", ws);

  const allowRule = await saveBookingRule(admin, ctx, {
    name: "Patients may book", status: "active", priority: 10,
    channel: "patient_self", leadTimeMinutes: 0, bookingHorizonDays: 365,
      // CPR-BOOK-READY-001 s3: the publish blocker resolves visibility per session, and a rule without one
      // leaves it visibility_unknown -- the check hardened after this fixture was written (2026-08-28).
      visibility: "public",
    cancellationNoticeMinutes: 0,
    actorId: OWNER, correlationId: CORR,
  });
  ok("0f-control. a rule in force covers the patient channel, with no notice period", allowRule.ok,
    allowRule.ok ? "" : (allowRule as any).message);
  if (!allowRule.ok) return report();
  const ruleId = allowRule.data.id;

  await admin.from("practice_message_channel").insert([
    { workspace_id: ws, kind: "sms", enabled: true, sender_name: "Harness" },
  ]);
  process.env.AFRICASTALKING_API_KEY = "harness-only";
  process.env.AFRICASTALKING_USERNAME = "harness";

  const published = await setPublishState(admin, ctx, {
    to: "published", acceptWarnings: true, actorId: OWNER, correlationId: CORR,
  });
  ok("0g-control. the page is published", published.ok, published.ok ? "" : (published as any).message);
  if (!published.ok) return report();

  // ══ 1. WHAT A PATIENT MAY BE OFFERED ══════════════════════════════════════════════════════════
  section("1. Patient-facing availability");

  const window = () => ({
    fromIso: new Date(Date.now() + 2 * 86400000).toISOString(),
    toIso: new Date(Date.now() + 9 * 86400000).toISOString(),
  });

  const first = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("1a. a published page offers real times, computed from the diary rather than stored",
    first.ok && first.data.slots.length > 0 && first.data.slots.every(s => s.locationName === "Kampala Rooms"),
    first.ok ? String(first.data.slots.length) : `${(first as any).code}: ${(first as any).message}`);
  if (!first.ok) return report();

  ok("1b. every offered time is a whole appointment long, not a whole session -- a generated slot is the 08:00-10:00 window and offering it as one time would ask a patient to book two hours",
    first.data.slots.every(s => Date.parse(s.endsAt) - Date.parse(s.startsAt) === first.data.minutes * 60000)
    && first.data.minutes <= 60,
    JSON.stringify({ minutes: first.data.minutes, firstSlot: first.data.slots[0] }));

  const target = first.data.slots[3];
  const beforeCount = first.data.slots.length;

  const { token, phone } = await (async () => {
    const p = nextPhone();
    return { token: await freshSession(p), phone: p };
  })();
  const booked = await submitBookingRequest(admin, { transport: recorder,
    handle: HANDLE, token, intake: intake({ contactPhone: phone }),
    scheduledAt: target.startsAt, appointmentType: "new_consultation",
    locationId: locId, durationMinutes: target.minutes, correlationId: CORR,
  });
  ok("1c-control. an offered time can actually be booked -- so the list is an offer and not a decoration",
    booked.ok, booked.ok ? "" : `${(booked as any).code}: ${(booked as any).message}`);
  if (!booked.ok) return report();

  const after = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("1d. ⚠ THE BOOKED TIME IS GONE, and exactly that one -- one fewer offer, and none of them is it",
    after.ok && after.data.slots.length === beforeCount - 1
    && !after.data.slots.some(s => s.startsAt === target.startsAt),
    after.ok ? `${beforeCount} -> ${after.data.slots.length}` : (after as any).message);
  if (!after.ok) return report();

  const asText = JSON.stringify(after.data);
  ok("1e. ⚠ AND NOTHING SAYS IT WAS TAKEN. No reason, no total, no withheld count, and not the patient's name -- '09:00 is taken' and '09:00 is taken by A Nabirye' are different disclosures and only one was asked for",
    !/withheld|taken|already booked|Nabirye|headache|total|offerable/i.test(asText),
    asText.slice(0, 400));

  // ── THE LEAD TIME, ON ITS OWN GROUND ──────────────────────────────────────────────────────────
  const nearWindow = { fromIso: new Date().toISOString(), toIso: new Date(Date.now() + 3 * 86400000).toISOString() };
  const nearOpen = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...nearWindow });
  ok("1f-control. with no notice period, times inside the next three days are offered",
    nearOpen.ok && nearOpen.data.slots.length > 0, nearOpen.ok ? String(nearOpen.data.slots.length) : (nearOpen as any).message);

  // ⚠ ONE THING CHANGES: the lead time. Two days of notice, against a three-day window.
  await saveBookingRule(admin, ctx, {
    ruleId, leadTimeMinutes: 2 * 24 * 60, actorId: OWNER, correlationId: CORR,
  });
  const nearClosed = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...nearWindow });
  ok("1g. ⚠ THE NOTICE PERIOD REMOVES THE NEAR TIMES, ON ITS OWN GROUND -- only the lead time moved",
    nearClosed.ok && nearOpen.ok && nearClosed.data.slots.length < nearOpen.data.slots.length
    && nearClosed.data.slots.every(s => Date.parse(s.startsAt) >= Date.now() + 2 * 24 * 3600000),
    nearClosed.ok ? `${nearOpen.ok ? nearOpen.data.slots.length : "?"} -> ${nearClosed.data.slots.length}` : (nearClosed as any).message);
  await saveBookingRule(admin, ctx, { ruleId, leadTimeMinutes: 0, actorId: OWNER, correlationId: CORR });

  // ── WHAT THE PAGE NEVER OFFERED IS NEVER ANSWERED FOR ─────────────────────────────────────────
  const wrongType = await bookableSlots(admin, { handle: HANDLE, appointmentType: "teleconsultation", ...window() });
  ok("1h. a kind of appointment this page never offered is refused by name, not answered with an empty list",
    !wrongType.ok && (wrongType as any).code === "TYPE_NOT_OFFERED",
    wrongType.ok ? "it answered" : (wrongType as any).code);

  const noSuchPage = await bookableSlots(admin, { handle: "nobodyhasthishandle", appointmentType: "new_consultation", ...window() });
  ok("1i. and a handle that was never issued answers NOT_FOUND rather than disclosing anything",
    !noSuchPage.ok && (noSuchPage as any).code === "NOT_FOUND",
    noSuchPage.ok ? "it answered" : (noSuchPage as any).code);

  // ══ 2. ⚠ THE REFERENCE IS AN IDENTIFIER, NOT A CREDENTIAL ═════════════════════════════════════
  section("2. Opening a booking without an account");

  const reference = booked.data.reference;
  ok("2a. the confirmation's reference is what managedBookings answers to -- one derivation, not two",
    reference === bookingReference(booked.data.requestId), reference);

  // ⚠ A STRANGER HOLDING THE CORRECT REFERENCE, who has verified their OWN phone. Everything about this
  // call is valid except whose inbox was proved.
  const strangerPhone = nextPhone();
  const strangerToken = await manageSession(strangerPhone);
  const stranger = await managedBookings(admin, { handle: HANDLE, token: strangerToken, reference });
  ok("2b. ⚠ THE CORRECT REFERENCE, HELD BY SOMEBODY WHO VERIFIED A DIFFERENT PHONE, OPENS NOTHING. A reference is printed, forwarded and overheard; it may never be the thing that authorises a change",
    stranger.ok && stranger.data.bookings.length === 0,
    stranger.ok ? JSON.stringify(stranger.data.bookings) : (stranger as any).message);

  ok("2b-detail. and the empty answer says nothing about whether that reference exists at all",
    stranger.ok && !/exists|belongs|another|someone/i.test(JSON.stringify(stranger.data)),
    stranger.ok ? JSON.stringify(stranger.data) : "");

  // ⚠ THE CONTROL: THE SAME REFERENCE, THE SAME PAGE, THE SAME CALL -- only the verified phone differs.
  const ownerToken = await manageSession(phone);
  const mine = await managedBookings(admin, { handle: HANDLE, token: ownerToken, reference });
  ok("2c-control. ⚠ THE SAME REFERENCE, WITH THE PHONE THE BOOKING WAS MADE ON, OPENS IT -- so 2b is about the verified contact and nothing else",
    mine.ok && mine.data.bookings.length === 1 && mine.data.bookings[0].reference === reference,
    mine.ok ? JSON.stringify(mine.data.bookings.map(b => b.reference)) : (mine as any).message);
  if (!mine.ok || mine.data.bookings.length !== 1) return report();

  ok("2d. and it shows the booking's own detail -- service, place, status and the practice's instructions. CONFIRMED because the rule's confirmation_mode is 'instant'; a patient booking is not held pending approval",
    mine.data.bookings[0].appointmentType === "new_consultation"
    && mine.data.bookings[0].locationName === "Kampala Rooms"
    && mine.data.bookings[0].status === "CONFIRMED"
    && mine.data.bookings[0].instructions === "Please arrive ten minutes early.",
    JSON.stringify(mine.data.bookings[0]));

  const badToken = await managedBookings(admin, { handle: HANDLE, token: "not-a-real-token", reference });
  ok("2e. an invalid session opens nothing, and the refusal does not say how it was invalid",
    !badToken.ok && (badToken as any).code === "PATIENT_SESSION_INVALID"
    && !/revoked|expired|unknown|different/i.test((badToken as any).message),
    badToken.ok ? "it answered" : `${(badToken as any).code}: ${(badToken as any).message}`);

  ok("2f. the reference note tells a patient plainly that the reference is not a password",
    mine.data.referenceNote === BOOKING_REFERENCE_NOTE && /not a password/i.test(BOOKING_REFERENCE_NOTE),
    BOOKING_REFERENCE_NOTE);

  // ══ 3. ⚠ RESCHEDULING, THROUGH THE ONE ENGINE, WITH NO OVERLAP EVER ═══════════════════════════
  section("3. Reschedule");

  const free = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  if (!free.ok) { ok("3-control. availability readable", false); return report(); }
  const moveTo = free.data.slots[0];

  // ⚠ A TIME THE PRACTICE WOULD NOT HAVE OFFERED. Seven minutes past the hour is inside no generated
  // grid, so no fresh booking could ever land there -- and neither may a move.
  const offGrid = new Date(Date.parse(moveTo.startsAt) + 7 * 60000).toISOString();
  const refusedMove = await rescheduleManagedBooking(admin, {
    handle: HANDLE, token: ownerToken, reference, scheduledAt: offGrid, correlationId: CORR,
  });
  ok("3a. ⚠ A MOVE MUST LAND ON A TIME THE PRACTICE WOULD HAVE OFFERED. The rules are re-run against the REPLACEMENT, not merely against the original",
    !refusedMove.ok && (refusedMove as any).code === "SLOT_NOT_OFFERED",
    refusedMove.ok ? "it moved" : (refusedMove as any).code);

  const moved = await rescheduleManagedBooking(admin, {
    handle: HANDLE, token: ownerToken, reference, scheduledAt: moveTo.startsAt, correlationId: CORR,
  });
  // ⚠ COMPARED AS INSTANTS, NOT AS STRINGS. Postgres returns '...T05:00:00+00:00' and this process makes
  // '...T05:00:00.000Z'; those are one moment and two strings, and comparing the text made this assertion
  // fail against a reschedule that had worked perfectly.
  ok("3b-control. ⚠ THE SAME CALL, ONTO AN OFFERED TIME, SUCCEEDS -- so 3a is about the replacement slot and nothing else",
    moved.ok && Date.parse(moved.data.to) === Date.parse(moveTo.startsAt),
    moved.ok ? `${moved.data.to} vs ${moveTo.startsAt}` : `${(moved as any).code}: ${(moved as any).message}`);
  if (!moved.ok) return report();

  const { data: movedRow } = await admin.from("practice_appointment")
    .select("id, scheduled_at, overlap_acknowledged, status").eq("id", booked.data.appointmentId).maybeSingle();
  ok("3c. ⚠ AND THE MOVE DID NOT ACKNOWLEDGE AN OVERLAP. A patient has no authority to double-book, so overlap_acknowledged stays false and migration 255's exclusion constraint keeps its say",
    movedRow?.overlap_acknowledged === false, JSON.stringify(movedRow));

  // ⚠ NOW OCCUPY A SECOND TIME AND TRY TO MOVE ONTO IT.
  const stillFree = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  if (!stillFree.ok) { ok("3-control-2. availability readable", false); return report(); }
  const contested = stillFree.data.slots.find(s => s.startsAt !== moveTo.startsAt)!;

  const otherPhone = nextPhone();
  const otherToken = await freshSession(otherPhone);
  const otherBooking = await submitBookingRequest(admin, { transport: recorder,
    handle: HANDLE, token: otherToken, intake: intake({ givenName: "Joel", familyName: "Ssempijja", contactPhone: otherPhone }),
    scheduledAt: contested.startsAt, appointmentType: "new_consultation",
    locationId: locId, durationMinutes: contested.minutes, correlationId: CORR,
  });
  ok("3d-control. a second patient holds another time", otherBooking.ok,
    otherBooking.ok ? "" : `${(otherBooking as any).code}: ${(otherBooking as any).message}`);

  const collide = await rescheduleManagedBooking(admin, {
    handle: HANDLE, token: ownerToken, reference, scheduledAt: contested.startsAt, correlationId: CORR,
  });
  ok("3e. ⚠ A PATIENT CANNOT MOVE ONTO AN OCCUPIED TIME. Refused, and the refusal never names who holds it",
    !collide.ok && ["SLOT_TAKEN", "SLOT_NOT_OFFERED"].includes((collide as any).code)
    && !/Ssempijja|Joel/.test((collide as any).message),
    collide.ok ? "it moved" : `${(collide as any).code}: ${(collide as any).message}`);

  ok("3f. ⚠ AND NOTHING CLAIMS A MESSAGE WAS SENT ABOUT THE MOVE",
    moved.data.confirmationSent === false
    && /no message has been sent/i.test(moved.data.confirmationNote)
    && !/we have (texted|emailed)|check your (phone|inbox)/i.test(moved.data.confirmationNote),
    moved.data.confirmationNote);

  // ══ 4. CANCELLING, AND THE TIME COMING BACK ═══════════════════════════════════════════════════
  section("4. Cancel");

  // ⚠ ONE THING CHANGES: the notice this practice asks for. Ten days, against a booking inside a week.
  await saveBookingRule(admin, ctx, { ruleId, cancellationNoticeMinutes: 10 * 24 * 60, actorId: OWNER, correlationId: CORR });
  const tooLate = await cancelManagedBooking(admin, { handle: HANDLE, token: ownerToken, reference, correlationId: CORR });
  ok("4a. ⚠ THE CANCELLATION NOTICE REFUSES ON ITS OWN GROUND, and names what the practice asks for",
    !tooLate.ok && (tooLate as any).code === "CANCEL_NOT_ALLOWED" && /notice/i.test((tooLate as any).message),
    tooLate.ok ? "it cancelled" : `${(tooLate as any).code}: ${(tooLate as any).message}`);

  const { data: survived } = await admin.from("practice_appointment")
    .select("status").eq("id", booked.data.appointmentId).maybeSingle();
  ok("4a-detail. and the appointment is untouched -- a refusal that had already written would be worse than one that never refused",
    survived?.status === "CONFIRMED", JSON.stringify(survived));

  await saveBookingRule(admin, ctx, { ruleId, cancellationNoticeMinutes: 0, actorId: OWNER, correlationId: CORR });
  const freedTime = moved.data.to;
  const cancelled = await cancelManagedBooking(admin, {
    handle: HANDLE, token: ownerToken, reference, reason: "I am away that week", correlationId: CORR,
  });
  ok("4b-control. ⚠ THE SAME CALL, WITH ONLY THE NOTICE PERIOD LIFTED, CANCELS -- so 4a is the notice and nothing else",
    cancelled.ok && cancelled.data.status === "CANCELLED",
    cancelled.ok ? "" : `${(cancelled as any).code}: ${(cancelled as any).message}`);
  if (!cancelled.ok) return report();

  // ⚠ THIS REQUIRED reasonStoredOnBooking === false AND THE COLUMN NOW EXISTS. Migration 269 gave
  // practice_appointment cancellation_reason, cancelled_by_kind, cancelled_within_notice and
  // cancelled_at, and the engine was WRITTEN FOR THAT DAY -- its comment says "reasonStoredOnBooking
  // below is now read from the attempt rather than hard-coded false, so the day the migration lands the
  // sentence changes on its own". It did. This assertion did not change with it.
  //
  // ⚠ THE CLAIM WORTH KEEPING IS IN ITS OWN LAST CLAUSE: "a payload that quietly dropped it would be
  // the silent half of that". The point was never that the column is absent -- it was that the FLAG
  // MUST NOT LIE about the write, in either direction. So it is now checked against the row: whatever
  // the payload says about storing the reason, the database must agree.
  const { data: cancelRow } = await admin.from("practice_appointment")
    .select("cancellation_reason, cancelled_by_kind").eq("id", cancelled.data.appointmentId).maybeSingle();
  const reasonOnRow = (cancelRow as { cancellation_reason: string | null } | null)?.cancellation_reason ?? null;
  ok("4c. ⚠ THE PAYLOAD DOES NOT LIE ABOUT THE WRITE -- reasonStoredOnBooking agrees with the row",
    cancelled.data.reasonStoredOnBooking === (reasonOnRow !== null),
    JSON.stringify({ flag: cancelled.data.reasonStoredOnBooking, onRow: reasonOnRow }));
  ok("4c-b. and the reason the PATIENT gave is the one stored, attributed to the patient",
    reasonOnRow === "I am away that week"
    && (cancelRow as { cancelled_by_kind: string | null } | null)?.cancelled_by_kind === "patient",
    JSON.stringify(cancelRow));
  // Still true, and still the honest sentence: nothing can be sent because no provider is configured.
  ok("4c-c. and no confirmation is claimed to have been sent, because none can be",
    cancelled.data.confirmationSent === false
    && /no message has been sent/i.test(cancelled.data.confirmationNote),
    cancelled.data.confirmationNote);

  const reopened = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("4d. ⚠ THE CANCELLED TIME IS OFFERED AGAIN. Migration 255's constraint is scoped to live statuses, so the capacity is freed by the status alone with nothing to clean up",
    reopened.ok && reopened.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(freedTime)),
    reopened.ok ? `${freedTime} not among ${reopened.data.slots.length} offers` : (reopened as any).message);

  const gone = await managedBookings(admin, { handle: HANDLE, token: ownerToken, reference });
  ok("4e. ⚠ AND THE CANCELLED BOOKING IS STILL SHOWN, MARKED CANCELLED AND UNCHANGEABLE. Dropping it would answer a patient who cancelled by mistake with 'you have no bookings', which reads as 'we lost it'",
    gone.ok && gone.data.bookings.length === 1
    && gone.data.bookings[0].status === "CANCELLED"
    && gone.data.bookings[0].canCancel === false && gone.data.bookings[0].canReschedule === false
    && /cancelled/i.test(gone.data.bookings[0].whyNot ?? ""),
    gone.ok ? JSON.stringify(gone.data.bookings) : (gone as any).message);

  const twice = await cancelManagedBooking(admin, { handle: HANDLE, token: ownerToken, reference, correlationId: CORR });
  ok("4f. cancelling twice is refused rather than silently reported as done",
    !twice.ok, twice.ok ? "it cancelled again" : (twice as any).code);

  // ══ 5. WHAT THE PUBLIC PAGE MAY SAY ═══════════════════════════════════════════════════════════
  section("5. The public booking entry");

  const entry = await publicBookingEntry(admin, HANDLE);
  ok("5a. the entry resolves for a published page and reports what the practice exposed",
    entry.state === "open" && entry.locations.length === 1
    && entry.appointmentTypes.length === 1 && entry.displayName === "Kampala Rooms",
    JSON.stringify(entry));

  ok("5b. ⚠ EVERY FIELD IS PLAIN DATA. A method on this payload type-checks, passes eslint, passes this file and kills the page at runtime -- which is exactly how the Follow-ups board died",
    functionsIn(entry).length === 0, functionsIn(entry).join(", "));

  ok("5c. ⚠ NO RATING, NO REVIEW COUNT, NO YEARS OF EXPERIENCE AND NO PHOTOGRAPH. The comp shows all four beside a named clinician; no store holds any of them, and a figure invented for a page a patient chooses care from is the worst this product could print",
    !/rating|review|stars?\b|experience|years|photo|avatar|image/i.test(JSON.stringify(entry)),
    JSON.stringify(entry).slice(0, 300));

  // ⚠ THIS ASSERTION IS TURNED ROUND, AND THE OLD ONE IS QUOTED SO THE CHANGE IS VISIBLE RATHER THAN
  // TIDIED AWAY. It read: "with a deliverable channel and a published page, THE ONE REMAINING BLOCKER IS
  // THE MISSING PATIENT SCREEN", and it was true while PATIENT_BOOKING_SCREENS_BUILT was false. The
  // wizard at /practice/book/@handle/appointment and the public route behind it now exist, so the
  // blocker is gone and this asserts the consequence: with everything else in place, a booking is
  // OFFERED. If this ever fails, the screens have stopped existing or the flag has stopped being true --
  // and either way a button somewhere is promising something that dead-ends.
  ok("5d. ⚠ WITH A DELIVERABLE CHANNEL, A PUBLISHED PAGE AND THE PATIENT SCREENS BUILT, BOOKING IS OFFERED AND NO BLOCKER REMAINS",
    entry.canBook === true && entry.blockers.length === 0
    && PATIENT_BOOKING_SCREENS_BUILT === true && entry.whyNot === null,
    JSON.stringify({ canBook: entry.canBook, blockers: entry.blockers, whyNot: entry.whyNot }));

  // ⚠ AND A REQUEST IS A SEPARATE OFFER THAT THIS PRACTICE HAS NOT MADE. The fixture never turned the
  // setting on, so the default is what is being asserted here: shut.
  ok("5d-2. ⚠ AND AN UNVERIFIED REQUEST IS NOT OFFERED, BECAUSE NOBODY TURNED IT ON. The default is the shut position",
    entry.canRequestWithoutCode === false && entry.requestNote === null,
    JSON.stringify({ canRequestWithoutCode: entry.canRequestWithoutCode, requestNote: entry.requestNote }));

  // ⚠ ONE THING CHANGES: the page is paused. Everything else about the fixture stands.
  //
  // ⚠ THIS PIN MOVED WITH CPR-BOOK-HFE-002 s16. It used to assert a paused page answers identically
  // to a handle never issued; the ruling since is that PAUSING IS A POST-PUBLICATION STATE the
  // practice chose, so the page may say "not accepting right now" (closedBecause: paused) -- while a
  // handle never issued still discloses nothing. Both halves are asserted, separately.
  await admin.from("practice_booking_access").update({ publish_state: "paused" }).eq("workspace_id", ws);
  const paused = await publicBookingEntry(admin, HANDLE);
  const neverIssued = await publicBookingEntry(admin, "nobodyhasthishandle");
  ok("5e. a paused page reports closed as the practice's own choice, and names no location, type or person",
    paused.state === "closed" && paused.blockers[0] === "PAGE_PAUSED" && paused.closedBecause === "paused"
    && paused.locations.length === 0 && paused.appointmentTypes.length === 0 && paused.displayName === null,
    JSON.stringify(paused));
  ok("5e-2. while a handle never issued stays indistinguishable from nonexistent -- no paused sentence for it",
    neverIssued.state === "closed" && neverIssued.closedBecause !== "paused",
    JSON.stringify({ state: neverIssued.state, closedBecause: neverIssued.closedBecause }));
  await admin.from("practice_booking_access").update({ publish_state: "published_with_warnings" }).eq("workspace_id", ws);
  const relive = await publicBookingEntry(admin, HANDLE);
  ok("5e-control. and it opens again once republished -- so 5e is about the state, not a broken lookup",
    relive.state === "open", JSON.stringify(relive));

  // ⚠ AND A PAUSED PAGE CLOSES THE MANAGE DOOR TOO. s13's "expired/invalid link: do not expose
  // appointment data" applies to the practice withdrawing the page, not only to a stale token.
  await admin.from("practice_booking_access").update({ publish_state: "paused" }).eq("workspace_id", ws);
  const managePaused = await managedBookings(admin, { handle: HANDLE, token: ownerToken });
  ok("5f. ⚠ AND A PAUSED PAGE EXPOSES NO BOOKING TO ANYBODY, however good their session",
    !managePaused.ok && (managePaused as any).code === "NOT_FOUND",
    managePaused.ok ? JSON.stringify(managePaused.data) : (managePaused as any).code);
  await admin.from("practice_booking_access").update({ publish_state: "published_with_warnings" }).eq("workspace_id", ws);

  await cleanup();
  report();
}

main().catch(e => { console.error(e); process.exit(1); });
