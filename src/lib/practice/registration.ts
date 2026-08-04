import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { registerPatient, composeDisplayName } from "@/lib/practice/patients";
import { addRelationship, ageFrom, relationshipExpectation, MAJORITY_AGE } from "@/lib/practice/relationships";
import { bookAppointment } from "@/lib/practice/scheduling";
import { practiceToday, workspaceClock } from "@/lib/practice/practice-time";
import { resolveTemplate, validateSubmission } from "@/lib/practice/registration-config";
import { audit } from "@/lib/practice/provisioning";

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

export async function register(admin: any, ctx: WorkspaceContext, input: RegistrationInput): Promise<
  EngineResult<{
    patientId: string; practiceId: string; displayName: string;
    relationships: number; appointmentId: string | null;
    incomplete: { step: string; reason: string }[];
  }>
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

  const incomplete: { step: string; reason: string }[] = [];

  // THE BORROWED CONTACT IS REMOVED FROM THE PATIENT once the record exists. It was only ever there to
  // satisfy the minimum-dataset check, and leaving it would put a guardian's number in a child's own
  // contact list, where a later reader has no way to tell whose it is.
  if (satisfiedByGuardian) {
    await admin.from("practice_patient_contact")
      .delete().eq("patient_id", created.data.id).eq("workspace_id", ctx.workspaceId);
  }

  // ── 2. The relationships ──────────────────────────────────────────────────────────────────────────
  let attached = 0;
  for (const r of input.relationships ?? []) {
    const added = await addRelationship(admin, ctx, {
      patientId: created.data.id, relationshipType: r.relationshipType, fullName: r.fullName,
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
    else incomplete.push({ step: "relationship", reason: `${r.fullName}: ${added.message}` });
  }

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
