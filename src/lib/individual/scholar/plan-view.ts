import type { CalendarDay, CalendarItem } from "./study-calendar";
import type { EntryType, GoalType, ScholarPlanSettings } from "../learning-plan/types";

// ── MY PLAN: THE VIEW HELPERS ── PLP-01..04 (owner GO 2 Nov 2026) ────────────────────────────────────────────────────
//
// Pure, no I/O, no clock of its own, no AI. The small decisions the My Plan screens make that are worth testing without a browser:
// which of the three views is asked for, the 7-day agenda built from the calendar's days, what the setup and calendar forms send.
// The SERVER still checks everything (plan-settings.ts, learning-plan/calendar-entries.ts); this only stops an obvious mistake before
// a round trip and says it in the learner's words. Imports types only, so client and server components both read it.

// ── the three views ──
// CE-03 (mobile-first): Calendar is the front door, then Today, then Insights.
export const PLAN_VIEWS = ["calendar", "today", "insights"] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];
export const DEFAULT_PLAN_VIEW: PlanView = "calendar";
export const PLAN_VIEW_LABEL: Record<PlanView, string> = { calendar: "Calendar", today: "Today", insights: "Insights" };
/** The one line under each view's name (screen readers and wide layouts). */
export const PLAN_VIEW_DESC: Record<PlanView, string> = { calendar: "Personal and Scholar plans", today: "What to study next", insights: "Progress and adjustments" };
const isPlanView = (v: unknown): v is PlanView => typeof v === "string" && (PLAN_VIEWS as readonly string[]).includes(v);
/** ?view=: anything else is the Calendar (the default). */
export function parsePlanView(q: unknown): PlanView {
  const v = Array.isArray(q) ? q[0] : q;
  return isPlanView(v) ? v : DEFAULT_PLAN_VIEW;
}
/** The address of a view below `base`, keeping only the parts given. The view is ALWAYS written (an explicit ?view= wins over the remembered one). */
export function planViewHref(base: string, view: PlanView, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  q.set("view", view);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return `${base}?${q.toString()}`;
}
/** Where the learner's last view is kept on this device (a convenience only: a private window simply opens the Calendar). */
export const PLAN_VIEW_STORE = "myplan.view";
/**
 * Pure. Which view opens. An explicit ?view= always wins (and is what gets remembered). With none, the default is the Calendar unless this device
 * remembers another view: then `redirectTo` says so (the client replaces the address, once; the server never redirects).
 */
export function resolveView(query: unknown, stored: unknown): { view: PlanView; redirectTo: PlanView | null; remember: PlanView | null } {
  const v = Array.isArray(query) ? query[0] : query;
  if (isPlanView(v)) return { view: v, redirectTo: null, remember: v };
  return { view: DEFAULT_PLAN_VIEW, redirectTo: isPlanView(stored) && stored !== DEFAULT_PLAN_VIEW ? stored : null, remember: null };
}

// ── dates (YYYY-MM-DD, UTC arithmetic: the strings are already the learner's local days) ──
const DAY = 86_400_000;
export const isDay = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
export const addDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 0 = Monday ... 6 = Sunday, as the repeat rule counts weekdays. */
export const weekdayIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** The furthest dates a calendar entry may be on: three years either side of today (the server's own limit). */
export function entryDateBounds(today: string): { min: string; max: string } {
  const lo = new Date(`${today}T00:00:00Z`); lo.setUTCFullYear(lo.getUTCFullYear() - 3);
  const hi = new Date(`${today}T00:00:00Z`); hi.setUTCFullYear(hi.getUTCFullYear() + 3);
  return { min: lo.toISOString().slice(0, 10), max: hi.toISOString().slice(0, 10) };
}

// ── the 7-day agenda ──
/** The calendar reaches 60 days ahead; the agenda may start a few weeks back (to see what was done) and up to eight weeks on. */
export const AGENDA_BACK_DAYS = 28;
export const AGENDA_FORWARD_DAYS = 56;
/** ?from=: the first day of the agenda, kept within reach; anything else is today. */
export function agendaStart(q: unknown, today: string): string {
  const v = Array.isArray(q) ? q[0] : q;
  if (!isDay(v)) return today;
  return v < addDay(today, -AGENDA_BACK_DAYS) ? addDay(today, -AGENDA_BACK_DAYS) : v > addDay(today, AGENDA_FORWARD_DAYS) ? addDay(today, AGENDA_FORWARD_DAYS) : v;
}
/** The distinct months (YYYY-MM) the seven days from `from` fall in: one, or two when the week crosses a month end. */
export function monthsOfWeek(from: string, count = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) { const m = addDay(from, i).slice(0, 7); if (!out.includes(m)) out.push(m); }
  return out;
}

const KIND_RANK: Record<CalendarItem["kind"], number> = { personal: 0, planned: 1, monthly_review: 2, due_revision: 3, completed: 4 };
/**
 * Pure. One day's items in the order a learner reads a day: their own entries first (all-day ones, then by start time), then the
 * Scholar plan, the monthly review, cards due, and what was done. The sort is stable, so the calendar's own order holds within a kind.
 */
export function agendaItemOrder(items: readonly CalendarItem[]): CalendarItem[] {
  const timeOf = (i: CalendarItem) => i.occurrence?.startTime ?? "";
  return [...items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.kind === "personal" ? timeOf(a).localeCompare(timeOf(b)) : 0));
}
export type AgendaDay = { date: string; today: boolean; past: boolean; items: CalendarItem[] };

// ── how an agenda row looks ──
/** Who an agenda row belongs to: the learner's own activity, Scholar's recommendation, a time the learner is unavailable, or something already done. */
export type AgendaTone = "mine" | "scholar" | "unavailable" | "done";
/** Pure. The tone of a calendar item: busy and placement entries are "unavailable", other entries "mine", what happened "done", the rest Scholar's. */
export function agendaTone(item: Pick<CalendarItem, "kind" | "occurrence">): AgendaTone {
  if (item.kind === "personal") return item.occurrence && (item.occurrence.entryType === "busy" || item.occurrence.entryType === "placement") ? "unavailable" : "mine";
  if (item.kind === "completed") return "done";
  return "scholar";
}
/** Pure. A day with nothing on it is shown as an open "Available" row, never hidden. */
export const isAvailableDay = (d: Pick<AgendaDay, "items">): boolean => d.items.length === 0;
/** Pure. "7:00 PM" from "19:00" (the form saves 24-hour times; the agenda reads them the way the learner says them). Anything else is returned as it came. */
export function clock12(t: string | null | undefined): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t ?? "");
  if (!m) return t ?? "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
/** Pure. "7:00 PM · 30 min", "8:00 AM–4:00 PM", "All day", or "30 min" for an item with no time. */
export function whenLabel(o: { allDay?: boolean; startTime?: string | null; endTime?: string | null; durationMinutes?: number | null; minutes?: number | null } | null | undefined): string {
  if (!o) return "";
  const mins = o.durationMinutes ?? o.minutes ?? null;
  const t = o.allDay || !o.startTime ? (o.allDay ? "All day" : "") : o.endTime ? `${clock12(o.startTime)}–${clock12(o.endTime)}` : clock12(o.startTime);
  return [t, mins ? `${mins} min` : ""].filter(Boolean).join(" · ");
}
/** Pure. The day number and short weekday of the agenda's date column ("2", "Mon"). */
export function dayParts(iso: string): { num: string; weekday: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  return { num: String(d.getUTCDate()), weekday: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) };
}
/** Pure. "2 to 8 Nov 2026" for the seven days of an agenda. */
export function rangeLabel(first: string, last: string): string {
  const f = new Date(`${first}T00:00:00Z`), l = new Date(`${last}T00:00:00Z`);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const a = f.toLocaleDateString("en-GB", { day: "numeric", ...(sameMonth ? {} : { month: "short" }), timeZone: "UTC" });
  const b = l.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${a} to ${b}`;
}
/**
 * Pure. The seven days from `from` out of the days of the loaded month views (a week may need two months). A day no loaded month holds
 * is an empty day, never an error. Cancelled entries are never in the calendar's items.
 */
export function weekAgenda(days: readonly CalendarDay[], from: string, today: string, count = 7): AgendaDay[] {
  const byDate = new Map<string, CalendarDay>();
  for (const d of days) byDate.set(d.date, d);
  return Array.from({ length: count }, (_, i) => {
    const date = addDay(from, i);
    return { date, today: date === today, past: date < today, items: agendaItemOrder(byDate.get(date)?.items ?? []) };
  });
}

// ── the learner's own entry: words, link choices, and what the form sends ──
export const ENTRY_TYPE_OPTIONS: readonly { value: EntryType; label: string }[] = [
  { value: "study_session", label: "Study session" },
  { value: "exam", label: "Exam or assessment" },
  { value: "deadline", label: "Deadline" },
  { value: "placement", label: "Placement or training" },
  { value: "busy", label: "Busy or unavailable" },
  { value: "other", label: "Other" },
];
export const entryTypeLabel = (t: EntryType) => ENTRY_TYPE_OPTIONS.find(o => o.value === t)?.label ?? "Other";

export type LinkOption = { value: string; kind: "material" | "topic"; id: string; label: string };
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Pure. What an entry can be about: the learner's materials, then their topics (each once, case aside), within the entry's own limits. */
export function linkOptions(materials: readonly { id: string; title: string }[], topics: readonly string[], maxTopics = 60): LinkOption[] {
  const out: LinkOption[] = materials.filter(m => m.id && m.id.length <= 120 && squash(m.title)).map(m => ({ value: `material:${m.id}`, kind: "material" as const, id: m.id, label: squash(m.title).slice(0, 200) }));
  const seen = new Set<string>();
  for (const raw of topics) {
    const label = squash(raw);
    const k = label.toLowerCase();
    if (!label || label.length > 120 || seen.has(k)) continue;
    seen.add(k);
    out.push({ value: `topic:${label}`, kind: "topic", id: label, label });
    if (seen.size >= maxTopics) break;
  }
  return out;
}

/** Times of day in steps of 15 minutes (a list to choose from, not a native time picker). A time already saved that is off the grid is kept in the list. */
export function timeChoices(current: readonly string[] = []): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  for (const c of current) if (/^([01]\d|2[0-3]):[0-5]\d$/.test(c) && !out.includes(c)) out.push(c);
  return out.sort();
}

export type EntryForm = {
  title: string; entryType: EntryType; date: string;
  startTime: string; endTime: string; duration: string;
  description: string; link: string;
  repeat: "none" | "daily" | "weekly"; weekdays: number[]; endMode: "until" | "count"; until: string; count: string;
};
export const emptyEntryForm = (date: string): EntryForm => ({
  title: "", entryType: "study_session", date, startTime: "", endTime: "", duration: "", description: "", link: "",
  repeat: "none", weekdays: [weekdayIndex(date)], endMode: "until", until: "", count: "",
});
export type Built<T> = { ok: true; body: T } | { ok: false; error: string };
const whole = (s: string): number | null => (/^\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * Pure. The body of a calendar entry from the form, or the first thing wrong in plain words. `schedule: false` (editing a repeating
 * entry as a whole) leaves out the date and the repeat so the stored ones stand. A repeat needs an end: a date or a number of times.
 */
export function buildEntryBody(f: EntryForm, today: string, o: { links: readonly LinkOption[]; schedule: boolean }): Built<Record<string, unknown>> {
  const title = squash(f.title);
  if (!title) return { ok: false, error: "Give the entry a title." };
  if (title.length > 200) return { ok: false, error: "Keep the title to 200 characters." };
  const { min, max } = entryDateBounds(today);
  if (o.schedule && (!isDay(f.date) || f.date < min || f.date > max)) return { ok: false, error: "Choose a date within 3 years of today." };
  if (f.endTime && !f.startTime) return { ok: false, error: "Give a start time as well as an end time, or neither for an all-day entry." };
  if (f.startTime && f.endTime && f.endTime <= f.startTime) return { ok: false, error: "The end time must be after the start time." };
  let durationMinutes: number | null = null;
  if (f.duration.trim()) {
    const d = whole(f.duration);
    if (d === null || d < 5 || d > 1440) return { ok: false, error: "Enter a length between 5 and 1440 minutes." };
    durationMinutes = d;
  }
  if (f.description.trim().length > 2000) return { ok: false, error: "Keep the description to 2000 characters." };
  const picked = f.link ? o.links.find(l => l.value === f.link) : null;
  const body: Record<string, unknown> = {
    entryType: f.entryType, title, description: squash(f.description) || null,
    startTime: f.startTime || null, endTime: f.endTime || null, durationMinutes,
    link: picked ? { kind: picked.kind, id: picked.id, label: picked.label } : null,
  };
  if (!o.schedule) return { ok: true, body };
  body.entryDate = f.date;
  if (f.repeat === "none") { body.recurrence = null; return { ok: true, body }; }
  const rec: Record<string, unknown> = { freq: f.repeat, interval: 1 };
  if (f.repeat === "weekly") rec.byweekday = f.weekdays.length ? [...new Set(f.weekdays)].sort((a, b) => a - b) : [weekdayIndex(f.date)];
  if (f.endMode === "until") {
    if (!isDay(f.until)) return { ok: false, error: "Choose the date the repeat ends." };
    if (f.until < f.date) return { ok: false, error: "The repeat cannot end before it starts." };
    if (f.until > max) return { ok: false, error: "Choose an end date within the next 3 years." };
    rec.until = f.until;
  } else {
    const c = whole(f.count);
    if (c === null || c < 1 || c > 200) return { ok: false, error: "Repeat between 1 and 200 times." };
    rec.count = c;
  }
  body.recurrence = rec;
  return { ok: true, body };
}

// ── the three-question setup ──
export const SESSION_CHOICES = [15, 20, 25, 30, 45, 60] as const;
export const GOAL_CHOICES: readonly { value: GoalType; label: string; hint: string }[] = [
  { value: "learn", label: "Learn consistently", hint: "A steady weekly rhythm through your own material." },
  { value: "exam", label: "Prepare for an exam", hint: "Working back from your exam date." },
  { value: "revise", label: "Revise existing learning", hint: "Bring back what you have already studied." },
];
export type SetupForm = { goalType: GoalType; sessionMinutes: string; daysPerWeek: string; examDate: string; examLabel: string; goal: string; priorities: string };
export const DEFAULT_SETUP: SetupForm = { goalType: "learn", sessionMinutes: "25", daysPerWeek: "4", examDate: "", examLabel: "", goal: "", priorities: "" };
/** The form for saved settings (or the defaults with none). A plan saved before 840 has no goal type: it reads as learn. */
export function setupFormFrom(s: ScholarPlanSettings | null): SetupForm {
  if (!s) return { ...DEFAULT_SETUP };
  return {
    goalType: s.goalType ?? (s.examDate ? "exam" : "learn"),
    sessionMinutes: String(s.sessionMinutes ?? Math.max(10, Math.round(s.weeklyMinutes / Math.max(1, s.daysPerWeek)))),
    daysPerWeek: String(s.daysPerWeek), examDate: s.examDate ?? "", examLabel: s.examLabel ?? "", goal: s.goal ?? "", priorities: s.priorities.join("\n"),
  };
}
/** Pure. Priority topics typed one per line or separated by commas: trimmed, each once (case aside), at most ten of 120 characters. */
export function parsePriorities(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const t = squash(raw);
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t.slice(0, 120));
  }
  return out.slice(0, 10);
}
/**
 * Pure. The body of POST plan/settings. With `extras` (migration 840) it is the new shape (goal, minutes per session, days); without
 * it the old shape, so a plan can still be saved while 840 is absent (weekly minutes = minutes x days). An exam date is asked only for an exam.
 */
export function buildSettingsBody(f: SetupForm, o: { extras: boolean; today: string; confirmIncrease?: boolean }): Built<Record<string, unknown>> {
  const minutes = whole(f.sessionMinutes), days = whole(f.daysPerWeek);
  if (minutes === null || minutes < 10 || minutes > 240) return { ok: false, error: "Choose how long one session lasts, between 10 and 240 minutes." };
  if (days === null || days < 1 || days > 7) return { ok: false, error: "Choose how many days a week you will study, from 1 to 7." };
  if (minutes * days < 30) return { ok: false, error: `That is only ${minutes * days} minutes a week. Plan at least 30.` };
  const exam = o.extras ? f.goalType === "exam" : f.examDate !== "";
  if (f.goalType === "exam" && o.extras && !isDay(f.examDate)) return { ok: false, error: "Enter the date of your exam, or choose another aim." };
  if (exam && f.examDate && (!isDay(f.examDate) || f.examDate < o.today)) return { ok: false, error: "Choose an exam date from today on." };
  const common = { examDate: exam && f.examDate ? f.examDate : null, examLabel: exam ? f.examLabel.trim() || null : null, goal: f.goal.trim() || null, priorities: parsePriorities(f.priorities) };
  const confirm = o.confirmIncrease ? { confirmIncrease: true } : {};
  return o.extras
    ? { ok: true, body: { goalType: f.goalType, sessionMinutes: minutes, daysPerWeek: days, ...common, ...confirm } }
    : { ok: true, body: { weeklyMinutes: minutes * days, daysPerWeek: days, ...common, ...confirm } };
}
/** Pure. Settings changed to a new session length (the weekly reflection's offer, used only when the learner says so). */
export function settingsWithSessionMinutes(s: ScholarPlanSettings, sessionMinutes: number): Record<string, unknown> {
  const common = { examDate: s.examDate, examLabel: s.examLabel, goal: s.goal, priorities: [...s.priorities], daysPerWeek: s.daysPerWeek };
  // A plan from before 840 has no goal type: keep the old shape rather than invent one.
  return s.goalType ? { goalType: s.goalType, sessionMinutes, ...common } : { weeklyMinutes: sessionMinutes * s.daysPerWeek, ...common };
}

// ── the Ready page proposal ──
/** Pure. The first `max` steps of the suggested sequence and how many more there are. */
export function sequencePreview<T>(sequence: readonly T[], max = 6): { shown: T[]; more: number } {
  return { shown: sequence.slice(0, max), more: Math.max(0, sequence.length - max) };
}
/** Pure. "2 hours 15 minutes" / "45 minutes": a workload in the words a learner reads. */
export function minutesWords(m: number): string {
  const n = Math.max(0, Math.round(m));
  if (n < 60) return `${n} minute${n === 1 ? "" : "s"}`;
  const h = Math.floor(n / 60), r = n % 60;
  return `${h} hour${h === 1 ? "" : "s"}${r ? ` ${r} minute${r === 1 ? "" : "s"}` : ""}`;
}
