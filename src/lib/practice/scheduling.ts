import { audit } from "@/lib/practice/provisioning";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { resolveBookingRule } from "@/lib/practice/availability-config";
import { bookingBlock } from "@/lib/practice/lifecycle-constants";

// PEN-001 Appointment & Scheduling Engine -- the business rules, separated from every UI that uses them
// (PEN-001 "separate scheduling logic from user interfaces"). CPR-V2-003 V3 is one consumer; the command
// centre widget is another; Phase 3's encounter launch will be a third.
//
// DETERMINISTIC TRANSITIONS (PEN-001 acceptance: "provides deterministic scheduling decisions").
// DM-001 s7 names the states; this map is the single statement of which may follow which. The CHECK
// constraints in migration 192 stop illegal VALUES below any bug here; this map stops illegal MOVES --
// a COMPLETED appointment cannot quietly become CONFIRMED again, and a no-show cannot be marked arrived.
//
// DOUBLE-BOOKING POLICY (PEN-001 "double-booking policies"): by default a new booking that overlaps a
// live appointment is REFUSED. Walk-ins and emergencies may overlap -- a queue exists precisely so that
// unscheduled arrivals do not need a free grid slot -- and an explicit allowOverlap acknowledges a
// deliberate double-book. The check is advisory-locked by re-query rather than a DB exclusion
// constraint, which the migration runner cannot express; the harness exercises the refusal.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const APPOINTMENT_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ARRIVED", "NO_SHOW", "CANCELLED"],
  ARRIVED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const QUEUE_TRANSITIONS: Record<string, string[]> = {
  WAITING: ["READY", "IN_CONSULTATION", "LEFT"],
  READY: ["IN_CONSULTATION", "WAITING", "LEFT"],
  IN_CONSULTATION: ["PAUSED", "COMPLETED"],
  PAUSED: ["IN_CONSULTATION", "COMPLETED"],
  COMPLETED: [],
  LEFT: [],
};

export const canTransition = (map: Record<string, string[]>, from: string, to: string) =>
  (map[from] ?? []).includes(to);

/** The types PEN-001 permits to overlap an existing booking without an explicit override. */
const OVERLAP_EXEMPT = ["walk_in", "emergency"];

export type BookInput = {
  workspaceId: string;
  /** Registry link (Phase 2). When present it is VERIFIED against the workspace and the registry's
   *  display name is written to the diary -- the appointment can never claim a name the registry
   *  does not hold for that patient. */
  patientId?: string | null;
  patientName: string;
  patientPhone?: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes?: number;
  locationId?: string | null;
  reason?: string;
  allowOverlap?: boolean;
  actorId: string;
  correlationId: string;
};

export type EngineResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** Live = holds or will hold the diary slot. Terminal states never block a booking. */
const LIVE_STATUSES = ["REQUESTED", "CONFIRMED", "ARRIVED"];

/**
 * CAN AN APPOINTMENT SIT HERE, AT THIS TIME, IN THIS PLACE?
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * SHARED BY BOOKING AND RESCHEDULING, DELIBERATELY.
 *
 * Drag-and-drop is a second way to put an appointment somewhere, and the moment it has its own copy of
 * these rules the two start to drift: someone fixes the travel check in one and a drag quietly bypasses
 * everything a booking refuses. A calendar where dragging is permitted to do what typing is not is
 * worse than one with no dragging at all, because the practitioner believes both were checked.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `excludeAppointmentId` keeps an appointment from colliding with ITSELF when it is being moved a few
 * minutes -- without it every drag onto an overlapping time would refuse, naming the very appointment
 * in the practitioner's hand.
 *
 * ⚠ `windowOverridden` EXISTS BECAUSE THE WINDOW IS CHECKED TWICE AND ONLY ONE CHECKER KNOWS ABOUT s14.
 * booking-rules.ts decides the lead time and the horizon from s11's own ladder, and s14 lets an
 * authorised person lift that refusal WITH A REASON THAT IS WRITTEN TO THE AUDIT TRAIL FIRST. Since
 * migration 245 those card rules carry `active` again, so resolveBookingRule below usually resolves the
 * very same row and would refuse the booking a second time on the same ground -- leaving a record of an
 * override that produced nothing. Naming the codes already lifted suppresses THOSE TWO CHECKS ONLY and
 * lets everything after them run: an override of the notice period must never become an override of the
 * double-booking check. Callers that pass nothing are unchanged in every respect.
 */
export async function checkPlacement(admin: any, args: {
  workspaceId: string; startMs: number; endMs: number;
  locationId: string | null; appointmentType: string; allowOverlap: boolean;
  excludeAppointmentId?: string;
  windowOverridden?: string[];
}): Promise<EngineResult<{ locationName: string | null }>> {
  // ── CPR-LIFE-001 s2 AND s10: AN ARCHIVED, SUSPENDED OR CLOSED PRACTICE TAKES NO BOOKINGS ─────────
  //
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠ FIRST, AND HERE, BECAUSE THIS IS THE ONE PLACE EVERY BOOKING PASSES THROUGH.
  //
  // Four callers put an appointment into a diary -- bookAppointment, rescheduleAppointment,
  // bookUnderRules and registration's book-on-register -- and all four come through checkPlacement.
  // Putting the check in any of them individually is how a drag-and-drop quietly books into a practice
  // that a typed booking is refused from, which is the exact failure this function's own header warns
  // about for the travel rule.
  //
  // Until this line, s10's "Closed practices cannot receive bookings" was FALSE: setting a workspace to
  // CLOSED by hand stopped nothing. This is the change that makes the state mean something.
  //
  // ⚠ AND AN UNREADABLE STATUS REFUSES. A booking made while nobody could tell whether the practice was
  // archived is the thing this check exists to prevent; treating a failed read as "open" would be the
  // two-state version of a three-state answer.
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  const { data: practice, error: practiceError } = await admin.from("practice_workspace")
    .select("status").eq("id", args.workspaceId).maybeSingle();
  if (!practiceError && !practice)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  const blocked = bookingBlock(practiceError ? null : (practice?.status as string | null));
  if (blocked)
    return { ok: false, status: 409, code: blocked.code, message: blocked.message };

  // THE LOCATION IS VALIDATED, WHICH IT NEVER WAS. location_id has been written straight through since
  // migration 192, so a booking could name ANOTHER PRACTICE'S location -- a cross-tenant reference that
  // nothing would ever have noticed, because no screen joined to it until the calendar did.
  let here: { id: string; name: string; travel_buffer_minutes: number } | null = null;
  if (args.locationId) {
    const { data: loc } = await admin.from("practice_location")
      .select("id, name, active, travel_buffer_minutes")
      .eq("id", args.locationId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (!loc.active) return { ok: false, status: 422, code: "LOCATION_CLOSED", message: `${loc.name} is closed` };
    here = loc;
  }

  // ── CPR-SET-002 BOOKING RULES ────────────────────────────────────────────────────────────────────
  //
  // Applied BEFORE the overlap exemption, deliberately. A walk-in is exempt from double-booking because
  // a queue exists precisely so unscheduled arrivals need no free grid slot -- that says nothing about
  // whether a practice caps walk-ins per day, which is the one rule written FOR walk-ins.
  //
  // Lead time and the booking horizon are skipped for walk-ins and emergencies: a walk-in by definition
  // arrives without notice, and requiring an emergency to be booked a day ahead is a contradiction.
  const rule = await resolveBookingRule(admin, args.workspaceId, args.locationId ?? null, args.appointmentType);
  const wherePhrase = rule.source === "default" || rule.source === "practice"
    ? "your practice's booking rule" : `the booking rule for this ${rule.source.replace("+", " and ")}`;

  const lifted = args.windowOverridden ?? [];
  if (!OVERLAP_EXEMPT.includes(args.appointmentType)) {
    if (!lifted.includes("LEAD_TIME")
      && rule.leadTimeMinutes > 0 && args.startMs < Date.now() + rule.leadTimeMinutes * 60000)
      return {
        ok: false, status: 409, code: "LEAD_TIME",
        message: `${wherePhrase} needs ${rule.leadTimeMinutes} minutes' notice, and that time is sooner than that`,
      };
    if (!lifted.includes("BEYOND_HORIZON")
      && rule.bookingHorizonDays !== null && args.startMs > Date.now() + rule.bookingHorizonDays * 86400000)
      return {
        ok: false, status: 409, code: "BEYOND_HORIZON",
        message: `${wherePhrase} opens the diary ${rule.bookingHorizonDays} days ahead, and that date is further out`,
      };
  }

  // THE ONE RULE THAT IS ABOUT WALK-INS, so it runs for them. Null means no limit; ZERO MEANS ZERO,
  // which is why the column is nullable rather than defaulting to nought.
  if (args.appointmentType === "walk_in" && rule.walkInDailyLimit !== null) {
    const { data: ws } = await admin.from("practice_workspace")
      .select("timezone").eq("id", args.workspaceId).maybeSingle();
    const { startIso, endIso } = zonedDayRange(practiceToday(ws?.timezone ?? "UTC", new Date(args.startMs)), ws?.timezone ?? "UTC");
    let q = admin.from("practice_appointment").select("*", { count: "exact", head: true })
      .eq("workspace_id", args.workspaceId).eq("appointment_type", "walk_in")
      .in("status", LIVE_STATUSES).gte("scheduled_at", startIso).lt("scheduled_at", endIso);
    if (args.locationId) q = q.eq("location_id", args.locationId);
    const { count, error: countError } = await q;
    // A COUNT THAT FAILED IS NOT A COUNT OF NOUGHT. Refusing to guess here rather than waving the
    // booking through on a read error -- the limit exists because somebody meant it.
    if (countError)
      return { ok: false, status: 500, code: "READ_FAILED", message: `could not count today's walk-ins: ${countError.message}` };
    if ((count ?? 0) >= rule.walkInDailyLimit)
      return {
        ok: false, status: 409, code: "WALK_IN_LIMIT",
        message: `${wherePhrase} allows ${rule.walkInDailyLimit} walk-ins a day here, and there ${(count ?? 0) === 1 ? "is" : "are"} already ${count ?? 0}`,
      };
  }

  if (args.allowOverlap || OVERLAP_EXEMPT.includes(args.appointmentType))
    return { ok: true, data: { locationName: here?.name ?? null } };

  // Double-booking check against live appointments in the surrounding window.
  const windowStart = new Date(args.startMs - 480 * 60000).toISOString();
  const windowEnd = new Date(args.endMs + 480 * 60000).toISOString();
  const { data: nearby } = await admin.from("practice_appointment")
    .select("id, scheduled_at, duration_minutes, location_id")
    .eq("workspace_id", args.workspaceId).in("status", LIVE_STATUSES)
    .gte("scheduled_at", windowStart).lt("scheduled_at", windowEnd);
  const rows = ((nearby ?? []) as any[]).filter(a => a.id !== args.excludeAppointmentId);

  const clash = rows.some(a => {
    const aStart = Date.parse(a.scheduled_at);
    const aEnd = aStart + (a.duration_minutes ?? 20) * 60000;
    return aStart < args.endMs && aEnd > args.startMs;
  });
  if (clash) return { ok: false, status: 409, code: "DOUBLE_BOOKED", message: "this time overlaps a live appointment; pass allowOverlap to double-book deliberately" };

  // ── THE CONFLICT THAT ONLY EXISTS ONCE THERE IS MORE THAN ONE HOSPITAL ──────────────────────────
  //
  // 09:00 at Hospital A and 09:30 at Hospital B do not overlap, so the check above passes them happily
  // -- and nobody can be in two hospitals half an hour apart. Whoever accepts both will be late for
  // one, and the patient at the second waits without being told why.
  if (args.locationId && here) {
    const elsewhere = rows.filter(a => a.location_id && a.location_id !== args.locationId);
    if (elsewhere.length > 0) {
      const otherIds = [...new Set(elsewhere.map(a => a.location_id))];
      const { data: others } = await admin.from("practice_location")
        .select("id, name, travel_buffer_minutes").in("id", otherIds);
      const otherById = new Map(((others ?? []) as any[]).map(o => [o.id, o]));

      for (const a of elsewhere) {
        const aStart = Date.parse(a.scheduled_at);
        const aEnd = aStart + (a.duration_minutes ?? 20) * 60000;
        const other = otherById.get(a.location_id);
        // The buffer belongs to whichever place is being travelled TO.
        const gapBefore = (args.startMs - aEnd) / 60000;   // the other one first, then this
        const gapAfter = (aStart - args.endMs) / 60000;    // this one first, then the other
        const needBefore = here.travel_buffer_minutes;
        const needAfter = other?.travel_buffer_minutes ?? 30;

        if (gapBefore >= 0 && gapBefore < needBefore)
          return {
            ok: false, status: 409, code: "TRAVEL_CONFLICT",
            message: `there is only ${Math.round(gapBefore)} minutes between ${other?.name ?? "another location"} and ${here.name}, which needs ${needBefore}`,
          };
        if (gapAfter >= 0 && gapAfter < needAfter)
          return {
            ok: false, status: 409, code: "TRAVEL_CONFLICT",
            message: `this would leave only ${Math.round(gapAfter)} minutes to reach ${other?.name ?? "another location"}, which needs ${needAfter}`,
          };
      }
    }
  }

  return { ok: true, data: { locationName: here?.name ?? null } };
}

export async function bookAppointment(admin: any, input: BookInput): Promise<EngineResult<{ id: string; status: string }>> {
  // CPR-360. The fallback used to be a hardcoded 20 here and in the overlap check below, so a practice
  // whose consultations run half an hour had been fighting that number since Phase 1. It now comes from
  // the workspace's own configuration -- and the literal survives only as the value for a workspace
  // whose configuration row is somehow missing, which is a state getConfiguration() repairs on sight.
  const duration = input.durationMinutes ?? await defaultAppointmentMinutes(admin, input.workspaceId);
  const startMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(startMs)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "scheduledAt is not a valid timestamp" };
  const endMs = startMs + duration * 60000;

  // Registry-linked booking: the patient must exist, in THIS workspace, and be active; the diary then
  // carries the registry's name, not the caller's spelling of it.
  let patientName = input.patientName?.trim();
  if (input.patientId) {
    const { data: patient } = await admin.from("practice_patient")
      .select("id, display_name, status").eq("id", input.patientId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (patient.status !== "active") return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };
    patientName = patient.display_name;
  }
  if (!patientName) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "patientName or patientId is required" };

  const placed = await checkPlacement(admin, {
    workspaceId: input.workspaceId, startMs, endMs,
    locationId: input.locationId ?? null, appointmentType: input.appointmentType,
    allowOverlap: input.allowOverlap === true,
  });
  if (!placed.ok) return placed;

  // Walk-ins arrive by definition: they enter as CONFIRMED and are checked in immediately by the caller.
  const initialStatus = input.appointmentType === "walk_in" ? "CONFIRMED" : "REQUESTED";

  const { data: appt, error } = await admin.from("practice_appointment").insert({
    workspace_id: input.workspaceId, location_id: input.locationId ?? null,
    patient_id: input.patientId ?? null,
    patient_name: patientName, patient_phone: input.patientPhone?.trim() || null,
    appointment_type: input.appointmentType, scheduled_at: new Date(startMs).toISOString(),
    duration_minutes: duration, status: initialStatus, reason: input.reason ?? null,
    created_by: input.actorId,
  }).select("id, status").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: input.workspaceId, actorId: input.actorId, eventType: "practice.appointment_booked",
    payload: { appointmentId: appt.id, type: input.appointmentType }, correlationId: input.correlationId,
  });
  return { ok: true, data: { id: appt.id as string, status: appt.status as string } };
}

/**
 * MOVE AN APPOINTMENT: a different time, a different length, a different hospital, or all three.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THIS DID NOT EXIST. The state machine could only change an appointment's STATUS -- nothing in the
 * product had ever moved one in time. The calendar footer has been claiming "Every change audited. Who
 * moved what, and when" over a build where moving was impossible.
 *
 * Written for drag-and-drop, and therefore written defensively: a drag is a fast, imprecise gesture
 * that a practitioner makes with one hand while talking to somebody, and it must not be able to do
 * anything typing could not.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `expectedVersion` is optimistic concurrency and matters more here than anywhere else in this product:
 * a calendar is left open on a screen for hours, so the appointment in the practitioner's hand may have
 * been cancelled, moved or completed by the front desk since the page loaded. Dragging a stale copy
 * would silently resurrect the old time.
 */
export async function rescheduleAppointment(admin: any, args: {
  workspaceId: string; appointmentId: string;
  scheduledAt?: string; durationMinutes?: number; locationId?: string | null;
  allowOverlap?: boolean; expectedVersion?: number;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{
  id: string; scheduledAt: string; durationMinutes: number; locationId: string | null;
  from: { scheduledAt: string; durationMinutes: number; locationId: string | null };
  recordVersion: number;
}>> {
  const { data: appt, error: readError } = await admin.from("practice_appointment")
    .select("id, scheduled_at, duration_minutes, location_id, status, appointment_type, record_version, workspace_id")
    .eq("id", args.appointmentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (readError)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the appointment: ${readError.message}` };
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.expectedVersion !== undefined && args.expectedVersion !== appt.record_version)
    return {
      ok: false, status: 409, code: "STALE",
      message: "this appointment changed since the calendar was loaded; reload before moving it",
    };

  // A TERMINAL APPOINTMENT IS HISTORY, not a thing with a future time. Rescheduling one would rewrite
  // what happened rather than plan what will.
  if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appt.status))
    return {
      ok: false, status: 422, code: "NOT_RESCHEDULABLE",
      message: `this appointment is ${appt.status.toLowerCase()} and cannot be moved; book a new one instead`,
    };
  // ARRIVED means the patient is standing there. Moving their appointment is not what is happening --
  // either they are being seen, or they are being sent away, and the second is a cancellation.
  if (appt.status === "ARRIVED")
    return {
      ok: false, status: 422, code: "PATIENT_PRESENT",
      message: "this patient has already arrived; cancel and rebook if they are being sent away",
    };

  const duration = args.durationMinutes ?? appt.duration_minutes;
  if (!Number.isInteger(duration) || duration < 5 || duration > 480)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an appointment runs between 5 and 480 minutes" };

  const startMs = args.scheduledAt ? Date.parse(args.scheduledAt) : Date.parse(appt.scheduled_at);
  if (Number.isNaN(startMs))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "scheduledAt is not a valid timestamp" };
  const endMs = startMs + duration * 60000;

  const locationId = args.locationId !== undefined ? args.locationId : appt.location_id;

  // NOTHING CHANGED is refused rather than written, so a drag that lands back where it started does not
  // leave an audit entry saying an appointment moved when it did not.
  const same = startMs === Date.parse(appt.scheduled_at)
    && duration === appt.duration_minutes
    && (locationId ?? null) === (appt.location_id ?? null);
  if (same) return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  // ── A DAY THAT HAS ALREADY BEEN ────────────────────────────────────────────────────────────────
  //
  // You cannot schedule somebody to have already been seen. Compared at DAY granularity in the
  // practice's own timezone, not against a clock: "before today" is a judgement a practitioner shares,
  // whereas "three minutes ago" would refuse a perfectly ordinary drag into the current hour.
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", args.workspaceId).maybeSingle();
  const tz = ws?.timezone ?? "UTC";
  const targetDay = practiceToday(tz, new Date(startMs));
  const today = practiceToday(tz);
  if (targetDay < today)
    return {
      ok: false, status: 422, code: "IN_THE_PAST",
      message: `${targetDay} has already been; an appointment cannot be moved into a day that is over`,
    };

  const placed = await checkPlacement(admin, {
    workspaceId: args.workspaceId, startMs, endMs, locationId: locationId ?? null,
    appointmentType: appt.appointment_type, allowOverlap: args.allowOverlap === true,
    excludeAppointmentId: appt.id,   // an appointment must not collide with itself
  });
  if (!placed.ok) return placed;

  // The version is part of the WHERE, so two people dragging the same appointment at the same moment
  // cannot both win -- the second update matches no row and is reported as stale rather than silently
  // overwriting the first.
  const { data: updated, error } = await admin.from("practice_appointment")
    .update({
      scheduled_at: new Date(startMs).toISOString(), duration_minutes: duration,
      location_id: locationId ?? null,
      record_version: appt.record_version + 1, updated_at: new Date().toISOString(), updated_by: args.actorId,
    })
    .eq("id", appt.id).eq("record_version", appt.record_version)
    .select("id, scheduled_at, duration_minutes, location_id, record_version").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!updated)
    return {
      ok: false, status: 409, code: "STALE",
      message: "this appointment was changed by someone else while it was being moved; reload and try again",
    };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.appointment_rescheduled",
    payload: {
      appointmentId: appt.id,
      from: { scheduledAt: appt.scheduled_at, durationMinutes: appt.duration_minutes, locationId: appt.location_id },
      to: { scheduledAt: updated.scheduled_at, durationMinutes: updated.duration_minutes, locationId: updated.location_id },
      // A deliberate double-book is the fact most worth being able to find afterwards.
      forced: args.allowOverlap === true,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      id: updated.id, scheduledAt: updated.scheduled_at, durationMinutes: updated.duration_minutes,
      locationId: updated.location_id,
      from: { scheduledAt: appt.scheduled_at, durationMinutes: appt.duration_minutes, locationId: appt.location_id },
      recordVersion: updated.record_version,
    },
  };
}

/**
 * Move an appointment along the state machine. `arrive` also writes the arrival record and puts the
 * patient in the waiting queue -- one action at the desk, three facts in the record (CPR-V2-003 workflow).
 */
export async function transitionAppointment(admin: any, args: {
  workspaceId: string; appointmentId: string; to: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; queueEntryId?: string }>> {
  const { data: appt } = await admin.from("practice_appointment")
    .select("id, status, patient_name, record_version")
    .eq("id", args.appointmentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!canTransition(APPOINTMENT_TRANSITIONS, appt.status, args.to)) {
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${appt.status} cannot become ${args.to}` };
  }

  // Optimistic concurrency: the update carries the version we read, so two desks acting at once cannot
  // both win silently (DM-001 s16 "use optimistic concurrency").
  const { data: updated } = await admin.from("practice_appointment")
    .update({ status: args.to, record_version: appt.record_version + 1, updated_at: new Date().toISOString(), updated_by: args.actorId })
    .eq("id", appt.id).eq("record_version", appt.record_version).select("id").maybeSingle();
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the appointment changed underneath you; reload and retry" };

  let queueEntryId: string | undefined;
  if (args.to === "ARRIVED") {
    // CHECK-THEN-INSERT, NOT UPSERT. The arrival's uniqueness lives in a PARTIAL unique index
    // (one live arrival, cancelled ones excluded), and ON CONFLICT cannot target a partial index
    // through PostgREST -- the upsert this used to be failed with "no matching constraint" and the
    // error was swallowed, so NO arrival was ever written. The harness caught it before it shipped.
    // The partial index still backstops the race: if two check-ins pass the check simultaneously,
    // the second insert fails loudly here instead of silently duplicating.
    const { data: liveArrival } = await admin.from("practice_arrival")
      .select("id").eq("appointment_id", appt.id).neq("status", "CANCELLED").maybeSingle();
    if (!liveArrival) {
      const { error: arrErr } = await admin.from("practice_arrival").insert({
        workspace_id: args.workspaceId, appointment_id: appt.id, created_by: args.actorId,
      });
      if (arrErr && !/duplicate|unique/i.test(arrErr.message)) {
        return { ok: false, status: 502, code: "ARRIVAL_WRITE_FAILED", message: arrErr.message };
      }
    }
    const { data: q } = await admin.from("practice_queue_entry").insert({
      workspace_id: args.workspaceId, appointment_id: appt.id, patient_name: appt.patient_name,
    }).select("id").single();
    queueEntryId = q?.id;
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.appointment_${args.to.toLowerCase()}`,
    payload: { appointmentId: appt.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.to, queueEntryId } };
}

export async function transitionQueueEntry(admin: any, args: {
  workspaceId: string; entryId: string; to: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: entry } = await admin.from("practice_queue_entry")
    .select("id, status").eq("id", args.entryId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!entry) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!canTransition(QUEUE_TRANSITIONS, entry.status, args.to)) {
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${entry.status} cannot become ${args.to}` };
  }

  const patch: Record<string, unknown> = { status: args.to, updated_at: new Date().toISOString() };
  if (args.to === "IN_CONSULTATION" && entry.status !== "PAUSED") patch.started_at = new Date().toISOString();
  if (args.to === "COMPLETED" || args.to === "LEFT") patch.completed_at = new Date().toISOString();
  await admin.from("practice_queue_entry").update(patch).eq("id", entry.id);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.queue_${args.to.toLowerCase()}`,
    payload: { entryId: entry.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.to } };
}

/** The day's diary plus the live queue -- what CPR-V2-003's Today panel and CPR-V2-001's widget both read. */
export async function loadDay(admin: any, workspaceId: string, dayIso: string) {
  const dayStart = `${dayIso}T00:00:00.000Z`;
  const dayEnd = `${dayIso}T23:59:59.999Z`;
  const [{ data: appointments }, { data: queue }, { data: blocks }] = await Promise.all([
    admin.from("practice_appointment")
      // patient_id is selected because the calendar can only offer "Start encounter" for a diary entry
      // that is actually linked to a registered patient -- a name-only booking has no record to write to.
      .select("id, patient_id, patient_name, patient_phone, appointment_type, scheduled_at, duration_minutes, status, reason")
      .eq("workspace_id", workspaceId).gte("scheduled_at", dayStart).lte("scheduled_at", dayEnd)
      .order("scheduled_at"),
    admin.from("practice_queue_entry")
      .select("id, patient_name, status, entered_at, appointment_id")
      .eq("workspace_id", workspaceId).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"])
      .order("entered_at"),
    admin.from("practice_availability_slot")
      .select("id, starts_at, ends_at, status, note")
      .eq("workspace_id", workspaceId).gte("starts_at", dayStart).lte("starts_at", dayEnd)
      .order("starts_at"),
  ]);
  return { appointments: appointments ?? [], queue: queue ?? [], blocks: blocks ?? [] };
}
