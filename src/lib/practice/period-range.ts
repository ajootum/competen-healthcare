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
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THERE ARE THREE ANCHORINGS AND THEY ARE NOT INTERCHANGEABLE. THIS IS THE MOST IMPORTANT PARAGRAPH
// IN THE FILE.
//
//   calendar   "August 2026", "this week", "3-9 Aug". Named days, navigated with prev/next. What the
//              planner has always meant.
//   rolling    "the days from N back up to today". MEASURED FROM TODAY AND MOVING WITH IT. What
//              encounters-landing-constants.ts's HISTORY_PERIODS has always meant, and what
//              reports.ts's `days` has always meant.
//   all        NO BOUND AT ALL. Not a period; the ABSENCE of one, named so that a screen whose register
//              has always shown everything can keep doing exactly that while still offering the control.
//              `bounded: false`, and a loader that reads fromDate/toDate off one of these has a bug.
//
// ⚠ "LAST 30 DAYS" IS NOT "THIS MONTH", AND SWAPPING ONE FOR THE OTHER IS A CLINICAL CHANGE WEARING THE
// COSTUME OF A REFACTOR. On 3 August, "last 30 days" reaches back into July and "this month" shows three
// days. A clinician who asked for their recent register and got a three-day one would conclude the
// records had gone. This module exists so BOTH can be said, not so one can quietly replace the other.
//
// ---- ⚠ AND "N DAYS" IS ALREADY AMBIGUOUS IN THIS CODEBASE, WHICH IS WHY THE PARAMETER IS AN OFFSET ---
//
// Two live callers disagree about what "30 days" means, and both are shipped:
//
//   encounters-landing.ts   from = today - 30, to = today   -> 31 calendar days inclusive
//   reports.ts              from = today - 29, to = today   -> 30 calendar days inclusive
//
// Neither is corrected here. A period control is not the place to quietly change how much of a register
// a clinician sees, and either edit would do that to somebody. So the rolling constructor takes
// `backDays` -- THE OFFSET, unambiguous -- rather than a "number of days" that the two callers would
// each read differently. encounters passes 30, reports passes 29, and both keep the range they had.
// periodLabel prints the caller's own name for the window AND the two real dates beside it, so nobody
// has to know any of this to read the screen correctly. periodSpanDays() is there for a screen that
// wants to say the true inclusive span out loud, and the encounters footnote does.
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

/**
 * How a period is pinned to the calendar. See the header -- these are not interchangeable.
 *
 * ⚠ `all` IS A REAL MEMBER AND NOT A NULL OBJECT. Three screens in this product have always shown their
 * whole register, and encounters' own "Custom" with both boxes empty has always meant exactly this. A
 * codebase that had no word for "no period" grew one per screen instead.
 */
export type PeriodAnchoring = "calendar" | "rolling" | "all";

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
  /** calendar / rolling / all. Every period made before this field existed is `calendar`. */
  anchoring: PeriodAnchoring;
  /**
   * ⚠ FALSE ONLY FOR `all`, AND IT IS AN INSTRUCTION TO THE LOADER RATHER THAN A DECORATION. When it is
   * false the read must NOT be bounded: fromDate and toDate are still filled in, because the header, the
   * arrows and the quick chips all need somewhere to stand, and a query that used them would silently
   * hide every row outside one month of a register that has always shown everything.
   */
  bounded: boolean;
  /** rolling only: how many days BACK from `todayDate` the window starts. Null otherwise. */
  backDays: number | null;
  /** rolling only: the practice's today this window was measured from. Null otherwise. */
  todayDate: string | null;
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
  view: PeriodView, anchorDate: string, custom?: {
    from?: string | null; to?: string | null;
    /** Omitted is `calendar`, which is what every caller written before this field meant. */
    anchoring?: PeriodAnchoring | null;
    /** rolling only, and REQUIRED for it: days back from `todayDate`. 0 is today alone. */
    backDays?: number | null;
    /** rolling only, and REQUIRED for it: THE PRACTICE'S today. Never the renderer's. */
    todayDate?: string | null;
  },
): PeriodRange {
  const anchor = isPeriodDate(anchorDate) ? anchorDate : "1970-01-01";
  const calendarBase = { anchoring: "calendar" as const, bounded: true, backDays: null, todayDate: null };

  // ── ROLLING: the days from N back up to TODAY, and today is the caller's, never this machine's. ────
  //
  // ⚠ AN UNUSABLE ROLLING REQUEST FALLS BACK TO THE CALENDAR RATHER THAN INVENTING A TODAY. A window
  // measured from `new Date()` inside a shared module is the wrong window for three hours of every
  // morning in Kampala, and those are the hours somebody opens the app to see what the day holds.
  if (custom?.anchoring === "rolling") {
    const today = isPeriodDate(custom.todayDate) ? custom.todayDate : null;
    const back = Number.isInteger(custom.backDays) && (custom.backDays as number) >= 0
      ? (custom.backDays as number) : null;
    if (today !== null && back !== null) {
      const from = addDaysIso(today, -back);
      return {
        view: "agenda", anchorDate: from, fromDate: from, toDate: today,
        focusFromDate: from, focusToDate: today,
        anchoring: "rolling", bounded: true, backDays: back, todayDate: today,
      };
    }
  }

  // ── ALL: no bound. The dates are here for the header and the arrows and for NOTHING ELSE. ──────────
  if (custom?.anchoring === "all") {
    const first = monthStartOf(anchor), last = monthEndOf(anchor);
    return {
      view: "agenda", anchorDate: anchor, fromDate: first, toDate: last,
      focusFromDate: first, focusToDate: last,
      anchoring: "all", bounded: false, backDays: null, todayDate: null,
    };
  }

  if (view === "day")
    return { view, anchorDate: anchor, fromDate: anchor, toDate: anchor, focusFromDate: anchor, focusToDate: anchor, ...calendarBase };
  if (view === "week") {
    const from = mondayOf(anchor), to = addDaysIso(from, 6);
    return { view, anchorDate: anchor, fromDate: from, toDate: to, focusFromDate: from, focusToDate: to, ...calendarBase };
  }
  if (view === "month") {
    const first = monthStartOf(anchor), last = monthEndOf(anchor);
    const gridFrom = mondayOf(first);
    const gridTo = addDaysIso(gridFrom, Math.ceil(daysBetweenIso(gridFrom, last) / 7) * 7 - 1);
    return { view, anchorDate: anchor, fromDate: gridFrom, toDate: gridTo, focusFromDate: first, focusToDate: last, ...calendarBase };
  }
  // AGENDA. A custom period if one was given and it is the right way round; otherwise the month the
  // anchor is in, which is the widest period a single press can produce and is what "This month" means.
  const from = custom?.from && isPeriodDate(custom.from) ? custom.from : monthStartOf(anchor);
  const toRaw = custom?.to && isPeriodDate(custom.to) ? custom.to : monthEndOf(anchor);
  const to = toRaw < from ? from : toRaw;
  return { view, anchorDate: anchor, fromDate: from, toDate: to, focusFromDate: from, focusToDate: to, ...calendarBase };
}

/**
 * The TRUE inclusive span of a bounded period, in days. Null for an unbounded one, because "all dates"
 * has no length and answering 31 would be a fiction.
 *
 * ⚠ THIS IS THE FUNCTION THAT TELLS THE TRUTH ABOUT "30 days". For encounters' 30d it returns 31, and
 * the footnote on that page prints it. See the header.
 */
export const periodSpanDays = (p: PeriodRange): number | null =>
  p.bounded ? daysBetweenIso(p.fromDate, p.toDate) : null;

/**
 * Previous / Next. Returns the ANCHOR (and, for Agenda, the range) of the neighbouring period.
 *
 * AGENDA MOVES BY ITS OWN LENGTH: a three-day agenda pressed Next shows the next three days, and a
 * year-long one shows the next year.
 */
export function shiftPeriod(p: PeriodRange, direction: 1 | -1): {
  anchorDate: string; from: string | null; to: string | null;
} {
  // ⚠ AN UNBOUNDED PERIOD HAS NO NEIGHBOUR, so the arrows step by MONTHS off the month the header is
  // standing on -- and the result is a bounded calendar month, which the label then says. The
  // alternative, shifting "all dates" by the length of the month it happens to be displaying, produces
  // 1 Sep - 1 Oct: a period nobody asked for, with an off-by-one nobody would ever notice.
  if (!p.bounded) {
    const start = addMonthsIso(monthStartOf(p.anchorDate), direction);
    return { anchorDate: start, from: start, to: monthEndOf(start) };
  }
  // ⚠ AND A ROLLING WINDOW HAS NO NEIGHBOUR EITHER, because its other end is today and today does not
  // move when you press an arrow. It shifts by its own length like any other range, and what comes back
  // is a FIXED period: `from` and `to` are returned, so the caller's URL carries dates rather than
  // "rolling", and periodLabel then reads "11 Jun - 10 Jul 2026" instead of "Last 30 days". Nobody is
  // ever looking at a window headed "Last 30 days" that is not the last 30 days. (This is the agenda
  // branch at the bottom; it is called out here because the consequence is not obvious.)
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
  // ⚠ THE LABEL SAYS WHICH ANCHORING IT IS, AND FOR A ROLLING WINDOW IT PRINTS THE DATES TOO.
  //
  // "Last 30 days" and "August 2026" are different claims and a header that could not tell them apart
  // would let a screen change what it shows without changing what it says. And because "30 days" already
  // means two different spans in this codebase (see the file header), the rolling label carries the
  // caller's own number AND the two real dates -- so the name can be loose and the screen still cannot
  // mislead anybody about which days are on it.
  if (p.anchoring === "all") return ALL_DATES_LABEL;
  if (p.anchoring === "rolling") {
    const window = p.backDays === 0 ? "Today" : `Last ${p.backDays} days`;
    return `${window} · ${rangeLabel(p.fromDate, p.toDate)}`;
  }
  if (p.view === "day") {
    const wd = WEEKDAY_LONG[isoWeekdayOf(p.anchorDate)] ?? "";
    return `${wd} ${dayNum(p.anchorDate)} ${monShort(p.anchorDate)} ${yr(p.anchorDate)}`.trim();
  }
  if (p.view === "month")
    return `${MONTH_LONG[Number(p.anchorDate.slice(5, 7)) - 1] ?? ""} ${yr(p.anchorDate)}`.trim();
  return rangeLabel(p.fromDate, p.toDate);
}

/** Two dates as one phrase, in the shortest form that is still unambiguous. */
function rangeLabel(a: string, b: string): string {
  // A whole calendar year reads as the year. "01 Jan - 31 Dec 2026" is the same fact spelled longer.
  if (a === yearStartOf(a) && b === yearEndOf(a) && yr(a) === yr(b)) return yr(a);
  if (a === b) return `${dayNum(a)} ${monShort(a)} ${yr(a)}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${dayNum(a)}-${dayNum(b)} ${monShort(a)} ${yr(a)}`;
  if (yr(a) === yr(b)) return `${dayNum(a)} ${monShort(a)} - ${dayNum(b)} ${monShort(b)} ${yr(a)}`;
  return `${dayNum(a)} ${monShort(a)} ${yr(a)} - ${dayNum(b)} ${monShort(b)} ${yr(b)}`;
}

/**
 * ⚠ "All dates" AND NOT "All time". A register holds what somebody entered into it, and this product's
 * registers are also capped and paged; "all time" is a claim about history, "all dates" is a claim about
 * a filter that is switched off. The second one is the one that is true.
 */
export const ALL_DATES_LABEL = "All dates";

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

// ── ROLLING PERIODS, AND "ALL DATES" ─────────────────────────────────────────────────────────────────
//
// ⚠ A THIRD LIST, FOR THE SAME REASON LONG_PERIODS IS A SECOND ONE. QUICK_PERIODS is asserted to be
// EXACTLY the six CP-PLAN-002 s3 names, and that assertion is worth more than the tidiness of one array.
//
// ⚠ AND THE NUMBER IN THE LABEL IS THE OFFSET, NOT THE SPAN. "Last 7 days" here is today-7 .. today,
// which is EIGHT calendar days. That is the arithmetic HISTORY_PERIODS has always used and the register
// a clinician has been reading for months; correcting it here would quietly shorten what they see. The
// header explains it, periodLabel prints both real dates, and periodSpanDays() says the true span for a
// screen that wants to print it. The one thing that does not happen is a silent change.

export const ROLLING_PERIODS = [
  { key: "today", label: "Today", backDays: 0 },
  { key: "7d", label: "Last 7 days", backDays: 7 },
  { key: "30d", label: "Last 30 days", backDays: 30 },
  { key: "90d", label: "Last 90 days", backDays: 90 },
  { key: "365d", label: "Last 365 days", backDays: 365 },
] as const;

export type RollingPeriodKey = (typeof ROLLING_PERIODS)[number]["key"];

export const isRollingPeriodKey = (v: unknown): v is RollingPeriodKey =>
  typeof v === "string" && ROLLING_PERIODS.some(r => r.key === v);

/** Where any chip takes you, in the one shape a screen turns into a URL. */
export type PeriodTarget = {
  view: PeriodView;
  anchorDate: string;
  from: string | null;
  to: string | null;
  anchoring: PeriodAnchoring;
  backDays: number | null;
};

export function rollingPeriodTarget(backDays: number, todayDate: string): PeriodTarget {
  const today = isPeriodDate(todayDate) ? todayDate : "1970-01-01";
  const back = Number.isInteger(backDays) && backDays >= 0 ? backDays : 0;
  return {
    view: "agenda", anchorDate: addDaysIso(today, -back),
    from: addDaysIso(today, -back), to: today, anchoring: "rolling", backDays: back,
  };
}

/** Switching the filter OFF. The anchor stays where the reader was, so the header does not jump. */
export const allDatesTarget = (anchorDate: string): PeriodTarget => ({
  view: "agenda", anchorDate: isPeriodDate(anchorDate) ? anchorDate : "1970-01-01",
  from: null, to: null, anchoring: "all", backDays: null,
});

// ── THE URL CONTRACT ─────────────────────────────────────────────────────────────────────────────────
//
// ⚠ ONE SET OF QUERY KEYS FOR EVERY SCREEN THAT ADOPTS THIS, so a period is bookmarkable, survives a
// link into a record and back, and means the same thing on all of them. Six screens each inventing
// `?from=&to=` is six parsers, and the two that already exist in this product -- encounters' hperiod /
// hfrom / hto and reports' from / to / days -- ALREADY DISAGREE with each other.
//
// ⚠ THE TWO LEGACY SPELLINGS ARE NOT BROKEN BY THIS. Their screens map their own keys onto these
// functions rather than being re-addressed; a bookmark somebody made last week still opens what it did.

export const PERIOD_PARAMS = {
  view: "pv", date: "pd", from: "pf", to: "pt", anchoring: "pa", back: "pb",
} as const;

/** A period as query values. Null means "leave this key out", never "empty string". */
export function periodToParams(t: {
  view: PeriodView; anchorDate: string; from: string | null; to: string | null;
  anchoring?: PeriodAnchoring | null; backDays?: number | null;
}): Record<string, string | null> {
  const anchoring = t.anchoring ?? "calendar";
  return {
    [PERIOD_PARAMS.anchoring]: anchoring === "calendar" ? null : anchoring,
    [PERIOD_PARAMS.view]: anchoring === "calendar" ? t.view : null,
    [PERIOD_PARAMS.date]: t.anchorDate,
    [PERIOD_PARAMS.from]: anchoring === "calendar" ? t.from : null,
    [PERIOD_PARAMS.to]: anchoring === "calendar" ? t.to : null,
    [PERIOD_PARAMS.back]: anchoring === "rolling" && t.backDays !== null && t.backDays !== undefined
      ? String(t.backDays) : null,
  };
}

/**
 * A URL back into a period, with the screen's own default when the URL says nothing.
 *
 * ⚠ `fallback` IS REQUIRED AND HAS NO DEFAULT VALUE. Every screen that adopts this control already had a
 * default -- three of them showed their whole register and two ran a rolling window -- and a shared
 * parser that quietly picked one of those would change the other four the day it shipped. Making the
 * caller say it is what keeps "the default did not move" a provable claim rather than a hope.
 *
 * ⚠ AND AN UNREADABLE VALUE FALLS BACK RATHER THAN NARROWING. `?pa=banana` resolving to an empty period
 * would render as a register with nothing in it, which is this codebase's oldest sin in a new costume.
 */
export function periodFromParams(
  get: (key: string) => string | null | undefined,
  todayDate: string,
  fallback: PeriodTarget,
): PeriodRange {
  const raw = (k: string) => {
    const v = get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const anchorRaw = raw(PERIOD_PARAMS.date);
  const anchor = isPeriodDate(anchorRaw) ? anchorRaw : null;
  const anchoringRaw = raw(PERIOD_PARAMS.anchoring);

  if (anchoringRaw === "all") return resolvePeriod("agenda", anchor ?? todayDate, { anchoring: "all" });

  if (anchoringRaw === "rolling") {
    const back = Number.parseInt(raw(PERIOD_PARAMS.back) ?? "", 10);
    if (Number.isInteger(back) && back >= 0)
      return resolvePeriod("agenda", todayDate, { anchoring: "rolling", backDays: back, todayDate });
    // A rolling window with no length is not a period. Falling back is the honest move.
    return resolveTarget(fallback, todayDate);
  }

  const viewRaw = raw(PERIOD_PARAMS.view);
  if (isPeriodView(viewRaw) && anchor)
    return resolvePeriod(viewRaw, anchor, { from: raw(PERIOD_PARAMS.from), to: raw(PERIOD_PARAMS.to) });

  return resolveTarget(fallback, todayDate);
}

/** A target as the range it stands for. The one place a chip and a URL agree about what they mean. */
export function resolveTarget(t: PeriodTarget, todayDate: string): PeriodRange {
  if (t.anchoring === "rolling")
    return resolvePeriod("agenda", todayDate, { anchoring: "rolling", backDays: t.backDays, todayDate });
  if (t.anchoring === "all")
    return resolvePeriod("agenda", t.anchorDate, { anchoring: "all" });
  return resolvePeriod(t.view, t.anchorDate, { from: t.from, to: t.to });
}
