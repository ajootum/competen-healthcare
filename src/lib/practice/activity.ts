import type { WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { emitEvents, type EventEnvelope, type EventSource } from "@/lib/practice/events";
import { audit } from "@/lib/practice/provisioning";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */
// CPR-V3-001 CURRENT ACTIVITY -- the practitioner's context, and what everything else in V3 hangs off.
//
// "Everything begins from the practitioner's current context" (s"Core Workflow Principles"). The planning
// hierarchy is Year -> Month -> Week -> Today's Plan -> Current Session -> Current Activity, and this
// module owns the last two rungs: what is planned for today, and which one of those is running now.
//
// THREE STATES, NONE OF THEM STORED. planned / running / done are derived from started_at and ended_at
// every time they are read (migration 232 has no status column, and the comment there says why). A clinic
// that overran would otherwise still read "In Progress" tomorrow morning, and Today's Timeline would be
// confidently wrong -- the failure mode that makes people stop trusting a dashboard.
//
// "OVERRUNNING" IS NOT A REFUSAL. An activity running past its planned end is the normal case in a clinic,
// not an error, so it is reported (`overrunMinutes`) and never corrected. The plan is what was intended;
// started_at and ended_at are what happened; the engine does not make the second agree with the first.

export const ACTIVITY_TYPES = [
  "outpatient_clinic", "ward_round", "theatre", "emergency_consult",
  "virtual_clinic", "telephone_review", "administration", "teaching",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  outpatient_clinic: "Outpatient Clinic",
  ward_round: "Ward Round",
  theatre: "Theatre",
  emergency_consult: "Emergency Consult",
  virtual_clinic: "Virtual Clinic",
  telephone_review: "Telephone Review",
  administration: "Administration",
  teaching: "Teaching",
};

/**
 * WHAT THIS ENGINE WILL NOT DO, stated where the code is rather than in a document nobody opens.
 * Each is a refusal a screen can render, not a silent no-op.
 */
export const ACTIVITY_REFUSES = [
  "Start a second activity while one is running -- CPR-V3-001 s4 allows exactly one, and the database " +
    "enforces it too, because two tabs can both read 'nothing running'.",
  "Start an activity planned for another day. Yesterday's ward round is not a thing you can be in.",
  "Start or end an activity that has already ended. Finishing twice would move the end time.",
  "End an activity that never started.",
  "Plan an activity that ends before it begins.",
];

export type ActivityState = "planned" | "running" | "done";

export type PlannedActivity = {
  id: string;
  activityType: ActivityType;
  label: string;
  title: string;
  room: string | null;
  facilityName: string | null;
  locationName: string | null;
  planDate: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
  startedAt: string | null;
  endedAt: string | null;
  state: ActivityState;
  /** Minutes past the planned end, for an activity still running. Null unless it is over its window. */
  overrunMinutes: number | null;
};

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

// ⚠ THESE MUST BE CAPABILITY CODES THAT ACTUALLY EXIST. This file shipped with
// `practice.calendar.manage`, which is not in practice_role_capabilities and never has been -- so
// hasCapability returned false for EVERY user including the practice owner, every write below returned
// 403, and the dashboard hid the Start button rather than showing an error. "Start the day in one click"
// was unreachable and it looked like nothing happened.
//
// A capability code is a STRING COMPARED AGAINST THE DATABASE. Inventing a plausible one costs nothing at
// compile time and silently disables the feature at runtime. The real diary-write capability is
// `appointment.manage` (migration 192), held by practitioner and practice_assistant.
const CAN_PLAN = "appointment.manage";
const CAN_VIEW = "practice.home.view";

/**
 * The codes this engine gates on, exported so a harness can prove each one EXISTS in
 * practice_role_capabilities. Checked against these constants rather than against a list re-typed in the
 * test: a re-typed list can invent the same fiction the engine did and agree with it forever.
 */
export const ACTIVITY_CAPABILITIES = [CAN_PLAN, CAN_VIEW];

/** planned / running / done, from the two timestamps and nothing else. */
export function activityState(startedAt: string | null, endedAt: string | null): ActivityState {
  if (endedAt) return "done";
  if (startedAt) return "running";
  return "planned";
}

function shape(row: any, nowMs: number): PlannedActivity {
  const state = activityState(row.started_at, row.ended_at);
  // Overrun is measured against the PLANNED end in local minutes, so it needs the day's midnight. Passed
  // in by the caller that already computed it; here it is derived from the row's own date to keep this
  // function total -- a shaping function that can throw is a shaping function that will.
  let overrunMinutes: number | null = null;
  if (state === "running" && row.day_start_ms) {
    const plannedEndMs = row.day_start_ms + row.planned_end_minute * 60000;
    const over = Math.floor((nowMs - plannedEndMs) / 60000);
    if (over > 0) overrunMinutes = over;
  }
  return {
    id: row.id,
    activityType: row.activity_type,
    label: ACTIVITY_LABEL[row.activity_type as ActivityType] ?? row.activity_type,
    title: row.title,
    room: row.room ?? null,
    facilityName: row.practice_facility?.name ?? null,
    locationName: row.practice_location?.name ?? null,
    planDate: row.plan_date,
    plannedStartMinute: row.planned_start_minute,
    plannedEndMinute: row.planned_end_minute,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    state,
    overrunMinutes,
  };
}

export type TodaysPlan = {
  date: string;
  timezone: string;
  activities: PlannedActivity[];
  /** The one that is running, or null. Never more than one -- the database will not allow it. */
  current: PlannedActivity | null;
  /** The next thing that has not started, by planned start. Null when the day has nothing left. */
  next: PlannedActivity | null;
  /** True when the plan could not be read at all, so a screen can say so instead of drawing an empty day. */
  unavailable: boolean;
};

/**
 * Today's Plan and the Current Activity within it.
 *
 * A FAILED READ IS NOT AN EMPTY DAY. The error is checked and surfaced as `unavailable`, because "you
 * have nothing on today" and "I could not find out" are different sentences and only one of them should
 * ever be shown to somebody about to start a clinic.
 */
export async function todaysPlan(
  admin: any, ctx: WorkspaceContext, opts: { date?: string; at?: Date } = {},
): Promise<TodaysPlan> {
  // ⚠ THE ERROR IS CHECKED, and this is not pedantry. Discarded, a failed read silently became "UTC",
  // `date` was then computed for the wrong calendar day, `.eq("plan_date", date)` matched nothing, and
  // this returned an EMPTY PLAN WITH unavailable:false -- a confident claim that the day is empty, from
  // a query that never succeeded. The whole point of the flag is defeated by defaulting the input to it.
  const { data: ws, error: wsError } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";
  const at = opts.at ?? new Date();
  const date = opts.date ?? practiceToday(timezone, at);
  if (wsError) return { date, timezone, activities: [], current: null, next: null, unavailable: true };
  const { startIso } = zonedDayRange(date, timezone);
  const dayStartMs = Date.parse(startIso);

  const empty = { date, timezone, activities: [], current: null, next: null };

  if (!ctx.capabilities.includes(CAN_VIEW)) return { ...empty, unavailable: true };

  const { data, error } = await admin.from("practice_activity")
    .select("id, activity_type, title, room, plan_date, planned_start_minute, planned_end_minute, " +
      "started_at, ended_at, practice_facility:facility_id(name), practice_location:location_id(name)")
    .eq("workspace_id", ctx.workspaceId)
    .eq("practitioner_id", ctx.userId)
    .eq("plan_date", date)
    .order("planned_start_minute", { ascending: true });

  if (error) return { ...empty, unavailable: true };

  const nowMs = at.getTime();
  const activities = (data ?? []).map((r: any) => shape({ ...r, day_start_ms: dayStartMs }, nowMs));

  return {
    date,
    timezone,
    activities,
    current: activities.find((a: PlannedActivity) => a.state === "running") ?? null,
    // The NEXT one is the earliest still-planned activity, which is not the same as "the one after the
    // current". A clinic that ran into the ward round leaves the ward round still planned and still next.
    next: activities.find((a: PlannedActivity) => a.state === "planned") ?? null,
    unavailable: false,
  };
}

/**
 * The activity a practitioner is in RIGHT NOW -- the context CPR-V3-001 s6 says every encounter inherits.
 *
 * NULL AND FAILURE ARE RETURNED SEPARATELY, and that is the whole point of this shape. "Nothing is
 * running" is a true and ordinary answer: consultations happen on call, between clinics, at two in the
 * morning against no plan at all. "I could not find out" is not an answer, and collapsing the second into
 * the first would file a clinical record as context-less on the strength of a query that simply failed --
 * a thing nothing downstream can ever detect, because a genuinely context-less encounter looks identical.
 *
 * NO CAPABILITY CHECK, unlike todaysPlan. This is not a screen: it answers a question about a caller the
 * surrounding engine has already authorised, and gating it on practice.home.view would strip the context
 * off an encounter over a permission that has nothing to do with encounters.
 */
export async function runningActivityId(
  admin: any, workspaceId: string, practitionerId: string,
): Promise<{ id: string | null; error: { message: string } | null }> {
  const { data, error } = await admin.from("practice_activity")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("practitioner_id", practitionerId)
    .not("started_at", "is", null).is("ended_at", null)
    .maybeSingle();
  if (error) return { id: null, error };
  return { id: data?.id ?? null, error: null };
}

export type PlanInput = {
  activityType: string;
  title: string;
  planDate: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
  facilityId?: string | null;
  locationId?: string | null;
  room?: string | null;
};

// ── THE AUDIT TRAIL, WHICH IS NOT THE EVENT LOG ──────────────────────────────────────────────────────
//
// ⚠ THIS ENGINE WROTE STATE AND LEFT NO AUDIT ENTRY. Every other write-path in Competen Practice has
// called audit() since Phase 0; this one shipped with domain events instead and nobody noticed, because a
// projection updating correctly looks exactly like a compliance question being answered. It is not the
// same artefact and the two tables say so in their own headers:
//
//   practice_domain_event (233)  what happened, for things that need to REACT to it. Deletable: a
//                                projection that loses its events rebuilds from the record.
//   practice_audit_event  (191)  who did what, and can we prove it. Append-only, and the thing that
//                                answers "who started that clinic" a year later.
//
// So starting the morning clinic announced itself to seven dashboard cards and left no trace of WHO
// started it -- CPR-CORE-001 s13's "actor, timestamp, source and audit entry" failing on the one engine
// that owns the practitioner's context.
//
// ONE AUDIT ROW PER CALL, EVEN WHEN A CALL MOVES TWO ACTIVITIES. Switching activity ends the running one
// and starts the next; that is one thing a practitioner did, and it is recorded as one entry naming the
// activity it closed. The event log splits it into two envelopes because two different cards listen for
// them -- a reader of the trail is a person, not a projection.
//
// THE SOURCE IS THE CALLER'S, NOT A DEFAULT. Migration 191 defaults the column to 'api', which is true of
// the web route and false of a cron or an integration, and the database cannot tell which one it is
// talking to. Every caller here already declares an EventSource for the envelope; the audit row gets the
// same one rather than a second, quieter answer to the same question.

/** Add an activity to a day's plan. */
export async function planActivity(
  admin: any, ctx: WorkspaceContext, input: PlanInput,
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  if (!ACTIVITY_TYPES.includes(input.activityType as ActivityType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "that is not an activity type" };

  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an activity needs a title" };

  if (!(input.plannedEndMinute > input.plannedStartMinute))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an activity cannot end before it begins" };

  const { data, error } = await admin.from("practice_activity").insert({
    workspace_id: ctx.workspaceId,
    // THE SUBJECT, NOT THE CALLER -- but V3 has no delegated planning yet, so they are the same person and
    // saying so here is what makes it obvious the day a receptionist can build somebody else's plan.
    practitioner_id: ctx.userId,
    activity_type: input.activityType,
    title,
    plan_date: input.planDate,
    planned_start_minute: input.plannedStartMinute,
    planned_end_minute: input.plannedEndMinute,
    facility_id: input.facilityId ?? null,
    location_id: input.locationId ?? null,
    room: input.room?.trim() || null,
  }).select("id").maybeSingle();

  if (error) return { ok: false, status: 500, code: "INSERT_FAILED", message: error.message };
  if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the activity was not planned" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_planned",
    payload: {
      activityId: data.id, activityType: input.activityType, planDate: input.planDate,
      plannedStartMinute: input.plannedStartMinute, plannedEndMinute: input.plannedEndMinute,
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id: data.id } };
}

// The columns an event envelope needs on top of the ones the lifecycle checks need. Selected in the same
// round trip rather than fetched again at emit time: a second read could see a row another tab had
// already changed, and the event would then describe a state that never existed.
const OWN_COLUMNS =
  "id, plan_date, started_at, ended_at, practitioner_id, location_id, facility_id, activity_type, title";

async function loadOwn(admin: any, ctx: WorkspaceContext, id: string) {
  const { data, error } = await admin.from("practice_activity")
    .select(OWN_COLUMNS)
    .eq("id", id).eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .maybeSingle();
  return { row: error ? null : data, error };
}

/**
 * CPR-CORE-001 s9's envelopes for one activity transition. Migration 233, src/lib/practice/events.ts.
 *
 * TWO EVENTS PER TRANSITION, NOT ONE. s6.1 says "starting a session creates a session_started event",
 * and s7's feeder matrix has different cards listening for the activity events and the session events --
 * Start Your Day watches `session.started`, Today's Timeline watches the activity. In this build they
 * are the same transition, because V3 collapsed Session into the running activity and there is no
 * practice_session table (migration 233 says why session_id is kept as its own column anyway). Emitting
 * only one of the pair would leave whichever card listened for the other permanently stale, and would be
 * invisible until somebody asked why the dashboard never moved.
 *
 * THE ACTOR IS THE CALLER; THE PRACTITIONER IS THE ROW'S. They are the same person in V3 -- loadOwn only
 * returns activities belonging to ctx.userId -- but taking the practitioner from the row rather than
 * from the context is what makes the first delegated write correct instead of quietly self-attributed.
 */
function lifecycleEvents(
  kind: "started" | "completed", ctx: WorkspaceContext, row: any, at: Date, source: EventSource,
  extra: Record<string, unknown> = {},
): EventEnvelope[] {
  const common = {
    practiceId: ctx.workspaceId,
    practitionerId: row.practitioner_id,
    actorId: ctx.userId,
    source,
    occurredAt: at,
    locationId: row.location_id ?? null,
    activityInstanceId: row.id,
    // The session IS the activity in this build. Same id, two columns, on purpose.
    sessionId: row.id,
    payload: {
      activityType: row.activity_type, title: row.title, facilityId: row.facility_id ?? null, ...extra,
    },
  };
  return kind === "started"
    ? [{ ...common, eventType: "activity.started" }, { ...common, eventType: "session.started" }]
    : [{ ...common, eventType: "activity.completed" }, { ...common, eventType: "session.closed" }];
}

/**
 * Start an activity, which is what makes it the current context.
 *
 * ⚠ NEVER AN UPSERT. Migration 232 enforces "one running at a time" with a PARTIAL unique index, and
 * PostgREST's onConflict cannot target one -- it fails at runtime, not at compile time. So the running
 * activity is ended first and this one inserted after, and the index is the backstop for the race
 * between two tabs rather than the mechanism.
 */
export async function startActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  opts: { at?: Date; source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; endedPrevious: string | null; eventWarnings: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  const at = opts.at ?? new Date();
  // s9.1's source. Migration 233 refuses to default this column, because the DATABASE cannot know which
  // surface a write came through. The engine can: its only production caller is the web route. A cron,
  // an integration or a harness must say so, and each of them does.
  const source: EventSource = opts.source ?? "web";
  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is over" };
  if (row.started_at) return { ok: false, status: 409, code: "ALREADY_RUNNING", message: "that activity is already running" };

  // Same check, and here the cost of skipping it is a wrong REFUSAL rather than a wrong reading: silently
  // falling back to UTC makes a Kampala practice unable to start a clinic between 21:00 and midnight
  // local, and able to start yesterday's before 03:00.
  const { data: ws, error: wsError } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  if (wsError) return { ok: false, status: 500, code: "READ_FAILED", message: wsError.message };
  // Compared against the PRACTICE's today, never the server's date. A practitioner in Kampala starting a
  // clinic at 01:00 UTC is starting today's clinic, and a server in another zone must not call it
  // tomorrow's. (The app clock and the database clock are never compared -- both sides here are the app's.)
  if (row.plan_date !== practiceToday(ws?.timezone || "UTC", at))
    return { ok: false, status: 422, code: "NOT_TODAY", message: "that activity is not planned for today" };

  // Whatever is running now stops now. This is the "Change" button in the comp: switching activity is
  // the normal way to move through a day, not an exception.
  //
  // Through runningActivityId rather than its own query, so that "what am I in" has ONE definition. When
  // an encounter and a switch disagree about what was running, the encounter's context is wrong and
  // nobody finds out.
  const running = await runningActivityId(admin, ctx.workspaceId, ctx.userId);
  if (running.error) return { ok: false, status: 500, code: "READ_FAILED", message: running.error.message };

  // ---- THE OUTBOX, EMITTED AFTER EACH WRITE THAT ACTUALLY COMMITTED --------------------------------
  //
  // Not at the end of the function. A switch is TWO state changes and they can part company: if the
  // close succeeds and the start then loses the race to another tab, the previous activity really did
  // end, and an outbox that only emitted on the happy path would leave every projection holding a
  // session that never closed. Each event is written directly after the write it describes.
  const eventWarnings: string[] = [];

  if (running.id) {
    // The closed row comes back from the write itself. Re-reading it afterwards would be a second read
    // of a row another tab may already have moved, and the event would then describe a state that was
    // never true.
    const { data: closed, error: endErr } = await admin.from("practice_activity")
      .update({ ended_at: at.toISOString(), updated_at: at.toISOString() }).eq("id", running.id)
      .select(OWN_COLUMNS).maybeSingle();
    if (endErr) return { ok: false, status: 500, code: "SWITCH_FAILED", message: endErr.message };
    if (closed)
      eventWarnings.push(...await emitEvents(admin, lifecycleEvents("completed", ctx, closed, at, source,
        { reason: "switched", switchedToActivityId: id })));
    // A write that succeeded and returned nothing is not a non-event. Reported, because the alternative
    // is an activity that ends with no trace of its ending and no trace of the trace being missing.
    else eventWarnings.push("activity.completed: NO_ROW the switch returned no row to describe");
  }

  const { error: startErr } = await admin.from("practice_activity")
    .update({ started_at: at.toISOString(), updated_at: at.toISOString() }).eq("id", id);
  // A unique violation here means another tab won the race between the read above and this write. The
  // index did its job; the caller is told rather than left with two current activities.
  if (startErr) {
    const code = startErr.code === "23505" ? "ALREADY_RUNNING" : "START_FAILED";
    const status = startErr.code === "23505" ? 409 : 500;
    return { ok: false, status, code, message: startErr.message };
  }

  // `row` is the state as it was read, plus the transition that has now committed -- the started_at the
  // envelope describes is the one just written.
  eventWarnings.push(...await emitEvents(admin,
    lifecycleEvents("started", ctx, row, at, source, { endedPreviousActivityId: running.id })));

  // The switch is one entry, naming what it closed. See the block above planActivity.
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_started",
    payload: { activityId: id, activityType: row.activity_type, endedPreviousActivityId: running.id },
    correlationId: opts.correlationId, source,
  });

  // THE WARNINGS RIDE ALONG WITH A SUCCESS. The activity started; an outbox failure does not unstart it
  // and must not be reported as though it had (see the argument at the head of events.ts). Callers that
  // ignore this array get correct behaviour and a stale card; callers that surface it can tell a broken
  // outbox from a quiet practice, which is the whole reason the error is not swallowed.
  return { ok: true, value: { id, endedPrevious: running.id, eventWarnings } };
}

/** End the activity. The plan is not rewritten to match: overrunning is recorded, not corrected. */
export async function endActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  opts: { at?: Date; source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; eventWarnings: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  const at = opts.at ?? new Date();
  const source: EventSource = opts.source ?? "web";
  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!row.started_at) return { ok: false, status: 422, code: "NOT_STARTED", message: "that activity never started" };
  if (row.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is already over" };

  const { error: endErr } = await admin.from("practice_activity")
    .update({ ended_at: at.toISOString(), updated_at: at.toISOString() }).eq("id", id);
  if (endErr) return { ok: false, status: 500, code: "END_FAILED", message: endErr.message };

  // s7: Practice Performance recalculates on completion and Today at a Glance re-scopes from session to
  // day. Both find out from here.
  const eventWarnings = await emitEvents(admin, lifecycleEvents("completed", ctx, row, at, source));

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_ended",
    payload: { activityId: id, activityType: row.activity_type, startedAt: row.started_at },
    correlationId: opts.correlationId, source,
  });
  return { ok: true, value: { id, eventWarnings } };
}
