// ONE SOURCE FOR "WHEN IS IT, WHERE THIS PRACTICE IS".
//
// A practice in Kampala has a working day that is not UTC's. Everything on the operations home and the
// follow-up board turns on that: what is due today, what is overdue, which appointments are today's.
// Getting it from `new Date().toISOString().slice(0, 10)` is right for about twenty-one hours a day and
// silently wrong for the other three -- and the three it is wrong for are the early morning, which is
// exactly when somebody opens the app to see what the day holds.
//
// These functions were split out of follow-ups.ts when the operations home needed the same clock. Two
// copies of a timezone calculation is how one of them quietly stops matching the other.
//
// NO LIBRARY. Intl is in the platform and knows the tz database; a date library would be a dependency
// for arithmetic that is four lines when you let Intl do the hard part.

/**
 * Today's date in a given timezone, as YYYY-MM-DD.
 *
 * en-CA is not a preference about Canada: it is the locale whose short date format IS ISO, which makes
 * this a formatting call rather than a hand-rolled offset calculation that would be wrong twice a year.
 */
export function practiceToday(timezone: string | null | undefined, at: Date = new Date()): string {
  return formatIsoDate(timezone, at);
}

function formatIsoDate(timezone: string | null | undefined, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(at);
  } catch {
    // An unknown timezone must not take a page down. UTC is wrong by hours; a thrown error is wrong by
    // the whole screen.
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}

/** today + n days, in the practice's calendar. */
export function dueDateFrom(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * How far the zone is from UTC, in minutes, at a given instant. Positive is ahead (Kampala is +180).
 *
 * Derived by formatting the instant in the zone and reading the result back as if it were UTC: the
 * difference between the two is the offset. This is the standard way to get an offset out of Intl, and
 * it handles DST because Intl does.
 */
export function zoneOffsetMinutes(timezone: string | null | undefined, at: Date): number {
  const tz = timezone || "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at);
  } catch {
    return 0;
  }
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
  // hour can come back as 24 for midnight under hour12:false in some engines; Date.UTC normalises it.
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asIfUtc - at.getTime()) / 60000);
}

/**
 * The UTC instants bounding one calendar day in a practice's timezone, as ISO strings for a range query.
 *
 * THE OFFSET IS READ AT MIDDAY, not at midnight. On a DST transition day the offset changes partway
 * through, and midnight is the worst possible sample point because it may sit on the wrong side of the
 * change; midday is on the correct side on every real transition. The residual error is that a day
 * containing a transition is an hour long or short at one end -- which is true of the day itself, and is
 * a better answer than an hour of appointments landing in the wrong day.
 */
export function zonedDayRange(dateIso: string, timezone: string | null | undefined): { startIso: string; endIso: string } {
  const noonUtcOnThatDate = new Date(`${dateIso}T12:00:00.000Z`);
  const offsetMs = zoneOffsetMinutes(timezone, noonUtcOnThatDate) * 60000;
  const startMs = Date.parse(`${dateIso}T00:00:00.000Z`) - offsetMs;
  return {
    startIso: new Date(startMs).toISOString(),
    // Exclusive end, expressed as the next midnight: a half-open range cannot drop the last millisecond
    // of the day the way `23:59:59.999` does.
    endIso: new Date(startMs + 86400000).toISOString(),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The workspace's own today. One query, so callers do not each re-read the timezone. */
export async function workspaceClock(admin: any, workspaceId: string): Promise<{ timezone: string; today: string }> {
  const { data } = await admin.from("practice_workspace").select("timezone").eq("id", workspaceId).maybeSingle();
  const timezone = data?.timezone || "UTC";
  return { timezone, today: practiceToday(timezone) };
}
