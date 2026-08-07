import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { sessionConflict, hhmm } from "@/lib/practice/availability-config";
import {
  SESSION_ACTIVITY_TYPES, BOOKING_MODES, BOOKING_MODES_LIVE, SESSION_APPOINTMENT_TYPES,
  suggestSessionName, type BookingMode,
} from "@/lib/practice/practice-session-constants";
import { WALK_IN_NOT_CONFIGURABLE, WALK_IN_ENFORCEMENT_NOTE } from "@/lib/practice/recall-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 1 -- LAYER 1, "MY REGULAR PRACTICE". Migration 240.
//
// s4.3, verbatim: "A weekly time block must become a Practice Session. A session is a named, recurring
// period that carries enough context for planning, booking and encounter inheritance."
//
// THE TIME HALF OF A SESSION ALREADY EXISTED and is not re-implemented here. availability-config.ts owns
// the weekday, the minutes, the overlap-and-travel conflict rule and the slot generator, and this module
// calls into it rather than repeating it -- sessionConflict() in particular, because a second copy of
// that check is a second place to forget it, and forgetting it is what sent a practitioner to two
// hospitals at once once already.
//
// WHAT THIS MODULE ADDS is the CONTEXT half of s4.3's sentence: a name, what kind of work it is, whether
// patients may book it, how much capacity it holds, which appointment types it offers, and when the
// pattern starts and stops applying.
//
// ---- FOUR RULES THIS FILE EXISTS TO ENFORCE ---------------------------------------------------------
//
//   1. s4.4  DELETING A SESSION WITH FUTURE BOOKINGS IS PROHIBITED until they are resolved. Refused with
//            the count, because "cannot delete" without a number is a wall rather than an instruction.
//   2. s4.1  ENDING A SESSION IS A DATE, NOT A DELETION. effective_to. Deleting erases every past
//            occurrence, planner view and audit answer that depended on the session having existed.
//   3. s7.4  THE STRICTER OF DERIVED AND MANUAL CAPACITY WINS, so neither may overwrite the other. Null
//            manual means "derive it from the time and the appointment length".
//   4. s4.3  ZERO APPOINTMENT TYPES MEANS NOT PATIENT-BOOKABLE, which is why the link is a join table:
//            zero, one and several are all real answers and a single column expresses only the middle.
//
// ---- A FAILED READ IS NEVER A ZERO ------------------------------------------------------------------
//
// Every read below carries its error. A setup screen that renders a database outage as "0 sessions
// configured" tells a practitioner to go and build a week they already have -- and the delete guard
// reading zero bookings because the query failed would delete a session somebody is booked into. Where
// the answer matters for a refusal, an unreadable answer REFUSES.
//
// ---- THE DUPLICATE COLUMNS ARE GONE (migration 241) --------------------------------------------------
//
// This module used to hold a careful workaround: migration 240 added `capacity_manual` and a join table
// for appointment types when migration 231 had ALREADY added `capacity` and `appointment_type` to the
// same table. Reads took the stricter capacity and the union of type stores; writes kept both in step.
//
// That was correct and it was not enough. Handling a duplicate safely still requires every future reader
// to LEARN the arrangement, and the two nulls meant OPPOSITE things -- 231's meant "unlimited", 240's
// meant "derive it from the session length". A reader could not tell which question a null answered.
//
// Migration 241 drops `capacity_manual` and the legacy `appointment_type` column, after copying the
// column's values into the join table. What survives:
//   capacity          one column. NULL MEANS DERIVE from the session length and the appointment length,
//                     superseding 231's "null means unlimited" -- strictly safer, since a four-hour
//                     clinic becomes twelve slots rather than infinite.
//   appointment types the join table alone, because s4.3 needs zero, one AND several, and a single
//                     column can express only the middle one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/**
 * THE THREE STATES, everywhere.
 *
 * `ok` with an empty value is "nothing there". `denied` is "you may not see this". `unreadable` is "the
 * query failed" -- and the whole point of separating the last two from the first is that neither of them
 * is a nought, and a screen that draws them as one is lying about a database outage.
 */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "denied"; reason: string }
  | { state: "unreadable"; reason: string };

export const readingValue = <T>(r: Reading<T>, fallback: T): T =>
  r.state === "ok" ? r.value : fallback;

/** Live statuses. A cancelled booking does not block anything; the other three are real people. */
const LIVE_APPOINTMENT_STATUSES = ["REQUESTED", "CONFIRMED", "ARRIVED"];

const nowIso = () => new Date().toISOString();

// ── CAPACITY (s7.4) ──────────────────────────────────────────────────────────────────────────────────

export type SessionCapacity = {
  /** From the time and the appointment length. Null when no appointment length can be established. */
  derived: number | null;
  /** What a practitioner typed. Null means "derive it". */
  manual: number | null;
  /** The one the booking engine should honour. */
  effective: number | null;
  /** Which of the two won, so a screen can say why the number is what it is. */
  source: "derived" | "manual" | "stricter_of_both" | "none";
  /** The appointment length the derivation used, and where it came from. */
  appointmentMinutes: number | null;
  appointmentMinutesSource: "session" | "practice_default" | "none";
};

/**
 * s7.4: "Availability provides time; appointment types provide expected duration; booking rules control
 * how capacity may be allocated" and "where duration-based capacity and manual capacity disagree, the
 * STRICTER limit applies".
 *
 * SO THE TWO ARE COMPUTED SEPARATELY AND COMPARED, never merged. A manual figure that had overwritten
 * the derivation could not afterwards be compared against it, and the stricter-wins rule would have
 * nothing to be stricter than.
 */
export function computeCapacity(args: {
  startsMinute: number; endsMinute: number;
  sessionAppointmentMinutes: number | null;
  practiceDefaultMinutes: number | null;
  manual: number | null;
}): SessionCapacity {
  const minutes = args.sessionAppointmentMinutes ?? args.practiceDefaultMinutes ?? null;
  const source: SessionCapacity["appointmentMinutesSource"] =
    args.sessionAppointmentMinutes != null ? "session"
      : args.practiceDefaultMinutes != null ? "practice_default" : "none";

  const span = args.endsMinute - args.startsMinute;
  const derived = minutes && minutes > 0 && span > 0 ? Math.floor(span / minutes) : null;
  const manual = args.manual;

  let effective: number | null;
  let winner: SessionCapacity["source"];
  if (derived == null && manual == null) { effective = null; winner = "none"; }
  else if (manual == null) { effective = derived; winner = "derived"; }
  else if (derived == null) { effective = manual; winner = "manual"; }
  else if (derived === manual) { effective = derived; winner = "stricter_of_both"; }
  else { effective = Math.min(derived, manual); winner = derived < manual ? "derived" : "manual"; }

  return {
    derived, manual, effective, source: winner,
    appointmentMinutes: minutes, appointmentMinutesSource: source,
  };
}

// ── FUTURE BOOKINGS (s4.4) ───────────────────────────────────────────────────────────────────────────

export type FutureBookings = {
  count: number;
  /** The soonest one, so a refusal can say when rather than only how many. */
  earliestIso: string | null;
};

/**
 * WHO IS BOOKED INTO THIS SESSION, FROM NOW ON.
 *
 * MATCHED TWO WAYS, for the same reason reapGeneratedSlots() matches two ways: by slot_id, and by time
 * overlap with the slots this session generated. Bookings made before slots existed carry no slot_id at
 * all, so a slot_id-only count would report nought for a session with real patients in it -- and this
 * count is what a deletion is refused on.
 *
 * ⚠ RETURNS A Reading, AND AN UNREADABLE ANSWER IS NOT A ZERO. If either query fails the caller must
 * refuse the deletion, because "the database did not answer" and "nobody is booked" are the two things
 * this codebase's first doctrine exists to keep apart.
 */
export async function futureBookingsForSession(
  admin: any, ctx: WorkspaceContext, templateId: string,
): Promise<Reading<FutureBookings>> {
  const from = nowIso();

  const { data: slots, error: slotErr } = await admin.from("practice_availability_slot")
    .select("id, starts_at, ends_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("generated_from_template_id", templateId)
    .gte("starts_at", from);
  if (slotErr)
    return { state: "unreadable", reason: `the slots this session generated could not be read: ${slotErr.message}` };

  const rows = (slots ?? []) as any[];
  if (rows.length === 0) return { state: "ok", value: { count: 0, earliestIso: null } };

  const ids = rows.map(r => r.id as string);
  const earliest = rows.reduce((a: string, r: any) => (r.starts_at < a ? r.starts_at : a), rows[0].starts_at as string);
  const latest = rows.reduce((a: string, r: any) => (r.ends_at > a ? r.ends_at : a), rows[0].ends_at as string);

  const [bySlot, byTime] = await Promise.all([
    admin.from("practice_appointment").select("id, scheduled_at")
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_APPOINTMENT_STATUSES).in("slot_id", ids),
    admin.from("practice_appointment").select("id, scheduled_at, duration_minutes")
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_APPOINTMENT_STATUSES)
      .gte("scheduled_at", earliest).lt("scheduled_at", latest),
  ]);
  if (bySlot.error)
    return { state: "unreadable", reason: `bookings against those slots could not be read: ${bySlot.error.message}` };
  if (byTime.error)
    return { state: "unreadable", reason: `bookings in that window could not be read: ${byTime.error.message}` };

  const windows = rows.map((r: any) => ({ s: Date.parse(r.starts_at), e: Date.parse(r.ends_at) }));
  const hits = new Map<string, string>();
  for (const a of ((bySlot.data ?? []) as any[])) hits.set(a.id as string, a.scheduled_at as string);
  for (const a of ((byTime.data ?? []) as any[])) {
    const s = Date.parse(a.scheduled_at);
    const e = s + (a.duration_minutes ?? 20) * 60000;
    if (windows.some(w => w.s < e && w.e > s)) hits.set(a.id as string, a.scheduled_at as string);
  }

  const times = [...hits.values()].sort();
  return { state: "ok", value: { count: hits.size, earliestIso: times[0] ?? null } };
}

// ── READ THE WHOLE OF LAYER 1 ────────────────────────────────────────────────────────────────────────

export type SessionView = {
  id: string;
  /** What a practitioner typed. Null when nobody has named it. */
  sessionName: string | null;
  /** s4.3's "suggested from location + activity + day". A SUGGESTION -- never written to the database. */
  suggestedName: string;
  weekday: number;
  startsMinute: number;
  endsMinute: number;
  locationId: string | null;
  locationName: string | null;
  clinicId: string | null;
  clinicName: string | null;
  activityType: string | null;
  slotKind: string;
  bookingMode: BookingMode;
  /** s4.3's "zero means not patient-bookable". */
  appointmentTypes: string[];
  capacity: SessionCapacity;
  walkInsAllowed: boolean;
  walkInLimit: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Where today sits relative to the effective window. */
  effectiveState: "current" | "not_yet_started" | "ended";
  sessionNote: string | null;
  status: string;
  /** Things about THIS session that a practitioner should know, in their own words. */
  warnings: string[];
};

export type LocationView = {
  id: string;
  name: string;
  type: string;
  active: boolean;
  /** s4.2's four indicators, each computed from the sessions actually at this location. */
  supportsPatientBooking: boolean;
  supportsInternalBooking: boolean;
  supportsWalkIns: boolean;
  supportsVirtualCare: boolean;
  sessionCount: number;
  travelBufferMinutes: number | null;
  /** s4.2's "location-specific hospital identifier configuration status". */
  facilityId: string | null;
  facilityName: string | null;
};

/**
 * Everything Layer 1 draws, plus the real counts Layers 2 and 3 need for their navigator cards.
 *
 * The layer 2 and layer 3 figures are REAL rather than omitted: exceptions and booking rules both exist
 * (migration 230) and a navigator card showing "—" beside a layer that has three exceptions in it would
 * be a worse lie than the later-phase surfaces it sits above.
 */
export async function practiceSessions(admin: any, ctx: WorkspaceContext) {
  const mayEdit = ctx.capabilities.includes("appointment.manage");

  const [ws, cfg, locations, clinics, templates, links, exceptions, rules, facilities] = await Promise.all([
    admin.from("practice_workspace").select("timezone, name").eq("id", ctx.workspaceId).maybeSingle(),
    admin.from("practice_configuration").select("default_appointment_minutes")
      .eq("workspace_id", ctx.workspaceId).eq("is_effective", true).maybeSingle(),
    admin.from("practice_location").select("id, name, type, active, facility_id, travel_buffer_minutes")
      .eq("workspace_id", ctx.workspaceId).order("name"),
    admin.from("practice_clinic").select("id, location_id, name, consultation_mode, active")
      .eq("workspace_id", ctx.workspaceId).order("name"),
    // ACTIVE AND SUSPENDED. A suspended session must stay visible or "suspend" is a slower "delete".
    admin.from("practice_availability_template")
      .select("id, location_id, clinic_id, weekday, starts_minute, ends_minute, slot_kind, appointment_minutes, capacity, note, status, session_name, activity_type, booking_mode, walk_ins_allowed, walk_in_limit, effective_from, effective_to, session_note")
      .eq("workspace_id", ctx.workspaceId).in("status", ["active", "suspended"])
      .order("weekday").order("starts_minute"),
    admin.from("practice_session_appointment_type").select("template_id, appointment_type")
      .eq("workspace_id", ctx.workspaceId),
    admin.from("practice_availability_exception")
      .select("id, location_id, kind, from_date, to_date, starts_minute, ends_minute, reason")
      .eq("workspace_id", ctx.workspaceId).order("from_date"),
    admin.from("practice_booking_rule")
      .select("id, location_id, appointment_type, lead_time_minutes, booking_horizon_days, walk_in_daily_limit, visibility, active")
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_facility").select("id, name, active").eq("workspace_id", ctx.workspaceId),
  ]);

  const timezone = (ws.data?.timezone as string) || "UTC";
  const today = practiceToday(timezone);
  const practiceDefaultMinutes = (cfg.data?.default_appointment_minutes as number | undefined) ?? null;

  // ── EVERY READ CARRIES ITS OUTCOME ──────────────────────────────────────────────────────────────
  const reading = <T>(q: { data: any; error: any }, map: (rows: any[]) => T, what: string): Reading<T> =>
    q.error
      ? { state: "unreadable", reason: `${what} could not be read: ${q.error.message}` }
      : { state: "ok", value: map((q.data ?? []) as any[]) };

  const locRows = (locations.data ?? []) as any[];
  const clinicRows = (clinics.data ?? []) as any[];
  const facRows = (facilities.data ?? []) as any[];
  const locName = new Map(locRows.map(l => [l.id as string, l.name as string]));
  const clinicName = new Map(clinicRows.map(c => [c.id as string, c.name as string]));
  const facName = new Map(facRows.map(f => [f.id as string, f.name as string]));

  // Link rows, grouped. An unreadable link table must NOT silently become "no session offers anything",
  // which would render every session as not patient-bookable -- a claim, not an absence.
  const linksByTemplate = new Map<string, string[]>();
  for (const l of ((links.data ?? []) as any[])) {
    const list = linksByTemplate.get(l.template_id as string) ?? [];
    list.push(l.appointment_type as string);
    linksByTemplate.set(l.template_id as string, list);
  }

  const sessions: Reading<SessionView[]> = reading(templates, rows => rows.map(t => {
    // ⚠ THE UNION AND THE STRICTER-OF-TWO ARE GONE, AND THAT IS THE POINT OF MIGRATION 241.
    //
    // This file used to read the join table UNION a legacy single column, and the smaller of two
    // capacity columns, because migration 240 duplicated what 231 already had. Handling a duplicate
    // safely is not the same as not having one: every reader had to know the arrangement, and the two
    // nulls meant OPPOSITE things (231 unlimited, 240 derive-it). 241 drops one of each pair.
    //
    // Written this way BEFORE 241 is applied, on purpose: not selecting a column works against both
    // schemas, so the code is safe whether or not the migration has been run yet.
    const appointmentTypes = [...new Set(linksByTemplate.get(t.id as string) ?? [])].sort();
    const manual = (t.capacity ?? null) as number | null;

    const capacity = computeCapacity({
      startsMinute: t.starts_minute, endsMinute: t.ends_minute,
      sessionAppointmentMinutes: t.appointment_minutes ?? null,
      practiceDefaultMinutes, manual,
    });

    const effectiveState: SessionView["effectiveState"] =
      t.effective_from && today < t.effective_from ? "not_yet_started"
        : t.effective_to && today > t.effective_to ? "ended" : "current";

    const bookingMode = (t.booking_mode ?? "none") as BookingMode;
    const warnings: string[] = [];
    if (!t.session_name) warnings.push("This session has no name yet.");
    if (!t.activity_type)
      warnings.push("No activity type, so a Current Activity started from it inherits nothing.");
    if (bookingMode !== "none" && appointmentTypes.length === 0)
      warnings.push("Marked bookable but offers no appointment type, so nothing can be booked into it.");
    if (!BOOKING_MODES_LIVE.includes(bookingMode))
      warnings.push(`"${bookingMode}" needs the patient booking page, which is Phase 4 and is not built.`);
    if (effectiveState === "ended") warnings.push("This session's pattern has ended.");
    if (t.walk_ins_allowed && t.walk_in_limit == null)
      warnings.push("Walk-ins are allowed with no limit set.");

    return {
      id: t.id as string,
      sessionName: (t.session_name as string | null) ?? null,
      suggestedName: suggestSessionName({
        locationName: t.location_id ? locName.get(t.location_id) ?? null : null,
        activityType: (t.activity_type as string | null) ?? null,
        weekday: t.weekday as number,
      }),
      weekday: t.weekday as number,
      startsMinute: t.starts_minute as number,
      endsMinute: t.ends_minute as number,
      locationId: (t.location_id as string | null) ?? null,
      locationName: t.location_id ? locName.get(t.location_id) ?? null : null,
      clinicId: (t.clinic_id as string | null) ?? null,
      clinicName: t.clinic_id ? clinicName.get(t.clinic_id) ?? null : null,
      activityType: (t.activity_type as string | null) ?? null,
      slotKind: (t.slot_kind as string) ?? "clinic",
      bookingMode,
      appointmentTypes,
      capacity,
      walkInsAllowed: t.walk_ins_allowed === true,
      walkInLimit: (t.walk_in_limit as number | null) ?? null,
      effectiveFrom: (t.effective_from as string | null) ?? null,
      effectiveTo: (t.effective_to as string | null) ?? null,
      effectiveState,
      sessionNote: (t.session_note as string | null) ?? t.note ?? null,
      status: (t.status as string) ?? "active",
      warnings,
    } satisfies SessionView;
  }), "your sessions");

  // ── s4.2's LOCATION INDICATORS, computed from the sessions actually at each place ────────────────
  const sessionList = readingValue(sessions, [] as SessionView[]);
  const locationsView: Reading<LocationView[]> = reading(locations, rows => rows.map(l => {
    const here = sessionList.filter(s => s.locationId === l.id && s.status === "active");
    return {
      id: l.id as string, name: l.name as string, type: l.type as string, active: l.active === true,
      supportsPatientBooking: here.some(s => s.bookingMode === "link_only" || s.bookingMode === "public"),
      supportsInternalBooking: here.some(s => s.bookingMode === "internal"),
      supportsWalkIns: here.some(s => s.walkInsAllowed),
      // From the session's own kind and its clinics, not from the location's type -- a hospital runs
      // virtual clinics too, and "teleconsultation" as a location type is a different claim.
      supportsVirtualCare: here.some(s => s.slotKind === "telemedicine" || s.activityType === "virtual_clinic")
        || clinicRows.some(c => c.location_id === l.id && c.active && c.consultation_mode === "telemedicine"),
      sessionCount: here.length,
      travelBufferMinutes: (l.travel_buffer_minutes as number | null) ?? null,
      facilityId: (l.facility_id as string | null) ?? null,
      facilityName: l.facility_id ? facName.get(l.facility_id) ?? null : null,
    } satisfies LocationView;
  }), "your locations");

  const upcomingExceptions: Reading<any[]> = reading(exceptions,
    rows => rows.filter(e => e.to_date >= today), "your schedule changes");
  const bookingRules: Reading<any[]> = reading(rules, rows => rows, "your booking rules");
  const clinicsReading: Reading<any[]> = reading(clinics, rows => rows.filter(c => c.active), "your clinics");

  // Every distinct appointment type any session offers -- the figure the comp puts in Layer 1's third tile.
  const typesOffered = [...new Set(sessionList.flatMap(s => s.appointmentTypes))].sort();

  return {
    timezone, today,
    practiceName: (ws.data?.name as string | null) ?? null,
    practiceDefaultMinutes,
    mayEdit,
    sessions,
    locations: locationsView,
    clinics: clinicsReading,
    upcomingExceptions,
    bookingRules,
    typesOffered,
    /** Every read that failed, named, so the page can say which part of it is missing rather than all of it. */
    readFailures: [
      sessions, locationsView, clinicsReading, upcomingExceptions, bookingRules,
    ].filter(r => r.state === "unreadable").map(r => (r as { reason: string }).reason),
  };
}

// ── WRITES ───────────────────────────────────────────────────────────────────────────────────────────

const requireEdit = (ctx: WorkspaceContext) =>
  ctx.capabilities.includes("appointment.manage")
    ? null
    : { ok: false as const, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

/**
 * Create or update a Practice Session -- s4.3's whole field list in one call.
 *
 * ONE FUNCTION FOR BOTH, for the reason editSession() gives for handling edit, move, duplicate and
 * suspend together: they are one operation with different arguments, and separate implementations are
 * separate places to forget the conflict check.
 *
 * ⚠ THE CONFLICT CHECK IS availability-config's, NOT A COPY. Nobody is in two places at one time,
 * whether or not they are the same place, and two sessions at different hospitals need the travel buffer
 * between them.
 */
export async function saveSession(admin: any, ctx: WorkspaceContext, args: {
  /** Absent creates; present updates. */
  templateId?: string | null;
  weekday?: number;
  startsMinute?: number;
  endsMinute?: number;
  locationId?: string | null;
  clinicId?: string | null;
  sessionName?: string | null;
  activityType?: string | null;
  bookingMode?: string;
  appointmentTypes?: string[];
  capacityManual?: number | null;
  appointmentMinutes?: number | null;
  walkInsAllowed?: boolean;
  walkInLimit?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  sessionNote?: string | null;
  slotKind?: string;
  status?: "active" | "suspended";
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; created: boolean; changed: string[] }>> {
  const denied = requireEdit(ctx);
  if (denied) return denied;

  const creating = !args.templateId;

  let existing: any = null;
  if (!creating) {
    const { data, error } = await admin.from("practice_availability_template")
      .select("id, weekday, starts_minute, ends_minute, location_id, clinic_id, slot_kind, appointment_minutes, capacity, status, session_name, activity_type, booking_mode, walk_ins_allowed, walk_in_limit, effective_from, effective_to, session_note")
      .eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    // AN UNREADABLE ROW IS NOT AN ABSENT ROW. Reporting 404 here would tell somebody their session had
    // been deleted by a query that merely failed.
    if (error)
      return { ok: false, status: 500, code: "READ_FAILED", message: `the session could not be read: ${error.message}` };
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (data.status === "closed")
      return { ok: false, status: 422, code: "SESSION_CLOSED", message: "this session has been closed; add a new one instead" };
    existing = data;
  }

  const pick = <T>(given: T | undefined, was: T, fallback: T): T =>
    given !== undefined ? given : (existing ? was : fallback);

  const weekday = pick(args.weekday, existing?.weekday, NaN);
  const startsMinute = pick(args.startsMinute, existing?.starts_minute, NaN);
  const endsMinute = pick(args.endsMinute, existing?.ends_minute, NaN);
  const locationId = pick(args.locationId, existing?.location_id ?? null, null);
  const clinicId = pick(args.clinicId, existing?.clinic_id ?? null, null);
  const sessionName = pick(args.sessionName, existing?.session_name ?? null, null);
  const activityType = pick(args.activityType, existing?.activity_type ?? null, null);
  const bookingMode = pick(args.bookingMode, existing?.booking_mode ?? "none", "none");
  const capacityManual = pick(args.capacityManual, existing?.capacity ?? null, null);
  const appointmentMinutes = pick(args.appointmentMinutes, existing?.appointment_minutes ?? null, null);
  const walkInsAllowed = pick(args.walkInsAllowed, existing?.walk_ins_allowed === true, false);
  const walkInLimit = pick(args.walkInLimit, existing?.walk_in_limit ?? null, null);
  const effectiveFrom = pick(args.effectiveFrom, existing?.effective_from ?? null, null);
  const effectiveTo = pick(args.effectiveTo, existing?.effective_to ?? null, null);
  const sessionNote = pick(args.sessionNote, existing?.session_note ?? null, null);
  const slotKind = pick(args.slotKind, existing?.slot_kind ?? "clinic", "clinic");
  const status = pick(args.status, existing?.status ?? "active", "active");

  // ── VALIDATION, in the order a practitioner would want to hear it ───────────────────────────────
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session needs a day of the week" };
  if (!Number.isFinite(startsMinute) || !Number.isFinite(endsMinute))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session needs a start and an end" };
  if (endsMinute <= startsMinute)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a session must end after it starts" };
  if (sessionName != null && sessionName.trim().length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name cannot be blank; leave it out instead" };
  if (activityType != null && !SESSION_ACTIVITY_TYPES.includes(activityType as any))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `"${activityType}" is not an activity type this practice recognises` };
  if (!BOOKING_MODES.some(m => m.code === bookingMode))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `"${bookingMode}" is not a booking mode` };
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the pattern cannot end before it starts" };
  if (walkInLimit != null && !walkInsAllowed)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a walk-in limit means nothing while walk-ins are not allowed" };
  if (capacityManual != null && (capacityManual < 0 || capacityManual > 500))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a capacity must be between 0 and 500" };

  const types = args.appointmentTypes !== undefined
    ? [...new Set(args.appointmentTypes.map(t => t.trim()).filter(Boolean))]
    : null;
  if (types) {
    const unknown = types.filter(t => !SESSION_APPOINTMENT_TYPES.some(([c]) => c === t));
    if (unknown.length)
      return {
        ok: false, status: 400, code: "VALIDATION_ERROR",
        message: `no appointment may carry the type ${unknown.map(u => `"${u}"`).join(", ")}, so a session cannot offer it`,
      };
  }

  // s4.3: "ZERO MEANS NOT PATIENT-BOOKABLE." Checked before the phase gate below, so that a session
  // opened to patients with nothing to offer is refused for the reason that is actually about the
  // session rather than for the reason that is about this build.
  const effectiveTypes = types ?? (existing ? await currentTypes(admin, ctx, existing) : []);
  const patientFacing = bookingMode === "link_only" || bookingMode === "public";
  if (patientFacing && effectiveTypes.length === 0)
    return {
      ok: false, status: 422, code: "NO_APPOINTMENT_TYPE",
      message: "a session patients may book must offer at least one appointment type; zero means not patient-bookable",
    };

  // ⚠ THE PHASE GATE. s8's patient-facing access -- handle, OTP, publish state -- is Phase 4 and is not
  // started. Storing `public` would be storing a decision nothing can honour, and the session would sit
  // there reading "patients may book" while no patient can reach anything.
  if (patientFacing && !BOOKING_MODES_LIVE.includes(bookingMode as BookingMode))
    return {
      ok: false, status: 422, code: "PHASE_NOT_BUILT",
      message: `"${bookingMode}" needs the patient booking page, which is CPR-V5-007 Phase 4 and is not built. Internal booking works now.`,
    };

  if (locationId) {
    const { data: loc, error } = await admin.from("practice_location")
      .select("id, active").eq("id", locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the location could not be read: ${error.message}` };
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (!loc.active)
      return { ok: false, status: 422, code: "LOCATION_CLOSED", message: "that location is closed" };
  }
  if (clinicId) {
    const { data: cl, error } = await admin.from("practice_clinic")
      .select("id").eq("id", clinicId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the clinic could not be read: ${error.message}` };
    if (!cl) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  // Nobody in two places at once, and enough time to travel between them. Suspending is exempt: taking
  // time OUT of the week cannot create an overlap.
  if (status === "active") {
    const conflict = await sessionConflict(admin, ctx, {
      weekday, startsMinute, endsMinute, locationId,
      excludeId: existing?.id,
    });
    if (conflict) return conflict;
  }

  const row = {
    weekday, starts_minute: startsMinute, ends_minute: endsMinute,
    location_id: locationId, clinic_id: clinicId,
    slot_kind: slotKind,
    appointment_minutes: appointmentMinutes,
    session_name: sessionName ? sessionName.trim() : null,
    activity_type: activityType,
    booking_mode: bookingMode,
    // ONE COLUMN NOW (migration 241). Null means DERIVE from the session length and the appointment
    // length -- 231's "null means unlimited" is superseded, which is strictly safer: a four-hour clinic
    // becomes twelve slots rather than infinite.
    capacity: capacityManual,
    walk_ins_allowed: walkInsAllowed,
    walk_in_limit: walkInLimit,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    session_note: sessionNote ? sessionNote.trim() : null,
    status, active: status === "active",
    updated_at: nowIso(),
  };

  let id: string;
  let changed: string[] = [];
  if (creating) {
    const { data, error } = await admin.from("practice_availability_template")
      .insert({ ...row, workspace_id: ctx.workspaceId, created_by: args.actorId })
      .select("id").maybeSingle();
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the session was not created" };
    id = data.id as string;
    changed = Object.keys(row);
  } else {
    id = existing.id as string;
    changed = Object.entries(row)
      .filter(([k, v]) => k !== "updated_at" && (existing as Record<string, unknown>)[k] !== v)
      .map(([k]) => k);
    const { error } = await admin.from("practice_availability_template").update(row).eq("id", id);
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  }

  if (types) {
    const linked = await setAppointmentTypes(admin, ctx, { templateId: id, types });
    if (!linked.ok) return linked;
    if (!changed.includes("appointment_types")) changed.push("appointment_types");
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: creating ? "practice.session_created" : "practice.session_updated",
    payload: {
      templateId: id, changed,
      weekday, from: hhmm(startsMinute), to: hhmm(endsMinute),
      activityType, bookingMode, appointmentTypes: types ?? undefined,
      effectiveFrom, effectiveTo,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id, created: creating, changed } };
}

/** The types a session offers right now, union-ed across the two places they can be stored. */
async function currentTypes(admin: any, ctx: WorkspaceContext, existing: any): Promise<string[]> {
  const { data } = await admin.from("practice_session_appointment_type")
    .select("appointment_type").eq("workspace_id", ctx.workspaceId).eq("template_id", existing.id);
  const joined = ((data ?? []) as any[]).map(r => r.appointment_type as string);
  const legacy = existing.appointment_type ? [existing.appointment_type as string] : [];
  return [...new Set([...joined, ...legacy])];
}

/**
 * s4.3 / s4.5 -- which appointment types this session offers. Zero is a real answer and is stored as one.
 *
 * REPLACE, NOT MERGE. "This session offers new consultations and follow-ups" is a complete statement, and
 * a merge would make removing a type impossible through the same door that adds one.
 */
export async function setAppointmentTypes(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; types: string[];
}): Promise<EngineResult<{ types: string[] }>> {
  const denied = requireEdit(ctx);
  if (denied) return denied;

  const wanted = [...new Set(args.types.map(t => t.trim()).filter(Boolean))];
  const unknown = wanted.filter(t => !SESSION_APPOINTMENT_TYPES.some(([c]) => c === t));
  if (unknown.length)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown appointment type: ${unknown.join(", ")}` };

  const { error: delErr } = await admin.from("practice_session_appointment_type")
    .delete().eq("workspace_id", ctx.workspaceId).eq("template_id", args.templateId);
  if (delErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: delErr.message };

  if (wanted.length) {
    // ⚠ NOT AN UPSERT. The unique index is (template_id, appointment_type) and the rows were just
    // cleared, so a plain insert is correct -- and this project's own trap is that PostgREST's
    // onConflict cannot target a partial index and fails silently when it is asked to. The error is read.
    const { error } = await admin.from("practice_session_appointment_type").insert(
      wanted.map(t => ({ workspace_id: ctx.workspaceId, template_id: args.templateId, appointment_type: t })),
    );
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  }

  // Migration 231's single column, kept in step. One column cannot hold several, so it holds the answer
  // only when there IS one -- which is exactly the case a legacy row expresses.
  const { error: legacyErr } = await admin.from("practice_availability_template")
    // The legacy single column is gone (migration 241). Only updated_at moves here now -- the join
    // table above is the whole record of which types a session offers.
    .update({ updated_at: nowIso() })
    .eq("id", args.templateId).eq("workspace_id", ctx.workspaceId);
  if (legacyErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: legacyErr.message };

  return { ok: true, data: { types: wanted } };
}

/**
 * s4.1 -- END a session. THIS IS THE ONE THAT SHOULD BE USED.
 *
 * "Layer 1 defines the practitioner's stable but editable baseline... Changes to employment, clinic days,
 * locations or responsibilities may update the baseline PROSPECTIVELY."
 *
 * An end date keeps every past occurrence, every planner view over last month and every audit answer
 * that depended on the Tuesday clinic having run. Deletion erases all three, which is why deleteSession()
 * below is the narrow door and this is the wide one.
 */
export async function endSession(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; effectiveTo: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; effectiveTo: string; bookingsAfter: number }>> {
  const denied = requireEdit(ctx);
  if (denied) return denied;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveTo))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an end date is needed, as YYYY-MM-DD" };

  const { data: t, error } = await admin.from("practice_availability_template")
    .select("id, effective_from, effective_to, status").eq("id", args.templateId)
    .eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the session could not be read: ${error.message}` };
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (t.effective_from && args.effectiveTo < t.effective_from)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the pattern cannot end before it starts" };

  const { error: upErr } = await admin.from("practice_availability_template")
    .update({ effective_to: args.effectiveTo, updated_at: nowIso() }).eq("id", t.id);
  if (upErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: upErr.message };

  // NOT A REFUSAL, A REPORT. Ending a pattern next month is a legitimate thing to do with patients
  // booked after it; s5.3's affected-booking workflow is Phase 2 and is not built, so the honest thing
  // is to say how many will need attention rather than to pretend nothing will.
  const after = await futureBookingsForSession(admin, ctx, t.id as string);
  const bookingsAfter = after.state === "ok" ? after.value.count : -1;

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.session_ended",
    payload: { templateId: t.id, effectiveTo: args.effectiveTo, bookingsAfter },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string, effectiveTo: args.effectiveTo, bookingsAfter } };
}

/**
 * s4.4, verbatim: "DELETING A SESSION WITH FUTURE BOOKINGS IS PROHIBITED UNTIL AFFECTED BOOKINGS ARE
 * RESOLVED."
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE REFUSAL SAYS HOW MANY AND WHEN THE FIRST ONE IS. "You cannot delete this" is a wall; "four
 * patients are booked into this session, the first on Tuesday" is an instruction. s5.3's resolution
 * workflow -- offer next available, bulk reschedule, waiting list, cancel and notify -- is Phase 2 and is
 * not built, so the only resolutions available today are moving or cancelling those four appointments in
 * the calendar, and the refusal says that too rather than sending somebody looking for a button.
 *
 * AN UNREADABLE COUNT ALSO REFUSES. "The query failed" and "nobody is booked" are the same number and
 * opposite facts, and the direction that costs a patient their appointment is the one that guesses.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function deleteSession(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; deleted: true }>> {
  const denied = requireEdit(ctx);
  if (denied) return denied;

  const { data: t, error } = await admin.from("practice_availability_template")
    .select("id, weekday, starts_minute, ends_minute, session_name")
    .eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the session could not be read: ${error.message}` };
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const booked = await futureBookingsForSession(admin, ctx, t.id as string);
  if (booked.state !== "ok")
    return {
      ok: false, status: 503, code: "BOOKINGS_UNREADABLE",
      message: `this session cannot be deleted because ${booked.reason} — and an unread booking is not an absent one`,
    };
  if (booked.value.count > 0) {
    const n = booked.value.count;
    const when = booked.value.earliestIso
      ? `, the first on ${booked.value.earliestIso.slice(0, 10)}`
      : "";
    return {
      ok: false, status: 409, code: "SESSION_HAS_FUTURE_BOOKINGS",
      message: `${n} patient${n === 1 ? " is" : "s are"} booked into this session${when}. Move or cancel ${n === 1 ? "it" : "them"} in the calendar first, or set an end date instead so past occurrences are kept.`,
    };
  }

  // The slots it generated go with it, and only the ones it generated. Nothing is booked into any of
  // them -- that was just established -- so there is nothing here for the two guards to save.
  const { error: slotErr } = await admin.from("practice_availability_slot")
    .delete().eq("workspace_id", ctx.workspaceId).eq("generated_from_template_id", t.id);
  if (slotErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: slotErr.message };

  const { error: linkErr } = await admin.from("practice_session_appointment_type")
    .delete().eq("workspace_id", ctx.workspaceId).eq("template_id", t.id);
  if (linkErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: linkErr.message };

  const { error: delErr } = await admin.from("practice_availability_template").delete().eq("id", t.id);
  if (delErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: delErr.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.session_deleted",
    payload: { templateId: t.id, weekday: t.weekday, from: hhmm(t.starts_minute), to: hhmm(t.ends_minute), name: t.session_name },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string, deleted: true } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-V5-007 PHASE 5, s7.7 AND s7.4: WALK-IN RULES
//
// s7.4: "Walk-in limits are separate from booked capacity but contribute to operational workload
// warnings." s4.3 gives a session "Walk-ins allowed -- boolean with optional default limit", which
// migration 240 stored as walk_ins_allowed and walk_in_limit.
//
// ⚠ THE PER-SESSION LIMIT IS STORED AND READ BY NOTHING. checkPlacement enforces only migration 230's
// practice-wide walk_in_daily_limit, per location. So a practitioner who typed "6" against a Tuesday
// clinic has set a number that has never refused anything, and nothing had ever told them so. This
// function resolves the effective limit against real counts and SAYS which of the two is enforced --
// WALK_IN_ENFORCEMENT_NOTE carries that sentence to the screen.
//
// ⚠ IT IS A REPORT, NOT A CONTROL. Making the per-session limit bite means one count inside
// checkPlacement in scheduling.ts, which this build deliberately did not change. A report that implied
// otherwise would be worse than no report: the practitioner would believe a limit was holding.
//
// ⚠ AND THE TWO COUNTS ARE NEVER ADDED. A booked walk-in (practice_appointment, appointment_type
// 'walk_in') and a queued one (practice_queue_entry with no appointment) are different records of
// possibly the same person, and summing them would over-count every walk-in that was queued and then
// given a diary entry. They are reported side by side, each the length of a list.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type WalkInSessionPolicy = {
  sessionId: string;
  sessionName: string;
  locationId: string | null;
  locationName: string | null;
  startsMinute: number;
  endsMinute: number;
  allowed: boolean;
  /** migration 240's per-session limit. Null means none was set, NOT nought. */
  sessionLimit: number | null;
  /** migration 230's practice-wide daily limit for this session's location. Null means none was set. */
  practiceDailyLimit: number | null;
  /**
   * s7.4's stricter-wins, applied to the two limits.
   *
   * ⚠ NULL MEANS NEITHER LIMIT WAS SET, which is "unlimited", and it is a different answer from 0, which
   * is "none allowed". Migration 241's header draws the same distinction for capacity, and it is why
   * both columns are nullable rather than defaulting to nought.
   */
  effectiveLimit: number | null;
  effectiveLimitFrom: "session" | "practice" | "equal" | "none";
  /** ⚠ Whether the winning limit is one anything actually enforces. See the header. */
  effectiveLimitEnforced: boolean;
};

export type WalkInPolicy = {
  date: string;
  timezone: string;
  /** The sessions on `date` that take walk-ins, with their resolved limits. */
  sessions: WalkInSessionPolicy[];
  /** The ones that do not. The other half of "how much of today is open to somebody who just arrives". */
  sessionsClosedToWalkIns: WalkInSessionPolicy[];
  sessionsUnreadable: string | null;
  /**
   * ⚠ THE IDS, NOT A NUMBER. Every figure a screen prints is the length of one of these lists, and each
   * one can be opened. Null where the read failed -- never an empty array standing in for a nought.
   */
  bookedWalkInIds: string[] | null;
  bookedWalkInsUnreadable: string | null;
  queuedWalkInIds: string[] | null;
  queuedWalkInsUnreadable: string | null;
  /** The practice-wide daily limits in force, by location, so the report can name which one bit. */
  practiceDailyLimits: { locationId: string | null; locationName: string | null; limit: number }[];
  practiceDailyLimitsUnreadable: string | null;
  /** What s7.7 asks for that no column holds. Carried to the screen rather than drawn as a control. */
  notConfigurable: readonly { what: string; whyNot: string; wouldNeed: string }[];
  enforcementNote: string;
};

/**
 * s7.7's walk-in rules, resolved for one day.
 *
 * `date` defaults to the practice's own today -- not the server's. A practice in Kampala whose walk-in
 * count reset three hours late would be told it had room it did not have.
 */
export async function walkInPolicy(admin: any, ctx: WorkspaceContext, args: {
  date?: string | null;
} = {}): Promise<WalkInPolicy> {
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = (ws?.timezone as string) || "UTC";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "") ? args.date! : practiceToday(timezone);
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const { startIso, endIso } = zonedDayRange(date, timezone);

  const [templates, locations, rules, booked, queued] = await Promise.all([
    admin.from("practice_availability_template")
      .select("id, session_name, weekday, starts_minute, ends_minute, location_id, activity_type, walk_ins_allowed, walk_in_limit, effective_from, effective_to")
      .eq("workspace_id", ctx.workspaceId).eq("status", "active").eq("weekday", weekday)
      .order("starts_minute"),
    admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId),
    // migration 230's single-row rules, which are the ones checkPlacement actually reads.
    admin.from("practice_booking_rule")
      .select("id, location_id, appointment_type, walk_in_daily_limit, active")
      .eq("workspace_id", ctx.workspaceId).eq("active", true),
    // ⚠ THE IDS, so the figure a screen prints is a list. `walk_in` only: 'emergency' is exempt from the
    // limit for the same reason migration 255 exempts it from the overlap constraint -- an emergency is
    // not a walk-in somebody chose to allow.
    admin.from("practice_appointment").select("id")
      .eq("workspace_id", ctx.workspaceId).eq("appointment_type", "walk_in")
      .in("status", LIVE_APPOINTMENT_STATUSES).gte("scheduled_at", startIso).lt("scheduled_at", endIso),
    admin.from("practice_queue_entry").select("id, appointment_id")
      .eq("workspace_id", ctx.workspaceId).gte("entered_at", startIso).lt("entered_at", endIso),
  ]);

  const locationName = new Map(((locations.data ?? []) as any[]).map(l => [l.id as string, l.name as string]));

  // The practice-wide limit that applies to a location: the row naming that location if there is one,
  // otherwise the practice-wide row. The same precedence resolveBookingRule uses -- and only rows that
  // CARRY a limit, because a rule with a null limit sets no limit rather than a limit of nought.
  const ruleRows = rules.error ? [] : ((rules.data ?? []) as any[]).filter(r => r.walk_in_daily_limit != null);
  const dailyLimitFor = (locationId: string | null): number | null => {
    if (rules.error) return null;
    const exact = ruleRows.find(r => r.location_id === locationId);
    if (exact) return exact.walk_in_daily_limit as number;
    const wide = ruleRows.find(r => r.location_id === null);
    return wide ? (wide.walk_in_daily_limit as number) : null;
  };

  const rows = templates.error ? [] : ((templates.data ?? []) as any[]).filter(t =>
    // The pattern only applies inside its own effective window. A session that ends in March does not
    // take walk-ins in April, and a report ignoring the dates would offer capacity that is gone.
    (!t.effective_from || String(t.effective_from) <= date)
    && (!t.effective_to || String(t.effective_to) >= date));

  const policies: WalkInSessionPolicy[] = rows.map(t => {
    const sessionLimit = (t.walk_in_limit as number | null) ?? null;
    const practiceDailyLimit = dailyLimitFor((t.location_id as string | null) ?? null);

    // s7.4's stricter-wins. Null on either side means that side sets no limit, so the other one stands.
    let effectiveLimit: number | null;
    let effectiveLimitFrom: WalkInSessionPolicy["effectiveLimitFrom"];
    if (sessionLimit === null && practiceDailyLimit === null) { effectiveLimit = null; effectiveLimitFrom = "none"; }
    else if (sessionLimit === null) { effectiveLimit = practiceDailyLimit; effectiveLimitFrom = "practice"; }
    else if (practiceDailyLimit === null) { effectiveLimit = sessionLimit; effectiveLimitFrom = "session"; }
    else if (sessionLimit === practiceDailyLimit) { effectiveLimit = sessionLimit; effectiveLimitFrom = "equal"; }
    else if (sessionLimit < practiceDailyLimit) { effectiveLimit = sessionLimit; effectiveLimitFrom = "session"; }
    else { effectiveLimit = practiceDailyLimit; effectiveLimitFrom = "practice"; }

    return {
      sessionId: t.id as string,
      sessionName: (t.session_name as string | null)
        ?? suggestSessionName({
          locationName: locationName.get(t.location_id as string) ?? null,
          activityType: (t.activity_type as string | null) ?? null,
          weekday: t.weekday as number,
        }),
      locationId: (t.location_id as string | null) ?? null,
      locationName: locationName.get(t.location_id as string) ?? null,
      startsMinute: t.starts_minute as number,
      endsMinute: t.ends_minute as number,
      allowed: !!t.walk_ins_allowed,
      sessionLimit, practiceDailyLimit,
      effectiveLimit, effectiveLimitFrom,
      // ⚠ ONLY THE PRACTICE-WIDE ONE IS ENFORCED. If the session's own number won, nothing checks it.
      effectiveLimitEnforced: effectiveLimitFrom === "practice" || effectiveLimitFrom === "equal",
    };
  });

  return {
    date, timezone,
    sessions: policies.filter(p => p.allowed),
    sessionsClosedToWalkIns: policies.filter(p => !p.allowed),
    sessionsUnreadable: templates.error ? `your sessions could not be read: ${templates.error.message}` : null,
    bookedWalkInIds: booked.error ? null : ((booked.data ?? []) as any[]).map(a => a.id as string),
    bookedWalkInsUnreadable: booked.error ? `today's walk-in appointments could not be counted: ${booked.error.message}` : null,
    // A queue entry that already has an appointment IS that appointment, checked in. Counting it as a
    // second walk-in is the double count this function refuses to make.
    queuedWalkInIds: queued.error ? null
      : ((queued.data ?? []) as any[]).filter(q => !q.appointment_id).map(q => q.id as string),
    queuedWalkInsUnreadable: queued.error ? `today's queue could not be read: ${queued.error.message}` : null,
    practiceDailyLimits: rules.error ? [] : ruleRows.map(r => ({
      locationId: (r.location_id as string | null) ?? null,
      locationName: r.location_id ? (locationName.get(r.location_id as string) ?? null) : null,
      limit: r.walk_in_daily_limit as number,
    })),
    practiceDailyLimitsUnreadable: rules.error ? `your booking rules could not be read: ${rules.error.message}` : null,
    notConfigurable: WALK_IN_NOT_CONFIGURABLE,
    enforcementNote: WALK_IN_ENFORCEMENT_NOTE,
  };
}
