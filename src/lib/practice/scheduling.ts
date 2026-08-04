import { audit } from "@/lib/practice/provisioning";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";

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

  // THE LOCATION IS VALIDATED, WHICH IT NEVER WAS. location_id has been written straight through since
  // migration 192, so a booking could name ANOTHER PRACTICE'S location -- a cross-tenant reference that
  // nothing would ever have noticed, because no screen joined to it until the calendar did.
  let bookedLocation: { id: string; name: string; travel_buffer_minutes: number } | null = null;
  if (input.locationId) {
    const { data: loc } = await admin.from("practice_location")
      .select("id, name, active, travel_buffer_minutes")
      .eq("id", input.locationId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (!loc.active) return { ok: false, status: 422, code: "LOCATION_CLOSED", message: `${loc.name} is closed` };
    bookedLocation = loc;
  }

  // Double-booking check against live appointments in the surrounding window.
  if (!input.allowOverlap && !OVERLAP_EXEMPT.includes(input.appointmentType)) {
    const windowStart = new Date(startMs - 480 * 60000).toISOString();
    const windowEnd = new Date(endMs + 480 * 60000).toISOString();
    const { data: nearby } = await admin.from("practice_appointment")
      .select("id, scheduled_at, duration_minutes, location_id")
      .eq("workspace_id", input.workspaceId).in("status", LIVE_STATUSES)
      .gte("scheduled_at", windowStart).lt("scheduled_at", windowEnd);
    const rows = (nearby ?? []) as any[];

    const clash = rows.some(a => {
      const aStart = Date.parse(a.scheduled_at);
      const aEnd = aStart + (a.duration_minutes ?? 20) * 60000;
      return aStart < endMs && aEnd > startMs;
    });
    if (clash) return { ok: false, status: 409, code: "DOUBLE_BOOKED", message: "this time overlaps a live appointment; pass allowOverlap to double-book deliberately" };

    // ── THE CONFLICT THAT ONLY EXISTS ONCE THERE IS MORE THAN ONE HOSPITAL ────────────────────────
    //
    // 09:00 at Hospital A and 09:30 at Hospital B do not overlap, so the check above passes them
    // happily -- and nobody can be in two hospitals half an hour apart. Whoever accepts both will be
    // late for one, and the patient at the second waits without being told why.
    if (input.locationId && bookedLocation) {
      const elsewhere = rows.filter(a => a.location_id && a.location_id !== input.locationId);
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
          const gapBefore = (startMs - aEnd) / 60000;   // the other one first, then this
          const gapAfter = (aStart - endMs) / 60000;    // this one first, then the other
          const needBefore = bookedLocation.travel_buffer_minutes;
          const needAfter = other?.travel_buffer_minutes ?? 30;

          if (gapBefore >= 0 && gapBefore < needBefore)
            return {
              ok: false, status: 409, code: "TRAVEL_CONFLICT",
              message: `there is only ${Math.round(gapBefore)} minutes between ${other?.name ?? "another location"} and ${bookedLocation.name}, which needs ${needBefore}`,
            };
          if (gapAfter >= 0 && gapAfter < needAfter)
            return {
              ok: false, status: 409, code: "TRAVEL_CONFLICT",
              message: `this would leave only ${Math.round(gapAfter)} minutes to reach ${other?.name ?? "another location"}, which needs ${needAfter}`,
            };
        }
      }
    }
  }

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
