// OGS office lifecycle — the shared state model for the write-workflows (constitute / transition /
// appoint / dissolve). Pure constants + helpers so both the API routes and the client UI import the
// same source of truth. No server-only imports.

// 12-state office lifecycle (OGS-001 §lifecycle).
export const OFFICE_STATES = [
  "template", "proposed", "in_design", "pending_approval", "approved",
  "active", "under_review", "suspended", "restructuring", "closing", "dissolved", "archived",
] as const;
export type OfficeState = (typeof OFFICE_STATES)[number];

// States in which the office is operational (is_active = true).
export const ACTIVE_STATES = new Set<OfficeState>(["active", "under_review", "restructuring"]);
export const isActiveState = (s: string) => ACTIVE_STATES.has(s as OfficeState);

// Terminal / non-recoverable states.
export const TERMINAL_STATES = new Set<OfficeState>(["dissolved", "archived"]);

// Allowed forward transitions (governance lifecycle). An admin may move an office only along these edges.
export const TRANSITIONS: Record<OfficeState, OfficeState[]> = {
  template: ["proposed", "archived"],
  proposed: ["in_design", "archived"],
  in_design: ["pending_approval", "archived"],
  pending_approval: ["approved", "in_design", "archived"],
  approved: ["active", "archived"],
  active: ["under_review", "suspended", "restructuring", "closing"],
  under_review: ["active", "suspended", "restructuring", "closing"],
  suspended: ["active", "closing", "archived"],
  restructuring: ["active", "closing"],
  closing: ["dissolved"],
  dissolved: ["archived"],
  archived: [],
};
export const allowedNext = (from: string): OfficeState[] => TRANSITIONS[from as OfficeState] ?? [];
export const canTransition = (from: string, to: string) => allowedNext(from).includes(to as OfficeState);

// Human labels for states.
export const STATE_LABEL: Record<string, string> = {
  template: "Template", proposed: "Proposed", in_design: "In design", pending_approval: "Pending approval",
  approved: "Approved", active: "Active", under_review: "Under review", suspended: "Suspended",
  restructuring: "Restructuring", closing: "Closing", dissolved: "Dissolved", archived: "Archived",
};

export const OFFICE_TYPES = ["competency", "quality", "hr", "education", "research", "executive", "governance", "ethics", "infection_prevention", "pharmacy", "medical_staff", "finance", "custom"] as const;
export const SCOPE_TYPES = ["enterprise", "country", "organisation", "hospital", "department", "specialty"] as const;
export const APPOINTMENT_ROLES = ["chair", "deputy_chair", "secretary", "governance_lead", "member", "reviewer", "observer", "external_adviser"] as const;

/**
 * Which appointment statuses actually GRANT ACCESS.
 *
 * ⚠ AN ALLOWLIST, BECAUSE THE DENYLIST IT REPLACES LET A SUSPENDED PERSON THROUGH.
 *
 * Both access checks used to read `status !== "removed" && status !== "expired"`, which admits every status
 * nobody thought to name -- including `suspended`, the one a governance lead sets precisely BECAUSE they want
 * somebody's access to stop. It also admitted `nominated`, which is a proposal rather than an appointment.
 * An allowlist fails the other way: a status nobody has thought of yet grants nothing until somebody decides
 * it should.
 *
 * ⚠ THIS IS THE ACCESS QUESTION ONLY, NOT THE ROSTER QUESTION. A suspended member must still be VISIBLE in
 * their office's membership list -- suspension is a fact about a named person that the office needs to see.
 * resolveOffices keeps listing them; only the viewer-role lookup and the HQ resolver consult this.
 */
export const ACCESS_GRANTING_STATUSES = ["active"] as const;
export const appointmentGrantsAccess = (status: string | null | undefined): boolean =>
  (ACCESS_GRANTING_STATUSES as readonly string[]).includes(String(status ?? ""));
export const APPOINTMENT_ROLE_LABEL: Record<string, string> = {
  chair: "Chair", deputy_chair: "Deputy Chair", secretary: "Secretary", governance_lead: "Governance Lead",
  member: "Member", reviewer: "Reviewer", observer: "Observer", external_adviser: "External Adviser",
};
