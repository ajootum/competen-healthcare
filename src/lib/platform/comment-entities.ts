// PCS Collaboration — the closed set of things a comment may be attached to.
//
// plat_comments is a polymorphic (entity_type, entity_id) primitive. While entity_type was FREE TEXT there was
// no way to resolve which record a comment was about, so every comment took the AUTHOR's hospital — and a
// super_admin's comment (hospitalId null) landed unscoped and surfaced in every tenant's collaboration feed.
//
// This registry closes that: each entity_type declares the table its entity_id points at, which makes the
// comment's tenant resolvable from its subject. Types whose subject has no tenant of its own (platform notes,
// shared master-library content) declare `table: null` and correctly fall back to the author's hospital.
//
// Adding a new commentable type is a deliberate act: add it here (and only here). An unknown entity_type is
// rejected at the API rather than silently written, because a comment nobody can scope is a leak.

export type CommentEntity = {
  /** Table the entity_id references, or null when the subject has no tenant of its own. */
  table: string | null;
  /** Human label for UI and error messages. */
  label: string;
};

export const COMMENT_ENTITIES: Record<string, CommentEntity> = {
  // ── Platform-level: no subject record, so the author's tenant owns the note ──
  platform_note: { table: null, label: "Platform note" },

  // ── Clinical operations ──
  op_patient: { table: "op_patients", label: "Patient" },
  op_incident: { table: "op_incidents", label: "Incident" },
  op_escalation: { table: "op_escalations", label: "Escalation" },
  op_task: { table: "op_tasks", label: "Task" },
  op_shift: { table: "op_shifts", label: "Shift" },
  op_safety_alert: { table: "op_safety_alerts", label: "Safety alert" },

  // ── Quality & governance ──
  audit: { table: "audits", label: "Audit" },
  capa_action: { table: "capa_actions", label: "CAPA action" },
  quality_object: { table: "quality_objects", label: "Quality object" },
  improvement_object: { table: "improvement_objects", label: "Improvement project" },
  gov_risk: { table: "gov_risks", label: "Risk" },
  gov_control: { table: "gov_controls", label: "Control" },

  // ── Competency ──
  framework: { table: "frameworks", label: "Framework" },
  learning_link: { table: "competency_learning_links", label: "Learning link" },
  // change_requests has NO hospital_id column (verified against migration 012), so its tenant is not resolvable
  // from the row — the author's hospital is the honest fallback rather than a lookup that always returns null.
  change_request: { table: null, label: "Change request" },
  // framework_competencies likewise has no hospital_id; tenant is two hops away via domains → frameworks, and
  // null there means the SHARED master library, so a competency comment is not tenant-derivable either.
  competency: { table: null, label: "Competency" },
};

export const isCommentEntity = (t: unknown): t is keyof typeof COMMENT_ENTITIES =>
  typeof t === "string" && Object.prototype.hasOwnProperty.call(COMMENT_ENTITIES, t);

export const COMMENT_ENTITY_TYPES = Object.keys(COMMENT_ENTITIES);
