// ── DEVELOPMENT PLANNING VOCABULARY ── COMPETEN-PROFESSIONAL-PLAN-01, Professional Stage 3, migration 480 ──────────
//
// ⚠ THIS MODULE IMPORTS NOTHING (the constants-file rule). policy.ts, pages, routes, tests and harnesses read it.
//
// ⚠ A PLAN BELONGS TO THE PERSON. Nothing here grades, scores or certifies. Completing an activity never achieves a
// goal, and achieving a goal never verifies competence. No default names a profession, a country, a timeline or a
// compulsory template (owner GO: SMART is offered, never required).

/** 480's goal statuses (373's four plus deferred). Not a sequence: any may follow any, subject to the reopen rule. */
export const GOAL_STATUSES = ["planned", "in_progress", "done", "deferred", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_TEXT: Record<GoalStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Addressed",
  deferred: "Deferred",
  dropped: "Retired",
};
export const isGoalStatus = (v: unknown): v is GoalStatus => typeof v === "string" && (GOAL_STATUSES as readonly string[]).includes(v);
export const goalOpen = (s: string) => s === "planned" || s === "in_progress";

/** 480's activity statuses. Completed needs the record of what happened (a CPD entry or a learning record). */
export const ACTIVITY_STATUSES = ["planned", "active", "completed", "deferred", "cancelled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const ACTIVITY_STATUS_TEXT: Record<ActivityStatus, string> = {
  planned: "Planned",
  active: "Under way",
  completed: "Completed",
  deferred: "Deferred",
  cancelled: "Cancelled",
};
export const isActivityStatus = (v: unknown): v is ActivityStatus => typeof v === "string" && (ACTIVITY_STATUSES as readonly string[]).includes(v);

/** Where a goal came from (480 created_from). One goal record, whatever the source. */
export const GOAL_SOURCES = [
  ["direct", "My own goal"],
  ["need", "A development need"],
  ["competency", "A competency"],
  ["learning", "A learning opportunity"],
  ["aspiration", "A career aspiration"],
  ["reflection", "A reflection"],
  ["evaluation", "An evaluation"],
] as const;
export type GoalSource = (typeof GOAL_SOURCES)[number][0];
export const GOAL_SOURCE_LABEL: Record<string, string> = Object.fromEntries(GOAL_SOURCES);
export const isGoalSource = (v: unknown): v is GoalSource => typeof v === "string" && GOAL_SOURCES.some(([s]) => s === v);

/** Optional goal fields. The description ("What do you want to achieve?") is the only required one. */
export const GOAL_FIELDS = ["type", "motivation", "outcome", "priority", "needs", "competencies", "evidence", "dates", "template"] as const;
export type GoalField = (typeof GOAL_FIELDS)[number];
export const GOAL_FIELD_LABEL: Record<GoalField, string> = {
  type: "Type of goal",
  motivation: "Why it matters to you",
  outcome: "Intended outcome",
  priority: "Priority",
  needs: "Development needs it serves",
  competencies: "Competencies and outcomes",
  evidence: "Evidence you expect",
  dates: "Start, target and review dates",
  template: "A planning template",
};

/** The lightweight review (480 goal_review). Each question is optional. */
export const REVIEW_FIELDS = ["undertaken", "learned", "evidence", "changed", "next"] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];
export const REVIEW_FIELD_LABEL: Record<ReviewField, string> = {
  undertaken: "What have you done so far?",
  learned: "What have you learned?",
  evidence: "What evidence do you have?",
  changed: "What has changed in your practice?",
  next: "What next?",
};
export const REVIEW_COLUMN: Record<ReviewField, string> = {
  undertaken: "undertaken", learned: "learned", evidence: "evidence_note", changed: "changed", next: "next_steps",
};

/** Review decisions (480). The status each one leaves the goal in; null keeps the status as it is. */
export const REVIEW_DECISIONS = ["continue", "revise", "reprioritise", "addressed", "deferred", "retired", "reopened"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const REVIEW_DECISION_LABEL: Record<ReviewDecision, string> = {
  continue: "Keep going",
  revise: "Revise the goal",
  reprioritise: "Change its priority",
  addressed: "I consider it addressed",
  deferred: "Defer it",
  retired: "Retire it",
  reopened: "Reopen it",
};
export const REVIEW_STATUS: Record<ReviewDecision, GoalStatus | null> = {
  continue: null, revise: null, reprioritise: null, addressed: "done", deferred: "deferred", retired: "dropped", reopened: "in_progress",
};

export type Option = { code: string; label: string };

/** Defaults while HQ has published none. Neutral across professions and countries. */
export const DEFAULT_GOAL_TYPES: readonly Option[] = [
  { code: "skill", label: "Develop a skill" },
  { code: "knowledge", label: "Deepen knowledge" },
  { code: "practice", label: "Change something in my practice" },
  { code: "career", label: "A career step" },
  { code: "maintain", label: "Maintain or renew" },
  { code: "teach-lead", label: "Teach, lead or support others" },
];
export const DEFAULT_GOAL_PRIORITIES: readonly Option[] = [
  { code: "high", label: "High" },
  { code: "medium", label: "Medium" },
  { code: "low", label: "Low" },
];
/** Activity kinds (owner GO P2). "competen-course" and the two course kinds can point at the Learning catalogue. */
export const DEFAULT_ACTIVITY_TYPES: readonly Option[] = [
  { code: "competen-course", label: "Competen course" },
  { code: "partner-course", label: "Partner course" },
  { code: "external-course", label: "External course" },
  { code: "workshop", label: "Workshop or conference" },
  { code: "independent-study", label: "Independent study" },
  { code: "mentorship", label: "Mentorship or coaching" },
  { code: "workplace-learning", label: "Learning at work" },
  { code: "clinical-practice", label: "Supervised or clinical practice" },
  { code: "teaching", label: "Teaching others" },
  { code: "research", label: "Research" },
  { code: "quality-improvement", label: "Quality improvement" },
  { code: "reflective-practice", label: "Reflective practice" },
  { code: "other", label: "Other" },
];
export const DEFAULT_MILESTONE_TYPES: readonly Option[] = [
  { code: "checkpoint", label: "Checkpoint" },
  { code: "learning-finished", label: "Learning finished" },
  { code: "evidence-gathered", label: "Evidence gathered" },
  { code: "practice-applied", label: "Applied in practice" },
];
/**
 * Planning templates. A template's label is "Name: first prompt | second prompt | ...", so an administrator can write
 * one in the ordinary option editor. None is compulsory, and a goal is complete without one.
 */
export const DEFAULT_GOAL_TEMPLATES: readonly Option[] = [
  { code: "smart", label: "SMART: Specific | Measurable | Achievable | Relevant | Time-bound" },
  { code: "outcome", label: "Outcome: What will be different | How I will know | What I need" },
];
/** Kinds of evidence a person may expect. Picked as ideas, written into the goal as words. */
export const DEFAULT_EVIDENCE_KINDS: readonly Option[] = [
  { code: "certificate", label: "A certificate or completion record" },
  { code: "cpd-entry", label: "A CPD entry" },
  { code: "feedback", label: "Feedback from a colleague, mentor or learner" },
  { code: "observation", label: "An observation of my practice" },
  { code: "reflection", label: "A reflection" },
  { code: "work-product", label: "Something I produced" },
];

/** Evidence trust classes, as the source records hold them. A plan never raises one. */
export const EVIDENCE_CLASS_TEXT: Record<string, string> = {
  self_declared: "Self-reported",
  source_linked: "Document-supported",
  verified: "Independently verified",
};

/** Every table 480 creates. */
export const PLAN_TABLES = ["individual_professional_goal_history", "individual_professional_activity", "individual_professional_activity_goal",
  "individual_professional_activity_history", "individual_professional_milestone", "individual_professional_plan_competency",
  "individual_professional_goal_evidence", "individual_professional_goal_review"] as const;
