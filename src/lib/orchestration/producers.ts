// PW-014 WS4 / P2 — typed domain-event producers. Thin, standardized wrappers over emitDomainEvent() that source
// write-paths call in-transaction after a successful state change, so the correct subject_type / sensitivity /
// payload are applied consistently. Fire-and-forget + fail-soft: emit failures (incl. outbox not provisioned)
// never break the originating request. Patient-linked work is classified 'clinical' so downstream redaction (§15)
// and deep-link-only execution (§7.1 / PW-AC-08) apply.
import { emitDomainEvent, EVENT } from "./events";
/* eslint-disable @typescript-eslint/no-explicit-any */

export function emitTaskCompleted(admin: any, task: any, actorId: string | null, actorName?: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.TASK_COMPLETED,
    subject_type: "op_task", subject_id: task.id,
    hospital_id: task.hospital_id ?? null,
    actor_id: actorId, actor_name: actorName ?? null,
    sensitivity: task.patient_id ? "clinical" : "operational",
    payload: { assigned_to: task.assigned_to ?? null, priority: task.priority ?? null, patient_id: task.patient_id ?? null },
  });
}

export function emitLearningCompleted(admin: any, enrolment: any, actorId: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.LEARNING_COURSE_COMPLETED,
    subject_type: "learning_enrolment", subject_id: enrolment.id,
    hospital_id: enrolment.hospital_id ?? null,
    actor_id: actorId,
    sensitivity: "internal",
    payload: { course_id: enrolment.course_id ?? null, user_id: enrolment.user_id ?? actorId },
  });
}

export function emitAssessmentCompleted(admin: any, score: any, actorId: string | null, actorName?: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.ASSESSMENT_COMPLETED,
    subject_type: "competency_score", subject_id: score.id,
    hospital_id: score.hospital_id ?? null,
    actor_id: actorId, actor_name: actorName ?? null,
    sensitivity: "internal",
    payload: { cycle_id: score.cycle_id ?? null, validated: true },
  });
}

export function emitApprovalDecided(admin: any, approval: any, actorId: string | null, decision: string) {
  return emitDomainEvent(admin, {
    event_type: EVENT.STAFFING_APPROVAL_DECIDED,
    subject_type: "approval_request", subject_id: approval.id,
    hospital_id: approval.hospital_id ?? null,
    actor_id: actorId,
    sensitivity: "operational",
    payload: { category: approval.category ?? null, decision },
  });
}

// ── HWW-OPS-001 bedside event producers ──────────────────────────────────────
// The operational spine's missing catalogue entries: every bedside act that
// downstream intelligence (shift metrics, quality, competency evidence) feeds
// on. All patient-linked → 'clinical' sensitivity; minimal payloads.

export function emitObservationCompleted(admin: any, obs: any, actorId: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.OBSERVATION_COMPLETED,
    subject_type: "op_observation", subject_id: obs.id,
    hospital_id: obs.hospital_id ?? null,
    actor_id: actorId,
    sensitivity: "clinical",
    payload: { patient_id: obs.patient_id ?? null, observation_type: obs.observation_type ?? null, ews_score: obs.ews_score ?? null, escalated: !!obs.escalation_triggered },
  });
}

export function emitMedicationAdministered(admin: any, event: any, actorId: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.MEDICATION_ADMINISTERED,
    subject_type: "op_med_administration", subject_id: event.id,
    hospital_id: event.hospital_id ?? null,
    actor_id: actorId,
    sensitivity: "clinical",
    payload: { patient_id: event.patient_id ?? null, outcome: event.outcome ?? null, delay_minutes: event.delay_minutes ?? 0, witnessed: !!event.witness_id, escalated: !!event.escalation_id },
  });
}

export function emitEscalationRaised(admin: any, esc: any, actorId: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.ESCALATION_RAISED,
    subject_type: "op_escalation", subject_id: esc.id,
    hospital_id: esc.hospital_id ?? null,
    actor_id: actorId,
    sensitivity: "clinical",
    payload: { patient_id: esc.patient_id ?? null, level: esc.level ?? null, escalation_type: esc.escalation_type ?? null },
  });
}

export function emitConcernRaised(admin: any, concern: any, actorId: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.CONCERN_RAISED,
    subject_type: "op_concern", subject_id: concern.id,
    hospital_id: concern.hospital_id ?? null,
    actor_id: actorId,
    sensitivity: "clinical",
    payload: { patient_id: concern.patient_id ?? null, category: concern.category ?? null, priority: concern.priority ?? null, ward_round: !!concern.ward_round, ss_review: !!concern.ss_review },
  });
}

export function emitHandoverAccepted(admin: any, args: { itemId: string; patientId: string | null; hospitalId: string | null }, actorId: string | null) {
  return emitDomainEvent(admin, {
    event_type: EVENT.HANDOVER_ACCEPTED,
    subject_type: "op_handover_item", subject_id: args.itemId,
    hospital_id: args.hospitalId ?? null,
    actor_id: actorId,
    sensitivity: "clinical",
    payload: { patient_id: args.patientId ?? null },
  });
}

// A worker was deployed onto a shift via a GOVERNED OVERRIDE of the COMP-027 readiness gate (an unresolved
// critical competency failure). This crosses the workspace boundary: the shift supervisor's action must reach
// the Competency Office's remediation loop. Clinical sensitivity (patient-facing deployment). Consumed by the
// delivery event consumer (src/lib/delivery/consumer.ts → handleShiftOverride).
// The SAME governed-override class, from the other gate. Deploying a worker past the readiness gate
// reached the Competency Office; making that worker a patient's responsible clinician with no current
// competency did not -- it notified the nurse and stopped there. One escalated, one silent, for what is
// arguably the more consequential of the two acts.
//
// It emits shift.assignment.changed deliberately, because that is the event the delivery consumer already
// turns into remediation for the worker (it keys on the type and payload.override, not on the subject).
// subject_type stays honest about what actually happened, so the audit trail does not claim a shift
// deployment that never occurred.
export function emitPatientAssignmentOverride(
  admin: any,
  args: { assignmentId: string; patientId: string; staffId: string; hospitalId: string | null; currency: any },
  actorId: string | null,
  actorName?: string | null,
) {
  const cy = args.currency ?? {};
  return emitDomainEvent(admin, {
    event_type: EVENT.SHIFT_ASSIGNMENT_CHANGED,
    subject_type: "op_patient_assignment", subject_id: args.assignmentId,
    hospital_id: args.hospitalId ?? null,
    actor_id: actorId, actor_name: actorName ?? null,
    sensitivity: "clinical",
    payload: {
      patient_id: args.patientId, staff_id: args.staffId, override: true, hospital_id: args.hospitalId ?? null,
      critical_failures: cy.criticalFailures ?? 0, expired_count: cy.expired ?? 0,
      current_passing: cy.currentPassing ?? 0, superseded_passing: cy.supersededPassing ?? 0,
      reason: "Assigned as responsible clinician with no current validated competency (governed override).",
    },
  });
}

export function emitShiftAssignmentChanged(admin: any, args: { shiftId: string; staffId: string; hospitalId: string | null; readiness: any }, actorId: string | null, actorName?: string | null) {
  const r = args.readiness ?? {};
  return emitDomainEvent(admin, {
    event_type: EVENT.SHIFT_ASSIGNMENT_CHANGED,
    subject_type: "op_shift_staff", subject_id: `${args.shiftId}:${args.staffId}`,
    hospital_id: args.hospitalId ?? null,
    actor_id: actorId, actor_name: actorName ?? null,
    sensitivity: "clinical",
    payload: { shift_id: args.shiftId, staff_id: args.staffId, override: true, hospital_id: args.hospitalId ?? null, critical_failures: r.criticalFailures ?? 0, critical_competencies: r.criticalCompetencies ?? [], expired_count: r.expiredCount ?? 0, reason: r.reason ?? null },
  });
}
