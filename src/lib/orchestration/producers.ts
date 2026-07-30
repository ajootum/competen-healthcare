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

// A worker was deployed onto a shift via a GOVERNED OVERRIDE of the COMP-027 readiness gate (an unresolved
// critical competency failure). This crosses the workspace boundary: the shift supervisor's action must reach
// the Competency Office's remediation loop. Clinical sensitivity (patient-facing deployment). Consumed by the
// delivery event consumer (src/lib/delivery/consumer.ts → handleShiftOverride).
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
