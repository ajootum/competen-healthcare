// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s5 -- THE VOCABULARY OF A SCHEDULE CHANGE, in a file that touches no database.
//
// It lives apart from schedule-exceptions.ts for the reason practice-session-constants.ts already gives:
// schedule-exceptions.ts imports provisioning.ts and the workspace context, and a "use client" component
// importing so much as a string from it drags that chain into the browser bundle and `next build` fails.
// tsc and eslint do NOT catch it. The rule, restated:
// A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE DATABASE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import type { CardSwatch } from "@/lib/practice/palette";

/**
 * s5.2's SIX CATEGORIES, expressed as the SEVEN VALUES migration 242's CHECK allows.
 *
 * ⚠ THE COUNTS DIFFER ON PURPOSE. s5.2's "Unavailable" row covers leave, conference, public holiday and
 * illness; migration 230 had already split that into `leave` and `closure`, and the two remain usefully
 * different to a practitioner reading their own calendar. Renaming them onto the specification's word
 * list would have rewritten every existing row and every existing reader for a tidier vocabulary.
 *
 * `effect` is what the change does to the diary, and it is the only field the generator reads:
 *
 *   removes    the time goes. Leave, closure and an emergency interruption all end with a day, or part
 *              of one, that nobody can be seen in.
 *   adds       time appears that the regular week does not contain. Nobody who is already booked can be
 *              stranded by time being ADDED, which is why these two carry `impacts: false`.
 *   reshapes   the session still runs, somewhere else or as something else. This is the category that
 *              did not exist before migration 242, and it is the one that most easily strands a patient
 *              silently: the appointment stays in the diary and the clinic underneath it has moved.
 */
export const EXCEPTION_KINDS = [
  {
    code: "leave", label: "Leave or holiday", effect: "removes", impacts: true,
    specRow: "Unavailable",
    blurb: "You are away. The whole day goes, or the part of it you name.",
    needsWindow: false, needsReplacementLocation: false, needsReplacementActivity: false,
  },
  {
    code: "closure", label: "Temporary closure", effect: "removes", impacts: true,
    specRow: "Unavailable",
    blurb: "The place is shut. Everything scheduled there stops for those dates.",
    needsWindow: false, needsReplacementLocation: false, needsReplacementActivity: false,
  },
  {
    code: "emergency_interruption", label: "Emergency interruption", effect: "removes", impacts: true,
    specRow: "Emergency interruption",
    blurb: "Urgent theatre, an emergency consult or an unexpected absence. Availability stops now.",
    // ⚠ true BECAUSE THE DATABASE INSISTS, not because s5.2 does. See the note under EXCEPTION_KINDS.
    // ⚠ FALSE AGAIN AS OF MIGRATION 243. This was true only because 230's window_check still listed
    // the two kinds that existed when it was written, so the database refused a whole-day version of
    // this. 243 widened that check, and "I am away and the whole day is gone" is expressible again --
    // which is the ordinary case, not the edge one. A window remains OPTIONAL and valid.
    needsWindow: false, needsReplacementLocation: false, needsReplacementActivity: false,
  },
  {
    code: "extra_session", label: "One-off session", effect: "adds", impacts: false,
    specRow: "Extra session",
    blurb: "A catch-up or outreach clinic on a day your regular week does not cover.",
    needsWindow: true, needsReplacementLocation: false, needsReplacementActivity: false,
  },
  {
    code: "extended_hours", label: "Extended hours", effect: "adds", impacts: false,
    specRow: "Extra session",
    blurb: "You are working longer than usual. Extra time, nothing taken away.",
    needsWindow: true, needsReplacementLocation: false, needsReplacementActivity: false,
  },
  {
    code: "location_change", label: "Location change", effect: "reshapes", impacts: true,
    specRow: "Location change",
    blurb: "The session still runs, somewhere else. Everyone booked is expecting the old address.",
    // ⚠ FALSE AGAIN AS OF MIGRATION 243. This was true only because 230's window_check still listed
    // the two kinds that existed when it was written, so the database refused a whole-day version of
    // this. 243 widened that check, and "I am away and the whole day is gone" is expressible again --
    // which is the ordinary case, not the edge one. A window remains OPTIONAL and valid.
    needsWindow: false, needsReplacementLocation: true, needsReplacementActivity: false,
  },
  {
    code: "activity_substitution", label: "Activity substitution", effect: "reshapes", impacts: true,
    specRow: "Activity substitution",
    blurb: "The clinic becomes theatre, a ward round or something else. Nobody can be booked into it.",
    // ⚠ FALSE AGAIN AS OF MIGRATION 243. This was true only because 230's window_check still listed
    // the two kinds that existed when it was written, so the database refused a whole-day version of
    // this. 243 widened that check, and "I am away and the whole day is gone" is expressible again --
    // which is the ordinary case, not the edge one. A window remains OPTIONAL and valid.
    needsWindow: false, needsReplacementLocation: false, needsReplacementActivity: true,
  },
] as const;

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY THE THREE NEW KINDS ALL CARRY `needsWindow: true`, AND IT IS NOT A DESIGN DECISION.
//
// supabase/migrations/230-practice-availability-configuration.sql:137-142 constrains the table:
//
//     check ((kind in ('leave', 'closure'))
//            or (starts_minute is not null and ends_minute is not null and ends_minute > starts_minute))
//
// Migration 242 widened `kind` from four values to seven and did NOT widen that constraint, so a
// location change, an activity substitution or an emergency interruption with no window is rejected by
// the database with a constraint name rather than a sentence. Requiring a window in the engine means
// the practitioner is asked for a start and an end instead of being shown
// "practice_availability_exception_window_check".
//
// It is a workaround and not a fix. The fix is one line in a migration -- adding the three kinds to
// that check's first clause -- and migrations are not this build's to write. Until then, "I am away
// from two o'clock" is expressible and "I am away, and the whole day is gone" is not, for these three.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]["code"];

export const EXCEPTION_KIND_CODES: string[] = EXCEPTION_KINDS.map(k => k.code);

/** The three that take time away. The generator must be able to tell these from the ones that add it. */
export const REMOVES_TIME: string[] = EXCEPTION_KINDS.filter(k => k.effect === "removes").map(k => k.code);
/** The two that add time. Nobody already booked can be stranded by time appearing. */
export const ADDS_TIME: string[] = EXCEPTION_KINDS.filter(k => k.effect === "adds").map(k => k.code);
/** The two that leave the session running but change what or where it is. */
export const RESHAPES_TIME: string[] = EXCEPTION_KINDS.filter(k => k.effect === "reshapes").map(k => k.code);

/**
 * ⚠ WHICH KINDS CAN STRAND A PATIENT. Read by the impact calculation, and it is a DERIVATION rather than
 * a list somebody maintains: a kind that adds time cannot disturb an existing booking, and every other
 * kind can. Adding an eighth kind therefore gets the impact workflow by default, which is the safe
 * direction to be wrong in.
 */
export const IMPACTING_KINDS: string[] = EXCEPTION_KINDS.filter(k => k.impacts).map(k => k.code);

export const exceptionKind = (code: string) => EXCEPTION_KINDS.find(k => k.code === code) ?? null;
export const exceptionKindLabel = (code: string) =>
  exceptionKind(code)?.label ?? code.replace(/_/g, " ");

/**
 * s5.3's SIX RESOLUTION OPTIONS, exactly as the specification names them, and exactly as migration 242's
 * CHECK constraint stores them.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ `keep_pending` IS NOT RESOLVED, AND THE DATABASE ENFORCES IT.
 *
 * Choosing to park something IS a decision -- it is one of s5.3's five options for a reason -- but it is
 * not a resolution. Collapsing the two would let a practitioner clear the action queue by deciding to do
 * nothing about it, and the queue is the entire feature. `resolves` below is the same fact migration
 * 242's practice_affected_resolved_consistent check states in SQL, and neither is allowed to move
 * without the other.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `built` records whether this build can DO the thing rather than merely store the word. The three that
 * are not built are refused by the engine with the reason named -- the same treatment Layer 1 gives the
 * booking modes that need the patient booking page. A resolution that stores a decision nothing acts on
 * is worse than an absent one, because the queue then shows the patient as handled.
 */
export const RESOLUTIONS = [
  {
    code: "keep_pending", label: "Keep pending", resolves: false, built: true,
    scope: "both" as const,
    blurb: "Leave them unresolved. They stay in the action queue, by name, until somebody decides.",
    detail: "s5.3: \"Bookings remain unresolved and appear in an action queue\".",
  },
  {
    code: "cancel_and_notify", label: "Cancel the appointment", resolves: true, built: true,
    scope: "both" as const,
    blurb: "Cancel with the reason recorded. You will still need to tell the patient yourself.",
    detail: "s5.3 asks this to \"trigger configured message\". Message templates and delivery belong to Notifications configuration (s7.2) and are not built, so the cancellation is real and the message is not.",
  },
  {
    code: "bulk_reschedule", label: "Moved to another appointment", resolves: true, built: true,
    scope: "per_booking" as const,
    blurb: "You have already moved this patient in the calendar. Point at the new appointment to close it.",
    detail: "s5.3: \"User selects another session and confirms patient-by-patient exceptions\" -- so it is a per-patient decision, never a strategy applied to a group.",
  },
  {
    code: "offer_next_available", label: "Offer next available", resolves: true, built: false,
    scope: "per_booking" as const,
    blurb: "Generate eligible alternatives from the same rule and appointment type.",
    detail: "Needs the booking rules engine of s7 to generate and hold offered alternatives. That is Phase 3, and nothing here would send the offer.",
  },
  {
    code: "waiting_list", label: "Move to waiting list", resolves: true, built: false,
    scope: "per_booking" as const,
    blurb: "Preserve priority and the original due date.",
    detail: "There is no waiting list in this schema -- practice_appointment has no wait-listed status and no priority. Storing the word would make a patient look parked somewhere that does not exist.",
  },
  {
    code: "no_patient_impact", label: "No patient impact", resolves: true, built: true,
    scope: "commit" as const,
    blurb: "Nobody is booked into the time being changed.",
    detail: "s5.3: \"Allowed only when no active booking is affected\" -- so the engine refuses it the moment the count is above nought, and requires it when the count is nought.",
  },
] as const;

export type ResolutionCode = (typeof RESOLUTIONS)[number]["code"];

export const resolution = (code: string) => RESOLUTIONS.find(r => r.code === code) ?? null;
export const resolutionLabel = (code: string) =>
  resolution(code)?.label ?? code.replace(/_/g, " ");

/** Resolutions this build can act on. The rest are stored words, and are refused rather than stored. */
export const RESOLUTIONS_BUILT: string[] = RESOLUTIONS.filter(r => r.built).map(r => r.code);
/** Resolutions that may be applied to every affected booking at once, when the change is committed. */
export const RESOLUTIONS_AT_COMMIT: string[] = RESOLUTIONS
  .filter(r => r.built && (r.scope === "commit" || r.scope === "both")).map(r => r.code);
/** Resolutions that may be chosen for ONE booking in the action queue. */
export const RESOLUTIONS_PER_BOOKING: string[] = RESOLUTIONS
  .filter(r => r.built && (r.scope === "per_booking" || r.scope === "both")).map(r => r.code);

/**
 * The appointment statuses that are a REAL PERSON EXPECTING TO BE SEEN.
 *
 * ⚠ CANCELLED, NO_SHOW AND COMPLETED ARE NOT HERE, and that is the difference between a count somebody
 * can act on and a count that inflates itself with history. Cancelling a Friday clinic does not strand
 * the patient who cancelled on Tuesday, and reporting that it does teaches a practitioner to ignore the
 * number. The same three statuses that block a session deletion in practice-sessions.ts, deliberately:
 * two answers to "is this a live booking" is one answer too many.
 */
export const LIVE_BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "ARRIVED"];

/** hh:mm from a minute of the day. Pure, so a client component may have it. */
export const hhmmOfDay = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m) % 60).padStart(2, "0")}`;

/** Every date from `from` to `to` inclusive, as YYYY-MM-DD. Capped, because a typo is a year. */
export function exceptionDates(fromDate: string, toDate: string, cap = 400): string[] {
  const out: string[] = [];
  const end = Date.parse(`${toDate}T12:00:00Z`);
  for (let t = Date.parse(`${fromDate}T12:00:00Z`); t <= end && out.length < cap; t += 86400000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLOUR.
//
// ⚠ REQUESTED FOR palette.ts BY NAME AND NOT WRITTEN THERE, for the reason practice-session-constants.ts
// records: palette.ts is owned elsewhere, and two agents writing one module is how a palette ends up
// with two answers for amber. Every hue below is one palette.ts already uses for the same meaning;
// nothing new is invented. Written to palette.ts's own contract -- the exported CardSwatch type and its
// rule that a card gets three things: a tinted box, a tinted icon badge, AND THE FIGURE IN THE CARD'S
// OWN HUE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Layer 2's summary figures.
 *
 *   changes    amber   -- the layer's own hue in LAYER_SWATCH. A change is not a fault, it is a change.
 *   affected   rose    -- people who may be about to lose an appointment. The only figure on this screen
 *                         that is about a person rather than a date, and it is the one that must be
 *                         found rather than read.
 *   pending    violet  -- decided to park. palette.ts's hue for the unplanned and the organisational.
 *   unreviewed slate   -- ⚠ NEVER GREEN AND NEVER NOUGHT. An unreviewed change is an open question, and
 *                         a green tick here would be the screen answering it on the practitioner's
 *                         behalf. Slate and dashed, like every other "could not be read" in this product.
 */
export const LAYER2_STAT_SWATCH: Record<string, CardSwatch> = {
  changes: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "⚑", caption: "text-amber-800/70",
  },
  affected: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-200/80 bg-rose-50/70", accent: "bg-rose-400",
    icon: "☎", caption: "text-rose-800/70",
  },
  pending: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⧗", caption: "text-violet-800/70",
  },
  unreviewed: {
    badge: "bg-slate-100 text-slate-500", figure: "text-slate-600",
    box: "border-slate-300 bg-slate-50/80", accent: "bg-slate-300",
    icon: "?", caption: "text-slate-500",
  },
};

/** The chip on an exception row. Three states, and the third is not the second. */
export const IMPACT_STATE_CHIP: Record<string, { label: string; chip: string; dot: string }> = {
  clear: { label: "Nobody affected", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  pending: { label: "Patients to decide", chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500" },
  settled: { label: "All decided", chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", dot: "bg-[var(--cp-primary)]" },
  // ⚠ NOT "nobody affected". Those are different answers and only one of them is safe.
  unreviewed: { label: "Impact not reviewed", chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-300", dot: "bg-slate-400" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500 ring-1 ring-slate-300", dot: "bg-slate-300" },
};
