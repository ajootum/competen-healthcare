import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import { ENTRY_TYPES, LINK_KINDS, type EntryLink, type EntryType, type ExceptionAction, type Occurrence, type PlanItem, type Recurrence } from "./types";
import { MAX_OCCURRENCES, isCalendarDate, plusDays, seriesWithinLimit } from "./recurrence";

// ── THE LEARNER'S OWN CALENDAR: VALIDATION AND MAPPING ── My Plan calendar enhancement (owner GO 2 Nov 2026) ───────
//
// Pure. What the learner types into a calendar entry, checked before it is saved. The limits are the 840 tables' own CHECKs.
// Free text is refused when it looks like it identifies a patient (as study plan text is). Dates must be real and within three
// years either side of today. A series is bounded (an end date or a count, at most 200 occurrences).
//
// ⚠ A PERSONAL STUDY SESSION IS PLANNED TIME, NOT EVIDENCE OF STUDY. Only the learner marking it completed makes it
//   "self-reported", and that is counted apart from recorded learning (scholar/learning-definitions.ts).

export const ENTRY_LIMITS = { titleMax: 200, descriptionMax: 2000, minMinutes: 5, maxMinutes: 1440, linkBytes: 1000, years: 3, maxInterval: 4 } as const;

export type EntryInput = {
  entryType: EntryType; title: string; description: string | null; entryDate: string;
  startTime: string | null; endTime: string | null; durationMinutes: number | null; link: EntryLink | null; recurrence: Recurrence | null;
};
export type Clean<T> = { ok: true; value: T } | { ok: false; message: string; identifier?: boolean };

const squash = (x: unknown) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : "");
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const whole = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) ? x : typeof x === "string" && /^\d{1,5}$/.test(x.trim()) ? Number(x.trim()) : null);

/** The furthest dates a calendar entry may be on: three years before and after today. */
export function dateRange(today: string): { min: string; max: string } {
  const lo = new Date(`${today}T00:00:00Z`); lo.setUTCFullYear(lo.getUTCFullYear() - ENTRY_LIMITS.years);
  const hi = new Date(`${today}T00:00:00Z`); hi.setUTCFullYear(hi.getUTCFullYear() + ENTRY_LIMITS.years);
  return { min: lo.toISOString().slice(0, 10), max: hi.toISOString().slice(0, 10) };
}

const timeOrNull = (x: unknown): { ok: true; value: string | null } | { ok: false } => {
  if (x === null || x === undefined || x === "") return { ok: true, value: null };
  const t = typeof x === "string" ? x.trim() : "";
  return /^\d\d:\d\d(:\d\d)?$/.test(t) && TIME.test(t.slice(0, 5)) ? { ok: true, value: t.slice(0, 5) } : { ok: false };
};

function cleanLink(x: unknown): Clean<EntryLink | null> {
  if (x === null || x === undefined) return { ok: true, value: null };
  const b = x as Record<string, unknown>;
  if (typeof x !== "object" || Array.isArray(x)) return { ok: false, message: "Choose what the entry is about from the list, or leave it empty." };
  const kind = b.kind, id = squash(b.id), label = squash(b.label);
  if (typeof kind !== "string" || !(LINK_KINDS as readonly string[]).includes(kind) || !id || id.length > 120 || !label || label.length > 200)
    return { ok: false, message: "Choose what the entry is about from the list, or leave it empty." };
  if (findPatientIdentifiers(label).length) return { ok: false, message: "That looks like it identifies a patient. Remove it and save again.", identifier: true };
  const link = { kind: kind as EntryLink["kind"], id, label };
  return JSON.stringify(link).length > ENTRY_LIMITS.linkBytes ? { ok: false, message: "That link is too long." } : { ok: true, value: link };
}

function cleanRecurrence(x: unknown, entryDate: string, today: string): Clean<Recurrence | null> {
  if (x === null || x === undefined) return { ok: true, value: null };
  if (typeof x !== "object" || Array.isArray(x)) return { ok: false, message: "Choose how the entry repeats, or that it does not." };
  const b = x as Record<string, unknown>;
  if (b.freq !== "daily" && b.freq !== "weekly") return { ok: false, message: "An entry can repeat daily or weekly." };
  const interval = b.interval === undefined || b.interval === null ? 1 : whole(b.interval);
  if (interval === null || interval < 1 || interval > ENTRY_LIMITS.maxInterval) return { ok: false, message: `Repeat every 1 to ${ENTRY_LIMITS.maxInterval} ${b.freq === "daily" ? "days" : "weeks"}.` };
  const r: Recurrence = { freq: b.freq, interval };
  if (b.freq === "weekly" && b.byweekday !== undefined && b.byweekday !== null) {
    if (!Array.isArray(b.byweekday) || b.byweekday.length > 7 || b.byweekday.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return { ok: false, message: "Choose the weekdays from Monday to Sunday." };
    r.byweekday = [...new Set(b.byweekday as number[])].sort((a, c) => a - c);
  }
  const { max } = dateRange(today);
  if (b.until !== undefined && b.until !== null && b.until !== "") {
    if (!isCalendarDate(b.until)) return { ok: false, message: "Enter the date the repeat ends as a real date." };
    if (b.until < entryDate) return { ok: false, message: "The repeat cannot end before it starts." };
    if (b.until > max) return { ok: false, message: `Choose an end date within the next ${ENTRY_LIMITS.years} years.` };
    r.until = b.until;
  }
  if (b.count !== undefined && b.count !== null && b.count !== "") {
    const c = whole(b.count);
    if (c === null || c < 1 || c > MAX_OCCURRENCES) return { ok: false, message: `Repeat between 1 and ${MAX_OCCURRENCES} times.` };
    r.count = c;
  }
  if (!r.until && !r.count) return { ok: false, message: "Say when the repeat ends: an end date or a number of times." };
  if (!seriesWithinLimit({ entryDate, recurrence: r })) return { ok: false, message: `A repeat can have at most ${MAX_OCCURRENCES} occurrences. Choose an earlier end date or a count.` };
  return { ok: true, value: r };
}

/** Pure. Checks a whole entry. For an edit, `base` is the stored entry: a field the body leaves out keeps it. */
export function cleanEntryInput(body: unknown, today: string, base: EntryInput | null = null): Clean<EntryInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const has = (k: string) => b[k] !== undefined;
  const entryType = has("entryType") ? b.entryType : base?.entryType;
  if (typeof entryType !== "string" || !(ENTRY_TYPES as readonly string[]).includes(entryType)) return { ok: false, message: "Choose what kind of entry this is." };

  const title = has("title") ? squash(b.title) : base?.title ?? "";
  if (!title) return { ok: false, message: "Give the entry a title." };
  if (title.length > ENTRY_LIMITS.titleMax) return { ok: false, message: `Keep the title to ${ENTRY_LIMITS.titleMax} characters.` };
  const description = has("description") ? squash(b.description) : base?.description ?? "";
  if (description.length > ENTRY_LIMITS.descriptionMax) return { ok: false, message: `Keep the description to ${ENTRY_LIMITS.descriptionMax} characters.` };
  for (const text of [title, description]) if (text && findPatientIdentifiers(text).length) return { ok: false, message: "That looks like it identifies a patient. Remove it and save again.", identifier: true };

  const entryDate = has("entryDate") ? b.entryDate : base?.entryDate;
  const { min, max } = dateRange(today);
  if (!isCalendarDate(entryDate)) return { ok: false, message: "Enter the date as a real date." };
  if (entryDate < min || entryDate > max) return { ok: false, message: `Choose a date within ${ENTRY_LIMITS.years} years of today.` };

  const st = timeOrNull(has("startTime") ? b.startTime : base?.startTime), en = timeOrNull(has("endTime") ? b.endTime : base?.endTime);
  if (!st.ok || !en.ok) return { ok: false, message: "Enter times as hours and minutes, for example 14:00." };
  if (en.value && !st.value) return { ok: false, message: "Give a start time as well as an end time, or neither for an all-day entry." };
  if (st.value && en.value && en.value <= st.value) return { ok: false, message: "The end time must be after the start time." };

  let durationMinutes: number | null = null;
  const rawDur = has("durationMinutes") ? b.durationMinutes : base?.durationMinutes;
  if (rawDur !== null && rawDur !== undefined && rawDur !== "") {
    const d = whole(rawDur);
    if (d === null || d < ENTRY_LIMITS.minMinutes || d > ENTRY_LIMITS.maxMinutes) return { ok: false, message: `Enter a length between ${ENTRY_LIMITS.minMinutes} and ${ENTRY_LIMITS.maxMinutes} minutes.` };
    durationMinutes = d;
  }
  const link = cleanLink(has("link") ? b.link : base?.link);
  if (!link.ok) return link;
  const recurrence = cleanRecurrence(has("recurrence") ? b.recurrence : base?.recurrence, entryDate, today);
  if (!recurrence.ok) return recurrence;
  return { ok: true, value: { entryType: entryType as EntryType, title, description: description || null, entryDate, startTime: st.value, endTime: en.value, durationMinutes, link: link.value, recurrence: recurrence.value } };
}

/** "restore" puts the occurrence back as its series gives it (removes the change to it). */
export type OccurrenceAction = ExceptionAction | "restore";
export type OccurrenceInput = { date: string; action: OccurrenceAction; newDate: string | null; newStart: string | null; newEnd: string | null; title: string | null };

/** Pure. Checks a change to ONE occurrence. `date` is the date the series gave it. */
export function cleanOccurrenceInput(body: unknown, today: string): Clean<OccurrenceInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const { min, max } = dateRange(today);
  if (!isCalendarDate(b.date) || b.date < min || b.date > max) return { ok: false, message: "That occurrence could not be found." };
  const action = b.action;
  if (action !== "cancelled" && action !== "moved" && action !== "edited" && action !== "completed" && action !== "restore") return { ok: false, message: "Choose cancel, move, edit, complete or restore." };
  let newDate: string | null = null;
  if (action === "moved") {
    if (!isCalendarDate(b.newDate) || b.newDate < min || b.newDate > max) return { ok: false, message: "Choose a real date within 3 years of today to move it to." };
    newDate = b.newDate;
  }
  const st = timeOrNull(b.newStart), en = timeOrNull(b.newEnd);
  if (!st.ok || !en.ok) return { ok: false, message: "Enter times as hours and minutes, for example 14:00." };
  if (st.value && en.value && en.value <= st.value) return { ok: false, message: "The end time must be after the start time." };
  let title: string | null = null;
  if (b.title !== undefined && b.title !== null && b.title !== "") {
    title = squash(b.title);
    if (!title || title.length > ENTRY_LIMITS.titleMax) return { ok: false, message: `Keep the title to 1 to ${ENTRY_LIMITS.titleMax} characters.` };
    if (findPatientIdentifiers(title).length) return { ok: false, message: "That looks like it identifies a patient. Remove it and save again.", identifier: true };
  }
  if (action === "edited" && !title && !st.value && !en.value) return { ok: false, message: "Change the title or the times." };
  return { ok: true, value: { date: b.date, action, newDate, newStart: st.value, newEnd: en.value, title } };
}

/** Pure. The date range of a list request: from and to, at most 400 days wide, inside the 3-year limit. */
export function cleanRange(from: unknown, to: unknown, today: string): Clean<{ from: string; to: string }> {
  const { min, max } = dateRange(today);
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return { ok: false, message: "Choose a start date and an end date." };
  if (from < min || to > max) return { ok: false, message: `Choose dates within ${ENTRY_LIMITS.years} years of today.` };
  if (to > plusDays(from, 400)) return { ok: false, message: "Choose a range of at most 400 days." };
  return { ok: true, value: { from, to } };
}

/**
 * Pure. The shared PlanItem for an occurrence, for the Professional experience (and any view that lists a learner's own
 * entries beside plan items). The reasons are the learner's own words: it is their entry.
 */
export function occurrenceToPlanItem(o: Occurrence, hrefFor: (o: Occurrence) => string | null = () => null): PlanItem {
  return {
    experience: o.experience, source: "calendar_entry", ref: o.key, title: o.title, minutes: o.durationMinutes, due: o.date,
    why: "You put this in your calendar.", whyNow: o.allDay ? `It is on ${o.date}.` : `It is on ${o.date} at ${o.startTime}.`,
    ifPostponed: "It stays where you put it until you move it.", href: hrefFor(o),
  };
}
