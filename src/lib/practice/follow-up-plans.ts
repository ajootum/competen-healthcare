import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { workspaceClock, dueDateFrom } from "@/lib/practice/practice-time";
import { deriveFollowUp } from "@/lib/practice/follow-ups";
import {
  CLOSED_FOLLOW_UP_STATUSES, FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES, FOLLOW_UP_OUTCOMES,
} from "@/lib/practice/follow-up-constants";

// CPR-140 FOLLOW-UP PLANS, TEMPLATES AND THE PATIENT VIEW -- the structural half, built after
// CPR-AUDIT-001.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A PLAN IS A GROUPING, NOT A NEW KIND OF OBLIGATION.
//
// Each step is an ordinary practice_follow_up with everything that already implies: its own due date,
// its own booking, its own event trail, its own DB-enforced release when a booking dies, and closing
// still requires saying what happened. A plan that owned its steps would be a second place a clinical
// commitment can live, and the first question at any handover would be which one is real.
//
// So every function here creates and reads follow-ups. Nothing about a step is stored twice.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// OFFSETS RUN FROM THE PLAN'S START, NEVER FROM THE PREVIOUS STEP. "Three months after the operation" is
// what a surgeon means. Chaining offsets makes every later date drift when one earlier step is
// rescheduled, so a patient who came back a fortnight late for their two-week review would silently have
// their three-month review pushed to three and a half.
//
// ADHERENCE IS A COUNT AND ITS DENOMINATOR -- "6 of 7 completed", never 86%. The comp draws both; only
// one of them is safe over three appointments. Same doctrine as CPR-270's.
//
// NOTHING HERE SENDS A REMINDER. The specification asks for a reminder engine over SMS, email, app,
// voice and WhatsApp, and this product has no delivery channel of any kind -- the position CPR-320 and
// CPR-340 were both built on. What replaces it is honest and, for a practitioner, most of the value: the
// recall queue is DERIVED at read time, so a practice that has not opened the app for a week still sees
// every overdue patient the moment it does. A reminder engine needs something to run. A derived queue
// does not.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export type StepInput = { offsetDays: number; reason: string; kind?: string; priority?: string };

// ── TEMPLATES ────────────────────────────────────────────────────────────────────────────────────────

/** The practice's reusable plan shapes. Workspace-scoped only -- see migration 206 s1. */
export async function listPlanTemplates(admin: any, workspaceId: string, opts: { includeInactive?: boolean } = {}) {
  let q = admin.from("practice_follow_up_template")
    .select("id, code, title, description, active, created_at").eq("workspace_id", workspaceId);
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data } = await q.order("title");
  const templates = (data ?? []) as any[];
  if (templates.length === 0) return [];

  const { data: steps } = await admin.from("practice_follow_up_template_step")
    .select("id, template_id, position, offset_days, kind, reason, priority")
    .in("template_id", templates.map(t => t.id)).order("position");

  const byTemplate = new Map<string, any[]>();
  for (const s of ((steps ?? []) as any[])) {
    byTemplate.set(s.template_id, [...(byTemplate.get(s.template_id) ?? []), s]);
  }
  return templates.map(t => ({ ...t, steps: byTemplate.get(t.id) ?? [] }));
}

export async function createPlanTemplate(admin: any, args: {
  workspaceId: string; code: string; title: string; description?: string; steps: StepInput[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };
  if (args.steps.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a template with no steps would create nothing" };

  const bad = validateSteps(args.steps);
  if (bad) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: bad };

  const { data: t, error } = await admin.from("practice_follow_up_template").insert({
    workspace_id: args.workspaceId, code, title: args.title.trim(),
    description: args.description?.trim() || null, created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "CODE_IN_USE", message: `this practice already has a plan coded "${code}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  const { error: stepError } = await admin.from("practice_follow_up_template_step").insert(
    sortedSteps(args.steps).map((s, i) => ({
      template_id: t.id, position: i + 1, offset_days: s.offsetDays, reason: s.reason.trim(),
      kind: FOLLOW_UP_KINDS.some(([k]) => k === s.kind) ? s.kind : "review",
      priority: (FOLLOW_UP_PRIORITIES as readonly string[]).includes(s.priority ?? "") ? s.priority : "routine",
    })),
  );
  // A template with no steps creates nothing, so a half-created one is worse than none at all.
  if (stepError) {
    await admin.from("practice_follow_up_template").delete().eq("id", t.id);
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: stepError.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_template_created",
    payload: { templateId: t.id, code, steps: args.steps.length }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

function validateSteps(steps: StepInput[]): string | null {
  for (const s of steps) {
    if (!s.reason?.trim()) return "every step must say what it is for";
    if (!Number.isInteger(s.offsetDays) || s.offsetDays < 0)
      return "an offset must be a whole number of days, and not negative";
    if (s.offsetDays > 3650) return "an offset beyond ten years is almost certainly a typo";
  }
  // TWO STEPS ON THE SAME DAY ARE REFUSED. A plan that books a patient twice on one date is a plan
  // somebody has to unpick by hand, and it is far more often a mistyped offset than an intention.
  const days = steps.map(s => s.offsetDays);
  if (new Set(days).size !== days.length) return "two steps fall on the same day; give them different offsets";
  return null;
}

const sortedSteps = (steps: StepInput[]) => [...steps].sort((a, b) => a.offsetDays - b.offsetDays);

export async function setTemplateActive(admin: any, args: {
  workspaceId: string; templateId: string; active: boolean; actorId: string; correlationId: string;
}): Promise<EngineResult<{ active: boolean }>> {
  const { data: t } = await admin.from("practice_follow_up_template")
    .select("id").eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { error } = await admin.from("practice_follow_up_template")
    .update({ active: args.active, updated_at: nowIso(), updated_by: args.actorId }).eq("id", t.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // RETIRING A TEMPLATE DOES NOT TOUCH THE PLANS MADE FROM IT. Those are commitments to real patients;
  // the template is only the shape they were cut from.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: args.active ? "practice.followup_template_activated" : "practice.followup_template_retired",
    payload: { templateId: t.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { active: args.active } };
}

// ── PLANS ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Create a plan and every follow-up in it, in one act.
 *
 * THE STEPS ARE CREATED DIRECTLY RATHER THAN THROUGH createFollowUp, and this is the one place that is
 * the right call: createFollowUp re-reads the patient, re-validates the encounter and re-resolves the
 * clock on every call, so a five-step plan would do that five times over facts checked once here. The
 * checks themselves are not skipped -- they are done once, above, for the plan.
 */
export async function createPlan(admin: any, args: {
  workspaceId: string; patientId: string; originEncounterId?: string | null;
  templateId?: string | null; title?: string; startsOn?: string; steps?: StepInput[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; steps: { id: string; dueOn: string; reason: string }[] }>> {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status !== "active")
    return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };

  let originEncounterId: string | null = null;
  if (args.originEncounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.originEncounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    originEncounterId = enc.id;
  }

  let title = args.title?.trim() ?? "";
  let steps: StepInput[] = args.steps ?? [];
  let templateId: string | null = null;

  if (args.templateId) {
    const { data: t } = await admin.from("practice_follow_up_template")
      .select("id, title, active").eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    // A RETIRED TEMPLATE CANNOT START A NEW PLAN. Retiring one is how a practice says "we do not do it
    // that way any more"; letting it still be picked would make that statement mean nothing.
    if (!t.active)
      return { ok: false, status: 422, code: "TEMPLATE_RETIRED", message: "that plan template has been retired" };

    const { data: rows } = await admin.from("practice_follow_up_template_step")
      .select("offset_days, reason, kind, priority").eq("template_id", t.id).order("position");
    steps = ((rows ?? []) as any[]).map(s => ({
      offsetDays: s.offset_days, reason: s.reason, kind: s.kind, priority: s.priority,
    }));
    templateId = t.id;
    if (!title) title = t.title;
  }

  if (steps.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a plan needs at least one step" };
  if (!title) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a plan needs a title" };
  const bad = validateSteps(steps);
  if (bad) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: bad };

  const { today } = await workspaceClock(admin, args.workspaceId);
  const startsOn = args.startsOn ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "startsOn must be a date (YYYY-MM-DD)" };

  const { data: plan, error } = await admin.from("practice_follow_up_plan").insert({
    workspace_id: args.workspaceId, patient_id: args.patientId, origin_encounter_id: originEncounterId,
    template_id: templateId, title, starts_on: startsOn,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const ordered = sortedSteps(steps);
  const { data: created, error: stepError } = await admin.from("practice_follow_up").insert(
    ordered.map((s, i) => ({
      workspace_id: args.workspaceId, patient_id: args.patientId, origin_encounter_id: originEncounterId,
      plan_id: plan.id, step_number: i + 1,
      kind: FOLLOW_UP_KINDS.some(([k]) => k === s.kind) ? s.kind : "review",
      reason: s.reason.trim(), due_on: dueDateFrom(startsOn, s.offsetDays),
      priority: (FOLLOW_UP_PRIORITIES as readonly string[]).includes(s.priority ?? "") ? s.priority : "routine",
      status: "OPEN", created_by: args.actorId, updated_by: args.actorId,
    })),
  ).select("id, due_on, reason, step_number");

  // A PLAN WITH NO STEPS IS A LIE ON THE PATIENT'S RECORD -- it says continuity was arranged when nothing
  // was. Rolled back rather than left standing, exactly as a template with no steps is.
  if (stepError || !created) {
    await admin.from("practice_follow_up_plan").delete().eq("id", plan.id);
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: stepError?.message ?? "the plan's steps could not be created" };
  }

  const rows = (created as any[]).sort((a, b) => a.step_number - b.step_number);
  for (const r of rows) {
    await admin.from("practice_follow_up_event").insert({
      workspace_id: args.workspaceId, follow_up_id: r.id, from_status: null, to_status: "OPEN",
      note: `Step ${r.step_number} of "${title}"`, actor_id: args.actorId,
    });
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_plan_created",
    payload: { planId: plan.id, patientId: args.patientId, templateId, steps: rows.length, startsOn },
    correlationId: args.correlationId,
  });
  return {
    ok: true,
    data: { id: plan.id as string, steps: rows.map(r => ({ id: r.id, dueOn: r.due_on, reason: r.reason })) },
  };
}

/**
 * Stop a plan.
 *
 * THE OPEN STEPS ARE CANCELLED WITH THE REASON ON EACH ONE, not orphaned. A discontinued plan whose steps
 * stayed OPEN would leave the board showing obligations nobody intends to keep -- which is the specific
 * failure that makes a follow-up board stop being trusted. Closed steps are left exactly as they are:
 * what already happened is not rewritten by a later decision.
 */
export async function discontinuePlan(admin: any, args: {
  workspaceId: string; planId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ cancelled: number }>> {
  const reason = args.reason.trim();
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this plan is being stopped" };

  const { data: plan } = await admin.from("practice_follow_up_plan")
    .select("id, status").eq("id", args.planId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!plan) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (plan.status !== "ACTIVE")
    return { ok: false, status: 422, code: "NOT_ACTIVE", message: `this plan is already ${plan.status.toLowerCase()}` };

  const { data: open } = await admin.from("practice_follow_up")
    .select("id, status").eq("plan_id", plan.id).in("status", ["OPEN", "SCHEDULED"]);
  const rows = (open ?? []) as any[];

  for (const f of rows) {
    await admin.from("practice_follow_up").update({
      status: "CANCELLED", outcome: reason, closed_at: nowIso(), closed_by: args.actorId,
      updated_at: nowIso(), updated_by: args.actorId,
    }).eq("id", f.id);
    await admin.from("practice_follow_up_event").insert({
      workspace_id: args.workspaceId, follow_up_id: f.id, from_status: f.status, to_status: "CANCELLED",
      note: `Plan discontinued: ${reason}`, actor_id: args.actorId,
    });
  }

  await admin.from("practice_follow_up_plan").update({
    status: "DISCONTINUED", discontinued_reason: reason, updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", plan.id);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.followup_plan_discontinued",
    payload: { planId: plan.id, cancelled: rows.length, reason }, correlationId: args.correlationId,
  });
  return { ok: true, data: { cancelled: rows.length } };
}

/**
 * A plan completes itself when its last step closes.
 *
 * CALLED FROM THE CLOSE PATH RATHER THAN SWEPT FOR. A nightly job that marked plans complete would be
 * the stored-overdue mistake again: it needs something to run, and a practice that has not opened the
 * app is exactly where nothing runs. Reconciled here, at the moment the fact becomes true.
 */
export async function reconcilePlan(admin: any, workspaceId: string, planId: string): Promise<void> {
  const { data: plan } = await admin.from("practice_follow_up_plan")
    .select("id, status").eq("id", planId).eq("workspace_id", workspaceId).maybeSingle();
  if (!plan || plan.status !== "ACTIVE") return;

  const { data: steps } = await admin.from("practice_follow_up")
    .select("status").eq("plan_id", planId);
  const rows = (steps ?? []) as any[];
  if (rows.length === 0) return;
  if (!rows.every(s => CLOSED_FOLLOW_UP_STATUSES.includes(s.status))) return;

  await admin.from("practice_follow_up_plan")
    .update({ status: "COMPLETED", updated_at: nowIso() }).eq("id", planId);
}

// ── THE PATIENT VIEW ─────────────────────────────────────────────────────────────────────────────────

/**
 * Everything CPR-140's comp puts behind its tabs, for one patient: overview, upcoming, past, missed,
 * recall, monitoring, outcomes and the timeline.
 *
 * ONE READ, EIGHT VIEWS. The tabs are groupings of the same rows rather than eight queries, so no two
 * tabs can disagree about the same follow-up -- which is exactly what happens when a "missed" count and
 * a "missed" list are fetched separately.
 */
export async function patientFollowUps(admin: any, workspaceId: string, patientId: string) {
  const { today } = await workspaceClock(admin, workspaceId);

  const [{ data: rows }, { data: plans }] = await Promise.all([
    admin.from("practice_follow_up")
      .select("id, plan_id, step_number, kind, reason, due_on, priority, status, appointment_id, outcome, outcome_code, closed_at, origin_encounter_id, created_at")
      .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("due_on"),
    admin.from("practice_follow_up_plan")
      .select("id, title, status, starts_on, template_id, origin_encounter_id, discontinued_reason, created_at")
      .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("created_at", { ascending: false }),
  ]);

  const all = ((rows ?? []) as any[]);
  const appointmentIds = all.map(r => r.appointment_id).filter(Boolean);
  const bookings = appointmentIds.length
    ? (await admin.from("practice_appointment").select("id, scheduled_at, status").in("id", appointmentIds)).data ?? []
    : [];
  const bookingById = new Map(((bookings) as any[]).map(b => [b.id, b]));

  const derived = all.map(r => deriveFollowUp(r, today, bookingById.get(r.appointment_id)?.scheduled_at ?? null));

  const open = derived.filter(f => !f.closed);
  const closed = derived.filter(f => f.closed);

  // ADHERENCE AS A COUNT AND ITS DENOMINATOR. The comp draws "86%" and "6 / 7 completed" side by side;
  // only the second survives contact with three appointments. The denominator is every follow-up that
  // has REACHED a conclusion -- counting still-open ones would make a patient look non-adherent for
  // appointments that have not happened yet.
  const concluded = closed.filter(f => f.status === "COMPLETED" || f.status === "MISSED");
  const adherence = {
    completed: concluded.filter(f => f.status === "COMPLETED").length,
    concluded: concluded.length,
    stillOpen: open.length,
  };

  const outcomes = FOLLOW_UP_OUTCOMES.map(([code, label]) => ({
    code, label, total: closed.filter(f => f.outcome_code === code).length,
  }));
  const uncoded = closed.filter(f => f.status === "COMPLETED" && !f.outcome_code).length;

  return {
    today,
    plans: ((plans ?? []) as any[]).map(p => ({
      ...p,
      steps: derived.filter(f => f.plan_id === p.id).sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0)),
    })),
    // The comp's tabs, in its order.
    overview: { next: open.slice().sort((a, b) => a.due_on.localeCompare(b.due_on))[0] ?? null, openTotal: open.length },
    upcoming: open.filter(f => f.dueInDays >= 0).sort((a, b) => a.due_on.localeCompare(b.due_on)),
    past: closed.filter(f => f.status === "COMPLETED").sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at))),
    missed: closed.filter(f => f.status === "MISSED"),
    // The recall queue for THIS patient: overdue with nothing booked. Derived, never stored -- the
    // reason the whole module gives for overdue.
    recall: open.filter(f => f.overdue),
    monitoring: derived.filter(f => f.kind === "monitoring"),
    outcomes: { rows: outcomes, uncoded, total: closed.length },
    adherence,
    all: derived,
  };
}

/**
 * The practice's recall queue: patients overdue with nothing booked, worst first.
 *
 * WHAT REPLACES THE REMINDER ENGINE. The specification asks for SMS, email, app, voice and WhatsApp
 * reminders; this product has no delivery channel, so nothing is sent and nothing pretends to be. A
 * derived queue is what remains, and for a practitioner it is most of the value -- it needs nothing to
 * run, so a practice that has not opened the app for a fortnight sees the full backlog the moment it
 * does, rather than a log of messages that were never sent.
 */
export async function recallQueue(admin: any, workspaceId: string, opts: { limit?: number } = {}) {
  const { today } = await workspaceClock(admin, workspaceId);

  const { data: rows } = await admin.from("practice_follow_up")
    .select("id, patient_id, plan_id, step_number, kind, reason, due_on, priority, status, appointment_id")
    .eq("workspace_id", workspaceId).eq("status", "OPEN").lt("due_on", today)
    .order("due_on").limit(opts.limit ?? 200);

  const all = ((rows ?? []) as any[]).map(r => deriveFollowUp(r, today, null));
  if (all.length === 0) return { today, patients: [], total: 0 };

  const { data: patients } = await admin.from("practice_patient")
    .select("id, display_name, status").in("id", [...new Set(all.map(r => r.patient_id))]);
  const byId = new Map(((patients ?? []) as any[]).map(p => [p.id, p]));

  // GROUPED BY PATIENT, because the unit of work is a person to contact, not a row to tick. Three
  // overdue follow-ups on one patient is one phone call.
  const byPatient = new Map<string, any>();
  for (const f of all) {
    const patient = byId.get(f.patient_id);
    // An archived or merged patient is not somebody to recall. They are filtered rather than shown
    // greyed out: a recall list is a list of calls to make.
    if (!patient || patient.status !== "active") continue;
    const entry = byPatient.get(f.patient_id) ?? {
      patientId: f.patient_id, name: patient.display_name, followUps: [], worstOverdueDays: 0, urgent: false,
    };
    entry.followUps.push(f);
    entry.worstOverdueDays = Math.max(entry.worstOverdueDays, -f.dueInDays);
    entry.urgent = entry.urgent || f.priority === "urgent";
    byPatient.set(f.patient_id, entry);
  }

  const patientsOut = [...byPatient.values()].sort((a, b) => {
    // Urgent first, then longest overdue. Ordered by what it costs to leave, as CPR-300's alerts are.
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.worstOverdueDays - a.worstOverdueDays;
  });
  return { today, patients: patientsOut, total: patientsOut.reduce((n, p) => n + p.followUps.length, 0) };
}

/**
 * How the practice's follow-ups have turned out. CPR-140 s9 "clinical outcomes by follow-up".
 *
 * COUNTS AND A DENOMINATOR, and it names how many carry no code at all -- a summary that quietly dropped
 * the uncoded ones would make a practice look more consistent than it is.
 */
export async function outcomeSummary(admin: any, workspaceId: string, opts: { fromDay?: string; toDay?: string } = {}) {
  let q = admin.from("practice_follow_up")
    .select("outcome_code, kind, status").eq("workspace_id", workspaceId)
    .in("status", ["COMPLETED", "MISSED", "CANCELLED"]);
  if (opts.fromDay) q = q.gte("closed_at", `${opts.fromDay}T00:00:00Z`);
  if (opts.toDay) q = q.lte("closed_at", `${opts.toDay}T23:59:59Z`);

  const { data } = await q.limit(1000);
  const rows = (data ?? []) as any[];
  const completed = rows.filter(r => r.status === "COMPLETED");

  return {
    rows: FOLLOW_UP_OUTCOMES.map(([code, label]) => ({
      code, label, total: completed.filter(r => r.outcome_code === code).length,
    })),
    completed: completed.length,
    uncoded: completed.filter(r => !r.outcome_code).length,
    missed: rows.filter(r => r.status === "MISSED").length,
    cancelled: rows.filter(r => r.status === "CANCELLED").length,
    concluded: rows.length,
    truncated: rows.length === 1000,
  };
}
