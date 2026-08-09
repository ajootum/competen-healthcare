// ════════════════════════════════════════════════════════════════════════════════════════════════════
// PERIOD RANGE -- "which days am I looking at", for ANY screen in this product.
//
// ⚠ THIS MODULE IS DELIBERATELY GENERAL AND IT IS NOT THE PLANNER'S. It was extracted from the planner
// the day the practice owner asked for the same control everywhere:
//
//   "Make the calendar selectable i.e. I should be able to select any day of the week or month or year
//    and it be able to see what was booked for the day and what happened on that day. THIS FEATURE WOULD
//    BE GOOD TO HAVE ON ALL SCREENS WHERE THERE IS A POSSIBILITY OF REVIEWING THE DATA to see what
//    happened at a particular time."
//
// Encounters, Patients, Follow-ups, Documents and Reports all ask "over what period?" and every one of
// them that answers it with its own date arithmetic will eventually disagree with the others about what
// "last week" means. There is one answer here.
//
// ---- ⚠ IT IMPORTS NOTHING, AND THAT IS A HARD RULE RATHER THAN A STYLE ------------------------------
//
// Any "use client" component must be able to use this. A module that touches the database drags
// access.ts -> `next/headers` into the browser bundle and `next build` fails with an import trace on
// pages nobody touched -- while tsc and eslint both pass. planner-constants.ts, activity-constants.ts and
// encounter-constants.ts all exist for that reason; this is the fourth and the most reusable.
// scripts/practice-bundle-harness.ts is what keeps it true.
//
// ---- WHAT IT DOES NOT DO ---------------------------------------------------------------------------
//
// IT DOES NOT TURN A PERIOD INTO INSTANTS. A period here is a pair of CALENDAR DATES, because that is
// what a person means by "last week" and what a diary is organised by. Turning a date into the UTC
// instants that bound it in a practice's timezone is zonedDayRange() in practice-time.ts -- one function,
// already shared, already right about DST -- and a second copy of that arithmetic here would be the
// exact duplication this module exists to prevent.
//
// ---- EVERY DATE IS MEASURED AT NOON UTC ------------------------------------------------------------
//
// A YYYY-MM-DD string is a DAY, not an instant. Parsed at midnight and shifted by whole days it can slip
// into the day before under a runtime offset; noon is twelve hours from either edge and cannot. This is
// the same convention recurrence.ts uses, spelled the same way on purpose.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const DAY_MS = 86400000;
const noonMs = (dateIso: string) => Date.parse(`${dateIso}T12:00:00Z`);

export const PERIOD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date. Rejects "2026-02-30" as well as "tomorrow", because Date.parse does. */
export function isPeriodDate(v: unknown): v is string {
  if (typeof v !== "string" || !PERIOD_DATE_RE.test(v)) return false;
  const ms = noonMs(v);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

export const addDaysIso = (dateIso: string, days: number) =>
  new Date(noonMs(dateIso) + days * DAY_MS).toISOString().slice(0, 10);

/** 1 = Monday .. 7 = Sunday, the numbering migration 230 stores for the weekly template. */
export const isoWeekdayOf = (dateIso: string) =>
  (((new Date(noonMs(dateIso)).getUTCDay() + 6) % 7) + 1);

/** The Monday of the week containing this date. */
export const mondayOf = (dateIso: string) => addDaysIso(dateIso, -(isoWeekdayOf(dateIso) - 1));

/** The first of the month containing this date. */
export const monthStartOf = (dateIso: string) => `${dateIso.slice(0, 7)}-01`;

/** The last day of the month containing this date. */
export const monthEndOf = (dateIso: string) => {
  const y = Number(dateIso.slice(0, 4)), m = Number(dateIso.slice(5, 7));
  return `${dateIso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export const yearStartOf = (dateIso: string) => `${dateIso.slice(0, 4)}-01-01`;
export const yearEndOf = (dateIso: string) => `${dateIso.slice(0, 4)}-12-31`;

/**
 * Whole months, clamped to the length of the destination month.
 *
 * ⚠ THE CLAMP IS THE WHOLE POINT AND IT IS WHY Date.setUTCMonth IS NOT USED. 31 January plus one month
 * through setUTCMonth is 3 MARCH -- the overflow rolls forward silently -- so "Next month" pressed on
 * the last day of January would land the header on March and skip February entirely.
 */
export function addMonthsIso(dateIso: string, months: number): string {
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  const d = Number(dateIso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Inclusive day count between two dates. The same date is 1 day, not nought. */
export const daysBetweenIso = (fromIso: string, toIso: string) =>
  Math.round((noonMs(toIso) - noonMs(fromIso)) / DAY_MS) + 1;

// ── THE VIEWS, AND WHAT PREVIOUS AND NEXT MEAN IN EACH ───────────────────────────────────────────────

/**
 * The unit each view moves by, as DATA rather than as an `if` chain in a header -- so a fifth view
 * cannot be added to a switcher without somebody deciding what its arrow does.
 */
export const PERIOD_VIEWS = [
  { key: "day", label: "Day", unit: "day", purpose: "Operational detail for one day." },
  { key: "week", label: "Week", unit: "week", purpose: "Near-term planning and workload." },
  { key: "month", label: "Month", unit: "month", purpose: "Rapid orientation across a longer period." },
  { key: "agenda", label: "Agenda", unit: "range", purpose: "Find and review over any period." },
] as const;

export type PeriodView = (typeof PERIOD_VIEWS)[number]["key"];

export const PERIOD_VIEW_KEYS: readonly PeriodView[] = PERIOD_VIEWS.map(v => v.key);

export const isPeriodView = (v: unknown): v is PeriodView =>
  typeof v === "string" && (PERIOD_VIEW_KEYS as readonly string[]).includes(v);

export const DEFAULT_PERIOD_VIEW: PeriodView = "week";

/** A period being looked at: the days that will actually be READ. Both ends inclusive. */
export type PeriodRange = {
  view: PeriodView;
  /** The date the user is "on". The day a Day view shows, and the day a Month view highlights. */
  anchorDate: string;
  /** First and last day READ. For Month this is the whole grid, including the greyed neighbours. */
  fromDate: string;
  toDate: string;
  /** For Month: the first and last day of the month ITSELF, so a grid can grey the rest. */
  focusFromDate: string;
  focusToDate: string;
};

/**
 * ⚠ THE ONE PLACE THAT TURNS (view, date) INTO DAYS. A server reads exactly these days and a screen
 * draws exactly these days, so a header, a grid and a query cannot disagree about which fortnight is on
 * the screen.
 *
 * MONTH RESOLVES TO THE WHOLE GRID, not the month. A month grid draws the last days of the previous
 * month and the first of the next, and reading only the month would leave those cells blank -- which is
 * indistinguishable from a genuinely empty Monday.
 */
export function resolvePeriod(
  view: PeriodView, anchorDate: string, custom?: { from?: string | null; to?: string | null },
): PeriodRange {
  const anchor = isPeriodDate(anchorDate) ? anchorDate : "1970-01-01";
  if (view === "day")
    return { view, anchorDate: anchor, fromDate: anchor, toDate: anchor, focusFromDate: anchor, focusToDate: anchor };
  if (view === "week") {
    const from = mondayOf(anchor), to = addDaysIso(from, 6);
    return { view, anchorDate: anchor, fromDate: from, toDate: to, focusFromDate: from, focusToDate: to };
  }
  if (view === "month") {
    const first = monthStartOf(anchor), last = monthEndOf(anchor);
    const gridFrom = mondayOf(first);
    const gridTo = addDaysIso(gridFrom, Math.ceil(daysBetweenIso(gridFrom, last) / 7) * 7 - 1);
    return { view, anchorDate: anchor, fromDate: gridFrom, toDate: gridTo, focusFromDate: first, focusToDate: last };
  }
  // AGENDA. A custom period if one was given and it is the right way round; otherwise the month the
  // anchor is in, which is the widest period a single press can produce and is what "This month" means.
  const from = custom?.from && isPeriodDate(custom.from) ? custom.from : monthStartOf(anchor);
  const toRaw = custom?.to && isPeriodDate(custom.to) ? custom.to : monthEndOf(anchor);
  const to = toRaw < from ? from : toRaw;
  return { view, anchorDate: anchor, fromDate: from, toDate: to, focusFromDate: from, focusToDate: to };
}

/**
 * Previous / Next. Returns the ANCHOR (and, for Agenda, the range) of the neighbouring period.
 *
 * AGENDA MOVES BY ITS OWN LENGTH: a three-day agenda pressed Next shows the next three days, and a
 * year-long one shows the next year.
 */
export function shiftPeriod(p: PeriodRange, direction: 1 | -1): {
  anchorDate: string; from: string | null; to: string | null;
} {
  if (p.view === "day")
    return { anchorDate: addDaysIso(p.anchorDate, direction), from: null, to: null };
  if (p.view === "week")
    return { anchorDate: addDaysIso(p.anchorDate, 7 * direction), from: null, to: null };
  if (p.view === "month")
    return { anchorDate: addMonthsIso(monthStartOf(p.anchorDate), direction), from: null, to: null };
  const length = daysBetweenIso(p.fromDate, p.toDate);
  const from = addDaysIso(p.fromDate, length * direction);
  const to = addDaysIso(p.toDate, length * direction);
  return { anchorDate: from, from, to };
}

const MONTH_LONG = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday", "Sunday"];

const dayNum = (d: string) => d.slice(8, 10);
const monShort = (d: string) => MONTH_SHORT[Number(d.slice(5, 7)) - 1] ?? d.slice(5, 7);
const yr = (d: string) => d.slice(0, 4);

/**
 * The period label: "August 2026", "03-09 Aug 2026", "2026".
 *
 * FORMATTED BY HAND RATHER THAN THROUGH Intl. The same string has to come out of the server render and
 * the browser hydration, and Intl's data is not guaranteed to be byte-identical in both.
 */
export function periodLabel(p: PeriodRange): string {
  if (p.view === "day") {
    const wd = WEEKDAY_LONG[isoWeekdayOf(p.anchorDate)] ?? "";
    return `${wd} ${dayNum(p.anchorDate)} ${monShort(p.anchorDate)} ${yr(p.anchorDate)}`.trim();
  }
  if (p.view === "month")
    return `${MONTH_LONG[Number(p.anchorDate.slice(5, 7)) - 1] ?? ""} ${yr(p.anchorDate)}`.trim();
  const a = p.fromDate, b = p.toDate;
  // A whole calendar year reads as the year. "01 Jan - 31 Dec 2026" is the same fact spelled longer.
  if (a === yearStartOf(a) && b === yearEndOf(a) && yr(a) === yr(b)) return yr(a);
  if (a === b) return `${dayNum(a)} ${monShort(a)} ${yr(a)}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${dayNum(a)}-${dayNum(b)} ${monShort(a)} ${yr(a)}`;
  if (yr(a) === yr(b)) return `${dayNum(a)} ${monShort(a)} - ${dayNum(b)} ${monShort(b)} ${yr(a)}`;
  return `${dayNum(a)} ${monShort(a)} ${yr(a)} - ${dayNum(b)} ${monShort(b)} ${yr(b)}`;
}

// ── QUICK PERIODS ────────────────────────────────────────────────────────────────────────────────────

/**
 * CP-PLAN-002 s3's six, in s3's own order and s3's own words.
 *
 * ⚠ NAMED AS DATA SO A HARNESS CAN PROVE THE LIST IS COMPLETE, not merely valid. PLANNER_QUICK_ACTIONS
 * shipped two short for a fortnight and every test passed, because "every entry is real" is satisfied by
 * a list that is missing half of what the specification asked for.
 */
export const QUICK_PERIODS = [
  { key: "last_week", label: "Last week", view: "week" as PeriodView },
  { key: "this_week", label: "This week", view: "week" as PeriodView },
  { key: "next_week", label: "Next week", view: "week" as PeriodView },
  { key: "this_month", label: "This month", view: "month" as PeriodView },
  { key: "next_month", label: "Next month", view: "month" as PeriodView },
  { key: "custom", label: "Custom period", view: "agenda" as PeriodView },
] as const;

/** s3's six labels verbatim, so the list above can be proved COMPLETE and not merely well-formed. */
export const QUICK_PERIOD_LABELS_S3 = [
  "Last week", "This week", "Next week", "This month", "Next month", "Custom period",
] as const;

/**
 * ⚠ THE LONGER PERIODS ARE A SEPARATE LIST, ON PURPOSE.
 *
 * The practice owner asked for "any day of the week or month OR YEAR", which s3 does not name. Adding
 * them to QUICK_PERIODS would break the assertion that that list is EXACTLY the specification's six --
 * an assertion worth keeping, because a list that quietly grows is how a screen comes to offer something
 * nobody specified and a list that quietly shrinks is how it comes to be missing something that was.
 */
export const LONG_PERIODS = [
  { key: "last_month", label: "Last month", view: "month" as PeriodView },
  { key: "this_quarter", label: "Next 3 months", view: "agenda" as PeriodView },
  { key: "this_year", label: "This year", view: "agenda" as PeriodView },
  { key: "last_year", label: "Last year", view: "agenda" as PeriodView },
] as const;

export type QuickPeriodKey =
  (typeof QUICK_PERIODS)[number]["key"] | (typeof LONG_PERIODS)[number]["key"];

/**
 * Where a quick period takes you, computed from a today the CALLER supplies.
 *
 * ⚠ THE CALLER PASSES todayDate AND THAT IS NOT A CONVENIENCE. A practice in Kampala opening a screen at
 * 01:00 is on a different calendar day from the machine rendering it, and "This week" computed from the
 * renderer's clock is the wrong week for three hours of every morning -- the three hours somebody is
 * most likely to be checking what the day holds. practiceToday() is the only source of that date.
 */
export function quickPeriodTarget(key: QuickPeriodKey, todayDate: string): {
  view: PeriodView; anchorDate: string; from: string | null; to: string | null;
} {
  const today = isPeriodDate(todayDate) ? todayDate : "1970-01-01";
  switch (key) {
    case "last_week": return { view: "week", anchorDate: addDaysIso(mondayOf(today), -7), from: null, to: null };
    case "this_week": return { view: "week", anchorDate: today, from: null, to: null };
    case "next_week": return { view: "week", anchorDate: addDaysIso(mondayOf(today), 7), from: null, to: null };
    case "last_month": return { view: "month", anchorDate: addMonthsIso(monthStartOf(today), -1), from: null, to: null };
    case "this_month": return { view: "month", anchorDate: monthStartOf(today), from: null, to: null };
    case "next_month": return { view: "month", anchorDate: addMonthsIso(monthStartOf(today), 1), from: null, to: null };
    case "this_quarter": {
      const from = monthStartOf(today);
      return { view: "agenda", anchorDate: from, from, to: monthEndOf(addMonthsIso(from, 2)) };
    }
    case "this_year":
      return { view: "agenda", anchorDate: yearStartOf(today), from: yearStartOf(today), to: yearEndOf(today) };
    case "last_year": {
      const y = String(Number(today.slice(0, 4)) - 1);
      return { view: "agenda", anchorDate: `${y}-01-01`, from: `${y}-01-01`, to: `${y}-12-31` };
    }
    // ⚠ Custom does NOT invent a range. It opens an Agenda on the period the caller is already on --
    // this month -- so pressing it never silently changes what is on the screen before the user has
    // chosen anything.
    case "custom": default:
      return { view: "agenda", anchorDate: today, from: monthStartOf(today), to: monthEndOf(today) };
  }
}

/**
 * ⚠ HOW LONG A PERIOD MAY BE, AND WHY THE CAP IS SAID OUT LOUD.
 *
 * A whole year is 365 or 366 days and the practice owner asked for one, so the cap admits it. What it
 * does NOT do is trim quietly: resolvePeriodCapped returns `capped`, every caller carries that flag onto
 * its payload, and the screen prints a sentence naming the date it stopped at. A period that silently
 * ended in August would look exactly like a diary that empties in August.
 */
export const PERIOD_DAY_CAP = 366;

export function capPeriod(fromDate: string, toDate: string, cap = PERIOD_DAY_CAP): {
  fromDate: string; toDate: string; capped: boolean;
} {
  const from = fromDate <= toDate ? fromDate : toDate;
  const to = fromDate <= toDate ? toDate : fromDate;
  const capped = daysBetweenIso(from, to) > cap;
  return { fromDate: from, toDate: capped ? addDaysIso(from, cap - 1) : to, capped };
}
