import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { FOLLOW_UP_TRANSITIONS, CLOSED_FOLLOW_UP_STATUSES, FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES, FOLLOW_UP_OUTCOMES } from "@/lib/practice/follow-up-constants";
import { dueDateFrom, workspaceClock } from "@/lib/practice/practice-time";

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
  const dueInDays = daysBetween(today, row.due_on);
  const bookedFor = appointmentAt ? String(appointmentAt).slice(0, 10) : null;
  return {
    ...row,
    dueInDays,
    overdue: !closed && row.status === "OPEN" && dueInDays < 0,
    late: !closed && row.status === "SCHEDULED" && bookedFor !== null && bookedFor > row.due_on,
    bookedFor,
    closed,
  };
}

async function recordEvent(admin: any, workspaceId: string, followUpId: string, from: string | null, to: string, actorId: string, note?: string) {
  await admin.from("practice_follow_up_event").insert({
    workspace_id: workspaceId, follow_up_id: followUpId, from_status: from, to_status: to,
    note: note ?? null, actor_id: actorId,
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
  kind?: string; reason: string; dueOn?: string; intervalCode?: string; priority?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; dueOn: string }>> {
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

  const { data: f, error } = await admin.from("practice_follow_up").insert({
    workspace_id: args.workspaceId, patient_id: args.patientId, origin_encounter_id: originEncounterId,
    problem_id: args.problemId ?? null, diagnosis_id: args.diagnosisId ?? null,
    kind, reason: args.reason.trim(), due_on: dueOn, priority, status: "OPEN",
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, due_on").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await recordEvent(admin, args.workspaceId, f.id, null, "OPEN", args.actorId, args.reason.trim());
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_raised",
    payload: { followUpId: f.id, patientId: args.patientId, dueOn, kind }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: f.id as string, dueOn: f.due_on as string } };
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
    })
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
    .select("id, status, patient_id, plan_id, record_version").eq("id", args.followUpId).eq("workspace_id", args.workspaceId).maybeSingle();
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
  // Reopening lets go of the dead booking; otherwise the board offers an appointment nobody will attend.
  // It also clears the outcome, because `outcome` describes HOW THIS WAS CLOSED and it is no longer
  // closed. The words are not lost -- the event trail keeps them against the move that wrote them, which
  // is where "why was this given up on in March" is actually answerable.
  if (args.to === "OPEN") patch.appointment_id = null;

  const { data: updated } = await admin.from("practice_follow_up")
    .update(patch).eq("id", f.id).eq("record_version", f.record_version).select("id").maybeSingle();
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
  return { ok: true, data: { status: args.to } };
}

type ListFilter = { patientId?: string; status?: string[]; limit?: number };

/** Follow-ups with their derived state, their patient's name, and any booking behind them. */
export async function listFollowUps(admin: any, workspaceId: string, filter: ListFilter = {}) {
  let q = admin.from("practice_follow_up")
    .select("id, patient_id, origin_encounter_id, problem_id, diagnosis_id, plan_id, step_number, kind, reason, due_on, priority, status, appointment_id, closing_encounter_id, outcome, outcome_code, closed_at, created_at, record_version")
    .eq("workspace_id", workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.status?.length) q = q.in("status", filter.status);

  const { data } = await q.order("due_on").limit(filter.limit ?? 200);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const today = await workspaceToday(admin, workspaceId);
  const apptIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))];
  const [{ data: patients }, appts] = await Promise.all([
    admin.from("practice_patient").select("id, display_name").in("id", [...new Set(rows.map(r => r.patient_id))]),
    apptIds.length
      ? admin.from("practice_appointment").select("id, scheduled_at, status").in("id", apptIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));
  const apptById = new Map((((appts as any).data ?? []) as any[]).map(a => [a.id, a]));

  return rows.map(r => ({
    ...deriveFollowUp(r, today, apptById.get(r.appointment_id)?.scheduled_at),
    patient_name: nameById.get(r.patient_id) ?? null,
    appointment_status: apptById.get(r.appointment_id)?.status ?? null,
  }));
}

/**
 * The board at /practice/follow-ups, in the four groups a practitioner actually works in.
 *
 * OVERDUE FIRST, ALWAYS. It is the group the module exists for, and putting today's work above it would
 * bury the people who have been waiting longest under the people who have been waiting least.
 */
export async function followUpBoard(admin: any, workspaceId: string, horizonDays = 14) {
  const open = await listFollowUps(admin, workspaceId, { status: ["OPEN", "SCHEDULED"] });
  const closed = await listFollowUps(admin, workspaceId, { status: ["COMPLETED", "MISSED", "CANCELLED"], limit: 25 });

  return {
    overdue: open.filter(f => f.overdue),
    dueSoon: open.filter(f => !f.overdue && f.status === "OPEN" && f.dueInDays <= horizonDays),
    scheduled: open.filter(f => f.status === "SCHEDULED"),
    later: open.filter(f => !f.overdue && f.status === "OPEN" && f.dueInDays > horizonDays),
    recentlyClosed: closed.sort((a, b) => String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? ""))).slice(0, 10),
    horizonDays,
  };
}

/** One obligation with its own history, for the panel beside it. */
export async function getFollowUp(admin: any, workspaceId: string, followUpId: string) {
  const { data: f } = await admin.from("practice_follow_up")
    .select("*").eq("id", followUpId).eq("workspace_id", workspaceId).maybeSingle();
  if (!f) return null;

  const [{ data: events }, { data: patient }, { data: appt }] = await Promise.all([
    admin.from("practice_follow_up_event").select("from_status, to_status, note, occurred_at").eq("follow_up_id", followUpId).order("occurred_at"),
    admin.from("practice_patient").select("id, display_name").eq("id", f.patient_id).maybeSingle(),
    f.appointment_id
      ? admin.from("practice_appointment").select("id, scheduled_at, status").eq("id", f.appointment_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const today = await workspaceToday(admin, workspaceId);
  return {
    followUp: deriveFollowUp(f, today, appt?.scheduled_at),
    patient, appointment: appt ?? null, events: events ?? [],
  };
}
