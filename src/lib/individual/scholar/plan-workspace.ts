import type { CalendarItem } from "./study-calendar";
import { monthLabel } from "./monthly-review";
import { WEEKDAY_NAMES, addDay, agendaItemOrder, entryDateBounds, entryTypeLabel, isDay, monthsOfWeek, planViewHref, weekdayIndex, whenLabel, type AgendaDay, type EntryForm, type LinkOption } from "./plan-view";

// ── MY PLAN -> CALENDAR-FIRST WORKSPACE: THE SMALL DECISIONS ── CE-03 (mobile-first) ──────────────────────────────────
//
// Pure, no I/O, no clock of its own, no AI. The month grid (Monday first, with the days of the neighbouring months that fill its weeks), what one
// day's cell shows (a few dots, never titles), how a day's completed records fold into one row WITHOUT touching any record, which actions an empty
// day offers, and what "Plan study" prefills. Types only from the calendar, so client and server components both read it.

// ── span, selected date and what to load ──
export type PlanSpan = "week" | "month";
/** ?span=: the month grid is the default. */
export const parseSpan = (q: unknown): PlanSpan => ((Array.isArray(q) ? q[0] : q) === "week" ? "week" : "month");
export const weekStartOf = (date: string): string => addDay(date, -weekdayIndex(date));
export const monthOfDate = (date: string): string => date.slice(0, 7);
/** The month `n` months from `month` (YYYY-MM). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
/**
 * Pure. The weeks of a month's grid, Monday first: leading days of the month before and trailing days of the month after fill the first and last
 * week, so every row has seven dates (five or six rows).
 */
export function monthGridDates(month: string): string[][] {
  const start = weekStartOf(`${month}-01`);
  const last = addDay(`${shiftMonth(month, 1)}-01`, -1);
  const weeks: string[][] = [];
  for (let ws = start; ws <= last; ws = addDay(ws, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDay(ws, i)));
  return weeks;
}
export type CalendarState = {
  span: PlanSpan;
  /** The selected day. */
  date: string;
  month: string;
  weekStart: string;
  /** The months to load: the selected month, or both months of a week that crosses a month end. */
  months: string[];
  /** Every date the grid draws (the month's weeks, or the one week). */
  gridDates: string[];
};
/**
 * Pure. The calendar's state from the address: ?date= (else the older ?from= or ?month=, else today), kept within three years of today, and ?span=.
 * A month asked for with no day selects its first day, or today when it is this month.
 */
export function resolveCalendarState(sp: { date?: unknown; from?: unknown; month?: unknown; span?: unknown }, today: string): CalendarState {
  const one = (x: unknown) => (Array.isArray(x) ? x[0] : x);
  const { min, max } = entryDateBounds(today);
  const m = one(sp.month);
  const monthDay = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) && isDay(`${m}-01`) ? (m === monthOfDate(today) ? today : `${m}-01`) : null;
  let date = [one(sp.date), one(sp.from)].find(isDay) ?? monthDay ?? today;
  if (date < min) date = min;
  if (date > max) date = max;
  const span = parseSpan(sp.span);
  const weekStart = weekStartOf(date);
  const month = monthOfDate(date);
  return {
    span, date, month, weekStart,
    months: span === "week" ? monthsOfWeek(weekStart, 7) : [month],
    gridDates: span === "week" ? Array.from({ length: 7 }, (_, i) => addDay(weekStart, i)) : monthGridDates(month).flat(),
  };
}
/** Pure. The day selected after stepping back or on: a week moves seven days, a month lands on its first day (or today, in this month). */
export function stepDate(s: { span: PlanSpan; date: string }, dir: -1 | 1, today: string): string {
  if (s.span === "week") return addDay(s.date, 7 * dir);
  const m = shiftMonth(monthOfDate(s.date), dir);
  return m === monthOfDate(today) ? today : `${m}-01`;
}
export const spanMonthLabel = (month: string): string => monthLabel(month);
/** The address of the calendar at a span and day below `base`. Today and the month grid are the defaults, so they are left out. */
export function calendarHref(base: string, o: { span: PlanSpan; date: string; today: string; extra?: Record<string, string | null | undefined> }): string {
  return planViewHref(base, "calendar", { ...(o.extra ?? {}), span: o.span === "week" ? "week" : null, date: o.date === o.today ? null : o.date });
}

// ── what a day's cell shows ──
/** Blue = Scholar's planned study (and cards due, the monthly review), green = completed, purple = the learner's own entries. */
export type DotKind = "planned" | "done" | "mine";
export type DayUnit = { key: string; dot: DotKind; label: string; count: number };
export const MAX_DOTS = 3;
/** Whether an own entry blocks the day: busy time and placements. */
export const isUnavailableEntry = (i: Pick<CalendarItem, "kind" | "occurrence">): boolean =>
  i.kind === "personal" && !!i.occurrence && (i.occurrence.entryType === "busy" || i.occurrence.entryType === "placement");
/** Time the learner marked busy is a hatched cell, not a dot. */
const isBusyOnly = (i: Pick<CalendarItem, "kind" | "occurrence">): boolean => i.kind === "personal" && i.occurrence?.entryType === "busy";
const DOT_RANK: Record<DotKind, number> = { mine: 0, planned: 1, done: 2 };
/**
 * Pure. One day's items as the few things its cell can show: one unit per own entry and per Scholar item, ALL completed records as ONE unit (a
 * day of five lessons is one green dot, never five), busy time as none (the cell is hatched). Own entries first, then the plan, then done.
 */
export function dayUnits(items: readonly CalendarItem[]): { units: DayUnit[]; unavailable: boolean } {
  const units: DayUnit[] = [];
  let done = 0;
  for (const i of items) {
    if (i.kind === "completed") { done += i.count ?? 1; continue; }
    if (isBusyOnly(i)) continue;
    const dot: DotKind = i.kind === "personal" ? "mine" : "planned";
    units.push({ key: i.key, dot, label: i.title, count: i.kind === "due_revision" ? i.count ?? 1 : 1 });
  }
  units.sort((a, b) => DOT_RANK[a.dot] - DOT_RANK[b.dot]);
  if (done > 0) units.push({ key: "done", dot: "done", label: done === 1 ? "1 completed" : `${done} completed`, count: done });
  return { units, unavailable: items.some(isUnavailableEntry) };
}
/** Pure. The first `max` units as dots and how many more there are ("+2"). */
export function dotSlice(units: readonly DayUnit[], max = MAX_DOTS): { shown: DayUnit[]; more: number } {
  return { shown: units.slice(0, max), more: Math.max(0, units.length - max) };
}
/** Pure. What a cell says to a screen reader: the day and what is on it, in words. */
export function cellLabel(longDay: string, today: boolean, items: readonly CalendarItem[]): string {
  const { units, unavailable } = dayUnits(items);
  const what = units.length ? units.map(u => u.label).join("; ") : "nothing planned";
  return `${longDay}${today ? ", today" : ""}: ${what}${unavailable ? ". Unavailable or busy" : ""}`;
}

// ── completed records, folded for display only ──
export type DoneKind = "lesson" | "revision" | "case" | "evaluation" | "cards";
const DONE_KEY = /^done:(lesson|revision|case|evaluation|cards):/;
export const doneKindOfKey = (key: string): DoneKind | null => (DONE_KEY.exec(key)?.[1] as DoneKind | undefined) ?? null;
/** The ISO time inside a completed record's key (`done:${kind}:${at}:${href}`), or null (a day of reviewed cards has only a date). */
export function doneAtOfKey(key: string): string | null {
  const m = /^done:[a-z]+:(\d{4}-\d{2}-\d{2}T[0-9:.]+Z?)(?::|$)/.exec(key);
  return m && !Number.isNaN(Date.parse(m[1])) ? m[1] : null;
}
const DONE_NOUN: Record<DoneKind, string> = { lesson: "learning session", revision: "revision session", case: "case practice session", evaluation: "evaluation", cards: "card review" };
export type DayRow<T> =
  | { type: "single"; item: T }
  | { type: "group"; key: string; title: string; kind: DoneKind; count: number; items: T[] };
/** "Patient safety — 5 learning sessions completed". */
export const groupTitle = (title: string, kind: DoneKind, n: number): string => `${title} — ${n} ${DONE_NOUN[kind]}${n === 1 ? "" : "s"} completed`;
const groupKeyOf = (key: string, title: string): string | null => {
  const kind = doneKindOfKey(key);
  return kind ? `${kind}|${title.trim().toLowerCase()}` : null;
};
/**
 * Pure, display only. Completed records of the same kind and title (the same material or topic) fold into one row listing each underneath. Every
 * record keeps its own key and sits inside its group, in order: nothing is merged, dropped, counted twice or changed. The row sits where the first of
 * its records was. One record on its own stays as it is.
 */
export function groupCompleted<T extends { key: string; title: string }>(items: readonly T[]): DayRow<T>[] {
  const groups = new Map<string, T[]>();
  for (const i of items) {
    const gk = groupKeyOf(i.key, i.title);
    if (gk) groups.set(gk, [...(groups.get(gk) ?? []), i]);
  }
  const rows: DayRow<T>[] = [];
  const placed = new Set<string>();
  for (const i of items) {
    const gk = groupKeyOf(i.key, i.title);
    const list = gk ? groups.get(gk) : undefined;
    if (!gk || !list || list.length < 2) { rows.push({ type: "single", item: i }); continue; }
    if (placed.has(gk)) continue;
    placed.add(gk);
    rows.push({ type: "group", key: `group:${gk}`, title: i.title, kind: doneKindOfKey(i.key) as DoneKind, count: list.length, items: list });
  }
  return rows;
}
/** Every record key a list of rows holds, in order (the test of "nothing was lost"). */
export const rowKeys = <T extends { key: string }>(rows: readonly DayRow<T>[]): string[] => rows.flatMap(r => (r.type === "single" ? [r.item.key] : r.items.map(i => i.key)));

// ── one revision row, not two ──
/** The plan's own "Review your due cards" activity (ref `revise:due`). */
export const isDuePlanItem = (i: Pick<CalendarItem, "kind" | "key">): boolean => i.kind === "planned" && i.key.startsWith("plan:revise:due");
/**
 * Pure, display only. On a day where the plan has its "Review your due cards" activity AND the calendar counts cards due, that is ONE row:
 * "Review 3 flashcards" (the count from the due data, the plan's minutes, the plan's place for a move). The separate cards-due row is not drawn. A day with
 * due cards and no such activity keeps its single cards-due row. Nothing is stored or changed.
 */
export function mergeDueRevision(items: readonly CalendarItem[]): CalendarItem[] {
  const plan = items.find(isDuePlanItem);
  const due = items.find(i => i.kind === "due_revision");
  if (!plan || !due) return [...items];
  const n = due.count ?? 0;
  const merged: CalendarItem = { ...plan, title: n > 0 ? `Review ${n} flashcard${n === 1 ? "" : "s"}` : plan.title, count: n || plan.count, href: due.href ?? plan.href, detail: due.detail ?? plan.detail };
  return items.flatMap(i => (i === plan ? [merged] : i === due ? [] : [i]));
}
/** Pure. The same merge for every day of a list. */
export const mergeDueRevisionDays = <D extends { items: CalendarItem[] }>(days: readonly D[]): D[] => days.map(d => ({ ...d, items: mergeDueRevision(d.items) }));

// ── a day's row, in words ──
export type StatusWord = "Suggested" | "Planned" | "Completed" | "Postponed";
const SPACE_WORD: Record<string, string> = { learn: "Learn", revise: "Revise", apply: "Apply", evaluate: "Evaluate" };
/** The minutes an item carries: its own, or the length of the learner's entry. */
export const itemMinutes = (i: Pick<CalendarItem, "minutes" | "occurrence">): number | null => i.minutes ?? i.occurrence?.durationMinutes ?? null;
/** Pure. The status an item shows, where the data knows it: Suggested (Scholar's), Planned (the learner's), Completed, Postponed (moved to a later day). */
export function itemStatus(i: CalendarItem, date: string): StatusWord | null {
  if (i.kind === "personal") return i.occurrence?.status === "completed" ? "Completed" : "Planned";
  if (i.kind === "completed") return "Completed";
  if (i.kind === "planned") return i.movedFrom && date > i.movedFrom ? "Postponed" : "Suggested";
  if (i.kind === "monthly_review") return "Suggested";
  return null;
}
/** Pure. The muted line under a row's title: "Due for revision", "Suggested · Learn", "Exam · about Renal", "Completed". */
export function rowSubtitle(i: CalendarItem, date: string): string {
  if (i.kind === "due_revision") return "Due for revision";
  if (i.kind === "completed") return i.detail ? `Completed · ${i.detail}` : "Completed";
  if (i.kind === "monthly_review") return "Optional monthly review";
  if (isDuePlanItem(i) && i.count) return i.movedFrom && date > i.movedFrom ? "Postponed · Due for revision" : "Due for revision";
  if (i.kind === "planned") return [itemStatus(i, date), i.space ? SPACE_WORD[i.space] : ""].filter(Boolean).join(" · ");
  const o = i.occurrence;
  if (!o) return "";
  return [entryTypeLabel(o.entryType), o.status === "completed" ? "Completed (your word)" : "", o.link ? `about ${o.link.label}` : ""].filter(Boolean).join(" · ");
}
export type IconKind = "revision" | "learning" | "personal" | "deadline" | "unavailable" | "done";
/** Pure. Which round icon a row wears. */
export function rowIconKind(i: CalendarItem): IconKind {
  if (i.kind === "completed") return "done";
  if (i.kind === "due_revision") return "revision";
  if (i.kind === "planned") return i.space === "revise" ? "revision" : "learning";
  if (i.kind === "monthly_review") return "learning";
  const t = i.occurrence?.entryType;
  return t === "busy" || t === "placement" ? "unavailable" : t === "exam" || t === "deadline" ? "deadline" : "personal";
}
/** Pure. The chip beside a row: the time and length of the learner's entry, or the minutes of a Scholar item. Empty when neither is known. */
export function rowWhen(i: CalendarItem): string {
  if (i.occurrence) return whenLabel(i.occurrence);
  return i.minutes ? `${i.minutes} min` : "";
}
/** Pure. The selected-day header's chip: "2 activities • 25 min", "3 completed" (a past day), or "" for an empty day. */
export function dayChip(items: readonly CalendarItem[]): string {
  const active = items.filter(i => i.kind !== "completed" && !isUnavailableEntry(i));
  const done = items.filter(i => i.kind === "completed").reduce((n, i) => n + (i.count ?? 1), 0);
  if (active.length) {
    const min = active.reduce((n, i) => n + (itemMinutes(i) ?? 0), 0);
    return `${active.length} ${active.length === 1 ? "activity" : "activities"}${min ? ` • ${min} min` : ""}`;
  }
  return done ? `${done} completed` : "";
}

// ── an empty selected day ──
export type EmptyAction = "add" | "plan" | "free";
/**
 * Pure. What an empty day offers: Add activity (the dialog, this date), Plan study (a Scholar-suggested study session for the date, confirmed in the
 * dialog: nothing is created by itself) and Leave free (dismisses; no write). A past day offers only Add (to record something), a learner who cannot
 * add (migration 840 absent) gets only Leave free.
 */
export function emptyDayActions(o: { date: string; today: string; canAdd: boolean }): EmptyAction[] {
  if (!o.canAdd) return ["free"];
  return o.date < o.today ? ["add"] : ["add", "plan", "free"];
}
/**
 * Pure. What "Plan study" fills in: the plan's own next suggestion in the loaded days (title, minutes, and a topic the title names), else a plain
 * 30 minute study session. The learner still confirms it in the dialog.
 */
export function planStudyPrefill(days: readonly AgendaDay[], links: readonly LinkOption[], today: string): Partial<EntryForm> {
  const first = days.filter(d => d.date >= today).flatMap(d => d.items).find(i => i.kind === "planned");
  if (!first) return { entryType: "study_session", title: "Study session", duration: "30" };
  const hay = `${first.title} ${first.detail ?? ""}`.toLowerCase();
  const link = [...links].filter(l => l.kind === "topic" && l.label.length >= 3 && hay.includes(l.label.toLowerCase())).sort((a, b) => b.label.length - a.label.length)[0];
  const mins = first.minutes && first.minutes >= 5 && first.minutes <= 1440 ? String(first.minutes) : "30";
  return { entryType: "study_session", title: first.title.slice(0, 200), duration: mins, link: link?.value ?? "" };
}
/** Pure. One selected day's items from the loaded days, in the order a learner reads a day. */
export const itemsOfDay = (days: readonly AgendaDay[], date: string): CalendarItem[] => agendaItemOrder(days.find(d => d.date === date)?.items ?? []);
/** Pure. "Monday 2 November": a day in full, the way the selected-day panel names it. */
export function longDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAY_NAMES[weekdayIndex(date)]} ${d.getUTCDate()} ${d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })}`;
}
/** Pure. Whether anything is planned or due on a day: a Scholar or own item that is not already done, not busy time, or cards due. Today shows its action workspace only then. */
export function hasPlansOn(items: readonly CalendarItem[] | null, dueCards: number, hasSuggestion: boolean): boolean {
  if (items === null) return hasSuggestion || dueCards > 0;
  return dueCards > 0 || items.some(i => i.kind !== "completed" && !isUnavailableEntry(i));
}
