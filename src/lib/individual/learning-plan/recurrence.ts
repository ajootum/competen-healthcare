import { occurrenceKey, type CalendarEntry, type EntryException, type Occurrence, type Recurrence } from "./types";

// ── RECURRENCE ── My Plan calendar enhancement (owner GO 2 Nov 2026) ──────────────────────────────────────────────
//
// Pure: no I/O, no clock. A calendar entry is ONE row (a series). Its occurrences are worked out here, on request, and are
// never stored. A change to ONE occurrence (cancel, move, edit, complete) is an exception row for that date alone, so the
// rest of the series is never touched by it. Days are plain YYYY-MM-DD dates with no time zone (a calendar date the learner
// chose). Weekdays are 0 = Monday ... 6 = Sunday, as the study calendar counts them.

export const MAX_OCCURRENCES = 200;
const DAY = 86_400_000;
const MAX_STEPS = 4000;

export const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
export const plusDays = (iso: string, n: number) => new Date((dayNumber(iso) + n) * DAY).toISOString().slice(0, 10);
/** Monday = 0. */
export const weekdayOf = (iso: string) => (((dayNumber(iso) + 3) % 7) + 7) % 7;
export const isCalendarDate = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;

/**
 * Pure. The dates a series gives, in order, from its first date: at most MAX_OCCURRENCES. Without a recurrence it is the one date.
 * `until` is inclusive. With both `until` and `count`, whichever ends it first.
 */
export function seriesDates(entry: Pick<CalendarEntry, "entryDate" | "recurrence">): string[] {
  const start = entry.entryDate;
  const r: Recurrence | null = entry.recurrence;
  if (!r) return [start];
  const limit = Math.min(MAX_OCCURRENCES, r.count && r.count > 0 ? Math.floor(r.count) : MAX_OCCURRENCES);
  const until = r.until && isCalendarDate(r.until) ? r.until : null;
  const interval = Math.min(4, Math.max(1, Math.floor(r.interval || 1)));
  const out: string[] = [];
  if (r.freq === "daily") {
    for (let k = 0, step = 0; out.length < limit && step < MAX_STEPS; k += interval, step++) {
      const d = plusDays(start, k);
      if (until && d > until) break;
      out.push(d);
    }
    return out;
  }
  const days = [...new Set((r.byweekday ?? []).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  if (!days.length) days.push(weekdayOf(start));
  const monday = plusDays(start, -weekdayOf(start));
  for (let w = 0, step = 0; out.length < limit && step < MAX_STEPS; w += interval, step++) {
    const weekStart = plusDays(monday, 7 * w);
    for (const wd of days) {
      const d = plusDays(weekStart, wd);
      if (d < start) continue;
      if (until && d > until) return out;
      if (out.length >= limit) return out;
      out.push(d);
    }
  }
  return out;
}

/** Whether a recurrence is bounded and gives at most MAX_OCCURRENCES. (A series that would give more is refused when it is made.) */
export function seriesWithinLimit(entry: Pick<CalendarEntry, "entryDate" | "recurrence">): boolean {
  const r = entry.recurrence;
  if (!r) return true;
  if (!(r.until || r.count)) return false;
  if (r.count != null && (r.count < 1 || r.count > MAX_OCCURRENCES)) return false;
  // With an end date and no count the series is expanded in full: it must end before the cap is reached.
  if (r.until && r.count == null) return seriesDates({ entryDate: entry.entryDate, recurrence: { ...r, count: null } }).length < MAX_OCCURRENCES;
  return true;
}

const minutesBetween = (a: string, b: string) => (Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5)));
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export type ExpandOptions = { includeCancelled?: boolean };

/**
 * Pure. The occurrences of one entry whose CURRENT date falls in [from, to], after its exceptions. Deterministic.
 *   cancelled   the occurrence is left out (or listed as cancelled with includeCancelled)
 *   moved       it is on `newDate` (and keeps its key, which names the date the series gave it)
 *   edited      the title and times of that occurrence alone change
 *   completed   the learner marked it done (selfReported)
 * A change to one occurrence never changes another. A cancelled or completed SERIES applies to every occurrence that has no
 * exception of its own.
 */
export function expandEntry(entry: CalendarEntry, exceptions: readonly EntryException[], from: string, to: string, o: ExpandOptions = {}): Occurrence[] {
  const byDate = new Map(exceptions.filter(e => e.entryId === entry.id).map(e => [e.occurrenceDate, e]));
  const recurring = !!entry.recurrence;
  const out: Occurrence[] = [];
  for (const original of seriesDates(entry)) {
    const ex = byDate.get(original);
    const cancelled = ex ? ex.action === "cancelled" : entry.status === "cancelled";
    if (cancelled && !o.includeCancelled) continue;
    const date = !cancelled && ex?.newDate ? ex.newDate : original;
    if (date < from || date > to) continue;
    const completed = !cancelled && (ex ? ex.action === "completed" : entry.status === "completed");
    const startTime = ex && !cancelled && (ex.newStartTime || ex.newEndTime) ? hhmm(ex.newStartTime ?? entry.startTime) : hhmm(entry.startTime);
    const endTime = ex && !cancelled && (ex.newStartTime || ex.newEndTime) ? hhmm(ex.newEndTime ?? entry.endTime) : hhmm(entry.endTime);
    const duration = entry.durationMinutes ?? (startTime && endTime && minutesBetween(startTime, endTime) > 0 ? minutesBetween(startTime, endTime) : null);
    out.push({
      key: occurrenceKey(entry.id, original), entryId: entry.id, experience: entry.experience, entryType: entry.entryType,
      title: (!cancelled && ex?.title) || entry.title, description: entry.description, date, occurrenceDate: original,
      startTime, endTime, allDay: !startTime, durationMinutes: duration, link: entry.link,
      status: cancelled ? "cancelled" : completed ? "completed" : "planned", selfReported: completed,
      moved: !cancelled && !!ex?.newDate && ex.newDate !== original, edited: !cancelled && !!ex && (!!ex.title || !!ex.newStartTime || !!ex.newEndTime), recurring,
    });
  }
  return out;
}

/** Pure. Every entry's occurrences in [from, to], in date, time and title order. */
export function expandEntries(entries: readonly CalendarEntry[], exceptions: readonly EntryException[], from: string, to: string, o: ExpandOptions = {}): Occurrence[] {
  return entries.flatMap(e => expandEntry(e, exceptions, from, to, o))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
