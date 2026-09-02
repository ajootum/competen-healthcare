// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s4.3 -- THE VOCABULARY OF A PRACTICE SESSION, in a file that touches no database.
//
// It lives apart from practice-sessions.ts for the reason encounter-constants.ts and
// activity-constants.ts already exist: practice-sessions.ts imports access.ts, which imports
// `next/headers`, and a "use client" component importing so much as a string from it drags that chain
// into the browser bundle and `next build` fails. tsc and eslint do not catch it. The rule, restated:
// A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE DATABASE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import { ACTIVITY_TYPES, ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";

/**
 * s4.3's "Activity type", and it is NOT a new list.
 *
 * ⚠ s4.4's last line: "Confirmed Current Activity inherits the session location, activity type and
 * expected patient context." A session typed with a word practice_activity's CHECK rejects is a session
 * nobody can start -- so the vocabulary is migration 237's thirteen, re-exported rather than restated.
 * Migration 240's own CHECK lists the same thirteen and the three must be widened together.
 *
 * The specification's own column names nine ("Outpatient, inpatient review, procedure, virtual,
 * outreach, teaching, administration, personal, other"), which is a DIFFERENT vocabulary from the one
 * the activity engine enforces. Following the document here would have produced a session whose
 * activity type the activity table refuses. The document is describing the shape of the field, not
 * legislating the values; the database is legislating the values.
 */
export const SESSION_ACTIVITY_TYPES = ACTIVITY_TYPES;
export const SESSION_ACTIVITY_LABEL = ACTIVITY_LABEL;
export type SessionActivityType = ActivityType;

/**
 * s4.3 "Booking enabled -- public, link-only, internal-only or none", and s8's four modes.
 *
 * ⚠ `none` IS THE DEFAULT AND THAT IS A SAFETY PROPERTY, not a tidiness one. Migration 240 defaults the
 * column to 'none' for exactly this reason: nothing in the schema can know which of the sessions that
 * already exist a practitioner would be willing to expose, and defaulting to bookable would publish
 * somebody's ward round the moment a patient-facing page went live.
 *
 * `phase` records which implementation phase makes the mode DO anything. Phase 1 builds the field and
 * the internal reading of it; `link_only` and `public` need s8's patient-facing access service, which
 * is Phase 4 and is not started. They are therefore recorded as choices and rendered as not-yet-built
 * rather than offered as working switches -- a mode that says "patients may book" while no patient can
 * reach anything is worse than the absence, because the practice believes it is open.
 */
export const BOOKING_MODES = [
  {
    code: "none", label: "Not bookable",
    blurb: "Nobody may book into this session. Time you have set aside for yourself.",
    phase: 1,
  },
  {
    code: "internal", label: "Internal only",
    blurb: "You and authorised staff may book patients in. No patient-facing route exists.",
    phase: 1,
  },
  {
    code: "link_only", label: "Link only",
    blurb: "Reachable through a private link you share. Needs the patient booking page.",
    phase: 4,
  },
  {
    code: "public", label: "Public",
    blurb: "Discoverable on a public booking page. Needs the patient booking page.",
    phase: 4,
  },
] as const;

export type BookingMode = (typeof BOOKING_MODES)[number]["code"];

/**
 * ⚠ THE MODES THAT NEED NO PATIENT-FACING SURFACE -- i.e. the INTERNAL ones. Read the name carefully.
 *
 * It was documented as "the modes Phase 1 can honour", and while Phase 4 was unbuilt those were the same
 * set. They are not the same set any more: `link_only` and `public` are honoured now, and this list has
 * deliberately NOT grown to include them.
 *
 * ⚠ THE REASON IS THAT THREE READERS DEPEND ON THE COMPLEMENT MEANING "PATIENT-BOOKABLE".
 * patient-access.ts derives NO_BOOKABLE_SESSION, sessionsOpenedToPatients and the SESSION_BOOKABLE
 * publish check from `!BOOKING_MODES_LIVE.includes(mode)`. Adding the patient-facing modes here would
 * make every one of them silently answer "no session is open to patients" for a practice whose sessions
 * are all open to patients -- a wrong nought on the screen that decides whether a page may publish.
 *
 * So the membership is unchanged and the DOCUMENTATION is what moved. `phase` on each mode is history:
 * which release first honoured it, not what is honoured today.
 */
export const BOOKING_MODES_LIVE: BookingMode[] = BOOKING_MODES
  .filter(m => m.phase === 1).map(m => m.code);

/**
 * ⚠ THE MODES THAT ADMIT A PATIENT, DEFINED AS THE COMPLEMENT OF THE LIST ABOVE RATHER THAN AS A PAIR.
 *
 * `link_only` and `public` today. It is written as `!BOOKING_MODES_LIVE.includes(...)` -- the very
 * expression patient-access.ts already applies three times for NO_BOOKABLE_SESSION,
 * sessionsOpenedToPatients and the SESSION_BOOKABLE publish check -- so there is ONE definition of
 * "patient-bookable" in this product and a fourth reader cannot drift from the other three.
 *
 * ⚠ AND IT IS WHY BOOKING_MODES_LIVE's MEMBERSHIP MUST NOT MOVE. Adding the patient-facing modes to that
 * list to express "these are honoured now" would empty this one, and the three readers above would
 * silently answer "no session is open to patients" for a practice whose sessions are all open. The
 * documentation on BOOKING_MODES_LIVE moved for exactly that reason; the membership did not, and this
 * constant is what a reader asking "may a patient book this session" should use instead.
 */
export const BOOKING_MODES_PATIENT_FACING: BookingMode[] = BOOKING_MODES
  .map(m => m.code).filter(c => !BOOKING_MODES_LIVE.includes(c));

/** Whether a stored `booking_mode` admits a patient at all. An unknown mode is NOT patient-facing. */
export const isPatientFacingMode = (code: string | null | undefined): boolean =>
  BOOKING_MODES_PATIENT_FACING.includes((code ?? "none") as BookingMode);

/**
 * ⚠ THE MODES A PRACTITIONER OR THEIR STAFF MAY BOOK A PATIENT INTO -- CP-SCHED-001 s5 step 6's
 * "channel rules: self-bookable, STAFF-ONLY, minimum notice...".
 *
 * ⚠ `internal` EXISTS FOR EXACTLY THIS CHANNEL AND WAS BEING FILTERED OUT OF EVERY AVAILABILITY READ.
 * Its own blurb above says it: "You and authorised staff may book patients in. No patient-facing route
 * exists." Until the registration card there was no staff-channel availability read at all, so the only
 * consumer of a computed session list was the patient page -- and `internal` correctly never appeared on
 * it. Reusing that patient-channel read at the registration desk would have hidden four fifths of a real
 * practice's diary from the person sitting in it.
 *
 * ⚠ `none` IS NEVER IN THIS LIST, and that is the whole reason it is written as a subtraction from
 * BOOKING_MODES rather than as the literal triple ["internal", "link_only", "public"]. `none` is "time
 * you have set aside for yourself" -- the one mode whose meaning is that NOBODY books into it, including
 * the practitioner's own desk. A literal list is a list somebody extends; a subtraction states the rule.
 *
 * ⚠ AND IT IS DELIBERATELY NOT THE COMPLEMENT OF ANYTHING. isPatientFacingMode is the complement of
 * BOOKING_MODES_LIVE, and the two predicates are NOT opposites: link_only and public are true for BOTH,
 * because a session a patient may book is also a session the practice may book into.
 */
export const BOOKING_MODES_STAFF_BOOKABLE: BookingMode[] = BOOKING_MODES
  .map(m => m.code).filter(c => c !== "none");

/** Whether a stored `booking_mode` admits a staff/practitioner booking. An unknown mode does not. */
export const isStaffBookableMode = (code: string | null | undefined): boolean =>
  BOOKING_MODES_STAFF_BOOKABLE.includes((code ?? "none") as BookingMode);

export const bookingModeLabel = (code: string) =>
  BOOKING_MODES.find(m => m.code === code)?.label ?? code;

/**
 * s4.5's appointment types.
 *
 * ⚠ THESE ARE migration 192's CHECK ON practice_appointment.appointment_type, VERBATIM. A session
 * offering a type no appointment may carry is an offer the booking engine cannot fulfil -- and
 * migration 240's join table stores free text, so nothing in the database would refuse it.
 *
 * The specification asks for a reusable appointment-type MODULE with its own duration, visibility,
 * required fields and confirmation mode (s4.5). That module does not exist here: the seven types are a
 * closed list with a colour and a label, and the duration comes from the practice default. Sessions may
 * therefore LINK to a type, which is what s4.3 needs ("zero means not patient-bookable"), and the
 * richer type definition stays honestly absent.
 */
export const SESSION_APPOINTMENT_TYPES = [
  ["new_consultation", "New patient"],
  ["scheduled_followup", "Follow-up"],
  ["hospital_consultation", "Hospital consult"],
  ["teleconsultation", "Telemedicine"],
  ["walk_in", "Walk-in"],
  ["emergency", "Emergency"],
  ["home_visit", "Home visit"],
] as const;

export const appointmentTypeLabel = (code: string) =>
  SESSION_APPOINTMENT_TYPES.find(([c]) => c === code)?.[1] ?? code;

/**
 * CPR-BOOK-FLOW-002 §5: "Show patient-friendly name and short description."
 *
 * ⚠ THESE ARE DEFINITIONS OF THE LABEL, NOT FACTS ABOUT ANY PRACTICE. "First time seeing this
 * practitioner" restates what `new_consultation` means; it claims nothing this practice has configured.
 * That distinction is the reason the comp's per-type DURATIONS are not built beside them: appointment
 * length is one workspace-level value in this product, not a per-type one, so "60 minutes" on New
 * patient and "30 minutes" on Follow-up would be two invented numbers sitting next to a real name. The
 * one real duration is shown once, from the availability response, where it is true.
 */
export const APPOINTMENT_TYPE_BLURB: Record<string, string> = {
  new_consultation: "First time seeing this practitioner",
  scheduled_followup: "A review after a previous visit",
  hospital_consultation: "A consultation at the hospital",
  teleconsultation: "Seen online rather than in person",
  walk_in: "Seen without a fixed appointment time",
  emergency: "Urgent, for something that cannot wait",
  home_visit: "Seen at home",
};

export const WEEKDAY_SHORT = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export const WEEKDAY_LONG = [
  "", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;

/**
 * s4.3: "Session name -- human-readable; SUGGESTED from location + activity + day."
 *
 * A SUGGESTION, RETURNED TO THE SCREEN, NEVER WRITTEN BY THE ENGINE. Migration 240 leaves session_name
 * nullable and says why: a suggestion written into the database becomes a name nobody chose, and the
 * next person to read it cannot tell it from one somebody typed.
 */
export function suggestSessionName(args: {
  locationName: string | null; activityType: string | null; weekday: number;
}): string {
  const day = WEEKDAY_LONG[args.weekday] ?? "";
  const activity = args.activityType
    ? SESSION_ACTIVITY_LABEL[args.activityType as SessionActivityType] ?? null
    : null;
  return [args.locationName, day, activity].filter(Boolean).join(" ") || `${day} session`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLOUR.
//
// ⚠ THESE BELONG IN palette.ts AND ARE NOT THERE, because that file is being edited by somebody else in
// this session and two agents writing one module is how a palette ends up with two answers for amber.
// They are REQUESTED for it by name in the handover, and they are written to palette.ts's own contract
// -- the exported CardSwatch type, and its rule that a card gets three things: a tinted box, a tinted
// icon badge, AND THE FIGURE IN THE CARD'S OWN HUE. Every hue below is one palette.ts already uses for
// the same meaning; nothing new is invented.
//
// The last screen built here came back grey and the user's words were "the colors are flat". palette.ts
// records the same note four times. It is a legibility decision: three domain cards a practitioner
// scans in the first seconds of a setup session must be FOUND, not READ left to right.
// ────────────────────────────────────────────────────────────────────────────────────────────────────









// The swatches moved to palette.ts (see its Setup/Availability section). RE-EXPORTED rather than
// re-declared, so consumers keep their import and there is exactly ONE definition of each colour.
export {
  SETUP_DOMAIN_SWATCH,
  SETUP_HOME_SWATCH,
  SETUP_READINESS_BADGE,
  DOMAIN_STATE_CHIP,
  MODULE_STATE_CHIP,
  READINESS_SWATCH,
  LAYER_SWATCH,
  LAYER1_STAT_SWATCH,
  ACTIVITY_HUE,
  ACTIVITY_HUE_UNSET,
} from "@/lib/practice/palette";
