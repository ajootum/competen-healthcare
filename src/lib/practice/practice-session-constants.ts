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
import type { CardSwatch } from "@/lib/practice/palette";

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

/**
 * CPR-V5-008's three domains.
 *
 *   foundation      emerald -- who you are and where you work. Settled facts, and the only domain whose
 *                              completion is unambiguously good news. palette.ts's growth hue.
 *   operations      indigo  -- the practice's primary. How the practice RUNS day to day, which is the
 *                              live-work hue everywhere else in this product.
 *   administration  violet  -- people and systems around the clinical work. palette.ts's hue for the
 *                              unplanned and the organisational.
 */
export const SETUP_DOMAIN_SWATCH: Record<string, CardSwatch> = {
  foundation: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "⌂", caption: "text-emerald-800/70",
  },
  operations: {
    badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]",
    box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.06]", accent: "bg-[var(--cp-primary)]",
    icon: "▦", caption: "text-[var(--cp-primary-deep)]/70",
  },
  administration: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⚇", caption: "text-violet-800/70",
  },
};

/**
 * s7's four progress states, plus the two this build needs and s7 does not have.
 *
 * ⚠ `unreadable` IS NOT A DESIGN ADDITION, IT IS THE FIRST DOCTRINE. A domain whose configuration could
 * not be read is not a domain with nothing in it, and drawing it as NOT STARTED would tell somebody to
 * go and configure something that may already be configured. Slate, dashed, and it says so.
 * `unavailable` is the same distinction for a domain whose every module this caller may not open.
 */
export const DOMAIN_STATE_CHIP: Record<string, { label: string; chip: string; dot: string }> = {
  complete: { label: "Complete", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  in_progress: { label: "In progress", chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", dot: "bg-[var(--cp-primary)]" },
  needs_attention: { label: "Needs attention", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  not_started: { label: "Not started", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-300" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500 ring-1 ring-dashed ring-slate-300", dot: "bg-slate-300" },
  unavailable: { label: "Not yours to change", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
};

/** Module chips on the domain cards. The setup hub's four states plus the read failure. */
export const MODULE_STATE_CHIP: Record<string, { label: string; chip: string; dot: string; mark: string }> = {
  configured: { label: "Configured", chip: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", mark: "✓" },
  needs_attention: { label: "Needs attention", chip: "bg-amber-100 text-amber-700", dot: "bg-amber-500", mark: "!" },
  not_built: { label: "Not built", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300", mark: "–" },
  no_access: { label: "No access", chip: "bg-slate-100 text-slate-400", dot: "bg-slate-300", mark: "⚿" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300", mark: "?" },
};

/**
 * s7's four readiness indicators.
 *
 * Emerald when met and slate when not -- deliberately NOT amber. An unmet readiness indicator is a
 * statement of where the practice has got to, not a fault; amber would make "you have not published a
 * booking page" read as a problem for a practitioner who never intends to.
 */
export const READINESS_SWATCH = {
  met: { ring: "text-emerald-600", label: "text-emerald-900", mark: "✓" },
  unmet: { ring: "text-slate-300", label: "text-slate-600", mark: "○" },
  unreadable: { ring: "text-slate-300", label: "text-slate-500", mark: "?" },
} as const;

/** The three layer cards of CPR-V5-007 s3.2, numbered as the specification numbers them. */
export const LAYER_SWATCH: Record<string, CardSwatch> = {
  regular_practice: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "▤", caption: "text-emerald-800/70",
  },
  changes: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "⚑", caption: "text-amber-800/70",
  },
  patient_booking: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⚭", caption: "text-violet-800/70",
  },
};

/** Layer 1's four summary figures, in the comp's order and hues. */
export const LAYER1_STAT_SWATCH: Record<string, { badge: string; figure: string; icon: string }> = {
  locations: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]", icon: "◎" },
  sessions: { badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700", icon: "▦" },
  appointment_types: { badge: "bg-violet-100 text-violet-700", figure: "text-violet-700", icon: "⚭" },
  capacity: { badge: "bg-amber-100 text-amber-700", figure: "text-amber-700", icon: "☰" },
};

/**
 * Session cards on the weekly board, coloured BY ACTIVITY TYPE rather than by column.
 *
 * The comp's legend reads "Outpatient Clinic · Inpatient · Virtual · Procedure · Day off" -- five
 * colours over what a session IS, which is the only thing on that board worth a colour. Colouring by
 * weekday would make Monday green because it is first.
 */
export const ACTIVITY_HUE: Record<string, string> = {
  outpatient_clinic: "var(--cp-success)",
  ward_round: "#7C3AED",
  theatre: "var(--cp-accent)",
  emergency_consult: "var(--cp-error)",
  virtual_clinic: "var(--cp-warning)",
  telephone_review: "var(--cp-info)",
  administration: "var(--cp-slate-500)",
  teaching: "var(--cp-info)",
  meeting: "var(--cp-slate-500)",
  research: "var(--cp-info)",
  leave: "var(--cp-warning)",
  travel: "var(--cp-slate-500)",
  custom: "var(--cp-primary)",
};

/** A session nobody has typed yet. Grey, and it must stay grey: it is an absence, not a kind of work. */
export const ACTIVITY_HUE_UNSET = "var(--cp-slate-400)";
