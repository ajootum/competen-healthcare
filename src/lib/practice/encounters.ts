import { audit } from "@/lib/practice/provisioning";
import { ENCOUNTER_TRANSITIONS, LOCKED_STATUSES, LIVE_STATUSES } from "@/lib/practice/encounter-constants";

// PEN-003 Clinical Encounter Engine + CPR-FLOW-001 encounter launch.
//
// FLOW-001'S FOUR ENTRY PATHWAYS ARE ONE FUNCTION, not four. "Scheduled patient, existing patient, new
// walk-in, follow-up patient" differ in how the PATIENT is reached, not in what an encounter is -- so
// launchEncounter takes the pathway as data, resolves the appointment link where there is one, links the
// previous encounter where the pathway is a follow-up, and produces the same container every time. Four
// code paths would drift; four rows of a table cannot.
//
// RESUME BEFORE CREATE (FLOW-001 "resume unfinished encounter where appropriate"). A live encounter for
// this patient is RETURNED, not duplicated -- and the partial unique index in migration 194 makes that
// true even if this check races with itself.
//
// SIGNING IS THE BOUNDARY. Before it, the encounter is a working draft the practitioner owns. After it,
// DM-001 s16 locks the source version: the engine refuses edits, and the database trigger refuses them
// again for anything that reaches the tables another way.

/* eslint-disable @typescript-eslint/no-explicit-any */

// The state tables live in encounter-constants (no server imports) so the consultation UI derives its
// buttons from the same table the engine enforces. Re-exported here so callers have one import.
export {
  ENCOUNTER_TRANSITIONS, LOCKED_STATUSES, LIVE_STATUSES, NOTE_TYPES, ENCOUNTER_ACTIONS,
} from "@/lib/practice/encounter-constants";

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export type LaunchInput = {
  workspaceId: string;
  patientId: string;
  pathway: "booked" | "new_walk_in" | "walk_in_followup" | "scheduled_followup";
  appointmentId?: string | null;
  encounterMode?: string;
  reasonForVisit?: string;
  actorId: string;
  correlationId: string;
};

async function recordTransition(admin: any, workspaceId: string, encounterId: string, from: string | null, to: string, actorId: string) {
  await admin.from("practice_encounter_status_history").insert({
    workspace_id: workspaceId, encounter_id: encounterId, from_status: from, to_status: to, actor_id: actorId,
  });
}

export async function launchEncounter(admin: any, input: LaunchInput): Promise<EngineResult<{
  id: string; status: string; resumed: boolean;
}>> {
  // The patient must exist in THIS workspace and be usable.
  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", input.patientId).eq("workspace_id", input.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status !== "active")
    return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };

  // Resume before create.
  const { data: live } = await admin.from("practice_encounter")
    .select("id, status").eq("patient_id", input.patientId).in("status", LIVE_STATUSES).maybeSingle();
  if (live) return { ok: true, data: { id: live.id, status: live.status, resumed: true } };

  // A named appointment must belong to this workspace AND this patient -- an encounter filed against
  // someone else's appointment would corrupt both the diary and the clinical record.
  let appointmentId: string | null = null;
  if (input.appointmentId) {
    const { data: appt } = await admin.from("practice_appointment")
      .select("id, patient_id").eq("id", input.appointmentId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (appt.patient_id && appt.patient_id !== input.patientId)
      return { ok: false, status: 422, code: "APPOINTMENT_PATIENT_MISMATCH", message: "that appointment belongs to a different patient" };
    appointmentId = appt.id;
  }

  // Follow-up pathways link to the most recent finished encounter (PEN-003 longitudinal continuity).
  let previousEncounterId: string | null = null;
  if (input.pathway === "walk_in_followup" || input.pathway === "scheduled_followup") {
    const { data: prev } = await admin.from("practice_encounter")
      .select("id").eq("patient_id", input.patientId).in("status", ["COMPLETED", "SIGNED", "AMENDED"])
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    previousEncounterId = prev?.id ?? null;
  }

  const { data: enc, error } = await admin.from("practice_encounter").insert({
    workspace_id: input.workspaceId, patient_id: input.patientId, appointment_id: appointmentId,
    previous_encounter_id: previousEncounterId, entry_pathway: input.pathway,
    encounter_mode: input.encounterMode ?? "in_person",
    reason_for_visit: input.reasonForVisit ?? null, status: "DRAFT", created_by: input.actorId,
  }).select("id, status").single();
  if (error) {
    // The partial unique index is the backstop for a race that beat the resume check above.
    if (/duplicate|unique/i.test(error.message)) {
      const { data: raced } = await admin.from("practice_encounter")
        .select("id, status").eq("patient_id", input.patientId).in("status", LIVE_STATUSES).maybeSingle();
      if (raced) return { ok: true, data: { id: raced.id, status: raced.status, resumed: true } };
    }
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await recordTransition(admin, input.workspaceId, enc.id, null, "DRAFT", input.actorId);
  await audit(admin, {
    workspaceId: input.workspaceId, actorId: input.actorId, eventType: "practice.encounter_launched",
    payload: { encounterId: enc.id, patientId: input.patientId, pathway: input.pathway }, correlationId: input.correlationId,
  });
  return { ok: true, data: { id: enc.id as string, status: enc.status as string, resumed: false } };
}

export async function transitionEncounter(admin: any, args: {
  workspaceId: string; encounterId: string; to: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: enc } = await admin.from("practice_encounter")
    .select("id, status, record_version").eq("id", args.encounterId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(ENCOUNTER_TRANSITIONS[enc.status] ?? []).includes(args.to))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${enc.status} cannot become ${args.to}` };

  const patch: Record<string, unknown> = {
    status: args.to, record_version: enc.record_version + 1,
    updated_at: new Date().toISOString(), updated_by: args.actorId,
  };
  if (args.to === "COMPLETED") patch.completed_at = new Date().toISOString();
  if (args.to === "SIGNED" && enc.status === "COMPLETED") {
    patch.signed_at = new Date().toISOString();
    patch.signed_by = args.actorId;
  }

  const { data: updated, error } = await admin.from("practice_encounter")
    .update(patch).eq("id", enc.id).eq("record_version", enc.record_version).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the encounter changed underneath you; reload and retry" };

  await recordTransition(admin, args.workspaceId, enc.id, enc.status, args.to, args.actorId);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.encounter_${args.to.toLowerCase()}`, payload: { encounterId: enc.id },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.to } };
}

/** Guard shared by every clinical write: the encounter must exist here and not be locked. */
type Editable = EngineResult<{ id: string; status: string; patient_id: string }>;

export async function editableEncounter(admin: any, workspaceId: string, encounterId: string): Promise<Editable> {
  const { data: enc } = await admin.from("practice_encounter")
    .select("id, status, patient_id").eq("id", encounterId).eq("workspace_id", workspaceId).maybeSingle();
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (LOCKED_STATUSES.includes(enc.status))
    return { ok: false, status: 422, code: "ENCOUNTER_LOCKED", message: "this encounter is signed; amend it to make changes" };
  if (enc.status === "CANCELLED")
    return { ok: false, status: 422, code: "ENCOUNTER_CANCELLED", message: "this encounter was cancelled" };
  return { ok: true, data: enc };
}

// SAVING A SOAP SEGMENT MOVED TO documentation.ts (CPR-130). It lived here through Phase 3, when a save
// was a single upsert; it is now a versioned write that appends to the note's history, and versioning is
// CPR-130's concern rather than the encounter's. Recorded here rather than left as a hole, because
// `saveNote` is the name somebody will come to this file looking for.
//
// The dependency runs one way only -- documentation.ts imports editableEncounter from here, and nothing
// here imports from there.

/**
 * Record a diagnosis. When `problemLabel` is given, the longitudinal Problem is found-or-created for
 * this patient and linked -- which is how an encounter diagnosis becomes part of a problem list
 * spanning visits (DM-001 s9) without asking the practitioner to manage two things.
 */
export async function recordDiagnosis(admin: any, args: {
  workspaceId: string; encounterId: string; label: string; code?: string; codeSystem?: string;
  certainty?: string; isPrimary?: boolean; problemLabel?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; problemId: string | null }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;
  const patientId = guard.data.patient_id;

  let problemId: string | null = null;
  const problemLabel = (args.problemLabel ?? "").trim();
  if (problemLabel) {
    const { data: existing } = await admin.from("practice_problem")
      .select("id").eq("patient_id", patientId).eq("label", problemLabel).eq("status", "active").maybeSingle();
    if (existing) problemId = existing.id;
    else {
      const { data: created } = await admin.from("practice_problem").insert({
        workspace_id: args.workspaceId, patient_id: patientId, label: problemLabel, created_by: args.actorId,
      }).select("id").single();
      problemId = created?.id ?? null;
    }
  }

  const { data: diag, error } = await admin.from("practice_diagnosis").insert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, patient_id: patientId,
    problem_id: problemId, label: args.label.trim(), code: args.code ?? null,
    code_system: args.codeSystem ?? null,
    certainty: ["suspected", "provisional", "confirmed", "ruled_out"].includes(args.certainty ?? "") ? args.certainty : "provisional",
    is_primary: args.isPrimary === true, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.diagnosis_recorded",
    payload: { encounterId: args.encounterId, diagnosisId: diag.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: diag.id as string, problemId } };
}

export async function recordTreatment(admin: any, args: {
  workspaceId: string; encounterId: string; treatmentType: string; label: string;
  dose?: string; route?: string; frequency?: string; duration?: string; notes?: string;
  diagnosisId?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const { data: t, error } = await admin.from("practice_treatment").insert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, patient_id: guard.data.patient_id,
    diagnosis_id: args.diagnosisId ?? null, treatment_type: args.treatmentType, label: args.label.trim(),
    dose: args.dose ?? null, route: args.route ?? null, frequency: args.frequency ?? null,
    duration: args.duration ?? null, notes: args.notes ?? null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.treatment_recorded",
    payload: { encounterId: args.encounterId, treatmentId: t.id, type: args.treatmentType },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

/** Everything CPR-V2-006 renders for one encounter. */
export async function getEncounter(admin: any, workspaceId: string, encounterId: string) {
  const { data: encounter } = await admin.from("practice_encounter")
    .select("id, patient_id, appointment_id, previous_encounter_id, encounter_mode, entry_pathway, reason_for_visit, status, started_at, completed_at, signed_at, record_version")
    .eq("id", encounterId).eq("workspace_id", workspaceId).maybeSingle();
  if (!encounter) return null;

  const [{ data: patient }, { data: notes }, { data: diagnoses }, { data: treatments }, { data: history }] = await Promise.all([
    admin.from("practice_patient").select("id, display_name, sex, birth_date, age_estimate_years, status").eq("id", encounter.patient_id).single(),
    admin.from("practice_encounter_note").select("id, note_type, body, updated_at, version, last_source, template_id").eq("encounter_id", encounterId),
    admin.from("practice_diagnosis").select("id, label, code, certainty, is_primary, problem_id").eq("encounter_id", encounterId).order("created_at"),
    admin.from("practice_treatment").select("id, treatment_type, label, dose, route, frequency, duration, status").eq("encounter_id", encounterId).order("created_at"),
    admin.from("practice_encounter_status_history").select("from_status, to_status, occurred_at").eq("encounter_id", encounterId).order("occurred_at"),
  ]);

  return {
    encounter, patient,
    notes: notes ?? [], diagnoses: diagnoses ?? [], treatments: treatments ?? [], history: history ?? [],
  };
}

/** The patient's clinical timeline: past encounters with their headline diagnoses (PEN-012 seed). */
export async function patientTimeline(admin: any, workspaceId: string, patientId: string, limit = 20) {
  const { data: encounters } = await admin.from("practice_encounter")
    .select("id, started_at, status, entry_pathway, reason_for_visit, encounter_mode")
    .eq("workspace_id", workspaceId).eq("patient_id", patientId)
    .order("started_at", { ascending: false }).limit(limit);
  const ids = ((encounters ?? []) as any[]).map(e => e.id);
  if (ids.length === 0) return { encounters: [], diagnosesByEncounter: {} as Record<string, any[]> };

  const { data: diags } = await admin.from("practice_diagnosis")
    .select("encounter_id, label, certainty, is_primary").in("encounter_id", ids);
  const diagnosesByEncounter: Record<string, any[]> = {};
  for (const d of (diags ?? []) as any[]) {
    (diagnosesByEncounter[d.encounter_id] ??= []).push(d);
  }
  return { encounters: encounters ?? [], diagnosesByEncounter };
}
