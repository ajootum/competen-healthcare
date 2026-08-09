import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import {
  registerPatient, composeDisplayName, screenRegistration, storedSex, generatePracticeId,
  type Candidate,
} from "@/lib/practice/patients";
import { addRelationship, ageFrom, relationshipExpectation, MAJORITY_AGE } from "@/lib/practice/relationships";
import { bookAppointment, checkPlacement } from "@/lib/practice/scheduling";
import { bookableTimes, type BookableSlot } from "@/lib/practice/patient-booking";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";
import { practiceToday, workspaceClock } from "@/lib/practice/practice-time";
import { resolveTemplate, validateSubmission } from "@/lib/practice/registration-config";
import { audit } from "@/lib/practice/audit";

// CPR-PRM-001 s5 -- "Register", "Register & Book", and the relationship workflow that goes with them.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE ACT, SEVERAL WRITES, AND THE ORDER IS THE DESIGN.
//
// A registration that creates a patient and then fails to attach the guardian has produced exactly the
// record s6 exists to prevent: a child with nobody responsible for them. There is no transaction across
// PostgREST calls, so the order is chosen so that the SURVIVING partial state is the safe one:
//
//   1. the patient      -- without this nothing else has anywhere to go
//   2. the guardians    -- before the booking, because a child with a guardian and no appointment is a
//                          record somebody can finish; an appointment for a child with no guardian is
//                          the gap that matters
//   3. the appointment  -- last, and its failure is REPORTED rather than swallowed
//
// Every step that did not happen comes back in `incomplete`, so the desk is told what still needs doing
// instead of discovering it a week later.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RelationshipInput = {
  relationshipType: string;
  fullName: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  isLegalGuardian?: boolean;
  mayReceiveInformation?: boolean;
  isPrimary?: boolean;
};

export type RegistrationInput = {
  givenName?: string;
  middleName?: string;
  familyName?: string;
  displayName?: string;
  sex?: string;
  birthDate?: string;
  ageEstimateYears?: number;
  phone?: string;
  email?: string;
  nationalId?: string;
  // s6: as many as the patient actually has. A child with two guardians has two.
  relationships?: RelationshipInput[];
  // Free text, and it belongs to the visit rather than to the person.
  reasonForVisit?: string;
  // s5's "Register & Book".
  appointmentAt?: string;
  appointmentType?: string;
  // Values for whatever custom fields the practice's template adds.
  custom?: Record<string, unknown>;
  confirmNew?: boolean;
  correlationId: string;
};

/**
 * What the form should show, and what it must collect.
 *
 * THE TEMPLATE DECIDES THE FIELDS; THE AGE DECIDES THE GUARDIAN. Those are different questions and the
 * second one cannot be configured away -- see registration-config's protected floor.
 */
export async function registrationForm(admin: any, ctx: WorkspaceContext, context: {
  specialty?: string | null; country?: string | null; practiceType?: string | null;
} = {}) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const resolved = await resolveTemplate(admin, ctx, context);
  return {
    today: practiceToday(timezone),
    timezone,
    template: resolved?.template ?? null,
    fields: resolved?.fields ?? [],
    // Said as a field so the form does not have to hardcode 18 in a second place.
    majorityAge: MAJORITY_AGE,
    guardianRequiredUnder: MAJORITY_AGE,
  };
}

/**
 * Age from a date of birth, in the practice's calendar.
 *
 * EXPOSED SO THE FORM AND THE SERVER AGREE. The form shows the age as somebody types the date; this is
 * the same function, so the number on screen and the number that decides the guardian rule cannot
 * differ.
 */
export async function ageForForm(admin: any, ctx: WorkspaceContext, birthDate: string) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);
  const age = ageFrom(birthDate, today);
  return { today, age, isMinor: age ? age.years < MAJORITY_AGE : null };
}

/**
 * ⚠ EVERY RULE THIS REGISTRATION HAS TO PASS BEFORE ANYTHING IS WRITTEN, IN ONE PLACE.
 *
 * There are two writers now -- register() with its four separate calls, and registerAndBook() with one
 * transaction -- and the whole point of the second is that a lost race leaves NO patient behind. That is
 * a difference in how the writing is done and it must never become a difference in what is ALLOWED. A
 * template rule, a guardian requirement or a contact requirement enforced on one path and not the other
 * would mean the button somebody presses decides which rules apply to a child's record.
 */
type PreparedRegistration = {
  displayName: string;
  contactPhone?: string;
  contactEmail?: string;
  guardianContact: RelationshipInput | undefined;
  /** True when the patient has no contact of their own and a guardian's satisfies the minimum dataset. */
  satisfiedByGuardian: boolean;
};

async function prepareRegistration(admin: any, ctx: WorkspaceContext, input: RegistrationInput): Promise<
  EngineResult<PreparedRegistration>
> {
  const displayName = (input.displayName?.trim() || composeDisplayName(input)).trim();
  if (!displayName)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is required" };

  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);
  const age = ageFrom(input.birthDate ?? null, today);

  // ── THE TEMPLATE'S OWN RULES, CHECKED BEFORE ANYTHING IS WRITTEN ─────────────────────────────────
  const resolved = await resolveTemplate(admin, ctx, {});
  if (resolved) {
    const values: Record<string, unknown> = {
      display_name: displayName, sex: input.sex, birth_date: input.birthDate,
      age_estimate_years: input.ageEstimateYears, phone: input.phone, email: input.email,
      ...(input.custom ?? {}),
    };
    const check = validateSubmission(resolved.fields, values);
    if (!check.ok)
      return {
        ok: false, status: 422, code: "TEMPLATE_INCOMPLETE",
        message: `${check.missing.map(m => m.label).join(", ")} ${check.missing.length === 1 ? "is" : "are"} required on this practice's form`,
      };
  }

  // ── THE GUARDIAN RULE, ALSO BEFORE ANYTHING IS WRITTEN ───────────────────────────────────────────
  //
  // s6 makes this the one thing a registration cannot be completed without for a child. Refused UP
  // FRONT rather than after the patient exists, because a half-made record of a child is worse than no
  // record: it looks finished.
  const proposed = (input.relationships ?? []).map(r => ({
    relationship_type: r.relationshipType,
    full_name: r.fullName,
    is_legal_guardian: r.isLegalGuardian === true,
    may_receive_information: r.mayReceiveInformation === true,
    is_primary: r.isPrimary === true,
  }));
  const expectation = relationshipExpectation(age, proposed, input.ageEstimateYears ?? null);
  if (expectation.required === "guardian" && !expectation.satisfied)
    return {
      ok: false, status: 422, code: "GUARDIAN_REQUIRED",
      message: `${expectation.reason} Add a parent, guardian or carer with legal authority before registering.`,
    };

  // ── A CHILD'S CONTACT IS THEIR GUARDIAN'S. ────────────────────────────────────────────────────────
  //
  // The minimum dataset requires a phone or an email, and a six-month-old has neither. Demanding one
  // anyway is how a registration form becomes unusable for exactly the patients whose records matter
  // most -- and what actually happens at the desk is that somebody types the mother's number into the
  // baby's phone field, which is true but records it in the wrong place and loses who it belongs to.
  //
  // So the guardian's contact SATISFIES the requirement and is recorded against the guardian, where it
  // belongs. The patient's own contact fields stay empty, because they are.
  const guardianContact = (input.relationships ?? [])
    .find(r => (r.isLegalGuardian || r.isPrimary) && (r.phone?.trim() || r.email?.trim()))
    ?? (input.relationships ?? []).find(r => r.phone?.trim() || r.email?.trim());

  const contactPhone = input.phone?.trim() || undefined;
  const contactEmail = input.email?.trim() || undefined;
  const satisfiedByGuardian = !contactPhone && !contactEmail && !!guardianContact;

  if (!contactPhone && !contactEmail && !guardianContact)
    return {
      ok: false, status: 400, code: "CONTACT_REQUIRED",
      message: expectation.required === "guardian"
        ? "record a contact for the guardian -- a child's contact is theirs"
        : "a phone number or an email address is required",
    };

  return { ok: true, data: { displayName, contactPhone, contactEmail, guardianContact, satisfiedByGuardian } };
}

/** s6's guardians and next of kin, attached to a patient that already exists. Shared by both writers. */
async function attachRelationships(
  admin: any, ctx: WorkspaceContext, patientId: string, input: RegistrationInput,
): Promise<{ attached: number; failures: { step: string; reason: string }[] }> {
  let attached = 0;
  const failures: { step: string; reason: string }[] = [];
  for (const r of input.relationships ?? []) {
    const added = await addRelationship(admin, ctx, {
      patientId, relationshipType: r.relationshipType, fullName: r.fullName,
      phone: r.phone, email: r.email, address: r.address,
      // THE SECOND NUMBER GOES IN THE NOTE, not into a column that does not exist. A guardian with two
      // phones is ordinary; inventing secondary_phone on the table for it would be a column that only
      // this form ever writes.
      note: r.secondaryPhone ? `Second contact: ${r.secondaryPhone}` : undefined,
      isLegalGuardian: r.isLegalGuardian, mayReceiveInformation: r.mayReceiveInformation,
      isPrimary: r.isPrimary,
      correlationId: input.correlationId,
    });
    if (added.ok) attached++;
    else failures.push({ step: "relationship", reason: `${r.fullName}: ${added.message}` });
  }
  return { attached, failures };
}

export async function register(admin: any, ctx: WorkspaceContext, input: RegistrationInput): Promise<
  EngineResult<{
    patientId: string; practiceId: string; displayName: string;
    relationships: number; appointmentId: string | null;
    incomplete: { step: string; reason: string }[];
  }>
> {
  const prepared = await prepareRegistration(admin, ctx, input);
  if (!prepared.ok) return prepared;
  const { displayName, contactPhone, contactEmail, guardianContact, satisfiedByGuardian } = prepared.data;

  // ── 1. The patient ────────────────────────────────────────────────────────────────────────────────
  const created = await registerPatient(admin, {
    workspaceId: ctx.workspaceId, displayName,
    givenName: input.givenName, middleName: input.middleName, familyName: input.familyName,
    sex: input.sex, birthDate: input.birthDate, ageEstimateYears: input.ageEstimateYears,
    // PASSED ONLY TO CLEAR THE MINIMUM-DATASET CHECK when the patient has none of their own. The
    // contact row it creates is removed immediately below, so the number lives on the guardian and
    // nowhere else -- a child's phone field must not quietly hold their mother's number.
    phone: contactPhone ?? (satisfiedByGuardian ? guardianContact!.phone?.trim() : undefined),
    email: contactEmail ?? (satisfiedByGuardian ? guardianContact!.email?.trim() : undefined),
    identifiers: input.nationalId ? [{ type: "national_id", value: input.nationalId }] : undefined,
    confirmNew: input.confirmNew,
    actorId: ctx.userId, correlationId: input.correlationId,
  });
  if (!created.ok) return created;

  // ⚠ SEEDED FROM THE ENGINE'S OWN LIST, NOT STARTED EMPTY. registerPatient now reports identifier and
  // contact writes that failed -- it used to discard those errors, so a hospital number rejected by the
  // unique index vanished with the desk being told the registration succeeded. Starting this array empty
  // would reintroduce exactly that: the engine would know and this layer would not pass it on.
  const incomplete: { step: string; reason: string }[] = [...created.data.incomplete];

  // THE BORROWED CONTACT IS REMOVED FROM THE PATIENT once the record exists. It was only ever there to
  // satisfy the minimum-dataset check, and leaving it would put a guardian's number in a child's own
  // contact list, where a later reader has no way to tell whose it is.
  if (satisfiedByGuardian) {
    await admin.from("practice_patient_contact")
      .delete().eq("patient_id", created.data.id).eq("workspace_id", ctx.workspaceId);
  }

  // ── 2. The relationships ──────────────────────────────────────────────────────────────────────────
  const related = await attachRelationships(admin, ctx, created.data.id, input);
  const attached = related.attached;
  incomplete.push(...related.failures);

  // ── 3. The appointment ────────────────────────────────────────────────────────────────────────────
  let appointmentId: string | null = null;
  if (input.appointmentAt) {
    const booked = await bookAppointment(admin, {
      workspaceId: ctx.workspaceId, patientId: created.data.id, patientName: displayName,
      scheduledAt: input.appointmentAt,
      appointmentType: input.appointmentType ?? "new_consultation",
      reason: input.reasonForVisit,
      actorId: ctx.userId, correlationId: input.correlationId,
    });
    if (booked.ok) appointmentId = booked.data.id;
    // REPORTED, NOT SWALLOWED. The patient exists either way, and a desk that thinks it booked an
    // appointment it did not book is the worst of the three outcomes.
    else incomplete.push({ step: "appointment", reason: booked.message });
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.patient_registered_full",
    payload: {
      patientId: created.data.id, relationships: attached,
      booked: !!appointmentId, incomplete: incomplete.map(i => i.step),
    },
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    data: {
      patientId: created.data.id, practiceId: created.data.practiceId, displayName,
      relationships: attached, appointmentId, incomplete,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTER AND BOOK, ATOMICALLY -- CP-SCHED-001 s9 and s10, over migration 276.
//
// ---- THE ONE THING THIS BUYS, SAID PLAINLY --------------------------------------------------------
//
// Between the moment a free time is drawn on the registration card and the moment the button is pressed,
// somebody else can take it. Migration 255's exclusion constraint detects that, in the database, whoever
// is racing. On the sequential path above, the patient has already been created by the time the booking
// is refused -- so a lost race leaves a half-finished person on the register and a desk with no account
// of what happened. Here the whole thing rolls back, nothing is written, and the screen can say the true
// thing: that time was taken while you were typing, and here are the next free ones.
//
// ---- WHAT DECIDES WHAT, AND WHERE -----------------------------------------------------------------
//
// ⚠ THE TRANSACTION DECIDES NOTHING. Migration 276's own header carries the rule -- if you find yourself
// adding an `if` to that function, it belongs here. Everything below runs BEFORE the single rpc call:
//
//   the capability          the API route, requirePracticeContext("patient.create")
//   the template's rules    prepareRegistration -> validateSubmission
//   the guardian rule       prepareRegistration -> relationshipExpectation
//   the contact rule        prepareRegistration, and a child's contact is their guardian's
//   the minimum dataset     screenRegistration, over registration-config's PROTECTED_FIELDS
//   identifier collision    screenRegistration, refused outright and naming the existing patient
//   similar person          screenRegistration, candidates returned until a human confirms
//   the placement           checkPlacement -- practice status, location, booking rules, travel
//   the time being real     bookableTimes on the staff channel, which is what OFFERED it
//
// ⚠ AND THE SEQUENTIAL PATH IS KEPT. register() above is unchanged and is what "Register only" and every
// caller that books nothing still use. Two writers, one set of rules -- see prepareRegistration.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type RegisterAndBookInput = RegistrationInput & {
  /** The exact instant the card offered. Not a time somebody typed. */
  scheduledAt: string;
  locationId?: string | null;
  durationMinutes?: number | null;
};

export type RegisterAndBookResult =
  | {
      ok: true;
      data: {
        patientId: string; practiceId: string; displayName: string;
        appointmentId: string; scheduledAt: string; locationId: string | null;
        relationships: number;
        /** Writes after the transaction that did not happen. The patient and the booking both exist. */
        incomplete: { step: string; reason: string }[];
      };
    }
  | {
      ok: false; status: number; code: string; message: string;
      candidates?: Candidate[];
      /**
       * ⚠ ONLY ON SLOT_TAKEN, AND READ AT THE MOMENT OF THE REFUSAL. s10: "return a conflict response and
       * IMMEDIATELY REFRESH nearby free times". A refusal that only says no sends somebody back to a list
       * that still shows the time they just lost.
       */
      alternatives?: BookableSlot[];
    };

/** How far past the lost slot the refusal looks for something else to offer. One day. */
const ALTERNATIVE_WINDOW_MS = 24 * 3600000;

/** How many replacements a refusal carries. A chip row, not a diary dump. */
const ALTERNATIVE_LIMIT = 8;

export async function registerAndBook(
  admin: any, ctx: WorkspaceContext, input: RegisterAndBookInput,
): Promise<RegisterAndBookResult> {
  const startMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(startMs))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a valid appointment time is required" };

  const appointmentType = input.appointmentType ?? "new_consultation";
  const locationId = input.locationId ?? null;

  // ── 1. EVERY RULE THE SEQUENTIAL PATH APPLIES, APPLIED BY THE SAME CODE ─────────────────────────
  const prepared = await prepareRegistration(admin, ctx, input);
  if (!prepared.ok) return prepared;
  const { displayName, contactPhone, contactEmail, guardianContact, satisfiedByGuardian } = prepared.data;

  const identifiers = input.nationalId
    ? [{ type: "national_id", value: input.nationalId.trim() }]
    : [];

  // ⚠ THE BORROWED CONTACT IS ONLY EVER A VALUE FOR THE CHECK, NEVER A ROW.
  //
  // register() has to write the guardian's number onto the patient to clear the minimum-dataset check
  // inside registerPatient, and then delete it again. Here the check is a function call and the write is
  // a list this code builds, so the borrowed number never becomes a contact row at all -- there is no
  // window in which a child's contact list holds their mother's number, not even a very short one.
  const borrowedPhone = satisfiedByGuardian ? guardianContact?.phone?.trim() : undefined;
  const borrowedEmail = satisfiedByGuardian ? guardianContact?.email?.trim() : undefined;

  const screened = await screenRegistration(admin, {
    workspaceId: ctx.workspaceId,
    displayName, givenName: input.givenName, middleName: input.middleName, familyName: input.familyName,
    birthDate: input.birthDate, ageEstimateYears: input.ageEstimateYears,
    phone: contactPhone ?? borrowedPhone, email: contactEmail ?? borrowedEmail,
    identifiers, confirmNew: input.confirmNew,
  });
  if (!screened.ok) return screened;

  // ── 2. MAY AN APPOINTMENT SIT HERE AT ALL ──────────────────────────────────────────────────────
  //
  // ⚠ THE SAME FUNCTION ALL FOUR BOOKING PATHS PASS THROUGH. Its own header says why: a second copy of
  // the practice-status, location, booking-rule and travel checks is a path that quietly permits what
  // typing is refused.
  const duration = input.durationMinutes ?? await defaultAppointmentMinutes(admin, ctx.workspaceId);
  const placed = await checkPlacement(admin, {
    workspaceId: ctx.workspaceId, startMs, endMs: startMs + duration * 60000,
    locationId, appointmentType, allowOverlap: false,
  });
  if (!placed.ok) return placed;

  // ── 3. WAS THIS TIME ACTUALLY OFFERED? ─────────────────────────────────────────────────────────
  //
  // ⚠ THE OFFER IS RE-ASKED RATHER THAN TRUSTED. The card sends back an instant it was given, and an
  // instant is the easiest thing in a request body to change. checkPlacement above does not know about
  // sessions, slot kinds or a session's booking mode -- bookableTimes does, and it is what drew the chip.
  const offered = await bookableTimes(admin, {
    channel: "staff", workspaceId: ctx.workspaceId, appointmentType, locationId,
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(startMs + 60000).toISOString(),
  });
  if (!offered.ok) return offered;
  if (!offered.data.slots.some(s => Date.parse(s.startsAt) === startMs))
    return {
      ok: false, status: 409, code: "TIME_NOT_OFFERED",
      message: "that time is not one this practice is offering for this kind of appointment at this location. Choose one of the times shown.",
    };

  // ── 4. A PRACTICE NUMBER NOBODY ELSE HOLDS ─────────────────────────────────────────────────────
  //
  // ⚠ GENERATED AND CHECKED HERE, NOT IN THE TRANSACTION. register() writes a candidate and retries when
  // the unique index refuses it, which is a decision -- and a decision in SQL is the thing migration 276
  // refuses to contain. Checking first also keeps the refusals apart: once the candidate is known free,
  // a unique-violation coming back from the rpc is a REAL duplicate identifier and not a collision on a
  // generated number, so the desk is told which of the two happened.
  let practiceId = "";
  for (let attempt = 0; attempt < 5 && !practiceId; attempt++) {
    const candidate = generatePracticeId();
    const { data: clash, error } = await admin.from("practice_patient_identifier")
      .select("id").eq("workspace_id", ctx.workspaceId).eq("identifier_type", "practice_id")
      .eq("value_normalised", candidate.toLowerCase().replace(/\s+/g, "")).is("valid_to", null)
      .maybeSingle();
    // A CHECK THAT COULD NOT RUN IS NOT A CHECK THAT PASSED -- patients.ts's own rule, applied here.
    if (error)
      return {
        ok: false, status: 503, code: "READ_FAILED",
        message: `a practice number could not be reserved, so nothing was saved: ${error.message}`,
      };
    if (!clash) practiceId = candidate;
  }
  if (!practiceId)
    return { ok: false, status: 502, code: "IDENTIFIER_GENERATION_FAILED", message: "could not generate a unique practice id" };

  // ── 5. ONE CALL. ONE TRANSACTION. ──────────────────────────────────────────────────────────────
  //
  // Walk-ins arrive by definition and enter CONFIRMED, exactly as bookAppointment decides it -- the same
  // expression, in TypeScript, because migration 276 decides nothing.
  const contacts: { contact_type: string; value: string; preferred: boolean }[] = [];
  if (contactPhone) contacts.push({ contact_type: "phone", value: contactPhone, preferred: true });
  if (contactEmail) contacts.push({ contact_type: "email", value: contactEmail, preferred: !contactPhone });

  const { data: written, error: rpcError } = await admin.rpc("practice_register_and_book", {
    p_workspace_id: ctx.workspaceId,
    p_display_name: displayName,
    p_given_name: input.givenName?.trim() || null,
    p_middle_name: input.middleName?.trim() || null,
    p_family_name: input.familyName?.trim() || null,
    p_sex: storedSex(input.sex),
    p_birth_date: input.birthDate ?? null,
    p_age_estimate_years: input.ageEstimateYears ?? null,
    p_created_by: ctx.userId,
    p_practice_id: practiceId,
    p_identifiers: identifiers.map(i => ({ identifier_type: i.type, value: i.value, issuer: null })),
    p_contacts: contacts,
    p_location_id: locationId,
    p_patient_phone: contactPhone ?? null,
    p_appointment_type: appointmentType,
    p_scheduled_at: new Date(startMs).toISOString(),
    p_duration_minutes: duration,
    p_status: appointmentType === "walk_in" ? "CONFIRMED" : "REQUESTED",
    p_reason: input.reasonForVisit?.trim() || null,
  });

  if (rpcError) {
    const message = String(rpcError.message ?? "");
    const code = String((rpcError as { code?: string }).code ?? "");

    // ⚠ A MISSING FUNCTION FAILS LOUDLY AND NAMES THE FILE. identity-service's ALLOCATOR_UNAVAILABLE has
    // the same shape and the same reason: silently falling back to the sequential path here would
    // reintroduce, invisibly, the exact half-written registration this whole function exists to prevent.
    if (code === "PGRST202" || /Could not find the function|does not exist/i.test(message))
      return {
        ok: false, status: 503, code: "TRANSACTION_UNAVAILABLE",
        message: `this registration was not saved because the register-and-book transaction is not available -- migration 276 may not have been applied: ${message}`,
      };

    // ⚠ THE RACE, CAUGHT BY THE DATABASE AND REPORTED AS WHAT IT IS. Nothing was written: no patient, no
    // identifier, no contact, no appointment. The whole statement rolled back.
    if (code === "23P01" || /practice_appointment_no_overlap|exclusion constraint/i.test(message)) {
      const refreshed = await bookableTimes(admin, {
        channel: "staff", workspaceId: ctx.workspaceId, appointmentType, locationId,
        fromIso: new Date(startMs).toISOString(),
        toIso: new Date(startMs + ALTERNATIVE_WINDOW_MS).toISOString(),
      });

      // ── ⚠ THE MINUTE THAT JUST FAILED IS REMOVED EXPLICITLY, NOT BY HOPING THE RE-READ SEES IT ───
      //
      // A slot that raised 23P01 one millisecond ago is the ONE time in this whole window that we know
      // for certain is taken -- we know it because the database refused it, which is a stronger fact
      // than anything a subsequent SELECT can tell us. Handing that knowledge back to a re-read and
      // trusting the answer is the weaker of the two positions, and it fails in at least three ways
      // that are not theoretical:
      //
      //   1. A READ REPLICA OR A POOLED CONNECTION CAN LAG THE WRITE. The refusing transaction
      //      committed on the primary; the refreshing SELECT need not have seen it yet. The window is
      //      milliseconds and this code runs inside it by construction.
      //   2. THE WINNING APPOINTMENT MAY NOT BE VISIBLE TO THIS CHANNEL AT ALL. bookableTimes subtracts
      //      appointments, but it also filters by session mode, slot kind and type links -- if the
      //      winner booked through a path this read does not model, the minute comes back as free.
      //   3. IT PUTS THE LOST MINUTE BACK ON THE SCREEN. The desk presses it again, gets the same
      //      refusal, and the product reads as broken at exactly the moment it is working correctly.
      //
      // ⚠ EXACT EQUALITY, AND DELIBERATELY NOT A WINDOW. We know OUR minute was refused. We do not know
      // how long the winning appointment is, so widening this to "everything the winner might occupy"
      // would be guessing which other times to hide -- and hiding a free time is its own defect. What
      // the re-read CAN see, it subtracts; what we KNOW, we remove. Nobody should widen this into the
      // former's job.
      const stillFree = refreshed.ok
        ? refreshed.data.slots.filter(s => Date.parse(s.startsAt) !== startMs)
        : null;

      return {
        ok: false, status: 409, code: "SLOT_TAKEN",
        message: `${formatTime(input.scheduledAt, offered.data.timezone)} was taken while you were typing. Nothing was saved -- this patient has not been registered. Choose another time.`,
        // ⚠ ABSENT WHEN THE REFRESH ITSELF FAILED, rather than an empty list. "There is nothing else" and
        // "we could not look" are different sentences and the card prints different words for each.
        ...(stillFree ? { alternatives: stillFree.slice(0, ALTERNATIVE_LIMIT) } : {}),
      };
    }

    if (/ux_practice_identifier_live|duplicate key|unique constraint/i.test(message))
      return {
        ok: false, status: 409, code: "DUPLICATE_IDENTIFIER",
        message: `that identifier already belongs to a registered patient, so nothing was saved: ${message}`,
      };

    return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: `nothing was saved: ${message}` };
  }

  const result = (written ?? {}) as { patient_id?: string; appointment_id?: string };
  if (!result.patient_id || !result.appointment_id)
    return {
      ok: false, status: 500, code: "NOT_WRITTEN",
      message: "the registration reported no error and returned no record. Search for this patient before trying again.",
    };

  // ── 6. AFTER THE TRANSACTION: the guardians, and the audit ─────────────────────────────────────
  //
  // ⚠ OUTSIDE IT, AND SAID SO. The guardian RULE is enforced in step 1 and refuses before anything is
  // written, so a child cannot be registered here without one. What is outside the transaction is the
  // WRITING of the relationship rows, through addRelationship, which carries its own validation and its
  // own audit entry. Reproducing that inside migration 276 would be a second implementation of s6 living
  // in SQL, where no harness can reach it. A row that fails to write is reported in `incomplete`, which
  // is the vocabulary the form already renders.
  const related = await attachRelationships(admin, ctx, result.patient_id, input);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: "practice.patient_registered_and_booked",
    payload: {
      patientId: result.patient_id, appointmentId: result.appointment_id,
      scheduledAt: new Date(startMs).toISOString(), locationId, appointmentType,
      relationships: related.attached, atomic: true,
    },
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    data: {
      patientId: result.patient_id, practiceId, displayName,
      appointmentId: result.appointment_id,
      scheduledAt: new Date(startMs).toISOString(), locationId,
      relationships: related.attached, incomplete: related.failures,
    },
  };
}

/** "10:20" in the practice's own timezone. A refusal that names a time must name the one on the screen. */
function formatTime(instantIso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(instantIso));
  } catch {
    return "That time";
  }
}
