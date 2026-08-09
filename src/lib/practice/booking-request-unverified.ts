//   -- ============================================================
//   -- MIGRATION 272: THE UNVERIFIED BOOKING REQUEST, THE PRACTICE'S QUEUE FOR IT, AND THE MARK IT CARRIES
//   -- CPR-V5-007 s8.1, s9, s12
//   --
//   -- WARNING: THIS MIGRATION CHANGES THIS PRODUCT'S SECURITY POSTURE, AND IT IS THE OWNER'S DECISION.
//   --
//   -- issueOtp refuses outright in a deployment with no SMS gateway and no mail provider, so no patient can
//   -- verify and therefore no patient can book. The owner was told plainly what the alternative costs -- an
//   -- unverified stranger can ask for a slot -- and chose to make verification CONFIGURABLE per practice.
//   -- Everything below exists to bound that choice rather than to make it invisible.
//   --
//   -- THE FIVE PROPERTIES THIS FILE PUTS IN THE DATABASE RATHER THAN IN AN ENGINE
//   --
//   --   1. THE DOOR IS SHUT UNTIL SOMEBODY OPENS IT. unverified_requests_allowed defaults FALSE. A migration
//   --      whose default opens a door is a door nobody chose to open, and every practice on this platform
//   --      would have been opted in by a deployment nobody attended.
//   --   2. THE MARK CANNOT BE FORGED, BECAUSE NOTHING MAY WRITE IT. verification_state is GENERATED ALWAYS,
//   --      derived from the two columns that record the proof itself. There is no insert, no update and no
//   --      backfill that can set it, so a request cannot claim a verification it does not carry.
//   --   3. AN UNVERIFIED REQUEST IS NEVER A BOOKING. It may not reach status verified or booked, may not
//   --      name an appointment, and may not name a slot. The constraint is what makes that true whatever any
//   --      future call path believes.
//   --   4. AN UNVERIFIED REQUEST HOLDS NOTHING. slot_id is refused on those rows, so nothing computing free
//   --      time can find one. Two people may ask for the same time and the practice decides.
//   --   5. A REQUEST NOBODY CAN RING IS NOT A REQUEST. A row with no challenge behind it must carry a phone
//   --      or an inbox, checked with btrim so that a string of spaces is not an answer.
//   --
//   -- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
//   -- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
//   -- the statements around it while still reporting success. That happened on migration 238.
//   -- ============================================================
//
//   -- ====================================================================================================
//   -- 1. THE CONFIGURATION, ON THE BOOKING PAGE, DEFAULTING TO REQUIRING VERIFICATION
//   -- ====================================================================================================
//   --
//   -- WARNING: THIS IS NOT otp_required AND IT MUST NOT BE CONFUSED WITH IT.
//   --
//   -- otp_required governs BOOKING, and practice_booking_access_publishable still refuses to publish a page
//   -- with it false. That constraint is untouched: a booking that becomes an appointment with no practitioner
//   -- approval step still needs a verified person behind it, and nothing here weakens that.
//   --
//   -- This column governs something the product did not have before -- an unverified REQUEST, which becomes
//   -- no appointment, holds no time and is a message to the practice. The two are separate columns because
//   -- they are separate decisions, and collapsing them would let a practice that wanted to accept messages
//   -- accidentally open its diary.
//   --
//   -- The two lifecycle columns exist so that opening the door is visible as an act somebody performed on a
//   -- date, not merely as a boolean that has always been whatever it is now.
//
//   alter table practice_booking_access
//     add column if not exists unverified_requests_allowed boolean not null default false;
//
//   alter table practice_booking_access
//     add column if not exists unverified_requests_allowed_at timestamptz;
//
//   alter table practice_booking_access
//     add column if not exists unverified_requests_allowed_by uuid;
//
//   -- ====================================================================================================
//   -- 2. THE MARK, GENERATED SO THAT NOTHING CAN WRITE IT
//   -- ====================================================================================================
//   --
//   -- WARNING: A FLAG SOMEBODY SETS IS A FLAG SOMEBODY FORGETS TO SET.
//   --
//   -- The obvious shape is a plain column defaulting to 'unverified', backfilled once. It works until the
//   -- second write path, which sets it wrongly or not at all -- and the failure is silent, because a row that
//   -- says 'verified' looks exactly like one that is.
//   --
//   -- So it is DERIVED from the proof rather than asserted beside it. migration 254 already refuses a booked
//   -- request that cannot name the challenge that verified it and the moment it was verified. Those two
//   -- columns ARE the verification, so the mark is computed from them and there is no statement anywhere that
//   -- can make a row say something its own columns do not support.
//   --
//   -- It is STORED rather than VIRTUAL so it can be selected, indexed and grouped like any other column, and
//   -- so a practice-facing list pays nothing to show it.
//
//   alter table practice_booking_request
//     add column if not exists verification_state text
//     generated always as (
//       case when challenge_id is not null and verified_at is not null
//         then 'verified'::text else 'unverified'::text end
//     ) stored;
//
//   -- ====================================================================================================
//   -- 3. WHAT THE PRACTICE DOES WITH ONE
//   -- ====================================================================================================
//   --
//   -- A queue with nothing to take a row out of it is a queue that grows for ever, and the screen reading it
//   -- becomes useless in a fortnight. These four columns are the smallest honest way to close a request:
//   -- somebody, at a time, with an outcome from a closed list, and optionally a sentence.
//   --
//   -- WARNING: HANDLING ONE IS NOT BOOKING ONE. There is no appointment_id here and there is no verb that
//   -- writes one. A practice that decides to see this person books them the ordinary way, in the diary, where
//   -- every rule and the exclusion constraint apply -- because that is a booking, and this was a message.
//
//   alter table practice_booking_request
//     add column if not exists handled_at timestamptz;
//
//   alter table practice_booking_request
//     add column if not exists handled_by uuid;
//
//   alter table practice_booking_request
//     add column if not exists handled_outcome text;
//
//   alter table practice_booking_request
//     add column if not exists handled_note text;
//
//   -- ====================================================================================================
//   -- 4. THE CONSTRAINTS
//   -- ====================================================================================================
//   --
//   -- WARNING: EVERY ONE IS WRITTEN OVER THE BASE COLUMNS, NOT OVER verification_state. A check constraint
//   -- referencing a generated column is a restriction that differs between server versions, and the
//   -- derivation is deterministic, so the two spellings mean the same thing and only one of them is portable.
//
//   -- AN UNVERIFIED REQUEST IS A REQUEST. It may not claim the code was entered, may not become a booking,
//   -- may not name an appointment and may not name a slot.
//   --
//   -- Every row written before this migration carries both a challenge and a verification time -- the only
//   -- insert that has ever existed sets them together -- so every one of them satisfies the first disjunct
//   -- and this constraint validates against live data without touching it.
//   alter table practice_booking_request drop constraint if exists practice_booking_request_unverified_holds_nothing;
//   alter table practice_booking_request add constraint practice_booking_request_unverified_holds_nothing
//     check ((challenge_id is not null and verified_at is not null)
//         or (status not in ('verified', 'booked')
//             and appointment_id is null and slot_id is null));
//
//   -- A REQUEST NOBODY CAN ANSWER IS NOT A REQUEST. btrim, because a column that is merely not null is
//   -- satisfied by a space.
//   alter table practice_booking_request drop constraint if exists practice_booking_request_unverified_is_contactable;
//   alter table practice_booking_request add constraint practice_booking_request_unverified_is_contactable
//     check (challenge_id is not null
//         or btrim(coalesce(contact_phone, '')) <> ''
//         or btrim(coalesce(contact_email, '')) <> '');
//
//   -- HANDLED MEANS ALL THREE OR NONE. A time with no outcome is a row somebody touched and nobody can read
//   -- afterwards, and an outcome with no actor is a decision nobody owns.
//   alter table practice_booking_request drop constraint if exists practice_booking_request_handled_is_complete;
//   alter table practice_booking_request add constraint practice_booking_request_handled_is_complete
//     check ((handled_at is null and handled_by is null and handled_outcome is null)
//         or (handled_at is not null and handled_by is not null
//             and handled_outcome in ('contacted', 'unreachable', 'declined', 'duplicate')));
//
//   alter table practice_booking_request drop constraint if exists practice_booking_request_handled_note_shape;
//   alter table practice_booking_request add constraint practice_booking_request_handled_note_shape
//     check (handled_note is null
//         or (btrim(handled_note) <> '' and char_length(handled_note) <= 500));
//
//   -- ====================================================================================================
//   -- 5. THE INDEXES THE RATE LIMIT AND THE QUEUE READ
//   -- ====================================================================================================
//   --
//   -- WARNING: THE FIRST ONE IS HALF OF A CONTROL AND IS USELESS WITHOUT THE OTHER HALF. messaging.ts records
//   -- the lesson in its own words: a limit that reads a column nothing writes counts nought for ever. The
//   -- engine below WRITES source_hash on every unverified request and REFUSES when it cannot, so this index
//   -- serves a count that is actually counting something.
//   create index if not exists idx_practice_booking_request_source_recent
//     on practice_booking_request(source_hash, created_at desc) where source_hash is not null;
//
//   create index if not exists idx_practice_booking_request_unhandled
//     on practice_booking_request(workspace_id, created_at desc) where handled_at is null;
//
//   alter table practice_booking_access enable row level security;
//   alter table practice_booking_request enable row level security;
//
//   notify pgrst, 'reload schema';

import { evaluateBooking } from "@/lib/practice/booking-rules";
// ⚠ THE REFUSAL SENTENCE IS THE ONE THE BOOKING PATH USES, IMPORTED RATHER THAN RESTATED. A second
// wording of "you left these blank" is a second thing to keep true when the catalogue changes.
import { intakeField, intakeRefusalMessage } from "@/lib/practice/booking-rule-constants";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";
import { audit } from "@/lib/practice/audit";
import {
  resolveBookingPage, bookingReference, hashBookingSource,
  type EngineResult, type BookingIntake,
} from "@/lib/practice/patient-booking";
import {
  VERIFICATION_MARKS, verificationMarkOf, HANDLED_OUTCOMES, HANDLED_OUTCOME_CODES,
  UNVERIFIED_REQUEST_NOTE,
  type VerificationState, type QueuedRequest,
} from "@/lib/practice/booking-request-constants";
import type { WorkspaceContext } from "@/lib/practice/access";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE UNVERIFIED REQUEST -- WHAT IT IS, AND THE FOUR THINGS IT REFUSES TO BE.
//
//   1. ⚠ IT IS NOT A BOOKING. Nothing here calls bookUnderRules, nothing here writes an appointment, and
//      the database refuses one on this row anyway. A request is a message asking for a time.
//   2. ⚠ IT HOLDS NO SLOT, AND THAT IS THE DECISION WITH THE LARGEST BLAST RADIUS ON THIS PATH.
//
//      bookableSlots computes free time from practice_appointment and from nothing else. An unverified
//      request writes no appointment row and no slot id, so it is STRUCTURALLY incapable of removing a
//      time from what the next patient is offered. Two people may ask for nine o'clock and the practice
//      decides between them.
//
//      The alternative -- a hold with an expiry -- was rejected on two grounds and both are concrete.
//      First, this endpoint is unauthenticated: a stranger with a script would empty a clinic's week in
//      seconds, and every one of those holds would look to the practice exactly like a patient. Second,
//      an expiry needs something to run, and messaging.ts already records that this deployment has no
//      scheduled runner and no durable outbox -- so a hold would be written and never released, which is
//      a permanent block dressed as a temporary one.
//
//      The cost is real and is smaller: a practice may receive two requests for one time. That is a
//      telephone call, not a lost afternoon.
//   3. ⚠ IT IS NOT ALLOWED UNLESS THE PRACTICE SAID SO, AND THE SERVER IS WHAT DECIDES THAT. The config
//      is read here, before anything is written, and an unreadable config REFUSES. resolveBookingRule
//      had exactly this shape until yesterday and its discarded error produced a permissive default, so
//      a database wobble opened the diary. There is no branch below where a failed read means yes.
//   4. ⚠ IT IS NOT SUBJECT TO THE BOOKING RULES, AND THAT IS STATED RATHER THAN LEFT TO BE NOTICED.
//
//      The capacity limit, the notice period, the booking horizon and the per-channel door all govern
//      what may be BOOKED. Nothing here books, so applying them would mean a patient could not even ask
//      -- a notice period is not a rule about who may leave a message. What DOES still apply is the
//      practice's lifecycle (an archived or closed practice takes nothing, inherited from
//      evaluateBooking's own refusal) and the practice's REQUIRED INFORMATION, because a request missing
//      the family name is exactly as useless as a booking missing it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// ⚠ THE MARKS, THE OUTCOMES, THE PATIENT'S SENTENCE AND THE QUEUE ROW LIVE IN booking-request-constants.ts
// AND ARE RE-EXPORTED HERE. That file imports nothing, so a "use client" screen can reach a label without
// dragging evaluateBooking, audit and node:crypto into the browser bundle -- the failure that killed the
// Follow-ups board and passed tsc, eslint and every harness on the way through. There is still exactly one
// definition of each; this is the same split registration-condition.ts made, for the same reason.
export {
  VERIFICATION_MARKS, verificationMarkOf, HANDLED_OUTCOMES, HANDLED_OUTCOME_CODES,
  UNVERIFIED_REQUEST_NOTE,
};
export type { VerificationState, QueuedRequest };

// ── THE RATE LIMIT ───────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS AN UNAUTHENTICATED ENDPOINT THAT WRITES ROWS, AND BOTH LIMITS FAIL CLOSED.
//
// A count that could not be read is not a count of nought. issueOtp's own header records what happened
// the last time this codebase read one as one: `(count ?? 0)` with the error discarded turned an
// unreadable table -- and PostgREST answering with a null count, which it does -- into "nothing has been
// sent this hour", which permitted an unlimited number. Both branches below refuse.
//
// ⚠ AND THERE IS NO PER-CONTACT LIMIT, WHICH IS AN ABSENCE RATHER THAN AN OVERSIGHT. The phone number on
// an unverified request is a string somebody typed and nobody checked, so limiting on it is a limit the
// caller removes by typing a different number. Naming it here beats shipping a control that measures
// nothing and reports itself as running.

/** Per source per hour, across every practice: one caller walking a list of practices is the abuse a per-practice limit cannot see. */
export const UNVERIFIED_PER_SOURCE_PER_HOUR = 5;

/**
 * Per practice per hour, whatever the source. The backstop against rotated addresses.
 *
 * ⚠ THE TRADE THIS MAKES, STATED. An attacker who can rotate sources can spend this quota and a real
 * patient is then refused for the rest of the hour. That is the lesser harm: the refusal tells them to
 * contact the practice directly, which is what they would have done anyway, whereas an unbounded write
 * endpoint is a practice's queue filled with thousands of rows it can never work through.
 */
export const UNVERIFIED_PER_PRACTICE_PER_HOUR = 40;

/**
 * ⚠ THE SAME FUNCTION THE VERIFIED BOOKING PATH USES, IMPORTED RATHER THAN RESTATED.
 *
 * Two salts would be two registers, each blind to the other, and one caller would hold both allowances.
 */
const hashSource = hashBookingSource;

// ── 1. WHAT THE PRACTICE CHOSE ───────────────────────────────────────────────────────────────────────

export type UnverifiedRequestPolicy = {
  allowed: boolean;
  /** When it was turned on, where it was. Null when it never has been. */
  allowedAt: string | null;
  /**
   * ⚠ TRUE WHEN MIGRATION 272 HAS NOT BEEN APPLIED, so an absent column is never drawn as a choice.
   *
   * This is a THIRD state and it belongs with `allowed: false`, not with `unreadable`. A column that does
   * not exist is a definite fact -- the feature is not deployed here -- and the shut position is the
   * honest reading of it. `unreadable` is reserved for a store that would not answer, which must refuse
   * rather than resolve either way.
   */
  configurable: boolean;
};

/** PostgREST's answer when the column is not there yet. Matched on the code and on the sentence, because both have been seen. */
const isUndefinedColumn = (e: { code?: string | null; message?: string | null } | null) =>
  !!e && (String(e.code) === "42703" || /column .* does not exist/i.test(String(e.message ?? "")));

/**
 * ⚠ THREE ANSWERS, AND THE THIRD ONE REFUSES.
 *
 * `ok` with allowed:false is "this practice requires a code". `unreadable` is "nobody knows" -- and the
 * caller must not turn that into a yes. A permissive default on a failed read is the exact shape that put
 * resolveBookingRule's platform default in front of a wobbling database.
 */
export async function unverifiedRequestPolicy(admin: any, workspaceId: string): Promise<
  { state: "ok"; value: UnverifiedRequestPolicy } | { state: "unreadable"; reason: string }
> {
  const { data, error } = await admin.from("practice_booking_access")
    .select("unverified_requests_allowed, unverified_requests_allowed_at")
    .eq("workspace_id", workspaceId).maybeSingle();
  // ⚠ NOT DEPLOYED IS NOT UNREADABLE, AND IT IS NOT A YES. See `configurable`.
  if (isUndefinedColumn(error))
    return { state: "ok", value: { allowed: false, allowedAt: null, configurable: false } };
  if (error)
    return { state: "unreadable", reason: `whether this practice accepts a request without a code could not be read: ${error.message}` };
  // ⚠ NO ROW IS NOT A YES EITHER. A practice with no booking page has chosen nothing, and choosing
  // nothing is the shut position.
  if (!data) return { state: "ok", value: { allowed: false, allowedAt: null, configurable: true } };
  return {
    state: "ok",
    value: {
      allowed: data.unverified_requests_allowed === true,
      allowedAt: (data.unverified_requests_allowed_at as string | null) ?? null,
      configurable: true,
    },
  };
}

// ── 2. THE REQUEST ───────────────────────────────────────────────────────────────────────────────────

export type UnverifiedRequestReceipt = {
  /** The one thing a patient can quote back. The same derivation a booked request uses. */
  reference: string;
  requestId: string;
  /** ⚠ ALWAYS 'unverified', READ BACK FROM THE ROW RATHER THAN ASSUMED BY THIS FUNCTION. */
  verificationState: VerificationState;
  requestedStart: string;
  requestedMinutes: number;
  appointmentType: string;
  locationName: string | null;
  /** ⚠ FALSE, AND A FIELD RATHER THAN A SENTENCE IN THE COPY. Nothing here reserves anything. */
  holdsSlot: false;
  /** ⚠ FALSE. Nothing in this deployment sends anything, and the confirmation must not claim it did. */
  confirmationSent: false;
  /** What this is, and what it is not, in the words a patient reads. */
  note: string;
  /** Answers thrown away because this practice does not ask for them. Null when none were. */
  answersNotKept: string | null;
};

export type UnverifiedRequestArgs = {
  handle: string;
  intake: BookingIntake;
  requestedStart: string;
  appointmentType: string;
  locationId?: string | null;
  /**
   * ⚠ REQUIRED, AND A MISSING ONE REFUSES. issueOtp's own reasoning: an approximated auth control is
   * worse than a named absent one, so a request that cannot be rate-limited by source is not accepted.
   */
  sourceKey: string;
  correlationId: string;
};

/**
 * Record a booking request from somebody who has not proved who they are.
 *
 * The order below is the safety, and it is the order of the six guards:
 *
 *   the page resolves            an unpublished practice answers exactly as a handle never issued
 *   the practice said yes        read from the store, and an unreadable store refuses
 *   the source is limited        counted, and an uncountable limit refuses
 *   the practice is limited      the same
 *   the offer is real            a type or a location the page never showed is somebody editing a request
 *   the answers are resolved     the practice's own required information, from the one resolver
 *   THEN the row is written      with no appointment, no slot, and a mark it cannot escape
 */
export async function submitUnverifiedRequest(
  admin: any, args: UnverifiedRequestArgs,
): Promise<EngineResult<UnverifiedRequestReceipt>> {
  const page = await resolveBookingPage(admin, args.handle);
  if (page.state !== "ok") return { ok: false, status: 503, code: "READ_FAILED", message: page.reason };
  if (!page.value)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "There is no booking page at that address." };
  const p = page.value;

  // ══ THE PRACTICE'S OWN CHOICE, ON THE SERVER, BEFORE ANYTHING IS WRITTEN ═══════════════════════
  //
  // ⚠ THIS IS THE ONLY GATE ON THIS PATH AND IT IS NOT A SCREEN. A wizard that simply does not draw the
  // button is a wizard, not a control -- api-context.ts states the house rule: API enforcement must not
  // rely on the sidebar having hidden a button.
  const policy = await unverifiedRequestPolicy(admin, p.workspaceId);
  if (policy.state !== "ok")
    return { ok: false, status: 503, code: "READ_FAILED", message: `nothing was recorded because ${policy.reason}` };
  if (!policy.value.allowed)
    return {
      ok: false, status: 403, code: "UNVERIFIED_NOT_ACCEPTED",
      // ⚠ THE SAME SENTENCE WHETHER THE PRACTICE TURNED IT OFF OR NEVER TURNED IT ON. Both are "this
      // practice requires a code", and distinguishing them tells a stranger about a setting.
      message: "this practice needs a code sent to your phone or inbox before it can take a booking, and it cannot take a request without one",
    };

  // ══ THE RATE LIMITS. BOTH FAIL CLOSED. ════════════════════════════════════════════════════════
  const sourceKey = (args.sourceKey ?? "").trim();
  if (!sourceKey)
    return {
      ok: false, status: 503, code: "SOURCE_LIMIT_UNAVAILABLE",
      message: "no request was recorded because this one could not be rate-limited by source. An unrecorded source is an unlimited one.",
    };
  const sourceHash = hashSource(sourceKey);
  const since = new Date(Date.now() - 3600_000).toISOString();

  const { count: fromSource, error: srcErr } = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true })
    .eq("source_hash", sourceHash).gte("created_at", since);
  // ⚠ A FAILED COUNT IS NOT A COUNT OF NOUGHT, AND A NULL COUNT IS NOT A ZERO EITHER.
  if (srcErr || fromSource === null || fromSource === undefined)
    return {
      ok: false, status: 503, code: "RATE_LIMIT_UNREADABLE",
      message: `no request was recorded because the requests already made from here could not be counted: ${srcErr?.message ?? "the count came back empty rather than as a number"}`,
    };
  if (fromSource >= UNVERIFIED_PER_SOURCE_PER_HOUR)
    return {
      ok: false, status: 429, code: "TOO_MANY_REQUESTS",
      message: "too many requests have been made from here in the last hour. Try again later, or contact the practice directly.",
    };

  const { count: atPractice, error: wsErr } = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", p.workspaceId).is("challenge_id", null).gte("created_at", since);
  if (wsErr || atPractice === null || atPractice === undefined)
    return {
      ok: false, status: 503, code: "RATE_LIMIT_UNREADABLE",
      message: `no request was recorded because the requests already made to this practice could not be counted: ${wsErr?.message ?? "the count came back empty rather than as a number"}`,
    };
  if (atPractice >= UNVERIFIED_PER_PRACTICE_PER_HOUR)
    return {
      ok: false, status: 429, code: "TOO_MANY_REQUESTS",
      message: "this practice has taken as many requests as it can this hour. Contact them directly.",
    };

  // ══ WHAT THE PAGE OFFERS IS WHAT THE PAGE ACCEPTS ═════════════════════════════════════════════
  if (!p.appointmentTypes.includes(args.appointmentType))
    return { ok: false, status: 422, code: "TYPE_NOT_OFFERED", message: "that kind of appointment is not offered here" };
  if (args.locationId && !p.locations.some(l => l.id === args.locationId))
    return { ok: false, status: 422, code: "LOCATION_NOT_OFFERED", message: "that location is not offered here" };

  const startMs = Date.parse(args.requestedStart);
  if (Number.isNaN(startMs))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "that is not a time we can read" };
  if (startMs < Date.now())
    return { ok: false, status: 422, code: "TIME_IN_THE_PAST", message: "that time has already passed. Choose another." };

  // ⚠ A REQUEST NOBODY CAN ANSWER IS NOT A REQUEST, AND THE DATABASE AGREES. Checked here so the patient
  // gets a sentence rather than a constraint violation, and there so the sentence cannot be skipped.
  const phone = args.intake.contactPhone?.trim() || "";
  const email = args.intake.contactEmail?.trim() || "";
  if (!phone && !email)
    return {
      ok: false, status: 422, code: "CONTACT_REQUIRED",
      message: "give a phone number or an email address. Nothing has been verified, so the practice has no other way to reach you.",
    };

  if (p.consentRequired && !args.intake.consentDataCapture)
    return {
      ok: false, status: 422, code: "CONSENT_REQUIRED",
      message: "this practice needs your agreement to keep the details you have entered",
    };

  // ══ THE PRACTICE'S REQUIRED INFORMATION, FROM THE ONE RESOLVER ════════════════════════════════
  //
  // ⚠ evaluateBooking IS USED FOR THE INTAKE AND NOT FOR THE VERDICT, AND THE DIFFERENCE IS DELIBERATE.
  // It is the only place a rule's required_information is resolved, so calling it is what stops a second
  // resolver existing. Its `refusals` are ignored on purpose -- see property 4 in this file's header --
  // but an `ok: false` is NOT ignored, because that is an outage, a rule conflict, or a practice that has
  // been archived or closed, and none of those may quietly become a stored request.
  const patientCtx: WorkspaceContext = {
    userId: "unverified-request",
    workspaceId: p.workspaceId,
    workspaceName: "", workspaceType: "", workspaceStatus: "active",
    roleCodes: [],
    // ⚠ EMPTY, AND IT MUST STAY EMPTY. A patient holds no capability, and somebody who has proved nothing
    // at all holds even less.
    capabilities: [],
    entitled: true, entitlementStatus: null, onboardingComplete: true, onboardingStep: null,
  };

  const answers: Record<string, unknown> = {
    given_name: args.intake.givenName?.trim() ?? "",
    family_name: args.intake.familyName?.trim() ?? "",
    birth_date: args.intake.birthDate ?? null,
    age_years: args.intake.ageYears ?? null,
    sex: args.intake.sex && args.intake.sex !== "unspecified" ? args.intake.sex : null,
    contact_phone: phone || null,
    contact_email: email || null,
    representative_name: args.intake.representativeName?.trim() ?? null,
    representative_relationship: args.intake.representativeRelationship ?? null,
    representative_phone: args.intake.representativePhone?.trim() ?? null,
    reason_for_visit: args.intake.reasonForVisit?.trim() ?? null,
    referral_source: args.intake.referralSource?.trim() ?? null,
    stated_diagnosis: args.intake.statedDiagnosis?.trim() ?? null,
    stated_treatment: args.intake.statedTreatment?.trim() ?? null,
    stated_hospital_number: args.intake.statedHospitalNumber?.trim() ?? null,
    consent_communication: args.intake.consentCommunication === true,
  };

  const evaluated = await evaluateBooking(admin, patientCtx, {
    channel: "patient_self", appointmentType: args.appointmentType,
    scheduledAt: args.requestedStart, locationId: args.locationId ?? null,
    intake: answers,
  });
  if (!evaluated.ok) return evaluated;

  const resolved = evaluated.data.intake;
  // ⚠ A REQUIRED ANSWER LEFT BLANK REFUSES A REQUEST TOO. The practice asked for it, and a request the
  // practice cannot act on is one it will only have to ring about twice.
  if (resolved && resolved.missing.length > 0) {
    const named = resolved.missing
      .map(m => intakeField(m.fieldKey))
      .filter((f): f is NonNullable<ReturnType<typeof intakeField>> => f !== null)
      .map(field => ({ field }));
    return {
      ok: false, status: 422, code: "REQUIRED_INFORMATION_MISSING",
      // ⚠ THE LIST IS REBUILT FROM THE CLOSED CATALOGUE, so a key the catalogue no longer knows drops out
      // of the sentence rather than appearing in it as a raw column name.
      message: named.length > 0
        ? intakeRefusalMessage(named)
        : "some answers this practice asks for on every booking of this kind were left blank.",
    };
  }
  const kept = resolved?.values ?? answers;
  const keptStr = (key: string) => {
    const v = kept[key];
    return v === undefined || v === null || v === "" ? null : String(v);
  };

  // ⚠ AND THE CONTACT SURVIVES THE RESOLUTION. A practice that switched both contact questions off would
  // otherwise store a request with nobody to ring -- which the database refuses, so a patient would get a
  // constraint violation instead of a sentence.
  if (!keptStr("contact_phone") && !keptStr("contact_email"))
    return {
      ok: false, status: 422, code: "CONTACT_NOT_KEPT",
      message: "this practice does not ask for a phone number or an email address, so it has no way to answer a request. Contact them directly.",
    };

  const minutes = await defaultAppointmentMinutes(admin, p.workspaceId);

  // ══ THE ROW ═══════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ NO challenge_id, NO verified_at, NO appointment_id, NO slot_id, AND status 'submitted'.
  //
  // The first two absences are what make the generated verification_state say 'unverified' -- the mark is
  // not written here, it is derived from what is missing, so there is no statement anywhere that could
  // make this row claim otherwise. The last three are what make it hold nothing.
  const { data: req, error: reqErr } = await admin.from("practice_booking_request").insert({
    workspace_id: p.workspaceId,
    access_id: null,
    location_id: args.locationId ?? null,
    appointment_type: args.appointmentType,
    channel: "patient_self",
    requested_start: args.requestedStart,
    requested_minutes: minutes,
    status: "submitted",
    // ⚠ WRITTEN, BECAUSE THE LIMIT ABOVE READS IT. A limit that reads a column nothing writes counts
    // nought for ever, and an insert that fails because the column is absent is REPORTED rather than
    // retried without it -- an unrecorded source is an unlimited one.
    source_hash: sourceHash,
    given_name: keptStr("given_name"),
    family_name: keptStr("family_name"),
    birth_date: keptStr("birth_date"),
    age_years: kept.age_years === null || kept.age_years === undefined || kept.age_years === ""
      ? null : Math.trunc(Number(kept.age_years)),
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
    consent_data_capture: !!args.intake.consentDataCapture,
    consent_communication: kept.consent_communication === true,
    consent_recorded_at: args.intake.consentDataCapture ? new Date().toISOString() : null,
  }).select("id, verification_state, requested_minutes").maybeSingle();
  if (reqErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: reqErr.message };
  // ⚠ AN INSERT THAT RETURNED NOTHING IS NOT A SUCCESS. This codebase has shipped two silent write
  // failures by treating one as one.
  if (!req)
    return { ok: false, status: 500, code: "NOT_WRITTEN", message: "your request was not recorded, and the database reported no error" };

  await audit(admin, {
    workspaceId: p.workspaceId, actorId: null,
    eventType: "practice.booking_request_unverified",
    payload: {
      requestId: req.id, appointmentType: args.appointmentType,
      requestedStart: args.requestedStart, locationId: args.locationId ?? null,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      reference: bookingReference(String(req.id)),
      requestId: String(req.id),
      // ⚠ READ BACK FROM THE ROW. This function could type 'unverified' here and be right today; reading
      // it means the day something else writes this row the payload stops agreeing by itself.
      verificationState: verificationMarkOf(req.verification_state),
      requestedStart: args.requestedStart,
      requestedMinutes: (req.requested_minutes as number | null) ?? minutes,
      appointmentType: args.appointmentType,
      locationName: p.locations.find(l => l.id === args.locationId)?.name ?? null,
      holdsSlot: false,
      confirmationSent: false,
      note: UNVERIFIED_REQUEST_NOTE,
      answersNotKept: resolved?.discardNotice ?? null,
    },
  };
}

// ── 3. WHICH QUESTIONS THE FORM DRAWS ────────────────────────────────────────────────────────────────
//
// ⚠ THE FORM ASKS THE SERVER WHAT TO ASK, AND THAT IS THE WHOLE OF "DO NOT BUILD A SECOND FORMS RUNTIME".
//
// The questions a booking may put are the closed catalogue BOOKING_INTAKE_FIELDS -- fifteen, each mapped
// to a real column -- and WHICH of them apply is a property of the practice's rule, resolved by
// resolveIntake and by nothing else. So the browser holds the catalogue (a constant, so it cannot drift)
// and this returns the keys and levels, which is the only part a store decides.
//
// ⚠ IT DISCLOSES THE QUESTIONS AND NOTHING ELSE. Not which rule matched, not its name, not the capacity,
// not a refusal. A stranger learns what the form was going to show them anyway.

export type IntakeQuestion = { fieldKey: string; label: string; level: string; condition?: unknown };

export async function intakeQuestionsFor(admin: any, args: {
  handle: string; appointmentType: string; scheduledAt: string; locationId?: string | null;
}): Promise<EngineResult<{ questions: IntakeQuestion[]; consentRequired: boolean; consentText: string | null }>> {
  const page = await resolveBookingPage(admin, args.handle);
  if (page.state !== "ok") return { ok: false, status: 503, code: "READ_FAILED", message: page.reason };
  if (!page.value)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "There is no booking page at that address." };
  const p = page.value;

  if (!p.appointmentTypes.includes(args.appointmentType))
    return { ok: false, status: 422, code: "TYPE_NOT_OFFERED", message: "that kind of appointment is not offered here" };
  if (args.locationId && !p.locations.some(l => l.id === args.locationId))
    return { ok: false, status: 422, code: "LOCATION_NOT_OFFERED", message: "that location is not offered here" };

  const ctx: WorkspaceContext = {
    userId: "booking-form", workspaceId: p.workspaceId,
    workspaceName: "", workspaceType: "", workspaceStatus: "active",
    roleCodes: [], capabilities: [],
    entitled: true, entitlementStatus: null, onboardingComplete: true, onboardingStep: null,
  };

  // ⚠ AN EMPTY INTAKE, DELIBERATELY. resolveIntake's conditions are evaluated over the answers, and
  // nobody has typed any yet -- so a conditional question shows, which is the safe direction: its own
  // header records that a condition on a fact nobody knows means the question IS asked.
  const evaluated = await evaluateBooking(admin, ctx, {
    channel: "patient_self", appointmentType: args.appointmentType,
    scheduledAt: args.scheduledAt, locationId: args.locationId ?? null, intake: {},
  });
  if (!evaluated.ok) return evaluated;

  return {
    ok: true,
    data: {
      // ⚠ THE CONDITION COMES WITH IT, so the form narrows itself with registration-condition.ts's own
      // evaluator rather than drawing a guardian question at a sixty-year-old.
      questions: (evaluated.data.intake?.asked ?? []).map(a => a.condition === undefined
        ? { fieldKey: a.fieldKey, label: a.label, level: a.level }
        : { fieldKey: a.fieldKey, label: a.label, level: a.level, condition: a.condition }),
      consentRequired: p.consentRequired,
      consentText: p.consentText,
    },
  };
}

// ── 4. WHAT THE PRACTICE SEES ────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS QUEUE IS NOT AN EXTRA. Without it the sentence a patient is given -- "the practice can see your
// request" -- would be false, and this table had no practice-facing reader at all before it: every read
// of practice_booking_request in this product was patient-facing. A store nothing looks at is a request
// nobody answers.

export type RequestQueue = {
  requests: QueuedRequest[];
  unhandledUnverified: number;
  /** ⚠ TRUE WHEN THE SCAN HIT ITS LIMIT, so a short list is never presented as a whole one. */
  listIncomplete: boolean;
};

const QUEUE_SCAN_LIMIT = 200;

/**
 * The requests a practice has taken, newest first.
 *
 * ⚠ A FAILED READ IS NOT AN EMPTY QUEUE. "You have no requests" and "your requests could not be read" are
 * different sentences and a practice told the first will stop looking.
 */
export async function requestQueue(admin: any, ctx: WorkspaceContext, args?: {
  includeHandled?: boolean;
}): Promise<EngineResult<RequestQueue>> {
  // ⚠ NO NEW CAPABILITY CODE. `appointment.manage` is already seeded and is the permission that governs
  // arranging who is seen and when, which is exactly what answering one of these is.
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  let q = admin.from("practice_booking_request")
    .select("id, verification_state, status, requested_start, requested_minutes, appointment_type, "
      + "location_id, given_name, family_name, contact_phone, contact_email, reason_for_visit, "
      + "stated_diagnosis, stated_treatment, created_at, handled_at, handled_outcome, handled_note")
    .eq("workspace_id", ctx.workspaceId);
  if (args?.includeHandled !== true) q = q.is("handled_at", null);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(QUEUE_SCAN_LIMIT);
  if (error || data == null)
    return {
      ok: false, status: 503, code: "READ_FAILED",
      message: `your booking requests could not be read: ${error?.message ?? "neither rows nor an error"}`,
    };

  const rows = (data ?? []) as any[];
  const requests: QueuedRequest[] = rows.map(r => {
    const state = verificationMarkOf(r.verification_state);
    const mark = VERIFICATION_MARKS[state];
    return {
      id: String(r.id),
      reference: bookingReference(String(r.id)),
      verificationState: state,
      verificationLabel: mark.label,
      verificationSentence: mark.sentence,
      status: String(r.status),
      requestedStart: String(r.requested_start),
      requestedMinutes: (r.requested_minutes as number | null) ?? 20,
      appointmentType: String(r.appointment_type),
      locationId: (r.location_id as string | null) ?? null,
      name: `${r.given_name ?? ""} ${r.family_name ?? ""}`.trim() || "No name given",
      contactPhone: (r.contact_phone as string | null) ?? null,
      contactEmail: (r.contact_email as string | null) ?? null,
      reasonForVisit: (r.reason_for_visit as string | null) ?? null,
      statedDiagnosis: (r.stated_diagnosis as string | null) ?? null,
      statedTreatment: (r.stated_treatment as string | null) ?? null,
      createdAt: String(r.created_at),
      handledAt: (r.handled_at as string | null) ?? null,
      handledOutcome: (r.handled_outcome as string | null) ?? null,
      handledNote: (r.handled_note as string | null) ?? null,
    };
  });

  return {
    ok: true,
    data: {
      requests,
      unhandledUnverified: requests.filter(r => r.verificationState === "unverified" && r.handledAt === null).length,
      listIncomplete: rows.length >= QUEUE_SCAN_LIMIT,
    },
  };
}

/**
 * Close a request. ⚠ THIS DOES NOT BOOK ANYTHING, AND THERE IS NO ARGUMENT THAT COULD MAKE IT.
 *
 * A practice that decides to see this person books them in the diary, where every rule, checkPlacement
 * and migration 255's exclusion constraint apply. Turning a message into an appointment from here would
 * be a second booking path -- the thing this whole area has been built to avoid.
 */
export async function handleRequest(admin: any, ctx: WorkspaceContext, args: {
  requestId: string; outcome: string; note?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; handledAt: string }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  if (!HANDLED_OUTCOME_CODES.includes(args.outcome))
    return {
      ok: false, status: 400, code: "UNKNOWN_OUTCOME",
      message: `an outcome must be one of: ${HANDLED_OUTCOME_CODES.join(", ")}`,
    };

  const note = (args.note ?? "").trim().slice(0, 500) || null;
  const handledAt = new Date().toISOString();

  // ⚠ SCOPED TO THE WORKSPACE ON THE UPDATE ITSELF, not merely looked up first. A request id belonging to
  // another practice must match nothing rather than be found and then rejected.
  const { data, error } = await admin.from("practice_booking_request")
    .update({ handled_at: handledAt, handled_by: args.actorId, handled_outcome: args.outcome, handled_note: note })
    .eq("id", args.requestId).eq("workspace_id", ctx.workspaceId).is("handled_at", null)
    .select("id");
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  // ⚠ AN UPDATE THAT MATCHED NOTHING IS NOT A SUCCESS.
  if (((data ?? []) as any[]).length !== 1)
    return {
      ok: false, status: 409, code: "NOT_WRITTEN",
      message: "that request was not closed -- it is not this practice's, or somebody has already closed it",
    };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: "practice.booking_request_handled",
    payload: { requestId: args.requestId, outcome: args.outcome },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { id: args.requestId, handledAt } };
}
