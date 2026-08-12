import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, workspaceClock } from "@/lib/practice/practice-time";

// CPR-PRM-001 s6 RELATIONSHIP MANAGEMENT, s10 CONSENT, s4 PREFERENCES AND TAGS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHICH WORKFLOW APPLIES IS DERIVED FROM THE DATE OF BIRTH, EVERY TIME IT IS ASKED.
//
// s6: under 18 needs a guardian, 18 and over a next of kin. There is no is_minor column and no age
// column, for the reason CPR-140 gave about overdue: a stored flag needs something to run, and a child
// turns eighteen on a particular morning whether or not anybody opened the software that week. A
// registration-time flag would keep demanding a guardian for a grown adult, or -- worse -- would stop
// demanding one because a job failed.
//
// AGE IS COMPUTED IN THE PRACTICE'S CALENDAR, not UTC. A birthday is a date in the place the patient
// lives, and CPR-300 already found what UTC does to "today" in Kampala at 01:00.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const RELATIONSHIP_TYPES = [
  ["guardian", "Guardian"],
  ["mother", "Mother"],
  ["father", "Father"],
  ["spouse", "Spouse"],
  ["partner", "Partner"],
  ["sibling", "Sibling"],
  ["child", "Child"],
  ["grandparent", "Grandparent"],
  ["emergency_contact", "Emergency contact"],
  ["interpreter", "Interpreter"],
  ["employer", "Employer"],
  ["insurance_contact", "Insurance contact"],
  ["carer", "Carer"],
  ["social_worker", "Social worker"],
  ["other", "Other"],
] as const;

/** The types that can carry legal authority for somebody who cannot decide for themselves.
 *  Exported for the patient import, which must judge a CSV guardian by THIS list and no copy of it. */
export const GUARDIAN_TYPES = new Set(["guardian", "mother", "father", "grandparent", "carer", "social_worker"]);

export const CONSENT_TYPES = [
  ["data_processing", "Holding and processing their information"],
  ["contact_by_practice", "Being contacted by this practice"],
  ["share_with_referrer", "Sharing their information with a referrer"],
] as const;

export const MAJORITY_AGE = 18;

/**
 * s4: "DOB with automatic age calculation (years, months, days)."
 *
 * EXACT, AND IN THE PRACTICE'S CALENDAR. Years alone is wrong for an infant -- "0" is not a useful
 * answer about a six-week-old, and paediatric dosing turns on months and days.
 */
export function ageFrom(birthDate: string | null, today: string): {
  years: number; months: number; days: number; label: string;
} | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (`${by}-${bm}-${bd}` > `${ty}-${tm}-${td}` && new Date(birthDate) > new Date(today)) return null;

  let years = ty - by;
  let months = tm - bm;
  let days = td - bd;
  if (days < 0) {
    months -= 1;
    // Days in the month before today's, which is what "and 3 days" actually counts from.
    days += new Date(Date.UTC(tm === 1 ? ty - 1 : ty, tm === 1 ? 12 : tm - 1, 0)).getUTCDate();
  }
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return null;

  const label = years >= 2 ? `${years} years`
    : years === 1 ? `1 year, ${months} months`
    : months >= 1 ? `${months} months, ${days} days`
    : `${days} days`;
  return { years, months, days, label };
}

/**
 * What this patient's record needs, derived.
 *
 * s6's whole rule, in one place. `required` is the workflow the record should have; `satisfied` says
 * whether it does. Nothing is stored -- ask again tomorrow and a patient who had a birthday overnight
 * gets a different answer, which is the correct one.
 */
export function relationshipExpectation(
  age: ReturnType<typeof ageFrom>, live: any[], estimateYears?: number | null,
) {
  // AN ESTIMATE IS NOT A BIRTHDAY, AND THE DIFFERENCE MATTERS MOST AT THE BOUNDARY.
  //
  // registerPatient requires a birth date OR an estimate (CPR-V2-005's minimum dataset), so a walk-in
  // recorded as "about six" is the common case rather than an edge one -- and refusing to decide for
  // them would be as wrong as guessing. A six-year-old needs a guardian whether or not anybody knows
  // the date.
  //
  // But an estimate of 17, 18 or 19 CANNOT settle majority. Deciding either way there would either
  // strip a child of a guardian or demand one from an adult, on the strength of somebody's glance. That
  // band is reported as unknown, deliberately, and asks for the date instead.
  const ESTIMATE_UNCERTAIN = 2;
  let years: number | null = age ? age.years : null;
  let fromEstimate = false;
  if (years === null && estimateYears != null && Number.isFinite(estimateYears)) {
    if (Math.abs(estimateYears - MAJORITY_AGE) <= ESTIMATE_UNCERTAIN) {
      return {
        required: "unknown" as const,
        satisfied: false,
        reason: `This patient's age is an estimate of about ${estimateYears}, which is too close to ${MAJORITY_AGE} to decide whether a guardian is needed. Record a date of birth.`,
      };
    }
    years = estimateYears;
    fromEstimate = true;
  }

  if (years === null) {
    return {
      // A PATIENT WITH NEITHER A DATE NOR AN ESTIMATE IS NOT AN ADULT BY DEFAULT. Assuming majority is
      // the unsafe direction: it silently drops the guardian requirement for a child.
      required: "unknown" as const,
      satisfied: false,
      reason: "No date of birth or age estimate is recorded, so whether this patient needs a guardian or a next of kin cannot be worked out.",
    };
  }

  const said = age ? age.label : `about ${years} years`;
  const caveat = fromEstimate ? " This is based on an estimated age, not a recorded date of birth." : "";

  if (years < MAJORITY_AGE) {
    const guardian = live.find(r => r.is_legal_guardian && GUARDIAN_TYPES.has(r.relationship_type));
    return {
      required: "guardian" as const,
      satisfied: !!guardian,
      fromEstimate,
      reason: guardian
        ? `${guardian.full_name} is recorded as the legal guardian.`
        : `This patient is ${said} old. A guardian with legal authority is expected and none is recorded.${caveat}`,
    };
  }
  const kin = live.find(r => r.may_receive_information || r.is_primary);
  return {
    required: "next_of_kin" as const,
    satisfied: !!kin,
    fromEstimate,
    reason: kin
      ? `${kin.full_name} is recorded as the person to contact.`
      : `No next of kin or emergency contact is recorded.${caveat}`,
  };
}

// ── READING ──────────────────────────────────────────────────────────────────────────────────────────

export async function patientRelationships(admin: any, ctx: WorkspaceContext, patientId: string) {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name, birth_date, age_estimate_years, preferred_contact_method, preferred_language, contact_note, tags, practice_note")
    .eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return null;

  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);

  const [{ data: relationships }, { data: consents }] = await Promise.all([
    admin.from("practice_patient_relationship").select("*")
      .eq("patient_id", patientId).eq("workspace_id", ctx.workspaceId)
      .order("is_primary", { ascending: false }).order("created_at"),
    admin.from("practice_patient_consent").select("*")
      .eq("patient_id", patientId).eq("workspace_id", ctx.workspaceId)
      .order("recorded_at", { ascending: false }),
  ]);

  const rows = (relationships ?? []) as any[];
  // ENDED RATHER THAN DELETED, so "who was authorised in March" is answerable -- but only the live ones
  // count towards what the record needs.
  // EXCLUSIVE: effective_to is the day authority STOPPED, not the last day it applied.
  //
  // The inclusive reading is the more natural one for a date range, and it is the wrong one here. When
  // somebody revokes a guardian's authority, it has to stop THAT DAY -- an inclusive end date would
  // leave them recorded as the legal guardian until midnight, which is exactly the window in which the
  // revocation mattered.
  const live = rows.filter(r => !r.effective_to || r.effective_to > today);
  const age = ageFrom(patient.birth_date, today);

  // s10: the LATEST state per consent type. An older 'given' does not survive a later 'withdrawn'.
  const consentRows = (consents ?? []) as any[];
  const latestConsent = CONSENT_TYPES.map(([key, label]) => {
    const found = consentRows.find(c => c.consent_type === key);
    return {
      key, label,
      state: found?.state ?? "not_recorded",
      recordedAt: found?.recorded_at ?? null,
      givenByName: found?.given_by_name ?? null,
      noticeVersion: found?.notice_version ?? null,
    };
  });

  return {
    patient,
    today,
    age,
    // The estimate is reported SEPARATELY and never mixed into the exact age -- "about 40" is not a
    // birthday, and a workflow decision made from it should say which it used.
    ageEstimateYears: patient.age_estimate_years ?? null,
    relationships: rows.map(r => ({
      ...r,
      live: !r.effective_to || r.effective_to > today,
      typeLabel: (RELATIONSHIP_TYPES.find(([k]) => k === r.relationship_type) ?? [])[1] ?? r.relationship_type,
    })),
    expectation: relationshipExpectation(age, live, patient.age_estimate_years),
    consent: latestConsent,
    consentHistory: consentRows,
    // The doctrine, as a field: nothing here routes a message anywhere.
    contactPreferenceIsAdvisoryOnly: true,
  };
}

// ── WRITING ──────────────────────────────────────────────────────────────────────────────────────────

export async function addRelationship(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; relationshipType: string; fullName: string;
  phone?: string; email?: string; address?: string; note?: string;
  isLegalGuardian?: boolean; mayReceiveInformation?: boolean; isPrimary?: boolean;
  correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("patient.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.edit is required" };
  if (!RELATIONSHIP_TYPES.some(([k]) => k === args.relationshipType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown relationship type: ${args.relationshipType}` };
  if (args.fullName.trim().length < 2)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is required" };

  const { data: patient } = await admin.from("practice_patient")
    .select("id").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // LEGAL AUTHORITY IS NOT AVAILABLE TO EVERY RELATIONSHIP. An interpreter or an employer cannot be a
  // legal guardian, and letting the flag be set on one is how a record ends up saying somebody could
  // consent on a patient's behalf when they never could.
  if (args.isLegalGuardian && !GUARDIAN_TYPES.has(args.relationshipType))
    return {
      ok: false, status: 422, code: "CANNOT_BE_GUARDIAN",
      message: `a ${args.relationshipType.replace(/_/g, " ")} cannot hold legal guardianship -- record them as a guardian if that is what they are`,
    };

  // A NEW PRIMARY DISPLACES THE OLD ONE rather than colliding with the partial unique index. Done first,
  // so the insert cannot fail on a constraint the caller cannot see.
  if (args.isPrimary) {
    await admin.from("practice_patient_relationship")
      .update({ is_primary: false, updated_at: nowIso(), updated_by: ctx.userId }).eq("workspace_id", ctx.workspaceId)
      .eq("patient_id", args.patientId).eq("is_primary", true).is("effective_to", null);
  }

  const { data, error } = await admin.from("practice_patient_relationship").insert({
    workspace_id: ctx.workspaceId, patient_id: args.patientId,
    relationship_type: args.relationshipType, full_name: args.fullName.trim(),
    phone: args.phone?.trim() || null, email: args.email?.trim() || null,
    address: args.address?.trim() || null, note: args.note?.trim() || null,
    is_legal_guardian: args.isLegalGuardian === true,
    may_receive_information: args.mayReceiveInformation === true,
    is_primary: args.isPrimary === true,
    created_by: ctx.userId, updated_by: ctx.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.relationship_added",
    payload: {
      relationshipId: data.id, patientId: args.patientId, type: args.relationshipType,
      legalGuardian: args.isLegalGuardian === true,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * End a relationship.
 *
 * ENDED, NOT DELETED. Who was authorised last March is a fact about the record, and a guardian who is
 * no longer the guardian is exactly the thing somebody will need to look up.
 */
export async function endRelationship(admin: any, ctx: WorkspaceContext, args: {
  id: string; on?: string; correlationId: string;
}): Promise<EngineResult<{ endedOn: string }>> {
  if (!ctx.capabilities.includes("patient.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.edit is required" };

  const { data: r } = await admin.from("practice_patient_relationship")
    .select("id, patient_id, effective_from").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const on = args.on ?? practiceToday(timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a date (YYYY-MM-DD) is required" };
  if (on < r.effective_from)
    return { ok: false, status: 400, code: "ENDS_BEFORE_START", message: "that ends the relationship before it began" };

  const { data: updated, error } = await admin.from("practice_patient_relationship")
    // Cleared as it ends: a primary contact who is no longer live must not hold the primary slot, or
    // nobody else can take it.
    .update({ effective_to: on, is_primary: false, updated_at: nowIso(), updated_by: ctx.userId }).eq("workspace_id", ctx.workspaceId)
    .eq("id", r.id).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.relationship_ended",
    payload: { relationshipId: r.id, patientId: r.patient_id, endedOn: on }, correlationId: args.correlationId,
  });
  return { ok: true, data: { endedOn: on } };
}

/**
 * s10: record data-processing consent.
 *
 * FOR A CHILD, THE GUARDIAN GIVES IT, and the record names which one. Consent "given by the patient"
 * when the patient is four is a record nobody can rely on.
 */
export async function recordConsent(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; consentType: string; state: string;
  givenByRelationshipId?: string | null; givenByName?: string;
  noticeVersion?: string; note?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("patient.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.edit is required" };
  if (!CONSENT_TYPES.some(([k]) => k === args.consentType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown consent type: ${args.consentType}` };
  if (!["not_recorded", "given", "declined", "withdrawn"].includes(args.state))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown state: ${args.state}` };

  const detail = await patientRelationships(admin, ctx, args.patientId);
  if (!detail) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A CHILD CANNOT CONSENT FOR THEMSELVES, and this is the one place that rule can be enforced.
  if (args.state === "given" && detail.expectation.required === "guardian") {
    const named = args.givenByRelationshipId
      ? detail.relationships.find(r => r.id === args.givenByRelationshipId && r.live && r.is_legal_guardian)
      : null;
    if (!named)
      return {
        ok: false, status: 422, code: "GUARDIAN_REQUIRED",
        message: "this patient is under 18, so consent has to be recorded against the guardian who gave it",
      };
  }

  const { data, error } = await admin.from("practice_patient_consent").insert({
    workspace_id: ctx.workspaceId, patient_id: args.patientId,
    consent_type: args.consentType, state: args.state,
    given_by_relationship_id: args.givenByRelationshipId ?? null,
    given_by_name: args.givenByName?.trim() || null,
    notice_version: args.noticeVersion?.trim() || null,
    note: args.note?.trim() || null, recorded_by: ctx.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.consent_recorded",
    payload: { consentId: data.id, patientId: args.patientId, type: args.consentType, state: args.state },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/** s4: preferences, tags and the practice note. */
export async function updatePatientAdmin(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; preferredContactMethod?: string | null; preferredLanguage?: string;
  contactNote?: string; tags?: string[]; practiceNote?: string; correlationId: string;
}): Promise<EngineResult<{ updated: true }>> {
  if (!ctx.capabilities.includes("patient.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.edit is required" };

  const METHODS = ["phone", "sms", "email", "in_person", "via_relative", "none"];
  if (args.preferredContactMethod && !METHODS.includes(args.preferredContactMethod))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `contact method must be one of: ${METHODS.join(", ")}` };

  const patch: Record<string, unknown> = {};
  if (args.preferredContactMethod !== undefined) patch.preferred_contact_method = args.preferredContactMethod || null;
  if (args.preferredLanguage !== undefined) patch.preferred_language = args.preferredLanguage.trim() || null;
  if (args.contactNote !== undefined) patch.contact_note = args.contactNote.trim() || null;
  if (args.practiceNote !== undefined) patch.practice_note = args.practiceNote.trim() || null;
  if (args.tags !== undefined) {
    // Normalised on the way in, so "Diabetic", "diabetic" and " diabetic " are one tag rather than three
    // in a report nobody can read.
    const tags = [...new Set(args.tags.map(t => t.trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 40))];
    if (tags.length > 25)
      return { ok: false, status: 400, code: "TOO_MANY_TAGS", message: "25 tags is already more than anybody reads" };
    patch.tags = tags;
  }
  if (Object.keys(patch).length === 0)
    return { ok: false, status: 400, code: "NOTHING_TO_DO", message: "nothing was supplied to change" };

  const { data: updated, error } = await admin.from("practice_patient")
    .update(patch).eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.patient_admin_updated",
    payload: { patientId: args.patientId, fields: Object.keys(patch) }, correlationId: args.correlationId,
  });
  return { ok: true, data: { updated: true } };
}

/**
 * Every patient whose record does not have what s6 expects.
 *
 * DERIVED, so a child who turned eighteen last night drops off this list this morning without anything
 * having run overnight.
 */
export async function relationshipGaps(admin: any, ctx: WorkspaceContext, limit = 100) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);

  const { data: patients } = await admin.from("practice_patient")
    .select("id, display_name, birth_date, age_estimate_years, status")
    .eq("workspace_id", ctx.workspaceId).eq("status", "active").limit(1000);
  const rows = (patients ?? []) as any[];
  if (rows.length === 0) return { today, gaps: [], checked: 0 };

  const { data: relationships } = await admin.from("practice_patient_relationship")
    .select("patient_id, full_name, relationship_type, is_legal_guardian, may_receive_information, is_primary, effective_to")
    .eq("workspace_id", ctx.workspaceId).in("patient_id", rows.map(r => r.id));
  const byPatient = new Map<string, any[]>();
  for (const r of ((relationships ?? []) as any[])) {
    // Same exclusive rule as patientRelationships: ended today means not live today.
    if (r.effective_to && r.effective_to <= today) continue;
    byPatient.set(r.patient_id, [...(byPatient.get(r.patient_id) ?? []), r]);
  }

  const gaps = rows.map(p => {
    const age = ageFrom(p.birth_date, today);
    const expectation = relationshipExpectation(age, byPatient.get(p.id) ?? [], p.age_estimate_years);
    return { patientId: p.id, displayName: p.display_name, age, expectation };
  }).filter(g => !g.expectation.satisfied)
    // The children first: a missing guardian is a different order of problem from a missing next of kin.
    .sort((a, b) => {
      const rank = (r: string) => r === "guardian" ? 0 : r === "unknown" ? 1 : 2;
      return rank(a.expectation.required) - rank(b.expectation.required);
    });

  return { today, gaps: gaps.slice(0, limit), checked: rows.length };
}
