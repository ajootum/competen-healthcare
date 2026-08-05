import type { WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";

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

const CAN_PLAN = "practice.calendar.manage";
const CAN_VIEW = "practice.home.view";

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
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";
  const at = opts.at ?? new Date();
  const date = opts.date ?? practiceToday(timezone, at);
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

/** Add an activity to a day's plan. */
export async function planActivity(
  admin: any, ctx: WorkspaceContext, input: PlanInput,
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
  return { ok: true, value: { id: data.id } };
}

async function loadOwn(admin: any, ctx: WorkspaceContext, id: string) {
  const { data, error } = await admin.from("practice_activity")
    .select("id, plan_date, started_at, ended_at")
    .eq("id", id).eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .maybeSingle();
  return { row: error ? null : data, error };
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
  admin: any, ctx: WorkspaceContext, id: string, opts: { at?: Date } = {},
): Promise<Result<{ id: string; endedPrevious: string | null }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  const at = opts.at ?? new Date();
  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is over" };
  if (row.started_at) return { ok: false, status: 409, code: "ALREADY_RUNNING", message: "that activity is already running" };

  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  // Compared against the PRACTICE's today, never the server's date. A practitioner in Kampala starting a
  // clinic at 01:00 UTC is starting today's clinic, and a server in another zone must not call it
  // tomorrow's. (The app clock and the database clock are never compared -- both sides here are the app's.)
  if (row.plan_date !== practiceToday(ws?.timezone || "UTC", at))
    return { ok: false, status: 422, code: "NOT_TODAY", message: "that activity is not planned for today" };

  // Whatever is running now stops now. This is the "Change" button in the comp: switching activity is
  // the normal way to move through a day, not an exception.
  const { data: running, error: runErr } = await admin.from("practice_activity")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .not("started_at", "is", null).is("ended_at", null).maybeSingle();
  if (runErr) return { ok: false, status: 500, code: "READ_FAILED", message: runErr.message };

  if (running?.id) {
    const { error: endErr } = await admin.from("practice_activity")
      .update({ ended_at: at.toISOString(), updated_at: at.toISOString() }).eq("id", running.id);
    if (endErr) return { ok: false, status: 500, code: "SWITCH_FAILED", message: endErr.message };
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

  return { ok: true, value: { id, endedPrevious: running?.id ?? null } };
}

/** End the activity. The plan is not rewritten to match: overrunning is recorded, not corrected. */
export async function endActivity(
  admin: any, ctx: WorkspaceContext, id: string, opts: { at?: Date } = {},
): Promise<Result<{ id: string }>> {
  if (!ctx.capabilities.includes(CAN_PLAN))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${CAN_PLAN} is required` };

  const at = opts.at ?? new Date();
  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!row.started_at) return { ok: false, status: 422, code: "NOT_STARTED", message: "that activity never started" };
  if (row.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is already over" };

  const { error: endErr } = await admin.from("practice_activity")
    .update({ ended_at: at.toISOString(), updated_at: at.toISOString() }).eq("id", id);
  if (endErr) return { ok: false, status: 500, code: "END_FAILED", message: endErr.message };
  return { ok: true, value: { id } };
}
