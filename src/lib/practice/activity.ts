import type { WorkspaceContext } from "@/lib/practice/access";
import { ACTIVITY_TYPES, ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { emitEvents, emitAudited, type EventEnvelope, type EventSource } from "@/lib/practice/events";
import { audit } from "@/lib/practice/audit";
import { practiceMetrics, metricScope, type PracticeMetrics } from "@/lib/practice/metrics";

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

// The eight types and their labels now live in activity-constants.ts, so a client component can read
// them without dragging this file's server imports into the browser bundle. Re-exported here because
// every server caller already imports them from this module, and two import paths for one constant is
// how a rename ends up half-applied.
export { ACTIVITY_TYPES, ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";

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
  "Pause an activity that is not running -- CPR-V5-004's lifecycle has no rung between planned and " +
    "paused, and a pause with no session to interrupt is a hole in a clock that is not ticking.",
  "Pause an activity that is already paused. The second pause would overlap the first and the same " +
    "minutes would be subtracted twice, so the session would report more paused time than elapsed.",
  "Resume an activity that is not paused. There is nothing to close, and closing nothing silently is " +
    "how a screen comes to show a Resume button that does not do anything.",
  "Pause or resume an activity that has ended. A finished session's clock does not move any more.",
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
  /**
   * Exposed so a screen can PRESELECT the current place when correcting it (setActivityLocation).
   * The name alone cannot do that: two sites can share a name, and matching a picker by label is how a
   * correction quietly moves a session to the wrong one.
   */
  locationId: string | null;
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
    locationId: row.location_id ?? null,
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
    // ⚠ location_id AS WELL AS THE JOIN, and the two are not the same thing. The join yields the NAME
    // for display; the column yields the ID a picker preselects with. Adding the field to the type
    // without adding the column here would have made locationId null on every row -- a field that
    // exists, type-checks, and is always empty, which is the shape of defect this repo keeps finding.
    .select("id, activity_type, title, room, plan_date, planned_start_minute, planned_end_minute, " +
      "started_at, ended_at, location_id, practice_facility:facility_id(name), practice_location:location_id(name)")
    .eq("workspace_id", ctx.workspaceId)
    .eq("practitioner_id", ctx.userId)
    .eq("plan_date", date)
    // ⚠ CANCELLED BLOCKS ARE NOT PART OF TODAY'S PLAN (migration 236). Without this a clinic the
    // practitioner called off still counted as `next`, and the context header offered it as what to do
    // next -- state here is derived from started_at/ended_at only, so a cancelled row reads as "planned"
    // and is indistinguishable from a live one. They ARE still drawn, struck through, on the planner:
    // that is the screen whose subject is the plan. This one's subject is the work.
    .is("cancelled_at", null)
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

  // ── s9 DOMAIN EVENT ───────────────────────────────────────────────────────────────────────────
  //
  // ⚠ EMITTED EVEN THOUGH NOTHING LISTENS TO IT, AND THAT IS NOT A CONTRADICTION. event-stream.ts
  // puts activity.planned in NOT_STREAMED with a good reason -- planning next Tuesday changes nothing
  // on today's dashboard. But the outbox is the RECORD of what the practice did, not a feed for one
  // page: a projection rebuilt from it must be able to see the week being built, and a type in the
  // catalogue that nothing ever writes is indistinguishable from a type nobody thought about.
  //
  // practitionerId is ctx.userId because the row above writes exactly that as practitioner_id, and
  // its own comment marks the line to change the day a receptionist can plan somebody else's week.
  await emitAudited(admin, [{
    eventType: "activity.planned", practiceId: ctx.workspaceId,
    practitionerId: ctx.userId, actorId: ctx.userId, source: opts.source ?? "web",
    locationId: input.locationId ?? null, activityInstanceId: data.id as string, sessionId: data.id as string,
    payload: {
      activityType: input.activityType, title, planDate: input.planDate,
      plannedStartMinute: input.plannedStartMinute, plannedEndMinute: input.plannedEndMinute,
      facilityId: input.facilityId ?? null,
    },
  }], opts.correlationId);
  return { ok: true, value: { id: data.id } };
}

// The columns an event envelope needs on top of the ones the lifecycle checks need. Selected in the same
// round trip rather than fetched again at emit time: a second read could see a row another tab had
// already changed, and the event would then describe a state that never existed.
// `cancelled_at` is here (migration 236) so the lifecycle can REFUSE a cancelled block by name. Filtering
// it out of the load instead would refuse it too, with "Not found" -- and a practitioner who cancelled
// Thursday and then pressed Start on a stale tab is owed the sentence that says what happened, not one
// that says the clinic never existed.
const OWN_COLUMNS =
  "id, plan_date, started_at, ended_at, cancelled_at, practitioner_id, location_id, facility_id, " +
  "activity_type, title";

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
  // ⚠ MIGRATION 236 MADE A CANCELLED ACTIVITY POSSIBLE AND NOTHING HERE KNEW.
  //
  // THE DATABASE ALREADY REFUSED IT, which I got wrong in the first version of this comment and the
  // deliberate break corrected: practice_activity_cancel_before_start is `cancelled_at is null or
  // started_at is null`, and that reads in BOTH directions -- it stops a started activity being
  // cancelled AND a cancelled one being started. Removing this line does not let the write through.
  //
  // SO THIS LINE IS NOT THE GUARD. IT IS THE SENTENCE. Without it a practitioner pressing Start on a
  // stale tab gets a 500 reading `new row for relation "practice_activity" violates check constraint
  // "practice_activity_cancel_before_start"` -- true, useless, and indistinguishable from the product
  // being broken. With it they get 422 "that activity was cancelled", which is the actual answer.
  //
  // That is worth stating as a pattern: a database constraint makes a thing IMPOSSIBLE, and an engine
  // check makes it EXPLICABLE. Neither substitutes for the other, and the reason to keep both is not
  // belt-and-braces -- it is that a constraint violation is a fact about a schema and a refusal is a
  // fact about the practitioner's day.
  if (row.cancelled_at) return { ok: false, status: 422, code: "CANCELLED", message: "that activity was cancelled" };

  // ── CPR-CC-MOB-001 s8, RULED 2026-08-23: A STARTED SESSION CARRIES ITS LOCATION ────────────────
  //
  // ⚠ THE INVARIANT LIVES HERE, NOT IN THE TWO LAUNCHERS, AND THAT IS THE WHOLE POINT OF THE RULING.
  // The mobile sheet and the desktop dialog both ask for a location, and a rule enforced only in the
  // screens is a rule that lasts until the third caller -- the planner's quick add, an integration, a
  // harness, or a `curl` at the route, all of which reach planActivity and startActivity directly.
  // Every session begins here, whatever asked for it, so this is the one place the requirement cannot
  // be routed around.
  //
  // WHY START AND NOT PLAN. Planning a block before deciding where it will happen is legitimate --
  // the Planner does exactly that, and half the activities in this estate were created that way. What
  // must not happen is a session RUNNING with no location: every encounter, queue entry and document
  // it produces inherits that emptiness, and no later screen can reconstruct where the clinic was.
  //
  // ZERO LOCATIONS IS NOT A FAILURE. A practice that has configured none has nothing to choose, and
  // refusing would make the product unusable before setup is finished. The requirement is only that a
  // practice WITH locations records one.
  if (!row.location_id) {
    const { data: locs, error: locError } = await admin.from("practice_location")
      .select("id").eq("workspace_id", ctx.workspaceId).eq("active", true).limit(1);
    // ⚠ A FAILED READ ALLOWS THE START. Deliberately, and it is the one place this invariant yields:
    // the cost of a false refusal here is a practitioner who cannot open their clinic because a table
    // was briefly unreadable, and the cost of a false allow is one session with a blank location that
    // can be corrected afterwards. A data-quality rule must not become an availability risk.
    if (!locError && (locs ?? []).length > 0) {
      return {
        ok: false, status: 422, code: "LOCATION_REQUIRED",
        message: "choose where this session is happening before starting it — every encounter it "
          + "creates inherits the location, and a blank one cannot be worked out later",
      };
    }
  }

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
    // The same tidy-up endActivity does, for the same reason: switching away from a paused clinic is how
    // a practitioner abandons it, and an interval left open on a closed session would keep accruing
    // paused minutes against a clock that stopped.
    eventWarnings.push(...await closeOpenPause(admin, running.id, at, ctx.userId));
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

/**
 * Correct where a session happened.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
 *
 * planActivity records a location at creation and, until now, nothing could amend one. moveActivity
 * takes a date and two minutes; every other mutation here changes state, not place. So a practice that
 * picked the wrong location, or captured none before the requirement existed, had no way to put it
 * right through the product -- and on 2026-08-23 three ended sessions in the live estate had to be
 * corrected by a script written for the purpose. That is the gap this closes.
 *
 * It matters more since startActivity began REQUIRING a location: a rule that makes a field mandatory
 * and offers no way to amend it turns one wrong pick at a confirmation dialog into a permanent record.
 * A mandatory field without an edit path is a trap, not a control.
 *
 * ── WHAT IT REFUSES, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────────
 *
 *   cancelled   REFUSED. A cancelled activity is not a session that happened anywhere, so recording
 *               where it happened is recording a fact about nothing.
 *   ended       ALLOWED, and it is the case that prompted this. Correcting the past is the whole point.
 *   running     ALLOWED. Realising mid-clinic that the wrong site was picked is exactly when somebody
 *               notices, and making them wait until it ends would guarantee they forget.
 *   planned     ALLOWED, obviously.
 *
 * ⚠ IT WILL NOT CLEAR A LOCATION. `locationId` is required and may not be null. startActivity refuses
 * to run a session with no location once a practice has any, so an engine that could blank one would
 * be a way back into the state that invariant exists to prevent -- reachable, ironically, only after
 * the session had already satisfied it. Setting a DIFFERENT location is the correction; there is no
 * use for un-recording a place.
 *
 * ⚠ AN INACTIVE LOCATION IS ACCEPTED. Deactivation is about what a picker should OFFER, not about
 * where a clinic was held: a session genuinely run at a site since closed must still be recordable, or
 * the honest answer becomes unrepresentable and a blank is left instead. The refusal is only for a
 * location belonging to a different practice.
 */
export async function setActivityLocation(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { locationId: string; reason?: string | null },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; locationId: string; previousLocationId: string | null }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  const locationId = String(input.locationId ?? "").trim();
  if (!locationId)
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: "choose a location — this corrects where a session happened and cannot un-record one",
    };

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.cancelled_at)
    return {
      ok: false, status: 422, code: "CANCELLED",
      message: "that activity was cancelled, so it did not happen anywhere",
    };

  // ⚠ SCOPED TO THIS WORKSPACE, AND THE COLUMN CANNOT DO IT FOR US. practice_activity.location_id is a
  // uuid; nothing in the schema stops another practice's location id being written into it, and the
  // same hole is documented on practice_booking_access.visible_location_ids. An id that resolves to no
  // row HERE is refused as unknown rather than written and discovered later by a report that renders
  // somebody else's clinic name.
  const { data: loc, error: locError } = await admin.from("practice_location")
    .select("id, name, active").eq("id", locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (locError) return { ok: false, status: 500, code: "READ_FAILED", message: locError.message };
  if (!loc)
    return { ok: false, status: 404, code: "UNKNOWN_LOCATION", message: "that location is not one of this practice's" };

  const previousLocationId: string | null = (row.location_id as string | null) ?? null;
  if (previousLocationId === locationId)
    // Not an error: asking for the value it already has is a no-op, and reporting failure would make a
    // double-tap look like a problem. It writes no audit entry either -- a trail of changes that did
    // not change anything is a trail nobody reads.
    return { ok: true, value: { id, locationId, previousLocationId } };

  const { data: updated, error: updateError } = await admin.from("practice_activity")
    .update({ location_id: locationId, updated_at: new Date().toISOString() })
    .eq("id", id).eq("workspace_id", ctx.workspaceId).select("id");
  if (updateError) return { ok: false, status: 400, code: "WRITE_FAILED", message: updateError.message };
  // ⚠ NO ERROR IS NOT A ROW CHANGED. This repo has shipped silent write failures by believing it twice.
  if (!updated || updated.length === 0)
    return { ok: false, status: 409, code: "NOT_WRITTEN", message: "that activity changed underneath you; reload and try again" };

  // ⚠ THE PREVIOUS VALUE IS IN THE PAYLOAD, AND `wasBlank` IS THE FIELD THAT MATTERS. Filling a blank
  // afterwards and overwriting a recorded place are different acts with different weight: one is
  // completing a record, the other is contradicting it. A reader six months later cannot tell them
  // apart from the new value alone.
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: "practice.activity_location_set",
    payload: {
      activityId: id, locationId, locationName: loc.name as string,
      previousLocationId, wasBlank: previousLocationId === null,
      correctedAfterEnd: !!row.ended_at,
      locationInactive: loc.active === false,
      reason: input.reason?.trim() || null,
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });

  return { ok: true, value: { id, locationId, previousLocationId } };
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

  // CLOSING A PAUSED SESSION IS NOT A REFUSAL -- a clinic abandoned during the interruption that caused
  // the pause is an ordinary way for a day to end. The open interval is closed at the same instant the
  // session closed, AFTER the end has committed rather than before: if this write fails the ledger is
  // left with an open pause on a finished session, which `pauseLedger` clips to `ended_at` anyway, and
  // that is a far better failure than a pause closed on a session that then did not end and so silently
  // came back to life.
  const eventWarnings = [...await closeOpenPause(admin, id, at, ctx.userId)];

  // s7: Practice Performance recalculates on completion and Today at a Glance re-scopes from session to
  // day. Both find out from here.
  eventWarnings.push(...await emitEvents(admin, lifecycleEvents("completed", ctx, row, at, source)));

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_ended",
    payload: { activityId: id, activityType: row.activity_type, startedAt: row.started_at },
    correlationId: opts.correlationId, source,
  });
  return { ok: true, value: { id, eventWarnings } };
}

// ── PAUSE AND RESUME (CPR-V5-004 "Session Lifecycle") ────────────────────────────────────────────────
//
// CPR-V5-004 gives the session six rungs -- Start, Run, Pause, Resume, Close, Generate Summary -- and
// this file had two of them. What follows is the middle four.
//
// A PAUSE IS AN INTERVAL, NOT A STATUS, for exactly the reason migration 232 refused a status column on
// the activity itself. A stored 'PAUSED' would say that a session is stopped and not since when, so the
// minutes lost to it could never be recovered from it, and a clinic paused over lunch and forgotten
// would still read PAUSED the next morning with nothing to tell you how much of the night to discount.
// The two ends of the interval keep the state derived -- a session is paused exactly when it has a pause
// row with no resumed_at -- and put the arithmetic in the same rows as the state.
//
// ⚠ AND THE ARITHMETIC IS THE POINT. `sessionMetrics` computes progress and time-remaining from the
// clock, so before this existed a session paused for forty minutes burned forty minutes of both. That is
// CPR-CORE-001 s6.2's rule -- "interruption time must not be counted as active consultation time" -- one
// level up: it must not be counted as elapsed SESSION time either. session.ts subtracts what this ledger
// reports, which is why `pauseLedger` is exported rather than kept private: two engines computing paused
// minutes their own way is precisely the drift s16 forbids.

const CLOSED_PAUSE_WARNING = "session.pause";

/**
 * Close whatever pause is open on an activity, at the instant the session stopped moving.
 *
 * Returns WARNINGS rather than a failure, and rides back in the caller's `eventWarnings`. The write it
 * follows has already committed, so this is in the same position as an outbox emit and takes the same
 * decision for the same reason (see the argument at the head of events.ts): the session really did end,
 * and reporting that as a 500 would have the practitioner press Close again and be told the activity is
 * already over. The error is REPORTED rather than swallowed -- an unclosed pause is recoverable, and
 * `pauseLedger` clips an open interval to the session's end so the minutes stay right either way, but a
 * ledger that has been quietly failing to close is worth knowing about.
 */
async function closeOpenPause(admin: any, activityId: string, at: Date, actorId: string): Promise<string[]> {
  const { error } = await admin.from("practice_activity_pause")
    .update({ resumed_at: at.toISOString(), resumed_by: actorId })
    .eq("activity_id", activityId).is("resumed_at", null);
  // No row to close is the ordinary case -- most sessions are never paused -- so an empty update is not
  // reported. Only a failed one is.
  return error ? [`${CLOSED_PAUSE_WARNING}: CLOSE_FAILED ${error.message}`] : [];
}

/** One stopped stretch of a session. `minutes` is this interval's contribution, already clipped. */
export type PauseInterval = {
  id: string;
  pausedAtIso: string;
  /** Null while the pause is open, which is the only way this ledger says "stopped right now". */
  resumedAtIso: string | null;
  reason: string | null;
  minutes: number;
};

export type PauseLedger = {
  intervals: PauseInterval[];
  /**
   * Total stopped minutes so far.
   *
   * ⚠ NULL WHEN THE LEDGER COULD NOT BE READ, and never 0. Zero is a claim that the session ran without
   * interruption, and the caller subtracts it from the clock -- so a failed read reported as 0 would
   * silently hand back the un-corrected progress bar this whole feature exists to correct, and nothing
   * downstream could tell that from a session nobody paused.
   */
  pausedMinutes: number | null;
  /** A pause is open right now. False when the ledger is unreadable, which `pausedMinutes` says. */
  isPaused: boolean;
  pausedSince: string | null;
  unavailable: boolean;
  /** The database's own words when the read failed. Null when it succeeded. Never discarded. */
  detail: string | null;
};

const unreadableLedger = (detail: string): PauseLedger =>
  ({ intervals: [], pausedMinutes: null, isPaused: false, pausedSince: null, unavailable: true, detail });

/**
 * Every pause on one session, and the minutes they cost it.
 *
 * THE ONE DEFINITION OF PAUSED TIME. session.ts, the summary below and any later reader all come here,
 * because "how long was this clinic stopped" answered twice is "how long was this clinic stopped"
 * answered differently -- and only under the conditions that make it matter.
 *
 * @param endedAt clips every interval, open or closed, to the instant the session ended. An open pause
 *        on a finished session is possible (see closeOpenPause) and without the clip it would keep
 *        accruing minutes forever against a clock that stopped hours ago.
 */
export async function pauseLedger(
  admin: any, workspaceId: string, activityId: string,
  opts: { at?: Date; endedAt?: string | null } = {},
): Promise<PauseLedger> {
  const { data, error } = await admin.from("practice_activity_pause")
    .select("id, paused_at, resumed_at, reason")
    .eq("workspace_id", workspaceId).eq("activity_id", activityId)
    .order("paused_at", { ascending: true });
  // Before migration 235 is applied this is a missing-table error, which is exactly the case that must
  // not read as "never paused". See the argument on pausedMinutes above.
  if (error) return unreadableLedger(error.message);

  const nowMs = (opts.at ?? new Date()).getTime();
  // The clock stops at the end of the session, or at now for one still running.
  const ceilingMs = opts.endedAt ? Math.min(Date.parse(opts.endedAt), nowMs) : nowMs;

  let totalMs = 0;
  let pausedSince: string | null = null;
  const intervals: PauseInterval[] = ((data ?? []) as any[]).map(r => {
    const startMs = Date.parse(r.paused_at);
    // An open interval runs to the ceiling. A closed one is clipped to it as well: resumed_at should
    // never be later, but a row written by a clock-skewed caller must not be able to subtract more time
    // than the session has been running.
    const endMs = Math.min(r.resumed_at ? Date.parse(r.resumed_at) : ceilingMs, ceilingMs);
    const ms = Math.max(0, endMs - startMs);
    totalMs += ms;
    if (!r.resumed_at) pausedSince = r.paused_at;
    return {
      id: r.id, pausedAtIso: r.paused_at, resumedAtIso: r.resumed_at ?? null,
      reason: r.reason ?? null, minutes: Math.round(ms / 60000),
    };
  });

  return {
    intervals,
    // Summed in milliseconds and rounded ONCE. Rounding each interval and adding the results loses up to
    // half a minute per pause, and a morning of short interruptions is where that stops being noise.
    pausedMinutes: Math.round(totalMs / 60000),
    isPaused: pausedSince !== null,
    pausedSince,
    unavailable: false,
    detail: null,
  };
}

/**
 * The lifecycle events for a pause or a resume. Migration 233's catalogue, src/lib/practice/events.ts.
 *
 * ONE EVENT, NOT TWO, and this is the one place the pair in `lifecycleEvents` is deliberately broken.
 * s9's catalogue has `activity.paused` but no `activity.resumed`, so emitting the activity half of a
 * pause would announce a stop that no event in the vocabulary can ever announce the end of -- a
 * projection built on it would show every paused session as permanently stopped, and would be right to.
 * The session half is a matched pair (`session.paused` / `session.resumed`) and is what CPR-V5-004's
 * lifecycle names, so that is what is emitted.
 */
function pauseEvents(
  kind: "paused" | "resumed", ctx: WorkspaceContext, row: any, at: Date, source: EventSource,
  extra: Record<string, unknown> = {},
): EventEnvelope[] {
  return [{
    eventType: kind === "paused" ? "session.paused" : "session.resumed",
    practiceId: ctx.workspaceId,
    practitionerId: row.practitioner_id,
    actorId: ctx.userId,
    source,
    occurredAt: at,
    locationId: row.location_id ?? null,
    activityInstanceId: row.id,
    sessionId: row.id,
    payload: { activityType: row.activity_type, title: row.title, facilityId: row.facility_id ?? null, ...extra },
  }];
}

/**
 * Stop the session's clock. CPR-V5-004's "Pause".
 *
 * The session stays the CURRENT ACTIVITY while it is paused -- `runningActivityId` still returns it,
 * encounters still inherit it, and migration 232's one-running index still holds it. That is deliberate:
 * a practitioner stepping out of a clinic has not stopped being in that clinic, and clearing the context
 * would leave the next thing they record with no session to belong to. What a pause stops is the
 * ARITHMETIC, not the context.
 */
export async function pauseActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  opts: { at?: Date; reason?: string; source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; eventWarnings: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  const at = opts.at ?? new Date();
  const source: EventSource = opts.source ?? "web";
  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // Each refusal is its own code, because each is a different sentence on the screen: "that clinic is
  // over", "that clinic has not started" and "that clinic is already paused" send a practitioner to
  // three different next actions, and one shared 409 would send them nowhere.
  if (row.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is over" };
  if (!row.started_at)
    return { ok: false, status: 422, code: "NOT_STARTED", message: "that activity has not started, so there is nothing to pause" };

  // The reason is trimmed to null rather than stored as an empty string: "" and NULL would both mean
  // "no reason given" and the summary would have to know about both.
  const reason = opts.reason?.trim() || null;
  if (reason && reason.length > 200)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a pause reason is at most 200 characters" };

  // Checked before the write so the ordinary double-click is refused with a sentence, and only a genuine
  // race reaches the partial unique index. The same two-guard arrangement migration 234's harness makes
  // load-bearing: without the pre-check the index catches it anyway and nothing observable changes, so
  // the two must word themselves differently.
  const open = await pauseLedger(admin, ctx.workspaceId, id, { at });
  if (open.unavailable)
    return { ok: false, status: 500, code: "READ_FAILED", message: `the pause ledger could not be read: ${open.detail}` };
  if (open.isPaused)
    return { ok: false, status: 409, code: "ALREADY_PAUSED", message: "that activity is already paused" };

  const { error: pauseErr } = await admin.from("practice_activity_pause").insert({
    workspace_id: ctx.workspaceId, activity_id: id,
    paused_at: at.toISOString(), reason, paused_by: ctx.userId,
  });
  // A unique violation means another tab won the race between the read above and this write. The partial
  // index did its job and the caller is told, rather than left with two overlapping intervals whose
  // minutes are subtracted twice.
  if (pauseErr) {
    const raced = pauseErr.code === "23505";
    return {
      ok: false, status: raced ? 409 : 500, code: raced ? "ALREADY_PAUSED" : "PAUSE_FAILED",
      message: pauseErr.message,
    };
  }

  const eventWarnings = await emitEvents(admin, pauseEvents("paused", ctx, row, at, source, { reason }));

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_paused",
    payload: { activityId: id, activityType: row.activity_type, reason },
    correlationId: opts.correlationId, source,
  });
  return { ok: true, value: { id, eventWarnings } };
}

/** Start the session's clock again. CPR-V5-004's "Resume". */
export async function resumeActivity(
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
  if (row.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is over" };
  if (!row.started_at)
    return { ok: false, status: 422, code: "NOT_STARTED", message: "that activity has not started" };

  const open = await pauseLedger(admin, ctx.workspaceId, id, { at });
  if (open.unavailable)
    return { ok: false, status: 500, code: "READ_FAILED", message: `the pause ledger could not be read: ${open.detail}` };
  if (!open.isPaused)
    return { ok: false, status: 409, code: "NOT_PAUSED", message: "that activity is not paused" };

  // ⚠ THE UPDATE RETURNS THE ROW IT CHANGED AND THE COUNT IS CHECKED. Filtered on `resumed_at is null`
  // rather than on the interval's id so that a tab that lost the race writes nothing instead of
  // reopening a pause somebody else already closed -- but a filtered update that matches nothing is a
  // SUCCESS in PostgREST, so without reading what came back this would report a resume that did not
  // happen and the session would stay stopped with a Resume button that appeared to work.
  const { data: closed, error: resumeErr } = await admin.from("practice_activity_pause")
    .update({ resumed_at: at.toISOString(), resumed_by: ctx.userId })
    .eq("activity_id", id).is("resumed_at", null)
    .select("id, paused_at, reason");
  if (resumeErr) return { ok: false, status: 500, code: "RESUME_FAILED", message: resumeErr.message };
  if (!closed || closed.length === 0)
    return { ok: false, status: 409, code: "NOT_PAUSED", message: "that activity is not paused" };

  const interval = (closed as any[])[0];
  const pausedMinutes = Math.max(0, Math.round((at.getTime() - Date.parse(interval.paused_at)) / 60000));

  const eventWarnings = await emitEvents(admin, pauseEvents("resumed", ctx, row, at, source,
    { pausedMinutes, pausedAt: interval.paused_at, reason: interval.reason ?? null }));

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_resumed",
    payload: { activityId: id, activityType: row.activity_type, pausedMinutes, pausedAt: interval.paused_at },
    correlationId: opts.correlationId, source,
  });
  return { ok: true, value: { id, eventWarnings } };
}

// ── GENERATE SUMMARY (CPR-V5-004 "Session Summary") ──────────────────────────────────────────────────

export type SessionSummary = {
  activityId: string;
  activityType: ActivityType;
  label: string;
  title: string;
  /** Where it happened, and the id a correction control preselects with. */
  locationId: string | null;
  locationName: string | null;
  planDate: string;
  state: ActivityState;
  startedAtIso: string;
  /** Null while the session is still running -- a summary of a live clinic is a legitimate thing to ask for. */
  endedAtIso: string | null;
  plannedStartMinute: number;
  plannedEndMinute: number;
  plannedMinutes: number;
  /** Wall clock from start to end, or to now. Includes the pauses. */
  elapsedMinutes: number;
  /** Minutes the session was stopped. Null when the pause ledger could not be read -- never 0 for unknown. */
  pausedMinutes: number | null;
  /** elapsedMinutes minus pausedMinutes: the time the session was actually running. Null when unknowable. */
  activeMinutes: number | null;
  pauses: PauseInterval[];
  /** Null rather than 0 when the ledger is unreadable, for the same reason as pausedMinutes. */
  pauseCount: number | null;
  pauseLedgerUnavailable: boolean;
  /** Minutes past the planned end, measured against the pause-adjusted end. Null when it finished inside its window. */
  overrunMinutes: number | null;
  /**
   * s8's twelve figures for this session's scope.
   *
   * ⚠ COMPUTED BY metrics.ts, NOT HERE. s16: "no widget independently calculates a conflicting version of
   * a shared metric". A summary that counted its own patients would be a second answer to Patients Seen
   * living one screen away from the first, and each Metric already carries its own status and reason, so
   * an unreadable figure arrives as "unreadable" rather than as a confident zero on a document somebody
   * files.
   */
  metrics: PracticeMetrics;
  generatedAtIso: string;
};

/**
 * CPR-V5-004's "Generate Summary" rung: what this session was, how long it actually ran, what stopped it
 * and what came out of it.
 *
 * A READ, SO IT GATES ON THE READ CAPABILITY. Someone allowed to see the dashboard is allowed to see
 * what the session it is showing amounted to -- requiring `appointment.manage` here would hide the
 * summary from a role that can see every figure it is assembled from.
 */
export async function sessionSummary(
  admin: any, ctx: WorkspaceContext, activityId: string, opts: { at?: Date } = {},
): Promise<Result<SessionSummary>> {
  if (!ctx.capabilities.includes(CAN_VIEW))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_VIEW} is required` };

  const at = opts.at ?? new Date();

  // location_id AND the joined name. The id is what a correction control preselects with; the name is
  // what the summary prints. Neither substitutes for the other -- adding only the field to the type
  // while the select fetched only the join is precisely how locationId ended up null on every row of
  // PlannedActivity before it was caught.
  const { data: row, error } = await admin.from("practice_activity")
    .select("id, activity_type, title, plan_date, planned_start_minute, planned_end_minute, " +
      "started_at, ended_at, location_id, practice_location:location_id(name)")
    .eq("id", activityId).eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!row.started_at)
    return { ok: false, status: 422, code: "NOT_STARTED", message: "that session never started, so there is nothing to summarise" };

  // The same check todaysPlan and startActivity make, and skipped it would put the session's window on
  // the wrong instants and scope every metric below to somebody else's afternoon.
  const { data: ws, error: wsError } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  if (wsError) return { ok: false, status: 500, code: "READ_FAILED", message: wsError.message };
  const timezone = ws?.timezone || "UTC";

  const { startIso } = zonedDayRange(row.plan_date, timezone);
  const dayStartMs = Date.parse(startIso);
  const windowStartMs = dayStartMs + row.planned_start_minute * 60000;
  const windowEndMs = dayStartMs + row.planned_end_minute * 60000;

  const startedMs = Date.parse(row.started_at);
  const finishedMs = row.ended_at ? Date.parse(row.ended_at) : at.getTime();
  const elapsedMinutes = Math.max(0, Math.round((finishedMs - startedMs) / 60000));

  const ledger = await pauseLedger(admin, ctx.workspaceId, activityId, { at, endedAt: row.ended_at });
  const pausedMinutes = ledger.pausedMinutes;
  const activeMinutes = pausedMinutes === null ? null : Math.max(0, elapsedMinutes - pausedMinutes);

  // Overrun is measured against the PAUSE-ADJUSTED end, matching sessionMetrics: a clinic that stopped
  // for forty minutes and finished forty minutes late did not overrun, and telling a practitioner it did
  // would be the same arithmetic error this migration exists to remove, printed on a document.
  const adjustedEndMs = windowEndMs + (pausedMinutes ?? 0) * 60000;
  const over = Math.floor((finishedMs - adjustedEndMs) / 60000);

  const metrics = await practiceMetrics(admin, ctx, metricScope({
    date: row.plan_date, timezone, activityId,
    // The PLANNED window, which is what dashboard.ts scopes the live session by. Widening it to the
    // pause-adjusted end here would make the summary count encounters the dashboard did not, and the two
    // would disagree about the same clinic on the same afternoon.
    window: { fromIso: new Date(windowStartMs).toISOString(), toIso: new Date(windowEndMs).toISOString() },
  }), at);

  return {
    ok: true,
    value: {
      activityId: row.id,
      activityType: row.activity_type,
      label: ACTIVITY_LABEL[row.activity_type as ActivityType] ?? row.activity_type,
      title: row.title,
      locationId: (row.location_id ?? null) as string | null,
      locationName: ((row.practice_location as any)?.name ?? null) as string | null,
      planDate: row.plan_date,
      state: activityState(row.started_at, row.ended_at),
      startedAtIso: row.started_at,
      endedAtIso: row.ended_at ?? null,
      plannedStartMinute: row.planned_start_minute,
      plannedEndMinute: row.planned_end_minute,
      plannedMinutes: row.planned_end_minute - row.planned_start_minute,
      elapsedMinutes,
      pausedMinutes,
      activeMinutes,
      pauses: ledger.intervals,
      pauseCount: ledger.unavailable ? null : ledger.intervals.length,
      pauseLedgerUnavailable: ledger.unavailable,
      overrunMinutes: over > 0 ? over : null,
      metrics,
      generatedAtIso: at.toISOString(),
    },
  };
}

// ── CPR-HFE-001 v1.1 s6 -- WHAT THE SESSION PRODUCED, AND WHAT IT LEFT OPEN ─────────────────────────
//
// Session Complete and the Session Report both render THIS. Counts are of rows created inside the
// session's own window [started_at, ended_at] -- "where reliably recorded" (s6) means created_at is
// the reliability, and nothing is attributed by guesswork. Outstanding items are the s6 list:
// encounters from the window still unsigned, and follow-ups the window raised that are not yet
// booked. ⚠ null-count is never zero: a failed read says so.

export type SessionClinicalActivity = {
  available: boolean;
  reason: string | null;
  data: {
    followUpsCreated: number;
    investigationsRequested: number;
    proceduresPerformed: number;
    documentsSigned: number;
    /** Encounters STARTED in the window, and how many of those are not yet signed. */
    encountersStarted: number;
    encountersUnsigned: number;
    /** Follow-ups the window raised that are OPEN with no appointment yet -- "requiring booking". */
    followUpsNeedingBooking: number;
  } | null;
};

export async function sessionClinicalActivity(
  admin: any, ctx: WorkspaceContext, activityId: string,
): Promise<SessionClinicalActivity> {
  if (!ctx.capabilities.includes(CAN_VIEW))
    return { available: false, reason: `${CAN_VIEW} is required`, data: null };

  const { data: row, error } = await admin.from("practice_activity")
    .select("started_at, ended_at")
    .eq("id", activityId).eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .maybeSingle();
  if (error) return { available: false, reason: error.message, data: null };
  if (!row?.started_at) return { available: false, reason: "that session never started", data: null };
  return windowClinicalActivity(admin, ctx, {
    fromIso: row.started_at, toIso: row.ended_at ?? new Date().toISOString(),
  });
}

/** The same window counts over an arbitrary range -- the Daily Practice Report's day is a window too. */
export async function windowClinicalActivity(
  admin: any, ctx: WorkspaceContext, window: { fromIso: string; toIso: string },
): Promise<SessionClinicalActivity> {
  if (!ctx.capabilities.includes(CAN_VIEW))
    return { available: false, reason: `${CAN_VIEW} is required`, data: null };
  const { fromIso, toIso } = window;

  const ws = ctx.workspaceId;
  const count = async (table: string, timeCol: string, extra?: (q: any) => any) => {
    let q = admin.from(table).select("id", { count: "exact", head: true })
      .eq("workspace_id", ws).gte(timeCol, fromIso).lte(timeCol, toIso);
    if (extra) q = extra(q);
    const r = await q;
    if (r.error || r.count === null) return null;
    return r.count as number;
  };

  const [fu, inv, proc, docs, encs, unsigned, fuOpen] = await Promise.all([
    count("practice_follow_up", "created_at"),
    count("practice_encounter_investigation", "requested_at"),
    count("practice_procedure", "performed_at", q => q.eq("status", "PERFORMED")),
    count("practice_clinical_document", "signed_at", q => q.not("signed_at", "is", null)),
    count("practice_encounter", "started_at", q => q.not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)")),
    count("practice_encounter", "started_at",
      q => q.not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)").is("signed_at", null)),
    count("practice_follow_up", "created_at", q => q.eq("status", "OPEN")),
  ]);
  const all = [fu, inv, proc, docs, encs, unsigned, fuOpen];
  if (all.some(v => v === null))
    return { available: false, reason: "one of the session's counts could not be read, so none is shown -- a partial summary reads as a complete one", data: null };

  return {
    available: true, reason: null,
    data: {
      followUpsCreated: fu!, investigationsRequested: inv!, proceduresPerformed: proc!,
      documentsSigned: docs!, encountersStarted: encs!, encountersUnsigned: unsigned!,
      followUpsNeedingBooking: fuOpen!,
    },
  };
}
