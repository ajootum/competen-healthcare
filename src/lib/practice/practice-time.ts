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

/**
 * The UTC instant of a wall-clock date and time in a practice's timezone, or null when the inputs or
 * the zone cannot be read -- the caller must REFUSE then, because the alternative is booking a
 * silently-UTC time, which is the exact bug this function exists to end (a 09:00 Kampala booking
 * stored as 09:00Z and rendered as 12:00). DST-correct: the offset is read at the guessed instant and
 * re-read once, which settles transition boundaries.
 *
 * ⚠ The unknown-zone answer is NULL, not UTC. zoneOffsetMinutes falls back to 0 for a broken zone
 * because a rendering must not take a page down -- but a WRITE composed against the wrong zone is a
 * wrong appointment, so this function checks the zone itself and refuses.
 */
export function instantInZone(dateIso: string, timeHHMM: string, timezone: string | null | undefined): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeHHMM.trim());
  if (!d || !t || +t[1] > 23 || +t[2] > 59) return null;
  const tz = timezone || "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); } catch { return null; }
  const wallUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let guess = wallUtc - zoneOffsetMinutes(tz, new Date(wallUtc)) * 60000;
  guess = wallUtc - zoneOffsetMinutes(tz, new Date(guess)) * 60000;
  return new Date(guess).toISOString();
}

/**
 * ⚠ THE 24-HOUR WALL CLOCK, DEFINED ONCE AS A STRING AND COMPILED FROM IT.
 *
 * The HTML `pattern` attribute needs a string and JavaScript validation needs a RegExp, and this repo
 * has already paid for keeping the two by hand: four inputs shipped carrying `[01]?d` -- the
 * backslashes eaten in transit -- so the control demanded a literal letter "d" and refused "09:00",
 * the very example its own tooltip gave. The pin covering them checked that a pattern EXISTED.
 *
 * Deriving the RegExp from the attribute string makes the two incapable of disagreeing, and exporting
 * both means no screen ever writes the pattern out again. Six screens had hand-copied it.
 */
export const HHMM_PATTERN = "^([01]?\\d|2[0-3]):[0-5]\\d$";
export const HHMM_RE = new RegExp(HHMM_PATTERN);

/**
 * The current wall clock in a practice's timezone, as HH:MM on the 24-hour clock.
 *
 * ⚠ FOR PREFILLING A CONTROL, NEVER FOR COMPOSING A STORED INSTANT. It answers "what time is it where
 * this practice is", which is what a form should offer as its default -- `new Date().toTimeString()`
 * answers "what time is it where this BROWSER is", and the two differ for a practitioner who has
 * travelled or whose machine's clock zone was never set.
 *
 * The companion mistake this replaces is `new Date().toISOString().slice(11, 16)`, which is UTC's wall
 * clock: in Kampala that prefills a form three hours behind, and the person filing it has no reason to
 * doubt a value the machine offered them.
 */
export function wallClockInZone(timezone: string | null | undefined, at: Date = new Date()): string {
  const tz = timezone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz,
    }).format(at);
  } catch {
    // A broken zone must not take a form down. UTC is stated rather than guessed at silently.
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC",
    }).format(at);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The workspace's own today. One query, so callers do not each re-read the timezone. */
export async function workspaceClock(admin: any, workspaceId: string): Promise<{ timezone: string; today: string }> {
  const { data } = await admin.from("practice_workspace").select("timezone").eq("id", workspaceId).maybeSingle();
  const timezone = data?.timezone || "UTC";
  return { timezone, today: practiceToday(timezone) };
}
