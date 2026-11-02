/* eslint-disable @typescript-eslint/no-explicit-any */
import { cache } from "react";
import { isNotProvisioned } from "../access";
import type { EntryInput, OccurrenceInput } from "./calendar-entries";
import type { PlanRead } from "./event-store";
import type { CalendarEntry, EntryException, EntryStatus, ExceptionAction, PlanExperience } from "./types";

// ── THE LEARNER'S OWN CALENDAR: THE STORE ── My Plan calendar enhancement, migration 840 ───────────────────────────
//
// The ONE writer of individual_learning_calendar_entry and individual_learning_calendar_exception (named by the foundation
// harness, 2a). EVERY STATEMENT IS KEYED ON THE CALLER'S OWN user_id AND on the experience asked for, so a Scholar route can
// neither read nor change a Professional entry and learner B can neither read nor change learner A's. An exception is only
// written for an entry the caller owns (the composite foreign key says the same).
//
// ⚠ NOTHING IN THE PLAN WRITES HERE. Entries are created and changed only by the learner's own requests (the entries routes).
// FAIL CLOSED: without the tables every function answers not provisioned.

let schemaCal: boolean | null = null;
/** Whether the calendar tables are present (migration 840). A transient read error is "no" for now, and asked again. */
async function learnerCalendarSchemaRead(admin: any, userId?: string): Promise<boolean> {
  if (schemaCal !== null) return schemaCal;
  try {
    let e = admin.from("individual_learning_calendar_entry").select("id");
    let x = admin.from("individual_learning_calendar_exception").select("id");
    if (userId) { e = e.eq("user_id", userId); x = x.eq("user_id", userId); }
    const [a, b] = [await e.limit(1), await x.limit(1)];
    if (!a.error && !b.error) return (schemaCal = true);
    if (isNotProvisioned(a.error) || isNotProvisioned(b.error)) schemaCal = false;
    return false;
  } catch { return false; }
}
/** Tests only: forget what was detected. */
/** Once per request (React cache(); a call-through outside a render). */
export const learnerCalendarSchema = cache(learnerCalendarSchemaRead);
export const resetLearnerCalendarSchema = (value: boolean | null = null) => { schemaCal = value; };

const ENTRY_COLS = "id, experience, entry_type, title, description, entry_date, start_time, end_time, duration_minutes, link, recurrence, status, completed_at, created_at, updated_at";
const EXC_COLS = "entry_id, occurrence_date, action, new_date, new_start_time, new_end_time, title, completed_at";
const hhmm = (t: unknown) => (typeof t === "string" ? t.slice(0, 5) : null);
const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as any) : null);
export const toEntry = (r: any): CalendarEntry => ({
  id: r.id, experience: r.experience, entryType: r.entry_type, title: r.title, description: r.description ?? null, entryDate: r.entry_date,
  startTime: hhmm(r.start_time), endTime: hhmm(r.end_time), durationMinutes: r.duration_minutes ?? null, link: obj(r.link), recurrence: obj(r.recurrence),
  status: r.status, completedAt: r.completed_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});
export const toException = (r: any): EntryException => ({
  entryId: r.entry_id, occurrenceDate: r.occurrence_date, action: r.action, newDate: r.new_date ?? null,
  newStartTime: hhmm(r.new_start_time), newEndTime: hhmm(r.new_end_time), title: r.title ?? null, completedAt: r.completed_at ?? null,
});
const failure = (error: unknown) => { if (isNotProvisioned(error)) schemaCal = false; return { ok: false as const, notProvisioned: isNotProvisioned(error) }; };

/** The caller's entries for one experience whose series could reach [from, to]: those starting on or before `to`, newest first. */
async function listEntriesRead(admin: any, userId: string, experience: PlanExperience, to: string): Promise<PlanRead<{ entries: CalendarEntry[]; exceptions: EntryException[] }>> {
  if (schemaCal === false) return { ok: false, notProvisioned: true };
  try {
    const e = await admin.from("individual_learning_calendar_entry").select(ENTRY_COLS).eq("user_id", userId).eq("experience", experience).lte("entry_date", to).order("entry_date", { ascending: false }).limit(1000);
    if (e.error) return failure(e.error);
    const entries = ((e.data ?? []) as any[]).map(toEntry);
    if (!entries.length) { schemaCal = true; return { ok: true, data: { entries, exceptions: [] } }; }
    const ids = entries.map(x => x.id);
    const out: EntryException[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const x = await admin.from("individual_learning_calendar_exception").select(EXC_COLS).eq("user_id", userId).in("entry_id", ids.slice(i, i + 150)).limit(5000);
      if (x.error) return failure(x.error);
      out.push(...((x.data ?? []) as any[]).map(toException));
    }
    schemaCal = true;
    return { ok: true, data: { entries, exceptions: out } };
  } catch { return { ok: false, notProvisioned: false }; }
}

/** One of the caller's entries for this experience, with its exceptions. Null when it is not theirs (or not this experience). */
export async function getEntry(admin: any, userId: string, experience: PlanExperience, id: string): Promise<PlanRead<{ entry: CalendarEntry; exceptions: EntryException[] } | null>> {
  if (schemaCal === false) return { ok: false, notProvisioned: true };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: true, data: null };
  try {
    const e = await admin.from("individual_learning_calendar_entry").select(ENTRY_COLS).eq("user_id", userId).eq("experience", experience).eq("id", id).maybeSingle();
    if (e.error) return failure(e.error);
    if (!e.data) { schemaCal = true; return { ok: true, data: null }; }
    const x = await admin.from("individual_learning_calendar_exception").select(EXC_COLS).eq("user_id", userId).eq("entry_id", id).limit(1000);
    if (x.error) return failure(x.error);
    schemaCal = true;
    return { ok: true, data: { entry: toEntry(e.data), exceptions: ((x.data ?? []) as any[]).map(toException) } };
  } catch { return { ok: false, notProvisioned: false }; }
}

const entryRow = (v: EntryInput) => ({
  entry_type: v.entryType, title: v.title, description: v.description, entry_date: v.entryDate, start_time: v.startTime, end_time: v.endTime,
  duration_minutes: v.durationMinutes, link: v.link, recurrence: v.recurrence,
});

/** Create one entry (a series) for the caller. The input was validated by cleanEntryInput. */
export async function createEntry(admin: any, userId: string, experience: PlanExperience, v: EntryInput): Promise<{ ok: true; entry: CalendarEntry } | { ok: false; error: "not_provisioned" | "failed" }> {
  if (schemaCal === false) return { ok: false, error: "not_provisioned" };
  try {
    const { data, error } = await admin.from("individual_learning_calendar_entry").insert({ user_id: userId, experience, ...entryRow(v) }).select(ENTRY_COLS).single();
    if (error || !data) { if (isNotProvisioned(error)) { schemaCal = false; return { ok: false, error: "not_provisioned" }; } return { ok: false, error: "failed" }; }
    schemaCal = true;
    return { ok: true, entry: toEntry(data) };
  } catch { return { ok: false, error: "failed" }; }
}

/** Change a whole series: its fields, or its status (completed or cancelled for the series). Only the caller's own, only this experience. */
export async function updateEntry(
  admin: any, userId: string, experience: PlanExperience, id: string, patch: { fields?: EntryInput; status?: EntryStatus },
): Promise<"ok" | "not_found" | "not_provisioned" | "failed"> {
  if (schemaCal === false) return "not_provisioned";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "not_found";
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { updated_at: now };
  if (patch.fields) Object.assign(row, entryRow(patch.fields));
  if (patch.status) { row.status = patch.status; row.completed_at = patch.status === "completed" ? now : null; }
  try {
    const { data, error } = await admin.from("individual_learning_calendar_entry").update(row).eq("user_id", userId).eq("experience", experience).eq("id", id).select("id");
    if (error) { if (isNotProvisioned(error)) { schemaCal = false; return "not_provisioned"; } return "failed"; }
    schemaCal = true;
    return ((data ?? []) as any[]).length ? "ok" : "not_found";
  } catch { return "failed"; }
}

/** Delete a whole series (its exceptions go with it). Only the caller's own, only this experience. */
export async function deleteEntry(admin: any, userId: string, experience: PlanExperience, id: string): Promise<"ok" | "not_found" | "not_provisioned" | "failed"> {
  if (schemaCal === false) return "not_provisioned";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "not_found";
  try {
    const { data, error } = await admin.from("individual_learning_calendar_entry").delete().eq("user_id", userId).eq("experience", experience).eq("id", id).select("id");
    if (error) { if (isNotProvisioned(error)) { schemaCal = false; return "not_provisioned"; } return "failed"; }
    schemaCal = true;
    return ((data ?? []) as any[]).length ? "ok" : "not_found";
  } catch { return "failed"; }
}

/**
 * Record a change to ONE occurrence (replacing any earlier change to that same occurrence). The entry must be the caller's own
 * and of this experience: that is checked first, so no exception is ever written for someone else's entry. A completion keeps
 * the move or edit already recorded for that occurrence.
 */
export async function putException(
  admin: any, userId: string, experience: PlanExperience, entryId: string, v: OccurrenceInput & { action: ExceptionAction }, prior: EntryException | null,
): Promise<"ok" | "not_found" | "not_provisioned" | "failed"> {
  if (schemaCal === false) return "not_provisioned";
  const own = await getEntry(admin, userId, experience, entryId);
  if (!own.ok) return own.notProvisioned ? "not_provisioned" : "failed";
  if (!own.data) return "not_found";
  const keep = v.action === "completed" && prior && prior.action !== "cancelled" ? prior : null;
  const row = {
    entry_id: entryId, user_id: userId, occurrence_date: v.date, action: v.action,
    new_date: v.action === "moved" ? v.newDate : keep?.newDate ?? null,
    new_start_time: v.newStart ?? keep?.newStartTime ?? null, new_end_time: v.newEnd ?? keep?.newEndTime ?? null,
    title: v.title ?? keep?.title ?? null, completed_at: v.action === "completed" ? new Date().toISOString() : null,
  };
  try {
    const { error } = await admin.from("individual_learning_calendar_exception").upsert(row, { onConflict: "entry_id,occurrence_date" });
    if (error) { if (isNotProvisioned(error)) { schemaCal = false; return "not_provisioned"; } return "failed"; }
    schemaCal = true;
    return "ok";
  } catch { return "failed"; }
}

/** Undo the change to one occurrence (put it back as the series gives it). */
export async function removeException(admin: any, userId: string, experience: PlanExperience, entryId: string, occurrenceDate: string): Promise<"ok" | "not_found" | "not_provisioned" | "failed"> {
  if (schemaCal === false) return "not_provisioned";
  const own = await getEntry(admin, userId, experience, entryId);
  if (!own.ok) return own.notProvisioned ? "not_provisioned" : "failed";
  if (!own.data) return "not_found";
  try {
    const { error } = await admin.from("individual_learning_calendar_exception").delete().eq("user_id", userId).eq("entry_id", entryId).eq("occurrence_date", occurrenceDate);
    if (error) { if (isNotProvisioned(error)) { schemaCal = false; return "not_provisioned"; } return "failed"; }
    return "ok";
  } catch { return "failed"; }
}

/** MY PLAN PERF: the entries up to a date, once per request (React cache(); a call-through outside a render, so a write is always followed by a fresh read). */
export const listEntries = cache(listEntriesRead);
