// PW-014 P0 / §8, §14.2 — domain event standards + the transactional-outbox emit helper. Producers (wired in P2)
// call emitDomainEvent() in the same request that mutates a source record; a dispatcher (P2) fans out via Supabase
// Realtime and feeds the activity timeline + reconciliation. Append-only, at-least-once, idempotent by
// (subject_type, subject_id, aggregate_version). Fail-soft until migration 102 (domain_events) is applied.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Versioned event-type namespace (§8 examples). Add new types here so the taxonomy has one source of truth.
export const EVENT = {
  TASK_COMPLETED: "task.completed",
  ASSESSMENT_COMPLETED: "assessment.completed",
  LEARNING_COURSE_COMPLETED: "learning.course.completed",
  STAFFING_APPROVAL_DECIDED: "staffing.approval.decided",
  INCIDENT_CAPA_ASSIGNED: "incident.capa.assigned",
  SHIFT_ASSIGNMENT_CHANGED: "shift.assignment.changed",
  POLICY_ACK_REQUIRED: "policy.acknowledgement.required",
  ENTITLEMENT_REVOKED: "workspace.entitlement.revoked",
  CREDENTIAL_EXPIRY_UPDATED: "credential.expiry.updated",
  BREAK_GLASS_INVOKED: "security.break_glass.invoked",
  COMPETENCY_ASSIGNED: "competency.assigned",       // CDP-001 delivery orchestrator materialised a delivery
  CAMPAIGN_LAUNCHED: "campaign.launched",           // CDP-008 learning campaign broadcast
} as const;
export type EventType = (typeof EVENT)[keyof typeof EVENT] | (string & {});

export type Sensitivity = "public" | "internal" | "operational" | "clinical" | "restricted";

export type DomainEventInput = {
  event_type: EventType;
  subject_type: string;             // aggregate type, e.g. 'competency_decision'
  subject_id?: string | null;       // aggregate id
  aggregate_version?: number | null;// monotonic per aggregate → ordering + idempotency
  tenant_id?: string | null;
  hospital_id?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  sensitivity?: Sensitivity;
  payload?: Record<string, any>;    // minimal — avoid unnecessary sensitive content (§14.2)
  occurred_at?: string;             // ISO; defaults to now() in the DB
  trace_id?: string | null;
};

export type EmitResult = { ok: true; id: string } | { ok: false; reason: "not_provisioned" | "duplicate" | string };

const notProvisioned = (msg: string) => /does not exist|schema cache|relation .* does not exist/i.test(msg);

// Append one event to the outbox. Idempotent: a repeat (subject_type, subject_id, aggregate_version) is a no-op
// duplicate (the unique index rejects it), which callers can treat as success (event already recorded).
export async function emitDomainEvent(admin: any, input: DomainEventInput): Promise<EmitResult> {
  const row = {
    event_type: input.event_type,
    subject_type: input.subject_type,
    subject_id: input.subject_id ?? null,
    aggregate_version: input.aggregate_version ?? null,
    tenant_id: input.tenant_id ?? null,
    hospital_id: input.hospital_id ?? null,
    actor_id: input.actor_id ?? null,
    actor_name: input.actor_name ?? null,
    sensitivity: input.sensitivity ?? "internal",
    payload: input.payload ?? {},
    occurred_at: input.occurred_at ?? undefined,
    trace_id: input.trace_id ?? null,
  };
  try {
    const { data, error } = await admin.from("domain_events").insert(row).select("id").single();
    if (error) {
      if (notProvisioned(error.message ?? "")) return { ok: false, reason: "not_provisioned" };
      if (/duplicate key|unique constraint/i.test(error.message ?? "")) return { ok: false, reason: "duplicate" };
      return { ok: false, reason: error.message ?? "insert_failed" };
    }
    return { ok: true, id: data.id };
  } catch (e: any) {
    return { ok: false, reason: notProvisioned(String(e?.message ?? "")) ? "not_provisioned" : String(e?.message ?? "error") };
  }
}
