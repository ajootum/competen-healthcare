// CPR-V5-005 PRACTICE PLANNER -- the constants a screen needs, and nothing that touches the database.
//
// ⚠ THIS FILE EXISTS BECAUSE A SERVER-ONLY IMPORT REACHING A CLIENT COMPONENT IS INVISIBLE TO tsc,
// eslint AND EVERY HARNESS. planner.ts imports activity.ts, which imports metrics.ts, which imports
// access.ts, which imports `next/headers`. A "use client" week grid importing so much as a weekday name
// from planner.ts drags that whole chain into the browser bundle and the BUILD FAILS -- reported as a
// 500 on pages nobody touched, and only `next build` names the real import trace.
//
// activity-constants.ts and encounter-constants.ts exist for exactly this reason and this is the third.
// The rule, stated once more where somebody will read it: A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A
// FILE THAT TOUCHES THE DATABASE. planner.ts re-exports everything here so server callers are unaffected
// and nothing ends up with two definitions.

import { ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";

/** ISO weekday numbers, which is the convention migration 230 already uses for the weekly template. */
export const PLANNER_WEEKDAYS = [
  [1, "Monday", "Mon"], [2, "Tuesday", "Tue"], [3, "Wednesday", "Wed"], [4, "Thursday", "Thu"],
  [5, "Friday", "Fri"], [6, "Saturday", "Sat"], [7, "Sunday", "Sun"],
] as const;

export const WEEKDAY_NAME: Record<number, string> =
  Object.fromEntries(PLANNER_WEEKDAYS.map(([n, long]) => [n, long]));
export const WEEKDAY_SHORT: Record<number, string> =
  Object.fromEntries(PLANNER_WEEKDAYS.map(([n, , short]) => [n, short]));

/**
 * s5's actions, in the words a button uses, with the ones this build does not offer marked.
 *
 * NAMED HERE RATHER THAN TYPED INTO A MENU, so that a screen offering an action and an engine
 * implementing it cannot drift apart silently -- the harness asserts every `implemented` key below has
 * an exported function behind it.
 */
export const PLANNER_ACTIONS = [
  { key: "move", label: "Move", implemented: true },
  { key: "duplicate", label: "Duplicate", implemented: true },
  { key: "split", label: "Split", implemented: true },
  { key: "extend", label: "Extend", implemented: true },
  { key: "shorten", label: "Shorten", implemented: true },
  { key: "cancel", label: "Cancel", implemented: true },
  { key: "change_location", label: "Change Location", implemented: true },
  { key: "add_notes", label: "Add Notes", implemented: true },
] as const;

export type PlannerActionKey = (typeof PLANNER_ACTIONS)[number]["key"];

/**
 * s9's Quick Actions, all eight, in s9's own order.
 *
 * ⚠ THIS LIST SHIPPED TWO SHORT AND WAS WRONG FOR A DAY. "Add Travel" and "Add Custom Activity" were
 * withheld here, and the withholding was correct at the time: migration 232's CHECK constraint listed
 * eight types and neither `travel` nor `custom` was among them, so either button would have produced a
 * write the database refused at the moment a practitioner pressed it. MIGRATION 237 then added five
 * types -- meeting, research, leave, travel, custom -- and the refusal became a lie that no test could
 * see, because a list that is too SHORT still satisfies "every key is a real type".
 *
 * The lesson is worth the paragraph: a constant that mirrors a database constraint has to be re-read
 * when the constraint moves, and "every entry is valid" is only half the assertion. The other half is
 * that the specification's list is complete, which is what the harness now checks.
 *
 * The label is s9's and the key is the schema's, so a screen shows the specification's vocabulary over
 * the database's names. teaching, telephone_review, emergency_consult, research and leave have no quick
 * action because s9 gives them none -- they are reached through Add Activity, which offers every type.
 */
export const PLANNER_QUICK_ACTIONS: { key: ActivityType; label: string }[] = [
  { key: "outpatient_clinic", label: "Add Clinic" },
  { key: "ward_round", label: "Add Ward Round" },
  { key: "theatre", label: "Add Theatre" },
  { key: "virtual_clinic", label: "Add Telemedicine" },
  { key: "meeting", label: "Add Meeting" },
  { key: "administration", label: "Add Administration" },
  { key: "travel", label: "Add Travel" },
  { key: "custom", label: "Add Custom Activity" },
];

/**
 * s9's eight labels, so a harness can prove the quick-action list is COMPLETE and not merely valid.
 * Kept beside the list rather than re-typed in a test: a re-typed expectation can shrink along with the
 * thing it is checking and agree with it forever.
 */
export const QUICK_ACTION_LABELS_S9 = [
  "Add Clinic", "Add Ward Round", "Add Theatre", "Add Telemedicine",
  "Add Meeting", "Add Administration", "Add Travel", "Add Custom Activity",
] as const;

/** The four states a planner block can be drawn in. "cancelled" is the one migration 236 adds. */
export const PLANNER_STATE_LABEL: Record<string, string> = {
  planned: "Planned",
  running: "In Progress",
  done: "Finished",
  cancelled: "Cancelled",
};

/**
 * ⚠ HOW THE TRAVEL FIGURE MUST BE LABELLED WHEREVER IT IS DRAWN.
 *
 * The design comp shows "2h 45m Travel Time" on the week header and "20m travel" against a day, in the
 * typography of something measured. It is not measured. It is the sum of
 * practice_location.travel_buffer_minutes (migration 228) -- numbers a practitioner typed once, in a
 * settings screen, about how long it takes them to get to each place. This product holds no map, no
 * route and no feed from anything that does.
 *
 * The distinction is not pedantry: a practitioner who believes the figure was calculated will trust it
 * against their own judgement on a day it is wrong. src/lib/practice/hospital-booking.ts already refuses
 * measured travel by name in HOSPITAL_BOOKING_REFUSES, and every payload out of planner.ts carries
 * `basis: "typed_buffer"` and `measured: false` so a screen cannot render it as anything else by
 * accident.
 */
export const TRAVEL_BASIS_NOTE =
  "Summed from the travel time you entered for each location. Nothing measured a distance.";

/** The heading a Day Summary should use over the travel figure, so it is never labelled as measured. */
export const TRAVEL_BASIS_LABEL = "Travel allowance you set";

export const CONFLICT_LABEL: Record<string, string> = {
  ACTIVITY_OVERLAP: "Two activities at the same time",
  ACTIVITY_TRAVEL_CONFLICT: "Not enough time to get between locations",
  // CP-PLAN-002 s7's "conflict state": a schedule override that lands on top of existing bookings.
  SCHEDULE_OVERRIDE_CONFLICT: "A schedule change affects patients already booked",
};

/** s9's vocabulary over 232's types, for a legend. */
export const activityLabel = (t: string) => ACTIVITY_LABEL[t as ActivityType] ?? t;

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CP-PLAN-002 s3 -- THE TIME NAVIGATOR.
//
// ⚠ THE ARITHMETIC ITSELF LIVES IN period-range.ts AND NOT HERE, because the practice owner asked for
// this control on every screen that reviews data over time, not only on the planner. That module imports
// NOTHING and is deliberately general; this file is the planner's own façade over it, keeping the names
// five components and two harnesses already use.
//
// ⚠ s2 FREEZES ONE PRINCIPLE THAT SHAPES BOTH FILES: "Time range and content filters are separate
// controls." Everything re-exported above the line decides WHICH DAYS ARE READ. Everything below decides
// WHAT IS DRAWN on the days that were read. Nothing lets a content filter change a range or the reverse
// -- a practitioner who ticks "Walk-ins" must not silently be moved to a different fortnight.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export * from "@/lib/practice/period-range";

import {
  PERIOD_VIEWS, PERIOD_VIEW_KEYS, QUICK_PERIODS, DEFAULT_PERIOD_VIEW,
  resolvePeriod, periodLabel, shiftPeriod, isPeriodView, isPeriodDate, PERIOD_DATE_RE,
  type PeriodView, type PeriodRange,
} from "@/lib/practice/period-range";

/** The planner's names for the shared vocabulary. One definition, two spellings, no second copy. */
export const PLANNER_VIEWS = PERIOD_VIEWS;
export const PLANNER_VIEW_KEYS = PERIOD_VIEW_KEYS;
export const PLANNER_QUICK_PERIODS = QUICK_PERIODS;
export const DEFAULT_PLANNER_VIEW = DEFAULT_PERIOD_VIEW;
export const PLANNER_DATE_RE = PERIOD_DATE_RE;
export const plannerPeriod = resolvePeriod;
export const plannerPeriodLabel = periodLabel;
export const shiftPlannerPeriod = shiftPeriod;
export const isPlannerView = isPeriodView;
export const isPlannerDate = isPeriodDate;
export type PlannerView = PeriodView;
export type PlannerPeriod = PeriodRange;
export type PlannerQuickPeriodKey = (typeof QUICK_PERIODS)[number]["key"];

// ── s4: CONTENT CONTROLS. WHAT IS DRAWN, NEVER WHICH DAYS ARE READ ───────────────────────────────────

/**
 * s4's "Show" control, all eight options.
 *
 * ⚠ EACH ONE NAMES A REAL THING IN THIS PRODUCT'S OWN STORES, and where the mapping is not obvious it is
 * written down here rather than in a component:
 *
 *   appointments   practice_appointment rows that are not cancelled and not a no-show.
 *   activities     practice_activity blocks AND the practitioner program's sessions -- s5 calls the row
 *                  "Activities/Sessions" because in this product they are two objects doing one job: the
 *                  session is the regular week, the activity is what was planned onto a date.
 *   available      time inside a generated availability slot that no appointment covers.
 *   follow_ups     appointments of type `scheduled_followup`. NOT practice_follow_up, which is a due date
 *                  and not a time -- a follow-up nobody has booked has no place on a day.
 *   walk_ins       appointments of type `walk_in`.
 *   blocked        availability slots the practice marked BLOCKED or CLOSED, or whose kind is leave,
 *                  blocked or admin -- time that exists and is not for seeing patients.
 *   cancelled      cancelled activities and CANCELLED / NO_SHOW appointments. They are drawn struck
 *                  through and never counted, because CPR-CORE-001 s13 voids rather than deletes.
 */
export const PLANNER_SHOW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "appointments", label: "Appointments" },
  { key: "activities", label: "Activities/Sessions" },
  { key: "available", label: "Available time" },
  { key: "follow_ups", label: "Follow-ups" },
  { key: "walk_ins", label: "Walk-ins" },
  { key: "blocked", label: "Blocked time" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export type PlannerShowKey = (typeof PLANNER_SHOW_OPTIONS)[number]["key"];

/** s4's eight, verbatim, so the list above can be proved complete. See QUICK_ACTION_LABELS_S9. */
export const SHOW_LABELS_S4 = [
  "All", "Appointments", "Activities/Sessions", "Available time", "Follow-ups",
  "Walk-ins", "Blocked time", "Cancelled",
] as const;

export const isPlannerShow = (v: unknown): v is PlannerShowKey =>
  typeof v === "string" && PLANNER_SHOW_OPTIONS.some(o => o.key === v);

/**
 * ⚠ MIGRATION 192'S SEVEN APPOINTMENT TYPES, AND THE LABELS calendar.ts ALREADY DRAWS THEM WITH.
 *
 * Duplicated here rather than imported because calendar.ts is a server engine and a "use client" filter
 * bar importing one string from it drags `next/headers` into the browser bundle -- the failure this whole
 * file exists to prevent. The harness proves the two sets have the SAME KEYS against calendar.ts itself,
 * so the copy cannot drift into offering a type the diary cannot store.
 */
export const APPOINTMENT_TYPE_LABEL: Record<string, string> = {
  new_consultation: "New patient",
  scheduled_followup: "Follow-up",
  hospital_consultation: "Hospital consult",
  teleconsultation: "Telemedicine",
  walk_in: "Walk-in",
  emergency: "Emergency",
  home_visit: "Home visit",
};

export const APPOINTMENT_TYPES: readonly string[] = Object.keys(APPOINTMENT_TYPE_LABEL);

/**
 * Migration 192's six appointment states.
 *
 * ⚠ "WAITING" IS NOT HERE AND ITS ABSENCE IS DELIBERATE. s4 lists "Booked/confirmed, arrived, waiting,
 * completed, cancelled, no-show" -- but `waiting` is a practice_queue_entry state, not an appointment
 * state, and it belongs to somebody who has already arrived and is sitting in the room. Offering it as an
 * appointment filter would return nothing for ever, which is the quietest kind of broken control.
 */
export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  ARRIVED: "Arrived",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "Did not attend",
};

export const APPOINTMENT_STATUSES: readonly string[] = Object.keys(APPOINTMENT_STATUS_LABEL);

/**
 * ⚠ WHICH APPOINTMENTS OCCUPY THEIR TIME. This is the set calendar.ts calls `live`, and it is the set the
 * planner both COUNTS as booked and SUBTRACTS from free time. One set for both, because a session that
 * reported "12 booked" over "12 free" would be describing a clinic that is simultaneously full and empty.
 */
export const APPOINTMENT_STATUSES_BOOKED: readonly string[] =
  ["REQUESTED", "CONFIRMED", "ARRIVED", "COMPLETED"];

/** Voided: on the schedule, struck through, and out of every count. */
export const APPOINTMENT_STATUSES_VOID: readonly string[] = ["CANCELLED", "NO_SHOW"];

/** The slot kinds a patient can actually be seen in. Mirrors patient-booking's list of the same name. */
export const SLOT_KINDS_SEEING_PATIENTS: readonly string[] =
  ["clinic", "telemedicine", "emergency_reserve"];

export const SLOT_KIND_LABEL: Record<string, string> = {
  clinic: "Clinic",
  telemedicine: "Telemedicine",
  emergency_reserve: "Emergency reserve",
  leave: "Leave",
  blocked: "Blocked",
  admin: "Admin",
};

/**
 * ⚠ HOW A FREE COUNT MUST BE LABELLED WHEREVER IT IS DRAWN, for the same reason TRAVEL_BASIS_NOTE exists.
 *
 * The planner's "free" is the practitioner's own diary: the session's window cut into appointment-length
 * steps, minus the steps an appointment already covers. It is NOT what a patient would be offered --
 * booking rules (notice period, horizon, which sessions are open to patients at all) can make fewer of
 * those steps bookable, and only the booking engine applies them. A practitioner told "4 free" who then
 * finds a patient cannot take any of them has been misled by one word.
 */
export const CAPACITY_BASIS_NOTE =
  "Free time in your own diary: the session divided into appointment lengths, less what is already " +
  "booked. Your booking rules may make fewer of these available to patients.";

export const CAPACITY_BASIS_LABEL = "Free in your diary";

/** What a day is, when it holds no program at all. s6: distinct, and NOT an appointment-like record. */
export const DAY_OFF_LABEL = "No program";
export const DAY_UNREADABLE_LABEL = "Could not be read";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ "WHAT HAPPENED ON THAT DAY" -- WHAT THIS PRODUCT CAN ACTUALLY ANSWER, AND WHAT IT CANNOT.
//
// The practice owner, looking at the planner: "I should be able to select any day ... and be able to see
// what was booked for the day AND WHAT HAPPENED ON THAT DAY."
//
// A past day is answered from RECORDED FACTS and from nothing else:
//
//   practice_appointment.status      somebody marked it ARRIVED, COMPLETED, CANCELLED or NO_SHOW.
//   practice_arrival.arrived_at      the time the patient was actually checked in (migration 192).
//   practice_encounter               a consultation was started, finished or signed against it
//                                    (migration 194 -- it carries appointment_id).
//   practice_activity started/ended  the block ran, and when it really started and stopped.
//
// ⚠ AND THE EIGHTH OUTCOME IS THE IMPORTANT ONE: `not_recorded`. A past appointment with no arrival, no
// encounter and a status nobody moved off CONFIRMED means NOBODY WROTE ANYTHING DOWN. It does not mean
// the patient failed to attend, and it does not mean they were seen. Inferring either from the passage
// of time would put a clinical claim on a screen that no human made -- exactly the class of invention
// this product refuses, and the one most likely to be believed because it looks like a record.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** Stated on the payload so a screen can print the gap rather than guess at it. */
export const WHAT_HAPPENED_LIMITS = [
  "Whether a patient was SEEN is read from a recorded encounter or from a status somebody set. A past " +
    "appointment nobody touched reads as 'nothing was recorded' -- never as attended and never as a " +
    "did-not-attend, because this product holds no fact either way.",
  "WHY somebody did not attend is not recorded anywhere in this product, so no reason is shown.",
  "Arrival is matched to an appointment by practice_arrival.appointment_id and is read by the time it " +
    "was recorded. A check-in written down after midnight would sit on the following day.",
  "An encounter is matched by practice_encounter.appointment_id. A consultation started from the " +
    "patient record rather than from the booking carries no appointment id and cannot be attached to " +
    "one here -- it appears on the patient's own record instead.",
  "Nothing clinical is summarised. What was decided, prescribed or found is in the encounter, and this " +
    "screen links to it rather than paraphrasing it.",
];

/**
 * What is known to have happened to one booking. Ordered from the most definite to the least.
 *
 * ⚠ `not_recorded` IS NOT AN ERROR STATE. It is the truthful answer for a past appointment nobody
 * updated, and it is the one a practice can act on -- it is the list of bookings whose outcome was never
 * written down.
 */
export type AppointmentOutcome =
  | "cancelled" | "did_not_attend" | "seen" | "consultation_started"
  | "marked_complete" | "arrived" | "expected" | "not_recorded";

export const OUTCOME_LABEL: Record<AppointmentOutcome, string> = {
  cancelled: "Cancelled",
  did_not_attend: "Did not attend",
  seen: "Seen -- consultation recorded",
  consultation_started: "Consultation started, not finished",
  marked_complete: "Marked complete, no consultation recorded",
  arrived: "Arrived",
  expected: "Expected",
  not_recorded: "Nothing was recorded",
};

/** Furthest-along wins when one booking somehow carries more than one encounter. */
export const ENCOUNTER_RANK =
  ["ENTERED_IN_ERROR", "CANCELLED", "DRAFT", "PAUSED", "ACTIVE", "COMPLETED", "AMENDED", "SIGNED"];

const ENCOUNTER_FINISHED = ["COMPLETED", "SIGNED", "AMENDED"];
const ENCOUNTER_LIVE = ["DRAFT", "ACTIVE", "PAUSED"];

/**
 * ⚠ THE ORDER OF THESE TESTS IS THE WHOLE RULE. Each one asks "what does this product actually KNOW",
 * and the last two are the difference between a screen that reports and a screen that guesses.
 */
export function appointmentOutcome(a: {
  status: string; date: string; todayDate: string;
  arrived: boolean; encounterStatus: string | null;
}): AppointmentOutcome {
  if (a.status === "CANCELLED") return "cancelled";
  if (a.status === "NO_SHOW") return "did_not_attend";
  if (a.encounterStatus && ENCOUNTER_FINISHED.includes(a.encounterStatus)) return "seen";
  if (a.encounterStatus && ENCOUNTER_LIVE.includes(a.encounterStatus)) return "consultation_started";
  // ⚠ COMPLETED WITHOUT AN ENCOUNTER IS NOT "SEEN". Somebody moved the booking on; no clinical record
  // was made. Both halves are true and a practice needs to know which of them it is looking at.
  if (a.status === "COMPLETED") return "marked_complete";
  if (a.arrived || a.status === "ARRIVED") return "arrived";
  // ⚠ AND THE LAST TWO ARE THE ONES THAT MUST NOT BE MERGED. A booking that has not happened yet is
  // EXPECTED. A booking whose day has passed with nothing written down is NOT RECORDED -- it is not a
  // did-not-attend, because nobody said so.
  if (a.date >= a.todayDate) return "expected";
  return "not_recorded";
}

// ── THE CONTENT FILTER ITSELF ────────────────────────────────────────────────────────────────────────
//
// ⚠ THE RULE LIVES HERE AND THE SCREEN CALLS IT. A harness that re-implements the predicate it is testing
// stays green under every break to the real one -- this codebase has shipped that -- so there is exactly
// one `appointmentPasses`, one `activityPasses` and one `sessionPasses`, and the screen, the counts and
// the harness all go through them.
//
// ⚠ THE ARGUMENTS ARE STRUCTURAL, not the engine's types. planner.ts imports this file, so this file
// cannot import planner.ts. Each predicate takes the fields it actually reads, which also means a harness
// can call it with a literal and prove the rule without a database.

export type PlannerFilters = {
  show: PlannerShowKey;
  locationId: string | null;
  activityType: string | null;
  appointmentType: string | null;
  status: string | null;
  /** Free text over patient name, location and activity/session -- s4's "Search schedule". */
  query: string;
};

export const NO_PLANNER_FILTERS: PlannerFilters = {
  show: "all", locationId: null, activityType: null, appointmentType: null, status: null, query: "",
};

/** True when anything is narrowing the view, so a screen can offer to clear it. s22's "reset filters". */
export const plannerFiltersActive = (f: PlannerFilters): boolean =>
  f.show !== "all" || !!f.locationId || !!f.activityType || !!f.appointmentType || !!f.status
  || f.query.trim().length > 0;

const hay = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" ").toLowerCase();

const matchesQuery = (f: PlannerFilters, text: string) => {
  const q = f.query.trim().toLowerCase();
  return q.length === 0 || text.includes(q);
};

export function appointmentPasses(f: PlannerFilters, a: {
  appointmentType: string; status: string; locationId: string | null; locationName: string | null;
  voided: boolean; isWalkIn: boolean; isFollowUp: boolean; patientName: string; reason: string | null;
  typeLabel?: string;
}): boolean {
  switch (f.show) {
    case "all": break;
    case "appointments": if (a.voided) return false; break;
    case "follow_ups": if (!a.isFollowUp || a.voided) return false; break;
    case "walk_ins": if (!a.isWalkIn || a.voided) return false; break;
    case "cancelled": if (!a.voided) return false; break;
    // The three that are about time rather than about people show no appointments at all.
    case "activities": case "available": case "blocked": return false;
  }
  if (f.locationId && a.locationId !== f.locationId) return false;
  if (f.appointmentType && a.appointmentType !== f.appointmentType) return false;
  if (f.status && a.status !== f.status) return false;
  // ⚠ AN ACTIVITY-TYPE FILTER HIDES APPOINTMENTS, and that is the honest reading: "show me only my
  // theatre lists" is a request about blocks of the practitioner's time, and appointments do not carry
  // an activity type at all. Answering it by leaving every appointment on the screen would ignore the
  // control the practitioner just used.
  if (f.activityType) return false;
  return matchesQuery(f, hay(a.patientName, a.locationName, a.reason, a.typeLabel, a.appointmentType));
}

export function activityPasses(f: PlannerFilters, a: {
  activityType: string; title: string; state: string;
  locationId: string | null; locationName: string | null; label?: string;
}): boolean {
  const cancelled = a.state === "cancelled";
  switch (f.show) {
    case "all": break;
    case "activities": if (cancelled) return false; break;
    case "cancelled": if (!cancelled) return false; break;
    case "appointments": case "follow_ups": case "walk_ins": case "available": case "blocked":
      return false;
  }
  if (f.locationId && a.locationId !== f.locationId) return false;
  if (f.activityType && a.activityType !== f.activityType) return false;
  // An appointment-type or status filter is a question about bookings; a block of the practitioner's
  // own time cannot answer it, so it drops out rather than pretending to match.
  if (f.appointmentType || f.status) return false;
  return matchesQuery(f, hay(a.title, a.locationName, a.label, a.activityType));
}

export function sessionPasses(f: PlannerFilters, s: {
  slotKind: string; status: string; locationId: string | null; locationName: string | null;
  blocked: boolean; available: number | null; note?: string | null; slotKindLabel?: string;
}): boolean {
  switch (f.show) {
    case "all": break;
    case "activities": break;
    // ⚠ "Available time" MEANS TIME THAT IS ACTUALLY FREE, so a session whose free count could not be
    // worked out is NOT shown here. Showing it would put a session with unknown availability in a list
    // headed "available", which is the one place the unknown must not be read as a yes.
    case "available": if (s.blocked || (s.available ?? 0) <= 0) return false; break;
    case "blocked": if (!s.blocked) return false; break;
    case "appointments": case "follow_ups": case "walk_ins": case "cancelled": return false;
  }
  if (f.locationId && s.locationId !== f.locationId) return false;
  if (f.appointmentType || f.status || f.activityType) return false;
  return matchesQuery(f, hay(s.slotKindLabel, s.slotKind, s.locationName, s.note));
}
