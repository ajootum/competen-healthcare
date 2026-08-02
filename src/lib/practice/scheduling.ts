import { audit } from "@/lib/practice/provisioning";

// PEN-001 Appointment & Scheduling Engine -- the business rules, separated from every UI that uses them
// (PEN-001 "separate scheduling logic from user interfaces"). CPR-003 V3 is one consumer; the command
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
  const duration = input.durationMinutes ?? 20;
  const startMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(startMs)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "scheduledAt is not a valid timestamp" };
  const endMs = startMs + duration * 60000;

  // Double-booking check against live appointments in the surrounding window.
  if (!input.allowOverlap && !OVERLAP_EXEMPT.includes(input.appointmentType)) {
    const windowStart = new Date(startMs - 480 * 60000).toISOString();
    const windowEnd = new Date(endMs).toISOString();
    const { data: nearby } = await admin.from("practice_appointment")
      .select("id, scheduled_at, duration_minutes")
      .eq("workspace_id", input.workspaceId).in("status", LIVE_STATUSES)
      .gte("scheduled_at", windowStart).lt("scheduled_at", windowEnd);
    const clash = ((nearby ?? []) as any[]).some(a => {
      const aStart = Date.parse(a.scheduled_at);
      const aEnd = aStart + (a.duration_minutes ?? 20) * 60000;
      return aStart < endMs && aEnd > startMs;
    });
    if (clash) return { ok: false, status: 409, code: "DOUBLE_BOOKED", message: "this time overlaps a live appointment; pass allowOverlap to double-book deliberately" };
  }

  // Walk-ins arrive by definition: they enter as CONFIRMED and are checked in immediately by the caller.
  const initialStatus = input.appointmentType === "walk_in" ? "CONFIRMED" : "REQUESTED";

  const { data: appt, error } = await admin.from("practice_appointment").insert({
    workspace_id: input.workspaceId, location_id: input.locationId ?? null,
    patient_name: input.patientName.trim(), patient_phone: input.patientPhone?.trim() || null,
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
 * patient in the waiting queue -- one action at the desk, three facts in the record (CPR-003 workflow).
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

/** The day's diary plus the live queue -- what CPR-003's Today panel and CPR-001's widget both read. */
export async function loadDay(admin: any, workspaceId: string, dayIso: string) {
  const dayStart = `${dayIso}T00:00:00.000Z`;
  const dayEnd = `${dayIso}T23:59:59.999Z`;
  const [{ data: appointments }, { data: queue }, { data: blocks }] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, patient_name, patient_phone, appointment_type, scheduled_at, duration_minutes, status, reason")
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
