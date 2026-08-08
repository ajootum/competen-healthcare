import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import {
  REMOVES_TIME, RESHAPES_TIME, ADDS_TIME,
} from "@/lib/practice/schedule-exception-constants";
import { commitScheduleChange } from "@/lib/practice/schedule-exceptions";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SET-002 v4 LOCATIONS, CLINICS & AVAILABILITY CONFIGURATION. Migration 230.
//
// The specification's five tabs: My Locations · Regular Week · Dates & Exceptions · Booking Rules ·
// Booking Preview. Its acceptance criteria are the three things this file has to get right:
//
//   "Recurring schedules generate slots automatically"     -> generateSlots()
//   "Booking engine updates immediately after changes"     -> every write regenerates its own window
//   "Weekly and monthly changes are easy to manage"        -> a weekday + minutes, not 52 copies
//
// ---- THE RULE THE GENERATOR EXISTS TO OBEY -----------------------------------------------------------
//
// A TEMPLATE MAY NEVER CANCEL A PATIENT'S APPOINTMENT.
//
// Generation writes slots and regeneration removes them, so a careless regenerate could delete the
// Thursday somebody is booked into and nobody would have decided that. Two guards, both enforced here
// and both proven in the harness:
//
//   1. Regeneration only ever removes slots IT generated (generated_from_template_id is not null).
//      A slot made by hand in the calendar is not the template's to delete.
//   2. It never removes a slot with a live appointment in it -- matched BOTH by slot_id and by time
//      overlap, because bookings made before slots existed carry no slot_id.
//
// ---- AND THE RULE THE BOOKING RULES EXIST TO OBEY ----------------------------------------------------
//
// EVERY COLUMN ON practice_booking_rule IS READ BY checkPlacement(), or it is not stored as an input.
// This project has twice shipped a table nobody read -- practice_configuration sat inert from migration
// 191 until CPR-360, and effective_from was ignored until CPR-310 -- and a booking rule that does not
// refuse a booking is worse than an absent one, because the practice believes the rule is holding.
//
// The two that are advisory say so in their name and in the payload: `emergency_reserve_minutes` and
// `cancellation_notice_minutes` are REPORTED, never used to refuse. A practice that cannot cancel a
// booking because of a policy setting is a practice with a wrong diary.
//
// `visibility` (public / link-only / internal) is stored because the specification asks for it and READ
// BY NOTHING, because there is no patient-facing booking page. It is surfaced as unread rather than
// offered as an input -- CPR-360's rule for inert columns, which is that they are listed, not rendered
// as switches.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export const WEEKDAYS = [
  [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"],
  [5, "Friday"], [6, "Saturday"], [7, "Sunday"],
] as const;

/**
 * ⚠ THE FOUR KINDS BECAME SEVEN IN MIGRATION 242, AND THE LIST MOVED.
 *
 * CPR-V5-007 s5.2 names six categories of change and this file had four of them. The vocabulary now
 * lives in schedule-exception-constants.ts -- a file that touches no database -- because Layer 2's
 * screen needs it, and a constant a screen needs does not belong in a module that imports the workspace
 * context. Re-exported so no existing caller has to learn where it went.
 */
export { EXCEPTION_KINDS } from "@/lib/practice/schedule-exception-constants";

/**
 * Kinds that TAKE time away. The generator must be able to tell these from the ones that add it, and
 * from the two that do NEITHER: a location change and an activity substitution both leave the session
 * running, and are applied below as a change of shape rather than a removal.
 */
const REMOVES = REMOVES_TIME;

export const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m) % 60).padStart(2, "0")}`;

const nowIso = () => new Date().toISOString();

/**
 * How a slot with no template behind it is recognised on a later run.
 *
 * ONE FUNCTION, USED ON BOTH SIDES, so the stored row and the freshly computed row can never be keyed
 * differently -- which is precisely the bug this replaced: one side formatted the instant as
 * "+00:00" and the other as ".000Z", so the sets never intersected and nothing de-duplicated.
 */
const windowKey = (date: string, startMs: number, endMs: number, locationId: string | null) =>
  `window|${date}|${startMs}|${endMs}|${locationId ?? ""}`;
const isoWeekday = (dateIso: string) => (((new Date(`${dateIso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);

function datesBetween(fromDate: string, toDate: string, cap = 400): string[] {
  const out: string[] = [];
  const end = Date.parse(`${toDate}T12:00:00Z`);
  for (let t = Date.parse(`${fromDate}T12:00:00Z`); t <= end && out.length < cap; t += 86400000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ── READ THE WHOLE WORKSPACE ─────────────────────────────────────────────────────────────────────────

export async function availabilityConfig(admin: any, ctx: WorkspaceContext) {
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";
  const today = practiceToday(timezone);

  const [
    { data: locations }, { data: clinics }, { data: templates },
    { data: exceptions }, { data: rules }, { count: generatedSlots },
  ] = await Promise.all([
    admin.from("practice_location")
      .select("id, name, type, active, facility_id, travel_buffer_minutes")
      .eq("workspace_id", ctx.workspaceId).order("name"),
    admin.from("practice_clinic")
      .select("id, location_id, name, consultation_mode, active")
      .eq("workspace_id", ctx.workspaceId).order("name"),
    // ACTIVE AND SUSPENDED, NOT JUST ACTIVE. A suspended session must stay on the screen or there is no
    // way to resume it -- which would make "suspend" a slower spelling of "delete". Closed ones are
    // gone. The GENERATOR filters to active on its own; this read is what a person looks at.
    admin.from("practice_availability_template")
      .select("id, location_id, clinic_id, weekday, starts_minute, ends_minute, slot_kind, appointment_minutes, capacity, note, active, status")
      .eq("workspace_id", ctx.workspaceId).in("status", ["active", "suspended"])
      .order("weekday").order("starts_minute"),
    admin.from("practice_availability_exception")
      .select("id, location_id, clinic_id, kind, from_date, to_date, starts_minute, ends_minute, slot_kind, appointment_minutes, reason")
      .eq("workspace_id", ctx.workspaceId).gte("to_date", today).order("from_date"),
    admin.from("practice_booking_rule")
      .select("id, location_id, appointment_type, lead_time_minutes, booking_horizon_days, cancellation_notice_minutes, walk_in_daily_limit, emergency_reserve_minutes, visibility, active")
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_availability_slot").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).not("generated_from_template_id", "is", null),
  ]);

  return {
    timezone, today,
    locations: (locations ?? []) as any[],
    clinics: (clinics ?? []) as any[],
    templates: (templates ?? []) as any[],
    exceptions: (exceptions ?? []) as any[],
    rules: (rules ?? []) as any[],
    generatedSlotCount: generatedSlots ?? 0,
    /**
     * Stored, asked for by the specification, and read by nothing. Listed rather than offered as a
     * switch: there is no patient-facing booking page for it to govern.
     */
    inert: [
      {
        field: "visibility",
        label: "Who can see this availability (public, link-only, internal)",
        reason: "Self-booking is not built, so nothing outside the practice reads this yet.",
      },
      {
        // FOUND BY LINT, NOT BY DESIGN -- a dead defaultAppointmentMinutes call in the generator was
        // what exposed it. A generated slot is a whole SESSION; how long one appointment inside it runs
        // is still the practice default or whatever the person booking types. Listed rather than left
        // looking like a field that does something, which is the failure this file's own header warns
        // about and which I had already committed once.
        field: "appointment_minutes",
        label: "Appointment length per session",
        reason: "A generated slot is a whole session. Booking still takes its length from the practice default or from what the person booking types.",
      },
    ],
  };
}

// ── CLINICS ──────────────────────────────────────────────────────────────────────────────────────────

export async function addClinic(admin: any, ctx: WorkspaceContext, args: {
  locationId: string; name: string; consultationMode?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("practice.locations.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.locations.manage is required" };
  const name = args.name.trim();
  if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a clinic needs a name" };

  const { data: loc } = await admin.from("practice_location")
    .select("id, active").eq("id", args.locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!loc.active) return { ok: false, status: 422, code: "LOCATION_CLOSED", message: "that location is closed" };

  const { data, error } = await admin.from("practice_clinic").insert({
    workspace_id: ctx.workspaceId, location_id: args.locationId, name,
    consultation_mode: args.consultationMode ?? "in_person", active: true,
  }).select("id").maybeSingle();
  // The unique index is on (location, lower(trim(name))) WHERE active -- a partial index, which is
  // exactly the shape PostgREST upsert cannot target. Check-then-insert with the error read, per the
  // trap this project has hit twice.
  if (error) return { ok: false, status: 409, code: "DUPLICATE_CLINIC", message: `there is already a clinic called ${name} at that location` };
  if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the clinic was not created" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.clinic_created",
    payload: { clinicId: data.id, locationId: args.locationId, name }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

// ── THE REGULAR WEEK ─────────────────────────────────────────────────────────────────────────────────

/**
 * CAN A SESSION SIT ON THIS WEEKDAY, AT THIS TIME, AT THIS PLACE?
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS FIXES A BUG CPR-SET-002 SHIPPED. Its overlap check only refused sessions at the SAME location,
 * with the reasoning that "different locations may legitimately overlap, and the travel rule in 228
 * catches the bookings that follow". That reasoning was wrong, and a real practice found it: a Tuesday
 * with 09:00-13:00 at Aga Khan AND 09:00-13:00 at TMR International, both accepted.
 *
 * The travel rule catches BOOKINGS. It cannot catch AVAILABILITY, because nothing books availability --
 * so the generator dutifully produced both sets of slots, the preview offered eight hours on a
 * four-hour Tuesday, and the first two patients to take them would send the practitioner to two
 * hospitals at once. CPR-SETUP-003 states the rule plainly: "No overlapping sessions can be saved" and
 * "Validate travel time between different hospitals".
 *
 * So the same two tests bookings get, applied to sessions:
 *   OVERLAP  -- nobody is in two places at one time, whether or not they are the same place.
 *   TRAVEL   -- two sessions at different places need the destination's travel buffer between them.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `excludeId` keeps a session from conflicting with ITSELF while being edited or moved -- the same
 * problem, and the same fix, as `excludeAppointmentId` in checkPlacement().
 */
export async function sessionConflict(admin: any, ctx: WorkspaceContext, args: {
  weekday: number; startsMinute: number; endsMinute: number; locationId: string | null;
  excludeId?: string;
}): Promise<{ ok: false; status: number; code: string; message: string } | null> {
  const { data: existing, error } = await admin.from("practice_availability_template")
    .select("id, starts_minute, ends_minute, location_id")
    .eq("workspace_id", ctx.workspaceId).eq("weekday", args.weekday).eq("status", "active");
  if (error)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the week: ${error.message}` };

  const others = ((existing ?? []) as any[]).filter(t => t.id !== args.excludeId);
  if (others.length === 0) return null;

  const locationIds = [...new Set(
    [args.locationId, ...others.map(t => t.location_id)].filter(Boolean),
  )] as string[];
  const { data: locs } = locationIds.length
    ? await admin.from("practice_location").select("id, name, travel_buffer_minutes")
      .eq("workspace_id", ctx.workspaceId).in("id", locationIds)
    : { data: [] };
  const locById = new Map(((locs ?? []) as any[]).map(l => [l.id, l]));
  const nameOf = (id: string | null) => (id ? locById.get(id)?.name ?? "another place" : "no particular place");
  const here = args.locationId ? locById.get(args.locationId) : null;

  for (const t of others) {
    const overlaps = t.starts_minute < args.endsMinute && t.ends_minute > args.startsMinute;
    const samePlace = (t.location_id ?? null) === (args.locationId ?? null);

    if (overlaps)
      return {
        ok: false, status: 409, code: "SESSION_OVERLAP",
        message: samePlace
          ? `that overlaps ${hhmm(t.starts_minute)}–${hhmm(t.ends_minute)} already on this day at ${nameOf(t.location_id)}`
          : `you cannot be at ${nameOf(args.locationId)} and ${nameOf(t.location_id)} at the same time — ${hhmm(t.starts_minute)}–${hhmm(t.ends_minute)} is already on this day`,
      };

    // TRAVEL, for sessions at different places that do not overlap. Same rule migration 228 applies to
    // bookings, and the buffer belongs to whichever place is being travelled TO.
    if (samePlace) continue;
    const gapBefore = args.startsMinute - t.ends_minute;   // the other one first, then this
    const gapAfter = t.starts_minute - args.endsMinute;    // this one first, then the other
    const needBefore = here?.travel_buffer_minutes ?? 0;
    const needAfter = locById.get(t.location_id)?.travel_buffer_minutes ?? 0;

    if (gapBefore >= 0 && gapBefore < needBefore)
      return {
        ok: false, status: 409, code: "SESSION_TRAVEL_CONFLICT",
        message: `only ${gapBefore} minutes between ${nameOf(t.location_id)} and ${nameOf(args.locationId)}, which needs ${needBefore}`,
      };
    if (gapAfter >= 0 && gapAfter < needAfter)
      return {
        ok: false, status: 409, code: "SESSION_TRAVEL_CONFLICT",
        message: `that would leave only ${gapAfter} minutes to reach ${nameOf(t.location_id)}, which needs ${needAfter}`,
      };
  }
  return null;
}

export async function addSession(admin: any, ctx: WorkspaceContext, args: {
  locationId?: string | null; clinicId?: string | null;
  weekday: number; startsMinute: number; endsMinute: number;
  slotKind?: string; appointmentMinutes?: number | null; note?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  if (!Number.isInteger(args.weekday) || args.weekday < 1 || args.weekday > 7)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "weekday must be 1 (Monday) to 7 (Sunday)" };
  if (args.endsMinute <= args.startsMinute)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session must end after it starts" };

  if (args.locationId) {
    const { data: loc } = await admin.from("practice_location")
      .select("id").eq("id", args.locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }
  if (args.clinicId) {
    const { data: cl } = await admin.from("practice_clinic")
      .select("id").eq("id", args.clinicId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!cl) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const conflict = await sessionConflict(admin, ctx, {
    weekday: args.weekday, startsMinute: args.startsMinute, endsMinute: args.endsMinute,
    locationId: args.locationId ?? null,
  });
  if (conflict) return conflict;

  const { data, error } = await admin.from("practice_availability_template").insert({
    workspace_id: ctx.workspaceId,
    location_id: args.locationId ?? null, clinic_id: args.clinicId ?? null,
    weekday: args.weekday, starts_minute: args.startsMinute, ends_minute: args.endsMinute,
    slot_kind: args.slotKind ?? "clinic",
    appointment_minutes: args.appointmentMinutes ?? null,
    note: args.note ?? null, created_by: args.actorId,
  }).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the session was not created" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.availability_session_added",
    payload: { templateId: data.id, weekday: args.weekday, from: hhmm(args.startsMinute), to: hhmm(args.endsMinute) },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Take a session out of the regular week.
 *
 * DEACTIVATED, NOT DELETED, and the slots it generated are cleaned up by the same rule regeneration
 * uses: only its own output, only where nothing is booked. A session removed on Monday must not silently
 * cancel Thursday's patient.
 */
/**
 * CPR-SETUP-003: edit, duplicate, move and suspend.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ALL FOUR GO THROUGH ONE FUNCTION, because they are one operation with different arguments: a move is
 * an edit of the weekday, a duplicate is an edit applied to a copy, a suspend is an edit of the status.
 * Four separate implementations would be four places for the conflict check to be forgotten -- and the
 * conflict check is the entire reason this module needed a second pass.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * "Saving updates all future generated availability while preserving historical records" (s"Edit
 * Behaviour"): future slots this session generated are reaped under the usual two guards, so a slot
 * somebody is booked into survives the edit and is reported back rather than silently kept.
 */
export async function editSession(admin: any, ctx: WorkspaceContext, args: {
  templateId: string;
  weekday?: number; startsMinute?: number; endsMinute?: number;
  locationId?: string | null; clinicId?: string | null;
  slotKind?: string; appointmentType?: string | null; capacity?: number | null;
  status?: "active" | "suspended" | "closed";
  note?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; slotsRemoved: number; slotsKept: number; changed: string[] }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const { data: t, error: readError } = await admin.from("practice_availability_template")
    // appointment_type is NOT selected: migration 241 dropped it from this table and the join table
    // practice_session_appointment_type owns the offered set, because s4.3 needs zero, one AND several.
    .select("id, weekday, starts_minute, ends_minute, location_id, clinic_id, slot_kind, capacity, status, note")
    .eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (readError)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the session: ${readError.message}` };
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (t.status === "closed")
    return { ok: false, status: 422, code: "SESSION_CLOSED", message: "this session is closed; add a new one instead" };

  const next = {
    weekday: args.weekday ?? t.weekday,
    starts_minute: args.startsMinute ?? t.starts_minute,
    ends_minute: args.endsMinute ?? t.ends_minute,
    location_id: args.locationId !== undefined ? args.locationId : t.location_id,
    clinic_id: args.clinicId !== undefined ? args.clinicId : t.clinic_id,
    slot_kind: args.slotKind ?? t.slot_kind,
    capacity: args.capacity !== undefined ? args.capacity : t.capacity,
    status: args.status ?? t.status,
    note: args.note !== undefined ? args.note : t.note,
  };

  if (next.ends_minute <= next.starts_minute)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session must end after it starts" };
  if (!Number.isInteger(next.weekday) || next.weekday < 1 || next.weekday > 7)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "weekday must be 1 (Monday) to 7 (Sunday)" };

  if (next.location_id && next.location_id !== t.location_id) {
    const { data: loc } = await admin.from("practice_location")
      .select("id").eq("id", next.location_id).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  // THE CONFLICT CHECK RUNS ON EVERY PATH, excluding this session so it cannot clash with itself. A
  // suspend or a close is exempt: taking time OUT of the week can never create an overlap.
  if (next.status === "active") {
    const conflict = await sessionConflict(admin, ctx, {
      weekday: next.weekday, startsMinute: next.starts_minute, endsMinute: next.ends_minute,
      locationId: next.location_id ?? null, excludeId: t.id,
    });
    if (conflict) return conflict;
  }

  const changed = Object.entries(next)
    .filter(([k, v]) => (t as Record<string, unknown>)[k] !== v)
    .map(([k]) => k);
  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const { error } = await admin.from("practice_availability_template")
    .update({ ...next, active: next.status === "active", updated_at: nowIso() })
    .eq("id", t.id);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  // Future slots this session made no longer match what it says. Reaped under the usual two guards --
  // a booked one survives and is counted, never silently removed.
  const reaped = await reapGeneratedSlots(admin, ctx, { templateId: t.id, fromIso: nowIso() });

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.availability_session_edited",
    payload: {
      templateId: t.id, changed,
      from: { weekday: t.weekday, starts: hhmm(t.starts_minute), ends: hhmm(t.ends_minute), locationId: t.location_id, status: t.status },
      to: { weekday: next.weekday, starts: hhmm(next.starts_minute), ends: hhmm(next.ends_minute), locationId: next.location_id, status: next.status },
      ...reaped,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string, changed, ...reaped } };
}

/**
 * Copy a session onto one or more weekdays, optionally changing where and when.
 *
 * EACH DAY IS DECIDED SEPARATELY. "Duplicate to Monday, Wednesday and Friday" where Wednesday already
 * has a clashing session must copy to two days and say why the third did not -- refusing all three
 * because one clashed would make the practitioner work out which, and copying all three would create
 * the very double-booking this pass exists to remove.
 */
export async function duplicateSession(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; toWeekdays: number[];
  locationId?: string | null; startsMinute?: number; endsMinute?: number;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{
  created: { weekday: number; id: string }[];
  refused: { weekday: number; reason: string }[];
}>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  if (!Array.isArray(args.toWeekdays) || args.toWeekdays.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "choose at least one day to copy to" };

  const { data: t } = await admin.from("practice_availability_template")
    .select("id, weekday, starts_minute, ends_minute, location_id, clinic_id, slot_kind, appointment_minutes, capacity, note")
    .eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const startsMinute = args.startsMinute ?? t.starts_minute;
  const endsMinute = args.endsMinute ?? t.ends_minute;
  const locationId = args.locationId !== undefined ? args.locationId : t.location_id;
  if (endsMinute <= startsMinute)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session must end after it starts" };

  const created: { weekday: number; id: string }[] = [];
  const refused: { weekday: number; reason: string }[] = [];

  for (const weekday of [...new Set(args.toWeekdays)]) {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      refused.push({ weekday, reason: "not a day of the week" });
      continue;
    }
    const conflict = await sessionConflict(admin, ctx, { weekday, startsMinute, endsMinute, locationId });
    if (conflict) { refused.push({ weekday, reason: conflict.message }); continue; }

    const { data, error } = await admin.from("practice_availability_template").insert({
      workspace_id: ctx.workspaceId,
      location_id: locationId, clinic_id: t.clinic_id,
      weekday, starts_minute: startsMinute, ends_minute: endsMinute,
      slot_kind: t.slot_kind,
      appointment_minutes: t.appointment_minutes, capacity: t.capacity,
      note: t.note, duplicated_from_id: t.id, created_by: args.actorId,
    }).select("id").maybeSingle();
    if (error || !data) { refused.push({ weekday, reason: error?.message ?? "could not be created" }); continue; }
    created.push({ weekday, id: data.id as string });
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.availability_session_duplicated",
    payload: { templateId: t.id, created: created.map(c => c.weekday), refused },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { created, refused } };
}

export async function removeSession(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ slotsRemoved: number; slotsKept: number }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const { data: t } = await admin.from("practice_availability_template")
    .select("id, active, status").eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // CLOSED, not deleted -- and `active` is kept in step with `status` because CPR-SET-002's generator
  // and the setup hub's count both still read the boolean. Two columns for one fact is a migration's
  // debt; letting them disagree would be a bug.
  await admin.from("practice_availability_template")
    .update({ active: false, status: "closed", updated_at: nowIso() }).eq("id", t.id);

  const cleaned = await reapGeneratedSlots(admin, ctx, { templateId: t.id, fromIso: nowIso() });

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.availability_session_removed",
    payload: { templateId: t.id, ...cleaned }, correlationId: args.correlationId,
  });
  return { ok: true, data: cleaned };
}

// ── EXCEPTIONS ───────────────────────────────────────────────────────────────────────────────────────

/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS IS NOW A DELEGATE. schedule-exceptions.ts's commitScheduleChange() is the ONLY thing that
 * writes practice_availability_exception, and this function forwards to it.
 *
 * CPR-V5-007 AC-04: "Before committing a change, the system identifies affected bookings and REQUIRES a
 * resolution strategy." A preview that can be skipped fails it -- so a second writer that skipped it
 * would fail it too, and the second writer is always the one somebody's integration calls. The old body
 * of this function was that second writer, which is why it is gone rather than kept beside the new one.
 *
 * WHAT CHANGED FOR AN EXISTING CALLER: nothing, until a patient is actually booked into the time being
 * changed. With nobody affected the commit records itself as s5.3's "no patient impact" and succeeds
 * exactly as before. With somebody affected it now REFUSES until `resolution` says what happens to them.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function addException(admin: any, ctx: WorkspaceContext, args: {
  kind: string; fromDate: string; toDate: string;
  locationId?: string | null; clinicId?: string | null;
  startsMinute?: number | null; endsMinute?: number | null;
  slotKind?: string; appointmentMinutes?: number | null; reason?: string;
  replacementLocationId?: string | null; replacementActivityType?: string | null;
  /** s5.3's resolution strategy. Required whenever the calculated impact is above nought. */
  resolution?: string | null; note?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; days: number; affected: number; resolution: string }>> {
  const r = await commitScheduleChange(admin, ctx, {
    kind: args.kind, fromDate: args.fromDate, toDate: args.toDate,
    locationId: args.locationId ?? null, clinicId: args.clinicId ?? null,
    startsMinute: args.startsMinute ?? null, endsMinute: args.endsMinute ?? null,
    slotKind: args.slotKind, appointmentMinutes: args.appointmentMinutes ?? null,
    reason: args.reason ?? null,
    replacementLocationId: args.replacementLocationId ?? null,
    replacementActivityType: args.replacementActivityType ?? null,
    resolution: args.resolution ?? null, note: args.note ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    data: { id: r.data.exceptionId, days: r.data.days, affected: r.data.affected, resolution: r.data.resolution },
  };
}

// ── BOOKING RULES ────────────────────────────────────────────────────────────────────────────────────

export async function setBookingRule(admin: any, ctx: WorkspaceContext, args: {
  locationId?: string | null; appointmentType?: string | null;
  leadTimeMinutes?: number; bookingHorizonDays?: number | null;
  cancellationNoticeMinutes?: number; walkInDailyLimit?: number | null;
  emergencyReserveMinutes?: number;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  if (args.locationId) {
    const { data: loc } = await admin.from("practice_location")
      .select("id").eq("id", args.locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const patch = {
    lead_time_minutes: args.leadTimeMinutes ?? 0,
    booking_horizon_days: args.bookingHorizonDays ?? null,
    cancellation_notice_minutes: args.cancellationNoticeMinutes ?? 0,
    walk_in_daily_limit: args.walkInDailyLimit ?? null,
    emergency_reserve_minutes: args.emergencyReserveMinutes ?? 0,
    updated_at: nowIso(),
  };

  // CHECK-THEN-WRITE, NEVER UPSERT. The scope index is PARTIAL (`where active`) and PostgREST's
  // onConflict cannot target a partial index -- the trap this project has hit twice, both times as a
  // silent write failure. The match is made in TypeScript rather than as a PostgREST filter because
  // "location_id is null" and "location_id = x" need different operators, and an `.or()` across a null
  // test is the shape this codebase has twice written to accidentally match every row.
  const { data: found, error: readError } = await admin.from("practice_booking_rule")
    .select("id, location_id, appointment_type").eq("workspace_id", ctx.workspaceId).eq("active", true);
  if (readError)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the existing rules: ${readError.message}` };
  const match = ((found ?? []) as any[]).find(r =>
    (r.location_id ?? null) === (args.locationId ?? null)
    && (r.appointment_type ?? null) === (args.appointmentType ?? null));

  if (match) {
    const { error } = await admin.from("practice_booking_rule").update(patch).eq("id", match.id);
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    await audit(admin, {
      workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_rule_updated",
      payload: { ruleId: match.id, ...patch }, correlationId: args.correlationId,
    });
    return { ok: true, data: { id: match.id as string } };
  }

  const { data, error } = await admin.from("practice_booking_rule").insert({
    workspace_id: ctx.workspaceId,
    location_id: args.locationId ?? null, appointment_type: args.appointmentType ?? null,
    ...patch, created_by: args.actorId,
  }).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the rule was not created" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_rule_created",
    payload: { ruleId: data.id, locationId: args.locationId ?? null, appointmentType: args.appointmentType ?? null, ...patch },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export type ResolvedRule = {
  leadTimeMinutes: number;
  bookingHorizonDays: number | null;
  cancellationNoticeMinutes: number;
  walkInDailyLimit: number | null;
  /** s7.7's cutoff (migration 268). Null means no cutoff, or the migration is not applied. */
  walkInCutoffMinutes: number | null;
  /** s7.2's separate notice for a MOVE (migration 268). Null means the cancellation notice governs one. */
  rescheduleNoticeMinutes: number | null;
  /** s7.2 (migration 268). A practice may switch patient self-service off per rule. */
  selfCancelAllowed: boolean;
  selfRescheduleAllowed: boolean;
  emergencyReserveMinutes: number;
  /** Which row won, so a refusal can say where the rule came from. */
  source: "location+type" | "location" | "type" | "practice" | "default";
  /**
   * ⚠ THIS FUNCTION USED TO DISCARD ITS ERROR, AND THE CONSEQUENCE WAS FAIL-OPEN ON FOUR CONTROLS.
   *
   * `const { data } = await ...` with no error read meant an unreadable rule table produced DEFAULT_RULE
   * -- no notice period, no horizon, no walk-in limit, no cutoff -- and every caller treated that as a
   * practice that had configured nothing. A database wobble therefore opened the diary, which is exactly
   * the class this codebase has a scar from and exactly what "a failed read is never a zero" forbids.
   *
   * The signature is unchanged so that no caller has to be rewritten to be safe from it, and the two
   * fields below are what a caller reads to REFUSE rather than to guess. checkPlacement does.
   */
  readFailed: boolean;
  readError: string | null;
};

const DEFAULT_RULE: ResolvedRule = {
  leadTimeMinutes: 0, bookingHorizonDays: null, cancellationNoticeMinutes: 0,
  walkInDailyLimit: null, walkInCutoffMinutes: null, rescheduleNoticeMinutes: null,
  selfCancelAllowed: true, selfRescheduleAllowed: true,
  emergencyReserveMinutes: 0, source: "default",
  readFailed: false, readError: null,
};

/** Migration 268's half of the resolved rule. Read only when the columns exist. */
const RESOLVE_COLUMNS_BASE =
  "location_id, appointment_type, lead_time_minutes, booking_horizon_days, "
  + "cancellation_notice_minutes, walk_in_daily_limit, emergency_reserve_minutes";
const RESOLVE_COLUMNS_268 =
  "walk_in_cutoff_minutes, reschedule_notice_minutes, self_cancel_allowed, self_reschedule_allowed";

/**
 * MOST SPECIFIC WINS, and the winner is named.
 *
 * A practitioner refused a booking needs to know WHICH rule refused it -- "the rule at Mulago" and "your
 * practice-wide rule" send them to different screens. A refusal that only says "lead time" leaves them
 * hunting.
 */
export async function resolveBookingRule(
  admin: any, workspaceId: string, locationId: string | null, appointmentType: string,
): Promise<ResolvedRule> {
  // ⚠ THE EXTENDED READ IS TRIED FIRST AND FALLS BACK ONCE. Adding migration 268's columns to the select
  // unconditionally would make PostgREST refuse the WHOLE query at any practice whose database has not
  // had the file applied -- which would turn a missing feature into a broken diary. The fallback is
  // distinguished from a real failure by the error code, never by "no rows came back".
  let rows: any[] | null = null;
  let extended = false;
  let readError: string | null = null;

  const first = await admin.from("practice_booking_rule")
    .select(`${RESOLVE_COLUMNS_BASE}, ${RESOLVE_COLUMNS_268}`)
    .eq("workspace_id", workspaceId).eq("active", true);
  if (!first.error && first.data != null) { rows = first.data as any[]; extended = true; }
  else if (first.error && MISSING_COLUMN_CODES.has(String(first.error.code))) {
    const second = await admin.from("practice_booking_rule")
      .select(RESOLVE_COLUMNS_BASE).eq("workspace_id", workspaceId).eq("active", true);
    if (!second.error && second.data != null) rows = second.data as any[];
    else readError = second.error?.message ?? "neither rows nor an error";
  } else {
    readError = first.error?.message ?? "neither rows nor an error";
  }

  // ⚠ AN UNREADABLE RULE TABLE IS NOT A PRACTICE WITH NO RULES. The caller is told, and checkPlacement
  // refuses on it. Returning the default silently is what this function used to do.
  if (rows === null) return { ...DEFAULT_RULE, readFailed: true, readError };
  if (rows.length === 0) return DEFAULT_RULE;

  const pick = (fn: (r: any) => boolean) => rows.find(fn);
  const candidates: [ResolvedRule["source"], any][] = [
    ["location+type", pick(r => r.location_id === locationId && r.appointment_type === appointmentType)],
    ["location", pick(r => r.location_id === locationId && r.appointment_type === null)],
    ["type", pick(r => r.location_id === null && r.appointment_type === appointmentType)],
    ["practice", pick(r => r.location_id === null && r.appointment_type === null)],
  ];
  const hit = candidates.find(([, r]) => !!r);
  if (!hit) return DEFAULT_RULE;
  const [source, r] = hit;
  return {
    leadTimeMinutes: r.lead_time_minutes ?? 0,
    bookingHorizonDays: r.booking_horizon_days ?? null,
    cancellationNoticeMinutes: r.cancellation_notice_minutes ?? 0,
    walkInDailyLimit: r.walk_in_daily_limit ?? null,
    walkInCutoffMinutes: extended ? (r.walk_in_cutoff_minutes ?? null) : null,
    rescheduleNoticeMinutes: extended ? (r.reschedule_notice_minutes ?? null) : null,
    selfCancelAllowed: extended ? r.self_cancel_allowed !== false : true,
    selfRescheduleAllowed: extended ? r.self_reschedule_allowed !== false : true,
    emergencyReserveMinutes: r.emergency_reserve_minutes ?? 0,
    source,
    readFailed: false, readError: null,
  };
}

/** PostgREST's column miss and Postgres's own, which mean "migration 268 has not been applied". */
const MISSING_COLUMN_CODES = new Set(["PGRST204", "PGRST205", "PGRST202", "42703", "42P01"]);

// ── SLOT GENERATION ──────────────────────────────────────────────────────────────────────────────────

/**
 * Remove generated slots, obeying the two guards this module exists for.
 *
 * Returns what it removed AND what it deliberately kept, because "3 removed" alone cannot tell a
 * practitioner that two sessions survived because somebody is booked into them.
 */
async function reapGeneratedSlots(admin: any, ctx: WorkspaceContext, args: {
  templateId?: string; fromIso?: string;
  /** Exact slots to consider. When given, nothing else is even looked at. */
  slotIds?: string[];
}): Promise<{ slotsRemoved: number; slotsKept: number }> {
  if (args.slotIds && args.slotIds.length === 0) return { slotsRemoved: 0, slotsKept: 0 };

  let q = admin.from("practice_availability_slot")
    .select("id, starts_at, ends_at")
    .eq("workspace_id", ctx.workspaceId)
    // GUARD 1: only slots a template generated. A hand-made slot is not the template's to delete.
    .not("generated_from_template_id", "is", null);
  if (args.slotIds) q = q.in("id", args.slotIds);
  if (args.templateId) q = q.eq("generated_from_template_id", args.templateId);
  if (args.fromIso) q = q.gte("starts_at", args.fromIso);

  const { data: slots } = await q;
  const rows = (slots ?? []) as any[];
  if (rows.length === 0) return { slotsRemoved: 0, slotsKept: 0 };

  // GUARD 2: never remove a slot somebody is booked into. Matched BOTH ways -- slot_id, and time
  // overlap, because bookings made before slots existed carry no slot_id at all.
  const ids = rows.map(r => r.id);
  const earliest = rows.reduce((a, r) => (r.starts_at < a ? r.starts_at : a), rows[0].starts_at);
  const latest = rows.reduce((a, r) => (r.ends_at > a ? r.ends_at : a), rows[0].ends_at);

  const [{ data: bySlot }, { data: byTime }] = await Promise.all([
    admin.from("practice_appointment").select("slot_id")
      .eq("workspace_id", ctx.workspaceId).in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"])
      .in("slot_id", ids),
    admin.from("practice_appointment").select("scheduled_at, duration_minutes")
      .eq("workspace_id", ctx.workspaceId).in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"])
      .gte("scheduled_at", earliest).lt("scheduled_at", latest),
  ]);

  const takenSlotIds = new Set(((bySlot ?? []) as any[]).map(a => a.slot_id));
  const appts = ((byTime ?? []) as any[]).map(a => {
    const s = Date.parse(a.scheduled_at);
    return { s, e: s + (a.duration_minutes ?? 20) * 60000 };
  });

  const removable = rows.filter(r => {
    if (takenSlotIds.has(r.id)) return false;
    const s = Date.parse(r.starts_at), e = Date.parse(r.ends_at);
    return !appts.some(a => a.s < e && a.e > s);
  });

  if (removable.length > 0)
    await admin.from("practice_availability_slot").delete().in("id", removable.map(r => r.id));

  return { slotsRemoved: removable.length, slotsKept: rows.length - removable.length };
}

export type GenerationReport = {
  fromDate: string; toDate: string;
  daysConsidered: number;
  slotsCreated: number;
  slotsRemoved: number;
  /** Slots a template would have removed but did not, because somebody is booked into them. */
  slotsKept: number;
  /**
   * s5.2: slots that already existed and were MOVED or BLOCKED by a location change or an activity
   * substitution. Separate from created and removed because it is neither -- the time is still there.
   */
  slotsReshaped: number;
  daysSkippedForLeave: number;
  /** Named, not silent: generation stops at this many days and says it did. */
  cappedAt: number | null;
};

const GENERATION_CAP_DAYS = 120;

/**
 * Turn the regular week and its exceptions into real slots, for a date range.
 *
 * IDEMPOTENT. Running it twice produces the same diary -- an existing generated slot for the same
 * template and date is left alone rather than duplicated, so "update immediately after changes" can be
 * implemented by simply running it again.
 */
export async function generateSlots(admin: any, ctx: WorkspaceContext, args: {
  fromDate: string; toDate: string; actorId: string; correlationId: string;
}): Promise<EngineResult<GenerationReport>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  if (args.toDate < args.fromDate)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the last date cannot be before the first" };

  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";

  const allDates = datesBetween(args.fromDate, args.toDate, 1000);
  const capped = allDates.length > GENERATION_CAP_DAYS;
  const dates = allDates.slice(0, GENERATION_CAP_DAYS);

  const [{ data: templates }, { data: exceptions }] = await Promise.all([
    // ACTIVE ONLY. A suspended session is still on the screen and still generates nothing -- that is the
    // whole difference between suspending and closing.
    admin.from("practice_availability_template")
      .select("id, location_id, clinic_id, weekday, starts_minute, ends_minute, slot_kind, appointment_minutes")
      .eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    admin.from("practice_availability_exception")
      // ⚠ THE TWO REPLACEMENT COLUMNS ARE SELECTED BECAUSE THEY ARE READ, thirty lines below. Migration
      // 242 added them for s5.2's location change and activity substitution, and a column added for a
      // feature and then never read is this project's own recurring failure -- practice_configuration
      // sat inert from migration 191 until CPR-360.
      .select("id, location_id, kind, from_date, to_date, starts_minute, ends_minute, slot_kind, appointment_minutes, replacement_location_id, replacement_activity_type")
      .eq("workspace_id", ctx.workspaceId)
      .lte("from_date", dates[dates.length - 1] ?? args.fromDate)
      .gte("to_date", dates[0] ?? args.fromDate),
  ]);

  const tmpls = (templates ?? []) as any[];
  const excs = (exceptions ?? []) as any[];

  // ── WHAT IS ALREADY THERE, so generation is idempotent rather than duplicating on every run.
  //
  // ⚠ THIS QUERY ONCE FILTERED TO TEMPLATE-GENERATED SLOTS ONLY, and a one-off session has no template
  // id -- so its key was never in `already`, and every run inserted the Saturday again. The API
  // regenerates on EVERY write, so a practice that added three sessions would have finished with four
  // copies of each one-off. Caught by an assertion added only because a failability probe pointed at
  // this path; the bug was a duplicate, not the deletion the probe was looking for.
  const { data: existingSlots } = await admin.from("practice_availability_slot")
    .select("id, generated_from_template_id, generated_for_date, starts_at, ends_at, location_id")
    .eq("workspace_id", ctx.workspaceId)
    .not("generated_for_date", "is", null)
    .gte("generated_for_date", dates[0] ?? args.fromDate)
    .lte("generated_for_date", dates[dates.length - 1] ?? args.toDate);
  // TWO KEYS, because the two kinds of generated slot are identified differently. A template's output
  // is identified by the template; an exception's output has no id to point at, so it is identified by
  // the window it occupies -- which is exactly what a duplicate of it would also occupy.
  const already = new Set<string>();
  /**
   * The template-generated rows, by their key, so the reshaping pass can see what SHAPE each one
   * currently has. A Set can only answer "is there one"; s5.2's location change and activity
   * substitution need "is the one that is there still right", which is a different question.
   */
  const existingByKey = new Map<string, { id: string; location_id: string | null; slot_kind: string }>();
  for (const s of ((existingSlots ?? []) as any[])) {
    if (s.generated_from_template_id) {
      already.add(`${s.generated_from_template_id}|${s.generated_for_date}`);
      existingByKey.set(`${s.generated_from_template_id}|${s.generated_for_date}`, {
        id: s.id as string,
        location_id: (s.location_id as string | null) ?? null,
        slot_kind: (s.slot_kind as string) ?? "clinic",
      });
    } else
      // NORMALISED TO EPOCH MILLISECONDS ON BOTH SIDES. Postgres returns "…T07:00:00+00:00" and the
      // generator computes "…T07:00:00.000Z" -- the same instant, different text, so comparing the
      // strings matched nothing and the de-duplication silently did not happen.
      already.add(windowKey(s.generated_for_date, Date.parse(s.starts_at), Date.parse(s.ends_at), s.location_id));
  }

  const toInsert: any[] = [];
  /** Slots that already existed but whose place or kind a s5.2 reshaping change has moved under them. */
  const toReshape: { id: string; location_id: string | null; slot_kind: string; note: string | null }[] = [];
  let daysSkippedForLeave = 0;

  /**
   * s5.2's TWO RESHAPING KINDS, applied to one session on one date.
   *
   * ⚠ A RESHAPE IS NOT A REMOVAL AND IT IS NOT AN ADDITION. The practitioner is still working; the
   * session is somewhere else, or it is something else. Modelling either as a closure would delete the
   * time from the diary and leave the planner claiming a free afternoon during an emergency theatre
   * list. Modelling them as nothing at all would leave the two columns migration 242 added unread.
   *
   *   location_change        the slot MOVES. Every booking in it stays where it was, which is precisely
   *                          the disruption s5.3's action queue exists to put in front of a human.
   *   activity_substitution  the slot becomes `blocked`, so bookingPreview stops offering it -- its
   *                          filter is `clinic | telemedicine | emergency_reserve`. The time stays in the
   *                          diary because the practitioner is still occupied by it.
   */
  const reshapeFor = (t: any, onThisDate: any[]) => {
    let locationId: string | null = t.location_id ?? null;
    let slotKind: string = t.slot_kind;
    let note: string | null = null;
    for (const e of onThisDate) {
      if (!RESHAPES_TIME.includes(e.kind)) continue;
      if (e.location_id !== null && e.location_id !== (t.location_id ?? null)) continue;
      if (e.kind === "location_change" && e.replacement_location_id) {
        locationId = e.replacement_location_id as string;
        note = "Moved for the day";
      }
      if (e.kind === "activity_substitution" && e.replacement_activity_type) {
        slotKind = "blocked";
        note = `Replaced by ${ACTIVITY_LABEL[e.replacement_activity_type as ActivityType] ?? e.replacement_activity_type}`;
      }
    }
    return { locationId, slotKind, note };
  };

  for (const date of dates) {
    const weekday = isoWeekday(date);
    const dayStartMs = Date.parse(zonedDayRange(date, timezone).startIso);
    const at = (minute: number) => new Date(dayStartMs + minute * 60000).toISOString();

    const onThisDate = excs.filter(e => e.from_date <= date && e.to_date >= date);
    const removals = onThisDate.filter(e => REMOVES.includes(e.kind));

    // ── LEAVE, CLOSURE AND AN EMERGENCY INTERRUPTION TAKE THE DAY, at the place they name; a
    //    practice-wide one takes all of it.
    for (const t of tmpls) {
      if (t.weekday !== weekday) continue;
      const removed = removals.some(e => e.location_id === null || e.location_id === t.location_id);
      if (removed) { daysSkippedForLeave++; continue; }
      const shape = reshapeFor(t, onThisDate);
      const key = `${t.id}|${date}`;
      if (already.has(key)) {
        // ⚠ ALREADY THERE IS NOT THE SAME AS ALREADY RIGHT. The idempotency key is the template and the
        // date, which is what stops a duplicate -- and it cannot see that a location change has since
        // moved the session, because neither the place nor the kind is in the key. Without this the
        // slot would sit at yesterday's address for ever, and the booking engine would keep offering it.
        const have = existingByKey.get(key);
        if (have && (have.location_id !== shape.locationId || have.slot_kind !== shape.slotKind))
          toReshape.push({ id: have.id, location_id: shape.locationId, slot_kind: shape.slotKind, note: shape.note });
        continue;
      }
      toInsert.push({
        workspace_id: ctx.workspaceId, location_id: shape.locationId, clinic_id: t.clinic_id,
        starts_at: at(t.starts_minute), ends_at: at(t.ends_minute),
        slot_kind: shape.slotKind, status: "OPEN",
        generated_from_template_id: t.id, generated_for_date: date,
        note: shape.note,
      });
      already.add(key);
    }

    // ── ADDED TIME. A one-off session or extended hours has no template, so it is generated with a
    // null template id -- which means regeneration will not remove it either. That is correct: a
    // practitioner who typed "I am also working this Saturday" did not ask for it to be reconsidered.
    for (const e of onThisDate) {
      // ⚠ `!REMOVES` IS NOT THE SAME AS `ADDS`, AND IT USED TO BE. With four kinds the two were the same
      // set; migration 242's location change and activity substitution are neither, and the old test let
      // them through here -- so a location change generated a SECOND slot beside the one it had just
      // moved, and the day held two clinics at two addresses. Found by an assertion that counted the
      // day's slots after the move rather than only checking the moved one.
      if (!ADDS_TIME.includes(e.kind)) continue;
      // KEYED ON THE WINDOW, not on the exception id -- because the slot this creates carries no
      // reference back to the exception, so the window is the only thing a later run can recognise it
      // by. `exception:<id>|<date>` was the first version and matched nothing on re-read, which is how
      // every one-off session came to be re-inserted on every write.
      const startsAt = at(e.starts_minute), endsAt = at(e.ends_minute);
      const key = windowKey(date, Date.parse(startsAt), Date.parse(endsAt), e.location_id);
      if (already.has(key)) continue;
      toInsert.push({
        workspace_id: ctx.workspaceId, location_id: e.location_id, clinic_id: null,
        starts_at: startsAt, ends_at: endsAt,
        slot_kind: e.slot_kind, status: "OPEN",
        generated_from_template_id: null, generated_for_date: date,
        note: e.kind === "extra_session" ? "One-off session" : "Extended hours",
      });
      already.add(key);
    }
  }

  let slotsCreated = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error } = await admin.from("practice_availability_slot")
      .insert(toInsert).select("id");
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    slotsCreated = (inserted ?? []).length;
  }

  // ── s5.2's RESHAPES, APPLIED IN PLACE.
  //
  // ⚠ UPDATED, NOT DELETED AND RE-CREATED, and the slot id is why. An appointment made before the change
  // carries this slot's id; deleting the row and inserting a replacement would orphan that reference and
  // the booking would stop being findable through its slot. The appointment's OWN location is left alone
  // on purpose -- the patient was told the old address, and telling them otherwise is a decision for
  // s5.3's action queue, not a side effect of regenerating a diary.
  let slotsReshaped = 0;
  for (const r of toReshape) {
    const { error } = await admin.from("practice_availability_slot")
      .update({ location_id: r.location_id, slot_kind: r.slot_kind, note: r.note })
      .eq("id", r.id).eq("workspace_id", ctx.workspaceId);
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    slotsReshaped++;
  }

  // Slots this generator made for days that are now on leave, or for sessions no longer in the week.
  let slotsRemoved = 0, slotsKept = 0;
  for (const date of dates) {
    const weekday = isoWeekday(date);
    const onThisDate = excs.filter(e => e.from_date <= date && e.to_date >= date);
    const removals = onThisDate.filter(e => REMOVES.includes(e.kind));
    const liveTemplateIds = tmpls
      .filter(t => t.weekday === weekday
        && !removals.some(e => e.location_id === null || e.location_id === t.location_id))
      .map(t => t.id);

    const { data: staleSlots } = await admin.from("practice_availability_slot")
      .select("id, generated_from_template_id")
      .eq("workspace_id", ctx.workspaceId).eq("generated_for_date", date)
      .not("generated_from_template_id", "is", null);
    // ONLY THE SLOTS WHOSE TEMPLATE IS NO LONGER LIVE FOR THIS DAY. Passing the whole day to the reaper
    // would delete the sessions that ARE still in the regular week -- the generator would spend every
    // run removing exactly what it had just created.
    const stale = ((staleSlots ?? []) as any[])
      .filter(s => !liveTemplateIds.includes(s.generated_from_template_id))
      .map(s => s.id);
    if (stale.length === 0) continue;

    const reaped = await reapGeneratedSlots(admin, ctx, { slotIds: stale });
    slotsRemoved += reaped.slotsRemoved;
    slotsKept += reaped.slotsKept;
  }

  const report: GenerationReport = {
    fromDate: args.fromDate, toDate: args.toDate,
    daysConsidered: dates.length,
    slotsCreated, slotsRemoved, slotsKept, slotsReshaped, daysSkippedForLeave,
    cappedAt: capped ? GENERATION_CAP_DAYS : null,
  };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.availability_generated",
    payload: { ...report }, correlationId: args.correlationId,
  });
  return { ok: true, data: report };
}

// ── BOOKING PREVIEW ──────────────────────────────────────────────────────────────────────────────────

/**
 * What is bookable, in the form a patient would be offered it.
 *
 * REBUILT FROM THE SLOTS AND THE RULES, never from a stored answer. The specification calls this
 * "Review patient-facing availability" -- and the only version of that worth having is one computed the
 * same way the booking engine computes it, or the preview and the diary will disagree.
 */
export async function bookingPreview(admin: any, ctx: WorkspaceContext, args: {
  fromDate: string; toDate: string; appointmentType?: string;
}) {
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";
  const appointmentType = args.appointmentType ?? "new_consultation";

  const from = zonedDayRange(args.fromDate, timezone).startIso;
  const to = zonedDayRange(args.toDate, timezone).endIso;

  const [{ data: slots }, { data: appts }, { data: locations }] = await Promise.all([
    admin.from("practice_availability_slot")
      .select("id, location_id, starts_at, ends_at, slot_kind, generated_from_template_id")
      .eq("workspace_id", ctx.workspaceId)
      .gte("starts_at", from).lt("starts_at", to).order("starts_at"),
    admin.from("practice_appointment")
      .select("scheduled_at, duration_minutes, location_id")
      .eq("workspace_id", ctx.workspaceId).in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"])
      .gte("scheduled_at", from).lt("scheduled_at", to),
    admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId),
  ]);

  const locName = new Map(((locations ?? []) as any[]).map(l => [l.id, l.name]));
  const booked = ((appts ?? []) as any[]).map(a => {
    const s = Date.parse(a.scheduled_at);
    return { s, e: s + (a.duration_minutes ?? 20) * 60000 };
  });

  const now = Date.now();
  const days = new Map<string, any[]>();

  for (const slot of ((slots ?? []) as any[])) {
    // Only time a patient could actually be seen in. Leave and blocked are not offers.
    if (!["clinic", "telemedicine", "emergency_reserve"].includes(slot.slot_kind)) continue;

    const rule = await resolveBookingRule(admin, ctx.workspaceId, slot.location_id ?? null, appointmentType);
    const s = Date.parse(slot.starts_at), e = Date.parse(slot.ends_at);
    const taken = booked.some(b => b.s < e && b.e > s);

    const tooSoon = s < now + rule.leadTimeMinutes * 60000;
    const tooFar = rule.bookingHorizonDays !== null && s > now + rule.bookingHorizonDays * 86400000;

    const date = new Date(s).toLocaleDateString("en-CA", { timeZone: timezone });
    if (!days.has(date)) days.set(date, []);
    days.get(date)!.push({
      slotId: slot.id,
      locationName: slot.location_id ? locName.get(slot.location_id) ?? null : null,
      from: slot.starts_at, to: slot.ends_at, kind: slot.slot_kind,
      generated: !!slot.generated_from_template_id,
      // WHY it is not offerable, not merely that it is not. A preview that says "unavailable" with no
      // reason is a preview a practitioner cannot act on.
      offerable: !taken && !tooSoon && !tooFar,
      withheldBecause: taken ? "already booked"
        : tooSoon ? `inside the ${rule.leadTimeMinutes} minute notice this ${rule.source === "default" ? "practice" : rule.source} rule requires`
          : tooFar ? `beyond the ${rule.bookingHorizonDays} day booking horizon`
            : null,
    });
  }

  return {
    timezone, appointmentType,
    days: [...days.entries()].map(([date, entries]) => ({
      date,
      offerable: entries.filter(x => x.offerable).length,
      total: entries.length,
      entries,
    })),
    /** Stated on the preview: nobody outside the practice can see any of this. */
    patientFacing: false,
    note: "This is what the booking engine would offer. No patient can reach it — self-booking is not built.",
  };
}
