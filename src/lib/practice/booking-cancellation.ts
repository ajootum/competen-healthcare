import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";
import { transitionAppointment, APPOINTMENT_TRANSITIONS } from "@/lib/practice/scheduling";
import { resolveBookingRule } from "@/lib/practice/availability-config";
import {
  WAITING_LIST_STATUS_CODES, WAITING_LIST_STATUSES_LIVE, WAITING_LIST_CONTACT_NOTE,
} from "@/lib/practice/booking-rule-constants";
import { BOOKING_RULE_MIGRATION_269, sectionAbsentNote } from "@/lib/practice/booking-rules";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s7.2's CANCELLATIONS SECTION -- MIGRATIONS 268 AND 269.
//
// s7.2 lists the section's responsibility as "Cancellation notice, self-reschedule, DNA and waiting-list
// release", and the section was captioned NOT BUILT with the sentence "the notice period is stored from
// before the card model and reported, NEVER USED TO REFUSE A CANCELLATION".
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THAT SENTENCE WAS HALF WRONG, AND THE HALF THAT WAS WRONG IS WHY THIS FILE IS SHAPED AS IT IS.
//
// The notice period ALREADY refused a cancellation, and had since the manage path was written:
// patient-booking.ts's manageGate resolves cancellation_notice_minutes and cancelManagedBooking returns
// CANCEL_NOT_ALLOWED on it. What was true is that nothing refused a PRACTICE-SIDE cancellation.
//
// ⚠ AND NOTHING SHOULD. RuleWorkspace.tsx has carried the reason on screen since Phase 3: "a practice
// that cannot cancel a booking because of a policy setting is a practice with a wrong diary." A notice
// period is a promise a practice makes to its patients about what THEY may do at short notice. Turning
// it round to refuse the practitioner would mean a clinician who has been called to theatre cannot take
// an appointment out of their own diary, and the patient turns up to an empty room.
//
// So this file does NOT add a refusal for the practice. It adds the three things the section was
// genuinely missing:
//
//   1. WHAT A CANCELLATION RECORDS. Who cancelled, why, and whether it was inside the notice. Until
//      migration 269 practice_appointment held a status and nothing else, and cancelManagedBooking said
//      out loud that a patient's reason "has nowhere to go". It has somewhere to go now.
//   2. DNA. A missed appointment is already a status. What did not exist was the practice's own rule
//      about what happens after several -- which lives on the rule and bites inside evaluateBooking,
//      not here. This file records the miss and reports where the patient now stands against it.
//   3. THE WAITING LIST, which had no schema at all.
//
// ---- ⚠ THE ONE THING THIS FILE WILL NOT DO ---------------------------------------------------------
//
// IT WILL NOT SUGGEST THAT ANYBODY HAS BEEN TOLD ANYTHING. Nothing in this product sends a message to a
// patient. A waiting list is the feature in this whole area most likely to be believed into existence --
// "we'll let you know" is what a waiting list MEANS -- so `offer` records an offer and says, in the
// return value and on the screen, that somebody has to ring them. WAITING_LIST_CONTACT_NOTE is that
// sentence, exported once so the engine, the screen and the harness cannot drift.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: string };

const nowIso = () => new Date().toISOString();

export const WAITING_LIST_TABLE = "practice_waiting_list_entry";

/** PostgREST's schema-cache miss and Postgres's undefined-table. Both mean 269 is not applied. */
const MISSING = new Set(["PGRST204", "PGRST205", "PGRST202", "42703", "42P01"]);
const isMissing = (error: any) =>
  !!error && (MISSING.has(String(error.code))
    || /could not find the (table|column)|does not exist/i.test(String(error.message ?? "")));

let store269: boolean | null | undefined;

/**
 * ⚠ THREE ANSWERS, AND `null` IS THE ONE THAT MATTERS. `true` the store is there, `false` migration 269
 * has not been applied, `null` NOBODY COULD TELL -- and only the second of those is a reason to draw an
 * empty waiting list. An outage drawn as "no store" would tell a practice its list had never existed.
 *
 * ⚠ NOT head+count. A missing table and an empty table both come back with a null count, and reading
 * that as "missing" is the trap that produced four wrong answers in the survey this build follows. The
 * error CODE is the only thing that tells them apart.
 */
export async function waitingListStorePresent(admin: any): Promise<boolean | null> {
  if (store269 !== undefined) return store269;
  const { error } = await admin.from(WAITING_LIST_TABLE).select("id").limit(1);
  if (!error) { store269 = true; return true; }
  if (isMissing(error)) { store269 = false; return false; }
  return null; // ⚠ deliberately not cached: an outage must not pin this process for its whole life.
}

/** Test seam. The harness applies a migration underneath a live process and must not read a stale yes. */
export function forgetWaitingListStore() { store269 = undefined; }

const storeAbsent = <T>(what: string): EngineResult<T> => ({
  ok: false, status: 503, code: "STORE_ABSENT",
  message: sectionAbsentNote(what, BOOKING_RULE_MIGRATION_269),
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. CANCELLING -- WHAT IT RECORDS, AND WHO IT MAY REFUSE
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type CancellationOutcome = {
  appointmentId: string;
  status: string;
  /** 'patient' or 'practice'. The two are different acts and the column keeps them apart. */
  actorKind: "patient" | "practice";
  /** ⚠ NULL when migration 269 is not applied, which is not the same as "it was outside the notice". */
  withinNotice: boolean | null;
  noticeMinutes: number;
  reasonStored: boolean;
  /** Said out loud when the reason could not be stored, rather than dropped. */
  reasonNote: string | null;
  /** Whoever the freed time could be offered to. Empty is a real answer; null means it could not be read. */
  waitingList: { id: string; patientName: string; note: string | null }[] | null;
  waitingListNote: string;
};

/**
 * Cancel an appointment on the PRACTICE's side, and record what a status alone cannot say.
 *
 * ⚠ IT NEVER REFUSES ON THE NOTICE PERIOD. See this file's header. `withinNotice` is RECORDED so that a
 * practice can see how often it cancels late on its own patients -- which is a thing worth knowing and a
 * different thing from a rule.
 *
 * ⚠ THE STATE MACHINE STILL DECIDES WHETHER THE MOVE IS LEGAL. transitionAppointment owns
 * APPOINTMENT_TRANSITIONS, the optimistic-concurrency token and the audit line, and this function does
 * not re-implement one of them -- a second cancellation path is the drift this codebase has a scar from.
 */
export async function cancelBooking(admin: any, ctx: WorkspaceContext, args: {
  appointmentId: string;
  reason?: string | null;
  actorKind?: "patient" | "practice";
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<CancellationOutcome>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const { data: appt, error } = await admin.from("practice_appointment")
    .select("id, status, scheduled_at, location_id, appointment_type, patient_id")
    .eq("id", args.appointmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 503, code: "READ_FAILED", message: `the appointment could not be read: ${error.message}` };
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!(APPOINTMENT_TRANSITIONS[String(appt.status)] ?? []).includes("CANCELLED"))
    return {
      ok: false, status: 422, code: "ILLEGAL_TRANSITION",
      message: `this appointment is ${String(appt.status).toLowerCase().replace(/_/g, " ")}, so it cannot be cancelled.`,
    };

  const rule = await resolveBookingRule(admin, ctx.workspaceId,
    (appt.location_id as string | null) ?? null, String(appt.appointment_type));
  // ⚠ AN UNREADABLE RULE DOES NOT STOP A PRACTICE CANCELLING. It stops this function CLAIMING whether
  // the cancellation was inside the notice, which is a different thing -- and `withinNotice: null` is
  // how it says so rather than guessing false.
  const noticeMinutes = rule.readFailed ? 0 : rule.cancellationNoticeMinutes;
  const scheduledMs = Date.parse(String(appt.scheduled_at));
  const withinNotice = rule.readFailed || Number.isNaN(scheduledMs) ? null
    : Date.now() > scheduledMs - noticeMinutes * 60000;

  const cancelled = await transitionAppointment(admin, {
    workspaceId: ctx.workspaceId, appointmentId: String(appt.id), to: "CANCELLED",
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!cancelled.ok) return cancelled;

  const reason = (args.reason ?? "").trim().slice(0, 500) || null;
  const actorKind = args.actorKind ?? "practice";
  const record = await recordCancellation(admin, ctx.workspaceId, String(appt.id), {
    reason, actorKind, withinNotice,
  });

  // ⚠ THE AUDIT LINE IS WRITTEN WHETHER OR NOT THE COLUMNS EXIST, so a deployment without migration 269
  // still has a record of who cancelled and why -- in a log rather than in a column a report can group
  // by, which is the difference the migration closes.
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.appointment_cancelled_by_practice",
    payload: {
      appointmentId: appt.id, scheduledAt: appt.scheduled_at, reason,
      actorKind, withinNotice, noticeMinutes, reasonStoredOnAppointment: record.stored,
    },
    correlationId: args.correlationId,
  });

  const waiting = rule.readFailed ? null : await waitingListFor(admin, ctx, {
    appointmentType: String(appt.appointment_type),
    locationId: (appt.location_id as string | null) ?? null,
    onDate: Number.isNaN(scheduledMs) ? null : new Date(scheduledMs).toISOString().slice(0, 10),
  });

  return {
    ok: true,
    data: {
      appointmentId: String(appt.id), status: cancelled.data.status,
      actorKind, withinNotice, noticeMinutes,
      reasonStored: record.stored, reasonNote: record.note,
      waitingList: waiting === null ? null
        : waiting.state === "ok" ? waiting.value.map(w => ({ id: w.id, patientName: w.patientName, note: w.note })) : null,
      waitingListNote: WAITING_LIST_CONTACT_NOTE,
    },
  };
}

/**
 * Write migration 269's four columns onto a cancelled appointment.
 *
 * ⚠ ITS ERROR IS RETURNED, NEVER DISCARDED, AND IT DOES NOT UNDO THE CANCELLATION. The appointment is
 * already cancelled and that is the fact the diary must reflect. Failing the whole call here would leave
 * a caller believing the cancellation had not happened when it had -- so the failure is reported as what
 * it is: the cancellation stands, the note about it did not land, and the sentence says so.
 */
export async function recordCancellation(
  admin: any, workspaceId: string, appointmentId: string,
  args: { reason: string | null; actorKind: string; withinNotice: boolean | null },
): Promise<{ stored: boolean; note: string | null }> {
  const { error } = await admin.from("practice_appointment").update({
    cancellation_reason: args.reason,
    cancelled_by_kind: args.actorKind,
    cancelled_within_notice: args.withinNotice,
    cancelled_at: nowIso(),
  }).eq("id", appointmentId).eq("workspace_id", workspaceId);
  if (!error) return { stored: true, note: null };
  if (isMissing(error))
    return {
      stored: false,
      note: sectionAbsentNote("What a cancellation records", BOOKING_RULE_MIGRATION_269)
        + " The appointment IS cancelled and the reason is in the audit trail.",
    };
  return {
    stored: false,
    note: `The appointment is cancelled. The note about why could not be written to it: ${error.message}`,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. DNA -- A MISSED APPOINTMENT, AND WHERE IT LEAVES THE PATIENT
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type DnaOutcome = {
  appointmentId: string;
  patientId: string | null;
  /** ⚠ Null when this booking names no patient. There is nobody to count misses for, and that is said. */
  missedTotal: number | null;
  threshold: number | null;
  action: string;
  /** True once the count has reached the rule's threshold. Null when no rule counts. */
  overThreshold: boolean | null;
  statement: string;
};

/**
 * Mark an appointment as missed, and say where that leaves the patient against the practice's own rule.
 *
 * ⚠ IT DECIDES NOTHING ABOUT A FUTURE BOOKING. The rule's action is applied by evaluateBooking, at the
 * moment a booking is attempted, from a count it reads for itself. Deciding here and storing a verdict
 * would put a stale judgement on a record: a patient who missed three and then attended four times would
 * carry the old answer until somebody thought to recompute it.
 */
export async function recordNoShow(admin: any, ctx: WorkspaceContext, args: {
  appointmentId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<DnaOutcome>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };

  const { data: appt, error } = await admin.from("practice_appointment")
    .select("id, status, patient_id, location_id, appointment_type")
    .eq("id", args.appointmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 503, code: "READ_FAILED", message: `the appointment could not be read: ${error.message}` };
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const moved = await transitionAppointment(admin, {
    workspaceId: ctx.workspaceId, appointmentId: String(appt.id), to: "NO_SHOW",
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!moved.ok) return moved;

  const patientId = (appt.patient_id as string | null) ?? null;
  if (!patientId)
    return {
      ok: true,
      data: {
        appointmentId: String(appt.id), patientId: null, missedTotal: null,
        threshold: null, action: "none", overThreshold: null,
        // ⚠ NOT "0 missed". This booking was never linked to a patient record, so there is nobody to
        // count misses for -- which is a different sentence from a patient with a clean record.
        statement: "This appointment is marked as missed. It is not linked to a patient record, so it counts towards nobody.",
      },
    };

  const { data: missed, error: missErr } = await admin.from("practice_appointment")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).eq("status", "NO_SHOW");
  // ⚠ THE MISS IS ALREADY RECORDED. A failed COUNT must not read as a count of nought, so the total is
  // null and the sentence says the appointment was marked and the tally could not be read.
  if (missErr)
    return {
      ok: true,
      data: {
        appointmentId: String(appt.id), patientId, missedTotal: null,
        threshold: null, action: "none", overThreshold: null,
        statement: `This appointment is marked as missed. How many this patient has missed altogether could not be counted just now (${missErr.message}), so nothing is claimed about it.`,
      },
    };

  const total = ((missed ?? []) as any[]).length;
  const { data: rules, error: ruleErr } = await admin.from("practice_booking_rule")
    .select("dna_threshold, dna_action, location_id, appointment_type, status")
    .eq("workspace_id", ctx.workspaceId).eq("status", "active");

  // ⚠ THE MIGRATION MAY NOT BE APPLIED, AND THAT IS NOT AN ERROR HERE. The miss is still recorded and
  // the count is still true -- what is absent is the practice's rule about it, which is said plainly.
  if (ruleErr && isMissing(ruleErr))
    return {
      ok: true,
      data: {
        appointmentId: String(appt.id), patientId, missedTotal: total,
        threshold: null, action: "none", overThreshold: null,
        statement: `This appointment is marked as missed. This patient has now missed ${total}. ${sectionAbsentNote("A rule about missed appointments", BOOKING_RULE_MIGRATION_269)}`,
      },
    };
  if (ruleErr)
    return {
      ok: true,
      data: {
        appointmentId: String(appt.id), patientId, missedTotal: total,
        threshold: null, action: "none", overThreshold: null,
        statement: `This appointment is marked as missed. This patient has now missed ${total}. Your booking rules could not be read (${ruleErr.message}), so what your rule says about that is not shown.`,
      },
    };

  // The narrowest rule that names this location and type wins, then the location, then the type, then
  // the practice -- the same precedence resolveBookingRule uses, over the same rows.
  const rows = ((rules ?? []) as any[]).filter(r => r.dna_threshold !== null && r.dna_action !== "none");
  const locationId = (appt.location_id as string | null) ?? null;
  const type = String(appt.appointment_type);
  const hit = rows.find(r => r.location_id === locationId && r.appointment_type === type)
    ?? rows.find(r => r.location_id === locationId && r.appointment_type === null)
    ?? rows.find(r => r.location_id === null && r.appointment_type === type)
    ?? rows.find(r => r.location_id === null && r.appointment_type === null)
    ?? null;

  if (!hit)
    return {
      ok: true,
      data: {
        appointmentId: String(appt.id), patientId, missedTotal: total,
        threshold: null, action: "none", overThreshold: null,
        statement: `This appointment is marked as missed. This patient has now missed ${total}. No rule of yours acts on missed appointments, so nothing about their next booking changes.`,
      },
    };

  const threshold = hit.dna_threshold as number;
  const action = String(hit.dna_action);
  const over = total >= threshold;
  return {
    ok: true,
    data: {
      appointmentId: String(appt.id), patientId, missedTotal: total,
      threshold, action, overThreshold: over,
      statement: !over
        ? `This appointment is marked as missed. This patient has now missed ${total} of the ${threshold} at which your rule acts.`
        : action === "block_self_booking"
          ? `This appointment is marked as missed. This patient has now missed ${total}, so under your rule they can no longer book online and must ring you. You and your staff can still book for them.`
          : `This appointment is marked as missed. This patient has now missed ${total}, so under your rule their next booking will be a request for you to approve rather than a confirmed appointment.`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. THE WAITING LIST
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type WaitingListEntry = {
  id: string;
  patientName: string;
  patientId: string | null;
  appointmentType: string;
  locationId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  earliestDate: string | null;
  latestDate: string | null;
  note: string | null;
  status: string;
  offeredAt: string | null;
  offeredStart: string | null;
  createdAt: string | null;
};

const toEntry = (r: any): WaitingListEntry => ({
  id: String(r.id),
  patientName: String(r.patient_name),
  patientId: (r.patient_id as string | null) ?? null,
  appointmentType: String(r.appointment_type),
  locationId: (r.location_id as string | null) ?? null,
  contactPhone: (r.contact_phone as string | null) ?? null,
  contactEmail: (r.contact_email as string | null) ?? null,
  earliestDate: (r.earliest_date as string | null) ?? null,
  latestDate: (r.latest_date as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  status: String(r.status),
  offeredAt: (r.offered_at as string | null) ?? null,
  offeredStart: (r.offered_start as string | null) ?? null,
  createdAt: (r.created_at as string | null) ?? null,
});

const WAITING_COLUMNS =
  "id, patient_name, patient_id, appointment_type, location_id, contact_phone, contact_email, "
  + "earliest_date, latest_date, note, status, offered_at, offered_start, created_at";

/** Everybody on the list, newest request last. ⚠ An unreadable list is not an empty one. */
export async function listWaitingList(
  admin: any, ctx: WorkspaceContext, args: { includeClosed?: boolean } = {},
): Promise<Reading<WaitingListEntry[]>> {
  const present = await waitingListStorePresent(admin);
  if (present === false)
    return { state: "unreadable", reason: sectionAbsentNote("A waiting list", BOOKING_RULE_MIGRATION_269) };
  if (present === null)
    return { state: "unreadable", reason: "whether this practice has a waiting list could not be checked just now" };

  let q = admin.from(WAITING_LIST_TABLE).select(WAITING_COLUMNS)
    .eq("workspace_id", ctx.workspaceId).order("created_at");
  if (args.includeClosed !== true) q = q.in("status", WAITING_LIST_STATUSES_LIVE);
  const { data, error } = await q;
  if (error || data == null)
    return { state: "unreadable", reason: `your waiting list could not be read: ${error?.message ?? "neither rows nor an error"}` };
  return { state: "ok", value: (data as any[]).map(toEntry) };
}

/** Who a freed time could be offered to: same kind of appointment, same place, inside their own window. */
async function waitingListFor(admin: any, ctx: WorkspaceContext, args: {
  appointmentType: string; locationId: string | null; onDate: string | null;
}): Promise<Reading<WaitingListEntry[]>> {
  const all = await listWaitingList(admin, ctx);
  if (all.state !== "ok") return all;
  return {
    state: "ok",
    value: all.value.filter(e => {
      if (e.status !== "waiting") return false;
      if (e.appointmentType !== args.appointmentType) return false;
      // ⚠ AN ENTRY WITH NO LOCATION IS NOT FUSSY, and a freed time at any location suits it. An entry
      // that names one is only offered that one -- being rung about a clinic across the city is not an
      // offer, it is a nuisance.
      if (e.locationId !== null && e.locationId !== args.locationId) return false;
      if (args.onDate === null) return true;
      if (e.earliestDate && args.onDate < e.earliestDate) return false;
      if (e.latestDate && args.onDate > e.latestDate) return false;
      return true;
    }),
  };
}

export async function addToWaitingList(admin: any, ctx: WorkspaceContext, args: {
  patientName?: string | null;
  patientId?: string | null;
  appointmentType: string;
  locationId?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  earliestDate?: string | null;
  latestDate?: string | null;
  note?: string | null;
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<{ id: string; contactNote: string }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  const present = await waitingListStorePresent(admin);
  if (present === false) return storeAbsent("A waiting list");
  if (present === null)
    return { ok: false, status: 503, code: "READ_FAILED", message: "whether this practice has a waiting list could not be checked just now" };

  // ⚠ THE NAME IS TAKEN FROM THE PATIENT RECORD WHEN THERE IS ONE, never from the body. A waiting-list
  // row that names one person and points at another is a telephone call to the wrong patient.
  let patientName = (args.patientName ?? "").trim() || null;
  if (args.patientId) {
    const { data: patient, error } = await admin.from("practice_patient")
      .select("id, display_name, status").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 503, code: "READ_FAILED", message: `the patient record could not be read: ${error.message}` };
    if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (patient.status !== "active")
      return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };
    patientName = String(patient.display_name);
  }
  // ⚠ btrim, NOT `is not null`. Migration 256 shipped that mistake and 257 was the correction: a name of
  // spaces is not a name, and the column's own CHECK is written the same way.
  if (!patientName)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a waiting-list entry needs a name, or a patient record to take one from" };
  if (args.earliestDate && args.latestDate && args.latestDate < args.earliestDate)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the last date they could be seen cannot be before the first" };

  if (args.locationId) {
    const { data: loc, error } = await admin.from("practice_location")
      .select("id").eq("id", args.locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 503, code: "READ_FAILED", message: `the location could not be read: ${error.message}` };
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const { data, error } = await admin.from(WAITING_LIST_TABLE).insert({
    workspace_id: ctx.workspaceId,
    patient_id: args.patientId ?? null,
    patient_name: patientName.slice(0, 160),
    appointment_type: args.appointmentType,
    location_id: args.locationId ?? null,
    contact_phone: (args.contactPhone ?? "").trim() || null,
    contact_email: (args.contactEmail ?? "").trim() || null,
    earliest_date: args.earliestDate || null,
    latest_date: args.latestDate || null,
    note: (args.note ?? "").trim().slice(0, 500) || null,
    // ⚠ 'practice' AND NOT 'patient'. Nothing patient-facing writes this row, and a `source` that
    // claimed otherwise would make the column useless the day something does.
    source: "practice",
    // ⚠ THE SUBJECT OF THIS WRITE IS THE CALLER. Never an id from the body.
    created_by: ctx.userId,
  }).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the waiting-list entry was not written, and the database reported no error" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.waiting_list_added",
    payload: { entryId: data.id, appointmentType: args.appointmentType, patientId: args.patientId ?? null },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: String(data.id), contactNote: WAITING_LIST_CONTACT_NOTE } };
}

/**
 * Record that a freed time was put to somebody.
 *
 * ⚠ IT IS A RECORD OF AN OFFER, NOT AN OFFER. Nothing is sent, nothing is reserved and the time stays
 * bookable by anybody -- migration 255's exclusion constraint has the last word on who gets it. The
 * return value carries the sentence saying so, and the screen prints it where the offer is made.
 */
export async function offerWaitingListEntry(admin: any, ctx: WorkspaceContext, args: {
  entryId: string; offeredStart: string; offerNote?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; offeredStart: string; contactNote: string }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  const present = await waitingListStorePresent(admin);
  if (present === false) return storeAbsent("A waiting list");
  if (present === null)
    return { ok: false, status: 503, code: "READ_FAILED", message: "whether this practice has a waiting list could not be checked just now" };

  if (Number.isNaN(Date.parse(args.offeredStart)))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an offer has to name a time" };

  const { data: entry, error } = await admin.from(WAITING_LIST_TABLE)
    .select("id, status, patient_name").eq("id", args.entryId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 503, code: "READ_FAILED", message: `that waiting-list entry could not be read: ${error.message}` };
  if (!entry) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (String(entry.status) !== "waiting")
    return {
      ok: false, status: 422, code: "NOT_WAITING",
      message: `this entry is ${String(entry.status)}, so there is nothing to offer.`,
    };

  const { data: updated, error: upErr } = await admin.from(WAITING_LIST_TABLE).update({
    status: "offered",
    offered_at: nowIso(),
    offered_start: new Date(Date.parse(args.offeredStart)).toISOString(),
    offer_note: (args.offerNote ?? "").trim().slice(0, 500) || null,
    updated_at: nowIso(), updated_by: ctx.userId,
  }).eq("id", args.entryId).eq("workspace_id", ctx.workspaceId).eq("status", "waiting")
    .select("id").maybeSingle();
  if (upErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: upErr.message };
  // The status is the concurrency token: two people offering the same freed time cannot both win, and
  // the loser is told rather than overwriting the first offer.
  if (!updated)
    return { ok: false, status: 409, code: "ALREADY_OFFERED", message: "somebody offered this entry a time while you were looking at it" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.waiting_list_offered",
    payload: { entryId: args.entryId, offeredStart: args.offeredStart, delivered: false },
    correlationId: args.correlationId,
  });
  return {
    ok: true,
    data: { id: args.entryId, offeredStart: args.offeredStart, contactNote: WAITING_LIST_CONTACT_NOTE },
  };
}

/** Close an entry: they took a time, they withdrew, or their window has passed. */
export async function closeWaitingListEntry(admin: any, ctx: WorkspaceContext, args: {
  entryId: string; status: string; appointmentId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; status: string }>> {
  if (!ctx.capabilities.includes("appointment.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "appointment.manage is required" };
  const present = await waitingListStorePresent(admin);
  if (present === false) return storeAbsent("A waiting list");
  if (present === null)
    return { ok: false, status: 503, code: "READ_FAILED", message: "whether this practice has a waiting list could not be checked just now" };

  if (!WAITING_LIST_STATUS_CODES.includes(args.status) || args.status === "waiting" || args.status === "offered")
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `closing an entry means one of: booked, withdrawn, expired`,
    };
  // migration 269's practice_waiting_list_booked_complete refuses a booked row with no appointment, so
  // this refusal exists to say WHY in a sentence rather than let a constraint name arrive instead.
  if (args.status === "booked" && !args.appointmentId)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an entry marked as booked has to name the appointment it became" };

  if (args.appointmentId) {
    const { data: appt, error } = await admin.from("practice_appointment")
      .select("id").eq("id", args.appointmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 503, code: "READ_FAILED", message: `the appointment could not be read: ${error.message}` };
    if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const { data, error } = await admin.from(WAITING_LIST_TABLE).update({
    status: args.status,
    appointment_id: args.appointmentId ?? null,
    updated_at: nowIso(), updated_by: ctx.userId,
  }).eq("id", args.entryId).eq("workspace_id", ctx.workspaceId)
    .in("status", WAITING_LIST_STATUSES_LIVE).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!data)
    return { ok: false, status: 409, code: "NOT_LIVE", message: "that entry is already closed, or is not in this practice" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.waiting_list_closed",
    payload: { entryId: args.entryId, status: args.status, appointmentId: args.appointmentId ?? null },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: args.entryId, status: args.status } };
}

export { waitingListFor, WAITING_LIST_CONTACT_NOTE };
