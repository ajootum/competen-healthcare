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

/** The modes Phase 1 can honour. Anything else is stored, shown, and said to be unreachable. */
export const BOOKING_MODES_LIVE: BookingMode[] = BOOKING_MODES
  .filter(m => m.phase === 1).map(m => m.code);

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
  DOMAIN_STATE_CHIP,
  MODULE_STATE_CHIP,
  READINESS_SWATCH,
  LAYER_SWATCH,
  LAYER1_STAT_SWATCH,
  ACTIVITY_HUE,
  ACTIVITY_HUE_UNSET,
} from "@/lib/practice/palette";
