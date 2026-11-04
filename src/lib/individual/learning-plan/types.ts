// ── THE SHARED LEARNING PLAN CONTRACT ── PLP-01..04 (owner GO 2 Nov 2026), migration 840 ──────────────────────────
//
// Pure types and tiny pure helpers, shared by the Individual experiences. Scholar builds its plan from its own records
// (src/lib/individual/scholar/plan-*.ts) and Professional can map its development plan to the same PlanItem
// (professional-adapter.ts). Neither experience reads the other's items without the learner's permission, and no employer
// reads any of it.
//
// ⚠ NOTHING HERE IS ASSESSMENT. A plan item is a suggestion or a personal choice about time. It is not evidence of competence.
// ⚠ NO AI. Every field is derived by fixed rules from the learner's own records and choices.

export type PlanExperience = "scholar" | "professional";

/** Where a plan item came from. */
export type PlanItemSource =
  | "plan_activity"          // Scholar: an activity of the weekly plan
  | "recommendation"         // Scholar: the next-activity engine
  | "calendar_entry"         // a learner-created calendar entry
  | "professional_activity"  // Professional: a planned activity (480)
  | "professional_goal";     // Professional: a goal with a target date (480)

/**
 * One thing the learner might do, in the words the learner sees. `why` is the reason in their own numbers or choice,
 * `whyNow` the reason it is offered today, `ifPostponed` what happens if it waits.
 */
export type PlanItem = {
  experience: PlanExperience;
  source: PlanItemSource;
  /** Stable within the experience (a plan activity ref, an entry occurrence key, a record id). */
  ref: string;
  title: string;
  /** Null when no duration is known. Never invented. */
  minutes: number | null;
  /** YYYY-MM-DD, or null. */
  due: string | null;
  why: string;
  whyNow: string;
  ifPostponed: string;
  href: string | null;
};

// ── the append-only event log (individual_learning_plan_event) ──
// next_action (migration 975, SALE-2026-11 R3): a next-best-action suggestion accepted, snoozed (deferred) or dismissed (declined).
export const PLAN_EVENT_KINDS = ["proposal", "topic_postponed", "recommendation_declined", "reflection", "settings_change", "auto_adjust", "next_action"] as const;
export type PlanEventKind = (typeof PLAN_EVENT_KINDS)[number];
export const PLAN_EVENT_STATUSES = ["accepted", "declined", "deferred", "applied", "undone"] as const;
export type PlanEventStatus = (typeof PLAN_EVENT_STATUSES)[number];
export const isPlanEventKind = (x: unknown): x is PlanEventKind => typeof x === "string" && (PLAN_EVENT_KINDS as readonly string[]).includes(x);
export const isPlanEventStatus = (x: unknown): x is PlanEventStatus => typeof x === "string" && (PLAN_EVENT_STATUSES as readonly string[]).includes(x);

export type PlanEvent = {
  id: string;
  experience: PlanExperience;
  kind: PlanEventKind;
  ref: string;
  status: PlanEventStatus | null;
  value: Record<string, unknown>;
  createdAt: string;
};
export type NewPlanEvent = { kind: PlanEventKind; ref: string; status?: PlanEventStatus | null; value?: Record<string, unknown> };
export const PLAN_EVENT_LIMITS = { refMax: 200, valueBytes: 8000 } as const;

/** Pure. The newest event for each `ref` (events newest first or in any order). */
export function latestPerRef(events: readonly PlanEvent[]): Map<string, PlanEvent> {
  const out = new Map<string, PlanEvent>();
  for (const e of events) {
    const cur = out.get(e.ref);
    if (!cur || e.createdAt > cur.createdAt || (e.createdAt === cur.createdAt && e.id > cur.id)) out.set(e.ref, e);
  }
  return out;
}

// ── Scholar plan settings, as the learner states them ──
export type GoalType = "learn" | "exam" | "revise";
export const GOAL_TYPES: readonly GoalType[] = ["learn", "exam", "revise"];
export const GOAL_TYPE_LABEL: Record<GoalType, string> = { learn: "Learn consistently", exam: "Prepare for an exam", revise: "Revise what I have learned" };
export type ScholarPlanSettings = {
  /** Null on a plan saved before 840, or while 840 is absent. */
  goalType: GoalType | null;
  /** Minutes in one session. Null when it was never stated (weeklyMinutes / daysPerWeek stands in). */
  sessionMinutes: number | null;
  daysPerWeek: number;
  /** sessionMinutes x daysPerWeek when both were stated. */
  weeklyMinutes: number;
  /** YYYY-MM-DD, or null. Required only for goalType exam. */
  examDate: string | null;
  examLabel: string | null;
  goal: string | null;
  priorities: readonly string[];
};

// ── the learner's own calendar (individual_learning_calendar_entry / _exception) ──
export const ENTRY_TYPES = ["study_session", "exam", "deadline", "placement", "busy", "other"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  study_session: "Study session", exam: "Exam", deadline: "Deadline", placement: "Placement", busy: "Busy", other: "Other",
};
export const LINK_KINDS = ["material", "topic", "competency", "goal", "lesson", "deck"] as const;
export type EntryLinkKind = (typeof LINK_KINDS)[number];
export type EntryLink = { kind: EntryLinkKind; id: string; label: string };
export type Recurrence = {
  freq: "daily" | "weekly";
  /** 1 to 4 days or weeks between occurrences. */
  interval: number;
  /** Weekly only: 0 = Monday ... 6 = Sunday. Empty or absent: the weekday of the first date. */
  byweekday?: number[];
  /** YYYY-MM-DD, inclusive. */
  until?: string | null;
  /** Total occurrences, 1 to 200. */
  count?: number | null;
};
export type EntryStatus = "planned" | "completed" | "cancelled";
export type CalendarEntry = {
  id: string;
  experience: PlanExperience;
  entryType: EntryType;
  title: string;
  description: string | null;
  /** The first date of the series. */
  entryDate: string;
  /** "HH:MM", or null for an all-day entry. */
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  link: EntryLink | null;
  recurrence: Recurrence | null;
  status: EntryStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ExceptionAction = "cancelled" | "moved" | "edited" | "completed";
export type EntryException = {
  entryId: string;
  /** The date the series gave this occurrence. */
  occurrenceDate: string;
  action: ExceptionAction;
  newDate: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
  title: string | null;
  completedAt: string | null;
};
/** One occurrence of an entry on one day, after its exception (if any). */
export type Occurrence = {
  /** `${entryId}@${YYYY-MM-DD}` of the date the SERIES gave it (stable when moved). */
  key: string;
  entryId: string;
  experience: PlanExperience;
  entryType: EntryType;
  title: string;
  description: string | null;
  /** The date it is on now. */
  date: string;
  /** The date the series gave it. */
  occurrenceDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  durationMinutes: number | null;
  link: EntryLink | null;
  status: "planned" | "completed" | "cancelled";
  /** True when the learner marked it completed. Their word, never a record of study. */
  selfReported: boolean;
  moved: boolean;
  edited: boolean;
  recurring: boolean;
};

/** An occurrence key. A Scholar plan activity key is `plan:...`, so the two namespaces cannot collide. */
export const occurrenceKey = (entryId: string, date: string) => `${entryId}@${date}`;
export const OCCURRENCE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@\d{4}-\d{2}-\d{2}$/;
