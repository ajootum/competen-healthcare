import { issueOtp, verifyOtp, type Transport } from "@/lib/practice/messaging";
import { bookUnderRules, evaluateBooking } from "@/lib/practice/booking-rules";
import { rescheduleAppointment, transitionAppointment, APPOINTMENT_TRANSITIONS } from "@/lib/practice/scheduling";
import { resolveBookingRule } from "@/lib/practice/availability-config";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";
import { audit } from "@/lib/practice/provisioning";
import {
  issuePatientSession, checkPatientSession, normaliseDestination, type Reading,
} from "@/lib/practice/patient-session";
import { recordCancellation } from "@/lib/practice/booking-cancellation";
import { PUBLISH_STATES_LIVE } from "@/lib/practice/publish-constants";
import { isPatientFacingMode } from "@/lib/practice/practice-session-constants";
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
  /** s9's "age as stated". Migration 254 has held the column since it landed and nothing wrote it. */
  ageYears?: number | null;
  /** ⚠ s9's PATIENT-REPORTED CONTEXT. The `stated` prefix is the label and it never comes off. */
  statedDiagnosis?: string | null;
  statedTreatment?: string | null;
  statedHospitalNumber?: string | null;
};

/**
 * The intake as the RULE sees it: keyed by the column each answer lands in.
 *
 * ⚠ THE KEYS ARE THE COLUMN NAMES ON PURPOSE. BOOKING_INTAKE_FIELDS names a `column` for every question
 * and a question with no column cannot exist -- so keying the map this way is what makes it impossible
 * for a rule to insist on an answer there is nowhere to put.
 */
const intakeAnswers = (i: BookingIntake): Record<string, unknown> => ({
  given_name: i.givenName?.trim() ?? "",
  family_name: i.familyName?.trim() ?? "",
  birth_date: i.birthDate ?? null,
  age_years: i.ageYears ?? null,
  // ⚠ 'unspecified' READS AS BLANK TO THE RULE, and that is the point. It is the column's default, so a
  // practice that insists on sex must not have that insistence satisfied by nobody answering.
  sex: i.sex && i.sex !== "unspecified" ? i.sex : null,
  contact_phone: i.contactPhone?.trim() ?? null,
  contact_email: i.contactEmail?.trim() ?? null,
  representative_name: i.representativeName?.trim() ?? null,
  representative_relationship: i.representativeRelationship ?? null,
  representative_phone: i.representativePhone?.trim() ?? null,
  reason_for_visit: i.reasonForVisit?.trim() ?? null,
  referral_source: i.referralSource?.trim() ?? null,
  stated_diagnosis: i.statedDiagnosis?.trim() ?? null,
  stated_treatment: i.statedTreatment?.trim() ?? null,
  stated_hospital_number: i.statedHospitalNumber?.trim() ?? null,
  // ⚠ A `false` CONSENT IS AN ANSWER, NOT A BLANK, so a rule that requires it is satisfied by a
  // deliberate no. Requiring somebody to say yes is not a required question, it is a condition of
  // booking, and this product does not have one.
  consent_communication: i.consentCommunication === true ? true : false,
});

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
  /**
   * ⚠ WHAT WAS TYPED AND NOT KEPT, IN ONE SENTENCE, OR NULL.
   *
   * A practice may switch a question off. When somebody's answer to a withdrawn question is thrown away
   * the confirmation says so -- silently discarding it would leave a patient believing they had told the
   * practice something they had not.
   */
  answersNotKept: string | null;
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

  // ══ s7.2's REQUIRED INFORMATION, RESOLVED BEFORE ANYTHING IS WRITTEN ═══════════════════════════
  //
  // ⚠ THE PREVIEW EXISTS SO THAT THE ROW IS WRITTEN WITH THE ANSWERS THE RULE ACTUALLY ASKS FOR. This
  // file's own header says the intake row is written FIRST so a refusal leaves a record -- which is
  // right, and which means the row is written before bookUnderRules has had a chance to say which
  // answers may be kept. Asking the engine first is what reconciles the two: the record of a refused
  // attempt is still written, and it is written without the answers to questions this rule withdrew.
  //
  // ⚠ IT IS NOT THE DECISION. bookUnderRules re-runs the whole evaluation at the moment of the write,
  // from the same function, exactly as the route's `evaluate` action is not a token for `book`.
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

  const answers = intakeAnswers(args.intake);
  const preview = await evaluateBooking(admin, patientCtx, {
    channel: "patient_self", appointmentType: args.appointmentType, scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes ?? null, locationId: args.locationId ?? null,
    intake: answers,
  });
  // An outage or s11's blocked conflict. Neither is a refusal a record can usefully carry, because
  // there is no request row yet and the attempt did not reach a rule.
  if (!preview.ok) return preview;
  const kept = preview.data.intake?.values ?? answers;
  const keptStr = (key: string) => {
    const v = kept[key];
    return v === undefined || v === null || v === "" ? null : String(v);
  };

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
    // ⚠ EVERY ANSWER BELOW COMES FROM `kept`, NEVER FROM `args.intake`. That is the whole of s7.2's
    // "do not ask" being real: a question the rule withdrew has already been deleted from the map, so
    // there is no path by which an answer nobody was asked for reaches a column. Reading args.intake
    // here again would put it straight back.
    given_name: keptStr("given_name"),
    family_name: keptStr("family_name"),
    birth_date: keptStr("birth_date"),
    age_years: kept.age_years === null || kept.age_years === undefined || kept.age_years === ""
      ? null : Math.trunc(Number(kept.age_years)),
    // The column is NOT NULL with its own default, so a withdrawn or unanswered sex is the default and
    // never a null. intakeAnswers() maps the default back to blank for the rule, so the two agree.
    sex: keptStr("sex") ?? "unspecified",
    contact_phone: keptStr("contact_phone"),
    contact_email: keptStr("contact_email"),
    representative_name: keptStr("representative_name"),
    representative_relationship: keptStr("representative_relationship"),
    representative_phone: keptStr("representative_phone"),
    reason_for_visit: keptStr("reason_for_visit"),
    referral_source: keptStr("referral_source"),
    stated_diagnosis: keptStr("stated_diagnosis"),
    stated_treatment: keptStr("stated_treatment"),
    stated_hospital_number: keptStr("stated_hospital_number"),
    // ⚠ CONSENT IS NOT A RULE QUESTION AND IS NOT TAKEN FROM `kept`. Whether it is required, and the
    // words it is asked in, belong to the booking PAGE -- see INTAKE_NOT_CONFIGURABLE. Only the
    // COMMUNICATION preference is a rule question, because it is a preference rather than a permission.
    consent_data_capture: !!args.intake.consentDataCapture,
    consent_communication: kept.consent_communication === true,
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
  const booked = await bookUnderRules(admin, patientCtx, {
    channel: "patient_self",
    patientName: `${args.intake.givenName ?? ""} ${args.intake.familyName ?? ""}`.trim() || "Patient",
    patientPhone: args.intake.contactPhone?.trim() || null,
    appointmentType: args.appointmentType,
    scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes ?? null,
    locationId: args.locationId ?? null,
    // ⚠ FROM `kept`, LIKE THE ROW. A practice that switched "reason for the visit" off must not find it
    // on the diary entry, which is the one place a withdrawn answer would still be visible.
    reason: keptStr("reason_for_visit"),
    // ⚠ THE SAME MAP THE PREVIEW WAS GIVEN, so the check that decides the booking is the check the row
    // was written against. Handing bookUnderRules the already-cleaned `kept` instead would let a
    // required-but-withdrawn question pass, because a value the rule deleted cannot be found missing.
    intake: answers,
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
      // ⚠ SAID, NOT SILENTLY DONE. Somebody who typed a reason for their visit into a practice that does
      // not ask for one is entitled to know it was not kept, rather than to assume the practitioner has
      // read it.
      answersNotKept: booked.data.intakeDiscardNotice,
    },
  };
}

// ── 5. WHAT TIMES ARE ACTUALLY FREE ──────────────────────────────────────────────────────────────────
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPB-001 s10, and the comp's "Step 3 -- Select Date & Time".
//
// ⚠ THIS IS THE PATIENT-FACING READ, AND IT IS NOT bookingPreview(). They compute the same thing and are
// deliberately separate functions, because they are allowed to SAY different things:
//
//   bookingPreview  is a practitioner looking at their own diary. It returns unofferable times WITH THE
//                   REASON -- "already booked", "inside the notice period" -- which is exactly what a
//                   practitioner needs and exactly what a stranger must never be told.
//   bookableSlots   returns ONLY what can be booked, and nothing about what cannot. Migration 255's own
//                   section 5 puts it in one line: "'09:00 is taken' and '09:00 is taken by an oncology
//                   follow-up for J Smith' are different disclosures and only one of them was asked for."
//
// ⚠ SO THERE IS NO WITHHELD COUNT ON THE PAYLOAD, AND ITS ABSENCE IS THE CONTROL. "3 of 24 times are
// free" tells anybody who can load a public page how full a named clinician's diary is, every hour, for
// free. The harness asserts that no field of this payload carries that number.
//
// ⚠ AND THE APPOINTMENT READ SELECTS FOUR COLUMNS. scheduled_at and duration_minutes decide freeness;
// patient_name, patient_id, reason and appointment_type decide nothing and are not read. Migration 255's
// idx_practice_appointment_live_span exists so that the cheapest query is also the one that touches least.
//
// ⚠ IT IS NOT A RESERVATION AND IT IS NOT A PROMISE. Between this read and submitBookingRequest anybody
// may take the time. That race is settled by migration 255's exclusion constraint, in the database, and
// not by anything here -- which is why this function holds nothing and expires nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The slot kinds a patient could actually be seen in. `leave`, `blocked` and `admin` are not offers. */
const SLOT_KINDS_SEEING_PATIENTS = ["clinic", "telemedicine", "emergency_reserve"];

/** How far ahead this function will look, whatever it is asked for. Bounds the read, not the rule. */
const AVAILABILITY_WINDOW_CAP_DAYS = 120;

export type BookableSlot = {
  /** The session window this time came out of. Provenance, not a reservation. */
  sourceSlotId: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  locationId: string | null;
  locationName: string | null;
};

export type BookableTimes = {
  appointmentType: string;
  minutes: number;
  /** The practice's own timezone, so a page can print a local time without guessing one. */
  timezone: string;
  /** The window actually searched, which may be narrower than the one asked for. */
  fromIso: string;
  toIso: string;
  /**
   * ⚠ ONLY OFFERABLE TIMES. Never a taken one, never a reason, never a total. See the header.
   */
  slots: BookableSlot[];
};

/**
 * The times a patient may be offered, computed from the diary and the rules rather than stored.
 *
 * ⚠ A FAILED READ IS NOT AN EMPTY DIARY. Every query below is error-checked and an unreadable anything
 * refuses with READ_FAILED -- because "no times are available" and "nobody could tell" are different
 * sentences, and printing the first when the second is true sends a patient away from a practice that
 * was open.
 */
export async function bookableSlots(admin: any, args: {
  handle: string;
  appointmentType: string;
  locationId?: string | null;
  fromIso: string;
  toIso: string;
}): Promise<EngineResult<BookableTimes>> {
  const page = await resolveBookingPage(admin, args.handle);
  if (page.state !== "ok") return { ok: false, status: 503, code: "READ_FAILED", message: page.reason };
  if (!page.value) return { ok: false, status: 404, code: "NOT_FOUND", message: "There is no booking page at that address." };
  const p = page.value;

  // The page OFFERS these, so the page also ANSWERS for these. A type or a location that was never on it
  // arriving here is somebody editing the request, and it is refused the same way submitBookingRequest
  // refuses it rather than quietly returning nothing.
  if (!p.appointmentTypes.includes(args.appointmentType))
    return { ok: false, status: 422, code: "TYPE_NOT_OFFERED", message: "that kind of appointment is not offered here" };
  if (args.locationId && !p.locations.some(l => l.id === args.locationId))
    return { ok: false, status: 422, code: "LOCATION_NOT_OFFERED", message: "that location is not offered here" };

  const fromMs = Date.parse(args.fromIso);
  const toMsAsked = Date.parse(args.toIso);
  if (Number.isNaN(fromMs) || Number.isNaN(toMsAsked) || toMsAsked <= fromMs)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a window needs a start and a later end" };
  const toMs = Math.min(toMsAsked, fromMs + AVAILABILITY_WINDOW_CAP_DAYS * 86400000);
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const minutes = await defaultAppointmentMinutes(admin, p.workspaceId);

  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("timezone").eq("id", p.workspaceId).maybeSingle();
  if (wsErr) return { ok: false, status: 503, code: "READ_FAILED", message: `this practice could not be read: ${wsErr.message}` };
  const timezone = (ws?.timezone as string | null) || "UTC";

  // ── THE SESSION WINDOWS ────────────────────────────────────────────────────────────────────────
  //
  // status OPEN as well as slot_kind, and the pair is not redundant: /api/v1/practice/availability
  // writes BLOCKED and CLOSED rows with a clinic kind, so filtering on the kind alone would offer a
  // patient time the practitioner has explicitly blocked out.
  const { data: slotRows, error: slotErr } = await admin.from("practice_availability_slot")
    .select("id, location_id, starts_at, ends_at, slot_kind, status, generated_from_template_id")
    .eq("workspace_id", p.workspaceId).eq("status", "OPEN")
    .in("slot_kind", SLOT_KINDS_SEEING_PATIENTS)
    .gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at");
  if (slotErr || slotRows == null)
    return { ok: false, status: 503, code: "READ_FAILED", message: `this practice's times could not be read: ${slotErr?.message ?? "neither rows nor an error"}` };

  // ── WHICH SESSIONS OFFER THIS KIND OF APPOINTMENT (s4.3) ───────────────────────────────────────
  //
  // ⚠ ZERO LINKED TYPES MEANS NOT PATIENT-BOOKABLE, which is the same rule publishReadiness's
  // APPOINTMENT_TYPE_LINKED check applies. A session that offers nothing must not offer this.
  //
  // A slot with NO template is a one-off -- an extra session or extended hours -- and carries no type
  // link anywhere, so restricting it here would invent a rule nobody wrote. It is governed by the
  // booking page's own visible types, which the practice did choose, and which were checked above.
  const { data: typeLinks, error: linkErr } = await admin.from("practice_session_appointment_type")
    .select("template_id, appointment_type").eq("workspace_id", p.workspaceId);
  if (linkErr || typeLinks == null)
    return { ok: false, status: 503, code: "READ_FAILED", message: `the appointment types these sessions offer could not be read: ${linkErr?.message ?? "neither rows nor an error"}` };
  const offersType = new Set(((typeLinks ?? []) as any[])
    .filter(l => l.appointment_type === args.appointmentType).map(l => String(l.template_id)));

  // ── ⚠ WHICH SESSIONS ARE OPEN TO PATIENTS AT ALL (s4.3's booking_mode) ─────────────────────────
  //
  // ⚠ THIS FILTER WAS ABSENT AND THE COLUMN WAS DECIDING NOTHING HERE. Migration 240 has stored
  // booking_mode since Phase 1, and this function did not read it -- so a session a practitioner had
  // marked `internal` or `none` still generated OPEN slots, and those slots were offered to strangers on
  // a public page. A practitioner who had said "not patients" was being ignored by the one screen the
  // setting exists for.
  //
  // ⚠ AND IT IS THE CONVENIENCE, NOT THE CONTROL. checkPlacement refuses the same booking on the same
  // ground for the same channel, so a request that never came from this page is stopped whether or not
  // it was ever offered one. Removing this filter would make the page rude; removing that check would
  // make the rule fictional.
  //
  // ⚠ isPatientFacingMode IS THE SAME EXPRESSION patient-access.ts USES THREE TIMES -- the complement of
  // BOOKING_MODES_LIVE -- imported rather than restated as `["link_only","public"]`. A fourth spelling
  // of "patient-bookable" is a fourth thing to forget when a fifth mode is added.
  //
  // ⚠ A SLOT WITH NO TEMPLATE IS UNTOUCHED, exactly as it is by the type link above: a one-off extra
  // session or a stretch of extended hours has no session to carry a mode, and is governed by the
  // booking page's own visible types, which the practice did choose and which were checked above.
  const { data: modeRows, error: modeErr } = await admin.from("practice_availability_template")
    .select("id, booking_mode").eq("workspace_id", p.workspaceId).eq("status", "active");
  if (modeErr || modeRows == null)
    return { ok: false, status: 503, code: "READ_FAILED", message: `it could not be read which of this practice's sessions are open to patients: ${modeErr?.message ?? "neither rows nor an error"}` };
  const openToPatients = new Set(((modeRows ?? []) as any[])
    .filter(t => isPatientFacingMode(t.booking_mode as string | null)).map(t => String(t.id)));

  // ── WHAT IS ALREADY TAKEN. Four columns, and the reason is in the header. ───────────────────────
  const { data: apptRows, error: apptErr } = await admin.from("practice_appointment")
    .select("scheduled_at, duration_minutes")
    .eq("workspace_id", p.workspaceId).in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"])
    // Widened at the front by the cap on an appointment's length, so a long appointment starting before
    // the window but running into it is still seen. Migration 192 checks duration between 5 and 480.
    .gte("scheduled_at", new Date(fromMs - 480 * 60000).toISOString())
    .lt("scheduled_at", toIso);
  if (apptErr || apptRows == null)
    return { ok: false, status: 503, code: "READ_FAILED", message: `this practice's diary could not be read: ${apptErr?.message ?? "neither rows nor an error"}` };
  const taken = ((apptRows ?? []) as any[]).map(a => {
    const s = Date.parse(a.scheduled_at);
    return { s, e: s + ((a.duration_minutes as number | null) ?? 20) * 60000 };
  });

  const locName = new Map(p.locations.map(l => [l.id, l.name]));
  const now = Date.now();
  const out: BookableSlot[] = [];

  for (const slot of ((slotRows ?? []) as any[])) {
    const slotLocation = (slot.location_id as string | null) ?? null;
    // ⚠ A LOCATION THE PAGE DOES NOT EXPOSE IS NOT AN OFFER. resolveBookingPage already dropped
    // inactive and foreign ids from p.locations, so this test is against the exposed list and not
    // against the practice's whole estate.
    if (slotLocation && !locName.has(slotLocation)) continue;
    if (args.locationId && slotLocation !== args.locationId) continue;

    const templateId = (slot.generated_from_template_id as string | null) ?? null;
    if (templateId && !offersType.has(templateId)) continue;
    // s4.3's booking_mode. See the section above -- and note this drops the slot silently, like every
    // other test in this loop, because a patient is told what IS offerable and never why something is not.
    if (templateId && !openToPatients.has(templateId)) continue;

    const rule = await resolveBookingRule(admin, p.workspaceId, slotLocation, args.appointmentType);
    const earliest = now + rule.leadTimeMinutes * 60000;
    const latest = rule.bookingHorizonDays === null ? Infinity : now + rule.bookingHorizonDays * 86400000;

    // ⚠ THE WINDOW IS SUBDIVIDED, because a generated slot is a whole SESSION -- migration 230's
    // template carries a start minute and an end minute, so a 06:00-18:00 clinic is one row. Offering
    // that row as "a time" would ask a patient to book twelve hours. The step is the practice's own
    // configured appointment length, which is the length submitBookingRequest will book.
    const windowStart = Date.parse(slot.starts_at);
    const windowEnd = Date.parse(slot.ends_at);
    if (Number.isNaN(windowStart) || Number.isNaN(windowEnd)) continue;

    for (let s = windowStart; s + minutes * 60000 <= windowEnd; s += minutes * 60000) {
      const e = s + minutes * 60000;
      if (s < fromMs || s >= toMs) continue;
      if (s < earliest || s > latest) continue;
      if (taken.some(t => t.s < e && t.e > s)) continue;
      out.push({
        sourceSlotId: slot.id as string,
        startsAt: new Date(s).toISOString(),
        endsAt: new Date(e).toISOString(),
        minutes,
        locationId: slotLocation,
        locationName: slotLocation ? locName.get(slotLocation) ?? null : null,
      });
    }
  }

  out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return {
    ok: true,
    data: { appointmentType: args.appointmentType, minutes, timezone, fromIso, toIso, slots: out },
  };
}

// ── 6. MANAGE A BOOKING WITHOUT AN ACCOUNT ───────────────────────────────────────────────────────────
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPB-001 s13 "Manage Existing Booking Without a Portal", and the comp's panel 8.
//
// ---- ⚠ THE ONE RULE THIS WHOLE SECTION IS SHAPED AROUND ---------------------------------------------
//
// s11 of the comp: "OTP required for booking AND management." So A BOOKING REFERENCE IS AN IDENTIFIER
// AND NEVER A CREDENTIAL. It is printed on a confirmation, read down a telephone, forwarded, screenshotted
// and left on a desk. Anything a stranger holding one can change is a booking a stranger can change.
//
// The composition below makes that structural rather than a rule somebody remembers:
//
//   1. A code is issued TO THE ADDRESS THE CALLER TYPED, never to an address found on a booking. So a
//      stranger with somebody else's reference can only ever verify their OWN inbox.
//   2. The verified session proves control of exactly that address.
//   3. A booking is returned only when ITS OWN recorded contact is that same verified address.
//   4. The reference is applied LAST, as a filter over what was already proved to be the caller's own.
//
// Under that order the reference adds no authority at all: without step 3 it opens nothing, and with
// step 3 it merely narrows a list the caller was already entitled to see. That is also why it does not
// matter that referenceFrom() is derived and unconstrained -- see BOOKING_REFERENCE_NOTE.
//
// ---- ⚠ WHAT THIS SECTION DOES NOT DO ----------------------------------------------------------------
//
//   IT WRITES NO SECOND SCHEDULING PATH. Rescheduling is rescheduleAppointment() and cancelling is
//   transitionAppointment(), both in scheduling.ts, unchanged. That file carries the s14 override, the
//   three overlap_acknowledged writes and the walk-in block; a patient path that re-implemented any of
//   it would be the second copy that drifts. What is here is the AUTHORISATION and the RULES around
//   those two calls, which is the part that genuinely differs for a patient.
//
//   ⚠ IT NEVER PASSES allowOverlap. Not on the reschedule, not anywhere. rescheduleAppointment writes
//   `overlap_acknowledged: args.allowOverlap === true`, so omitting it writes false, so migration 255's
//   exclusion constraint still refuses a double-book with 23P01. A patient has no authority to
//   double-book and there is no argument on any function below that could grant it one.
//
//   IT NEVER CONFIRMS OR DENIES THAT A BOOKING EXISTS TO SOMEBODY WHO CANNOT PROVE THE CONTACT. An
//   unknown reference, a reference belonging to another patient and a reference that is simply wrong all
//   answer the same empty list.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ WHAT THE REFERENCE IS, WHAT IT IS NOT, AND WHAT IT WOULD TAKE TO MAKE IT MORE.
 *
 * Exported so the screen, the harness and this comment cannot drift apart.
 */
export const BOOKING_REFERENCE_NOTE =
  "Your reference identifies this booking when you talk to the practice. It is not a password: on its "
  + "own it cannot open, move or cancel anything. Changing a booking always needs a code sent to the "
  + "phone or inbox the booking was made with.";

/** A reference somebody can read down a telephone. Derived from the request, so nothing stores it. */
export const bookingReference = referenceFrom;

const REFERENCE_RE = /^CP-[A-Z0-9]{6}$/;

/** How many bookings are read before matching. Bounds the query; reported when it bites. */
const MANAGE_SCAN_LIMIT = 1000;

/**
 * ⚠ THE SCAN LOOKS BACKWARDS, AND THE FILTER LOOKS FORWARDS, AND THE TWO ARE NOT THE SAME QUESTION.
 *
 * The REQUEST records the time the patient originally asked for; the APPOINTMENT records where it is now.
 * A booking rescheduled from last week to next week has a requested_start in the past and a live future
 * appointment -- so scanning on `requested_start >= now` would lose exactly the bookings somebody has
 * already had to move once. The scan window is therefore backwards-looking and bounded, and "is this
 * still ahead of me" is decided on the appointment.
 */
const MANAGE_LOOKBACK_DAYS = 180;

export type ManagedBooking = {
  reference: string;
  requestId: string;
  appointmentId: string;
  /** The appointment's own status. REQUESTED, CONFIRMED, ARRIVED, CANCELLED, COMPLETED or NO_SHOW. */
  status: string;
  scheduledAt: string;
  durationMinutes: number;
  appointmentType: string;
  locationName: string | null;
  /** What the practice chose to tell patients. Never an internal note. */
  instructions: string | null;
  /** ⚠ DERIVED FROM THE STATE MACHINE AND THE PRACTICE'S OWN RULE, never assumed. */
  canReschedule: boolean;
  canCancel: boolean;
  /** Why not, in the patient's words, when either is false. */
  whyNot: string | null;
};

export type ManagedBookingList = {
  bookings: ManagedBooking[];
  /**
   * ⚠ TRUE WHEN THE SCAN HIT ITS LIMIT, so a short list is never silently presented as a whole one.
   * A patient told "you have no bookings" because a read was capped is a patient who does not turn up.
   */
  listIncomplete: boolean;
  referenceNote: string;
};

/**
 * Issue a code so somebody can manage a booking they already have.
 *
 * ⚠ IT IS DELIBERATELY INDISTINGUISHABLE FROM requestBookingCode, AND THAT IS THE POINT. The answer does
 * not depend on whether any booking exists at this address, because nothing in this path reads the
 * booking table at all. s12: "Do not disclose whether an email already belongs to an existing patient."
 *
 * ⚠ THE PURPOSE IS 'booking', NOT A NEW ONE. messaging.ts's TEMPLATES is the list of things this product
 * may send and the union on issueOtp is closed; inventing a fourth purpose here would be a template that
 * does not exist, refused at send time as UNKNOWN_PURPOSE. Managing a booking is a booking matter and the
 * existing template says the right thing.
 */
export async function requestManageCode(admin: any, args: {
  handle: string; channel: "sms" | "email"; destination: string;
  sourceKey?: string | null; correlationId: string; transport?: Transport;
}): Promise<EngineResult<{ challengeId: string; expiresAt: string; sourceLimited: boolean }>> {
  return requestBookingCode(admin, args);
}

/** The session check every function in this section starts with, and the page it is scoped to. */
async function manageContext(admin: any, handle: string, token: string): Promise<
  | { ok: true; page: PublicBookingPage; sessionId: string; destination: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const page = await resolveBookingPage(admin, handle);
  if (page.state !== "ok") return { ok: false, status: 503, code: "READ_FAILED", message: page.reason };
  if (!page.value) return { ok: false, status: 404, code: "NOT_FOUND", message: "There is no booking page at that address." };

  // ⚠ NO `destination` ARGUMENT. The caller has not claimed a contact -- the session IS the claim, and
  // its verified destination is what the booking is then matched against. Passing a caller-supplied
  // address here would let somebody name the address they wanted the match run against.
  const proof = await checkPatientSession(admin, { token, workspaceId: page.value.workspaceId });
  if (!proof.ok)
    return {
      ok: false,
      status: proof.code === "PATIENT_SESSION_UNREADABLE" ? 503 : 403,
      code: proof.code,
      message: proof.code === "PATIENT_SESSION_UNREADABLE"
        ? "your booking could not be opened because your session could not be checked"
        : "that link or code is no longer valid. Ask for a new code and try again.",
    };

  return {
    ok: true, page: page.value,
    sessionId: proof.proof.sessionId, destination: proof.proof.destination,
  };
}

/**
 * s13's "View booking": the bookings belonging to the contact this session verified.
 *
 * ⚠ THE MATCH IS ON THE VERIFIED DESTINATION AND NOTHING ELSE. A reference narrows the result; it never
 * widens it, and a reference for somebody else's booking narrows it to nothing rather than to theirs.
 *
 * ⚠ THE CONTACT COMPARISON HAPPENS HERE RATHER THAN IN THE QUERY, and that is not laziness. The stored
 * contact is whatever the patient typed -- "+256 772 555 401" -- and the verified destination is whatever
 * they typed the second time. normaliseDestination is what makes those one address, and PostgREST cannot
 * apply it. So the scan is bounded, ordered and its truncation is REPORTED rather than hidden.
 */
export async function managedBookings(admin: any, args: {
  handle: string; token: string; reference?: string | null;
}): Promise<EngineResult<ManagedBookingList>> {
  const c = await manageContext(admin, args.handle, args.token);
  if (!c.ok) return c;

  const wanted = (args.reference ?? "").trim().toUpperCase();
  if (wanted && !REFERENCE_RE.test(wanted))
    // A malformed reference is a fact about the characters typed, so saying so discloses nothing.
    return { ok: false, status: 400, code: "REFERENCE_INVALID", message: "a booking reference looks like CP-A1B2C3" };

  // s13 is about a booking somebody still has. See MANAGE_LOOKBACK_DAYS for why the scan looks back
  // while the answer looks forward.
  const { data: rows, error } = await admin.from("practice_booking_request")
    .select("id, appointment_id, contact_phone, contact_email, appointment_type, location_id, requested_start")
    .eq("workspace_id", c.page.workspaceId).eq("status", "booked")
    .gte("requested_start", new Date(Date.now() - MANAGE_LOOKBACK_DAYS * 86400000).toISOString())
    .order("requested_start").limit(MANAGE_SCAN_LIMIT);
  if (error || rows == null)
    return { ok: false, status: 503, code: "READ_FAILED", message: `your bookings could not be read: ${error?.message ?? "neither rows nor an error"}` };

  const scanned = (rows ?? []) as any[];
  const verified = normaliseDestination(c.destination);
  const mine = scanned.filter(r => {
    const phone = r.contact_phone ? normaliseDestination(String(r.contact_phone)) : null;
    const email = r.contact_email ? normaliseDestination(String(r.contact_email)) : null;
    return phone === verified || email === verified;
  }).filter(r => !wanted || referenceFrom(String(r.id)) === wanted);

  if (mine.length === 0)
    return {
      ok: true,
      data: { bookings: [], listIncomplete: scanned.length >= MANAGE_SCAN_LIMIT, referenceNote: BOOKING_REFERENCE_NOTE },
    };

  const apptIds = mine.map(r => String(r.appointment_id)).filter(Boolean);
  const { data: appts, error: apptErr } = await admin.from("practice_appointment")
    .select("id, status, scheduled_at, duration_minutes, location_id, appointment_type")
    .eq("workspace_id", c.page.workspaceId).in("id", apptIds);
  if (apptErr || appts == null)
    return { ok: false, status: 503, code: "READ_FAILED", message: `your appointment could not be read: ${apptErr?.message ?? "neither rows nor an error"}` };
  const byId = new Map(((appts ?? []) as any[]).map(a => [String(a.id), a]));

  const locName = new Map(c.page.locations.map(l => [l.id, l.name]));
  const now = Date.now();
  const bookings: ManagedBooking[] = [];

  for (const r of mine) {
    const a = byId.get(String(r.appointment_id));
    if (!a) continue;
    const status = String(a.status);
    const scheduledAt = String(a.scheduled_at);
    // ⚠ DECIDED ON THE APPOINTMENT, NOT ON THE REQUEST. See MANAGE_LOOKBACK_DAYS.
    if (Date.parse(scheduledAt) < now) continue;
    const locationId = (a.location_id as string | null) ?? null;
    const type = String(a.appointment_type ?? r.appointment_type);

    const rule = await resolveBookingRule(admin, c.page.workspaceId, locationId, type);
    const gate = manageGate({
      status, scheduledAtMs: Date.parse(scheduledAt), now,
      notice: rule.cancellationNoticeMinutes,
      rescheduleNotice: rule.rescheduleNoticeMinutes,
      selfCancelAllowed: rule.selfCancelAllowed,
      selfRescheduleAllowed: rule.selfRescheduleAllowed,
      ruleUnreadable: rule.readFailed,
    });

    bookings.push({
      reference: referenceFrom(String(r.id)),
      requestId: String(r.id),
      appointmentId: String(a.id),
      status, scheduledAt,
      durationMinutes: (a.duration_minutes as number | null) ?? 20,
      appointmentType: type,
      locationName: locationId ? locName.get(locationId) ?? null : null,
      instructions: c.page.instructions,
      canReschedule: gate.canReschedule, canCancel: gate.canCancel, whyNot: gate.whyNot,
    });
  }

  return {
    ok: true,
    data: {
      bookings,
      listIncomplete: scanned.length >= MANAGE_SCAN_LIMIT,
      referenceNote: BOOKING_REFERENCE_NOTE,
    },
  };
}

/**
 * ⚠ THE TWO GATES, DERIVED IN ONE PLACE so a screen's "Cancel" button and the engine's refusal cannot
 * disagree. Both are read off things that are actually stored.
 *
 *   THE STATE MACHINE. APPOINTMENT_TRANSITIONS is scheduling.ts's own map, imported rather than copied.
 *   CANCELLED cannot become CANCELLED; COMPLETED cannot become anything.
 *
 *   THE CANCELLATION NOTICE. migration 230's cancellation_notice_minutes, resolved through the same
 *   ladder every other rule uses. s11's cancellation window, and it is a real column.
 *
 * ⚠ AND ARRIVED IS REFUSED FOR BOTH, on top of the map. The map permits ARRIVED -> CANCELLED because a
 * practitioner at a desk may send somebody away; a patient standing in the waiting room self-cancelling
 * is not that, and rescheduleAppointment refuses it independently with PATIENT_PRESENT.
 *
 * ⚠ THERE IS NO SEPARATE RESCHEDULE WINDOW, AND THAT IS REPORTED RATHER THAN INVENTED. s11 lists one
 * beside the cancellation window; no column holds it. Reusing cancellation_notice_minutes for both would
 * enforce a rule the practice never wrote. What DOES constrain a reschedule is the lead time on the new
 * time, which bookableSlots applies from the same rule row.
 */
function manageGate(args: {
  status: string; scheduledAtMs: number; now: number; notice: number;
  /** ⚠ MIGRATION 268. Null means the cancellation notice governs a move too, which is what happened
   *  before the column existed and is what this function reported doing. */
  rescheduleNotice?: number | null;
  selfCancelAllowed?: boolean;
  selfRescheduleAllowed?: boolean;
  /** ⚠ The rule could not be READ. Not the same as a practice with no rule -- see below. */
  ruleUnreadable?: boolean;
}): {
  canReschedule: boolean; canCancel: boolean; whyNot: string | null;
} {
  // ⚠ AN UNREADABLE RULE SHUTS BOTH BUTTONS RATHER THAN OPENING THEM. resolveBookingRule used to
  // discard its error and hand back the platform default, which has a notice period of nought -- so a
  // failed read used to mean a patient could cancel anything at any time. That is the fail-open
  // direction, and it is now closed here as well as inside checkPlacement.
  if (args.ruleUnreadable)
    return {
      canReschedule: false, canCancel: false,
      whyNot: "this practice's booking rules could not be read just now, so nothing can be changed here. Try again shortly, or contact the practice.",
    };

  const cancellable = (APPOINTMENT_TRANSITIONS[args.status] ?? []).includes("CANCELLED");
  if (!cancellable)
    return {
      canReschedule: false, canCancel: false,
      whyNot: `this appointment is ${args.status.toLowerCase().replace(/_/g, " ")}, so it can no longer be changed here. Contact the practice.`,
    };
  if (args.status === "ARRIVED")
    return {
      canReschedule: false, canCancel: false,
      whyNot: "you have already been checked in for this appointment. Speak to the practice.",
    };
  if (Number.isNaN(args.scheduledAtMs))
    return { canReschedule: false, canCancel: false, whyNot: "this appointment has no readable time, so nothing can be changed here." };

  // ⚠ TWO DEADLINES NOW, AND THEY MAY DIFFER. This function's own header used to record that no column
  // held a separate reschedule window and that reusing the cancellation notice for both "would enforce a
  // rule the practice never wrote". Migration 268 gives the column, so the two are separated -- and when
  // it is null the cancellation notice governs a move, which is the behaviour that was already reported
  // and is now a stored choice rather than an absence.
  const rescheduleNotice = args.rescheduleNotice ?? args.notice;
  const period = (m: number) => m < 120 ? `${m} minutes` : `${Math.round(m / 60)} hours`;

  const pastCancel = args.now > args.scheduledAtMs - args.notice * 60000;
  const pastReschedule = args.now > args.scheduledAtMs - rescheduleNotice * 60000;
  // ⚠ MIGRATION 268. Absent columns default to true, so a practice that has configured nothing is
  // exactly as it was.
  const mayCancel = args.selfCancelAllowed !== false && !pastCancel;
  const mayReschedule = args.selfRescheduleAllowed !== false && !pastReschedule;

  if (mayCancel || mayReschedule) {
    // ⚠ A REASON IS GIVEN FOR THE HALF THAT IS SHUT, not only when both are. A patient offered "move"
    // and not "cancel" with no sentence beside it is a patient who telephones to ask why.
    const shut: string[] = [];
    if (!mayCancel)
      shut.push(args.selfCancelAllowed === false
        ? "this practice does not take cancellations online"
        : `this practice asks for ${period(args.notice)}' notice to cancel, and that has passed`);
    if (!mayReschedule)
      shut.push(args.selfRescheduleAllowed === false
        ? "this practice does not take changes of time online"
        : `this practice asks for ${period(rescheduleNotice)}' notice to move an appointment, and that has passed`);
    return {
      canReschedule: mayReschedule, canCancel: mayCancel,
      whyNot: shut.length === 0 ? null : `${shut.join(", and ")}. Contact the practice directly.`,
    };
  }

  if (args.selfCancelAllowed === false && args.selfRescheduleAllowed === false)
    return {
      canReschedule: false, canCancel: false,
      whyNot: "this practice arranges changes itself rather than online. Contact them directly.",
    };
  const worst = Math.max(args.notice, rescheduleNotice);
  return {
    canReschedule: false, canCancel: false,
    whyNot: worst > 0
      ? `this practice asks for ${period(worst)}' notice, and that has passed. Contact the practice directly.`
      : "this appointment time has passed. Contact the practice directly.",
  };
}

/** The one booking a manage action names, proved to belong to the verified contact. */
async function mineOrRefuse(admin: any, args: { handle: string; token: string; reference: string }): Promise<
  | { ok: true; booking: ManagedBooking; workspaceId: string; sessionId: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const c = await manageContext(admin, args.handle, args.token);
  if (!c.ok) return c;

  const list = await managedBookings(admin, { handle: args.handle, token: args.token, reference: args.reference });
  if (!list.ok) return list;
  const booking = list.data.bookings[0];
  // ⚠ ONE ANSWER FOR "NO SUCH BOOKING", "NOT YOURS" AND "ALREADY GONE". Distinguishing them would turn a
  // reference into an oracle for whether a booking exists at this practice.
  if (!booking)
    return { ok: false, status: 404, code: "BOOKING_NOT_FOUND", message: "no booking of yours matches that reference" };
  return { ok: true, booking, workspaceId: c.page.workspaceId, sessionId: c.sessionId };
}

/**
 * s13's "Reschedule": offer only valid replacement slots and re-run the rules before commit.
 *
 * ⚠ THE NEW TIME MUST BE ONE bookableSlots WOULD HAVE OFFERED. That is what re-running the rules means
 * here: the lead time, the booking horizon, the session's own appointment types, the practice's blocked
 * time and the diary are all applied to the REPLACEMENT, not merely to the original. Checking the
 * replacement against nothing would let a patient move a booking into leave, into a blocked afternoon or
 * to ten minutes' notice at a practice that asks for two days.
 *
 * ⚠ AND THEN THE WRITE GOES THROUGH rescheduleAppointment, WITH NO allowOverlap. Every guard that engine
 * carries -- the terminal states, ARRIVED, the past-day check, checkPlacement, the record version -- runs
 * unchanged, and migration 255 has the last word on the slot.
 *
 * ⚠ s4.3's booking_mode IS HONOURED ON THIS PATH THROUGH THE bookableSlots CALL BELOW, WHICH IS A
 * SERVER-SIDE RE-RUN AND NOT A UI FILTER -- the caller names a time and this recomputes whether it would
 * ever have been offered. rescheduleAppointment carries no channel, so checkPlacement's own
 * patient_self check is not reached here; that is stated rather than implied, because the two halves are
 * not the same guard and a reader is entitled to know which one is standing on this path.
 */
export async function rescheduleManagedBooking(admin: any, args: {
  handle: string; token: string; reference: string;
  scheduledAt: string; correlationId: string;
}): Promise<EngineResult<{
  reference: string; appointmentId: string; from: string; to: string; confirmationSent: boolean; confirmationNote: string;
}>> {
  const found = await mineOrRefuse(admin, { handle: args.handle, token: args.token, reference: args.reference });
  if (!found.ok) return found;
  const { booking, workspaceId, sessionId } = found;

  if (!booking.canReschedule)
    return { ok: false, status: 422, code: "RESCHEDULE_NOT_ALLOWED", message: booking.whyNot ?? "this booking cannot be moved here" };

  const wantedMs = Date.parse(args.scheduledAt);
  if (Number.isNaN(wantedMs))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "that is not a time we can read" };

  // The replacement, checked against the same computation a fresh booking would be offered. A narrow
  // window around the requested time is enough: this asks "would you offer me THIS", not "what else".
  const offered = await bookableSlots(admin, {
    handle: args.handle, appointmentType: booking.appointmentType,
    fromIso: new Date(wantedMs).toISOString(),
    toIso: new Date(wantedMs + 60000).toISOString(),
  });
  if (!offered.ok) return offered;
  const match = offered.data.slots.find(s => Date.parse(s.startsAt) === wantedMs);
  if (!match)
    return {
      ok: false, status: 409, code: "SLOT_NOT_OFFERED",
      message: "that time is not one this practice can offer. Choose another from the times shown.",
    };

  const moved = await rescheduleAppointment(admin, {
    workspaceId, appointmentId: booking.appointmentId,
    scheduledAt: match.startsAt, durationMinutes: match.minutes,
    locationId: match.locationId,
    // ⚠ allowOverlap IS NOT PASSED. See this section's header. rescheduleAppointment writes
    // `overlap_acknowledged: args.allowOverlap === true`, so this move is written as false and
    // migration 255's exclusion constraint refuses an occupied time with 23P01.
    actorId: sessionId, correlationId: args.correlationId,
  });
  if (!moved.ok) {
    const gone = /23P01|no_overlap|exclusion constraint/i.test(moved.message) || moved.code === "DOUBLE_BOOKED";
    return gone
      ? { ok: false, status: 409, code: "SLOT_TAKEN", message: "That time has just been taken. Choose another." }
      : moved;
  }

  await audit(admin, {
    workspaceId, actorId: sessionId, eventType: "practice.booking_rescheduled_by_patient",
    payload: {
      appointmentId: booking.appointmentId, reference: booking.reference,
      from: moved.data.from.scheduledAt, to: moved.data.scheduledAt,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      reference: booking.reference, appointmentId: booking.appointmentId,
      from: moved.data.from.scheduledAt, to: moved.data.scheduledAt,
      // ⚠ READ, NOT ASSUMED, and false in this deployment. Nothing here sends anything.
      confirmationSent: false,
      confirmationNote:
        "Your appointment has been moved. Write down the new time -- no message has been sent to you, "
        + "because this practice has no way to send one yet, so nothing will arrive by text or email.",
    },
  };
}

/**
 * s13's "Cancel": apply the cancellation rules, free the capacity, leave an audit trail.
 *
 * ⚠ THE CAPACITY IS FREED BY THE STATUS AND NOTHING ELSE. migration 255's constraint is `where status in
 * ('REQUESTED','CONFIRMED','ARRIVED')`, so a CANCELLED row stops participating the instant it is written
 * and the time becomes bookable again with nothing to clean up.
 *
 * ⚠ THE REASON HAS NOWHERE TO GO, AND IT IS RETURNED RATHER THAN DROPPED SILENTLY. Neither
 * practice_appointment nor practice_booking_request holds a patient cancellation reason. It is written
 * into the audit payload, which is a record, and the caller is told plainly that it is not on the booking.
 * s13 says "record reason if configured" -- there is nothing to configure it into yet.
 */
export async function cancelManagedBooking(admin: any, args: {
  handle: string; token: string; reference: string; reason?: string | null; correlationId: string;
}): Promise<EngineResult<{
  reference: string; appointmentId: string; status: string;
  reasonStoredOnBooking: boolean; confirmationSent: boolean; confirmationNote: string;
}>> {
  const found = await mineOrRefuse(admin, { handle: args.handle, token: args.token, reference: args.reference });
  if (!found.ok) return found;
  const { booking, workspaceId, sessionId } = found;

  if (!booking.canCancel)
    return { ok: false, status: 422, code: "CANCEL_NOT_ALLOWED", message: booking.whyNot ?? "this booking cannot be cancelled here" };

  const cancelled = await transitionAppointment(admin, {
    workspaceId, appointmentId: booking.appointmentId, to: "CANCELLED",
    actorId: sessionId, correlationId: args.correlationId,
  });
  if (!cancelled.ok) return cancelled;

  const reason = (args.reason ?? "").trim().slice(0, 500) || null;

  // ⚠ THE REASON HAS SOMEWHERE TO GO NOW, AND THIS FUNCTION USED TO SAY IT DID NOT. Migration 269 gives
  // practice_appointment the four columns, so the patient path writes them through the SAME helper the
  // practice path uses -- a second write of the same four columns is how two cancellation records start
  // disagreeing about who cancelled. `reasonStoredOnBooking` below is now read from the attempt rather
  // than hard-coded false, so the day the migration lands the sentence changes on its own.
  const rule = await resolveBookingRule(admin, workspaceId, null, booking.appointmentType);
  const scheduledMs = Date.parse(booking.scheduledAt);
  const record = await recordCancellation(admin, workspaceId, booking.appointmentId, {
    reason,
    actorKind: "patient",
    withinNotice: rule.readFailed || Number.isNaN(scheduledMs)
      ? null : Date.now() > scheduledMs - rule.cancellationNoticeMinutes * 60000,
  });

  await audit(admin, {
    workspaceId, actorId: sessionId, eventType: "practice.booking_cancelled_by_patient",
    payload: {
      appointmentId: booking.appointmentId, reference: booking.reference,
      scheduledAt: booking.scheduledAt, reason,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      reference: booking.reference, appointmentId: booking.appointmentId, status: cancelled.data.status,
      // ⚠ READ FROM THE WRITE, NOT ASSUMED. See above.
      reasonStoredOnBooking: record.stored,
      confirmationSent: false,
      confirmationNote:
        "This appointment has been cancelled. No message has been sent to you or to the practice, "
        + "because this practice has no way to send one yet.",
    },
  };
}

// ── 7. WHAT THE PUBLIC PAGE MAY SAY ABOUT BOOKING ────────────────────────────────────────────────────
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPB-001 s5's "Booking disabled -- profile may remain visible while the booking CTA is disabled", and
// the comp's panel 3, whose two buttons are "Book an Appointment" and "Manage Existing Booking".
//
// ⚠ THE ANSWER IS READ, NOT WRITTEN INTO THE PAGE. /@handle used to render a hard-coded paragraph saying
// booking could not be built. That paragraph was true when it was typed and had quietly stopped being
// true; a page that types its own limitations into prose keeps saying them after they stop applying, and
// nothing fails when they do. Every field below is derived from a store, so the day a mail provider is
// configured the buttons appear on their own and nobody has to remember this file.
//
// ⚠ EVERY FIELD IS A STRING, A BOOLEAN, NULL, OR AN ARRAY OF THOSE. NOTHING IS A FUNCTION. This crosses
// the server/client boundary, where a method type-checks, passes eslint, passes every harness and kills
// the page at runtime. The harness walks this object and asserts it.
//
// ⚠ AND IT ADDS NOTHING THE PRACTITIONER DID NOT PUBLISH. There is no rating, no review count, no years
// of experience and no photograph on this payload, because no column holds any of them. See the gap
// notes: a fabricated figure beside a named clinician's name is the worst kind this product could print.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ A FACT ABOUT THE BUILD, WRITTEN DOWN ONCE, WHERE A HARNESS CAN HOLD IT.
 *
 * The booking and management ENGINES exist and are proven end to end. What does not exist is a screen a
 * patient can use: there is no wizard at Location -> Service -> Time -> Details -> Verify, and no
 * public HTTP route that reaches any of the functions in this file. So no button on any public page may
 * offer booking yet, however well configured a practice is.
 *
 * This is deliberately a constant rather than a condition each page re-derives. When the screens are
 * built this becomes `true` in one place, every page that asks changes together, and the harness
 * assertion that pairs it with the payload is what stops the two drifting apart.
 */
export const PATIENT_BOOKING_SCREENS_BUILT = false;

export const PATIENT_BOOKING_SCREENS_NOTE =
  "Online booking is not open to patients yet. The booking is made by the practice; contact them the way "
  + "you normally would.";

export type PublicBookingEntry = {
  /** ⚠ THREE STATES. `closed` is "this practice takes no online booking"; `unreadable` is "nobody knows". */
  state: "open" | "closed" | "unreadable";
  /** Populated for `unreadable` only. A failed read says so instead of drawing as "not taking bookings". */
  reason: string | null;
  handle: string;
  /**
   * ⚠ TRUE ONLY IF A PATIENT COULD ACTUALLY FINISH ONE TODAY -- which takes three separate things: this
   * practice published a page, a code could reach the patient, and a screen exists to do it on. A button
   * that dead-ends at any of the three is worse than no button.
   */
  canBook: boolean;
  canManage: boolean;
  /** One sentence, true today, whenever either of the two above is false. */
  whyNot: string | null;
  /**
   * Which of the three is missing, as codes, so a screen never re-derives the arithmetic and a harness
   * can name what it is testing. Empty when a booking could be completed.
   */
  blockers: ("PAGE_NOT_PUBLISHED" | "NOTHING_OFFERED" | "NO_WAY_TO_SEND_A_CODE" | "NO_PATIENT_SCREEN" | "COULD_NOT_CHECK")[];
  /** What the PAGE calls this practice, where the practice chose a name for it. */
  displayName: string | null;
  instructions: string | null;
  privacyNotice: string | null;
  locations: { id: string; name: string }[];
  appointmentTypes: string[];
  referenceNote: string;
};

/**
 * Whether this handle's practice is taking online bookings, and whether one could actually be completed.
 *
 * ⚠ A HANDLE THAT RESOLVES TO A PRACTITIONER BUT NOT TO A PUBLISHED BOOKING PAGE IS `closed`, NOT AN
 * ERROR. The two are separate objects on purpose -- migration 254 keeps the booking page apart from the
 * identity -- and a practitioner may publish a profile without ever opening a diary to strangers.
 */
export async function publicBookingEntry(admin: any, handle: string): Promise<PublicBookingEntry> {
  const clean = (handle ?? "").trim().toLowerCase().replace(/^@/, "");
  const base = {
    reason: null as string | null, handle: clean,
    canBook: false, canManage: false, whyNot: null as string | null,
    blockers: [] as PublicBookingEntry["blockers"],
    displayName: null as string | null, instructions: null as string | null,
    privacyNotice: null as string | null,
    locations: [] as { id: string; name: string }[], appointmentTypes: [] as string[],
    referenceNote: BOOKING_REFERENCE_NOTE,
  };

  const page = await resolveBookingPage(admin, clean);
  if (page.state !== "ok")
    return {
      ...base, state: "unreadable", reason: page.reason, blockers: ["COULD_NOT_CHECK"],
      whyNot: "Whether this practice is taking online bookings could not be checked just now.",
    };
  if (!page.value)
    return {
      ...base, state: "closed", blockers: ["PAGE_NOT_PUBLISHED"],
      whyNot: "This practice does not take online bookings. Contact them the way you normally would.",
    };
  const p = page.value;

  // ⚠ IMPORTED WHERE IT IS USED so the public page does not pull the whole publish-readiness module into
  // its graph for one boolean. publishReadiness takes the same measure for the same kind of reason.
  const { deliveryReadiness } = await import("@/lib/practice/patient-access");
  const delivery = await deliveryReadiness(admin, p.workspaceId);

  const shared = {
    ...base, state: "open" as const,
    displayName: p.displayName, instructions: p.instructions, privacyNotice: p.privacyNotice,
    locations: p.locations, appointmentTypes: p.appointmentTypes,
  };

  if (delivery.state !== "ok")
    return {
      ...shared, state: "unreadable", reason: delivery.reason, blockers: ["COULD_NOT_CHECK"],
      whyNot: "Whether this practice can send you a confirmation code could not be checked just now.",
    };

  const blockers: PublicBookingEntry["blockers"] = [];

  // ⚠ THE CODE IS NOT OPTIONAL ON A PUBLISHED PAGE. migration 254's practice_booking_access_publishable
  // refuses to publish with otp_required false, so a resolvable page always requires one -- which means a
  // deployment that cannot SEND one cannot take a booking, and saying otherwise would send a patient to
  // wait for a message that is never coming.
  if (!delivery.value.deliverable) blockers.push("NO_WAY_TO_SEND_A_CODE");
  // A page offering no location or no kind of appointment has taken no booking through this route, so
  // there is nothing to manage either.
  if (p.appointmentTypes.length === 0 || p.locations.length === 0) blockers.push("NOTHING_OFFERED");
  if (!PATIENT_BOOKING_SCREENS_BUILT) blockers.push("NO_PATIENT_SCREEN");

  // ⚠ THE FIRST BLOCKER IS THE SENTENCE, and the order is the order a person can act on them: a practice
  // can choose what it offers this afternoon, an operator can configure a provider, and nobody using this
  // product can build the missing screens.
  const SENTENCE: Record<string, string> = {
    NOTHING_OFFERED: "This practice has not yet chosen what it offers online. Contact them directly.",
    NO_WAY_TO_SEND_A_CODE: "Online booking is not open here yet: this practice has no way to send you the confirmation code that booking requires. Contact them directly.",
    NO_PATIENT_SCREEN: PATIENT_BOOKING_SCREENS_NOTE,
  };
  const ordered = (["NOTHING_OFFERED", "NO_WAY_TO_SEND_A_CODE", "NO_PATIENT_SCREEN"] as const)
    .filter(c => blockers.includes(c));

  return {
    ...shared, blockers: ordered as PublicBookingEntry["blockers"],
    canBook: ordered.length === 0, canManage: ordered.length === 0,
    whyNot: ordered.length === 0 ? null : SENTENCE[ordered[0]],
  };
}

export { normaliseDestination };
