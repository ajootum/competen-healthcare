import { audit } from "@/lib/practice/audit";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { editableEncounter, type EngineResult } from "@/lib/practice/encounters";
import { LIVE_STATUSES, LOCKED_STATUSES } from "@/lib/practice/encounter-constants";
import { todaysPlan } from "@/lib/practice/activity";
import { practiceToday } from "@/lib/practice/practice-time";
import {
  REFERRAL_STATUS_CODES, encounterWarnings, type EncounterWarning,
} from "@/lib/practice/encounter-workspace-constants";

// CPR-ENC-001 s9 (the Encounters dashboard) and CPR-ENC-002 (the encounter screen), on migration 238.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THREE STATES, EVERYWHERE, AND THEY ARE NOT INTERCHANGEABLE.
//
// Every read on this screen answers one of three things and each Panel below says which:
//
//   permitted: false   the caller does not hold the capability. Nothing was read. The screen says so
//                      rather than drawing an empty list, because "you cannot see this" and "there is
//                      none of it" lead a clinician to different actions.
//   unavailable: true  the read was attempted and FAILED. `items: []` is not an answer.
//   items: []          the read succeeded and there is genuinely nothing.
//
// This is not defensive style for its own sake. An empty Open Encounters list means "everything is
// finished, go home"; a failed one means "there may be an unsigned consultation from this morning that
// you cannot see". Collapsing them is the bug class this codebase has now written down four times.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ENGINE DOES NOT DO
//
//   It does not derive a milestone (see longitudinal-constants.ts).
//   It does not record an investigation RESULT -- there is no such column and there must not be one.
//   It does not send a referral. It records that one was decided on.
//   It does not compute a rate, a target, or a trend against a baseline nobody established.
//   It does not refuse a closure over a missing field. CPR-ENC-002 s7 asks for warnings; warnings are
//   what it returns.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAP_LIST = "encounter.list";
const CAP_EDIT = "encounter.edit";
const CAP_FOLLOWUP = "followup.view";
const CAP_INBOX = "inbox.review";
const CAP_DOCUMENT = "document.view";
// The day's plan belongs to the home view's capability, not to encounters. Both are real codes in
// practice_role_capabilities -- verified against the migrations, because a plausible-looking invented
// code disables a feature silently and costs nothing at compile time.
const CAP_PLAN_VIEW = "practice.home.view";

/** A read that knows which of the three answers it is giving. */
export type Panel<T> = {
  items: T[];
  /** False when the caller holds no capability for this. Nothing was read. */
  permitted: boolean;
  /** True when a read was attempted and failed. `items` is empty but that is not the answer. */
  unavailable: boolean;
  detail: string | null;
};

const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

// ── CPR-ENC-001 s9: THE DASHBOARD ───────────────────────────────────────────────────────────────────

export type DashboardEncounter = {
  id: string;
  patientId: string;
  patientName: string | null;
  /** Null when the patient read failed. A missing name is NOT the same as "Unknown patient". */
  patientNameUnavailable: boolean;
  status: string;
  entryPathway: string;
  encounterMode: string;
  reasonForVisit: string | null;
  startedAt: string;
  completedAt: string | null;
  signedAt: string | null;
  activityId: string | null;
  sessionTitle: string | null;
  outcome: string | null;
  /**
   * Minutes since it started, measured once HERE.
   *
   * ⚠ IT IS COMPUTED IN THE ENGINE, NOT IN THE PAGE, and that is not a style preference: calling
   * Date.now() during a React render is an impure call the compiler rejects, and the elapsed time of a
   * consultation is data the loader owns anyway. Null when the timestamp could not be parsed -- an
   * unreadable duration renders as an em dash, never as 0m.
   */
  elapsedMinutes: number | null;
};

export type DashboardSession = {
  id: string;
  title: string;
  activityType: string;
  facility: string | null;
  location: string | null;
  room: string | null;
  plannedStartMinute: number;
  plannedEndMinute: number;
  state: "planned" | "running" | "done";
  /** From the encounters filed against this session. Null when they could not be counted. */
  figures: Record<string, number | null>;
};

export type AttentionItem = {
  key: string;
  label: string;
  /** Null means "could not be counted" and MUST NOT be drawn as nought. */
  count: number | null;
  href: string;
  permitted: boolean;
};

export type EncountersDashboard = {
  today: string;
  timezone: string;
  sessions: Panel<DashboardSession>;
  /** Everything DRAFT / ACTIVE / PAUSED, plus COMPLETED-but-unsigned, which is unfinished work too. */
  open: Panel<DashboardEncounter>;
  closed: Panel<DashboardEncounter>;
  attention: AttentionItem[];
};

/** The name of a set of patients, or null for each read that failed. One query, not N. */
async function patientNames(admin: any, workspaceId: string, ids: string[]): Promise<{
  byId: Map<string, string>; unavailable: boolean;
}> {
  if (ids.length === 0) return { byId: new Map(), unavailable: false };
  const { data, error } = await admin.from("practice_patient")
    .select("id, display_name").eq("workspace_id", workspaceId).in("id", ids);
  if (error) return { byId: new Map(), unavailable: true };
  return { byId: new Map(((data ?? []) as any[]).map(p => [p.id as string, p.display_name as string])), unavailable: false };
}

function shapeEncounter(
  row: any, names: Map<string, string>, namesUnavailable: boolean, sessions: Map<string, string>,
  nowMs: number,
): DashboardEncounter {
  const startedMs = Date.parse(row.started_at);
  return {
    id: row.id,
    patientId: row.patient_id,
    // ⚠ "Unknown patient" IS A CLAIM. When the name read failed, the name is unknown TO THIS SCREEN, not
    // absent from the record -- so the flag travels with the row and the page prints a different word.
    patientName: namesUnavailable ? null : (names.get(row.patient_id) ?? null),
    patientNameUnavailable: namesUnavailable,
    status: row.status,
    entryPathway: row.entry_pathway,
    encounterMode: row.encounter_mode,
    reasonForVisit: row.reason_for_visit ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    signedAt: row.signed_at ?? null,
    activityId: row.activity_id ?? null,
    sessionTitle: row.activity_id ? (sessions.get(row.activity_id) ?? null) : null,
    outcome: row.outcome ?? null,
    elapsedMinutes: Number.isNaN(startedMs) ? null : Math.max(0, Math.floor((nowMs - startedMs) / 60000)),
  };
}

const ENCOUNTER_COLUMNS =
  "id, patient_id, status, entry_pathway, encounter_mode, reason_for_visit, " +
  "started_at, completed_at, signed_at, activity_id, outcome";

/**
 * CPR-ENC-001 s9's four panels.
 *
 * TODAY'S SESSIONS COMES FROM todaysPlan, not from a second copy of the same query -- the practitioner's
 * day already has one owner and two of them would disagree by a timezone.
 */
export async function encountersDashboard(
  admin: any, ctx: WorkspaceContext, opts: { at?: Date; closedLimit?: number } = {},
): Promise<EncountersDashboard> {
  const clock = { timezone: ctx.workspaceTimezone, today: practiceToday(ctx.workspaceTimezone) };
  const nowMs = (opts.at ?? new Date()).getTime();
  const can = (c: string) => hasCapability(ctx, c);

  if (!can(CAP_LIST)) {
    return {
      today: clock.today, timezone: clock.timezone,
      sessions: denied(), open: denied(), closed: denied(),
      attention: await attentionItems(admin, ctx, clock.today),
    };
  }

  // ⚠ todaysPlan REPORTS A MISSING CAPABILITY AS `unavailable`, which is right for its own screen and
  // wrong for this one: "you may not see the day" and "the day could not be read" are the two states
  // this panel exists to keep apart. So the capability is checked HERE, before the call, and the panel
  // says `permitted: false` rather than drawing a read failure the practitioner would try to retry.
  const canSeePlan = hasCapability(ctx, CAP_PLAN_VIEW);
  const plan = canSeePlan
    ? await todaysPlan(admin, ctx, { at: opts.at })
    : { activities: [], unavailable: false, date: clock.today, timezone: clock.timezone, current: null, next: null };

  const [openRes, closedRes] = await Promise.all([
    admin.from("practice_encounter").select(ENCOUNTER_COLUMNS)
      .eq("workspace_id", ctx.workspaceId)
      .in("status", [...LIVE_STATUSES, "COMPLETED"])
      .order("started_at", { ascending: false }).limit(50),
    admin.from("practice_encounter").select(ENCOUNTER_COLUMNS)
      .eq("workspace_id", ctx.workspaceId)
      .in("status", LOCKED_STATUSES)
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(opts.closedLimit ?? 12),
  ]);

  const openRows = (openRes.data ?? []) as any[];
  const closedRows = (closedRes.data ?? []) as any[];
  const ids = [...new Set([...openRows, ...closedRows].map(r => r.patient_id))];
  const names = await patientNames(admin, ctx.workspaceId, ids);
  const sessionTitles = new Map(plan.activities.map(a => [a.id, a.title]));

  // Session figures: counted from the encounters this workspace filed against each activity today.
  //
  // ⚠ THESE ARE ENCOUNTER FIGURES, NOT DIARY FIGURES. There is no appointment-to-activity link in this
  // schema, so "Booked" here means an encounter opened from a booking -- not a slot on a diary that
  // nobody has arrived for. Naming it anything else would be a claim about people who have not turned up.
  const activityIds = plan.activities.map(a => a.id);
  let figuresByActivity = new Map<string, Record<string, number>>();
  let figuresUnavailable = false;
  if (activityIds.length > 0) {
    const { data: figRows, error: figErr } = await admin.from("practice_encounter")
      .select("activity_id, status, entry_pathway")
      .eq("workspace_id", ctx.workspaceId).in("activity_id", activityIds);
    if (figErr) figuresUnavailable = true;
    else {
      figuresByActivity = new Map(activityIds.map(id => [id, { booked: 0, walk_in: 0, completed: 0, open: 0 }]));
      for (const r of (figRows ?? []) as any[]) {
        const bucket = figuresByActivity.get(r.activity_id);
        if (!bucket) continue;
        if (r.entry_pathway === "booked" || r.entry_pathway === "scheduled_followup") bucket.booked++;
        else bucket.walk_in++;
        if (LOCKED_STATUSES.includes(r.status) || r.status === "COMPLETED") bucket.completed++;
        else if (LIVE_STATUSES.includes(r.status)) bucket.open++;
      }
    }
  }

  const sessions: DashboardSession[] = plan.activities.map(a => ({
    id: a.id,
    title: a.title,
    activityType: a.label,
    facility: a.facilityName,
    location: a.locationName,
    room: a.room ?? null,
    plannedStartMinute: a.plannedStartMinute,
    plannedEndMinute: a.plannedEndMinute,
    state: a.state,
    figures: figuresUnavailable
      ? { booked: null, walk_in: null, completed: null, open: null }
      : (figuresByActivity.get(a.id) ?? { booked: 0, walk_in: 0, completed: 0, open: 0 }),
  }));

  return {
    today: clock.today,
    timezone: clock.timezone,
    sessions: !canSeePlan ? denied<DashboardSession>()
      : plan.unavailable ? failed<DashboardSession>("today's plan could not be read")
        : loaded(sessions),
    open: openRes.error ? failed<DashboardEncounter>(openRes.error.message)
      : loaded(openRows.map(r => shapeEncounter(r, names.byId, names.unavailable, sessionTitles, nowMs))),
    closed: closedRes.error ? failed<DashboardEncounter>(closedRes.error.message)
      : loaded(closedRows.map(r => shapeEncounter(r, names.byId, names.unavailable, sessionTitles, nowMs))),
    attention: await attentionItems(admin, ctx, clock.today),
  };
}

/**
 * The comp's fourth panel.
 *
 * ⚠ THE COMP LABELS THIS "AI Practice Assistant" AND THESE ARE NOT AI. Every figure below is a COUNT of
 * rows that exist -- overdue follow-ups, documents that arrived and have not been read, letters still in
 * draft, consultations finished but unsigned. Nothing is inferred, predicted or ranked. The panel is
 * titled for what it holds, and the practice assistant is a link at the bottom of it, because dressing
 * four SQL counts as an intelligence is how a practitioner comes to trust an inference that was never
 * made.
 *
 * EACH ITEM CARRIES ITS OWN `permitted`, because the capabilities differ: a caller may hold
 * followup.view and not inbox.review, and a nought drawn for the one they cannot see is a lie.
 */
async function attentionItems(admin: any, ctx: WorkspaceContext, today: string): Promise<AttentionItem[]> {
  const can = (c: string) => hasCapability(ctx, c);
  const out: AttentionItem[] = [];

  // A null count is "could not be counted". PostgREST returns count: null on error, so the error is what
  // is checked -- a null-count-as-nought is the exact trap recorded in the drift notes.
  const countOf = async (q: any): Promise<number | null> => {
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  };

  out.push({
    key: "overdue_follow_ups", label: "Follow-ups overdue", href: "/practice/follow-ups",
    permitted: can(CAP_FOLLOWUP),
    count: can(CAP_FOLLOWUP)
      ? await countOf(admin.from("practice_follow_up").select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"]).lt("due_on", today))
      : null,
  });

  out.push({
    key: "documents_unreviewed", label: "Arrived documents not reviewed", href: "/practice/inbox",
    permitted: can(CAP_INBOX),
    count: can(CAP_INBOX)
      ? await countOf(admin.from("practice_incoming_document").select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).eq("status", "RECEIVED"))
      : null,
  });

  out.push({
    key: "letters_draft", label: "Letters still in draft", href: "/practice/documents",
    permitted: can(CAP_DOCUMENT),
    count: can(CAP_DOCUMENT)
      ? await countOf(admin.from("practice_clinical_document").select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).eq("status", "DRAFT"))
      : null,
  });

  out.push({
    key: "completed_unsigned", label: "Completed, not signed", href: "/practice/encounters",
    permitted: can(CAP_LIST),
    count: can(CAP_LIST)
      ? await countOf(admin.from("practice_encounter").select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).eq("status", "COMPLETED"))
      : null,
  });

  return out;
}

// ── CPR-ENC-002: THE ENCOUNTER SCREEN ───────────────────────────────────────────────────────────────

export type Decision = { id: string; decision: string; position: number; createdAt: string };
export type Investigation = {
  id: string; label: string; status: string; summary: string | null;
  requestedAt: string; reviewedAt: string | null;
};
export type Referral = {
  id: string; referredTo: string; reason: string; status: string; referredOn: string; encounterId: string | null;
};

export type EncounterExtras = {
  decisions: Panel<Decision>;
  investigations: Panel<Investigation>;
  referrals: Panel<Referral>;
  outcome: string | null;
  outcomeNote: string | null;
  /** CPR-ENC-002 s7. Warnings, never refusals. Empty when nothing is missing OR when nothing could be counted. */
  warnings: EncounterWarning[];
};

/**
 * Everything migration 238 added, for one encounter, plus s7's warnings.
 *
 * The counts feeding the warnings are the ones READ HERE, not passed in, so a warning cannot be raised
 * from a list a caller failed to load and then rendered as empty.
 */
export async function encounterExtras(
  admin: any, ctx: WorkspaceContext, encounterId: string,
  counts: { diagnoses: number | null; treatments: number | null; openFollowUps: number | null },
): Promise<EncounterExtras> {
  if (!hasCapability(ctx, CAP_LIST)) {
    return {
      decisions: denied(), investigations: denied(), referrals: denied(),
      outcome: null, outcomeNote: null, warnings: [],
    };
  }

  const [decRes, invRes, refRes, encRes] = await Promise.all([
    admin.from("practice_encounter_decision").select("id, decision, position, created_at")
      .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId).order("position"),
    admin.from("practice_encounter_investigation")
      .select("id, label, status, summary, requested_at, reviewed_at")
      .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId).order("requested_at"),
    admin.from("practice_referral")
      .select("id, referred_to, reason, status, referred_on, encounter_id")
      .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId).order("referred_on", { ascending: false }),
    admin.from("practice_encounter").select("outcome, outcome_note")
      .eq("workspace_id", ctx.workspaceId).eq("id", encounterId).maybeSingle(),
  ]);

  const decisions = decRes.error
    ? failed<Decision>(decRes.error.message)
    : loaded(((decRes.data ?? []) as any[]).map(d => ({
      id: d.id, decision: d.decision, position: d.position, createdAt: d.created_at,
    })));

  const investigations = invRes.error
    ? failed<Investigation>(invRes.error.message)
    : loaded(((invRes.data ?? []) as any[]).map(i => ({
      id: i.id, label: i.label, status: i.status, summary: i.summary ?? null,
      requestedAt: i.requested_at, reviewedAt: i.reviewed_at ?? null,
    })));

  const referrals = refRes.error
    ? failed<Referral>(refRes.error.message)
    : loaded(((refRes.data ?? []) as any[]).map(r => ({
      id: r.id, referredTo: r.referred_to, reason: r.reason, status: r.status,
      referredOn: r.referred_on, encounterId: r.encounter_id ?? null,
    })));

  // ⚠ A FAILED DECISION READ MUST NOT RAISE "no treatment decision recorded". `null` is what
  // encounterWarnings expects for "could not be counted", and it declines to warn on it.
  return {
    decisions, investigations, referrals,
    outcome: encRes.error ? null : (encRes.data?.outcome ?? null),
    outcomeNote: encRes.error ? null : (encRes.data?.outcome_note ?? null),
    warnings: encounterWarnings({
      diagnoses: counts.diagnoses,
      treatments: counts.treatments,
      decisions: decisions.unavailable ? null : decisions.items.length,
      outcome: encRes.error ? "unreadable" : (encRes.data?.outcome ?? null),
      openFollowUps: counts.openFollowUps,
    }),
  };
}

// ── WRITES ──────────────────────────────────────────────────────────────────────────────────────────
//
// Every one of them goes through editableEncounter first, which is the same guard the SOAP note, the
// diagnosis and the treatment already use: a signed encounter is append-only and the engine says no
// before the database has to. For the encounter's own OUTCOME the database says no as well -- migration
// 194's trigger refuses any update to a SIGNED row that does not move it to AMENDED -- and the harness
// proves both halves.

type Actor = { actorId: string; correlationId: string };

export async function addDecision(admin: any, args: Actor & {
  workspaceId: string; encounterId: string; decision: string;
}): Promise<EngineResult<{ id: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const text = (args.decision ?? "").trim();
  if (!text) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a decision needs words in it" };
  if (text.length > 400) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a decision is at most 400 characters" };

  // The position is the end of the list. A decision list is read as a sequence, and appending is what
  // the practitioner is doing -- reordering is a separate act nobody has asked for.
  const { data: last, error: readErr } = await admin.from("practice_encounter_decision")
    .select("position").eq("encounter_id", args.encounterId)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };

  const { data, error } = await admin.from("practice_encounter_decision").insert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, patient_id: guard.data.patient_id,
    decision: text, position: (last?.position ?? -1) + 1, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.decision_recorded",
    payload: { encounterId: args.encounterId, decisionId: data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function removeDecision(admin: any, args: Actor & {
  workspaceId: string; encounterId: string; decisionId: string;
}): Promise<EngineResult<{ id: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const { data, error } = await admin.from("practice_encounter_decision")
    .delete().eq("id", args.decisionId).eq("encounter_id", args.encounterId)
    .eq("workspace_id", args.workspaceId).select("id").maybeSingle();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.decision_removed",
    payload: { encounterId: args.encounterId, decisionId: args.decisionId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * ⚠ TYPE ONLY. `label` is what was asked for; there is no result and there must never be one.
 */
export async function recordInvestigation(admin: any, args: Actor & {
  workspaceId: string; encounterId: string; label: string; summary?: string | null;
}): Promise<EngineResult<{ id: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const label = (args.label ?? "").trim();
  if (!label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "name the investigation" };

  const { data, error } = await admin.from("practice_encounter_investigation").insert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, patient_id: guard.data.patient_id,
    label, status: "requested", summary: args.summary?.trim() || null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.investigation_requested",
    payload: { encounterId: args.encounterId, investigationId: data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Mark an investigation as reviewed.
 *
 * `summary` is what the PRACTITIONER made of it, in their words. It is not a result, it is not parsed,
 * and nothing downstream may treat it as structured. The arrived document, if there is one, lives in
 * practice_incoming_document with its own review trail.
 */
export async function reviewInvestigation(admin: any, args: Actor & {
  workspaceId: string; encounterId: string; investigationId: string; summary?: string | null;
}): Promise<EngineResult<{ id: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const { data, error } = await admin.from("practice_encounter_investigation")
    .update({
      status: "reviewed", reviewed_at: new Date().toISOString(),
      ...(args.summary?.trim() ? { summary: args.summary.trim() } : {}),
    })
    .eq("id", args.investigationId).eq("encounter_id", args.encounterId)
    .eq("workspace_id", args.workspaceId).select("id").maybeSingle();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.investigation_reviewed",
    payload: { encounterId: args.encounterId, investigationId: args.investigationId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * ⚠ RECORDED, NOT SENT. There is no channel, no recipient address and no sent_at, because this product
 * transmits nothing. The letter that goes anywhere is a practice_clinical_document.
 */
export async function recordReferral(admin: any, args: Actor & {
  workspaceId: string; encounterId: string; referredTo: string; reason: string; referredOn?: string;
}): Promise<EngineResult<{ id: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const referredTo = (args.referredTo ?? "").trim();
  const reason = (args.reason ?? "").trim();
  if (!referredTo) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "who is the referral to?" };
  if (!reason) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a referral needs a reason" };

  const { data, error } = await admin.from("practice_referral").insert({
    workspace_id: args.workspaceId, encounter_id: args.encounterId, patient_id: guard.data.patient_id,
    referred_to: referredTo, reason, status: "made",
    ...(args.referredOn ? { referred_on: args.referredOn } : {}),
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.referral_recorded",
    payload: { encounterId: args.encounterId, referralId: data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * What the practitioner has since been TOLD about a referral.
 *
 * Not what happened -- what somebody reported. The distinction is why there is no `sent` state and no
 * automatic transition: every one of these four is a human writing down news they received.
 */
export async function updateReferralStatus(admin: any, args: Actor & {
  workspaceId: string; referralId: string; status: string;
}): Promise<EngineResult<{ status: string }>> {
  if (!REFERRAL_STATUS_CODES.includes(args.status))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown referral status ${args.status}` };

  const { data: existing, error: readErr } = await admin.from("practice_referral")
    .select("id, encounter_id").eq("id", args.referralId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };
  if (!existing) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A referral attached to a signed encounter is part of that closed record. News about it is a NEW fact
  // and the encounter is not being rewritten -- but the guard is still applied, because the alternative
  // is a row inside a signed consultation changing under a reader with no amendment behind it.
  if (existing.encounter_id) {
    const guard = await editableEncounter(admin, args.workspaceId, existing.encounter_id);
    if (!guard.ok) return guard as EngineResult<never>;
  }

  const { error } = await admin.from("practice_referral")
    .update({ status: args.status, updated_at: new Date().toISOString(), updated_by: args.actorId })
    .eq("id", args.referralId).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.referral_status_changed",
    payload: { referralId: args.referralId, status: args.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.status } };
}

/** The whole patient's referral history (CPR-ENC-003 s5). */
export async function referralHistory(admin: any, ctx: WorkspaceContext, patientId: string): Promise<Panel<Referral>> {
  if (!hasCapability(ctx, CAP_LIST)) return denied();
  const { data, error } = await admin.from("practice_referral")
    .select("id, referred_to, reason, status, referred_on, encounter_id")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("referred_on", { ascending: false });
  if (error) return failed(error.message);
  return loaded(((data ?? []) as any[]).map(r => ({
    id: r.id, referredTo: r.referred_to, reason: r.reason, status: r.status,
    referredOn: r.referred_on, encounterId: r.encounter_id ?? null,
  })));
}

/** The whole patient's investigation history, type only (CPR-ENC-003 s5). */
export async function investigationHistory(admin: any, ctx: WorkspaceContext, patientId: string): Promise<Panel<Investigation & { encounterId: string }>> {
  if (!hasCapability(ctx, CAP_LIST)) return denied();
  const { data, error } = await admin.from("practice_encounter_investigation")
    .select("id, label, status, summary, requested_at, reviewed_at, encounter_id")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("requested_at", { ascending: false });
  if (error) return failed(error.message);
  return loaded(((data ?? []) as any[]).map(i => ({
    id: i.id, label: i.label, status: i.status, summary: i.summary ?? null,
    requestedAt: i.requested_at, reviewedAt: i.reviewed_at ?? null, encounterId: i.encounter_id,
  })));
}

/** The decisions taken across every encounter (CPR-ENC-001 s8's "longitudinal impact"). */
export async function decisionHistory(admin: any, ctx: WorkspaceContext, patientId: string): Promise<Panel<Decision & { encounterId: string }>> {
  if (!hasCapability(ctx, CAP_LIST)) return denied();
  const { data, error } = await admin.from("practice_encounter_decision")
    .select("id, decision, position, created_at, encounter_id")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error) return failed(error.message);
  return loaded(((data ?? []) as any[]).map(d => ({
    id: d.id, decision: d.decision, position: d.position, createdAt: d.created_at, encounterId: d.encounter_id,
  })));
}

/**
 * Every capability code this engine gates on, exported so the harness can prove each one EXISTS in
 * practice_role_capabilities.
 *
 * ⚠ A CAPABILITY CODE IS A STRING COMPARED AGAINST A SEEDED TABLE. Inventing a plausible one costs
 * nothing at compile time and silently disables the feature at runtime -- `practice.calendar.manage`
 * did exactly that to the whole diary, and six invented codes have shipped in this product already.
 * The harness checks against THIS array rather than a list re-typed in the test, because a re-typed
 * list can invent the same fiction and agree with it forever.
 */
export const ENCOUNTER_WORKSPACE_CAPABILITIES = [
  CAP_LIST, CAP_EDIT, CAP_FOLLOWUP, CAP_INBOX, CAP_DOCUMENT, CAP_PLAN_VIEW,
] as const;
