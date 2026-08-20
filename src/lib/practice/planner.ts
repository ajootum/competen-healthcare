import type { WorkspaceContext } from "@/lib/practice/access";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import { activityState } from "@/lib/practice/activity";
import { practiceToday, zonedDayRange, zoneOffsetMinutes } from "@/lib/practice/practice-time";
import { audit } from "@/lib/practice/audit";
import type { EventSource } from "@/lib/practice/events";
import {
  TRAVEL_BASIS_NOTE, WEEKDAY_NAME, WEEKDAY_SHORT, PLANNER_STATE_LABEL,
  APPOINTMENT_STATUSES_BOOKED, APPOINTMENT_STATUS_LABEL, APPOINTMENT_TYPE_LABEL,
  CAPACITY_BASIS_NOTE, SLOT_KIND_LABEL,
  addDaysIso, daysBetweenIso, PERIOD_DAY_CAP, DUPLICATE_DATE_CAP,
  appointmentOutcome, OUTCOME_LABEL, ENCOUNTER_RANK,
  type AppointmentOutcome, type PlannerPeriod,
} from "@/lib/practice/planner-constants";
import { EXCEPTION_KINDS } from "@/lib/practice/schedule-exception-constants";
import { occursOn, readRecurrence } from "@/lib/practice/recurrence";
import { MISSING_COLUMN_CODES, RECURRENCE_COLUMNS } from "@/lib/practice/availability-config";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-005 PRACTICE PLANNER -- the week, the actions on a block, and the rules that refuse a bad one.
// Migration 236.
//
// s1: "Replace the traditional appointment calendar with a Practice Planner. Activities -- not
// appointments -- are the primary planning object." That object is practice_activity (migration 232) and
// it is already the source of Current Activity and Current Session, which is s10's last acceptance
// criterion and the reason this module adds no second table. What did not exist was the WEEK: everything
// in this build reads one day at a time, so "all seven days always visible" had nothing behind it.
//
// ---- WHAT THIS MODULE OWNS AND WHAT IT DELIBERATELY DOES NOT --------------------------------------
//
//   activity.ts            plan / start / pause / resume / end. The LIFECYCLE of one block.
//   availability-config.ts the WEEKLY TEMPLATE -- the normal week, its exceptions and slot generation.
//   planner.ts (here)      the SEVEN-DAY READ, and s5's rewrites of a block that is already planned.
//
// The split matters most at s6 ("Template vs Operational Reality"). The template is read here and never
// written here: "Permanently Update Template" is editSession() in availability-config.ts, one call away,
// and a planner that quietly rewrote the regular week when somebody dragged a Tuesday clinic would
// change every future Tuesday on the strength of one afternoon.
//
// ---- THE OVERLAP RULE IS BORROWED, NOT REINVENTED --------------------------------------------------
//
// sessionConflict() in availability-config.ts already solves this exact shape for the template, and its
// header records that CPR-SET-002 shipped a bug by only refusing overlaps at the SAME location: a real
// practice ended up with 09:00-13:00 at Aga Khan and 09:00-13:00 at TMR International on one Tuesday,
// both accepted, because "different places may legitimately overlap". Nobody is in two places at one
// time. activityConflict() below applies the same two tests -- overlap regardless of place, then the
// destination's travel buffer between places -- to the DAY rather than to the weekday.
//
// A second overlap predicate written slightly differently is how one screen comes to accept what another
// refuses, so there is exactly one: `overlaps()`.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export {
  PLANNER_ACTIONS, PLANNER_QUICK_ACTIONS, PLANNER_WEEKDAYS, PLANNER_STATE_LABEL,
  WEEKDAY_NAME, WEEKDAY_SHORT, TRAVEL_BASIS_LABEL, TRAVEL_BASIS_NOTE, CONFLICT_LABEL,
  type PlannerActionKey,
  // CP-PLAN-002's navigator and content controls. Re-exported so a server caller has one import and
  // nothing anywhere ends up with a second definition of "what does Next month mean".
  PLANNER_VIEWS, PLANNER_QUICK_PERIODS, PLANNER_SHOW_OPTIONS,
  APPOINTMENT_TYPE_LABEL, APPOINTMENT_STATUS_LABEL, SLOT_KIND_LABEL,
  APPOINTMENT_STATUSES_BOOKED, APPOINTMENT_STATUSES_VOID,
  CAPACITY_BASIS_LABEL, CAPACITY_BASIS_NOTE,
  plannerPeriod, plannerPeriodLabel, shiftPlannerPeriod, quickPeriodTarget, isPlannerView,
  // The practice owner's "and what HAPPENED on that day". The rule is pure and lives with the other
  // screen-facing constants; see WHAT_HAPPENED_LIMITS for what this product cannot answer.
  appointmentOutcome, OUTCOME_LABEL, WHAT_HAPPENED_LIMITS, DUPLICATE_DATE_CAP,
  type AppointmentOutcome,
  type PlannerView, type PlannerPeriod, type PlannerShowKey,
} from "@/lib/practice/planner-constants";

/**
 * WHAT THIS ENGINE WILL NOT DO, stated where the code is rather than in a document nobody opens.
 * Each is a refusal a screen can render, not a silent no-op.
 */
export const PLANNER_REFUSES = [
  "Report a MEASURED travel time. The design comp shows '2h 45m Travel Time' on the week and '20m " +
    "travel' on a day, in the typography of something calculated. The only travel figure this product " +
    "holds is practice_location.travel_buffer_minutes -- a number the practitioner typed. Those typed " +
    "buffers are summed and the payload says so (`basis: typed_buffer`, `measured: false`), because a " +
    "practitioner who thinks a route was computed will trust it against their own judgement.",
  "Store or edit a TARGET for a day. The comp puts 'Edit targets' on the Day Summary. Nothing in this " +
    "product stores a target for a practitioner's day, and a number invented here would be rendered " +
    "back to them as their own professional standard.",
  "Make AI planning RECOMMENDATIONS -- 'Travel time is optimal', 'Consider moving 1 patient to the " +
    "12:20 slot'. s7 itself marks AI planning recommendations as a future capability. Conflict " +
    "detection and travel-time validation are here because they are RULES: they answer whether the " +
    "buffer the practitioner typed fits between two blocks, which is arithmetic, not advice.",
  "Treat a `leave` or `travel` block as time off the workload. Migration 237 made both real activity " +
    "types, and this engine counts every planned block in `plannedMinutes` -- including them. That is " +
    "arithmetic, not a policy: whether a week of leave is a light week or no week at all is the " +
    "practice's judgement, so `byType` reports the split and nothing here decides it.",
  "Write the weekly template. Dragging Tuesday's clinic moves TUESDAY. 'Permanently Update Template' " +
    "(s6) is editSession() in availability-config.ts and is a separate, deliberate act -- a planner that " +
    "rewrote the regular week from one afternoon would change every future Tuesday silently.",
  "Cancel an activity that has already started. It happened. End it instead -- and migration 236's " +
    "practice_activity_cancel_before_start says the same thing to any caller that forgets.",
  "Move, split or relocate an activity that has already started. The plan is what was intended and the " +
    "timestamps are what happened, and encounters recorded during a running activity inherit it as " +
    "their context -- relocating it would move a clinical record's setting after the fact.",
  "Delete anything. CPR-CORE-001 s13: deleted records are voided or superseded, never physically " +
    "removed. A cancelled block stays on the week, struck through, with who cancelled it and when.",
  "Infer that a patient WAS SEEN, or that they DID NOT ATTEND, from the fact that a date has passed. " +
    "The practice owner asked to see 'what happened on that day', and what happened is read from a " +
    "recorded arrival, a recorded encounter or a status somebody set. A past appointment nobody touched " +
    "reads as 'nothing was recorded' -- because that is the only true thing this product knows about " +
    "it, and either of the other two would be a clinical claim no human made. WHAT_HAPPENED_LIMITS " +
    "states the rest of the gap on the payload rather than in a document nobody opens.",
];

// ⚠ THESE MUST BE CAPABILITY CODES THAT ACTUALLY EXIST. A capability code is a STRING COMPARED AGAINST
// practice_role_capabilities. Inventing a plausible one costs nothing at compile time and returns 403 at
// runtime for every user including the practice owner -- so the screen hides the control rather than
// showing an error, and the feature is simply unreachable. Four invented codes have shipped here.
//
// Read out of the migrations rather than remembered: `appointment.manage` is migration 192 and
// `practice.calendar.view` is migration 191.
//
// ⚠ CAN_VIEW WAS `practice.home.view`, AND THAT WAS WIDER THAN THE ONLY SCREEN THAT CALLS THIS.
// /practice/calendar gates itself on `practice.calendar.view`, so two codes governed one read and they
// disagreed in both directions:
//
//   - a role holding practice.calendar.view WITHOUT practice.home.view passes the page gate and gets
//     seven unavailable days -- a screen that renders as broken rather than as refused;
//   - a role holding practice.home.view WITHOUT practice.calendar.view is refused by the page and would
//     be SERVED BY THIS ENGINE through any other door.
//
// The second decided it. plannerRange reads practice_appointment selecting `patient_id, patient_name`,
// so this function returns NAMED PATIENTS. Migration 191 grants practice.home.view to billing_reporting
// and read_only_auditor and deliberately withholds practice.calendar.view from both -- its own comment
// says clinical capabilities come from the practitioner role, so workspace administration does not carry
// clinical access. Gating a named-patient read on the administrative code contradicted that, and the
// only thing keeping it theoretical is that this engine currently has exactly one caller.
//
// NOTHING ANY SHIPPED ROLE CAN REACH TODAY CHANGES. That one caller already requires
// practice.calendar.view, and provisioning gives the founding practitioner BOTH memberships
// (provisioning.ts line 274), so an owner who is also a clinician holds it. A practice_owner who is NOT
// a clinician could not open the calendar before this change and cannot now.
//
// The old comment argued these were "the pair activity.ts and migration 235 gate this same lifecycle
// on". That holds for CAN_PLAN, and it holds for activity.ts's own reads -- Today's Timeline lives on
// /practice/home and is gated there. It never held for the planner's read, which is the calendar's.
const CAN_PLAN = "appointment.manage";
const CAN_VIEW = "practice.calendar.view";

/** Exported so a harness can prove each one EXISTS, against these constants and never a re-typed list. */
export const PLANNER_CAPABILITIES = [CAN_PLAN, CAN_VIEW];

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

type Refusal = { ok: false; status: number; code: string; message: string };

// ── SHAPES ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * planned / running / done / CANCELLED.
 *
 * The fourth is derived from cancelled_at exactly as the first three are derived from started_at and
 * ended_at -- migration 236 followed 232's refusal of a status column for the same reason. A stored
 * status and a clock disagree the moment nobody clicks anything.
 */
export type PlannerActivityState = "planned" | "running" | "done" | "cancelled";

/**
 * A block on the week.
 *
 * NOT `PlannedActivity` FROM activity.ts, and the duplication is deliberate rather than lazy. That type
 * is the shape Today's Timeline reads and it has no cancellation, no notes and no lineage, because
 * migration 236 added those after it. Widening it would change a type five screens already render.
 * Named differently so nobody can pass one where the other is meant and lose the cancellation silently.
 */
export type PlannerActivity = {
  id: string;
  activityType: ActivityType;
  label: string;
  title: string;
  room: string | null;
  facilityId: string | null;
  facilityName: string | null;
  locationId: string | null;
  locationName: string | null;
  planDate: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
  plannedMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  /** Set when this block was copied from another. s5's Duplicate. */
  duplicatedFromId: string | null;
  /** Set on the SECOND half of a split. s5's Split. */
  splitFromId: string | null;
  state: PlannerActivityState;
};

/** Where the practitioner is, in clock order. Consecutive blocks at one place are one visit. */
export type DayLocationBlock = {
  locationId: string;
  name: string;
  facilityName: string | null;
  firstStartMinute: number;
  lastEndMinute: number;
  activityCount: number;
  /** The buffer the practitioner typed for getting HERE. Not a distance. */
  travelBufferMinutes: number;
};

export type TravelHop = {
  fromName: string;
  toName: string;
  /** Clock minutes actually left between the two blocks. Negative when they overlap. */
  gapMinutes: number;
  /** The destination's typed buffer. Whose number this is, is the whole point. */
  neededMinutes: number;
  sufficient: boolean;
};

/**
 * s7's "travel-time validation between locations", and the comp's travel figure.
 *
 * ⚠ `measured` IS ALWAYS FALSE AND IS IN THE PAYLOAD ON PURPOSE. See PLANNER_REFUSES and
 * TRAVEL_BASIS_NOTE. A screen that renders `bufferMinutes` without the basis is rendering a claim this
 * product cannot support.
 */
export type DayTravel = {
  bufferMinutes: number;
  basis: "typed_buffer";
  measured: false;
  note: string;
  hops: TravelHop[];
  /** The hops that do not fit. This is the validation, and it is a rule rather than a recommendation. */
  shortfalls: TravelHop[];
};

export type DayWorkload = {
  activityCount: number;
  cancelledCount: number;
  /**
   * Sum of every block's window. Exceeds `committedMinutes` exactly when blocks overlap.
   *
   * ⚠ THIS COUNTS `leave` AND `travel` TOO (migration 237's types). Deducting them here would be this
   * engine deciding that a week off is not a week, which is the practice's call and not arithmetic --
   * so the total is total, and `byType` is where a screen separates them.
   */
  plannedMinutes: number;
  /** The union of the windows: the time of day actually spoken for, counted once. */
  committedMinutes: number;
  /** First start to last end. Null on a day with nothing on it, which is not the same as nought. */
  spanMinutes: number | null;
  firstStartMinute: number | null;
  lastEndMinute: number | null;
  /** Unspoken-for minutes inside the span. */
  gapMinutes: number;
  byType: { activityType: string; label: string; count: number; minutes: number }[];
  /** Blocks with no location at all. A telephone review legitimately has none. */
  unassignedCount: number;
};

export type DayConflict = {
  code: "ACTIVITY_OVERLAP" | "ACTIVITY_TRAVEL_CONFLICT" | "SCHEDULE_OVERRIDE_CONFLICT";
  message: string;
  activityIds: string[];
  /** CP-PLAN-002 s7's conflict state names PATIENTS, not blocks. Empty on the two activity codes. */
  appointmentIds?: string[];
};

/** One session of the regular week, shown beside what is actually planned. s6. */
export type TemplateSession = {
  id: string;
  startsMinute: number;
  endsMinute: number;
  locationId: string | null;
  locationName: string | null;
  slotKind: string;
  note: string | null;
  /** True when something planned actually covers this window. False is s6's "override". */
  coveredByPlan: boolean;
  /**
   * True when the diary actually holds generated times for this window on this date.
   *
   * ⚠ THIS IS WHY A MONTH CELL MAY SHOW A SESSION WITH NO FREE COUNT. The regular week says "Tuesday
   * clinic"; the availability generator is what turns that into bookable time. A session nobody has
   * generated has a REAL window and NO free time, and printing "0 free" for it would be a claim that the
   * clinic is full when in truth it is not open for booking at all.
   */
  generated: boolean;
};

// ── CP-PLAN-002: THE SCHEDULE ITSELF -- APPOINTMENTS, SESSIONS AND CAPACITY ──────────────────────────
//
// ⚠ NOT A SECOND SCHEDULING SYSTEM, AND s8 IS EXPLICIT ABOUT IT: "These are different views/workflows
// over shared scheduling data. Do not create independent appointment stores for each surface." Every
// field below is read from practice_appointment (migration 192), practice_availability_slot (192, 227,
// 230) and practice_availability_exception (230, 242) -- the same three tables the appointment book on
// this route, the patient booking engine and the availability generator all read. This module adds no
// table and writes none of them.

export type PlannerAppointment = {
  id: string;
  patientId: string | null;
  patientName: string;
  appointmentType: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  /** Practice-local minutes from midnight, so an appointment and an activity are on one clock. */
  startMinute: number;
  endMinute: number;
  minutes: number;
  locationId: string | null;
  locationName: string | null;
  /** The availability slot it was booked into, when it was booked into one. */
  sessionId: string | null;
  reason: string | null;
  /** CANCELLED or NO_SHOW: on the schedule, struck through, out of every count. */
  voided: boolean;
  isWalkIn: boolean;
  isFollowUp: boolean;
  /** Where the patient record is, or null for a booking that is a name and nothing else. */
  href: string | null;

  // ---- WHAT HAPPENED. Every field below is a RECORDED fact or a null. ----
  /** When the patient was actually checked in. Null means no arrival was recorded, not that they were late. */
  arrivedAtIso: string | null;
  arrivedMinute: number | null;
  encounterId: string | null;
  encounterStatus: string | null;
  encounterHref: string | null;
  outcome: AppointmentOutcome;
  outcomeLabel: string;
};

/**
 * s7's capacity summary for one session.
 *
 * ⚠ `available` IS NULLABLE AND THE NULL IS THE POINT. s6 asks for booked and available counts "WHERE
 * CALCULABLE", and on a session with no generated times there is nothing to calculate -- so this says so
 * rather than printing a nought that reads as "full".
 *
 * ⚠ AND THE FIGURE IS THE PRACTITIONER'S OWN DIARY, NOT A PATIENT'S OFFER. See CAPACITY_BASIS_NOTE.
 */
export type SessionCapacity = {
  /** The practice's configured appointment length -- defaultAppointmentMinutes, the same call the
   *  booking engine subdivides sessions with. */
  appointmentMinutes: number;
  /** How many appointment-length steps fit in the window. Null when the session has no generated time. */
  slots: number | null;
  booked: number;
  available: number | null;
  /** Time that exists and is not for seeing patients: BLOCKED/CLOSED, or a leave/blocked/admin kind. */
  blocked: boolean;
  basis: "session_divided_by_appointment_length";
  note: string;
  /** Said in words when `available` is null, so a screen never has to invent the reason. */
  availableUnknownReason: string | null;
};

/** One session on a day: a generated availability slot, or a program session nobody has generated yet. */
export type PlannerSession = {
  /** The availability slot's id, or the program session's template id. Unique either way. */
  id: string;
  source: "generated" | "program";
  templateId: string | null;
  startMinute: number;
  endMinute: number;
  slotKind: string;
  slotKindLabel: string;
  /** OPEN / RESERVED / BLOCKED / CLOSED from the slot, or PLANNED for a program session. */
  status: string;
  locationId: string | null;
  locationName: string | null;
  note: string | null;
  /** Every figure is the length of a list you can open: these are the ids behind `capacity.booked`. */
  appointmentIds: string[];
  capacity: SessionCapacity;
  /** #17: true when today's planned activity ran past the template's end and this strip wears the
   *  plan's hours -- so the screen can say WHY the window is longer than the regular week's. */
  extendedByPlan?: boolean;
};

/** A date the regular week does not describe: leave, a closure, an extra session, a location change. */
export type DayException = {
  id: string;
  kind: string;
  kindLabel: string;
  /** `removes`, `adds` or `reshapes`, straight off EXCEPTION_KINDS. */
  effect: string;
  reason: string | null;
  startMinute: number | null;
  endMinute: number | null;
  locationId: string | null;
};

/**
 * ⚠ WHAT HAPPENED ON A DAY, counted from recorded facts. See WHAT_HAPPENED_LIMITS.
 *
 * `notRecorded` is the number a practice should look at first, and it is why this shape exists: it is
 * the count of bookings whose day has passed and whose outcome nobody wrote down. A summary that folded
 * those into "did not attend" would look tidier and would be an accusation.
 */
export type DayOutcomes = {
  seen: number;
  consultationStarted: number;
  markedComplete: number;
  arrived: number;
  didNotAttend: number;
  cancelled: number;
  expected: number;
  notRecorded: number;
  /** Activities that actually ran, and the ones that were planned and never started. */
  activitiesRan: number;
  activitiesNotStarted: number;
  /** True once the day is over, so a screen knows whether "nothing recorded yet" is a gap or a normal state. */
  isPast: boolean;
};

export type DayCapacity = {
  sessionCount: number;
  /** Summed over the sessions that have generated times. Null when none of them do. */
  slots: number | null;
  booked: number;
  available: number | null;
  /** Sessions whose free time could not be worked out, and why, in one number a screen can name. */
  sessionsNotGenerated: number;
  bookedMinutes: number;
  blockedMinutes: number;
};

export type PlannerDay = {
  date: string;
  weekday: number;
  weekdayName: string;
  weekdayShort: string;
  isToday: boolean;
  isPast: boolean;
  activities: PlannerActivity[];
  locations: DayLocationBlock[];
  travel: DayTravel;
  conflicts: DayConflict[];
  templateSessions: TemplateSession[];
  /** Null when the day could not be read. Never a zeroed summary of a day nobody looked at. */
  workload: DayWorkload | null;
  unavailable: boolean;

  // ---- CP-PLAN-002. The same day, seen as a SCHEDULE rather than only as a plan. ----
  sessions: PlannerSession[];
  appointments: PlannerAppointment[];
  exceptions: DayException[];
  /** Null when the day holds no session at all -- see DAY_OFF_LABEL and `dayOff` below. */
  capacity: DayCapacity | null;
  /**
   * What is recorded to have HAPPENED on this day. Null when the day could not be read -- never a set of
   * zeroes, which would read as a day on which nothing occurred.
   */
  happened: DayOutcomes | null;
  /** True when the practitioner program says anything about this date. */
  hasProgram: boolean;
  /**
   * ⚠ THREE STATES, NOT TWO. `dayOff` is a day the program does not cover and nothing was planned onto.
   * It is NOT the same as `unavailable` (the day could not be read) and it is NOT a record -- s6:
   * "Day off/no program should be visually distinct WITHOUT CREATING AN APPOINTMENT-LIKE RECORD", so
   * this is a boolean a cell can style and never a row a list can contain.
   */
  dayOff: boolean;
};

export type WeekWorkload = {
  activityCount: number;
  cancelledCount: number;
  plannedMinutes: number;
  committedMinutes: number;
  daysWithActivities: number;
  conflictCount: number;
  travelShortfallCount: number;
  /** Summed typed buffers across the week. The comp's "2h 45m". Typed, never measured. */
  travelBufferMinutes: number;
  travelBasis: "typed_buffer";
  travelMeasured: false;
  byType: { activityType: string; label: string; count: number; minutes: number }[];
  locationCount: number;

  // ---- CP-PLAN-002. The schedule half of the same total. ----
  /** Appointments that occupy their time -- APPOINTMENT_STATUSES_BOOKED. */
  appointmentCount: number;
  /** CANCELLED and NO_SHOW. Shown, never counted as booked. */
  voidAppointmentCount: number;
  sessionCount: number;
  /** Free appointment-length steps, summed over sessions where it is calculable. Null when none are. */
  availableCount: number | null;
  sessionsNotGenerated: number;
};

export type PlannerWeek = {
  timezone: string;
  todayDate: string;
  /** The first and last day this payload describes. For a week these are the Monday and the Sunday. */
  fromDate: string;
  toDate: string;
  weekStartDate: string;
  weekEndDate: string;
  /** ALWAYS seven for a week. s2: "all seven days always visible". A day with nothing on it is a day
   *  with nothing on it, and it is a row -- not an absent one a screen has to invent. Over an arbitrary
   *  range this is one entry per day between fromDate and toDate, inclusive, with no gaps. */
  days: PlannerDay[];
  workload: WeekWorkload | null;
  /** True when the week could not be read, so a screen says so instead of drawing an empty week. */
  unavailable: boolean;
  /** The database's own words when a read failed. Null when everything succeeded. Never discarded. */
  detail: string | null;
  /** True when the week held more blocks than the cap below. Named rather than silently truncated. */
  truncated: boolean;
  /** True when the period asked for was longer than RANGE_DAY_CAP and was cut. Named, never silent. */
  rangeCapped: boolean;
  /**
   * The colour each clinic CHOSE in Practice Setup (practice_location.color_slot, migration 290),
   * keyed by location id. Only locations with a choice appear; the views hash the rest. One map on the
   * payload rather than a field on every session, so all four views resolve a hue the same way.
   */
  locationColors: Record<string, string>;
};

/**
 * The same payload, named for what it actually is once the planner stopped being a week.
 *
 * ⚠ ONE TYPE AND ONE COMPUTATION FOR ALL FOUR VIEWS. Day, Week, Month and Agenda differ only in which
 * days plannerPeriod() asks for and in how a component draws them. A second read for the month grid is
 * how a month cell comes to say "8 booked" over a day view that lists seven.
 */
export type PlannerRange = PlannerWeek;

// ── SMALL PURE HELPERS ───────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (d: unknown): d is string =>
  typeof d === "string" && ISO_DATE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/**
 * THE ONE OVERLAP PREDICATE. Half-open on both sides, so a block ending at 13:00 and one starting at
 * 13:00 do not overlap -- which is the arrangement a practitioner means by "back to back", and the same
 * comparison sessionConflict() makes on the template.
 */
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && aEnd > bStart;

/** Noon-anchored, so a date never slips a day when it is parsed. 1 is Monday, 7 is Sunday. */
export const isoWeekday = (dateIso: string) =>
  (((new Date(`${dateIso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);

/** The Monday of the week containing this date. */
export function weekStartDate(dateIso: string): string {
  const noon = Date.parse(`${dateIso}T12:00:00Z`);
  return new Date(noon - (isoWeekday(dateIso) - 1) * 86400000).toISOString().slice(0, 10);
}

const addDays = (dateIso: string, n: number) =>
  new Date(Date.parse(`${dateIso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Minutes of the day actually spoken for, counting overlapping blocks once. */
function unionMinutes(windows: { s: number; e: number }[]): number {
  if (windows.length === 0) return 0;
  const sorted = [...windows].sort((a, b) => a.s - b.s);
  let total = 0, curS = sorted[0].s, curE = sorted[0].e;
  for (const w of sorted.slice(1)) {
    if (w.s > curE) { total += curE - curS; curS = w.s; curE = w.e; }
    else if (w.e > curE) curE = w.e;
  }
  return total + (curE - curS);
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m) % 60).padStart(2, "0")}`;

/**
 * Every column the planner reads or rewrites.
 *
 * ⚠ THE MIGRATION-236 COLUMNS ARE IN THE SELECT ON PURPOSE. Against an unapplied migration PostgREST
 * refuses the whole query by name, the read reports `unavailable` and the write reports READ_FAILED --
 * which is the correct outcome, and is the one thing a silent fallback to the old column list could not
 * give. A planner that quietly dropped `cancelled_at` would draw cancelled clinics as live ones.
 */
const PLANNER_COLUMNS =
  "id, activity_type, title, room, plan_date, planned_start_minute, planned_end_minute, " +
  "started_at, ended_at, cancelled_at, cancelled_by, cancellation_reason, notes, " +
  "duplicated_from_id, split_from_id, facility_id, location_id";

/**
 * PostgREST answers an unbounded select with at most 1000 rows AND NO INDICATION THAT IT DID. A week
 * belonging to one practitioner will not reach this, but "will not" is a belief about the data and the
 * cap is a property of the transport, so it is asked for explicitly and the overflow is REPORTED.
 *
 * ⚠ THIS IS NOW THE WRITE PATH'S CAP ONLY. activityConflict reads ONE day and 500 blocks on one day is
 * already absurd. The range read uses SCHEDULE_ROW_CAP, which is sized for up to 120 days.
 */
const WEEK_ROW_CAP = 500;

function shape(row: any, locById: Map<string, any>, facilityById: Map<string, any>): PlannerActivity {
  const loc = row.location_id ? locById.get(row.location_id) : null;
  const fac = row.facility_id ? facilityById.get(row.facility_id) : null;
  return {
    id: row.id,
    activityType: row.activity_type,
    label: ACTIVITY_LABEL[row.activity_type as ActivityType] ?? row.activity_type,
    title: row.title,
    room: row.room ?? null,
    facilityId: row.facility_id ?? null,
    facilityName: fac?.name ?? null,
    locationId: row.location_id ?? null,
    locationName: loc?.name ?? null,
    planDate: row.plan_date,
    plannedStartMinute: row.planned_start_minute,
    plannedEndMinute: row.planned_end_minute,
    plannedMinutes: row.planned_end_minute - row.planned_start_minute,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    notes: row.notes ?? null,
    duplicatedFromId: row.duplicated_from_id ?? null,
    splitFromId: row.split_from_id ?? null,
    // The cancellation wins over the two lifecycle timestamps, and it can only be set on a block that
    // never started -- migration 236's practice_activity_cancel_before_start guarantees that, so this is
    // an ordering and not a decision about which of two true things to show.
    state: row.cancelled_at ? "cancelled" : activityState(row.started_at ?? null, row.ended_at ?? null),
  };
}

// ── THE RANGE (CP-PLAN-002 s3-s6) AND THE SEVEN-DAY WEEK (CPR-V5-005 s4) ─────────────────────────────
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ ONE COMPUTATION, FOUR VIEWS. CP-PLAN-002 s2 freezes it -- "Day, Week, Month and Agenda are VIEWS OF
// THE SAME UNDERLYING SCHEDULE" -- and s8 says what happens if that is ignored: "Do not create
// independent appointment stores for each surface."
//
// So plannerRange() below is the only read, plannerWeek() is a seven-day call into it, and the Day,
// Month and Agenda screens are the same PlannerDay[] drawn differently. A month cell's "8 booked - 4
// free" is arithmetic over the very rows the Day view lists, which is why clicking the number can open
// them: it is the length of a list that already exists on the payload.
//
// ⚠ AND NOTHING HERE COMPUTES AVAILABILITY A SECOND TIME. The free count is the availability slot's own
// window cut into the practice's own appointment length (defaultAppointmentMinutes -- the same call
// patient-booking.ts subdivides sessions with) minus the appointments that already cover a step. That is
// the same subtraction the booking engine makes over the same two tables. It differs from the patient
// channel in exactly two named ways, both recorded on the payload rather than in a comment nobody reads:
//
//   1. IT DOES NOT APPLY BOOKING RULES. Notice period, horizon and which sessions are open to patients
//      belong to an OFFER. This is the practitioner's own diary: time inside their own notice period is
//      still free time in their own afternoon, and reporting it as booked would be a lie about their
//      day. CAPACITY_BASIS_NOTE says so wherever the figure is drawn.
//   2. IT COUNTS `COMPLETED` AS OCCUPYING. takenSpans() in patient-booking subtracts only REQUESTED,
//      CONFIRMED and ARRIVED, because a finished appointment is in the past and cannot be booked into
//      anyway. Here the past is a first-class view -- Agenda and Month cover it -- and a clinic that saw
//      twelve patients yesterday must not read "12 booked, 12 free". The difference only ever makes this
//      figure SMALLER, which is the safe direction for a number a practitioner plans against.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * How many days one call will read, whatever it is asked for.
 *
 * ⚠ A WHOLE YEAR FITS, and it fits because the practice owner asked for one: "any day of the week or
 * month or year". 366 admits every period the navigator can produce -- a month grid is 42 days, three
 * months is 92, a leap year is 366 -- and still bounds a hand-typed range.
 *
 * ⚠ AND REACHING IT IS REPORTED as `rangeCapped`, never silently trimmed. An agenda that quietly stopped
 * in August would look exactly like a diary that empties in August.
 */
export const RANGE_DAY_CAP = PERIOD_DAY_CAP;

/**
 * ⚠ PostgREST RETURNS AT MOST 1000 ROWS AND SAYS NOTHING ABOUT IT, so the schedule reads are PAGED TO
 * EXHAUSTION rather than capped.
 *
 * This started as a single `limit(900)` with the overflow reported, which is honest but useless over a
 * year: a practice seeing thirty patients a day fills 900 rows in five weeks, so every year-long agenda
 * would have come back flagged "some of this is not shown". takenSpans() in patient-booking.ts pages the
 * same table for the same reason and this follows it, including the STOP -- a runaway loop is not
 * allowed, and hitting the stop is reported as `truncated` rather than passed off as the whole answer.
 */
const SCHEDULE_PAGE = 1000;
const SCHEDULE_PAGE_STOP = 25;

/**
 * Read a whole table's worth of a range, one page at a time.
 *
 * ⚠ THE ORDER MUST BE TOTAL. Paging on a non-unique sort key can return the same row twice and skip
 * another, so every caller below orders by its time column AND by id.
 */
async function readPaged(
  build: (from: number, to: number) => any,
): Promise<{ ok: true; rows: any[]; truncated: boolean } | { ok: false; message: string }> {
  const rows: any[] = [];
  for (let page = 0; page < SCHEDULE_PAGE_STOP; page++) {
    const { data, error } = await build(page * SCHEDULE_PAGE, page * SCHEDULE_PAGE + SCHEDULE_PAGE - 1);
    if (error || data == null)
      return { ok: false, message: error?.message ?? "neither rows nor an error" };
    rows.push(...(data as any[]));
    if ((data as any[]).length < SCHEDULE_PAGE) return { ok: true, rows, truncated: false };
  }
  return { ok: true, rows, truncated: true };
}

/**
 * An instant, as the practice's own calendar date and minutes from ITS midnight.
 *
 * ⚠ THIS IS THE JOIN BETWEEN TWO CLOCKS AND IT IS WHY IT EXISTS. An activity is stored as a date and
 * minutes (migration 232); an appointment is stored as an INSTANT (migration 192). Drawing them on one
 * day means converting the instant into the practice's wall clock, and doing that with
 * `toISOString().slice(0,10)` is right in UTC and wrong by three hours in Kampala -- which puts an 01:00
 * appointment on the previous day, the exact bug CPR-300 found on the operations home.
 */
function zonedDayMinute(iso: string | null, timezone: string): { date: string; minute: number } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const wall = ms + zoneOffsetMinutes(timezone, new Date(ms)) * 60000;
  const date = new Date(wall).toISOString().slice(0, 10);
  const minute = Math.round((wall - Date.parse(`${date}T00:00:00Z`)) / 60000);
  return { date, minute };
}

/** The clock, read once and shared, so a week and the range it delegates to cannot disagree about today. */
type PlannerClock = { timezone: string; todayDate: string; error: { message: string } | null };

async function plannerClock(admin: any, ctx: WorkspaceContext, at?: Date): Promise<PlannerClock> {
  // ⚠ THE ERROR IS CHECKED. Discarded, a failed workspace read silently becomes "UTC", `today` is then
  // computed for the wrong calendar day, the week is built around the wrong Monday, and the result is a
  // confident week from a query that never succeeded. activity.ts records this exact bug.
  const { data: ws, error } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";
  return { timezone, todayDate: practiceToday(timezone, at ?? new Date()), error: error ?? null };
}

/**
 * EVERY DAY BETWEEN TWO DATES, with its activities, its program, its appointments, its capacity and its
 * conflicts.
 *
 * ⚠ A FAILED READ IS NOT AN EMPTY PERIOD, and the flags are shaped so a screen cannot confuse the two.
 * Every day in the range is always returned, but a day whose read failed carries `unavailable: true` and
 * `workload: null` rather than a zeroed summary. "You have nothing on Thursday" and "I could not find
 * out about Thursday" are different sentences, and only one of them should ever be shown to somebody
 * deciding whether to take a theatre list.
 */
export async function plannerRange(
  admin: any, ctx: WorkspaceContext,
  opts: { fromDate: string; toDate: string; at?: Date; clock?: PlannerClock },
): Promise<PlannerRange> {
  const clock = opts.clock ?? await plannerClock(admin, ctx, opts.at);
  const { timezone, todayDate } = clock;

  // A range that is not a range is not an error a practitioner can act on, so it is repaired rather than
  // refused: an absent or malformed date falls back to today, and a backwards range is read forwards.
  const rawFrom = isDate(opts.fromDate) ? opts.fromDate : todayDate;
  const rawTo = isDate(opts.toDate) ? opts.toDate : rawFrom;
  const fromDate = rawTo < rawFrom ? rawTo : rawFrom;
  const askedTo = rawTo < rawFrom ? rawFrom : rawTo;
  const rangeCapped = daysBetweenIso(fromDate, askedTo) > RANGE_DAY_CAP;
  const toDate = rangeCapped ? addDaysIso(fromDate, RANGE_DAY_CAP - 1) : askedTo;

  const dates: string[] = [];
  for (let i = 0; i < daysBetweenIso(fromDate, toDate); i++) dates.push(addDaysIso(fromDate, i));

  const skeleton = (unavailable: boolean, detail: string | null): PlannerRange => ({
    timezone, todayDate, fromDate, toDate, weekStartDate: fromDate, weekEndDate: toDate,
    days: dates.map(date => emptyDay(date, todayDate, unavailable)),
    workload: unavailable ? null : emptyWeekWorkload(),
    unavailable, detail, truncated: false, rangeCapped, locationColors: {},
  });

  if (clock.error) return skeleton(true, clock.error.message);
  if (!ctx.capabilities.includes(CAN_VIEW))
    return skeleton(true, `${CAN_VIEW} is required`);

  const activityRead = await readPaged((from, to) => admin.from("practice_activity")
    .select(PLANNER_COLUMNS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("practitioner_id", ctx.userId)
    .gte("plan_date", fromDate).lte("plan_date", toDate)
    .order("plan_date", { ascending: true })
    .order("planned_start_minute", { ascending: true })
    .order("id")
    .range(from, to));
  if (!activityRead.ok) return skeleton(true, activityRead.message);

  let truncated = activityRead.truncated;
  const kept = activityRead.rows;

  // The places and the institutions behind them, in one round trip each rather than an embedded join
  // per row: the travel buffers are needed for the hops anyway, so the map has to exist regardless.
  const [{ data: locs, error: locError }, { data: facs, error: facError }] = await Promise.all([
    admin.from("practice_location")
      .select("id, name, facility_id, travel_buffer_minutes, color_slot").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_facility").select("id, name").eq("workspace_id", ctx.workspaceId),
  ]);
  // A location read that failed would silently rename every place to null and zero every travel buffer,
  // which reads as "no travel needed anywhere" -- the one wrong answer this module must never give.
  if (locError || facError) return skeleton(true, (locError ?? facError)!.message);

  const locById = new Map(((locs ?? []) as any[]).map(l => [l.id, l]));
  const facilityById = new Map(((facs ?? []) as any[]).map(f => [f.id, f]));

  // s6's template half, read and never written. Suspended and closed sessions are excluded: they
  // generate nothing and are not what the regular week currently says.
  // ⚠ TRY THE RECURRENCE COLUMNS, THEN FALL BACK -- MIGRATION 274 IS APPLIED BY HAND.
  //
  // PostgREST refuses the WHOLE query when one selected column does not exist, and skeleton(true) turns
  // that into an unavailable planner week. So naming migration 274's two columns unconditionally meant that
  // on any database where 274 had not been applied, the entire planner went dark -- not merely
  // un-recurrence-aware, which is all this change was supposed to risk. availability-config,
  // practice-sessions and booking-rules all try-then-fall-back for exactly this reason, and
  // readRecurrence() answers WEEKLY for a row without the columns, so the fallback degrades to the
  // behaviour this file had before.
  //
  // ⚠ EVERY NEW READ THAT NAMES THOSE COLUMNS MUST DO THE SAME, and this is still the only one that does
  // -- the slot, appointment and exception reads below name no column newer than migration 242.
  const TEMPLATE_BASE = "id, weekday, starts_minute, ends_minute, location_id, slot_kind, note";
  const readTemplates = (columns: string) => admin.from("practice_availability_template")
    .select(columns)
    .eq("workspace_id", ctx.workspaceId).eq("status", "active")
    .order("weekday").order("starts_minute");
  let tmplRes = await readTemplates(`${TEMPLATE_BASE}, ${RECURRENCE_COLUMNS}`);
  if (tmplRes.error && MISSING_COLUMN_CODES.has(String(tmplRes.error.code)))
    tmplRes = await readTemplates(TEMPLATE_BASE);
  const { data: templates, error: tmplError } = tmplRes;
  if (tmplError) return skeleton(true, tmplError.message);

  // ---- THE SCHEDULE. The practice's own day, both ends, so nothing lands on the wrong date. ----
  const startIso = zonedDayRange(fromDate, timezone).startIso;
  const endIso = zonedDayRange(toDate, timezone).endIso;

  const [slotRes, apptRes, exRes, arrivalRes, encounterRes, appointmentMinutes] = await Promise.all([
    readPaged((from, to) => admin.from("practice_availability_slot")
      .select("id, starts_at, ends_at, status, slot_kind, note, location_id, generated_from_template_id")
      .eq("workspace_id", ctx.workspaceId)
      .gte("starts_at", startIso).lt("starts_at", endIso)
      .order("starts_at").order("id").range(from, to)),
    readPaged((from, to) => admin.from("practice_appointment")
      .select("id, patient_id, patient_name, appointment_type, scheduled_at, duration_minutes, " +
        "status, reason, location_id, slot_id")
      .eq("workspace_id", ctx.workspaceId)
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .order("scheduled_at").order("id").range(from, to)),
    readPaged((from, to) => admin.from("practice_availability_exception")
      .select("id, kind, from_date, to_date, starts_minute, ends_minute, reason, location_id")
      .eq("workspace_id", ctx.workspaceId)
      .lte("from_date", toDate).gte("to_date", fromDate)
      .order("from_date").order("id").range(from, to)),
    // ---- WHAT ACTUALLY HAPPENED (the owner's second sentence). See WHAT_HAPPENED_LIMITS below. ----
    //
    // ⚠ READ BY WHEN THEY ARRIVED, not by which appointments are in the range. The appointment ids in a
    // year can run into the thousands and an `in(...)` filter of that size is a URL PostgREST will
    // refuse. An arrival is recorded when the patient walks in, so its own timestamp puts it on the same
    // day as the appointment in every case except a check-in recorded across midnight -- named in
    // WHAT_HAPPENED_LIMITS rather than papered over.
    readPaged((from, to) => admin.from("practice_arrival")
      .select("id, appointment_id, status, arrived_at")
      .eq("workspace_id", ctx.workspaceId)
      .gte("arrived_at", startIso).lt("arrived_at", endIso)
      .order("arrived_at").order("id").range(from, to)),
    readPaged((from, to) => admin.from("practice_encounter")
      .select("id, appointment_id, patient_id, status, started_at, completed_at, signed_at")
      .eq("workspace_id", ctx.workspaceId)
      .gte("started_at", startIso).lt("started_at", endIso)
      .order("started_at").order("id").range(from, to)),
    defaultAppointmentMinutes(admin, ctx.workspaceId),
  ]);
  // ⚠ ANY ONE OF THESE FAILING MAKES THE WHOLE PERIOD UNAVAILABLE, and that is deliberate rather than
  // heavy-handed. A period drawn from activities alone, with the appointment read silently dropped,
  // reads as a week with nothing booked into it -- which is the single most dangerous sentence this
  // screen can say, because it is what a practitioner checks before agreeing to be somewhere else.
  //
  // ⚠ AND THE SAME GOES FOR THE TWO "WHAT HAPPENED" READS. If the encounter read failed and were
  // discarded, every past appointment would report "nothing was recorded" -- a screen accusing a
  // practitioner of not writing up a clinic they did write up.
  for (const r of [slotRes, apptRes, exRes, arrivalRes, encounterRes])
    if (!r.ok) return skeleton(true, r.message);

  const slotRows = slotRes.ok ? slotRes.rows : [];
  const apptRows = apptRes.ok ? apptRes.rows : [];
  const exRows = exRes.ok ? exRes.rows : [];
  const arrivalRows = arrivalRes.ok ? arrivalRes.rows : [];
  const encounterRows = encounterRes.ok ? encounterRes.rows : [];
  truncated = truncated
    || [slotRes, apptRes, exRes, arrivalRes, encounterRes].some(r => r.ok && r.truncated);

  // ---- WHAT HAPPENED, INDEXED BY THE APPOINTMENT IT HAPPENED TO ----
  const arrivalByAppointment = new Map<string, any>();
  for (const r of arrivalRows) {
    if (String(r.status) === "CANCELLED") continue;   // a cancelled check-in is not an arrival
    if (!arrivalByAppointment.has(String(r.appointment_id)))
      arrivalByAppointment.set(String(r.appointment_id), r);
  }
  const encounterByAppointment = new Map<string, any>();
  for (const r of encounterRows) {
    if (!r.appointment_id) continue;
    const key = String(r.appointment_id);
    const held = encounterByAppointment.get(key);
    // The furthest-along encounter wins, so a draft started after a signed one does not erase it.
    if (!held || ENCOUNTER_RANK.indexOf(String(r.status)) > ENCOUNTER_RANK.indexOf(String(held.status)))
      encounterByAppointment.set(key, r);
  }

  // ---- BUCKET BY THE PRACTICE'S OWN DATE ----
  const activitiesByDate = new Map<string, PlannerActivity[]>();
  for (const r of kept) {
    const list = activitiesByDate.get(r.plan_date) ?? [];
    list.push(shape(r, locById, facilityById));
    activitiesByDate.set(r.plan_date, list);
  }

  const apptByDate = new Map<string, PlannerAppointment[]>();
  for (const a of apptRows) {
    const when = zonedDayMinute(a.scheduled_at, timezone);
    if (!when) continue;
    const minutes = (a.duration_minutes as number | null) ?? 0;
    const status = String(a.status);
    const type = String(a.appointment_type);
    const arrival = arrivalByAppointment.get(String(a.id)) ?? null;
    const enc = encounterByAppointment.get(String(a.id)) ?? null;
    const arrivedMinute = arrival ? zonedDayMinute(arrival.arrived_at, timezone)?.minute ?? null : null;
    const outcome = appointmentOutcome({
      status, date: when.date, todayDate,
      arrived: !!arrival, encounterStatus: enc ? String(enc.status) : null,
    });
    const list = apptByDate.get(when.date) ?? [];
    list.push({
      id: a.id,
      patientId: a.patient_id ?? null,
      patientName: a.patient_name ?? "a patient",
      appointmentType: type,
      typeLabel: APPOINTMENT_TYPE_LABEL[type] ?? type,
      status,
      statusLabel: APPOINTMENT_STATUS_LABEL[status] ?? status,
      startMinute: when.minute,
      endMinute: when.minute + minutes,
      minutes,
      locationId: a.location_id ?? null,
      locationName: a.location_id ? locById.get(a.location_id)?.name ?? null : null,
      sessionId: a.slot_id ?? null,
      reason: a.reason ?? null,
      voided: !APPOINTMENT_STATUSES_BOOKED.includes(status),
      isWalkIn: type === "walk_in",
      isFollowUp: type === "scheduled_followup",
      // ONE CLICK TO THE PATIENT, but only where a booking is linked to a real record. A name-only
      // booking has nothing to open, and saying so beats a link that 404s.
      href: a.patient_id ? `/practice/patients/${a.patient_id}` : null,
      // ---- WHAT HAPPENED. Recorded facts only. See appointmentOutcome and WHAT_HAPPENED_LIMITS. ----
      arrivedAtIso: arrival ? String(arrival.arrived_at) : null,
      arrivedMinute,
      encounterId: enc ? String(enc.id) : null,
      encounterStatus: enc ? String(enc.status) : null,
      encounterHref: enc ? `/practice/encounters/${enc.id}` : null,
      outcome,
      outcomeLabel: OUTCOME_LABEL[outcome],
    });
    apptByDate.set(when.date, list);
  }

  const slotsByDate = new Map<string, any[]>();
  for (const s of slotRows) {
    const when = zonedDayMinute(s.starts_at, timezone);
    if (!when) continue;
    const list = slotsByDate.get(when.date) ?? [];
    list.push(s);
    slotsByDate.set(when.date, list);
  }

  const days = dates.map(date => buildDay(date, todayDate, activitiesByDate.get(date) ?? [], locById, {
    templates: (templates ?? []) as any[],
    slots: slotsByDate.get(date) ?? [],
    appointments: apptByDate.get(date) ?? [],
    exceptions: exRows,
    timezone,
    appointmentMinutes: appointmentMinutes as number,
  }));

  return {
    timezone, todayDate, fromDate, toDate, weekStartDate: fromDate, weekEndDate: toDate,
    days,
    workload: rollUp(days),
    unavailable: false, detail: null, truncated, rangeCapped,
    locationColors: Object.fromEntries(
      ((locs ?? []) as any[]).filter(l => l.color_slot).map(l => [l.id, l.color_slot as string]),
    ),
  };
}

/**
 * The week, Monday to Sunday, with every day's activities, locations and workload.
 *
 * ⚠ NOW A SEVEN-DAY CALL INTO plannerRange() AND NOT A SECOND READ. Every field it returned before it
 * still returns, in the same shape, because the range engine IS this function with the seven-day
 * assumption taken out of it. See the banner above plannerRange for why there is only one.
 *
 * @param opts.date any date inside the week wanted. Defaults to the practice's today.
 */
export async function plannerWeek(
  admin: any, ctx: WorkspaceContext, opts: { date?: string; at?: Date } = {},
): Promise<PlannerWeek> {
  const clock = await plannerClock(admin, ctx, opts.at);
  const anchor = isDate(opts.date) ? opts.date : clock.todayDate;
  const weekStart = weekStartDate(anchor);
  return plannerRange(admin, ctx, {
    fromDate: weekStart, toDate: addDays(weekStart, 6), at: opts.at, clock,
  });
}

/**
 * The period a view is showing, read in one call. The screens' entry point.
 *
 * ⚠ THE PERIOD IS COMPUTED BY plannerPeriod(), WHICH THE BROWSER ALSO CALLS. The header's label, the
 * previous/next links and this read all come from one function in one import-free file, so the days that
 * were read and the days that are drawn cannot drift apart.
 */
export async function plannerForPeriod(
  admin: any, ctx: WorkspaceContext, period: PlannerPeriod, opts: { at?: Date } = {},
): Promise<PlannerRange> {
  return plannerRange(admin, ctx, { fromDate: period.fromDate, toDate: period.toDate, at: opts.at });
}

function emptyTravel(): DayTravel {
  return {
    bufferMinutes: 0, basis: "typed_buffer", measured: false, note: TRAVEL_BASIS_NOTE,
    hops: [], shortfalls: [],
  };
}

function emptyDay(date: string, todayDate: string, unavailable: boolean): PlannerDay {
  const weekday = isoWeekday(date);
  return {
    date, weekday,
    weekdayName: WEEKDAY_NAME[weekday], weekdayShort: WEEKDAY_SHORT[weekday],
    isToday: date === todayDate, isPast: date < todayDate,
    activities: [], locations: [], travel: emptyTravel(), conflicts: [], templateSessions: [],
    // NULL, not a zeroed summary. A day nobody could read has no workload, and "0 minutes planned" is a
    // claim about a query that failed.
    workload: unavailable ? null : {
      activityCount: 0, cancelledCount: 0, plannedMinutes: 0, committedMinutes: 0,
      spanMinutes: null, firstStartMinute: null, lastEndMinute: null, gapMinutes: 0,
      byType: [], unassignedCount: 0,
    },
    unavailable,
    sessions: [], appointments: [], exceptions: [],
    // ⚠ NULL AND FALSE, NOT "NO PROGRAM". A day nobody could read is not a day off, and a month grid that
    // greyed it out as one would be telling a practitioner they are free on a date it never looked at.
    capacity: null,
    happened: null,
    hasProgram: false,
    dayOff: !unavailable,
  };
}

const emptyWeekWorkload = (): WeekWorkload => ({
  activityCount: 0, cancelledCount: 0, plannedMinutes: 0, committedMinutes: 0,
  daysWithActivities: 0, conflictCount: 0, travelShortfallCount: 0,
  travelBufferMinutes: 0, travelBasis: "typed_buffer", travelMeasured: false,
  byType: [], locationCount: 0,
  appointmentCount: 0, voidAppointmentCount: 0, sessionCount: 0,
  availableCount: null, sessionsNotGenerated: 0,
});

/** Everything a day needs that is not its own activities. Named so buildDay does not grow eight arguments. */
type DayInputs = {
  templates: any[];
  slots: any[];
  appointments: PlannerAppointment[];
  exceptions: any[];
  timezone: string;
  appointmentMinutes: number;
};

function buildDay(
  date: string, todayDate: string, activities: PlannerActivity[],
  locById: Map<string, any>, inputs: DayInputs,
): PlannerDay {
  const { templates } = inputs;
  const day = emptyDay(date, todayDate, false);
  day.activities = activities;

  // CANCELLED BLOCKS ARE ON THE WEEK AND OUT OF THE ARITHMETIC. They are drawn struck through -- that is
  // the whole reason 236 voids instead of deleting -- but a cancelled clinic occupies no time, blocks
  // nothing and needs no travel, so every calculation below runs on the live ones.
  const live = activities.filter(a => a.state !== "cancelled")
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

  // ---- LOCATIONS, as a route. Consecutive blocks at one place are one visit, matching locationDay() in
  // hospital-booking.ts: the practitioner goes to Mulago once, not once per clinic.
  let unassignedCount = 0;
  for (const a of live) {
    if (!a.locationId) { unassignedCount++; continue; }
    const last = day.locations[day.locations.length - 1];
    if (last && last.locationId === a.locationId) {
      last.lastEndMinute = Math.max(last.lastEndMinute, a.plannedEndMinute);
      last.activityCount++;
      continue;
    }
    day.locations.push({
      locationId: a.locationId,
      name: a.locationName ?? "a location that no longer exists",
      facilityName: a.facilityName,
      firstStartMinute: a.plannedStartMinute,
      lastEndMinute: a.plannedEndMinute,
      activityCount: 1,
      travelBufferMinutes: locById.get(a.locationId)?.travel_buffer_minutes ?? 0,
    });
  }

  // ---- TRAVEL. Typed buffers, summed. See DayTravel and PLANNER_REFUSES.
  for (let i = 1; i < day.locations.length; i++) {
    const from = day.locations[i - 1], to = day.locations[i];
    const gapMinutes = to.firstStartMinute - from.lastEndMinute;
    const neededMinutes = to.travelBufferMinutes;
    const hop: TravelHop = {
      fromName: from.name, toName: to.name, gapMinutes, neededMinutes,
      sufficient: gapMinutes >= neededMinutes,
    };
    day.travel.hops.push(hop);
    day.travel.bufferMinutes += neededMinutes;
    if (!hop.sufficient) day.travel.shortfalls.push(hop);
  }

  // ---- CONFLICTS (s7). REPORTED here, REFUSED by activityConflict() on the write path -- the same
  // arrangement locationDay() takes with impossible moves, and for the same reason: a clash created
  // before two sites were linked, or by a write that predates this module, still exists and the
  // practitioner needs to see it rather than discover it on the road.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (overlaps(a.plannedStartMinute, a.plannedEndMinute, b.plannedStartMinute, b.plannedEndMinute)) {
        const samePlace = (a.locationId ?? null) === (b.locationId ?? null);
        day.conflicts.push({
          code: "ACTIVITY_OVERLAP",
          message: samePlace
            ? `${a.title} and ${b.title} overlap at ${hhmm(Math.max(a.plannedStartMinute, b.plannedStartMinute))}`
            : `you cannot be at ${a.locationName ?? "no particular place"} and ${b.locationName ?? "no particular place"} at the same time`,
          activityIds: [a.id, b.id],
        });
      }
    }
  }
  for (const hop of day.travel.shortfalls)
    day.conflicts.push({
      code: "ACTIVITY_TRAVEL_CONFLICT",
      message: `only ${hop.gapMinutes} minutes between ${hop.fromName} and ${hop.toName}, which needs ${hop.neededMinutes}`,
      activityIds: [],
    });

  // ---- WORKLOAD.
  const windows = live.map(a => ({ s: a.plannedStartMinute, e: a.plannedEndMinute }));
  const committedMinutes = unionMinutes(windows);
  const firstStartMinute = live.length ? Math.min(...windows.map(w => w.s)) : null;
  const lastEndMinute = live.length ? Math.max(...windows.map(w => w.e)) : null;
  const spanMinutes = firstStartMinute !== null && lastEndMinute !== null
    ? lastEndMinute - firstStartMinute : null;

  const byType = new Map<string, { count: number; minutes: number }>();
  for (const a of live) {
    const cur = byType.get(a.activityType) ?? { count: 0, minutes: 0 };
    cur.count++; cur.minutes += a.plannedMinutes;
    byType.set(a.activityType, cur);
  }

  day.workload = {
    activityCount: live.length,
    cancelledCount: activities.length - live.length,
    plannedMinutes: live.reduce((n, a) => n + a.plannedMinutes, 0),
    committedMinutes,
    spanMinutes,
    firstStartMinute,
    lastEndMinute,
    gapMinutes: spanMinutes === null ? 0 : spanMinutes - committedMinutes,
    byType: [...byType.entries()].map(([activityType, v]) => ({
      activityType, label: ACTIVITY_LABEL[activityType as ActivityType] ?? activityType, ...v,
    })).sort((a, b) => b.minutes - a.minutes),
    unassignedCount,
  };

  // ---- s6: THE TEMPLATE BESIDE THE REALITY. `coveredByPlan` false is an override -- the regular week
  // says clinic and today's plan does not -- which is precisely what s6 means by "the daily plan
  // overrides the template without destroying it".
  // ⚠ THE RECURRENCE, NOT JUST THE WEEKDAY. Migration 274 lets a session run every 2, 3 or 4 weeks from
  // an anchor date, and matching on weekday alone would draw an alternate-Saturday clinic on EVERY
  // Saturday -- a planner that shows a clinic the practitioner is not running. occursOn() is the same
  // function the slot generator uses to decide which occurrences to materialise, so the planner and the
  // diary cannot disagree about which Saturdays exist. readRecurrence() answers WEEKLY for any row
  // without the columns, so this is unchanged for every session that is not fortnightly.
  // ⚠ ONE FILTER, USED BY ALL FOUR VIEWS. Day, Week, Month and Agenda every one of them draw
  // `day.templateSessions`, so a fortnightly clinic is absent from its off weeks in all four for the same
  // reason and by the same line of code. There is no month-specific session list to forget this on.
  const occurring = templates
    .filter(t => t.weekday === day.weekday && occursOn(day.date, t.weekday, readRecurrence(t)));

  // ══ CP-PLAN-002: THE SCHEDULE HALF OF THE SAME DAY ══════════════════════════════════════════════
  day.appointments = [...inputs.appointments]
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const booked = day.appointments.filter(a => !a.voided);

  /**
   * ⚠ WHICH APPOINTMENTS BELONG TO A SESSION, and the two rules are not interchangeable.
   *
   * An appointment booked INTO a slot carries its id (migration 192's slot_id), and that linkage is the
   * truth -- a session and its bookings stay together even if somebody later moves the session's window.
   * An appointment with no slot of its own is a walk-in or a booking made before the session existed, and
   * the only thing that can attach it is the clock.
   *
   * A booking that overlaps two sessions is counted against both. That is a real double-count, and it is
   * the honest one: the alternative is to silently drop it from one of them, which would make a session's
   * "booked" smaller than the list underneath it.
   */
  const belongsTo = (sessionId: string | null, s: number, e: number) => (a: PlannerAppointment) =>
    (sessionId !== null && a.sessionId === sessionId)
    || (a.sessionId === null && overlaps(a.startMinute, a.endMinute, s, e));

  const BLOCKED_STATUSES = ["BLOCKED", "CLOSED"];
  const NON_PATIENT_KINDS = ["leave", "blocked", "admin"];

  /**
   * s7's capacity summary, computed the way the booking engine computes availability: the session's own
   * window cut into the practice's own appointment length, less the steps an appointment already covers.
   * See the banner above plannerRange for the two named differences from the patient channel.
   */
  const capacityFor = (
    startMinute: number, endMinute: number,
    o: { sessionId: string | null; generated: boolean; blocked: boolean },
  ): { capacity: SessionCapacity; appointmentIds: string[] } => {
    const m = Math.max(1, inputs.appointmentMinutes);
    const mine = booked.filter(belongsTo(o.sessionId, startMinute, endMinute));
    const base = {
      appointmentMinutes: m, booked: mine.length, blocked: o.blocked,
      basis: "session_divided_by_appointment_length" as const, note: CAPACITY_BASIS_NOTE,
    };
    if (!o.generated)
      return {
        capacity: {
          ...base, slots: null, available: null,
          // ⚠ THE REASON IS ON THE PAYLOAD so the screen never has to guess between "full" and "not open".
          availableUnknownReason:
            "no times have been generated for this session, so there is nothing free to count",
        },
        appointmentIds: mine.map(a => a.id),
      };
    let slots = 0, free = 0;
    for (let s = startMinute; s + m <= endMinute; s += m) {
      slots++;
      if (!mine.some(a => overlaps(a.startMinute, a.endMinute, s, s + m))) free++;
    }
    return {
      capacity: {
        ...base, slots,
        // A blocked session HAS a window and offers nothing in it. Nought free is the true answer here,
        // unlike the ungenerated case above where nought would be a fiction.
        available: o.blocked ? 0 : free,
        availableUnknownReason: null,
      },
      appointmentIds: mine.map(a => a.id),
    };
  };

  // ---- THE GENERATED SESSIONS: real availability slots, which is what a patient can be booked into. ----
  day.sessions = [...inputs.slots]
    .map(s => {
      const from = zonedDayMinute(s.starts_at, inputs.timezone);
      const to = zonedDayMinute(s.ends_at, inputs.timezone);
      if (!from) return null;
      // An end that lands on the NEXT date is midnight, which is minute 1440 of this one.
      const endMinute = to && to.date === from.date ? to.minute : 1440;
      const status = String(s.status ?? "OPEN");
      const kind = String(s.slot_kind ?? "clinic");
      const blocked = BLOCKED_STATUSES.includes(status) || NON_PATIENT_KINDS.includes(kind);
      const { capacity, appointmentIds } =
        capacityFor(from.minute, endMinute, { sessionId: s.id, generated: true, blocked });
      const session: PlannerSession = {
        id: s.id, source: "generated",
        templateId: s.generated_from_template_id ?? null,
        startMinute: from.minute, endMinute,
        slotKind: kind, slotKindLabel: SLOT_KIND_LABEL[kind] ?? kind,
        status,
        locationId: s.location_id ?? null,
        locationName: s.location_id ? locById.get(s.location_id)?.name ?? null : null,
        note: s.note ?? null,
        appointmentIds, capacity,
      };
      return session;
    })
    .filter((s): s is PlannerSession => s !== null);

  // ---- THE PROGRAM SESSIONS. s6's template beside the reality, now also carrying whether the diary
  //      actually holds times for it. A session with generated slots is NOT repeated as a second card.
  const generatedTemplateIds = new Set(day.sessions.map(s => s.templateId).filter(Boolean) as string[]);
  day.templateSessions = occurring.map(t => {
    const generated = generatedTemplateIds.has(String(t.id))
      // A slot with no template attribution still counts as this session being generated when it covers
      // the same window at the same place -- migration 230's generated_from_template_id was added after
      // some slots already existed, and an unattributed slot is still real time in the diary.
      || day.sessions.some(s =>
        (s.locationId ?? null) === (t.location_id ?? null)
        && overlaps(s.startMinute, s.endMinute, t.starts_minute, t.ends_minute));
    return {
      id: t.id,
      startsMinute: t.starts_minute,
      endsMinute: t.ends_minute,
      locationId: t.location_id ?? null,
      locationName: t.location_id ? locById.get(t.location_id)?.name ?? null : null,
      slotKind: t.slot_kind,
      note: t.note ?? null,
      coveredByPlan: live.some(a =>
        overlaps(a.plannedStartMinute, a.plannedEndMinute, t.starts_minute, t.ends_minute)),
      generated,
    };
  });

  for (const t of day.templateSessions) {
    if (t.generated) continue;
    const { capacity, appointmentIds } =
      capacityFor(t.startsMinute, t.endsMinute, { sessionId: null, generated: false, blocked: false });
    day.sessions.push({
      id: t.id, source: "program", templateId: t.id,
      startMinute: t.startsMinute, endMinute: t.endsMinute,
      slotKind: t.slotKind, slotKindLabel: SLOT_KIND_LABEL[t.slotKind] ?? t.slotKind,
      status: "PLANNED",
      locationId: t.locationId, locationName: t.locationName,
      note: t.note, appointmentIds, capacity,
    });
  }
  day.sessions.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  // ---- Walkthrough 2026-08-17 #17: TODAY'S PLAN OUTRANKS THE WEEKLY PRESET. -------------------------
  //
  // The template said the clinic ends at 13:00; the practitioner planned TODAY'S clinic to 15:00 and
  // booked somebody at 13:00 -- who then sat under "booked outside any session" an inch below a plan
  // that plainly covers them. When an uncancelled planned activity at the SAME place overlaps a
  // session and runs past its end, the session strip wears the plan's end and adopts the bookings
  // inside the extension (unplaced or same-place ones only -- a booking at a DIFFERENT hospital is
  // genuinely elsewhere and stays loose). capacity.booked counts what the strip now lists; slots and
  // free are untouched, because the extension adds no generated times and pretending otherwise is
  // the lie the capacity note exists to prevent.
  {
    const placed = new Set(day.sessions.flatMap(s => s.appointmentIds));
    for (const s of day.sessions) {
      const covering = day.activities.find(a =>
        a.state !== "cancelled" && a.locationId && a.locationId === s.locationId
        && a.plannedStartMinute < s.endMinute && a.plannedEndMinute > s.endMinute);
      if (!covering) continue;
      const adopted = booked.filter(a =>
        !placed.has(a.id)
        && a.startMinute >= s.endMinute && a.startMinute < covering.plannedEndMinute
        && (!a.locationId || a.locationId === s.locationId));
      s.endMinute = covering.plannedEndMinute;
      s.extendedByPlan = true;
      for (const a of adopted) { s.appointmentIds.push(a.id); placed.add(a.id); }
      s.capacity.booked += adopted.length;
    }
  }

  // ---- THE DAY'S CAPACITY. Sums of the sessions above, with the unknowable left unknown. ----
  if (day.sessions.length > 0) {
    const computable = day.sessions.filter(s => s.capacity.available !== null);
    day.capacity = {
      sessionCount: day.sessions.length,
      slots: computable.length > 0 ? computable.reduce((n, s) => n + (s.capacity.slots ?? 0), 0) : null,
      booked: booked.length,
      // ⚠ NULL WHEN NOTHING COULD BE COUNTED, never nought. A month cell reading "0 free" on a practice
      // that has simply not generated its times would send a practitioner looking for a full clinic.
      available: computable.length > 0 ? computable.reduce((n, s) => n + (s.capacity.available ?? 0), 0) : null,
      sessionsNotGenerated: day.sessions.filter(s => s.capacity.available === null).length,
      bookedMinutes: booked.reduce((n, a) => n + a.minutes, 0),
      blockedMinutes: day.sessions.filter(s => s.capacity.blocked)
        .reduce((n, s) => n + (s.endMinute - s.startMinute), 0),
    };
  }

  // ---- THE DATES THE REGULAR WEEK DOES NOT DESCRIBE, and s7's conflict state. ----
  day.exceptions = inputs.exceptions
    .filter(e => String(e.from_date).slice(0, 10) <= day.date && String(e.to_date).slice(0, 10) >= day.date)
    .map(e => {
      const kind = String(e.kind);
      const meta = EXCEPTION_KINDS.find(k => k.code === kind);
      return {
        id: e.id, kind,
        kindLabel: meta?.label ?? kind,
        effect: meta?.effect ?? "removes",
        reason: e.reason ?? null,
        startMinute: e.starts_minute ?? null,
        endMinute: e.ends_minute ?? null,
        locationId: e.location_id ?? null,
      };
    });

  // ⚠ s7's "Conflict state: visible warning when SCHEDULE OVERRIDES AFFECT EXISTING APPOINTMENTS", and
  // s22's "never silently move existing patients when a program/override changes". This is a REPORT and
  // not a refusal: the override is already stored, the patients are already booked, and the only thing
  // this screen can usefully do is make sure nobody discovers it on the day.
  for (const e of day.exceptions) {
    const meta = EXCEPTION_KINDS.find(k => k.code === e.kind);
    if (!meta?.impacts) continue;
    const s = e.startMinute ?? 0, en = e.endMinute ?? 1440;
    const hit = booked.filter(a =>
      overlaps(a.startMinute, a.endMinute, s, en)
      && (e.locationId === null || a.locationId === null || a.locationId === e.locationId));
    if (hit.length === 0) continue;
    day.conflicts.push({
      code: "SCHEDULE_OVERRIDE_CONFLICT",
      message: `${e.kindLabel.toLowerCase()} covers ${e.startMinute === null ? "this whole day" : `${hhmm(s)}-${hhmm(en)}`}` +
        ` and ${hit.length} appointment${hit.length === 1 ? " is" : "s are"} still booked in it`,
      activityIds: [],
      appointmentIds: hit.map(a => a.id),
    });
  }

  // ---- WHAT HAPPENED. Counted from `outcome`, which is itself computed from recorded facts only. ----
  const count = (o: string) => day.appointments.filter(a => a.outcome === o).length;
  day.happened = {
    seen: count("seen"),
    consultationStarted: count("consultation_started"),
    markedComplete: count("marked_complete"),
    arrived: count("arrived"),
    didNotAttend: count("did_not_attend"),
    cancelled: count("cancelled"),
    expected: count("expected"),
    notRecorded: count("not_recorded"),
    activitiesRan: day.activities.filter(a => a.startedAt !== null).length,
    // Planned and never started, on a day that has been and gone. On a future day this is simply the
    // plan, which is why the screen reads it beside `isPast` rather than on its own.
    activitiesNotStarted: day.activities.filter(a => a.state === "planned").length,
    isPast: day.isPast,
  };

  // ---- IS THIS A DAY OFF? THREE STATES, AND THIS IS THE THIRD. ----
  day.hasProgram = day.templateSessions.length > 0 || day.sessions.length > 0;
  day.dayOff = !day.hasProgram && day.activities.length === 0 && day.appointments.length === 0;

  return day;
}

function rollUp(days: PlannerDay[]): WeekWorkload | null {
  // If ANY day is unreadable the week total is unknowable, and a partial total presented as a week is
  // the same lie as a zero presented as an empty day.
  if (days.some(d => d.unavailable || d.workload === null)) return null;

  const week = emptyWeekWorkload();
  const byType = new Map<string, { count: number; minutes: number }>();
  const locationIds = new Set<string>();

  for (const d of days) {
    const w = d.workload!;
    week.activityCount += w.activityCount;
    week.cancelledCount += w.cancelledCount;
    week.plannedMinutes += w.plannedMinutes;
    week.committedMinutes += w.committedMinutes;
    if (w.activityCount > 0) week.daysWithActivities++;
    week.conflictCount += d.conflicts.length;
    week.travelShortfallCount += d.travel.shortfalls.length;
    week.travelBufferMinutes += d.travel.bufferMinutes;
    for (const t of w.byType) {
      const cur = byType.get(t.activityType) ?? { count: 0, minutes: 0 };
      cur.count += t.count; cur.minutes += t.minutes;
      byType.set(t.activityType, cur);
    }
    for (const l of d.locations) locationIds.add(l.locationId);

    // ---- CP-PLAN-002's half of the same total. ----
    week.appointmentCount += d.appointments.filter(a => !a.voided).length;
    week.voidAppointmentCount += d.appointments.filter(a => a.voided).length;
    week.sessionCount += d.sessions.length;
    week.sessionsNotGenerated += d.capacity?.sessionsNotGenerated ?? 0;
    // ⚠ NULL STAYS NULL UNTIL SOMETHING IS COUNTABLE. Starting this at nought and adding to it would
    // turn a period in which nothing could be worked out into a confident "0 free".
    if (d.capacity?.available != null)
      week.availableCount = (week.availableCount ?? 0) + d.capacity.available;
  }

  week.byType = [...byType.entries()].map(([activityType, v]) => ({
    activityType, label: ACTIVITY_LABEL[activityType as ActivityType] ?? activityType, ...v,
  })).sort((a, b) => b.minutes - a.minutes);
  week.locationCount = locationIds.size;
  return week;
}

// ── CONFLICT DETECTION (s7) ──────────────────────────────────────────────────────────────────────────

/**
 * CAN A BLOCK SIT ON THIS DATE, AT THIS TIME, AT THIS PLACE?
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE SAME TWO TESTS sessionConflict() APPLIES TO THE TEMPLATE, applied to the day.
 *
 *   OVERLAP  nobody is in two places at one time, WHETHER OR NOT THEY ARE THE SAME PLACE. The
 *            same-location-only version of this check is a bug CPR-SET-002 shipped: a Tuesday with
 *            09:00-13:00 at Aga Khan and 09:00-13:00 at TMR International, both accepted, because
 *            "different locations may legitimately overlap". They may not. The reasoning and the real
 *            practice that found it are recorded above sessionConflict() in availability-config.ts.
 *
 *   TRAVEL   two blocks at different places need the DESTINATION's typed buffer between them. Migration
 *            228's rule, and the buffer belongs to whichever place is being travelled to.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * CANCELLED BLOCKS DO NOT CONFLICT. A clinic that was called off occupies no time, and refusing to plan
 * over it would make cancellation useless -- the block would still hold Thursday morning hostage.
 *
 * FINISHED BLOCKS DO. A clinic that already ran occupied that time, and planning another thing into it
 * would be double-booking the past. Returned as a refusal rather than silently allowed.
 *
 * `excludeId` keeps a block from conflicting with ITSELF while being moved, extended or relocated --
 * the same problem and the same fix as sessionConflict's own excludeId.
 *
 * @returns null when the placement is clear. A refusal object otherwise, ready to be returned as-is.
 */
export async function activityConflict(admin: any, ctx: WorkspaceContext, args: {
  planDate: string; plannedStartMinute: number; plannedEndMinute: number;
  locationId: string | null; excludeId?: string;
}): Promise<Refusal | null> {
  const { data: existing, error } = await admin.from("practice_activity")
    .select("id, title, planned_start_minute, planned_end_minute, location_id")
    .eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .eq("plan_date", args.planDate).is("cancelled_at", null)
    .limit(WEEK_ROW_CAP);
  // ⚠ NEVER "no rows, so no conflict". A failed read here would let every double-booking through, and
  // the failure would be invisible because a clear day looks exactly the same.
  if (error)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the day: ${error.message}` };

  const others = ((existing ?? []) as any[]).filter(a => a.id !== args.excludeId);
  if (others.length === 0) return null;

  const locationIds = [...new Set(
    [args.locationId, ...others.map(a => a.location_id)].filter(Boolean),
  )] as string[];
  const { data: locs, error: locError } = locationIds.length
    ? await admin.from("practice_location").select("id, name, travel_buffer_minutes")
      .eq("workspace_id", ctx.workspaceId).in("id", locationIds)
    : { data: [], error: null };
  if (locError)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the locations: ${locError.message}` };

  const locById = new Map(((locs ?? []) as any[]).map(l => [l.id, l]));
  const nameOf = (id: string | null) => (id ? locById.get(id)?.name ?? "another place" : "no particular place");
  const here = args.locationId ? locById.get(args.locationId) : null;

  for (const a of others) {
    const clash = overlaps(a.planned_start_minute, a.planned_end_minute,
      args.plannedStartMinute, args.plannedEndMinute);
    const samePlace = (a.location_id ?? null) === (args.locationId ?? null);

    if (clash)
      return {
        ok: false, status: 409, code: "ACTIVITY_OVERLAP",
        message: samePlace
          ? `that overlaps ${hhmm(a.planned_start_minute)}-${hhmm(a.planned_end_minute)}, already on this day at ${nameOf(a.location_id)}`
          : `you cannot be at ${nameOf(args.locationId)} and ${nameOf(a.location_id)} at the same time -- ${hhmm(a.planned_start_minute)}-${hhmm(a.planned_end_minute)} is already on this day`,
      };

    if (samePlace) continue;
    const gapBefore = args.plannedStartMinute - a.planned_end_minute;   // the other one first, then this
    const gapAfter = a.planned_start_minute - args.plannedEndMinute;    // this one first, then the other
    const needBefore = here?.travel_buffer_minutes ?? 0;
    const needAfter = locById.get(a.location_id)?.travel_buffer_minutes ?? 0;

    if (gapBefore >= 0 && gapBefore < needBefore)
      return {
        ok: false, status: 409, code: "ACTIVITY_TRAVEL_CONFLICT",
        message: `only ${gapBefore} minutes between ${nameOf(a.location_id)} and ${nameOf(args.locationId)}, which needs ${needBefore}`,
      };
    if (gapAfter >= 0 && gapAfter < needAfter)
      return {
        ok: false, status: 409, code: "ACTIVITY_TRAVEL_CONFLICT",
        message: `that would leave only ${gapAfter} minutes to reach ${nameOf(a.location_id)}, which needs ${needAfter}`,
      };
  }
  return null;
}

// ── THE ACTIONS (s5) ─────────────────────────────────────────────────────────────────────────────────
//
// EIGHT FUNCTIONS RATHER THAN ONE editActivity(), which is the opposite of the choice editSession() made
// next door, so the reason is written down. Those four template operations share one conflict check and
// differ only in arguments. These do not: move refuses a started block, extend allows one, shorten needs
// no conflict check at all and cancel needs a database constraint behind it. Folding them into one
// function would put four incompatible guard sets behind one `if`, and the failure mode of getting that
// wrong is a silent double-booking rather than a compile error.
//
// EVERY ONE OF THEM AUDITS, and none of them emits a domain event. planActivity() sets that precedent
// and migration 236 s7 records why: migration 233's catalogue is closed and has no activity.cancelled,
// activity.moved or activity.split, so a planner that emitted would announce a duplicated block while a
// hand-planned one stayed silent, and a projection built on the difference would be wrong about the plan.

const nowIso = () => new Date().toISOString();

/**
 * The caller's own block, or nothing.
 *
 * FILTERED ON practitioner_id AS WELL AS workspace_id, which is what makes every "not found" below a
 * tenancy boundary rather than a lookup miss -- another practice's Thursday is not merely invisible, it
 * is unreachable, and it answers with the same 404 an absent block would.
 */
async function loadOwn(admin: any, ctx: WorkspaceContext, id: string) {
  const { data, error } = await admin.from("practice_activity")
    .select(PLANNER_COLUMNS)
    .eq("id", id).eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .maybeSingle();
  return { row: error ? null : data, error };
}

/** The guards every action shares, in one place so none of them can be quietly skipped. */
function guard(row: any, opts: {
  needsPlanned?: boolean; needsNotEnded?: boolean;
} = {}): Refusal | null {
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.cancelled_at)
    return { ok: false, status: 422, code: "ALREADY_CANCELLED", message: "that activity was cancelled" };
  if (opts.needsPlanned && row.started_at)
    return {
      ok: false, status: 422, code: "ALREADY_STARTED",
      message: row.ended_at
        ? "that activity is over -- the plan is not rewritten to match what happened"
        : "that activity has already started",
    };
  if (opts.needsNotEnded && row.ended_at)
    return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is over" };
  return null;
}

const forbidden = (code: string): Refusal =>
  ({ ok: false, status: 403, code: "FORBIDDEN", message: `${code} is required` });

const invalid = (message: string): Refusal =>
  ({ ok: false, status: 400, code: "VALIDATION_ERROR", message });

function validWindow(startMinute: number, endMinute: number): Refusal | null {
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute))
    return invalid("a window is a whole number of minutes from midnight");
  if (startMinute < 0 || startMinute > 1440 || endMinute < 0 || endMinute > 1440)
    return invalid("a window must sit inside the day, between 0 and 1440 minutes");
  if (endMinute <= startMinute)
    return invalid("an activity cannot end before it begins");
  return null;
}

// ---- MOVE ------------------------------------------------------------------------------------------

/**
 * s5's Move, and s5's drag-and-drop "across time and dates".
 *
 * DURATION IS PRESERVED WHEN ONLY THE START MOVES, because that is what dragging a block means. Passing
 * a start without an end and getting a block that ran to its old end time would silently stretch or
 * shrink every drag, and the practitioner would be correcting the length of things they only meant to
 * slide.
 *
 * REFUSES A BLOCK THAT HAS STARTED. Yesterday's ward round is not a thing you can reschedule.
 */
export async function moveActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { planDate?: string; plannedStartMinute?: number; plannedEndMinute?: number },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; planDate: string; plannedStartMinute: number; plannedEndMinute: number; changed: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) return refusal;

  if (input.planDate !== undefined && !isDate(input.planDate))
    return invalid("a date is YYYY-MM-DD");

  const planDate = input.planDate ?? row.plan_date;
  const startMinute = input.plannedStartMinute ?? row.planned_start_minute;
  const duration = row.planned_end_minute - row.planned_start_minute;
  const endMinute = input.plannedEndMinute
    ?? (input.plannedStartMinute !== undefined ? startMinute + duration : row.planned_end_minute);

  const bad = validWindow(startMinute, endMinute);
  if (bad) return bad;

  const changed = [
    planDate !== row.plan_date ? "planDate" : null,
    startMinute !== row.planned_start_minute ? "plannedStartMinute" : null,
    endMinute !== row.planned_end_minute ? "plannedEndMinute" : null,
  ].filter(Boolean) as string[];
  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const conflict = await activityConflict(admin, ctx, {
    planDate, plannedStartMinute: startMinute, plannedEndMinute: endMinute,
    locationId: row.location_id ?? null, excludeId: id,
  });
  if (conflict) return conflict;

  const { error: writeError } = await admin.from("practice_activity").update({
    plan_date: planDate, planned_start_minute: startMinute, planned_end_minute: endMinute,
    updated_at: nowIso(),
  }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "MOVE_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_moved",
    payload: {
      activityId: id, changed,
      from: { planDate: row.plan_date, start: hhmm(row.planned_start_minute), end: hhmm(row.planned_end_minute) },
      to: { planDate, start: hhmm(startMinute), end: hhmm(endMinute) },
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, planDate, plannedStartMinute: startMinute, plannedEndMinute: endMinute, changed } };
}

// ---- DUPLICATE -------------------------------------------------------------------------------------

/** No practitioner copies a block onto more days than this in one gesture, and an unbounded list is a
 *  loop of writes a mistyped payload can start. */
// Owned by planner-constants.ts so the Duplicate control can print the maximum it is working against.
// The enforcement below is still the authority -- a client that ignored the number is refused here.

/**
 * s5's Duplicate: copy a block onto one or more other dates.
 *
 * EACH DATE IS DECIDED SEPARATELY, following duplicateSession() next door. "Copy to Monday, Wednesday
 * and Friday" where Wednesday already has a clashing theatre list must copy to two days and say why the
 * third did not -- refusing all three makes the practitioner work out which, and copying all three
 * creates the double-booking the conflict check exists to prevent.
 *
 * THE COPY IS NEVER CANCELLED AND NEVER RUNNING. A cancelled block may be duplicated -- that is how a
 * called-off clinic is put on next week -- but the cancellation, the start and the end belong to the
 * original and are not carried over. The notes are, because a note like "bring the ultrasound" is part
 * of what the block IS.
 */
export async function duplicateActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: {
    toDates: string[];
    plannedStartMinute?: number; plannedEndMinute?: number;
    locationId?: string | null; facilityId?: string | null;
  },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ created: { date: string; id: string }[]; refused: { date: string; reason: string }[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);
  if (!Array.isArray(input.toDates) || input.toDates.length === 0)
    return invalid("choose at least one date to copy to");
  if (input.toDates.length > DUPLICATE_DATE_CAP)
    return invalid(`a copy can reach at most ${DUPLICATE_DATE_CAP} dates at once`);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  // NO STATE GUARD BEYOND EXISTENCE. Duplicating a finished clinic onto next Tuesday is the ordinary
  // way a week gets built, and duplicating a cancelled one is how it gets rescheduled.
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const startMinute = input.plannedStartMinute ?? row.planned_start_minute;
  const endMinute = input.plannedEndMinute ?? row.planned_end_minute;
  const bad = validWindow(startMinute, endMinute);
  if (bad) return bad;

  const locationId = input.locationId !== undefined ? input.locationId : row.location_id ?? null;
  const facilityId = input.facilityId !== undefined ? input.facilityId : row.facility_id ?? null;
  if (locationId) {
    const known = await knownLocation(admin, ctx, locationId);
    if (known) return known;
  }

  const created: { date: string; id: string }[] = [];
  const refused: { date: string; reason: string }[] = [];

  for (const date of [...new Set(input.toDates)]) {
    if (!isDate(date)) { refused.push({ date: String(date), reason: "not a date" }); continue; }

    const conflict = await activityConflict(admin, ctx, {
      planDate: date, plannedStartMinute: startMinute, plannedEndMinute: endMinute, locationId,
    });
    if (conflict) { refused.push({ date, reason: conflict.message }); continue; }

    const { data, error: insertError } = await admin.from("practice_activity").insert({
      workspace_id: ctx.workspaceId,
      practitioner_id: row.practitioner_id ?? ctx.userId,
      activity_type: row.activity_type, title: row.title,
      plan_date: date, planned_start_minute: startMinute, planned_end_minute: endMinute,
      facility_id: facilityId, location_id: locationId, room: row.room ?? null,
      notes: row.notes ?? null,
      duplicated_from_id: row.id,
    }).select("id").maybeSingle();
    if (insertError || !data) {
      refused.push({ date, reason: insertError?.message ?? "the copy was not created" });
      continue;
    }
    created.push({ date, id: data.id as string });
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_duplicated",
    payload: { activityId: id, created: created.map(c => c.date), refused },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { created, refused } };
}

// ---- SPLIT -----------------------------------------------------------------------------------------

/**
 * s5's Split: one block becomes two that abut at `atMinute`.
 *
 * NO CONFLICT CHECK, and that is a decision rather than an omission. Both halves lie strictly inside the
 * original window, so a split can create no overlap and no travel gap the original did not already have
 * -- running the check would only be able to refuse a clash that already exists, which would make a
 * pre-existing double-booking impossible to tidy up.
 *
 * ⚠ THE ORDER OF THE TWO WRITES IS CHOSEN FOR ITS FAILURE MODE. There is no transaction: every engine
 * here talks to PostgREST one statement per round trip. Inserting the second half first and then failing
 * to shorten the first would leave two blocks covering the same afternoon -- a double-booking created by
 * the very operation that is supposed to be safe. Shortening first and then failing to insert leaves a
 * short block and lost time, which is visible, harmless and fixed by extendActivity. So: shorten, then
 * insert, and if the insert fails put the original window back and say whether that worked.
 */
export async function splitActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { atMinute: number; secondTitle?: string },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ firstId: string; secondId: string; firstEndMinute: number; secondStartMinute: number }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  // A RUNNING BLOCK CANNOT BE SPLIT because there is no honest answer to which half the practitioner is
  // in: started_at belongs to one row and the encounters recorded so far inherited that row as their
  // context. Ending it and planning the remainder is the operation that keeps both facts true.
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) return refusal;

  const { atMinute } = input;
  if (!Number.isInteger(atMinute))
    return invalid("a split point is a whole number of minutes from midnight");
  if (atMinute <= row.planned_start_minute || atMinute >= row.planned_end_minute)
    return invalid(`a split must fall inside ${hhmm(row.planned_start_minute)}-${hhmm(row.planned_end_minute)}`);

  const secondTitle = (input.secondTitle ?? "").trim() || row.title;
  if (secondTitle.length > 200) return invalid("a title is at most 200 characters");

  const { error: shortenError } = await admin.from("practice_activity")
    .update({ planned_end_minute: atMinute, updated_at: nowIso() }).eq("id", id);
  if (shortenError)
    return { ok: false, status: 500, code: "SPLIT_FAILED", message: shortenError.message };

  const { data, error: insertError } = await admin.from("practice_activity").insert({
    workspace_id: ctx.workspaceId,
    practitioner_id: row.practitioner_id ?? ctx.userId,
    activity_type: row.activity_type, title: secondTitle,
    plan_date: row.plan_date,
    planned_start_minute: atMinute, planned_end_minute: row.planned_end_minute,
    facility_id: row.facility_id ?? null, location_id: row.location_id ?? null, room: row.room ?? null,
    notes: row.notes ?? null,
    split_from_id: row.id,
  }).select("id").maybeSingle();

  if (insertError || !data) {
    // Put it back, and REPORT whether that worked. A restore that silently failed would leave the
    // practitioner with a block half the length they planned and a message saying nothing happened.
    const { error: restoreError } = await admin.from("practice_activity")
      .update({ planned_end_minute: row.planned_end_minute, updated_at: nowIso() }).eq("id", id);
    return {
      ok: false, status: 500, code: "SPLIT_FAILED",
      message: restoreError
        ? `the second half was not created (${insertError?.message ?? "no row"}) and the original could NOT be restored: ${restoreError.message}`
        : `the second half was not created and the original window was restored: ${insertError?.message ?? "no row"}`,
    };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_split",
    payload: {
      activityId: id, secondActivityId: data.id, atMinute,
      was: { start: hhmm(row.planned_start_minute), end: hhmm(row.planned_end_minute) },
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return {
    ok: true,
    value: {
      firstId: id, secondId: data.id as string,
      firstEndMinute: atMinute, secondStartMinute: atMinute,
    },
  };
}

// ---- EXTEND AND SHORTEN ----------------------------------------------------------------------------

/**
 * s5's Extend: the block runs later than planned.
 *
 * ALLOWED WHILE THE BLOCK IS RUNNING, unlike move. A clinic overrunning is the normal case, not an
 * error -- activity.ts says so and reports `overrunMinutes` rather than correcting it -- and extending
 * the plan is how a practitioner says "this is going to take until one". Refused once it has ENDED,
 * because at that point the plan would be being rewritten to match what already happened.
 */
export async function extendActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { byMinutes: number },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; plannedEndMinute: number; byMinutes: number }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsNotEnded: true });
  if (refusal) return refusal;

  const { byMinutes } = input;
  if (!Number.isInteger(byMinutes) || byMinutes <= 0)
    return invalid("extend by a whole number of minutes greater than nought");

  const endMinute = row.planned_end_minute + byMinutes;
  // 1440 is midnight. A block cannot run past the end of its own day, because plan_date and the minute
  // columns are migration 232's whole vocabulary for when something is -- there is no way to express
  // 23:30 to 00:30, and inventing one here would put an activity on a date it is not on.
  if (endMinute > 1440)
    return invalid(`that would run past midnight -- ${hhmm(row.planned_end_minute)} plus ${byMinutes} minutes does not fit in the day`);

  const conflict = await activityConflict(admin, ctx, {
    planDate: row.plan_date, plannedStartMinute: row.planned_start_minute, plannedEndMinute: endMinute,
    locationId: row.location_id ?? null, excludeId: id,
  });
  if (conflict) return conflict;

  const { error: writeError } = await admin.from("practice_activity")
    .update({ planned_end_minute: endMinute, updated_at: nowIso() }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "EXTEND_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_extended",
    payload: { activityId: id, byMinutes, from: hhmm(row.planned_end_minute), to: hhmm(endMinute) },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, plannedEndMinute: endMinute, byMinutes } };
}

/**
 * s5's Shorten.
 *
 * NO CONFLICT CHECK, for the reason editSession() exempts a suspend: taking time OUT of a day can never
 * create an overlap, and can only ever widen the gap before whatever comes next. Running the check
 * anyway would mean a day that is ALREADY double-booked could not be tidied up, because the first thing
 * a practitioner would try -- making one of the two blocks shorter -- would be refused by the clash it
 * is fixing.
 */
export async function shortenActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { byMinutes: number },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; plannedEndMinute: number; byMinutes: number }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsNotEnded: true });
  if (refusal) return refusal;

  const { byMinutes } = input;
  if (!Number.isInteger(byMinutes) || byMinutes <= 0)
    return invalid("shorten by a whole number of minutes greater than nought");

  const endMinute = row.planned_end_minute - byMinutes;
  if (endMinute <= row.planned_start_minute)
    return invalid(`that would leave nothing -- the block starts at ${hhmm(row.planned_start_minute)} and runs ${row.planned_end_minute - row.planned_start_minute} minutes`);

  const { error: writeError } = await admin.from("practice_activity")
    .update({ planned_end_minute: endMinute, updated_at: nowIso() }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "SHORTEN_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_shortened",
    payload: { activityId: id, byMinutes, from: hhmm(row.planned_end_minute), to: hhmm(endMinute) },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, plannedEndMinute: endMinute, byMinutes } };
}

// ---- CANCEL ----------------------------------------------------------------------------------------

/**
 * s5's Cancel. CPR-CORE-001 s13: voided, never deleted.
 *
 * THE BLOCK STAYS ON THE WEEK. Struck through, with who called it off, when, and why if they said. A
 * deleted row would take the audit trail's subject with it, would leave any encounter that inherited it
 * pointing at nothing, and would make "what happened to Thursday" -- the exact question a cancellation
 * raises -- unanswerable.
 *
 * REFUSES A BLOCK THAT HAS STARTED, and the database refuses it too
 * (practice_activity_cancel_before_start, migration 236). A clinic that ran is a clinic that happened.
 * Marking it cancelled would retroactively unmake the setting of every clinical record made in it.
 */
export async function cancelActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { reason?: string } = {},
  opts: { at?: Date; source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; cancelledAtIso: string; reason: string | null }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) {
    // The started case gets its own sentence here rather than the shared one, because it is the only
    // refusal in this module with an obvious next action and the practitioner should be told it.
    if (refusal.code === "ALREADY_STARTED")
      return { ...refusal, message: "that activity has already started -- end it rather than cancelling it" };
    return refusal;
  }

  // Trimmed to null rather than stored as an empty string: "" and NULL would both mean "no reason given"
  // and every reader would have to know about both.
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 300)
    return invalid("a cancellation reason is at most 300 characters");

  const at = (opts.at ?? new Date()).toISOString();
  const { error: writeError } = await admin.from("practice_activity").update({
    cancelled_at: at, cancelled_by: ctx.userId, cancellation_reason: reason, updated_at: nowIso(),
  }).eq("workspace_id", ctx.workspaceId).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "CANCEL_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_cancelled",
    payload: {
      activityId: id, activityType: row.activity_type, planDate: row.plan_date,
      start: hhmm(row.planned_start_minute), end: hhmm(row.planned_end_minute), reason,
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, cancelledAtIso: at, reason } };
}

// ---- CHANGE LOCATION -------------------------------------------------------------------------------

/** Both sides checked against the caller's workspace, so a block can never point at another practice's
 *  place -- which would leak that practice's location names into this one's week. */
async function knownLocation(admin: any, ctx: WorkspaceContext, locationId: string): Promise<Refusal | null> {
  const { data, error } = await admin.from("practice_location")
    .select("id").eq("id", locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  return null;
}

async function knownFacility(admin: any, ctx: WorkspaceContext, facilityId: string): Promise<Refusal | null> {
  const { data, error } = await admin.from("practice_facility")
    .select("id").eq("id", facilityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  return null;
}

/**
 * s5's Change Location.
 *
 * ⚠ THE CONFLICT CHECK RUNS EVEN THOUGH THE TIME HAS NOT MOVED, and this is the case the check exists
 * for. Two blocks that sat happily at one hospital, one at 09:00-12:00 and one at 12:30-15:00, become
 * impossible the moment the second is moved to a site forty minutes away -- nothing about the clock
 * changed and the day just became unworkable.
 *
 * REFUSES A BLOCK THAT HAS STARTED. Encounters recorded during it inherit it as their context, so
 * relocating it would move the setting of a clinical record after the fact -- a change nothing
 * downstream could detect, because an encounter carries the activity id and not a copy of the place.
 */
export async function changeActivityLocation(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { locationId?: string | null; facilityId?: string | null; room?: string | null },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; changed: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) return refusal;

  const locationId = input.locationId !== undefined ? input.locationId : row.location_id ?? null;
  const facilityId = input.facilityId !== undefined ? input.facilityId : row.facility_id ?? null;
  const room = input.room !== undefined ? (input.room?.trim() || null) : row.room ?? null;
  if (room && room.length > 80) return invalid("a room is at most 80 characters");

  if (locationId && locationId !== (row.location_id ?? null)) {
    const bad = await knownLocation(admin, ctx, locationId);
    if (bad) return bad;
  }
  if (facilityId && facilityId !== (row.facility_id ?? null)) {
    const bad = await knownFacility(admin, ctx, facilityId);
    if (bad) return bad;
  }

  const changed = [
    locationId !== (row.location_id ?? null) ? "locationId" : null,
    facilityId !== (row.facility_id ?? null) ? "facilityId" : null,
    room !== (row.room ?? null) ? "room" : null,
  ].filter(Boolean) as string[];
  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  if (changed.includes("locationId")) {
    const conflict = await activityConflict(admin, ctx, {
      planDate: row.plan_date,
      plannedStartMinute: row.planned_start_minute, plannedEndMinute: row.planned_end_minute,
      locationId, excludeId: id,
    });
    if (conflict) return conflict;
  }

  const { error: writeError } = await admin.from("practice_activity").update({
    location_id: locationId, facility_id: facilityId, room, updated_at: nowIso(),
  }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "RELOCATE_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_relocated",
    payload: {
      activityId: id, changed,
      from: { locationId: row.location_id ?? null, facilityId: row.facility_id ?? null, room: row.room ?? null },
      to: { locationId, facilityId, room },
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, changed } };
}

// ---- ADD NOTES -------------------------------------------------------------------------------------

/**
 * s5's Add Notes.
 *
 * NO STATE GUARD AT ALL, which is the only action here that has none, so the reason is written down. A
 * note is commentary on the block and not part of the plan: annotating a clinic that has finished
 * ("ran over, three patients rebooked") and annotating one that was cancelled ("theatre list pulled")
 * are both exactly when a practitioner reaches for this. Refusing either would leave the one place the
 * explanation belongs unwritable at the one moment it is wanted.
 *
 * PASSING AN EMPTY STRING CLEARS THE NOTE, and it is stored as NULL rather than "" so that no reader has
 * to treat two different values as the same absence.
 */
export async function addActivityNotes(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { notes: string | null },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; notes: string | null; cleared: boolean }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const notes = (input.notes ?? "").trim() || null;
  if (notes && notes.length > 2000) return invalid("a note is at most 2000 characters");
  if (notes === (row.notes ?? null))
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const { error: writeError } = await admin.from("practice_activity")
    .update({ notes, updated_at: nowIso() }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "NOTES_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_notes_changed",
    // THE NOTE ITSELF IS NOT IN THE AUDIT PAYLOAD. practice_audit_event is retained for compliance and
    // is not the place to accumulate copies of free text that may name a patient. Its length and whether
    // it was cleared are enough to answer "who changed the note on Thursday".
    payload: { activityId: id, cleared: notes === null, length: notes?.length ?? 0 },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, notes, cleared: notes === null } };
}

// ── CP-PLAN-002 s4: SEARCH THE SCHEDULE ──────────────────────────────────────────────────────────────
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// s4's search requirement, verbatim: "Searching for a future patient must return the appointment date,
// time, location and session with a direct 'View appointment' / 'Go to date' action. THE USER SHOULD NOT
// HAVE TO NAVIGATE WEEK-BY-WEEK TO FIND A KNOWN BOOKING."
//
// ⚠ SO THIS DOES NOT SEARCH THE LOADED PERIOD. The filters on the screen narrow what is drawn on the days
// the navigator asked for; this searches the WHOLE DIARY, past and future, and hands back the date to
// navigate to. A search that only looked at the fortnight already on screen would answer "no results" for
// the one patient the practitioner knows is booked, which is the failure the requirement names.
//
// ⚠ IT IS NOT searchPractice(). search.ts is a full-text search across patients, encounters and documents
// and it answers "who is this person"; this answers "WHEN ARE THEY COMING", which is a different index
// (scheduled_at) and a different answer shape (a date to go to). Neither is a substitute for the other,
// and this one deliberately reads only the two scheduling tables.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type ScheduleSearchHit = {
  kind: "appointment" | "activity";
  id: string;
  /** The patient's name, or the activity's title. What the practitioner typed to find it. */
  title: string;
  subtitle: string | null;
  date: string;
  startMinute: number;
  endMinute: number;
  locationName: string | null;
  /** Which session it sits in, where it was booked into one. s4 asks for the session by name. */
  sessionLabel: string | null;
  status: string;
  statusLabel: string;
  /** The patient record, or null for a booking that is a name and nothing else. */
  href: string | null;
  /** s4's "Go to date": the date the planner should open on to show this. */
  goToDate: string;
  past: boolean;
};

export type ScheduleSearchResult = {
  query: string;
  hits: ScheduleSearchHit[];
  /** True when the search could not be run. NEVER an empty hit list standing in for a failed read. */
  unavailable: boolean;
  detail: string | null;
  /** True when more matched than were returned, so "nothing else" is never implied. */
  truncated: boolean;
};

/** The shortest query worth running. One letter matches most of a practice and helps nobody. */
export const SCHEDULE_SEARCH_MIN = 2;
const SCHEDULE_SEARCH_LIMIT = 25;

/**
 * ⚠ THE WILDCARDS ARE STRIPPED AND SO IS THE COMMA, for two different reasons.
 *
 * `%` and `_` are ilike wildcards: a query of "_" would otherwise match every patient in the practice.
 * The COMMA is PostgREST's own value separator -- an unescaped one does not match nothing, it changes the
 * SHAPE of the filter. Parentheses, quotes and dots go with it for the same reason.
 */
function ilikeSafe(raw: string): string {
  return raw.replace(/[%_\\,().*"']/g, " ").replace(/\s+/g, " ").trim();
}

export async function scheduleSearch(
  admin: any, ctx: WorkspaceContext, rawQuery: string,
  opts: { limit?: number; at?: Date } = {},
): Promise<ScheduleSearchResult> {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const safe = ilikeSafe(query);
  const limit = Math.max(1, Math.min(opts.limit ?? SCHEDULE_SEARCH_LIMIT, 100));
  const empty = (unavailable: boolean, detail: string | null): ScheduleSearchResult =>
    ({ query, hits: [], unavailable, detail, truncated: false });

  if (!ctx.capabilities.includes(CAN_VIEW)) return empty(true, `${CAN_VIEW} is required`);
  if (safe.length < SCHEDULE_SEARCH_MIN) return empty(false, null);

  const clock = await plannerClock(admin, ctx, opts.at);
  if (clock.error) return empty(true, clock.error.message);
  const { timezone, todayDate } = clock;

  const [apptRes, actRes, locRes] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, patient_id, patient_name, appointment_type, scheduled_at, duration_minutes, " +
        "status, reason, location_id, slot_id")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("patient_name", `%${safe}%`)
      .order("scheduled_at", { ascending: false })
      .limit(limit + 1),
    admin.from("practice_activity")
      .select("id, activity_type, title, plan_date, planned_start_minute, planned_end_minute, " +
        "cancelled_at, started_at, ended_at, location_id")
      .eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
      .ilike("title", `%${safe}%`)
      .order("plan_date", { ascending: false })
      .limit(limit + 1),
    admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId),
  ]);
  // ⚠ A FAILED SEARCH IS NOT "NO RESULTS". Somebody told their patient is not booked, when in truth the
  // query failed, rings that patient and cancels a clinic that was going ahead.
  const readError = apptRes.error ?? actRes.error ?? locRes.error;
  if (readError) return empty(true, readError.message);

  const locById = new Map(((locRes.data ?? []) as any[]).map(l => [l.id, l]));
  const apptRows = (apptRes.data ?? []) as any[];
  const actRows = (actRes.data ?? []) as any[];

  // The sessions the matching appointments sit in, named rather than numbered. Bounded by the limit
  // above, so this is a lookup over at most a couple of dozen ids and never a scan.
  const slotIds = [...new Set(apptRows.map(a => a.slot_id).filter(Boolean))] as string[];
  let slotById = new Map<string, any>();
  if (slotIds.length > 0) {
    const { data: slots, error: slotError } = await admin.from("practice_availability_slot")
      .select("id, starts_at, ends_at, slot_kind, location_id")
      .eq("workspace_id", ctx.workspaceId).in("id", slotIds);
    if (slotError) return empty(true, slotError.message);
    slotById = new Map(((slots ?? []) as any[]).map(s => [s.id, s]));
  }

  const hits: ScheduleSearchHit[] = [];

  for (const a of apptRows.slice(0, limit)) {
    const when = zonedDayMinute(a.scheduled_at, timezone);
    if (!when) continue;
    const status = String(a.status);
    const type = String(a.appointment_type);
    const slot = a.slot_id ? slotById.get(a.slot_id) : null;
    const slotFrom = slot ? zonedDayMinute(slot.starts_at, timezone) : null;
    const slotTo = slot ? zonedDayMinute(slot.ends_at, timezone) : null;
    hits.push({
      kind: "appointment",
      id: a.id,
      title: a.patient_name ?? "a patient",
      subtitle: APPOINTMENT_TYPE_LABEL[type] ?? type,
      date: when.date,
      startMinute: when.minute,
      endMinute: when.minute + ((a.duration_minutes as number | null) ?? 0),
      locationName: a.location_id ? locById.get(a.location_id)?.name ?? null : null,
      sessionLabel: slot && slotFrom
        ? `${SLOT_KIND_LABEL[String(slot.slot_kind)] ?? slot.slot_kind} ${hhmm(slotFrom.minute)}-${hhmm(slotTo?.minute ?? slotFrom.minute)}`
        : null,
      status,
      statusLabel: APPOINTMENT_STATUS_LABEL[status] ?? status,
      href: a.patient_id ? `/practice/patients/${a.patient_id}` : null,
      goToDate: when.date,
      past: when.date < todayDate,
    });
  }

  for (const r of actRows.slice(0, limit)) {
    const state: PlannerActivityState =
      r.cancelled_at ? "cancelled" : activityState(r.started_at ?? null, r.ended_at ?? null);
    hits.push({
      kind: "activity",
      id: r.id,
      title: r.title,
      subtitle: ACTIVITY_LABEL[r.activity_type as ActivityType] ?? r.activity_type,
      date: r.plan_date,
      startMinute: r.planned_start_minute,
      endMinute: r.planned_end_minute,
      locationName: r.location_id ? locById.get(r.location_id)?.name ?? null : null,
      sessionLabel: null,
      status: state,
      statusLabel: PLANNER_STATE_LABEL[state] ?? state,
      href: null,
      goToDate: r.plan_date,
      past: r.plan_date < todayDate,
    });
  }

  // NEAREST FIRST, FUTURE BEFORE PAST. Somebody searching a name is nearly always asking "when are they
  // next in", and a diary sorted by date alone buries that under three years of history.
  hits.sort((x, y) => {
    if (x.past !== y.past) return x.past ? 1 : -1;
    const byDate = x.past
      ? (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)
      : (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
    return byDate || x.startMinute - y.startMinute;
  });

  return {
    query,
    hits: hits.slice(0, limit),
    unavailable: false,
    detail: null,
    truncated: apptRows.length > limit || actRows.length > limit || hits.length > limit,
  };
}
