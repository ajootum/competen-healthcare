// ── THE COMPETEN PROFESSIONAL VOCABULARY ── COMPETEN-IND-007, migration 373 ──────────────────────────
//
// The words every Professional surface uses for its own records, in one place, so the CPD page, the
// evidence page, the Passport and the public /verify page cannot describe the same row differently.
//
// ⚠ THIS MODULE IMPORTS NOTHING (the constants-file rule access-doors.ts records). Pages, API routes,
// the unit tests and scripts/individual-professional-harness.ts all read it.
//
// ⚠ TWO EVIDENCE CLASSES, AND NEITHER IS "VERIFIED" (COMPETEN-IND-002 s4.2). Competen Professional
// creates only `self_declared` and `source_linked`. The class is a GENERATED column in migration 373 --
// computed from whether a document is attached -- so the database, not this file, decides it, and no
// writer can store a class the row does not support. institution_issued records are the estate's and
// appear read-only in the Passport. independently_verified needs a checker with authority that does not
// exist yet, so nothing here can produce it.

/** The experience a Professional record is made in -- migration 373's experience_code. */
export const ORIGIN = "professional" as const;

export type OwnEvidenceClass = "self_declared" | "source_linked";
export const OWN_EVIDENCE_CLASSES: readonly OwnEvidenceClass[] = ["self_declared", "source_linked"];

export const isOwnEvidenceClass = (v: unknown): v is OwnEvidenceClass =>
  typeof v === "string" && (OWN_EVIDENCE_CLASSES as readonly string[]).includes(v);

/** What each class does NOT mean, said wherever the class is shown. */
export const OWN_EVIDENCE_DETAIL: Record<OwnEvidenceClass, string> = {
  self_declared: "You recorded this. Nobody has checked it.",
  source_linked: "You recorded this and attached a document. Attaching a document does not verify it.",
};

/** cpd_logs' activity types (migration 001), plus the three its page already shows and cannot store. */
export const CPD_ACTIVITY = [
  ["course", "Formal course"],
  ["workshop", "Workshop"],
  ["conference", "Conference"],
  ["self_study", "Self-directed learning"],
  ["simulation", "Simulation"],
  ["osce", "OSCE practice"],
  ["teaching", "Teaching"],
  ["research", "Research"],
  ["other", "Other"],
] as const;
export type CpdActivity = typeof CPD_ACTIVITY[number][0];
export const CPD_ACTIVITY_LABEL: Record<string, string> = Object.fromEntries(CPD_ACTIVITY);

export const NEED_STATUS = [["open", "Open"], ["met", "Met"], ["closed", "Closed"]] as const;
export type NeedStatus = typeof NEED_STATUS[number][0];
export const NEED_STATUS_LABEL: Record<string, string> = Object.fromEntries(NEED_STATUS);

export const NEED_ORIGIN_LABEL: Record<string, string> = {
  self_identified: "You identified this",
  passport_gap: "Raised from your Passport",
};

export const GOAL_STATUS = [["planned", "Planned"], ["in_progress", "In progress"], ["done", "Done"], ["dropped", "Dropped"]] as const;
export type GoalStatus = typeof GOAL_STATUS[number][0];
export const GOAL_STATUS_LABEL: Record<string, string> = Object.fromEntries(GOAL_STATUS);

export const EVIDENCE_KIND = [["credential", "Credential or registration"], ["competency", "Competency evidence"]] as const;
export type EvidenceKind = typeof EVIDENCE_KIND[number][0];
export const EVIDENCE_KIND_LABEL: Record<string, string> = Object.fromEntries(EVIDENCE_KIND);

/** Migration 373's bucket. Private, server-mediated, no storage policies (migration 336's posture). */
export const DOCUMENT_BUCKET = "individual-professional-evidence";
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

/** Days before a credential or registration expiry when the reminder is sent. */
export const REMINDER_HORIZON_DAYS = 60;

/** Every table migration 373 creates. The harness pins that Professional code writes nothing else. */
export const PROFESSIONAL_TABLES = [
  "individual_professional_profile",
  "individual_professional_need",
  "individual_professional_goal",
  "individual_professional_cpd",
  "individual_professional_evidence",
  "individual_professional_share",
] as const;
