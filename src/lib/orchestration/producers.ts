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
