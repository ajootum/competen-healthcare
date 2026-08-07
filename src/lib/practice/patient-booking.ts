import { issueOtp, verifyOtp, type Transport } from "@/lib/practice/messaging";
import { bookUnderRules } from "@/lib/practice/booking-rules";
import {
  issuePatientSession, checkPatientSession, normaliseDestination, type Reading,
} from "@/lib/practice/patient-session";
import { PUBLISH_STATES_LIVE } from "@/lib/practice/publish-constants";
import type { WorkspaceContext } from "@/lib/practice/access";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 4 -- THE PATIENT INTAKE AND THE CONFIRMATION.
//
// s19's Phase 4: "Handle, link-only page, OTP, registration intake, confirmation", exit condition
// "PATIENTS CAN SECURELY REQUEST/BOOK ELIGIBLE APPOINTMENTS". The handle shipped, the OTP machinery
// shipped and was hardened; this file is the intake and the confirmation.
//
// ---- ⚠ FOUR THINGS THIS FILE WILL NOT DO -----------------------------------------------------------
//
//   1. ⚠ IT WILL NOT CLAIM A CONFIRMATION WAS SENT. There is no SMS gateway and no mail provider in this
//      deployment. The confirmation says the booking is made, gives the reference, and states plainly
//      that a message awaits a channel. A screen that said "we've texted you" would send a patient to
//      wait for something that is never coming -- and they would not turn up.
//   2. ⚠ IT WILL NOT WRITE overlap_acknowledged: true. A deliberate double-book is s14's authorised act
//      by a practitioner with a reason. A patient has no such authority, so this file never passes
//      allowOverlap -- migration 255's exclusion constraint therefore refuses a double-book with 23P01,
//      in the database, rather than here. The harness proves it against a real occupied slot.
//   3. ⚠ IT WILL NOT DECIDE A BOOKING. Every rule -- the channel, eligibility, capacity, the follow-up
//      window, the notice period -- is evaluated by bookUnderRules, server-side, from the record. This
//      file supplies a description of the booking and a proof of identity, and nothing else.
//   4. ⚠ IT WILL NOT TELL A STRANGER ANYTHING IT DOES NOT HAVE TO. An unpublished handle and a handle
//      never issued answer identically. A refusal never names another patient, another booking, or how
//      full the diary is.
//
// ---- THE ORDER, AND WHY IT IS THIS ORDER ------------------------------------------------------------
//
//   resolveBookingPage   is this practice reachable at all? Draft and paused do not resolve.
//   requestBookingCode   issue an OTP to a phone or inbox. Refuses when nothing can send it.
//   confirmBookingCode   verify the code, mint a short-lived session. The session is the proof.
//   submitBookingRequest record the intake, then book under the rules, then link the two.
//
// THE INTAKE ROW IS WRITTEN BEFORE THE BOOKING IS ATTEMPTED, and that is deliberate: a refused request
// is a record worth keeping (s10's "failed booking attempts" for Practice Intelligence), and writing it
// afterwards would keep only the ones that succeeded -- which is the sample that tells you nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** s8's modes that admit a patient at all. Copied from migration 254's own constraint. */
const MODES_ADMITTING = ["public", "link_only"];

// ── 1. IS THIS PRACTICE REACHABLE? ───────────────────────────────────────────────────────────────────

export type PublicBookingPage = {
  workspaceId: string;
  handle: string;
  /** What the PAGE calls this practice. Never the internal workspace name unless they chose it. */
  displayName: string | null;
  mode: string;
  instructions: string | null;
  privacyNotice: string | null;
  consentText: string | null;
  consentRequired: boolean;
  otpRequired: boolean;
  otpChannel: string;
  guestBookingAllowed: boolean;
  /** Only what the practice chose to expose. Empty means nothing is visible, not everything. */
  locations: { id: string; name: string }[];
  appointmentTypes: string[];
};

/**
 * Resolve a handle to a booking page, or to nothing.
 *
 * ⚠ DRAFT AND PAUSED DO NOT RESOLVE, AND THEY RESOLVE TO THE SAME NOTHING AS A HANDLE NEVER ISSUED.
 * migration 254's own header makes the point: publishing is what makes a practice findable, so a sweep
 * of guessed handles learns which practices CHOSE to be findable and nothing about the ones that did
 * not. Returning a different answer for "exists but unpublished" would undo that in one line.
 */
export async function resolveBookingPage(
  admin: any, handle: string,
): Promise<Reading<PublicBookingPage | null>> {
  const clean = (handle ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z][a-z0-9]{2,29}$/.test(clean)) return { state: "ok", value: null };

  const { data, error } = await admin.from("practice_booking_access")
    .select("workspace_id, handle, mode, publish_state, otp_required, otp_channel, guest_booking_allowed, visible_location_ids, visible_appointment_types, brand_display_name, instructions, privacy_notice, consent_text, consent_required")
    .eq("handle", clean).maybeSingle();
  // ⚠ AN UNREADABLE STORE IS NOT "NO SUCH PRACTICE". The caller renders an outage, not a 404 -- telling
  // a patient the practice does not exist because a query failed is the wrong answer to give twice.
  if (error) return { state: "unreadable", reason: `this booking page could not be read: ${error.message}` };
  if (!data) return { state: "ok", value: null };

  // Published, or published-with-warnings. Anything else is not reachable, and says nothing about why.
  if (!PUBLISH_STATES_LIVE.includes(String(data.publish_state))) return { state: "ok", value: null };
  if (!MODES_ADMITTING.includes(String(data.mode))) return { state: "ok", value: null };

  // The visible locations, resolved to names. ⚠ SCOPED TO THE OWNING WORKSPACE as well as to the id
  // list: the column is a uuid[] with no foreign key, so a stale or foreign id must not become a name
  // on a public page even though saveBookingAccess refuses to write one.
  const ids = ((data.visible_location_ids ?? []) as string[]).map(String);
  let locations: { id: string; name: string }[] = [];
  if (ids.length > 0) {
    const { data: locs, error: lErr } = await admin.from("practice_location")
      .select("id, name, active").eq("workspace_id", data.workspace_id).in("id", ids);
    if (lErr) return { state: "unreadable", reason: `this practice's locations could not be read: ${lErr.message}` };
    locations = ((locs ?? []) as any[]).filter(l => l.active).map(l => ({ id: l.id as string, name: l.name as string }));
  }

  return {
    state: "ok",
    value: {
      workspaceId: data.workspace_id as string,
      handle: clean,
      displayName: (data.brand_display_name as string | null) ?? null,
      mode: String(data.mode),
      instructions: (data.instructions as string | null) ?? null,
      privacyNotice: (data.privacy_notice as string | null) ?? null,
      consentText: (data.consent_text as string | null) ?? null,
      consentRequired: !!data.consent_required,
      otpRequired: !!data.otp_required,
      otpChannel: String(data.otp_channel ?? "any"),
      guestBookingAllowed: !!data.guest_booking_allowed,
      locations,
      appointmentTypes: ((data.visible_appointment_types ?? []) as string[]).map(String),
    },
  };
}

// ── 2. ASK FOR A CODE ────────────────────────────────────────────────────────────────────────────────

/**
 * Issue a one-time code to a patient's phone or inbox.
 *
 * ⚠ IT NEVER RETURNS THE CODE, AND THERE IS NO DEVELOPMENT SHORTCUT THAT DOES. issueOtp refuses outright
 * when nothing can send, and the honest consequence -- a patient cannot book in this deployment -- is
 * reported rather than papered over by printing the code to the screen. That shortcut is exactly how a
 * development convenience becomes a production bypass.
 *
 * ⚠ THE ANSWER DOES NOT DEPEND ON WHETHER THE DESTINATION IS KNOWN HERE. Nothing in this path reads the
 * patient register, so it cannot tell a stranger whether a number belongs to a patient of this practice.
 */
export async function requestBookingCode(admin: any, args: {
  handle: string; channel: "sms" | "email"; destination: string;
  /** Hashed by messaging.ts before storage. Migration 253 gave the column that makes this real. */
  sourceKey?: string | null;
  correlationId: string; transport?: Transport;
}): Promise<EngineResult<{ challengeId: string; expiresAt: string; sourceLimited: boolean }>> {
  const page = await resolveBookingPage(admin, args.handle);
  if (page.state !== "ok")
    return { ok: false, status: 503, code: "READ_FAILED", message: page.reason };
  // ⚠ THE SAME REFUSAL FOR AN UNPUBLISHED PRACTICE AND A HANDLE NEVER ISSUED.
  if (!page.value)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "There is no booking page at that address." };

  if (page.value.otpChannel !== "any" && page.value.otpChannel !== args.channel)
    return {
      ok: false, status: 422, code: "CHANNEL_NOT_OFFERED",
      message: `this practice sends codes by ${page.value.otpChannel} only`,
    };

  const issued = await issueOtp(admin, {
    workspaceId: page.value.workspaceId, purpose: "booking",
    channel: args.channel, destination: args.destination,
    sourceKey: args.sourceKey ?? null,
    correlationId: args.correlationId, transport: args.transport,
  });
  if (!issued.ok) return issued;

  return {
    ok: true,
    data: {
      challengeId: issued.data.challengeId, expiresAt: issued.data.expiresAt,
      sourceLimited: issued.data.sourceLimited,
    },
  };
}

// ── 3. ENTER THE CODE, GET A SESSION ─────────────────────────────────────────────────────────────────

/**
 * Verify the code and mint the short-lived session that authorises exactly one intake.
 *
 * ⚠ THE TOKEN IS RETURNED ONCE AND NEVER STORED IN THE CLEAR. patient-session.ts holds the reasoning.
 */
export async function confirmBookingCode(admin: any, args: {
  challengeId: string; code: string;
}): Promise<EngineResult<{ token: string; expiresAt: string }>> {
  const verified = await verifyOtp(admin, { challengeId: args.challengeId, code: args.code });
  if (!verified.ok) return verified;

  const session = await issuePatientSession(admin, { challengeId: args.challengeId });
  if (!session.ok)
    return { ok: false, status: session.code === "PATIENT_SESSION_UNREADABLE" ? 503 : 409, code: session.code, message: session.message };

  return { ok: true, data: { token: session.token, expiresAt: session.expiresAt } };
}

// ── 4. THE INTAKE, AND THE BOOKING ───────────────────────────────────────────────────────────────────

/** s9's minimum dataset. Only what is needed to identify the patient and organise the encounter. */
export type BookingIntake = {
  givenName: string;
  familyName: string;
  birthDate?: string | null;
  sex?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  reasonForVisit?: string | null;
  referralSource?: string | null;
  /** s7.6's paediatric path. A guardian is a person, not a checkbox. */
  representativeName?: string | null;
  representativeRelationship?: string | null;
  representativePhone?: string | null;
  consentDataCapture: boolean;
  consentCommunication?: boolean;
};

export type BookingConfirmation = {
  /** ⚠ THE ONE THING A PATIENT CAN QUOTE BACK. Short, and not the row's id. */
  reference: string;
  requestId: string;
  appointmentId: string;
  scheduledAt: string;
  locationName: string | null;
  appointmentType: string;
  /** AC-13. Which rule allowed this, and which version of it. */
  appliedRuleId: string | null;
  appliedRuleVersion: number | null;
  /**
   * ⚠ ALWAYS FALSE IN THIS DEPLOYMENT, AND IT IS A FIELD RATHER THAN PAGE TEXT.
   *
   * A screen that types "we could not text you" into a paragraph keeps saying it after it stops being
   * true. This is read from whether anything could actually have sent, so the day a gateway is
   * configured the sentence changes on its own.
   */
  confirmationSent: boolean;
  /** What the patient should understand about that. Never "we have sent you a message". */
  confirmationNote: string;
};

/** A reference somebody can read down a telephone. Not the uuid, which nobody can. */
const referenceFrom = (requestId: string) =>
  `CP-${requestId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/**
 * Record the intake and make the booking.
 *
 * ⚠ THE REQUEST IS WRITTEN FIRST AND UPDATED AFTERWARDS, so a refusal leaves a record with the reason
 * on it. migration 254's `refusal_has_a_reason` constraint means a refused row cannot exist without a
 * code, which is what makes "why do patients fail to book here" answerable at all.
 */
export async function submitBookingRequest(admin: any, args: {
  handle: string;
  /** The bearer from confirmBookingCode. Proof, not permission. */
  token: string;
  intake: BookingIntake;
  scheduledAt: string;
  appointmentType: string;
  locationId?: string | null;
  durationMinutes?: number | null;
  sourceKey?: string | null;
  correlationId: string;
}): Promise<EngineResult<BookingConfirmation>> {
  const page = await resolveBookingPage(admin, args.handle);
  if (page.state !== "ok") return { ok: false, status: 503, code: "READ_FAILED", message: page.reason };
  if (!page.value) return { ok: false, status: 404, code: "NOT_FOUND", message: "There is no booking page at that address." };
  const p = page.value;

  const contact = args.intake.contactPhone?.trim() || args.intake.contactEmail?.trim() || null;

  // ⚠ THE SESSION IS CHECKED HERE AS WELL AS INSIDE bookUnderRules, and that is not belt-and-braces
  // duplication: this call decides whether to WRITE AN INTAKE ROW AT ALL. Recording a stranger's name,
  // date of birth and reason for visit on the strength of an invalid session would be storing personal
  // data nobody proved they were entitled to submit.
  const proof = await checkPatientSession(admin, {
    token: args.token, workspaceId: p.workspaceId, destination: contact,
  });
  if (!proof.ok)
    return {
      ok: false,
      status: proof.code === "PATIENT_SESSION_UNREADABLE" ? 503 : 403,
      code: proof.code,
      message: proof.code === "PATIENT_SESSION_UNREADABLE"
        ? "this booking was not made because your session could not be checked"
        : "your booking session is not valid. Request a new code and start again.",
    };

  if (p.consentRequired && !args.intake.consentDataCapture)
    return {
      ok: false, status: 422, code: "CONSENT_REQUIRED",
      message: "this practice needs your agreement to keep the details you have entered",
    };

  // s8.1's visible lists are what the page OFFERS, so they are also what it will accept. A type or a
  // location that was never on the page arriving in a request is somebody editing the request.
  if (!p.appointmentTypes.includes(args.appointmentType))
    return { ok: false, status: 422, code: "TYPE_NOT_OFFERED", message: "that kind of appointment is not offered here" };
  if (args.locationId && !p.locations.some(l => l.id === args.locationId))
    return { ok: false, status: 422, code: "LOCATION_NOT_OFFERED", message: "that location is not offered here" };

  // ── THE INTAKE ROW, WRITTEN BEFORE THE BOOKING IS ATTEMPTED ────────────────────────────────────
  const { data: req, error: reqErr } = await admin.from("practice_booking_request").insert({
    workspace_id: p.workspaceId,
    access_id: null,
    location_id: args.locationId ?? null,
    appointment_type: args.appointmentType,
    channel: "patient_self",
    requested_start: args.scheduledAt,
    requested_minutes: args.durationMinutes ?? 20,
    status: "verified",
    challenge_id: proof.proof.challengeId,
    verified_at: new Date().toISOString(),
    given_name: args.intake.givenName?.trim() || null,
    family_name: args.intake.familyName?.trim() || null,
    birth_date: args.intake.birthDate || null,
    sex: args.intake.sex || "unspecified",
    contact_phone: args.intake.contactPhone?.trim() || null,
    contact_email: args.intake.contactEmail?.trim() || null,
    representative_name: args.intake.representativeName?.trim() || null,
    representative_relationship: args.intake.representativeRelationship || null,
    representative_phone: args.intake.representativePhone?.trim() || null,
    reason_for_visit: args.intake.reasonForVisit?.trim() || null,
    referral_source: args.intake.referralSource?.trim() || null,
    consent_data_capture: !!args.intake.consentDataCapture,
    consent_communication: !!args.intake.consentCommunication,
    consent_recorded_at: args.intake.consentDataCapture ? new Date().toISOString() : null,
  }).select("id").maybeSingle();
  if (reqErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: reqErr.message };
  if (!req) return { ok: false, status: 500, code: "NOT_WRITTEN", message: "your details were not recorded, and the database reported no error" };

  const requestId = req.id as string;
  const fail = async (code: string, message: string, status: number) => {
    // ⚠ THE REFUSAL IS RECORDED ON THE REQUEST. Its own error is deliberately NOT allowed to replace the
    // refusal the patient is being given -- but it is not discarded either: a failure to record is
    // appended, so nothing silently claims to have been logged.
    const { error } = await admin.from("practice_booking_request")
      .update({ status: "refused", refused_code: code.slice(0, 60), refused_reason: message.slice(0, 500) })
      .eq("id", requestId);
    return {
      ok: false as const, status, code,
      message: error ? `${message} (this refusal could not be recorded: ${error.message})` : message,
    };
  };

  // ── THE BOOKING, DECIDED BY THE RULES ENGINE ───────────────────────────────────────────────────
  //
  // ⚠ NO allowOverlap, EVER. A patient has no authority to double-book, so the argument is not passed
  // and bookUnderRules writes overlap_acknowledged: false -- which leaves migration 255's exclusion
  // constraint free to refuse an occupied slot with 23P01, in the database.
  //
  // ⚠ NO override, EITHER. s14's override needs practice.settings.manage, which a patient context does
  // not carry; passing one would be refused anyway, and not passing it makes that unmistakable.
  const patientCtx: WorkspaceContext = {
    userId: proof.proof.sessionId,
    workspaceId: p.workspaceId,
    workspaceName: "", workspaceType: "", workspaceStatus: "active",
    roleCodes: [],
    // ⚠ EMPTY, AND IT MUST STAY EMPTY. A patient holds no capability. bookUnderRules substitutes the
    // session proof for the capability test on this channel alone.
    capabilities: [],
    entitled: true, entitlementStatus: null, onboardingComplete: true, onboardingStep: null,
  };

  const booked = await bookUnderRules(admin, patientCtx, {
    channel: "patient_self",
    patientName: `${args.intake.givenName ?? ""} ${args.intake.familyName ?? ""}`.trim() || "Patient",
    patientPhone: args.intake.contactPhone?.trim() || null,
    appointmentType: args.appointmentType,
    scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes ?? null,
    locationId: args.locationId ?? null,
    reason: args.intake.reasonForVisit?.trim() || null,
    patientSessionToken: args.token,
    patientContact: contact,
    actorId: proof.proof.sessionId,
    correlationId: args.correlationId,
  });

  if (!booked.ok) {
    // ⚠ A SLOT THAT HAS GONE IS REPORTED AS A SLOT THAT HAS GONE, WHICHEVER LAYER CAUGHT IT.
    //
    // There are TWO of them and both are real. checkPlacement compares the proposed time against live
    // appointments and refuses with DOUBLE_BOOKED; migration 255's exclusion constraint refuses with
    // 23P01. The engine gets there first in the ordinary case, and the constraint is what catches the
    // race the engine cannot -- two patients loading the page at the same moment both see the same free
    // slot, and a check-then-write accepts both.
    //
    // Either way the patient is told the time has gone. Losing a race must read as "somebody took it",
    // not as an error, and never as a database message.
    const taken = /23P01|no_overlap|exclusion constraint/i.test(booked.message)
      || booked.code === "DOUBLE_BOOKED";
    return await fail(
      taken ? "SLOT_TAKEN" : booked.code,
      taken ? "That time has just been taken. Choose another." : booked.message,
      taken ? 409 : booked.status,
    );
  }

  // ── LINK THE TWO, AND ONLY NOW IS IT `booked` ──────────────────────────────────────────────────
  //
  // migration 254's `booked_is_complete` refuses status 'booked' unless the appointment, the challenge,
  // the verification and the rule pair are ALL present. So this update either satisfies every one of
  // those or the database refuses it -- which is why the appointment id and the rule pair are written
  // in the same statement as the status.
  const { data: linked, error: linkErr } = await admin.from("practice_booking_request").update({
    status: "booked",
    appointment_id: booked.data.appointmentId,
    applied_rule_id: booked.data.appliedRuleId,
    applied_rule_version: booked.data.appliedRuleVersion,
  }).eq("id", requestId).select("id").maybeSingle();
  if (linkErr || !linked) {
    // The appointment EXISTS and the request could not be marked. Reported rather than swallowed: the
    // patient has a booking, and the record of why is incomplete. Saying so beats a clean lie.
    return {
      ok: false, status: 500, code: "BOOKING_NOT_LINKED",
      message: `your appointment was made, but the record of it is incomplete. Quote ${referenceFrom(requestId)} to the practice.${linkErr ? ` (${linkErr.message})` : ""}`,
    };
  }

  return {
    ok: true,
    data: {
      reference: referenceFrom(requestId),
      requestId,
      appointmentId: booked.data.appointmentId,
      scheduledAt: args.scheduledAt,
      locationName: p.locations.find(l => l.id === args.locationId)?.name ?? null,
      appointmentType: args.appointmentType,
      appliedRuleId: booked.data.appliedRuleId,
      appliedRuleVersion: booked.data.appliedRuleVersion,
      // ⚠ FALSE, AND READ RATHER THAN ASSUMED. Nothing here sends anything.
      confirmationSent: false,
      confirmationNote:
        "Your appointment is booked. Write down the reference above -- no message has been sent to you, because this practice has no way to send one yet, so nothing will arrive by text or email. Contact the practice directly if you need to change or cancel it.",
    },
  };
}

export { normaliseDestination };
