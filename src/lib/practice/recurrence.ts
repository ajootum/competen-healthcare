// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-RECUR-001 -- SESSIONS THAT DO NOT REPEAT EVERY WEEK. Migration 274.
//
// The practice owner, walking the product: "I would like to set my weekly plan as alternate Saturdays to
// be at TMR, not every Saturday. How do we do this?" -- and until this file existed, the answer was that
// you could not. A session was a weekday and a time, and it ran EVERY week.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE ANCHOR IS THE DESIGN DECISION, AND THE ONE-INTEGER SHORTCUT IS WRONG.
//
// The tempting implementation of "alternate" is ISO week-number parity -- even weeks on, odd weeks off.
// It needs no second column and it is broken three separate ways:
//
//   1. IT DOES NOT SURVIVE A YEAR BOUNDARY. A 53-week ISO year puts two odd weeks side by side, so a
//      fortnightly clinic silently skips or doubles once every few years. 2020, 2026 and 2032 are all
//      53-week years, and the flip is permanent from that point on -- every session after it moves.
//   2. IT IS NOT WHAT A PRACTITIONER MEANS. They mean "this Saturday, then the one after next". They do
//      not know their own clinic's ISO week number and should never have to.
//   3. TWO PRACTITIONERS WHO BOTH CHOSE "ALTERNATE SATURDAYS" A WEEK APART WOULD LAND ON THE SAME
//      SATURDAYS, because parity is a property of the calendar rather than of either of their choices.
//
// So this module stores the FIRST OCCURRENCE THE PRACTITIONER CHOSE and counts whole weeks from it. That
// is a fact about their diary, not about the calendar, and no year boundary can move it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// ---- WHY IT IS A FILE OF ITS OWN --------------------------------------------------------------------
//
// IT TOUCHES NO DATABASE AND IMPORTS NOTHING. The generator needs it on the server and the session
// editor needs it in the browser to SHOW a practitioner which Saturdays they have just chosen -- and
// those must be the same arithmetic or the screen and the diary will disagree about somebody's month.
// Putting it in availability-config.ts would drag the workspace context, the audit log and a Supabase
// client into a client component.
//
// ---- EVERY DATE HERE IS A CALENDAR DATE, MEASURED AT NOON UTC ---------------------------------------
//
// A YYYY-MM-DD string is a day, not an instant. Parsing it at midnight and adding 86,400,000ms works
// until a caller's runtime applies an offset near a boundary. Noon is twelve hours from either edge, so
// whole-day arithmetic on it cannot slip into the day before or after. The practice's timezone is
// applied by the generator when it turns a date into a real instant -- never here.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a practitioner may choose. `1` is the weekly session every existing row already is. */
export const RECURRENCE_INTERVALS = [1, 2, 3, 4] as const;
export const MAX_RECURRENCE_WEEKS = 4;

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

const WEEKDAY_NAME = [
  "", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;

const noonMs = (dateIso: string) => Date.parse(`${dateIso}T12:00:00Z`);

/** A real YYYY-MM-DD. Rejects "2026-02-30" as well as "not a date", because Date.parse does. */
export function isDateIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = noonMs(v);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

/** 1 = Monday .. 7 = Sunday, the same numbering migration 230 stores. */
export const isoWeekdayOf = (dateIso: string) =>
  (((new Date(noonMs(dateIso)).getUTCDay() + 6) % 7) + 1);

export const addDaysIso = (dateIso: string, days: number) =>
  new Date(noonMs(dateIso) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Whole weeks from one date to another, SIGNED.
 *
 * ⚠ ONLY EXACT WHEN BOTH DATES FALL ON THE SAME WEEKDAY, which is the only way this module calls it --
 * occursOn() has already established that the candidate date is on the session's weekday and the anchor
 * is too. The rounding is therefore a no-op that keeps floating point honest, not a fudge over a
 * mismatch: a date three days from the anchor would round to zero and silently claim to be an occurrence,
 * which is why the weekday test comes FIRST and never after.
 */
export const wholeWeeksBetween = (fromIso: string, toIso: string) =>
  Math.round((noonMs(toIso) - noonMs(fromIso)) / WEEK_MS);

export type Recurrence = {
  /** Repeat every N weeks. 1 is weekly. */
  everyWeeks: number;
  /**
   * The first occurrence the practitioner chose, and the only thing that fixes WHICH weeks are on.
   * Null is legitimate only while everyWeeks is 1.
   */
  anchorDate: string | null;
};

export const WEEKLY: Recurrence = { everyWeeks: 1, anchorDate: null };

/**
 * Read a recurrence off a stored row, or off anything else, WITHOUT inventing one.
 *
 * ⚠ AN UNRECOGNISABLE INTERVAL BECOMES WEEKLY, NOT NOTHING. A row whose recurrence cannot be read is a
 * row whose column has not been added yet (migration 274 is applied by hand), and every one of those
 * rows IS weekly -- that is what the product did before this feature. Treating it as "no occurrences"
 * would empty a working diary the moment the code shipped ahead of the migration.
 */
export function readRecurrence(row: {
  recurrence_weeks?: unknown; recurrence_anchor_date?: unknown;
} | null | undefined): Recurrence {
  const raw = Number(row?.recurrence_weeks ?? 1);
  const everyWeeks = Number.isInteger(raw) && raw >= 1 && raw <= MAX_RECURRENCE_WEEKS ? raw : 1;
  const anchorRaw = row?.recurrence_anchor_date;
  const anchorDate = typeof anchorRaw === "string" && isDateIso(anchorRaw.slice(0, 10))
    ? anchorRaw.slice(0, 10) : null;
  return { everyWeeks, anchorDate };
}

/**
 * Move an anchor onto a different weekday WITHOUT changing which week it is in.
 *
 * ⚠ THE WEEK IS THE PART THE PRACTITIONER CHOSE, so it is the part that survives. Somebody who moves an
 * alternate Saturday clinic to a Sunday means the Sunday of the weeks they already picked. Adding days
 * forward until the weekday matched would push a Saturday-to-Monday move into the NEXT ISO week and
 * silently invert every occurrence, because Monday begins the week rather than ending it.
 */
export function alignAnchorToWeekday(anchorIso: string, weekday: number): string {
  const mondayOfThatWeek = addDaysIso(anchorIso, -(isoWeekdayOf(anchorIso) - 1));
  return addDaysIso(mondayOfThatWeek, weekday - 1);
}

/**
 * Does this session run on this date?
 *
 * THE THREE ANSWERS AND WHY THEY LEAN THE WAY THEY DO:
 *   wrong weekday            -- no, and nothing else is even computed.
 *   weekly                   -- yes. No anchor is needed or consulted, so every existing row is
 *                               unaffected by this module whether or not migration 274 has been applied.
 *   every N weeks, N > 1     -- yes only on the anchor's own weeks.
 *
 * ⚠ AND AN INTERVAL WITH NO ANCHOR IS "NO", NOT "EVERY WEEK". The database refuses to store that
 * combination (migration 274's practice_session_recurrence_anchor_required), so reaching it means
 * something is wrong -- and of the two ways to be wrong, generating EVERY week is the one that puts a
 * patient in front of a locked door at a hospital the practitioner is not at. Under-offering is visible
 * on the practitioner's own screen and costs nobody a journey.
 */
export function occursOn(dateIso: string, weekday: number, r: Recurrence): boolean {
  if (!isDateIso(dateIso)) return false;
  if (isoWeekdayOf(dateIso) !== weekday) return false;
  if (r.everyWeeks <= 1) return true;
  if (!r.anchorDate || !isDateIso(r.anchorDate)) return false;

  // The anchor is aligned rather than trusted: the constraint keeps stored anchors on the session's
  // weekday, and an unaligned one arriving from anywhere else would make wholeWeeksBetween round.
  const anchor = isoWeekdayOf(r.anchorDate) === weekday
    ? r.anchorDate : alignAnchorToWeekday(r.anchorDate, weekday);

  const weeks = wholeWeeksBetween(anchor, dateIso);
  // Double modulo, because the remainder of a negative number is negative in JavaScript and dates BEFORE
  // the anchor are ordinary dates. The pattern extends backwards in phase, which is what makes it a
  // pattern rather than a start date -- when it STARTS is effective_from's job, not the anchor's.
  return ((weeks % r.everyWeeks) + r.everyWeeks) % r.everyWeeks === 0;
}

/**
 * Every date in a range this session runs on. ONE FUNCTION, USED ON BOTH SIDES -- the generator filters
 * its days with occursOn() and the screen lists its dates with this, so a Saturday that appears on the
 * form is a Saturday the diary will hold.
 */
export function occurrencesBetween(
  fromIso: string, toIso: string, weekday: number, r: Recurrence, cap = 400,
): string[] {
  if (!isDateIso(fromIso) || !isDateIso(toIso)) return [];
  const out: string[] = [];
  const end = noonMs(toIso);
  for (let t = noonMs(fromIso); t <= end && out.length < cap; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (occursOn(date, weekday, r)) out.push(date);
  }
  return out;
}

/** The next `count` occurrences on or after `fromIso`. What the editor shows while the form is typed. */
export function nextOccurrences(fromIso: string, weekday: number, r: Recurrence, count = 6): string[] {
  if (!isDateIso(fromIso) || count <= 0) return [];
  const out: string[] = [];
  // Scanning forward a day at a time is cheap and cannot drift the way multiplying up from the anchor
  // could. The bound is generous: four weeks is the widest interval, so six occurrences fit in 24 weeks.
  const horizonDays = Math.max(7, (count + 1) * Math.max(1, r.everyWeeks) * 7 + 7);
  for (let i = 0; i <= horizonDays && out.length < count; i++) {
    const date = addDaysIso(fromIso, i);
    if (occursOn(date, weekday, r)) out.push(date);
  }
  return out;
}

/** The next occurrence of a weekday on or after a date, regardless of any interval. */
export function nextWeekdayOnOrAfter(fromIso: string, weekday: number): string {
  if (!isDateIso(fromIso)) return fromIso;
  const shift = (weekday - isoWeekdayOf(fromIso) + 7) % 7;
  return addDaysIso(fromIso, shift);
}

// ── CAN TWO PATTERNS EVER LAND ON THE SAME DAY? ──────────────────────────────────────────────────────

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * ⚠ THIS IS WHAT MAKES THE FEATURE WORTH HAVING, AND WITHOUT IT THE OVERLAP CHECK WOULD FORBID IT.
 *
 * The scope note's first unsettled question: "a practitioner alternating TMR and somewhere else has TWO
 * fortnightly sessions in ANTIPHASE, not one that skips." That is the real shape of the request -- TMR on
 * alternate Saturdays usually means somewhere else, or nowhere, on the others.
 *
 * availability-config's sessionConflict refuses any two sessions that overlap in minutes on one weekday,
 * because nobody is in two places at one time. That rule is right and it is now finer: two sessions in
 * antiphase are NEVER on the same date, so they are never two places at one time, and refusing them
 * would leave the practitioner back where they started.
 *
 * ⚠ THE ARITHMETIC IS A SCAN, NOT A CLEVERNESS. The patterns repeat together every lcm(a, b) weeks and
 * both intervals are at most four, so twelve weeks is the whole question. A closed form over the
 * remainder is shorter and is the kind of shorter that gets a sign wrong and silently allows a
 * double-booking.
 *
 * ⚠ AND AN UNANSWERABLE PATTERN COUNTS AS A CLASH. An interval with no anchor names no dates, so a
 * strict reading is "these never coincide" -- which would let a broken row through the one check that
 * stops a practitioner being sent to two hospitals at once. Here the safe direction is to refuse.
 */
export function recurrencesCanCoincide(weekday: number, a: Recurrence, b: Recurrence): boolean {
  const unanswerable = (r: Recurrence) => r.everyWeeks > 1 && !isDateIso(r.anchorDate ?? "");
  if (unanswerable(a) || unanswerable(b)) return true;
  if (a.everyWeeks <= 1 || b.everyWeeks <= 1) return true;

  // Any run of lcm(a, b) consecutive occurrences of the weekday contains the whole joint cycle, so where
  // the scan starts cannot change the answer. It starts at an anchor purely so the dates are real ones.
  const start = nextWeekdayOnOrAfter(a.anchorDate ?? b.anchorDate ?? "2000-01-03", weekday);
  const period = (a.everyWeeks * b.everyWeeks) / gcd(a.everyWeeks, b.everyWeeks);
  for (let w = 0; w < period; w++) {
    const date = addDaysIso(start, w * 7);
    if (occursOn(date, weekday, a) && occursOn(date, weekday, b)) return true;
  }
  return false;
}

// ── HOW IT READS ─────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ "EVERY 3RD SATURDAY" IS NOT SAID ANYWHERE, ON PURPOSE. In English that means the third Saturday of
 * the month, which is a different pattern this build does not implement. "Every 3 weeks" cannot be
 * misread as one.
 */
export function describeRecurrence(r: Recurrence, weekday: number): string {
  const day = WEEKDAY_NAME[weekday] ?? "day";
  if (r.everyWeeks <= 1) return `Every ${day}`;
  if (r.everyWeeks === 2) return `Every other ${day}`;
  return `Every ${r.everyWeeks} weeks, on a ${day}`;
}

/** The short form for a card in a week grid, where the weekday is already the column. */
export function recurrenceBadge(r: Recurrence): string | null {
  if (r.everyWeeks <= 1) return null;
  if (r.everyWeeks === 2) return "Alternate weeks";
  return `Every ${r.everyWeeks} weeks`;
}

/** "Sat 15 Aug" -- a date a practitioner can check against their own calendar without counting. */
export function shortDate(dateIso: string): string {
  if (!isDateIso(dateIso)) return dateIso;
  return new Date(noonMs(dateIso)).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}
