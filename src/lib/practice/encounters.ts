import { audit } from "@/lib/practice/audit";
import { runningActivityId } from "@/lib/practice/activity";
import { ENCOUNTER_TRANSITIONS, LOCKED_STATUSES, LIVE_STATUSES } from "@/lib/practice/encounter-constants";
import { emitEvents, type EventEnvelope, type EventSource, type PracticeEventType } from "@/lib/practice/events";

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
  //
  // A RESUMED ENCOUNTER KEEPS THE CONTEXT IT WAS OPENED IN. Returning early is what makes that true: the
  // activity is inherited at creation and never restamped, so a consultation begun in the morning clinic
  // and finished after the ward round still records the clinic. It is a note about where the work
  // started, not a field that tracks where the practitioner currently is.
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

  // CPR-V3-001 s6 / CPR-V5-001 s9: the encounter inherits the activity it is being made inside, and
  // through it the location, facility and practitioner that activity already carries. Inherited rather
  // than asked for -- a practitioner who has told the system they are in the 09:00 clinic should not be
  // asked again, once per patient, for the rest of the morning.
  //
  // ⚠ THE SUBJECT IS THE PRACTITIONER THE ENCOUNTER IS FOR, and in V3 that is the actor: LaunchInput
  // carries no separate practitioner, and nothing in the product yet opens somebody else's consultation.
  // The day a receptionist or a scribe can, this line is the one that has to change with it -- taking
  // the actor's activity then would file the consultant's clinical work against the front desk's day.
  //
  // NULL IS A CORRECT ANSWER. An encounter outside any session is ordinary. A read that FAILED is not,
  // and is refused below instead of being written as null, because afterwards the two are indeterminable.
  const activity = await runningActivityId(admin, input.workspaceId, input.actorId);
  if (activity.error)
    return { ok: false, status: 500, code: "CONTEXT_READ_FAILED", message: activity.error.message };

  const { data: enc, error } = await admin.from("practice_encounter").insert({
    workspace_id: input.workspaceId, patient_id: input.patientId, appointment_id: appointmentId,
    previous_encounter_id: previousEncounterId, entry_pathway: input.pathway,
    encounter_mode: input.encounterMode ?? "in_person", activity_id: activity.id,
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
  /** Whose work this is. Defaults to the actor, which is right until delegation exists. */
  practitionerId?: string;
  source?: EventSource;
  /** Set when a PAUSE is caused by another encounter displacing this one (CORE-06). */
  interruptedById?: string | null;
}): Promise<EngineResult<{ status: string; eventWarnings: string[] }>> {
  // ⚠ THE ERROR IS CHECKED. Discarded, a failed read became `!enc` and this returned 404 NOT_FOUND --
  // telling a practitioner their consultation does not exist because a query timed out is the most
  // alarming way to report a transient failure, and the one they cannot act on.
  const { data: enc, error: readErr } = await admin.from("practice_encounter")
    .select("id, status, record_version, patient_id, activity_id, created_by")
    .eq("id", args.encounterId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(ENCOUNTER_TRANSITIONS[enc.status] ?? []).includes(args.to))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${enc.status} cannot become ${args.to}` };

  const practitionerId = args.practitionerId ?? enc.created_by ?? args.actorId;

  // ⚠ ONE ACTIVE ENCOUNTER AT A TIME (s7). Refused HERE with a message a screen can act on, and refused
  // AGAIN by migration 234's partial unique index -- which is what actually holds when two tabs race.
  // The engine check exists so the ordinary case is a sentence rather than a constraint violation.
  if (args.to === "ACTIVE") {
    const running = await activeEncounterId(admin, args.workspaceId, practitionerId, enc.id);
    if (running.error) return { ok: false, status: 500, code: "READ_FAILED", message: running.error };
    if (running.id)
      return { ok: false, status: 409, code: "ANOTHER_ACTIVE",
        message: "another consultation is already open. Pause it, or start this one as an interruption." };
  }

  const now = new Date();
  const patch: Record<string, unknown> = {
    status: args.to, record_version: enc.record_version + 1,
    updated_at: now.toISOString(), updated_by: args.actorId,
  };
  if (args.to === "COMPLETED") patch.completed_at = now.toISOString();
  if (args.to === "SIGNED" && enc.status === "COMPLETED") {
    patch.signed_at = now.toISOString();
    patch.signed_by = args.actorId;
  }
  // Why it was paused, and cleared on the way back so a resumed consultation does not keep claiming it
  // is still interrupted.
  if (args.to === "PAUSED") patch.interrupted_by_id = args.interruptedById ?? null;
  if (args.to === "ACTIVE" && enc.status === "PAUSED") patch.interrupted_by_id = null;

  const { data: updated, error } = await admin.from("practice_encounter")
    .update(patch).eq("id", enc.id).eq("record_version", enc.record_version).select("id").maybeSingle();
  // 23505 is migration 234's index: another tab won the race between the check above and this write.
  if (error)
    return error.code === "23505"
      ? { ok: false, status: 409, code: "ANOTHER_ACTIVE", message: "another consultation was opened while this one was starting" }
      : { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the encounter changed underneath you. Reload and retry" };

  await recordTransition(admin, args.workspaceId, enc.id, enc.status, args.to, args.actorId);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.encounter_${args.to.toLowerCase()}`, payload: { encounterId: enc.id },
    correlationId: args.correlationId,
  });

  // ── s9's domain event, AFTER the write has committed ─────────────────────────────────────────
  //
  // Reopening is its own event: COMPLETED -> ACTIVE is not a start, and a projection that treated it as
  // one would count the patient twice.
  const eventType = enc.status === "COMPLETED" && args.to === "ACTIVE"
    ? "encounter.reopened" as const
    : ENCOUNTER_EVENT[args.to];
  const eventWarnings = eventType
    ? await emitEvents(admin, [{
      eventType, practiceId: args.workspaceId, practitionerId, actorId: args.actorId,
      source: args.source ?? "web", occurredAt: now,
      patientId: enc.patient_id ?? null, encounterId: enc.id,
      activityInstanceId: enc.activity_id ?? null, sessionId: enc.activity_id ?? null,
      payload: { from: enc.status, to: args.to,
        ...(args.to === "PAUSED" && args.interruptedById ? { interruptedBy: args.interruptedById } : {}) },
    } satisfies EventEnvelope])
    : [];

  return { ok: true, data: { status: args.to, eventWarnings } };
}

// ── CPR-CORE-001 CORE-05 / CORE-06: INTERRUPTION-SAFE ENCOUNTERS ─────────────────────────────────────
//
// The state machine above was already right. What was missing was the CONSTRAINT and the PATH:
//
//   s7   "single active foreground encounter. drafts remain accessible."
//   s6.2 "the original session remains resumable and its queue is preserved", and "interruption time
//        must not be counted as active consultation time for another patient."
//   s16  "an emergency interruption does not lose the current clinic queue or active draft."
//
// ⚠ THE LAST CLAUSE OF s6.2 IS A METRIC REQUIREMENT WEARING A WORKFLOW'S CLOTHES. metrics.ts already
// subtracts paused duration from the consult-time average, reading PAUSED out of the transition log --
// so until something actually PAUSED an encounter, that subtraction was always zero and the average was
// correct with nothing to correct for. This is what gives it something to subtract.

/** s9's encounter events, keyed by the status being moved to. Reopening is its own word. */
const ENCOUNTER_EVENT: Record<string, PracticeEventType | undefined> = {
  ACTIVE: "encounter.started",
  PAUSED: "encounter.paused",
  COMPLETED: "encounter.completed",
};

/**
 * Is anybody else already in the room?
 *
 * Returns the id or null, and the error SEPARATELY -- "nothing is active" and "the lookup failed" must
 * never collapse into the same answer, because the first permits a start and the second cannot.
 */
export async function activeEncounterId(
  admin: any, workspaceId: string, practitionerId: string, exceptId?: string,
): Promise<{ id: string | null; error: string | null }> {
  let q = admin.from("practice_encounter").select("id")
    .eq("workspace_id", workspaceId).eq("created_by", practitionerId).eq("status", "ACTIVE");
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q.maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: (data as { id: string } | null)?.id ?? null, error: null };
}

/**
 * Pause the consultation in progress and open the one that interrupted it.
 *
 * ⚠ THE ORDER IS THE WHOLE DESIGN. The running encounter is paused FIRST and the interrupting one is
 * started SECOND, because the database allows exactly one ACTIVE encounter per practitioner (migration
 * 234) and doing it the other way round would be refused by the index -- which is the correct failure,
 * but it would leave the emergency unopened rather than the clinic paused.
 *
 * ⚠ IF THE SECOND STEP FAILS, THE FIRST IS ROLLED BACK. There is no transaction to join here -- every
 * write is its own PostgREST round trip -- so an interruption that pauses a consultation and then fails
 * to open the emergency would leave a practitioner with nothing active and a patient in front of them.
 * Resuming is the safe direction, and the failure is reported rather than swallowed.
 *
 * The QUEUE IS UNTOUCHED, which is s16's acceptance criterion. Nothing here reads or writes
 * practice_queue_entry: the people waiting are still waiting, in the same order, and the paused
 * encounter still holds its own draft.
 */
export async function interruptWith(admin: any, args: {
  workspaceId: string;
  /** The encounter to open. It must already exist and be DRAFT or PAUSED. */
  encounterId: string;
  actorId: string;
  practitionerId: string;
  correlationId: string;
  source?: EventSource;
}): Promise<EngineResult<{ started: string; paused: string | null; eventWarnings: string[] }>> {
  const running = await activeEncounterId(admin, args.workspaceId, args.practitionerId, args.encounterId);
  if (running.error) return { ok: false, status: 500, code: "READ_FAILED", message: running.error };

  const eventWarnings: string[] = [];

  if (running.id) {
    const paused = await transitionEncounter(admin, {
      workspaceId: args.workspaceId, encounterId: running.id, to: "PAUSED",
      actorId: args.actorId, correlationId: args.correlationId, source: args.source,
      interruptedById: args.encounterId, practitionerId: args.practitionerId,
    });
    if (!paused.ok) return paused as EngineResult<never>;
    eventWarnings.push(...(paused.data.eventWarnings ?? []));
  }

  const started = await transitionEncounter(admin, {
    workspaceId: args.workspaceId, encounterId: args.encounterId, to: "ACTIVE",
    actorId: args.actorId, correlationId: args.correlationId, source: args.source,
    practitionerId: args.practitionerId,
  });

  if (!started.ok) {
    // Put the clinic back. A practitioner left with nothing active is worse than an emergency that
    // refused to open, because the second says so and the first does not.
    if (running.id) {
      const restored = await transitionEncounter(admin, {
        workspaceId: args.workspaceId, encounterId: running.id, to: "ACTIVE",
        actorId: args.actorId, correlationId: args.correlationId, source: args.source,
        practitionerId: args.practitionerId,
      });
      if (!restored.ok) return { ok: false, status: 500, code: "INTERRUPT_FAILED_UNRESUMED",
        message: `the interruption was refused (${started.message}) and the consultation it paused could not be resumed (${restored.message})` };
    }
    return started as EngineResult<never>;
  }
  eventWarnings.push(...(started.data.eventWarnings ?? []));

  return { ok: true, data: { started: args.encounterId, paused: running.id, eventWarnings } };
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

// ── CPR-ENC-001 s3 / CPR-ENC-002 s4: THE ENCOUNTER'S OUTCOME (migration 238) ─────────────────────────
//
// Procedures have an outcome and follow-ups have one; the encounter did not, and CPR-ENC-001 s3 lists it
// among the things an encounter captures. It lives on practice_encounter rather than in a table of its
// own because there is exactly one per encounter.
//
// ⚠ NULLABLE, AND NOT DEFAULTED. A draft encounter has no outcome yet, and an encounter closed without
// one happens -- CPR-ENC-002 s7 asks for a WARNING on a missing outcome, not a refusal. A default of
// 'stable' would manufacture a clinical claim for every unfinished record in the table.
//
// ⚠ THE DATABASE REFUSES THIS AFTER SIGNATURE INDEPENDENTLY OF THE GUARD BELOW. Migration 194's trigger
// rejects any update to a SIGNED row that does not move it to AMENDED or ENTERED_IN_ERROR, and an
// outcome write does neither -- so bypassing editableEncounter reaches a raised exception rather than a
// rewritten record. Both halves are asserted, because an engine check alone is a promise and a trigger
// is a guarantee.

/** migration 238's six-value CHECK, restated so the engine refuses before the database has to. */
const OUTCOMES = ["improved", "stable", "worsened", "resolved", "recurring", "other"];

export async function setEncounterOutcome(admin: any, args: {
  workspaceId: string; encounterId: string; outcome: string | null; outcomeNote?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ outcome: string | null }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const outcome = args.outcome === null || args.outcome === "" ? null : args.outcome;
  if (outcome !== null && !OUTCOMES.includes(outcome))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown outcome ${outcome}` };

  // `other` that says nothing is the get-past-the-field answer -- the same refusal CPR-150 makes of
  // `not_applicable` for laterality. If none of the five named answers fitted, the reason IS the field.
  const note = (args.outcomeNote ?? "").trim();
  if (outcome === "other" && !note)
    return { ok: false, status: 400, code: "OUTCOME_NOTE_REQUIRED", message: "an outcome of \"other\" needs a sentence saying what it was" };

  const { data, error } = await admin.from("practice_encounter")
    .update({
      outcome,
      // Cleared when the outcome is not `other`, so a note left behind by a changed mind cannot go on
      // describing an outcome that is no longer recorded.
      outcome_note: outcome === "other" ? note : null,
      updated_at: new Date().toISOString(), updated_by: args.actorId,
    })
    .eq("id", args.encounterId).eq("workspace_id", args.workspaceId).select("outcome").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.encounter_outcome_recorded",
    payload: { encounterId: args.encounterId, outcome }, correlationId: args.correlationId,
  });
  return { ok: true, data: { outcome: data.outcome ?? null } };
}

/** Everything CPR-V2-006 renders for one encounter. */
export async function getEncounter(admin: any, workspaceId: string, encounterId: string) {
  const { data: encounter } = await admin.from("practice_encounter")
    .select("id, patient_id, appointment_id, previous_encounter_id, encounter_mode, entry_pathway, reason_for_visit, status, started_at, completed_at, signed_at, record_version, activity_id, outcome, outcome_note")
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

/**
 * The patient's clinical timeline: past encounters with their headline diagnoses (PEN-012 seed).
 *
 * ⚠ BOTH READS DISCARDED THEIR ERRORS, AND AN EMPTY CLINICAL TIMELINE IS THE MOST DANGEROUS EMPTY LIST
 * IN THIS PRODUCT. It does not read as "something went wrong". It reads as A PATIENT WITH NO HISTORY --
 * nobody seen here before, nothing diagnosed, nothing to take into account. A clinician looking at that
 * screen has no way to tell it from the truth, and the decisions that follow are different ones.
 *
 * The diagnosis read matters separately from the encounter read, so they are reported separately: a
 * timeline with its consultations and no diagnoses is still worth showing, and it is a different claim
 * from a timeline with nothing on it.
 *
 * ⚠ ADDING THESE FIELDS BREAKS NOTHING AT COMPILE TIME. This function already returned an object, so
 * every existing caller keeps destructuring `.encounters` and keeps being wrong. That trap was walked
 * into once already, with searchPatients, one commit ago -- so all six callers were found by hand and
 * each one had to say what it does with a failure. There is no version of this where the type does the
 * work for you.
 */
export async function patientTimeline(admin: any, workspaceId: string, patientId: string, limit = 20): Promise<{
  encounters: any[];
  diagnosesByEncounter: Record<string, any[]>;
  /** The encounter read failed. `encounters: []` is NOT an answer -- do not render "no history". */
  unavailable: boolean;
  /** The diagnosis read failed. The encounters below are real; their diagnoses are unknown, not absent. */
  diagnosesUnavailable: boolean;
  detail: string | null;
}> {
  const { data: encounters, error: encErr } = await admin.from("practice_encounter")
    .select("id, started_at, status, entry_pathway, reason_for_visit, encounter_mode")
    .eq("workspace_id", workspaceId).eq("patient_id", patientId)
    .order("started_at", { ascending: false }).limit(limit);
  if (encErr) return {
    encounters: [], diagnosesByEncounter: {},
    unavailable: true, diagnosesUnavailable: true, detail: encErr.message,
  };

  const ids = ((encounters ?? []) as any[]).map(e => e.id);
  if (ids.length === 0) return {
    encounters: [], diagnosesByEncounter: {},
    unavailable: false, diagnosesUnavailable: false, detail: null,
  };

  const { data: diags, error: diagErr } = await admin.from("practice_diagnosis")
    .select("encounter_id, label, certainty, is_primary").in("encounter_id", ids);
  const diagnosesByEncounter: Record<string, any[]> = {};
  for (const d of (diags ?? []) as any[]) {
    (diagnosesByEncounter[d.encounter_id] ??= []).push(d);
  }
  return {
    encounters: encounters ?? [],
    diagnosesByEncounter,
    unavailable: false,
    diagnosesUnavailable: !!diagErr,
    detail: diagErr?.message ?? null,
  };
}
