import { audit } from "@/lib/practice/audit";
import { emitEvents, emitAudited } from "@/lib/practice/events";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  FOLLOW_UP_TRANSITIONS, CLOSED_FOLLOW_UP_STATUSES, FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_OUTCOMES, FOLLOW_UP_SOURCES, FOLLOW_UP_ORIGIN_WORKSPACES, FOLLOW_UP_VIEWS, FOLLOW_UP_TYPES,
  FOLLOW_UP_TYPE_LABELS,
  DUE_WEEK_DAYS, type FollowUpDueState, type FollowUpView,
} from "@/lib/practice/follow-up-constants";
import { dueDateFrom, workspaceClock } from "@/lib/practice/practice-time";
import { onFollowUpCreated } from "./activation-hooks";
import {
  RECALLABLE_FOLLOW_UP_STATUSES, DEAD_APPOINTMENT_STATUSES,
} from "@/lib/practice/recall-constants";

// CPR-140 FOLLOW-UP MANAGEMENT / PEN-004. The obligation loop: due -> overdue -> scheduled -> closed.
//
// OVERDUE IS DERIVED HERE, NEVER STORED. Migration 196's header gives the reason at length; the short
// version is that a stored OVERDUE needs something to run, and the thing it needs is exactly what a
// neglected practice does not do. `status` holds only what a human decided; overdue is due_on against
// the clock, computed at read time, every time.
//
// "TODAY" IS THE PRACTICE'S TODAY, NOT THE SERVER'S. A follow-up due on the 14th is overdue in Kampala
// at 00:00 EAT, not at 03:00 EAT when UTC catches up. The workspace carries a timezone (migration 191)
// and every function that compares a date to now resolves it through practiceToday() rather than
// new Date(). Three hours is a whole working morning of a board saying "nothing is late" while things
// are late.
//
// CLOSING REQUIRES SAYING WHAT HAPPENED. A follow-up completed with no encounter behind it and no words
// in it is a tick-box: it records that somebody clicked, not that anybody was seen. So COMPLETED needs a
// closing encounter or an outcome, and MISSED needs an outcome -- because "we stopped chasing this
// person" is a decision that should have a sentence attached to it.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

// The clock lives in practice-time.ts, which the operations home shares. Re-exported here because this
// module's callers and its harness reach for it by this name -- and because two copies of a timezone
// calculation is how one of them quietly stops matching the other.
export { practiceToday, dueDateFrom } from "@/lib/practice/practice-time";

const workspaceToday = async (admin: any, workspaceId: string) => (await workspaceClock(admin, workspaceId)).today;

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/**
 * The derived view of one follow-up. Everything here is computed, never read from a column:
 *   overdue  the due date has passed and nothing is booked
 *   late     something IS booked, but for after the date it was due
 *   dueInDays  negative when the date has passed
 */
export function deriveFollowUp(row: any, today: string, appointmentAt?: string | null) {
  const closed = CLOSED_FOLLOW_UP_STATUSES.includes(row.status);
  // ── CPR-FUP-002 s4: A DEFERRAL MOVES THE DATE THAT MATTERS, IT DOES NOT SUSPEND IT ─────────────────
  //
  // migration 239 requires deferred_until whenever the status is DEFERRED, precisely so that a deferred
  // obligation still has a day on which it comes back. Deriving against due_on instead would leave a
  // deferred follow-up permanently reading "3 weeks overdue" -- and deriving against nothing at all would
  // leave it permanently silent, which is the failure the required-date constraint exists to prevent.
  //
  // effectiveDueOn IS due_on for every status except DEFERRED, so nothing that existed before this line
  // changes behaviour.
  const effectiveDueOn: string =
    row.status === "DEFERRED" && row.deferred_until ? String(row.deferred_until) : row.due_on;
  const dueInDays = daysBetween(today, effectiveDueOn);
  const bookedFor = appointmentAt ? String(appointmentAt).slice(0, 10) : null;
  const overdue =
    !closed && (row.status === "OPEN" || row.status === "DEFERRED") && dueInDays < 0;

  // ⚠ DERIVED. This is what the five summary cards and the Status column are built from, and it exists
  // as a value rather than as five separate comparisons scattered across components so that one screen
  // cannot decide "due today" means something a second screen disagrees with.
  const dueState: FollowUpDueState =
    closed ? "closed"
      : row.status === "DRAFT" ? "draft"
        : overdue ? "overdue"
          : dueInDays === 0 ? "due_today"
            : dueInDays < DUE_WEEK_DAYS ? "due_this_week"
              : "upcoming";

  return {
    ...row,
    dueInDays,
    effectiveDueOn,
    dueState,
    overdue,
    late: !closed && row.status === "SCHEDULED" && bookedFor !== null && bookedFor > row.due_on,
    bookedFor,
    closed,
  };
}

async function recordEvent(
  admin: any, workspaceId: string, followUpId: string, from: string | null, to: string,
  actorId: string, note?: string,
  // ⚠ CPR-FUP-002 s7/s9: THE DATE IT MOVED FROM IS A COLUMN, NOT PROSE. Migration 239 added
  // from_due_on/to_due_on because a reschedule written as a sentence cannot answer "how many times has
  // this been pushed, and by how long" -- which is the question a repeatedly-deferred obligation
  // eventually raises, and the only one that distinguishes a rescheduled review from an abandoned one.
  dates?: { from: string | null; to: string | null },
) {
  await admin.from("practice_follow_up_event").insert({
    workspace_id: workspaceId, follow_up_id: followUpId, from_status: from, to_status: to,
    note: note ?? null, actor_id: actorId,
    from_due_on: dates?.from ?? null, to_due_on: dates?.to ?? null,
  });
}

/** The intervals the UI offers. Arithmetic, not clinical guidance -- see migration 196 s3. */
export async function listIntervals(admin: any) {
  const { data } = await admin.from("practice_follow_up_interval")
    .select("code, label, days").order("position");
  return (data ?? []) as { code: string; label: string; days: number }[];
}

export async function createFollowUp(admin: any, args: {
  workspaceId: string; patientId: string; originEncounterId?: string | null;
  problemId?: string | null; diagnosisId?: string | null;
  /** ⚠ OFFLINE CAPTURE ONLY (offline-filing.ts). The device mints the identity so a crashed sync's
   * retry is absorbed by the PRIMARY KEY instead of guessed at by a natural key. Online callers never
   * pass this -- the database default mints server-side identities exactly as before. */
  id?: string;
  kind?: string; reason: string; dueOn?: string; intervalCode?: string; priority?: string;
  // ── CPR-FUP-002 s5: EVERY FOLLOW-UP STORES WHERE IT CAME FROM ────────────────────────────────────
  // Until migration 239 the only trace was origin_encounter_id being null or not, which cannot tell a
  // manual commitment from one a document raised, and cannot record a source that has no row to point
  // at. Defaulted rather than required so no existing caller changes meaning: an obligation with an
  // encounter behind it IS an encounter one, and one without is manual.
  source?: string;
  originWorkspace?: string | null;
  /** DRAFT for one being composed. Anything else is refused -- see below. */
  status?: string;
  // ── CPR-FUP-HFE-008 s6/s11/s18 (migration 299) ───────────────────────────────────────────────────
  /** s11's accountable owner. A person OR a queue -- the DB refuses both, because "whose is this" needs one answer. */
  assignedTo?: string | null;
  assignedQueue?: string | null;
  /** s6/s10: how this is meant to be fulfilled. ⚠ 'appointment' is an INTENTION, never a booking. */
  followUpType?: string;
  locationId?: string | null;
  instructions?: string | null;
  /** s18's typed origins. Deliberately not a polymorphic pointer -- see migration 299's header. */
  investigationId?: string | null;
  procedureId?: string | null;
  treatmentId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; dueOn: string; status: string; source: string }>> {
  if (!args.reason.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a follow-up must say what it is for" };

  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status !== "active")
    return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };

  // A named encounter must belong to this workspace AND this patient. An obligation filed against
  // someone else's consultation would put the wrong person on the board.
  let originEncounterId: string | null = null;
  if (args.originEncounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.originEncounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    originEncounterId = enc.id;
  }

  const today = await workspaceToday(admin, args.workspaceId);
  let dueOn = args.dueOn ?? null;
  if (!dueOn && args.intervalCode) {
    // Validated against the catalogue rather than parsed: an interval the practice does not have is a
    // refusal, not a silent fallback to some default number of days.
    const { data: interval } = await admin.from("practice_follow_up_interval")
      .select("days").eq("code", args.intervalCode).maybeSingle();
    if (!interval) return { ok: false, status: 400, code: "UNKNOWN_INTERVAL", message: `no such interval: ${args.intervalCode}` };
    dueOn = dueDateFrom(today, interval.days);
  }
  if (!dueOn) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "dueOn or intervalCode is required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "dueOn must be a date (YYYY-MM-DD)" };

  const kind = FOLLOW_UP_KINDS.some(([k]) => k === args.kind) ? args.kind! : "review";
  const priority = (FOLLOW_UP_PRIORITIES as readonly string[]).includes(args.priority ?? "") ? args.priority! : "routine";

  // A NAMED SOURCE IS VALIDATED, AN ABSENT ONE IS INFERRED. Inferring it from the encounter link is the
  // only inference that cannot be wrong: there either is a consultation behind this or there is not.
  const source = args.source ?? (originEncounterId ? "encounter" : "manual");
  if (!FOLLOW_UP_SOURCES.some(([c]) => c === source))
    return {
      ok: false, status: 400, code: "UNKNOWN_SOURCE",
      message: `a source must be one of: ${FOLLOW_UP_SOURCES.map(([c]) => c).join(", ")}`,
    };
  // ⚠ REFUSED RATHER THAN CORRECTED. Accepting source:"investigation" with no investigation behind it
  // would make the column unusable for the one question it exists to answer -- and silently rewriting it
  // to "manual" would be this engine deciding a caller meant something it did not say.
  if (source === "encounter" && !originEncounterId)
    return {
      ok: false, status: 422, code: "SOURCE_WITHOUT_ORIGIN",
      message: "a follow-up whose source is an encounter must name the encounter",
    };

  const originWorkspace = args.originWorkspace ?? null;
  if (originWorkspace && !(FOLLOW_UP_ORIGIN_WORKSPACES as readonly string[]).includes(originWorkspace))
    return {
      ok: false, status: 400, code: "UNKNOWN_ORIGIN_WORKSPACE",
      message: `an originating workspace must be one of: ${FOLLOW_UP_ORIGIN_WORKSPACES.join(", ")}`,
    };

  // Only DRAFT may be asked for. Every other opening status is either what this already does (OPEN) or a
  // claim about something that has not happened yet -- a follow-up cannot be born COMPLETED.
  const status = args.status === "DRAFT" ? "DRAFT" : "OPEN";
  if (args.status && args.status !== "DRAFT" && args.status !== "OPEN")
    return {
      ok: false, status: 422, code: "ILLEGAL_OPENING_STATUS",
      message: "a follow-up opens as OPEN, or as DRAFT while it is being composed",
    };

  // ── CPR-FUP-HFE-008 s6, VALIDATED RATHER THAN COERCED ───────────────────────────────────────────
  //
  // ⚠ REFUSED, NOT DEFAULTED. The same reasoning as recordProcedure's status: silently rewriting an
  // unrecognised type to 'review' would let a stale client turn every appointment-intended follow-up
  // into a review, and nothing would say so. `kind` and `priority` above default because they predate
  // this and callers rely on it; a NAMED type that is wrong is a different thing from an absent one.
  const followUpType = args.followUpType ?? "review";
  if (!(FOLLOW_UP_TYPES as readonly string[]).includes(followUpType))
    return {
      ok: false, status: 400, code: "UNKNOWN_FOLLOW_UP_TYPE",
      message: `a follow-up type must be one of: ${FOLLOW_UP_TYPES.join(", ")}`,
    };

  // ⚠ s11: ONE OWNER. The database refuses both, and refusing here as well means the caller is told
  // WHICH rule it broke rather than reading a constraint name out of a 400.
  if (args.assignedTo && (args.assignedQueue ?? "").trim())
    return {
      ok: false, status: 422, code: "TWO_OWNERS",
      message: "a follow-up is owned by a person or by a queue, not both",
    };

  const { data: f, error } = await admin.from("practice_follow_up").insert({
    ...(args.id ? { id: args.id } : {}),
    workspace_id: args.workspaceId, patient_id: args.patientId, origin_encounter_id: originEncounterId,
    problem_id: args.problemId ?? null, diagnosis_id: args.diagnosisId ?? null,
    kind, reason: args.reason.trim(), due_on: dueOn, priority, status,
    source, origin_workspace: originWorkspace,
    assigned_to: args.assignedTo ?? null,
    assigned_queue: (args.assignedQueue ?? "").trim() || null,
    follow_up_type: followUpType,
    location_id: args.locationId ?? null,
    instructions: (args.instructions ?? "").trim() || null,
    // ⚠ s9/s21: WHAT WAS CHOSEN, NOT ONLY WHAT IT RESOLVED TO. Written only when an interval was
    // actually used -- a caller passing an explicit dueOn chose a date, and stamping an interval code
    // beside it would claim a relative intent nobody expressed.
    target_interval_code: !args.dueOn && args.intervalCode ? args.intervalCode : null,
    investigation_id: args.investigationId ?? null,
    procedure_id: args.procedureId ?? null,
    treatment_id: args.treatmentId ?? null,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, due_on, status, source").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await recordEvent(admin, args.workspaceId, f.id, null, status, args.actorId, args.reason.trim(),
    { from: null, to: dueOn });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_raised",
    payload: { followUpId: f.id, patientId: args.patientId, dueOn, kind, source, status },
    correlationId: args.correlationId,
  });

  // ── CPR-FUP-002 s10, AND THE HALF OF IT THAT CANNOT BE BUILT ────────────────────────────────────────
  //
  // s10 asks for five platform events: Created, Due, Overdue, Completed, Cancelled. The outbox
  // (practice_domain_event, migration 233) has a CLOSED event_type check holding four follow-up names:
  // followup.created, followup.booked, followup.due, followup.completed.
  //
  //   followup.created    emitted here.
  //   followup.completed  emitted from closeFollowUp.
  //   followup.due        ⚠ NOT EMITTED, AND NOT BECAUSE IT IS MISSING -- it is in the catalogue. It is
  //                       not emitted because DUE IS DERIVED. Emitting it would require something to run
  //                       each morning to notice, and that is the stored-DUE mistake wearing an event's
  //                       clothes: the practice that opened the app least would get the fewest events.
  //   followup.overdue    ABSENT from the catalogue. Not invented here -- widening a closed CHECK is a
  //   followup.cancelled  migration, and this build does not write one. Reported instead.
  //
  // A failed emit never fails the write it describes (events.ts's own rule): a lost event costs
  // freshness, a lost obligation costs a patient.
  await emitEvents(admin, [{
    eventType: "followup.created", practiceId: args.workspaceId,
    practitionerId: args.actorId, actorId: args.actorId, source: "web",
    patientId: args.patientId, encounterId: originEncounterId,
    payload: { followUpId: f.id, dueOn, kind, followUpSource: source, status },
  }]);

  // CPR-GROWTH-001 s2. Non-blocking and count-based -- see activation-hooks.
  await onFollowUpCreated(admin, args.workspaceId, args.actorId);

  return {
    ok: true,
    data: { id: f.id as string, dueOn: f.due_on as string, status: f.status as string, source: f.source as string },
  };
}

/**
 * Link a booking to an obligation: OPEN -> SCHEDULED.
 *
 * The appointment must be LIVE. Linking a cancelled or completed booking would produce the state
 * migration 196's trigger exists to prevent -- an obligation that reads SCHEDULED with nothing behind it.
 */
export async function scheduleFollowUp(admin: any, args: {
  workspaceId: string; followUpId: string; appointmentId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: f } = await admin.from("practice_follow_up")
    .select("id, status, patient_id, record_version").eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(FOLLOW_UP_TRANSITIONS[f.status] ?? []).includes("SCHEDULED"))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${f.status} cannot become SCHEDULED` };

  const { data: appt } = await admin.from("practice_appointment")
    .select("id, patient_id, status, scheduled_at").eq("id", args.appointmentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!["REQUESTED", "CONFIRMED", "ARRIVED"].includes(appt.status))
    return { ok: false, status: 422, code: "APPOINTMENT_NOT_LIVE", message: `that appointment is ${appt.status}; book a live one` };
  if (appt.patient_id !== f.patient_id)
    return { ok: false, status: 422, code: "APPOINTMENT_PATIENT_MISMATCH", message: "that appointment belongs to a different patient" };

  const { data: updated, error } = await admin.from("practice_follow_up")
    .update({
      status: "SCHEDULED", appointment_id: appt.id,
      record_version: f.record_version + 1, updated_at: nowIso(), updated_by: args.actorId,
    }).eq("workspace_id", args.workspaceId)
    .eq("id", f.id).eq("record_version", f.record_version).select("id").maybeSingle();
  if (error) {
    // ux_practice_followup_appointment: one live obligation per booking.
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "APPOINTMENT_ALREADY_LINKED", message: "another follow-up is already booked against that appointment" };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the follow-up changed underneath you; reload and retry" };

  await recordEvent(admin, args.workspaceId, f.id, f.status, "SCHEDULED", args.actorId,
    `booked for ${String(appt.scheduled_at).slice(0, 16).replace("T", " ")}`);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_scheduled",
    payload: { followUpId: f.id, appointmentId: appt.id }, correlationId: args.correlationId,
  });

  // ── s9 DOMAIN EVENT ─────────────────────────────────────────────────────────────────────────────
  //
  // Follow-up Intelligence names followup.booked as one of its four triggers and has never received
  // one, so the board moved on creation and on completion and stood still in between -- which is the
  // state a practitioner most wants to watch change, because it is the one that clears the overdue
  // list.
  await emitAudited(admin, [{
    eventType: "followup.booked", practiceId: args.workspaceId,
    practitionerId: args.actorId, actorId: args.actorId, source: "web",
    patientId: f.patient_id ?? null,
    payload: { followUpId: f.id, appointmentId: appt.id, scheduledAt: appt.scheduled_at, from: f.status },
  }], args.correlationId);
  return { ok: true, data: { status: "SCHEDULED" } };
}

/**
 * Close an obligation, or reopen one that was missed.
 *
 * COMPLETED needs a closing encounter or an outcome; MISSED needs an outcome. See the header: a close
 * with nothing attached records a click, not a consultation.
 */
export async function closeFollowUp(admin: any, args: {
  workspaceId: string; followUpId: string; to: string; outcome?: string; outcomeCode?: string | null;
  closingEncounterId?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: f } = await admin.from("practice_follow_up")
    .select("id, status, patient_id, plan_id, due_on, record_version").eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(FOLLOW_UP_TRANSITIONS[f.status] ?? []).includes(args.to))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${f.status} cannot become ${args.to}` };

  const outcome = (args.outcome ?? "").trim();

  let closingEncounterId: string | null = null;
  if (args.closingEncounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.closingEncounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== f.patient_id)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    closingEncounterId = enc.id;
  }

  if (args.to === "COMPLETED" && !closingEncounterId && !outcome)
    return { ok: false, status: 400, code: "OUTCOME_REQUIRED", message: "say which encounter closed this, or write what happened" };
  if (args.to === "MISSED" && !outcome)
    return { ok: false, status: 400, code: "OUTCOME_REQUIRED", message: "say why this is being marked missed" };

  // CPR-140's outcome taxonomy (migration 206). THE CODE NEVER REPLACES THE WORDS -- it sits beside them
  // so the practice can count how its reviews turn out, while the record keeps the sentence somebody
  // wrote. Optional, because a follow-up cancelled for administrative reasons has no clinical outcome
  // and forcing one would put a judgement in the record that nobody made.
  const outcomeCode = args.outcomeCode?.trim() || null;
  if (outcomeCode && !FOLLOW_UP_OUTCOMES.some(([c]) => c === outcomeCode))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `an outcome must be one of: ${FOLLOW_UP_OUTCOMES.map(([c]) => c).join(", ")}`,
    };
  if (outcomeCode && args.to !== "COMPLETED")
    return {
      ok: false, status: 422, code: "OUTCOME_CODE_NOT_APPLICABLE",
      message: "an outcome describes how a review turned out; only a completed follow-up has one",
    };

  const closing = CLOSED_FOLLOW_UP_STATUSES.includes(args.to);
  const patch: Record<string, unknown> = {
    status: args.to, record_version: f.record_version + 1, updated_at: nowIso(), updated_by: args.actorId,
    outcome: outcome || null,
    outcome_code: outcomeCode,
    closing_encounter_id: closingEncounterId,
    closed_at: closing ? nowIso() : null,
    closed_by: closing ? args.actorId : null,
  };
  // A DEFERRAL IS NOT A CLOSE AND IS NOT REACHED THROUGH HERE (see deferFollowUp): it needs a date, and
  // a status change that silently left deferred_until behind would be refused by the database anyway.
  // Leaving the old date on a follow-up that is no longer DEFERRED would be worse than refusing it, so
  // moving OFF deferred clears it.
  if (args.to !== "DEFERRED") patch.deferred_until = null;
  // Reopening lets go of the dead booking; otherwise the board offers an appointment nobody will attend.
  // It also clears the outcome, because `outcome` describes HOW THIS WAS CLOSED and it is no longer
  // closed. The words are not lost -- the event trail keeps them against the move that wrote them, which
  // is where "why was this given up on in March" is actually answerable.
  if (args.to === "OPEN") patch.appointment_id = null;

  const { data: updated } = await admin.from("practice_follow_up")
    .update(patch).eq("workspace_id", args.workspaceId).eq("id", f.id).eq("record_version", f.record_version).select("id").maybeSingle();
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the follow-up changed underneath you; reload and retry" };

  await recordEvent(admin, args.workspaceId, f.id, f.status, args.to, args.actorId, outcome || undefined);

  // A PLAN COMPLETES ITSELF WHEN ITS LAST STEP CLOSES, reconciled here rather than swept for -- a nightly
  // job would be the stored-overdue mistake again, needing something to run in a practice where nothing
  // does. Imported lazily because follow-up-plans.ts imports deriveFollowUp from this module, and a
  // static pair of imports between the two would be a cycle.
  if (f.plan_id && closing) {
    const { reconcilePlan } = await import("@/lib/practice/follow-up-plans");
    await reconcilePlan(admin, args.workspaceId, f.plan_id);
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.followup_${args.to.toLowerCase()}`,
    payload: { followUpId: f.id, closingEncounterId, outcomeCode }, correlationId: args.correlationId,
  });

  // s10's `followup.completed`. Only COMPLETED has a name in the outbox's closed catalogue -- MISSED and
  // CANCELLED do not, and are recorded in the audit log above rather than announced under a borrowed name.
  if (args.to === "COMPLETED") {
    await emitEvents(admin, [{
      eventType: "followup.completed", practiceId: args.workspaceId,
      practitionerId: args.actorId, actorId: args.actorId, source: "web",
      patientId: f.patient_id, encounterId: closingEncounterId,
      payload: { followUpId: f.id, outcomeCode, closedBy: closingEncounterId ? "encounter" : "manual" },
    }]);
  }
  return { ok: true, data: { status: args.to } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-FUP-002 s7: RESCHEDULING, AND WHY THE OLD DATE HAS TO SURVIVE IT
//
// "Changing the due date preserves audit history. The original due date remains available in the audit
// log." Written as an UPDATE to due_on and nothing else, that requirement is silently unmet: the column
// holds one date, the previous one is gone, and the record cannot answer how long somebody has actually
// been waiting. Migration 239's from_due_on/to_due_on on the event row is where the old date lives, and
// this is the only function that writes them for a move.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export async function rescheduleFollowUp(admin: any, args: {
  workspaceId: string; followUpId: string; dueOn: string; reason?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ dueOn: string; previousDueOn: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueOn))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "dueOn must be a date (YYYY-MM-DD)" };

  const { data: f } = await admin.from("practice_follow_up")
    .select("id, status, due_on, record_version").eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (CLOSED_FOLLOW_UP_STATUSES.includes(f.status))
    return {
      ok: false, status: 422, code: "ALREADY_CLOSED",
      message: `this follow-up is ${f.status.toLowerCase()}; reopen it before moving its date`,
    };
  if (f.due_on === args.dueOn)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "that is the date it is already due" };

  const { data: updated } = await admin.from("practice_follow_up")
    .update({
      due_on: args.dueOn, record_version: f.record_version + 1,
      updated_at: nowIso(), updated_by: args.actorId,
    }).eq("workspace_id", args.workspaceId)
    .eq("id", f.id).eq("record_version", f.record_version).select("id").maybeSingle();
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the follow-up changed underneath you; reload and retry" };

  // from_status === to_status on purpose: nothing about the obligation's state changed, only its date.
  // An event that claimed a transition would put a status change in the trail that never happened.
  await recordEvent(admin, args.workspaceId, f.id, f.status, f.status, args.actorId,
    args.reason?.trim() || undefined, { from: f.due_on, to: args.dueOn });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_rescheduled",
    payload: { followUpId: f.id, from: f.due_on, to: args.dueOn }, correlationId: args.correlationId,
  });
  return { ok: true, data: { dueOn: args.dueOn, previousDueOn: f.due_on as string } };
}

/**
 * CPR-FUP-002 s4's Deferred, with the date it is deferred TO.
 *
 * THE DATE IS REQUIRED HERE AS WELL AS IN THE DATABASE. migration 239's check would refuse it anyway;
 * refusing it here means the caller gets a sentence rather than a constraint violation, and the refusal
 * is the same one either way.
 */
export async function deferFollowUp(admin: any, args: {
  workspaceId: string; followUpId: string; until: string; reason?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; until: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.until ?? ""))
    return {
      ok: false, status: 400, code: "DEFERRAL_NEEDS_DATE",
      message: "say when this comes back -- a deferral with no date is an obligation nobody is reminded of again",
    };

  const { data: f } = await admin.from("practice_follow_up")
    .select("id, status, due_on, patient_id, record_version").eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(FOLLOW_UP_TRANSITIONS[f.status] ?? []).includes("DEFERRED"))
    return { ok: false, status: 422, code: "ILLEGAL_TRANSITION", message: `${f.status} cannot become DEFERRED` };

  const { data: updated, error } = await admin.from("practice_follow_up")
    .update({
      status: "DEFERRED", deferred_until: args.until,
      record_version: f.record_version + 1, updated_at: nowIso(), updated_by: args.actorId,
    }).eq("workspace_id", args.workspaceId)
    .eq("id", f.id).eq("record_version", f.record_version).select("id").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!updated) return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "the follow-up changed underneath you; reload and retry" };

  // The dates go in the event too: a deferral IS a reschedule with a status attached, and "how many
  // times has this been pushed" must be answerable over both without knowing which word was used.
  await recordEvent(admin, args.workspaceId, f.id, f.status, "DEFERRED", args.actorId,
    args.reason?.trim() || undefined, { from: f.due_on, to: args.until });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_deferred",
    payload: { followUpId: f.id, until: args.until }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "DEFERRED", until: args.until } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-FUP-001 s10 AND CPR-FUP-002 s6 AND s12: "COMPLETING THE LINKED ENCOUNTER COMPLETES THE FOLLOW-UP"
//
// ⚠ THIS IS AN ACCEPTANCE CRITERION IN BOTH DOCUMENTS AND IT DID NOT HAPPEN. A practitioner booked the
// review, saw the patient, closed the consultation -- and the obligation stayed open on the board,
// waiting to be ticked a second time by hand. The board then said somebody was owed a review they had
// already had, which is worse than saying nothing: it is a false positive in the one list whose value is
// that everything on it is real.
//
// WHICH ENCOUNTER IS "THE LINKED ONE". Not origin_encounter_id -- that is the consultation that RAISED
// the obligation, and closing it must not settle it (that would complete every follow-up the moment it
// was created). The link is the BOOKING: the follow-up was scheduled against an appointment, the
// encounter was launched from that same appointment, so that encounter is the review this obligation
// was asking for.
//
// THE CONTROL IS PART OF THE DESIGN, not just the harness: a follow-up for the SAME PATIENT that is not
// linked to that appointment is untouched. Completing every open obligation a patient has because one
// of them was met is the same false-positive problem pointing the other way.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** The statuses that mean a consultation is finished. AMENDED counts: it is a signed record, corrected. */
const SETTLING_ENCOUNTER_STATUSES = ["COMPLETED", "SIGNED", "AMENDED"];

export async function settleFollowUpsForEncounter(admin: any, args: {
  workspaceId: string; encounterId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ completed: string[]; skipped: string[] }>> {
  const { data: enc, error: encErr } = await admin.from("practice_encounter")
    .select("id, status, patient_id, appointment_id")
    .eq("id", args.encounterId).eq("workspace_id", args.workspaceId).maybeSingle();
  // ⚠ A FAILED READ IS NOT "NOTHING TO SETTLE". Reported, so a caller can say the encounter closed but
  // the obligation may not have -- rather than silently leaving one open and claiming success.
  if (encErr) return { ok: false, status: 500, code: "READ_FAILED", message: encErr.message };
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!SETTLING_ENCOUNTER_STATUSES.includes(enc.status))
    return { ok: true, data: { completed: [], skipped: [] } };
  // No booking behind it means nothing was ever linked to it. A walk-in settles nothing automatically,
  // and inferring "the patient was seen, so close everything" is exactly the leap that must not be made.
  if (!enc.appointment_id) return { ok: true, data: { completed: [], skipped: [] } };

  const { data: rows, error } = await admin.from("practice_follow_up")
    .select("id, status, patient_id")
    .eq("workspace_id", args.workspaceId)
    .eq("appointment_id", enc.appointment_id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };

  const completed: string[] = [];
  const skipped: string[] = [];
  for (const f of (rows ?? []) as any[]) {
    if (CLOSED_FOLLOW_UP_STATUSES.includes(f.status)) { skipped.push(f.id); continue; }
    // Routed through closeFollowUp rather than an UPDATE, so the state machine, the event trail, the
    // audit entry, the domain event and the plan reconciliation all happen exactly as they do when a
    // human clicks. A second write path for the same act is how two of them stop agreeing.
    const done = await closeFollowUp(admin, {
      workspaceId: args.workspaceId, followUpId: f.id, to: "COMPLETED",
      closingEncounterId: enc.id, actorId: args.actorId, correlationId: args.correlationId,
    });
    if (done.ok) completed.push(f.id); else skipped.push(f.id);
  }
  return { ok: true, data: { completed, skipped } };
}

type ListFilter = {
  patientId?: string; status?: string[]; limit?: number;
  /**
   * ⚠ BOUNDS ON due_on, THE ONE DATE A FOLLOW-UP ACTUALLY OWNS, AND BOTH ARE OPTIONAL FOR A REASON.
   *
   * The practice owner asked for a period control on every screen that reviews data over time, and this
   * queue's date is the day the obligation falls due. `created_at` would be "when somebody typed it" and
   * `closed_at` exists only for the settled ones -- neither answers "what was owed that week".
   *
   * When neither bound is given, NOTHING is applied and this queue reads exactly as it always has. That
   * is not timidity: this is a work queue, and a default period on it would hide overdue people from the
   * board that exists to say who has been forgotten.
   */
  dueFrom?: string; dueTo?: string;
};

/** A follow-up as the board and the panels see it: derived state, plus the two names a screen needs. */
export type ListedFollowUp = ReturnType<typeof deriveFollowUp> & {
  patient_name: string | null;
  appointment_status: string | null;
};

/**
 * ⚠ `unavailable` IS THE POINT OF THIS TYPE, AND IT IS NOT OPTIONAL.
 *
 * An empty follow-up list is the single most misreadable value in this product: it renders as "nobody is
 * waiting on you", which is the answer a practitioner most wants and least wants to be wrong about.
 * `items: []` with `unavailable: true` is a different fact from `items: []` with `unavailable: false`,
 * and a screen that cannot tell them apart will state the reassuring one.
 */
export type FollowUpList = { items: ListedFollowUp[]; unavailable: boolean; detail: string | null };

/** Follow-ups with their derived state, their patient's name, and any booking behind them. */
export async function listFollowUps(admin: any, workspaceId: string, filter: ListFilter = {}): Promise<FollowUpList> {
  let q = admin.from("practice_follow_up")
    // migration 239's three columns are read here and nowhere else: `source` and `origin_workspace` are
    // CPR-FUP-001 s4's Source column, and `deferred_until` is what deriveFollowUp measures a deferred
    // obligation against. A screen cannot show a Source column over a query that does not select it.
    // ⚠ MIGRATION 299's COLUMNS ARE READ HERE OR NOWHERE. A screen cannot show an owner over a query
    // that does not select one -- the same sentence the comment above already had to make about 239.
    .select("id, patient_id, origin_encounter_id, problem_id, diagnosis_id, plan_id, step_number, kind, reason, due_on, priority, status, source, origin_workspace, deferred_until, appointment_id, closing_encounter_id, outcome, outcome_code, closed_at, created_at, record_version, assigned_to, assigned_queue, follow_up_type, location_id, instructions, target_interval_code, investigation_id, procedure_id, treatment_id")
    .eq("workspace_id", workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.status?.length) q = q.in("status", filter.status);
  // due_on is a DATE column, so the bounds are plain days and there is no timezone arithmetic to get
  // wrong here -- unlike every timestamp column in this product, which needs zonedDayRange.
  if (filter.dueFrom) q = q.gte("due_on", filter.dueFrom);
  if (filter.dueTo) q = q.lte("due_on", filter.dueTo);

  // ⚠ THE ERROR USED TO BE DISCARDED HERE, AND THAT MADE THIS THE WORST PLACE IN THE PRODUCT TO HAVE
  // THE BUG. `const { data } = await q` returns undefined on failure, `data ?? []` turns it into an empty
  // list, and an empty follow-up list reads as "nobody is waiting on you" -- so the board that exists to
  // say who has been forgotten went QUIET exactly when it could not see. Three different answers were
  // collapsed into one: nothing owed, could not read, not permitted.
  //
  // The return is a RESULT rather than an array so no caller can go on ignoring it. An optional flag
  // beside an array that still works is the same bug with a comment on it -- every existing caller would
  // have kept reading `.length` and kept being wrong. The type change is the fix.
  const { data, error } = await q.order("due_on").limit(filter.limit ?? 200);
  if (error) return { items: [], unavailable: true, detail: error.message };
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { items: [], unavailable: false, detail: null };

  const today = await workspaceToday(admin, workspaceId);
  const apptIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))];
  const [{ data: patients }, appts] = await Promise.all([
    admin.from("practice_patient").select("id, display_name").eq("workspace_id", workspaceId).in("id", [...new Set(rows.map(r => r.patient_id))]),
    apptIds.length
      ? admin.from("practice_appointment").select("id, scheduled_at, status").eq("workspace_id", workspaceId).in("id", apptIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));
  const apptById = new Map((((appts as any).data ?? []) as any[]).map(a => [a.id, a]));

  return {
    items: rows.map(r => ({
      ...deriveFollowUp(r, today, apptById.get(r.appointment_id)?.scheduled_at),
      patient_name: nameById.get(r.patient_id) ?? null,
      appointment_status: apptById.get(r.appointment_id)?.status ?? null,
    })),
    unavailable: false,
    detail: null,
  };
}

/**
 * The board at /practice/follow-ups, in the four groups a practitioner actually works in.
 *
 * OVERDUE FIRST, ALWAYS. It is the group the module exists for, and putting today's work above it would
 * bury the people who have been waiting longest under the people who have been waiting least.
 */
export async function followUpBoard(admin: any, workspaceId: string, horizonDays = 14) {
  // ⚠ DEFERRED IS READ HERE OR IT DISAPPEARS. This board feeds the command centre as well as its own
  // page; a status added to the table and not added to this query would leave every deferred obligation
  // invisible on both, which is the same silence the whole module exists to prevent. DRAFT is
  // deliberately NOT read: nothing is owed yet, and a draft on the board would be a commitment nobody
  // has made.
  const open = await listFollowUps(admin, workspaceId, { status: ["OPEN", "SCHEDULED", "DEFERRED"] });
  const closed = await listFollowUps(admin, workspaceId, { status: ["COMPLETED", "MISSED", "CANCELLED"], limit: 25 });
  const unbooked = (f: ListedFollowUp) => f.status === "OPEN" || f.status === "DEFERRED";

  // ⚠ THE BOARD CARRIES THE UNAVAILABILITY UP, IT DOES NOT ABSORB IT. Four empty groups look exactly
  // like a practice that owes nothing, and this is the screen where that misreading costs the most. Only
  // the OPEN read matters for the headline claim: recently-closed failing leaves the board still able to
  // say truthfully what is outstanding, so its failure is reported separately rather than blanking a
  // board that is otherwise correct.
  return {
    overdue: open.items.filter(f => f.overdue),
    dueSoon: open.items.filter(f => !f.overdue && unbooked(f) && f.dueInDays <= horizonDays),
    scheduled: open.items.filter(f => f.status === "SCHEDULED"),
    later: open.items.filter(f => !f.overdue && unbooked(f) && f.dueInDays > horizonDays),
    recentlyClosed: closed.items
      .sort((a, b) => String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? "")))
      .slice(0, 10),
    horizonDays,
    unavailable: open.unavailable,
    detail: open.detail,
    closedUnavailable: closed.unavailable,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-FUP-001 s4: THE WORKSPACE -- FIVE SUMMARY CARDS OVER ONE WORK QUEUE
//
// ⚠ EVERY FIGURE HERE IS THE LENGTH OF A LIST YOU CAN OPEN, AND IT IS THE SAME LIST. The card carries
// the IDS it counted, not a number: the queue for a view is produced by the SAME predicate from
// FOLLOW_UP_VIEWS, over the SAME rows, in the same pass. There is no arithmetic anywhere in this
// function that a list does not also perform.
//
// This is not defensive tidiness. A card on the Patients register counted rows while the list it opened
// deduplicated patients, so the tile said 14 and the list showed 9, and neither piece of code looked
// wrong on its own. The only fix that holds is the one where there is nothing to keep in step.
//
// ⚠ AND EVERY CARD CARRIES `unavailable` UP. Five zeroes are indistinguishable from a practice that owes
// nothing, and this is the screen where that misreading costs the most.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type FollowUpCard = {
  key: string;
  label: string;
  blurb: string;
  /** null when the read failed -- never 0. */
  count: number | null;
  /** The rows this figure counted. The queue for this view is these, in this order. */
  ids: string[];
};

export type FollowUpWorkspace = {
  cards: FollowUpCard[];
  /** The queue for the requested view -- filtered by the SAME predicate the matching card counted with. */
  rows: ListedFollowUp[];
  /**
   * Every row the header's filters left, before any view narrowed them.
   *
   * ⚠ THIS IS WHAT LETS THE SCREEN SWITCH TABS WITHOUT A ROUND TRIP AND WITHOUT A SECOND OPINION. The
   * client applies FOLLOW_UP_VIEWS' own predicates to these rows, which are the same predicates that
   * produced the card figures above -- so a tab cannot show a different list from the card that counts
   * it, because there is only one rule and one set of rows. Re-fetching per tab would reintroduce
   * exactly the gap this file's header is about.
   */
  allRows: ListedFollowUp[];
  /**
   * The view that was actually APPLIED -- its key, after the fallback an unknown one falls through.
   *
   * ⚠ IT IS THE KEY AND NOT THE FollowUpView, AND THAT IS NOT A TIDY-UP. It was the whole object, and
   * the object carries `match` -- a function. This payload is handed straight to a "use client"
   * component, React cannot serialise a function across that boundary, and the page threw on render for
   * every signed-in practitioner: "Functions cannot be passed directly to Client Components". The API
   * route survived the same payload only because JSON.stringify drops functions in silence, so the
   * endpoint looked healthy while the screen was dead.
   *
   * THE FIELD ALSO HAD NO READER, which is how it survived. A returned value nobody consumes is not
   * free: nothing exercises its shape, so it is the field most likely to be wrong, and here it was the
   * only thing on the payload that could not cross the boundary it was built to cross. It is kept
   * rather than deleted because the page now uses it -- the fallback belongs to the engine, and the
   * client had been quietly repeating it.
   */
  view: string;
  /** Every view, so the tabs can be drawn with their own figures rather than a second query each. */
  tabs: { key: string; label: string; blurb: string; count: number | null }[];
  today: string;
  timezone: string;
  /** How many obligations were read in total, before any view narrowed them. */
  readCount: number;
  /** True when the read limit was reached, so every figure below is a floor rather than a total. */
  truncated: boolean;
  unavailable: boolean;
  detail: string | null;
};

/** The read ceiling. Named so `truncated` can be honest about which number it is. */
const WORKSPACE_READ_LIMIT = 500;

export async function followUpWorkspace(admin: any, workspaceId: string, options: {
  view?: string | null; patientId?: string | null; search?: string | null;
  priority?: string | null; source?: string | null;
  /** CPR-FUP-002 s12: the action-type filter, over follow_up_type. */
  followUpType?: string | null;
  /**
   * ⚠ THE PERIOD, ON due_on, AND ABSENT BY DEFAULT. See ListFilter. Every card and every tab is
   * computed from the SAME narrowed read, so a figure is still the length of the list it opens -- which
   * is this file's oldest rule and the reason the filters are applied before the predicates.
   */
  dueFrom?: string | null; dueTo?: string | null;
} = {}): Promise<FollowUpWorkspace> {
  const { timezone, today } = await workspaceClock(admin, workspaceId);
  const view = FOLLOW_UP_VIEWS.find(v => v.key === options.view) ?? FOLLOW_UP_VIEWS[0];

  // ONE READ. Not one per card: five queries would be five chances for four to succeed and one to fail,
  // and a row that moved between them would be counted twice or not at all.
  const all = await listFollowUps(admin, workspaceId, {
    patientId: options.patientId ?? undefined, limit: WORKSPACE_READ_LIMIT,
    dueFrom: options.dueFrom ?? undefined, dueTo: options.dueTo ?? undefined,
  });

  const ctx = { today };
  const blank = (v: FollowUpView): FollowUpCard =>
    ({ key: v.key, label: v.label, blurb: v.blurb, count: null, ids: [] });

  if (all.unavailable) {
    return {
      cards: FOLLOW_UP_VIEWS.filter(v => v.card).map(blank),
      rows: [], allRows: [], view: view.key,
      tabs: FOLLOW_UP_VIEWS.map(v => ({ key: v.key, label: v.label, blurb: v.blurb, count: null })),
      today, timezone, readCount: 0, truncated: false,
      unavailable: true, detail: all.detail,
    };
  }

  // The header's search and the two dropdowns. Applied BEFORE the predicates, so a card counts what the
  // filters left -- the alternative is a card claiming 12 over a queue showing 3 with no explanation.
  const needle = (options.search ?? "").trim().toLowerCase();
  const filtered = all.items.filter(f => {
    if (options.priority && f.priority !== options.priority) return false;
    if (options.source && f.source !== options.source) return false;
    if (options.followUpType && f.follow_up_type !== options.followUpType) return false;
    if (!needle) return true;
    return `${f.patient_name ?? ""} ${f.reason ?? ""} ${f.kind ?? ""} ${FOLLOW_UP_TYPE_LABELS[f.follow_up_type] ?? ""}`.toLowerCase().includes(needle);
  });

  const idsFor = (v: FollowUpView) => filtered.filter(f => v.match(f, ctx)).map(f => f.id as string);

  return {
    cards: FOLLOW_UP_VIEWS.filter(v => v.card).map(v => {
      const ids = idsFor(v);
      return { key: v.key, label: v.label, blurb: v.blurb, count: ids.length, ids };
    }),
    rows: filtered.filter(f => view.match(f, ctx)),
    allRows: filtered,
    // ⚠ THE KEY, NOT THE OBJECT -- `view` holds `match`, and a function cannot cross into a client
    // component. `view.match` above is used HERE, on the server, which is where it belongs.
    view: view.key,
    tabs: FOLLOW_UP_VIEWS.map(v => ({ key: v.key, label: v.label, blurb: v.blurb, count: idsFor(v).length })),
    today, timezone,
    readCount: all.items.length,
    truncated: all.items.length >= WORKSPACE_READ_LIMIT,
    unavailable: false, detail: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-V5-007 PHASE 5, s7.5: THE RECALL QUEUE, AND THE FOLLOW-UPS WHOSE BOOKING DIED
//
// "Unbooked due follow-ups remain visible in Follow-ups and may enter a recall queue."
// "Missed follow-up appointments return to follow-up management according to the rule."
//
// ⚠ DERIVED, LIKE OVERDUE, AND FOR THE SAME REASON. recall-constants.ts states it at length: a stored
// queue needs something to run to become true, so it would be shortest for the practice that had
// forgotten most. This is computed from due_on against the practice's own today, every time.
//
// ⚠ AND THE STRANDED LIST IS THE HOLE IN migration 196'S TRIGGER, WHICH IS WHY IT IS NOT DEAD CODE.
//
// practice_follow_up_release_on_dead_appointment() puts a follow-up back on the board when its booking
// is cancelled or no-showed, and it is right to. But read its WHERE clause:
//
//     where f.appointment_id = new.id and f.status = 'SCHEDULED'
//
// A DEFERRED follow-up is not SCHEDULED. FOLLOW_UP_TRANSITIONS allows SCHEDULED -> DEFERRED, and
// deferFollowUp does not clear appointment_id -- so an obligation that was booked and then deferred
// keeps pointing at its appointment, the appointment is cancelled, and THE TRIGGER SKIPS IT. It sits
// there holding a dead booking with nothing to notice.
//
// The trigger is also `after update`, so a row that arrived already CANCELLED or NO_SHOW -- an import, a
// restore, any path that does not transition through a live status -- never fires it either.
//
// So this list is a READ over what is actually true rather than a second copy of the trigger's job: any
// live obligation whose appointment is dead, however it got that way. Where the trigger has already
// done its work the list is empty, which is the correct answer and not an absent one.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** One person in the queue. Every field is a string, a number, a boolean or null -- see the header. */
export type RecallEntry = {
  followUpId: string;
  patientId: string;
  patientName: string | null;
  reason: string | null;
  kind: string | null;
  priority: string | null;
  status: string;
  /** The date this is measured against: due_on, or deferred_until for a deferred obligation. */
  dueOn: string;
  /** Positive when the date has passed. 0 means due today. Never negative in this list. */
  daysOverdue: number;
  /**
   * ⚠ HOW MANY WAYS THERE ARE TO REACH THIS PERSON, AS A COUNT OF ROWS -- and null when the contact
   * register could not be read. A zero here is "we hold no phone number and no address for them", which
   * is a fact worth acting on; a null is "nobody knows", which is not.
   */
  contactRoutes: number | null;
  href: string;
};

export type StrandedEntry = RecallEntry & {
  appointmentId: string;
  /** CANCELLED or NO_SHOW. The reason the booking behind this obligation is not going to happen. */
  appointmentStatus: string;
  appointmentAt: string;
};

export type RecallQueue = {
  /** Overdue and unbooked, longest-waiting first. The queue proper. */
  overdue: RecallEntry[];
  /** Due today and unbooked. Not overdue yet, and one day from being. */
  dueToday: RecallEntry[];
  /** ⚠ SCHEDULED against a booking that is CANCELLED or NO_SHOW. Nobody is coming. */
  stranded: StrandedEntry[];
  /**
   * The subset of overdue + dueToday this practice holds no contact route for.
   *
   * ⚠ A SUBSET, NOT A FOURTH QUEUE. The same rows appear in `overdue` or `dueToday`; this list exists so
   * a screen can say "nine of these fourteen people cannot be rung" without counting anything twice.
   * Empty when the contact register could not be read -- and `contactUnavailable` says which it was.
   */
  unreachable: RecallEntry[];
  today: string;
  timezone: string;
  /** ⚠ True when the follow-ups themselves could not be read. Three empty lists are not three noughts. */
  unavailable: boolean;
  detail: string | null;
  /** ⚠ True when the CONTACT register could not be read, which leaves every contactRoutes null. */
  contactUnavailable: boolean;
  contactDetail: string | null;
  /** True when the appointment read behind `stranded` failed, so that list is a floor rather than a total. */
  strandedUnavailable: boolean;
  strandedDetail: string | null;
};

const EMPTY_RECALL = (today: string, timezone: string): RecallQueue => ({
  overdue: [], dueToday: [], stranded: [], unreachable: [],
  today, timezone,
  unavailable: false, detail: null,
  contactUnavailable: false, contactDetail: null,
  strandedUnavailable: false, strandedDetail: null,
});

/**
 * s7.5's recall queue, plus the stranded list nothing had ever produced.
 *
 * ⚠ ONE READ OF THE FOLLOW-UPS, THROUGH listFollowUps, so the queue cannot disagree with the board about
 * what is overdue. Two reads would be two chances for one to fail and the other to succeed, and a row
 * that moved between them would be in both lists or neither.
 *
 * ⚠ EVERY FAILURE IS ITS OWN FLAG. The follow-ups, the contact register and the appointments fail
 * independently, and collapsing them into one `unavailable` would blank a queue that was perfectly
 * readable because a contact lookup wobbled.
 */
export async function recallQueue(
  admin: any, workspaceId: string, options: { limit?: number } = {},
): Promise<RecallQueue> {
  const { timezone, today } = await workspaceClock(admin, workspaceId);

  const all = await listFollowUps(admin, workspaceId, {
    status: [...RECALLABLE_FOLLOW_UP_STATUSES, "SCHEDULED"],
    limit: options.limit ?? 500,
  });
  if (all.unavailable)
    return { ...EMPTY_RECALL(today, timezone), unavailable: true, detail: all.detail };

  // ⚠ THE DUE TEST IS deriveFollowUp's, NOT A SECOND COMPARISON. `dueInDays` is measured against
  // effectiveDueOn, so a DEFERRED obligation is judged against the date it was deferred TO -- reading
  // due_on here instead would put every deferred follow-up back in the queue it was deferred out of.
  //
  // ⚠ AND `!f.appointment_id` KEEPS THE TWO LISTS DISJOINT. A deferred obligation still holding a dead
  // booking belongs in `stranded`, where the action is "return it", not in the recall queue, where the
  // action is "ring them" -- and appearing in both would make the two figures add up to more people
  // than there are.
  const owed = all.items.filter(f =>
    (RECALLABLE_FOLLOW_UP_STATUSES as readonly string[]).includes(f.status) && !f.appointment_id);
  const due = owed.filter(f => f.dueInDays <= 0);

  // ⚠ ANY LIVE STATUS HOLDING AN APPOINTMENT, NOT JUST SCHEDULED. Restricting this to SCHEDULED would
  // reproduce the trigger's own blind spot exactly -- see the header -- and the case it misses is the
  // one nothing else in this product would ever surface.
  const scheduled = all.items.filter(f => !f.closed && f.appointment_id);

  // ── THE CONTACT REGISTER. Read for the people in the queue and nobody else.
  const patientIds = [...new Set([...due, ...scheduled].map(f => f.patient_id as string))];
  let routesByPatient: Map<string, number> | null = new Map();
  let contactDetail: string | null = null;
  if (patientIds.length > 0) {
    const { data: contacts, error: cErr } = await admin.from("practice_patient_contact")
      .select("patient_id, contact_type").eq("workspace_id", workspaceId).in("patient_id", patientIds);
    // ⚠ A FAILED READ IS NOT "NOBODY HAS A PHONE NUMBER". Reported as null on every row, because
    // "we cannot reach these nine people" is an instruction to do something, and it must not be printed
    // on the strength of a query that failed.
    if (cErr || contacts == null) { routesByPatient = null; contactDetail = cErr?.message ?? "the contact register came back as neither rows nor an error"; }
    else {
      for (const c of contacts as any[]) {
        // An address is not a way to recall somebody the same afternoon. Phone and email only.
        if (c.contact_type !== "phone" && c.contact_type !== "email") continue;
        routesByPatient.set(c.patient_id, (routesByPatient.get(c.patient_id) ?? 0) + 1);
      }
    }
  }

  const entry = (f: ListedFollowUp): RecallEntry => ({
    followUpId: f.id as string,
    patientId: f.patient_id as string,
    patientName: f.patient_name,
    reason: (f.reason as string | null) ?? null,
    kind: (f.kind as string | null) ?? null,
    priority: (f.priority as string | null) ?? null,
    status: f.status as string,
    dueOn: f.effectiveDueOn as string,
    daysOverdue: -f.dueInDays,
    contactRoutes: routesByPatient === null ? null : (routesByPatient.get(f.patient_id as string) ?? 0),
    href: `/practice/follow-ups?followUp=${f.id}`,
  });

  const overdue = due.filter(f => f.dueInDays < 0).map(entry)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
  const dueToday = due.filter(f => f.dueInDays === 0).map(entry);

  // ── THE STRANDED LIST. The appointments behind the SCHEDULED obligations, and which of them are dead.
  let stranded: StrandedEntry[] = [];
  let strandedUnavailable = false;
  let strandedDetail: string | null = null;
  if (scheduled.length > 0) {
    const { data: appts, error: aErr } = await admin.from("practice_appointment")
      .select("id, status, scheduled_at").eq("workspace_id", workspaceId)
      .in("id", scheduled.map(f => f.appointment_id as string));
    if (aErr || appts == null) {
      // ⚠ NOT AN EMPTY STRANDED LIST. An empty one says "every booking behind a follow-up is alive",
      // which is the reassuring answer and the one this read cannot support.
      strandedUnavailable = true;
      strandedDetail = aErr?.message ?? "the appointments behind your booked follow-ups came back as neither rows nor an error";
    } else {
      const byId = new Map((appts as any[]).map(a => [a.id as string, a]));
      stranded = scheduled.flatMap(f => {
        const a = byId.get(f.appointment_id as string);
        if (!a || !(DEAD_APPOINTMENT_STATUSES as readonly string[]).includes(a.status)) return [];
        return [{
          ...entry(f),
          appointmentId: a.id as string,
          appointmentStatus: a.status as string,
          appointmentAt: a.scheduled_at as string,
        }];
      }).sort((x, y) => String(x.appointmentAt).localeCompare(String(y.appointmentAt)));
    }
  }

  return {
    overdue, dueToday, stranded,
    unreachable: routesByPatient === null ? [] : [...overdue, ...dueToday].filter(e => e.contactRoutes === 0),
    today, timezone,
    unavailable: false, detail: null,
    contactUnavailable: routesByPatient === null, contactDetail,
    strandedUnavailable, strandedDetail,
  };
}

/**
 * s7.5's "missed follow-up appointments return to follow-up management": put a stranded obligation back
 * in the queue.
 *
 * ⚠ IT VERIFIES THE BOOKING IS ACTUALLY DEAD BEFORE IT UNBOOKS ANYTHING. Without that check this is not
 * "return a missed follow-up", it is "unbook any follow-up", and the difference is a patient whose
 * appointment on Thursday quietly stopped existing.
 *
 * ⚠ AND IT GOES THROUGH closeFollowUp RATHER THAN AN UPDATE, so the state machine, the event trail, the
 * audit entry and the plan reconciliation all happen exactly as they do when a human clicks. A second
 * write path for the same act is how two of them stop agreeing -- settleFollowUpsForEncounter took the
 * same decision for the same reason.
 */
export async function returnStrandedFollowUp(admin: any, args: {
  workspaceId: string; followUpId: string; note?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; appointmentStatus: string }>> {
  const { data: f, error: fErr } = await admin.from("practice_follow_up")
    .select("id, status, appointment_id")
    .eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
  // ⚠ A FAILED READ IS NOT A MISSING FOLLOW-UP. NOT_FOUND would tell somebody their obligation is gone.
  if (fErr) return { ok: false, status: 500, code: "READ_FAILED", message: fErr.message };
  if (!f) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // ⚠ NOT "SCHEDULED ONLY". The case migration 196's trigger misses is a DEFERRED obligation that kept
  // its appointment id, so refusing everything but SCHEDULED here would refuse the only rows this
  // function exists for. A closed one is refused: reopening a completed obligation is a different act.
  if (CLOSED_FOLLOW_UP_STATUSES.includes(f.status) || f.status === "DRAFT")
    return {
      ok: false, status: 422, code: "NOT_LIVE",
      message: `this follow-up is ${String(f.status).toLowerCase()}, so it is not waiting on a booking`,
    };
  if (f.status === "OPEN")
    return {
      ok: false, status: 422, code: "ALREADY_OPEN",
      message: "this follow-up is already back in the queue",
    };
  if (!f.appointment_id)
    return {
      ok: false, status: 422, code: "NO_BOOKING",
      message: "this follow-up reads as booked but names no appointment, so there is nothing to check",
    };

  const { data: appt, error: aErr } = await admin.from("practice_appointment")
    .select("id, status").eq("id", f.appointment_id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (aErr) return { ok: false, status: 500, code: "READ_FAILED", message: aErr.message };
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!(DEAD_APPOINTMENT_STATUSES as readonly string[]).includes(appt.status))
    return {
      ok: false, status: 422, code: "BOOKING_STILL_LIVE",
      message: `that appointment is ${appt.status}, so somebody is still expected. Cancel it first if it is not going to happen.`,
    };

  const back = await closeFollowUp(admin, {
    workspaceId: args.workspaceId, followUpId: args.followUpId, to: "OPEN",
    // The words go on the transition, which is where "why is this open again" is answerable.
    outcome: args.note?.trim()
      || `returned to the queue: the appointment behind it is ${String(appt.status).toLowerCase().replace(/_/g, " ")}`,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!back.ok) return back;

  return { ok: true, data: { status: "OPEN", appointmentStatus: appt.status as string } };
}

/** One obligation with its own history, for the panel beside it. */
export async function getFollowUp(admin: any, workspaceId: string, followUpId: string) {
  const { data: f } = await admin.from("practice_follow_up")
    .select("*").eq("id", followUpId).eq("workspace_id", workspaceId).maybeSingle();
  if (!f) return null;

  const [{ data: events }, { data: patient }, { data: appt }] = await Promise.all([
    // from_due_on/to_due_on are selected because CPR-FUP-002 s7's promise -- "the original due date
    // remains available in the audit log" -- is only kept if something reads them back out.
    admin.from("practice_follow_up_event").select("from_status, to_status, note, occurred_at, from_due_on, to_due_on").eq("workspace_id", workspaceId).eq("follow_up_id", followUpId).order("occurred_at"),
    admin.from("practice_patient").select("id, display_name").eq("workspace_id", workspaceId).eq("id", f.patient_id).maybeSingle(),
    f.appointment_id
      ? admin.from("practice_appointment").select("id, scheduled_at, status").eq("workspace_id", workspaceId).eq("id", f.appointment_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const today = await workspaceToday(admin, workspaceId);
  return {
    followUp: deriveFollowUp(f, today, appt?.scheduled_at),
    patient, appointment: appt ?? null, events: events ?? [],
  };
}
