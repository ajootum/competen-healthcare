import { zoneOffsetMinutes } from "@/lib/practice/practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHERE A BOOKING IS, DERIVED FROM THE REGULAR WEEK.
//
// The owner, 2026-08-12: "I expect these patients to be booked under TMR hospital because my practice
// days are saying I am at TMR... if it is a Friday, since am at TMR on Friday - automatically booked
// to that location."
//
// The practice already states where it works on each weekday -- practice_availability_template is
// exactly "Monday 09:00-13:00 Aga Khan, Friday 09:00-15:00 TMR". Until now a booking made from the
// patient page or the desk carried NO location at all, because neither widget asks for one, so every
// appointment in the practice had location_id NULL and no per-hospital list could ever find them.
//
// ⚠ IT NEVER OVERRIDES A CHOICE, AND IT NEVER GUESSES. This runs only when the caller supplied no
// location, and it answers null -- with a reason -- whenever the regular week does not settle the
// question. The refusals matter more than the resolutions:
//
//   no session covers that time   an appointment outside the regular week is a deliberate exception,
//                                 and inventing a place for it would put a patient at a hospital the
//                                 practitioner is not at.
//   two sessions, two places      genuinely ambiguous. A guess here is a patient sent to the wrong
//                                 hospital, which is the worst outcome this file can produce.
//   the session names no place    the practice has not said where that session is.
//   a fortnightly session         recurrence_weeks > 1 means "not every week", and deciding whether
//                                 THIS week is one of them needs the anchor date. Left alone rather
//                                 than assumed.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type DerivedLocation = {
  locationId: string | null;
  /** Why -- for the caller to record, and for a screen to explain. Never null. */
  reason: string;
  /** True only when the regular week settled it. */
  derived: boolean;
};

/** ISO weekday, 1 = Monday .. 7 = Sunday. The convention the template column uses. */
const isoWeekdayOf = (localMs: number) => ((new Date(localMs).getUTCDay() + 6) % 7) + 1;

export async function locationFromRegularWeek(
  admin: any, workspaceId: string, instantIso: string, timezone: string,
): Promise<DerivedLocation> {
  const at = new Date(instantIso);
  if (Number.isNaN(at.getTime()))
    return { locationId: null, reason: "the time could not be read", derived: false };

  // The practice's own wall clock: shift the instant by the zone offset AT that instant, then read the
  // parts as if they were UTC. Same technique practice-time.ts uses, and DST-correct for the same reason.
  const localMs = at.getTime() + zoneOffsetMinutes(timezone, at) * 60000;
  const local = new Date(localMs);
  const weekday = isoWeekdayOf(localMs);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const localDate = local.toISOString().slice(0, 10);

  const { data, error } = await admin.from("practice_availability_template")
    .select("id, location_id, starts_minute, ends_minute, recurrence_weeks, effective_from, effective_to, session_name")
    .eq("workspace_id", workspaceId).eq("weekday", weekday)
    .eq("status", "active").eq("active", true);

  // ⚠ A FAILED READ IS NOT "NO REGULAR WEEK". Booking without a location is the safe outcome either
  // way, but the reason must not say the practitioner works nowhere on a Friday.
  if (error)
    return { locationId: null, reason: `the regular week could not be read: ${error.message}`, derived: false };

  const covering = ((data ?? []) as any[]).filter(t =>
    t.starts_minute <= minuteOfDay && minuteOfDay < t.ends_minute
    && (t.recurrence_weeks ?? 1) === 1
    && (!t.effective_from || t.effective_from <= localDate)
    && (!t.effective_to || t.effective_to >= localDate));

  if (covering.length === 0)
    return {
      locationId: null, derived: false,
      reason: "this time is outside the regular week, so no location was assumed",
    };

  const places = [...new Set(covering.map(t => t.location_id).filter(Boolean))] as string[];
  if (places.length === 0)
    return { locationId: null, derived: false, reason: "the regular week names no location for this time" };
  if (places.length > 1)
    return {
      locationId: null, derived: false,
      reason: "two sessions at different locations cover this time, so it was not assumed",
    };

  return {
    locationId: places[0], derived: true,
    reason: "taken from the regular week for this weekday and time",
  };
}
