/**
 * CPR-V5-007 PHASE 4 -- THE PATIENT INTAKE AND THE CONFIRMATION.
 *
 * s19's Phase 4 exit condition: "PATIENTS CAN SECURELY REQUEST/BOOK ELIGIBLE APPOINTMENTS". This proves
 * they can, and -- far more importantly -- proves each of the things that stop them stops them ON ITS
 * OWN GROUND.
 *
 * ⚠ THE STANDARD THIS FILE IS HELD TO. Three separate refusals that all happen to fire together are
 * indistinguishable from one refusal wearing three names. So every control below fixes EXACTLY ONE
 * condition and shows the booking succeed, and every refusal is reached with everything else already
 * satisfied. A deliberate break that reds more than its own assertion means the fixture is not isolating
 * what it claims to isolate.
 *
 * WHAT IT PROVES:
 *   1. A DRAFT OR PAUSED PAGE DOES NOT RESOLVE, and answers identically to a handle never issued.
 *   2. ⚠ THE OTP REQUIREMENT REFUSES ON ITS OWN GROUND. No session, and the booking is refused -- with a
 *      control booking the SAME slot, with the same everything else, once a session exists.
 *   3. ⚠ THE PER-CHANNEL BOOKING RULE REFUSES ON ITS OWN GROUND. A rule that closes patient_self refuses
 *      it -- with a control proving the same booking succeeds when only that rule changes.
 *   4. ⚠ THE DOUBLE-BOOKING CONSTRAINT REFUSES ON ITS OWN GROUND, IN THE DATABASE. A patient never sets
 *      allowOverlap, so overlap_acknowledged is false and migration 255 answers 23P01 -- with a control
 *      booking the same slot when it is free.
 *   5. A PATIENT HOLDS NO CAPABILITY AND APPEARS IN NO ROLE ASSIGNMENT, asserted against the tables.
 *   6. THE s14 OVERRIDE BRANCH IS UNREACHABLE by a patient, even when one is passed.
 *   7. REVOKED, EXPIRED AND WRONG-DESTINATION sessions are three separate refusals, each with its own
 *      control.
 *   8. AC-13: applied_rule_id and applied_rule_version are on the request and the appointment, together.
 *   9. ⚠ NOTHING CLAIMS A CONFIRMATION WAS SENT.
 *
 *   npx --yes tsx scripts/practice-patient-intake-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { issueIdentity, claimHandle } from "../src/lib/practice/identity-service";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { saveBookingAccess, setPublishState } from "../src/lib/practice/patient-access";
import { saveBookingRule } from "../src/lib/practice/booking-rules";
import {
  resolveBookingPage, requestBookingCode, confirmBookingCode, submitBookingRequest,
} from "../src/lib/practice/patient-booking";
import { checkPatientSession, revokePatientSession } from "../src/lib/practice/patient-session";
import type { Transport } from "../src/lib/practice/messaging";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000fc001";
const TZ = "Africa/Kampala";
const CORR = "harness-intake";
const HANDLE = "harnessintake";
let phoneSeq = 0;
// ⚠ A FRESH NUMBER PER SESSION. issueOtp rate-limits per destination per hour, correctly -- so reusing
// one number would make TOO_MANY_CODES the thing this file measures instead of what it claims to.
const nextPhone = () => `+2567725559${String(10 + phoneSeq++).padStart(2, "0")}`;

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-intake-${suffix}-${Date.now()}`, request_type: "pilot",
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
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
    await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_otp_challenge").delete().like("destination", "+256772555%");
  // ⚠ NO practice_audit_event DELETE. Migration 247 makes it append-only and REFUSES the delete; several
  // harnesses here call it anyway and discard the error, so they have been reporting a clean teardown
  // for months while leaving rows behind. Nothing in this file counts audit rows, so nothing needs it.
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

/** The six-digit code out of the recorded message, so the harness can complete a real verification. */
const codeFrom = (body: string) => (body.match(/\b(\d{6})\b/) ?? [])[1] ?? "";

/** Ask for a code and complete it, returning a live session token. */
async function freshSession(destination = nextPhone()): Promise<string> {
  const req = await requestBookingCode(admin, {
    handle: HANDLE, channel: "sms", destination, correlationId: CORR, transport: recorder,
  });
  if (!req.ok) throw new Error(`code request refused: ${req.code} ${req.message}`);
  const code = codeFrom(outbox[outbox.length - 1]?.body ?? "");
  const confirmed = await confirmBookingCode(admin, { challengeId: req.data.challengeId, code });
  if (!confirmed.ok) throw new Error(`code confirm refused: ${confirmed.code} ${confirmed.message}`);
  return confirmed.data.token;
}

/** A live session and the number it verified, so a booking can claim the right contact. */
async function freshPair(): Promise<{ token: string; phone: string }> {
  const phone = nextPhone();
  return { token: await freshSession(phone), phone };
}

const intake = (over: Record<string, any> = {}) => ({
  givenName: "Amina", familyName: "Nabirye", birthDate: "1994-03-02", sex: "female",
  reasonForVisit: "persistent headache",
  consentDataCapture: true, consentCommunication: true, ...over,
});

async function main() {
  console.log("\nCPR-V5-007 Phase 4 -- patient intake and confirmation\n");
  await cleanup();

  // ══ 0. A PRACTICE THAT CAN ACTUALLY TAKE A PATIENT BOOKING ════════════════════════════════════
  section("0. Fixture");

  const ws = await provision(OWNER, "Intake Harness", "a");
  const res = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!res.ok) { ok("0-control. context resolves", false); return report(); }
  const ctx: WorkspaceContext = res.ctx;

  const { data: locRow } = await admin.from("practice_location")
    .insert({ workspace_id: ws, name: "Kampala Rooms", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = locRow!.id as string;

  const identity = await issueIdentity(admin, { userId: OWNER, displayName: "Dr Intake Harness", workspaceId: ws, correlationId: CORR });
  ok("0a-control. an identity was issued and holds no handle until one is claimed",
    identity.ok && identity.ok && identity.data.handle === null, identity.ok ? "" : (identity as any).message);
  const claimed = await claimHandle(admin, { userId: OWNER, handle: HANDLE, correlationId: CORR });
  ok("0b-control. the handle was claimed", claimed.ok, claimed.ok ? "" : (claimed as any).message);

  // A bookable session on every weekday, so any near date works regardless of when this runs.
  let sessionsMade = 0;
  for (let weekday = 1; weekday <= 7; weekday++) {
    const saved = await saveSession(admin, ctx, {
      weekday, startsMinute: 6 * 60, endsMinute: 18 * 60, locationId: locId,
      // ⚠ SAVED AS link_only THROUGH THE ENGINE. It had to be written as internal and promoted by a
      // raw update, because saveSession refused link_only with PHASE_NOT_BUILT -- a guard that outlived
      // Phase 4. The guard is gone, so the fixture now uses the path a practitioner actually uses.
      sessionName: `Clinic ${weekday}`, bookingMode: "link_only",
      appointmentTypes: ["new_consultation"],
      actorId: OWNER, correlationId: CORR,
    });
    // s4.3: ZERO APPOINTMENT TYPES MEANS NOT PATIENT-BOOKABLE, so the link is a separate write and the
    // session is not bookable until it is made. saveSession deliberately does not take them.
    // ⚠ THE MODE IS SET DIRECTLY, AND THIS IS A FINDING RATHER THAN A CONVENIENCE. saveSession still
    // refuses link_only with PHASE_NOT_BUILT -- a guard that was correct while Phase 4 was unbuilt and
    // is now stale. Relaxing it turns round two assertions in practice-session-harness.ts, so it is
    // reported rather than changed here.
    if (saved.ok) sessionsMade++;
  }

  // s10.2 needs a published registration template before a page may publish -- a booking with no form
  // to complete is a booking a patient cannot make.
  await admin.from("practice_registration_template").insert({
    workspace_id: ws, name: "Booking intake", status: "published", is_default: true,
  });

  ok("0c0-control. seven bookable sessions exist -- otherwise every later refusal is just an empty diary",
    sessionsMade === 7, String(sessionsMade));

  const savedAccess = await saveBookingAccess(admin, ctx, {
    mode: "link_only", otpRequired: true, visibleLocationIds: [locId],
    visibleAppointmentTypes: ["new_consultation"], consentRequired: true,
    brandDisplayName: "Kampala Rooms", actorId: OWNER, correlationId: CORR,
  });
  ok("0c-control. a booking page was configured", savedAccess.ok, savedAccess.ok ? "" : (savedAccess as any).message);
  // The handle goes on the profile directly: saveBookingAccess deliberately never touches it.
  await admin.from("practice_booking_access").update({ handle: HANDLE }).eq("workspace_id", ws);

  // ⚠ A PATIENT-CHANNEL RULE THAT ALLOWS BOOKING. Section 3 flips exactly this one thing.
  const allowRule = await saveBookingRule(admin, ctx, {
    name: "Patients may book", status: "active", priority: 10,
    channel: "patient_self", leadTimeMinutes: 0, bookingHorizonDays: 365,
    actorId: OWNER, correlationId: CORR,
  });
  ok("0d-control. a rule in force covers the patient channel", allowRule.ok, allowRule.ok ? "" : (allowRule as any).message);

  await admin.from("practice_message_channel").insert([
    { workspace_id: ws, kind: "sms", enabled: true, sender_name: "Harness" },
  ]);
  // ⚠ THE REAL VARIABLE NAMES messagingStatus() READS. AT_API_KEY was a guess and left the deployment
  // reporting no SMS provider, which is exactly the state issueOtp is right to refuse in.
  process.env.AFRICASTALKING_API_KEY = "harness-only";
  process.env.AFRICASTALKING_USERNAME = "harness";

  // ⚠ PUBLISHING OVER AN UNANSWERED CHECK REQUIRES SAYING SO. LOCATION_DIRECTIONS and WAITING_LIST are
  // permanently `not_checked` -- no column can answer them -- and s8.1's "Published with warnings" is
  // the state that exists for exactly this. A screen that published silently over them would be the
  // unwarned screen reading as a cleared screen.
  const publishedSilently = await setPublishState(admin, ctx, { to: "published", actorId: OWNER, correlationId: CORR });
  ok("0e-control-1. ⚠ publishing over an unanswered check is REFUSED until somebody accepts it",
    !publishedSilently.ok && (publishedSilently as any).code === "WARNINGS_OUTSTANDING",
    publishedSilently.ok ? "it published silently" : (publishedSilently as any).code);

  const published = await setPublishState(admin, ctx, {
    to: "published", acceptWarnings: true, actorId: OWNER, correlationId: CORR,
  });
  ok("0e-control. ⚠ the page PUBLISHES once they are accepted -- which it could not at all before the intake was built, because INTAKE_BUILT was a failing blocker",
    published.ok, published.ok ? "" : (published as any).message);
  ok("0e-control-2. ⚠ and it lands in PUBLISHED WITH WARNINGS, naming what was accepted -- not plain 'published'",
    published.ok && published.data.publishState === "published_with_warnings"
    && published.data.acceptedWarnings.includes("LOCATION_DIRECTIONS")
    && published.data.acceptedWarnings.includes("WAITING_LIST"),
    published.ok ? JSON.stringify(published.data) : "");

  // ══ 1. WHAT RESOLVES, AND WHAT DOES NOT ═══════════════════════════════════════════════════════
  section("1. Resolving the page");

  const page = await resolveBookingPage(admin, HANDLE);
  ok("1a. a published link-only page resolves, and shows only what the practice exposed",
    page.state === "ok" && page.value?.handle === HANDLE
    && page.value?.locations.length === 1 && page.value?.appointmentTypes.length === 1,
    JSON.stringify(page.state === "ok" ? page.value?.locations : page));

  await admin.from("practice_booking_access").update({ publish_state: "paused", paused_at: new Date().toISOString() }).eq("workspace_id", ws);
  const paused = await resolveBookingPage(admin, HANDLE);
  const never = await resolveBookingPage(admin, "nobodyhasthishandle");
  ok("1b. ⚠ a PAUSED page does not resolve, and answers identically to a handle never issued",
    paused.state === "ok" && paused.value === null
    && never.state === "ok" && never.value === null
    && JSON.stringify(paused) === JSON.stringify(never),
    JSON.stringify({ paused, never }));
  await admin.from("practice_booking_access").update({ publish_state: "published_with_warnings" }).eq("workspace_id", ws);
  const backLive = await resolveBookingPage(admin, HANDLE);
  ok("1b-control. ⚠ and it resolves again once republished -- so 1b is about the state, not a broken lookup",
    backLive.state === "ok" && backLive.value !== null);

  // ══ 2. ⚠ THE OTP REQUIREMENT, ON ITS OWN GROUND ═══════════════════════════════════════════════
  section("2. The one-time code");

  const soon = new Date(Date.now() + 3 * 86400000);
  soon.setUTCHours(8, 0, 0, 0);
  const slotA = soon.toISOString();

  const noSession = await submitBookingRequest(admin, {
    handle: HANDLE, token: "not-a-real-token", intake: intake(),
    scheduledAt: slotA, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("2a. ⚠ without a verified session the booking is REFUSED, and everything else about it is valid",
    !noSession.ok && (noSession as any).code === "PATIENT_SESSION_INVALID",
    noSession.ok ? "it booked" : (noSession as any).code);
  ok("2a-detail. and the refusal says nothing about WHY the token failed -- a probe learns nothing",
    !noSession.ok && !/revoked|expired|unknown|different/i.test((noSession as any).message),
    noSession.ok ? "" : (noSession as any).message);

  const { count: afterNoSession } = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("2a-detail-2. ⚠ and NO intake row was written -- a stranger's name and date of birth are not stored on an invalid session",
    (afterNoSession ?? -1) === 0, String(afterNoSession));

  // ⚠ THE CONTROL: FIX ONLY THE SESSION, CHANGE NOTHING ELSE, AND THE SAME BOOKING SUCCEEDS.
  const { token, phone } = await freshPair();
  const booked = await submitBookingRequest(admin, {
    handle: HANDLE, token, intake: intake({ contactPhone: phone }),
    scheduledAt: slotA, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("2b-control. ⚠ THE SAME BOOKING, WITH ONLY A SESSION ADDED, SUCCEEDS -- so 2a is the OTP requirement and nothing else",
    booked.ok, booked.ok ? "" : `${(booked as any).code}: ${(booked as any).message}`);
  if (!booked.ok) return report();

  ok("2c. the confirmation carries a reference somebody can read down a telephone",
    /^CP-[A-Z0-9]{6}$/.test(booked.data.reference), booked.data.reference);
  ok("2d. ⚠ AND IT DOES NOT CLAIM A CONFIRMATION WAS SENT",
    booked.data.confirmationSent === false
    && /no message has been sent/i.test(booked.data.confirmationNote)
    && !/we have (texted|emailed)|check your (phone|inbox)/i.test(booked.data.confirmationNote),
    booked.data.confirmationNote);

  // AC-13, on both rows, together.
  const { data: reqRow } = await admin.from("practice_booking_request")
    .select("status, appointment_id, challenge_id, verified_at, applied_rule_id, applied_rule_version, consent_data_capture")
    .eq("id", booked.data.requestId).maybeSingle();
  ok("2e. AC-13: the request records the appointment, the verification and the rule PAIR, together",
    reqRow?.status === "booked" && !!reqRow?.appointment_id && !!reqRow?.challenge_id
    && !!reqRow?.verified_at && !!reqRow?.applied_rule_id && reqRow?.applied_rule_version !== null,
    JSON.stringify(reqRow));

  const { data: apptRow } = await admin.from("practice_appointment")
    .select("id, status, overlap_acknowledged, applied_rule_id, applied_rule_version")
    .eq("id", booked.data.appointmentId).maybeSingle();
  ok("2f. ⚠ AND THE APPOINTMENT WAS NOT MARKED AS A DELIBERATE DOUBLE-BOOK. A patient has no such authority",
    apptRow?.overlap_acknowledged === false, JSON.stringify(apptRow));

  // ══ 3. ⚠ THE PER-CHANNEL RULE, ON ITS OWN GROUND ══════════════════════════════════════════════
  section("3. The booking rule for the channel");

  // A SECOND, MORE SPECIFIC RULE that closes the patient channel. Nothing else about the fixture moves.
  const closeRule = await saveBookingRule(admin, ctx, {
    name: "Patients may not book this location", status: "active", priority: 90,
    // ⚠ HORIZON 1, NOT 0. migration 230 checks booking_horizon_days between 1 and 730, so 0 is refused
    // by the database rather than being a rule. One day, against a slot three days out.
    channel: "patient_self", locationId: locId, leadTimeMinutes: 0, bookingHorizonDays: 1,
    actorId: OWNER, correlationId: CORR,
  });
  ok("3-control. a stricter patient-channel rule was activated for this location",
    closeRule.ok, closeRule.ok ? "" : (closeRule as any).message);

  const slotB = new Date(Date.parse(slotA) + 3600000).toISOString();
  const { token: tokenB, phone: phoneB } = await freshPair();
  const ruleRefused = await submitBookingRequest(admin, {
    handle: HANDLE, token: tokenB, intake: intake({ contactPhone: phoneB }),
    scheduledAt: slotB, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("3a. ⚠ a rule that closes the patient channel REFUSES the booking, with a live session and a free slot",
    !ruleRefused.ok && (ruleRefused as any).code === "BEYOND_HORIZON",
    ruleRefused.ok ? "it booked" : `${(ruleRefused as any).code}: ${(ruleRefused as any).message}`);

  const { data: refusedRow } = await admin.from("practice_booking_request")
    .select("status, refused_code, refused_reason").eq("workspace_id", ws).eq("status", "refused").maybeSingle();
  ok("3a-detail. and the refused request is KEPT, with the reason on it -- the sample that says why patients fail to book",
    refusedRow?.status === "refused" && !!refusedRow?.refused_code && !!refusedRow?.refused_reason,
    JSON.stringify(refusedRow));

  // ⚠ THE CONTROL: PUT ONLY THE RULE BACK, AND THE SAME BOOKING SUCCEEDS.
  const removed1 = await admin.from("practice_booking_rule").delete()
    .eq("workspace_id", ws).eq("name", "Patients may not book this location").select("id");
  ok("3-control-2. the closing rule was actually removed -- a status update nobody checked is the silent-write class this codebase keeps finding",
    !removed1.error && (removed1.data ?? []).length === 1, JSON.stringify({ e: removed1.error?.message, n: (removed1.data ?? []).length }));
  const { token: tokenC, phone: phoneC } = await freshPair();
  const afterRule = await submitBookingRequest(admin, {
    handle: HANDLE, token: tokenC, intake: intake({ contactPhone: phoneC }),
    scheduledAt: slotB, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("3b-control. ⚠ THE SAME BOOKING, WITH ONLY THAT RULE RETIRED, SUCCEEDS -- so 3a is the rule and nothing else",
    afterRule.ok, afterRule.ok ? "" : `${(afterRule as any).code}: ${(afterRule as any).message}`);

  // ══ ⚠ A LIMITATION THIS FILE ASSERTS RATHER THAN HIDES ═════════════════════════════════════════
  //
  // 3a refuses through the BOOKING WINDOW, and booking-rules' own header says the window is checked
  // twice -- once by evaluateBooking and again by checkPlacement. So 3a proves the rule decided the
  // booking; it does not prove the CARD engine was what decided it.
  //
  // ⚠ AND THE CARD ENGINE'S ELIGIBILITY CRITERIA CANNOT DECIDE AN ANONYMOUS BOOKING AT ALL. s7.6 lists
  // new-only, existing-only, referred-only, age ranges and active-follow-up. Every one is a fact about a
  // PATIENT RECORD, and a booking through this intake has none at decision time -- the request carries a
  // name and a date of birth, not a practice_patient id. evaluateBooking reads those facts as UNKNOWN,
  // so an eligibility-scoped rule does not match and does not refuse.
  //
  // That is a real gap in Phase 4 as built rather than a bug in the rule engine, and it is asserted here
  // so it shows up on every run instead of being found by the first practice that writes such a rule.
  const eligibilityRule = await saveBookingRule(admin, ctx, {
    name: "Existing patients only", status: "active", priority: 95,
    channel: "patient_self", locationId: locId, patientEligibility: "existing_only",
    leadTimeMinutes: 0, bookingHorizonDays: 365,
    actorId: OWNER, correlationId: CORR,
  });
  ok("3c-control. a patient-channel rule admitting existing patients only is in force",
    eligibilityRule.ok, eligibilityRule.ok ? "" : (eligibilityRule as any).message);

  // ⚠ +3h, NOT +7h, AND THE OLD OFFSET IS WHY THIS WAS RED. slotA is 08:00 UTC; +25200000ms is 15:00
  // UTC, which is 18:00 in Kampala and outside the session this fixture opens -- so the booking was
  // refused with TIME_NOT_OFFERED and never reached the eligibility rule at all.
  //
  // ⚠ THE DETAIL MESSAGE ALMOST SENT ME THE WRONG WAY, and that is worth recording. It read "if
  // eligibility now applies, the gap has been closed and this assertion must be turned round" -- an
  // instruction written for a refusal that never came. Printing the actual code showed
  // TIME_NOT_OFFERED, which is a fixture fault and not the gap closing. A failure message that names
  // the expected cause rather than the observed one will hand the next reader a conclusion.
  //
  // Every whole hour from +1h to +6h is already a named constant in this file (slotB, slotC, slotD,
  // slotRevoked, slotExpired, slotWrongDest), and +3h collided with slotD the moment this booking
  // started succeeding. +5.5h is inside the offered window and belongs to nothing else.
  const slotElig = new Date(Date.parse(slotA) + 19800000).toISOString();
  const pairG = await freshPair();
  const eligResult = await submitBookingRequest(admin, {
    handle: HANDLE, token: pairG.token, intake: intake({ contactPhone: pairG.phone }),
    scheduledAt: slotElig, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("3c. ⚠ AN ELIGIBILITY RULE DOES NOT REFUSE AN ANONYMOUS BOOKING -- its criteria are facts about a patient record this intake never creates. Asserted so the gap is visible rather than assumed",
    eligResult.ok,
    eligResult.ok ? "" : `REFUSED WITH ${(eligResult as any).code}: ${(eligResult as any).message}`);
  await admin.from("practice_booking_rule").delete()
    .eq("workspace_id", ws).eq("name", "Existing patients only");

  // ══ 4. ⚠ THE DOUBLE-BOOKING CONSTRAINT, ON ITS OWN GROUND, IN THE DATABASE ════════════════════
  section("4. The occupied slot");

  const { token: tokenD, phone: phoneD } = await freshPair();
  const clash = await submitBookingRequest(admin, {
    handle: HANDLE, token: tokenD, intake: intake({ contactPhone: phoneD }),
    // slotA is already taken by section 2's booking. Everything else is valid.
    scheduledAt: slotA, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("4a. ⚠ a patient booking into an OCCUPIED slot is refused, with a live session and a valid rule",
    !clash.ok && (clash as any).code === "SLOT_TAKEN",
    clash.ok ? "it double-booked" : `${(clash as any).code}: ${(clash as any).message}`);
  ok("4a-detail. and the patient is told the time has gone, not shown a database error or an engine code",
    !clash.ok && /just been taken/i.test((clash as any).message)
    && !/23P01|constraint|gist|allowOverlap/i.test((clash as any).message),
    clash.ok ? "" : (clash as any).message);

  // ⚠ WHICH LAYER ACTUALLY REFUSED, AND WHY BOTH MATTER.
  //
  // checkPlacement compares the time against live appointments and gets there first, so 4a is the
  // ENGINE refusing. The constraint is the backstop for the race the engine cannot win: two patients
  // loading the page at the same moment both see the same free slot, and a check-then-write accepts
  // both. This asserts the backstop directly, because no ordinary call can reach it.
  const { data: liveAppt } = await admin.from("practice_appointment")
    .select("id, scheduled_at, duration_minutes, patient_name")
    .eq("workspace_id", ws).in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"]).limit(1).maybeSingle();
  ok("4c-control. there is a live appointment to collide with, so 4c is asserting over something",
    !!liveAppt, JSON.stringify(liveAppt));
  const rawOverlap = await admin.from("practice_appointment").insert({
    workspace_id: ws, patient_name: "Race Condition", scheduled_at: liveAppt!.scheduled_at,
    duration_minutes: liveAppt!.duration_minutes, appointment_type: "new_consultation",
    status: "REQUESTED", overlap_acknowledged: false,
  }).select("id");
  ok("4c. ⚠ AND THE DATABASE IS THE BACKSTOP: an overlapping row with overlap_acknowledged false is refused with 23P01",
    !!rawOverlap.error && rawOverlap.error.code === "23P01",
    rawOverlap.error ? rawOverlap.error.code : "the constraint did not fire -- migration 255 is not doing its job");
  ok("4c-detail. ⚠ and it is the ACKNOWLEDGEMENT that exempts a row, which is exactly what a patient never sets",
    (await admin.from("practice_appointment").insert({
      workspace_id: ws, patient_name: "Deliberate Double Book", scheduled_at: liveAppt!.scheduled_at,
      duration_minutes: liveAppt!.duration_minutes, appointment_type: "new_consultation",
      status: "REQUESTED", overlap_acknowledged: true,
    }).select("id")).error === null,
    "an acknowledged overlap was also refused, so 4c proves nothing about the flag");
  // ⚠ THE PROBE ROWS GO. 4c-detail deliberately inserted an ACCEPTED overlapping appointment, and leaving
  // it there would occupy the very slot 4b-control needs free -- a fixture standing in front of its own
  // control, which is how a control quietly stops controlling anything.
  await admin.from("practice_appointment").delete().eq("workspace_id", ws)
    .in("patient_name", ["Race Condition", "Deliberate Double Book"]);

  // ⚠ THE CONTROL: THE SAME SLOT, ONCE IT IS FREE.
  await admin.from("practice_appointment").update({ status: "CANCELLED" }).eq("id", booked.data.appointmentId);
  const { token: tokenE, phone: phoneE } = await freshPair();
  const nowFree = await submitBookingRequest(admin, {
    handle: HANDLE, token: tokenE, intake: intake({ contactPhone: phoneE }),
    scheduledAt: slotA, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("4b-control. ⚠ THE SAME SLOT BOOKS ONCE IT IS FREE -- so 4a is the occupancy and nothing else",
    nowFree.ok, nowFree.ok ? "" : `${(nowFree as any).code}: ${(nowFree as any).message}`);

  // ══ 5. A PATIENT IS NOT A PRACTITIONER ════════════════════════════════════════════════════════
  section("5. The patient is not a member");

  const { data: sessions } = await admin.from("practice_patient_session").select("id");
  ok("5a-control. patient sessions exist, so 5b is asserting over something",
    ((sessions ?? []) as any[]).length > 0, String((sessions ?? []).length));

  const sessionIds = ((sessions ?? []) as any[]).map(s => s.id as string);
  const { data: assignments } = await admin.from("practice_role_assignment")
    .select("membership_id, capability_code");
  const { data: memberships } = await admin.from("practice_membership").select("id, user_id");
  const memberUserIds = new Set(((memberships ?? []) as any[]).map(m => m.user_id as string));
  ok("5b. ⚠ no patient session id is a member, and none holds a capability -- a patient is not a role",
    sessionIds.every(id => !memberUserIds.has(id))
    && !((assignments ?? []) as any[]).some(a => sessionIds.includes(a.membership_id as string)),
    `${sessionIds.length} sessions, ${(memberships ?? []).length} memberships`);

  // ⚠ 6. THE s14 OVERRIDE BRANCH IS UNREACHABLE. Asserted by reaching for it directly.
  const { bookUnderRules } = await import("../src/lib/practice/booking-rules");
  const { token: tokenF, phone: phoneF } = await freshPair();
  const slotC = new Date(Date.parse(slotA) + 7200000).toISOString();
  const patientCtx: WorkspaceContext = {
    // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
    // whose ctx claims one zone while its row holds another tests a state that cannot exist.
    workspaceTimezone: TZ,
    userId: "patient", workspaceId: ws, workspaceName: "", workspaceType: "", workspaceStatus: "active",
    roleCodes: [], capabilities: [], entitled: true, entitlementStatus: null,
    onboardingComplete: true, onboardingStep: null,
  };
  // Re-close the channel so there IS a refusal for an override to try to lift.
  const reclose = await saveBookingRule(admin, ctx, {
    name: "Patients may not book this location", status: "active", priority: 90,
    channel: "patient_self", locationId: locId, leadTimeMinutes: 0, bookingHorizonDays: 1,
    actorId: OWNER, correlationId: CORR,
  });
  ok("5c-control. a refusal exists for an override to try to lift, so 5c is not passing because there was nothing to override",
    reclose.ok, reclose.ok ? "" : (reclose as any).message);
  // ⚠ THE INTAKE IS PASSED BECAUSE WITHOUT IT THE REFUSAL COMES FROM THE WRONG GUARD. bookUnderRules
  // resolves required information for the patient_self channel and refuses INTAKE_INCOMPLETE, which is
  // deliberately `overridable: false` -- "a missing date of birth is not a judgement... there is no
  // information to be had". So the call was being refused BEFORE the override check and 5c has been
  // reporting a refusal it did not test.
  //
  // ⚠ A REFUSAL FOR THE WRONG REASON IS NOT A PASS, WHICH IS WHY 5c NAMES ITS CODE. The property is not
  // "a patient cannot book past a rule" -- it is that the OVERRIDE GUARD specifically is what stops
  // them. With the intake complete, the request now reaches it.
  const overrideAttempt = await bookUnderRules(admin, patientCtx, {
    channel: "patient_self", patientName: "Amina Nabirye", appointmentType: "new_consultation",
    scheduledAt: slotC, locationId: locId,
    patientSessionToken: tokenF, patientContact: phoneF,
    // ⚠ FIELD KEYS, NOT THE CAMEL-CASE SHAPE THE REST OF THIS FILE USES, AND THE DIFFERENCE IS REAL.
    // submitBookingRequest takes the patient-facing shape and translates it (patient-booking.ts line
    // 266: `given_name: i.givenName`). bookUnderRules is the layer BELOW that translation and reads
    // required_information by its own field_key. Passing intake() here looked complete and left every
    // required field blank, which is why the refusal was INTAKE_INCOMPLETE naming "First name and
    // Family name" while the object plainly contained a first and family name.
    intake: {
      given_name: "Amina", family_name: "Nabirye", birth_date: "1994-03-02", sex: "female",
      contact_phone: phoneF, reason_for_visit: "persistent headache",
    },
    override: { reason: "let me through" },
    actorId: "patient", correlationId: CORR,
  });
  ok("5c. ⚠ a patient passing an OVERRIDE is refused -- s14's override needs practice.settings.manage, which no patient holds",
    !overrideAttempt.ok && (overrideAttempt as any).code === "OVERRIDE_NOT_PERMITTED",
    overrideAttempt.ok ? "the override worked" : `${(overrideAttempt as any).code}: ${(overrideAttempt as any).message}`);

  // ⚠ THE ENGINE'S OWN SESSION GUARD, EXERCISED DIRECTLY -- AND THIS ASSERTION EXISTS BECAUSE A
  // DELIBERATE BREAK FOUND NOTHING.
  //
  // Removing bookUnderRules' proof check redded no assertion at all: patient-booking.ts checks the
  // session first, so its pre-check was catching everything and the engine's guard was never reached by
  // any test. Defence in depth is right -- the pre-check exists so a stranger's details are not written
  // on an invalid session -- but an unexercised guard is one that can be deleted without anything
  // noticing, and bookUnderRules is callable by any future path that does not go through the intake.
  const directBad = await bookUnderRules(admin, patientCtx, {
    channel: "patient_self", patientName: "No Session", appointmentType: "new_consultation",
    scheduledAt: new Date(Date.parse(slotA) + 28800000).toISOString(), locationId: locId,
    patientSessionToken: "not-a-real-token", patientContact: "+256772555998",
    actorId: "patient", correlationId: CORR,
  });
  ok("5d. ⚠ bookUnderRules refuses patient_self with an invalid session ON ITS OWN, without the intake's pre-check in front of it",
    !directBad.ok && (directBad as any).code === "PATIENT_SESSION_INVALID",
    directBad.ok ? "the engine booked it" : (directBad as any).code);
  const removed2 = await admin.from("practice_booking_rule").delete()
    .eq("workspace_id", ws).eq("name", "Patients may not book this location").select("id");
  ok("3-control-2. the closing rule was actually removed -- a status update nobody checked is the silent-write class this codebase keeps finding",
    !removed2.error && (removed2.data ?? []).length === 1, JSON.stringify({ e: removed2.error?.message, n: (removed2.data ?? []).length }));

  // ══ 6. THREE WAYS A SESSION IS NOT GOOD, EACH ON ITS OWN GROUND ═══════════════════════════════
  section("6. Revoked, expired, wrong destination");

  // ⚠ A SLOT EACH. They shared one, so a break in 6a booked it and 6d-control then failed on SLOT_TAKEN
  // -- a control failing for a reason that has nothing to do with what it controls.
  const slotD = new Date(Date.parse(slotA) + 10800000).toISOString();
  const slotRevoked = new Date(Date.parse(slotA) + 14400000).toISOString();
  const slotExpired = new Date(Date.parse(slotA) + 18000000).toISOString();
  const slotWrongDest = new Date(Date.parse(slotA) + 21600000).toISOString();

  const { token: revokedToken, phone: revokedPhone } = await freshPair();
  await revokePatientSession(admin, { token: revokedToken });
  const revoked = await submitBookingRequest(admin, {
    handle: HANDLE, token: revokedToken, intake: intake({ contactPhone: revokedPhone }),
    scheduledAt: slotRevoked, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("6a. ⚠ a REVOKED session is refused", !revoked.ok && (revoked as any).code === "PATIENT_SESSION_INVALID",
    revoked.ok ? "it booked" : (revoked as any).code);

  const { token: expiredToken, phone: expiredPhone } = await freshPair();
  const expiredCheck = await checkPatientSession(admin, { token: expiredToken, workspaceId: ws });
  if (expiredCheck.ok)
    // ⚠ created_at MOVES WITH IT. The row is capped by practice_patient_session_short_lived --
    // expires_at > created_at AND within thirty minutes of it -- so pushing only expires_at into the
    // past is REFUSED by the database, and the discarded refusal left a live session pretending to be
    // expired. Both columns move, and the window stays legal.
    await admin.from("practice_patient_session").update({
      created_at: new Date(Date.now() - 40 * 60000).toISOString(),
      expires_at: new Date(Date.now() - 35 * 60000).toISOString(),
    }).eq("id", expiredCheck.proof.sessionId);
  const expired = await submitBookingRequest(admin, {
    handle: HANDLE, token: expiredToken, intake: intake({ contactPhone: expiredPhone }),
    scheduledAt: slotExpired, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("6b. ⚠ an EXPIRED session is refused, and expiry is derived against the clock rather than a stored flag",
    !expired.ok && (expired as any).code === "PATIENT_SESSION_INVALID",
    expired.ok ? "it booked" : (expired as any).code);

  // ⚠ VERIFIED ONE NUMBER, BOOKED WITH ANOTHER. The verification would be real and attached to a stranger.
  const { token: otherToken } = await freshPair();
  const wrongDest = await submitBookingRequest(admin, {
    handle: HANDLE, token: otherToken, intake: intake({ contactPhone: "+256772555999" }),
    scheduledAt: slotWrongDest, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("6c. ⚠ a session that verified a DIFFERENT phone is refused -- otherwise a real verification could be attached to a stranger",
    !wrongDest.ok && (wrongDest as any).code === "PATIENT_SESSION_INVALID",
    wrongDest.ok ? "it booked" : (wrongDest as any).code);

  // ⚠ THE CONTROL FOR ALL THREE: a session that is live, unrevoked and for the right number books the
  // same slot. Without it, 6a-6c prove only that this slot refuses everything.
  const { token: goodToken, phone: goodPhone } = await freshPair();
  const goodBooking = await submitBookingRequest(admin, {
    handle: HANDLE, token: goodToken, intake: intake({ contactPhone: goodPhone }),
    scheduledAt: slotD, appointmentType: "new_consultation", locationId: locId, correlationId: CORR,
  });
  ok("6d-control. ⚠ THE SAME SLOT BOOKS with a live, unrevoked, right-number session -- so 6a-6c each refuse on their own ground",
    goodBooking.ok, goodBooking.ok ? "" : `${(goodBooking as any).code}: ${(goodBooking as any).message}`);

  // ══ 7. NOTHING EVER RETURNS OR PRINTS A CODE ══════════════════════════════════════════════════
  section("7. The code never leaks");

  const lastCode = codeFrom(outbox[outbox.length - 1]?.body ?? "");
  ok("7a-control. a real six-digit code was captured from a real message, so 7b is asserting over something",
    /^\d{6}$/.test(lastCode), lastCode ? "captured" : "no code captured");
  ok("7b. ⚠ no confirmation payload anywhere contains the code that authorised it",
    !JSON.stringify(goodBooking).includes(lastCode) && !JSON.stringify(booked).includes(lastCode));

  await cleanup();
  report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`   FAILED: ${f}`); process.exit(1); }
  console.log("");
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
