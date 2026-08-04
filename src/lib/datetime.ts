// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE PLACE THAT DECIDES WHAT A TIME LOOKS LIKE.
//
// ---- WHY THIS EXISTS ---------------------------------------------------------------------------------
//
// `new Date(x).toLocaleString()` with no locale uses THE RUNTIME'S locale. On a server that is whatever
// the container was built with; in a browser it is whatever the user's machine says. So the same
// timestamp could render "2:30 PM" server-side and "14:30" after hydration, or differ between two
// people looking at the same screen -- and in a clinical product a time that reads differently to two
// people is a genuine hazard, not a cosmetic one.
//
// Ninety call sites across the app were doing exactly that. This module is the single answer.
//
// ---- THE TWO DECISIONS -------------------------------------------------------------------------------
//
// en-GB, because the product is built for East Africa: day-before-month, and 24-hour by default.
//
// hourCycle "h23", NOT hour12:false. They differ at exactly one moment: several engines render midnight
// as "24:00" under hour12:false, and "24:00" on a ward round is the kind of thing somebody reads as
// tomorrow. practice-time.ts already carries a comment about this trap; h23 is the fix rather than the
// workaround.
//
// ---- TIME ZONES --------------------------------------------------------------------------------------
//
// `timeZone` is OPTIONAL and should be passed wherever the practice's own clock is known -- CPR-140 and
// CPR-300 established that the practice's day, not the reader's, is the one that matters. Omitting it
// falls back to the runtime zone, which is right for things that are about the reader (when did I sign
// in) and wrong for things about the practice (when is this clinic).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type When = Date | string | number | null | undefined;

const toDate = (v: When): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Everything here shares this, so a format can never drift between two call sites. */
const base = (timeZone?: string): Intl.DateTimeFormatOptions => ({
  hourCycle: "h23",
  ...(timeZone ? { timeZone } : {}),
});

/** "14:30" */
export function formatTime(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...base(timeZone) });
}

/** "14:30:05" -- only where the second genuinely matters, such as an audit trail. */
export function formatTimeWithSeconds(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", ...base(timeZone),
  });
}

/** "4 Aug 2026" */
export function formatDate(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", ...base(timeZone),
  });
}

/** "4 Aug 2026, 14:30" */
export function formatDateTime(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", ...base(timeZone),
  });
}

/** "Tue 4 Aug, 14:30" -- for a diary, where the weekday is what a person navigates by. */
export function formatDayTime(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", ...base(timeZone),
  });
}

/**
 * Minutes past local midnight as "14:30".
 *
 * The counterpart for values that were never instants -- a weekly template's start, a clinic's opening
 * hour. Migrations 229 and 230 store those as minutes precisely because "opens at 09:00" is true on
 * every date, and formatting them through a Date would invent one.
 */
export function formatMinuteOfDay(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
