// PW-014 P0 / §7, §7.1 — the versioned Universal Action contract. The normalized shape every functional
// workspace maps its actionable items to, so the Personal Workspace can aggregate work while each source stays
// the system of record (§7 "no duplication rule" — this is a projection + navigation metadata, not a second
// editable record). Producers (task-centre, notification derivations, workspace integrations) emit this shape;
// consumers (dashboard widgets, the execute endpoint) read it. Bump ACTION_SCHEMA_VERSION on breaking changes.

export const ACTION_SCHEMA_VERSION = 1;

export type ActionType = "review" | "approve" | "complete" | "acknowledge" | "sign" | "validate" | "escalate" | "attend" | "respond";
export type ActionPriority = "high" | "medium" | "low";
export type ActionStatus = "open" | "in_progress" | "blocked" | "completed" | "cancelled" | "expired";
export type Sensitivity = "public" | "internal" | "operational" | "clinical" | "restricted";
// How the source declares an action may be actioned (§7.1) — governs direct-execute vs deep-link-only.
export type ExecutionMode = "direct" | "deep_link" | "bulk";

export type UniversalAction = {
  schema_version: number;
  action_id: string;                 // global immutable id (prefix by source, e.g. 'task:<uuid>')
  source_workspace: string;          // registry key, e.g. 'personal' | 'workspace:unit-manager'
  source_object_type: string;        // e.g. 'op_task', 'competency_decision', 'learning_enrolment'
  source_object_id: string | null;   // traceability to the source record
  title: string;
  summary: string | null;
  action_type: ActionType;
  priority: ActionPriority;
  severity: string | null;           // source-native severity preserved alongside normalized priority
  due_at: string | null;             // ISO, with tz
  assignee: string;                  // user id / role / team / queue
  deep_link: string;                 // authorized route into the exact source context
  status: ActionStatus;
  clinical_sensitivity: Sensitivity; // controls redaction + access behaviour (§15)
  execution: ExecutionMode;          // §7.1 — direct completion vs deep-link vs bulk
  version: number;                   // optimistic concurrency / event ordering (source aggregate version)
  tags: string[];
};

// Fill defaults + stamp the schema version. Producers pass what they know; everything else defaults safely
// (deep-link execution, internal sensitivity, open status) — the safe-by-default posture PW-014 §15 requires.
export function normalizeAction(a: Partial<UniversalAction> & Pick<UniversalAction, "action_id" | "source_workspace" | "source_object_type" | "title" | "deep_link">): UniversalAction {
  return {
    schema_version: ACTION_SCHEMA_VERSION,
    action_id: a.action_id,
    source_workspace: a.source_workspace,
    source_object_type: a.source_object_type,
    source_object_id: a.source_object_id ?? null,
    title: a.title,
    summary: a.summary ?? null,
    action_type: a.action_type ?? "review",
    priority: a.priority ?? "medium",
    severity: a.severity ?? null,
    due_at: a.due_at ?? null,
    assignee: a.assignee ?? "",
    deep_link: a.deep_link,
    status: a.status ?? "open",
    clinical_sensitivity: a.clinical_sensitivity ?? "internal",
    execution: a.execution ?? "deep_link",
    version: a.version ?? 0,
    tags: a.tags ?? [],
  };
}

// Whether an action may be completed directly in the Personal Workspace vs requiring deep-link execution in the
// source (§7.1). Clinical-sensitivity + non-'direct' execution force deep-link — the safe path.
export function isDirectlyExecutable(a: UniversalAction): boolean {
  return a.execution === "direct" && a.clinical_sensitivity !== "clinical" && a.clinical_sensitivity !== "restricted";
}
