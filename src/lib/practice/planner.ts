import type { WorkspaceContext } from "@/lib/practice/access";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity-constants";
import { activityState } from "@/lib/practice/activity";
import { practiceToday } from "@/lib/practice/practice-time";
import { audit } from "@/lib/practice/audit";
import type { EventSource } from "@/lib/practice/events";
import { TRAVEL_BASIS_NOTE, WEEKDAY_NAME, WEEKDAY_SHORT } from "@/lib/practice/planner-constants";
import { occursOn, readRecurrence } from "@/lib/practice/recurrence";
import { MISSING_COLUMN_CODES, RECURRENCE_COLUMNS } from "@/lib/practice/availability-config";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-005 PRACTICE PLANNER -- the week, the actions on a block, and the rules that refuse a bad one.
// Migration 236.
//
// s1: "Replace the traditional appointment calendar with a Practice Planner. Activities -- not
// appointments -- are the primary planning object." That object is practice_activity (migration 232) and
// it is already the source of Current Activity and Current Session, which is s10's last acceptance
// criterion and the reason this module adds no second table. What did not exist was the WEEK: everything
// in this build reads one day at a time, so "all seven days always visible" had nothing behind it.
//
// ---- WHAT THIS MODULE OWNS AND WHAT IT DELIBERATELY DOES NOT --------------------------------------
//
//   activity.ts            plan / start / pause / resume / end. The LIFECYCLE of one block.
//   availability-config.ts the WEEKLY TEMPLATE -- the normal week, its exceptions and slot generation.
//   planner.ts (here)      the SEVEN-DAY READ, and s5's rewrites of a block that is already planned.
//
// The split matters most at s6 ("Template vs Operational Reality"). The template is read here and never
// written here: "Permanently Update Template" is editSession() in availability-config.ts, one call away,
// and a planner that quietly rewrote the regular week when somebody dragged a Tuesday clinic would
// change every future Tuesday on the strength of one afternoon.
//
// ---- THE OVERLAP RULE IS BORROWED, NOT REINVENTED --------------------------------------------------
//
// sessionConflict() in availability-config.ts already solves this exact shape for the template, and its
// header records that CPR-SET-002 shipped a bug by only refusing overlaps at the SAME location: a real
// practice ended up with 09:00-13:00 at Aga Khan and 09:00-13:00 at TMR International on one Tuesday,
// both accepted, because "different places may legitimately overlap". Nobody is in two places at one
// time. activityConflict() below applies the same two tests -- overlap regardless of place, then the
// destination's travel buffer between places -- to the DAY rather than to the weekday.
//
// A second overlap predicate written slightly differently is how one screen comes to accept what another
// refuses, so there is exactly one: `overlaps()`.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export {
  PLANNER_ACTIONS, PLANNER_QUICK_ACTIONS, PLANNER_WEEKDAYS, PLANNER_STATE_LABEL,
  WEEKDAY_NAME, WEEKDAY_SHORT, TRAVEL_BASIS_LABEL, TRAVEL_BASIS_NOTE, CONFLICT_LABEL,
  type PlannerActionKey,
} from "@/lib/practice/planner-constants";

/**
 * WHAT THIS ENGINE WILL NOT DO, stated where the code is rather than in a document nobody opens.
 * Each is a refusal a screen can render, not a silent no-op.
 */
export const PLANNER_REFUSES = [
  "Report a MEASURED travel time. The design comp shows '2h 45m Travel Time' on the week and '20m " +
    "travel' on a day, in the typography of something calculated. The only travel figure this product " +
    "holds is practice_location.travel_buffer_minutes -- a number the practitioner typed. Those typed " +
    "buffers are summed and the payload says so (`basis: typed_buffer`, `measured: false`), because a " +
    "practitioner who thinks a route was computed will trust it against their own judgement.",
  "Store or edit a TARGET for a day. The comp puts 'Edit targets' on the Day Summary. Nothing in this " +
    "product stores a target for a practitioner's day, and a number invented here would be rendered " +
    "back to them as their own professional standard.",
  "Make AI planning RECOMMENDATIONS -- 'Travel time is optimal', 'Consider moving 1 patient to the " +
    "12:20 slot'. s7 itself marks AI planning recommendations as a future capability. Conflict " +
    "detection and travel-time validation are here because they are RULES: they answer whether the " +
    "buffer the practitioner typed fits between two blocks, which is arithmetic, not advice.",
  "Treat a `leave` or `travel` block as time off the workload. Migration 237 made both real activity " +
    "types, and this engine counts every planned block in `plannedMinutes` -- including them. That is " +
    "arithmetic, not a policy: whether a week of leave is a light week or no week at all is the " +
    "practice's judgement, so `byType` reports the split and nothing here decides it.",
  "Write the weekly template. Dragging Tuesday's clinic moves TUESDAY. 'Permanently Update Template' " +
    "(s6) is editSession() in availability-config.ts and is a separate, deliberate act -- a planner that " +
    "rewrote the regular week from one afternoon would change every future Tuesday silently.",
  "Cancel an activity that has already started. It happened. End it instead -- and migration 236's " +
    "practice_activity_cancel_before_start says the same thing to any caller that forgets.",
  "Move, split or relocate an activity that has already started. The plan is what was intended and the " +
    "timestamps are what happened, and encounters recorded during a running activity inherit it as " +
    "their context -- relocating it would move a clinical record's setting after the fact.",
  "Delete anything. CPR-CORE-001 s13: deleted records are voided or superseded, never physically " +
    "removed. A cancelled block stays on the week, struck through, with who cancelled it and when.",
];

// ⚠ THESE MUST BE CAPABILITY CODES THAT ACTUALLY EXIST. A capability code is a STRING COMPARED AGAINST
// practice_role_capabilities. Inventing a plausible one costs nothing at compile time and returns 403 at
// runtime for every user including the practice owner -- so the screen hides the control rather than
// showing an error, and the feature is simply unreachable. Four invented codes have shipped here.
//
// Read out of the migrations rather than remembered: `appointment.manage` is migration 192,
// `practice.home.view` is migration 191, and they are the pair activity.ts and migration 235 already
// gate this same lifecycle on. Splitting the planner onto its own code would create a role that can
// start a clinic and cannot move it.
const CAN_PLAN = "appointment.manage";
const CAN_VIEW = "practice.home.view";

/** Exported so a harness can prove each one EXISTS, against these constants and never a re-typed list. */
export const PLANNER_CAPABILITIES = [CAN_PLAN, CAN_VIEW];

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

type Refusal = { ok: false; status: number; code: string; message: string };

// ── SHAPES ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * planned / running / done / CANCELLED.
 *
 * The fourth is derived from cancelled_at exactly as the first three are derived from started_at and
 * ended_at -- migration 236 followed 232's refusal of a status column for the same reason. A stored
 * status and a clock disagree the moment nobody clicks anything.
 */
export type PlannerActivityState = "planned" | "running" | "done" | "cancelled";

/**
 * A block on the week.
 *
 * NOT `PlannedActivity` FROM activity.ts, and the duplication is deliberate rather than lazy. That type
 * is the shape Today's Timeline reads and it has no cancellation, no notes and no lineage, because
 * migration 236 added those after it. Widening it would change a type five screens already render.
 * Named differently so nobody can pass one where the other is meant and lose the cancellation silently.
 */
export type PlannerActivity = {
  id: string;
  activityType: ActivityType;
  label: string;
  title: string;
  room: string | null;
  facilityId: string | null;
  facilityName: string | null;
  locationId: string | null;
  locationName: string | null;
  planDate: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
  plannedMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  /** Set when this block was copied from another. s5's Duplicate. */
  duplicatedFromId: string | null;
  /** Set on the SECOND half of a split. s5's Split. */
  splitFromId: string | null;
  state: PlannerActivityState;
};

/** Where the practitioner is, in clock order. Consecutive blocks at one place are one visit. */
export type DayLocationBlock = {
  locationId: string;
  name: string;
  facilityName: string | null;
  firstStartMinute: number;
  lastEndMinute: number;
  activityCount: number;
  /** The buffer the practitioner typed for getting HERE. Not a distance. */
  travelBufferMinutes: number;
};

export type TravelHop = {
  fromName: string;
  toName: string;
  /** Clock minutes actually left between the two blocks. Negative when they overlap. */
  gapMinutes: number;
  /** The destination's typed buffer. Whose number this is, is the whole point. */
  neededMinutes: number;
  sufficient: boolean;
};

/**
 * s7's "travel-time validation between locations", and the comp's travel figure.
 *
 * ⚠ `measured` IS ALWAYS FALSE AND IS IN THE PAYLOAD ON PURPOSE. See PLANNER_REFUSES and
 * TRAVEL_BASIS_NOTE. A screen that renders `bufferMinutes` without the basis is rendering a claim this
 * product cannot support.
 */
export type DayTravel = {
  bufferMinutes: number;
  basis: "typed_buffer";
  measured: false;
  note: string;
  hops: TravelHop[];
  /** The hops that do not fit. This is the validation, and it is a rule rather than a recommendation. */
  shortfalls: TravelHop[];
};

export type DayWorkload = {
  activityCount: number;
  cancelledCount: number;
  /**
   * Sum of every block's window. Exceeds `committedMinutes` exactly when blocks overlap.
   *
   * ⚠ THIS COUNTS `leave` AND `travel` TOO (migration 237's types). Deducting them here would be this
   * engine deciding that a week off is not a week, which is the practice's call and not arithmetic --
   * so the total is total, and `byType` is where a screen separates them.
   */
  plannedMinutes: number;
  /** The union of the windows: the time of day actually spoken for, counted once. */
  committedMinutes: number;
  /** First start to last end. Null on a day with nothing on it, which is not the same as nought. */
  spanMinutes: number | null;
  firstStartMinute: number | null;
  lastEndMinute: number | null;
  /** Unspoken-for minutes inside the span. */
  gapMinutes: number;
  byType: { activityType: string; label: string; count: number; minutes: number }[];
  /** Blocks with no location at all. A telephone review legitimately has none. */
  unassignedCount: number;
};

export type DayConflict = {
  code: "ACTIVITY_OVERLAP" | "ACTIVITY_TRAVEL_CONFLICT";
  message: string;
  activityIds: string[];
};

/** One session of the regular week, shown beside what is actually planned. s6. */
export type TemplateSession = {
  id: string;
  startsMinute: number;
  endsMinute: number;
  locationId: string | null;
  locationName: string | null;
  slotKind: string;
  note: string | null;
  /** True when something planned actually covers this window. False is s6's "override". */
  coveredByPlan: boolean;
};

export type PlannerDay = {
  date: string;
  weekday: number;
  weekdayName: string;
  weekdayShort: string;
  isToday: boolean;
  isPast: boolean;
  activities: PlannerActivity[];
  locations: DayLocationBlock[];
  travel: DayTravel;
  conflicts: DayConflict[];
  templateSessions: TemplateSession[];
  /** Null when the day could not be read. Never a zeroed summary of a day nobody looked at. */
  workload: DayWorkload | null;
  unavailable: boolean;
};

export type WeekWorkload = {
  activityCount: number;
  cancelledCount: number;
  plannedMinutes: number;
  committedMinutes: number;
  daysWithActivities: number;
  conflictCount: number;
  travelShortfallCount: number;
  /** Summed typed buffers across the week. The comp's "2h 45m". Typed, never measured. */
  travelBufferMinutes: number;
  travelBasis: "typed_buffer";
  travelMeasured: false;
  byType: { activityType: string; label: string; count: number; minutes: number }[];
  locationCount: number;
};

export type PlannerWeek = {
  timezone: string;
  todayDate: string;
  weekStartDate: string;
  weekEndDate: string;
  /** ALWAYS seven. s2: "all seven days always visible". A day with nothing on it is a day with nothing
   *  on it, and it is a row -- not an absent one a screen has to invent. */
  days: PlannerDay[];
  workload: WeekWorkload | null;
  /** True when the week could not be read, so a screen says so instead of drawing an empty week. */
  unavailable: boolean;
  /** The database's own words when a read failed. Null when everything succeeded. Never discarded. */
  detail: string | null;
  /** True when the week held more blocks than the cap below. Named rather than silently truncated. */
  truncated: boolean;
};

// ── SMALL PURE HELPERS ───────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (d: unknown): d is string =>
  typeof d === "string" && ISO_DATE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/**
 * THE ONE OVERLAP PREDICATE. Half-open on both sides, so a block ending at 13:00 and one starting at
 * 13:00 do not overlap -- which is the arrangement a practitioner means by "back to back", and the same
 * comparison sessionConflict() makes on the template.
 */
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && aEnd > bStart;

/** Noon-anchored, so a date never slips a day when it is parsed. 1 is Monday, 7 is Sunday. */
export const isoWeekday = (dateIso: string) =>
  (((new Date(`${dateIso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);

/** The Monday of the week containing this date. */
export function weekStartDate(dateIso: string): string {
  const noon = Date.parse(`${dateIso}T12:00:00Z`);
  return new Date(noon - (isoWeekday(dateIso) - 1) * 86400000).toISOString().slice(0, 10);
}

const addDays = (dateIso: string, n: number) =>
  new Date(Date.parse(`${dateIso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Minutes of the day actually spoken for, counting overlapping blocks once. */
function unionMinutes(windows: { s: number; e: number }[]): number {
  if (windows.length === 0) return 0;
  const sorted = [...windows].sort((a, b) => a.s - b.s);
  let total = 0, curS = sorted[0].s, curE = sorted[0].e;
  for (const w of sorted.slice(1)) {
    if (w.s > curE) { total += curE - curS; curS = w.s; curE = w.e; }
    else if (w.e > curE) curE = w.e;
  }
  return total + (curE - curS);
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m) % 60).padStart(2, "0")}`;

/**
 * Every column the planner reads or rewrites.
 *
 * ⚠ THE MIGRATION-236 COLUMNS ARE IN THE SELECT ON PURPOSE. Against an unapplied migration PostgREST
 * refuses the whole query by name, the read reports `unavailable` and the write reports READ_FAILED --
 * which is the correct outcome, and is the one thing a silent fallback to the old column list could not
 * give. A planner that quietly dropped `cancelled_at` would draw cancelled clinics as live ones.
 */
const PLANNER_COLUMNS =
  "id, activity_type, title, room, plan_date, planned_start_minute, planned_end_minute, " +
  "started_at, ended_at, cancelled_at, cancelled_by, cancellation_reason, notes, " +
  "duplicated_from_id, split_from_id, facility_id, location_id";

/**
 * PostgREST answers an unbounded select with at most 1000 rows AND NO INDICATION THAT IT DID. A week
 * belonging to one practitioner will not reach this, but "will not" is a belief about the data and the
 * cap is a property of the transport, so it is asked for explicitly and the overflow is REPORTED.
 */
const WEEK_ROW_CAP = 500;

function shape(row: any, locById: Map<string, any>, facilityById: Map<string, any>): PlannerActivity {
  const loc = row.location_id ? locById.get(row.location_id) : null;
  const fac = row.facility_id ? facilityById.get(row.facility_id) : null;
  return {
    id: row.id,
    activityType: row.activity_type,
    label: ACTIVITY_LABEL[row.activity_type as ActivityType] ?? row.activity_type,
    title: row.title,
    room: row.room ?? null,
    facilityId: row.facility_id ?? null,
    facilityName: fac?.name ?? null,
    locationId: row.location_id ?? null,
    locationName: loc?.name ?? null,
    planDate: row.plan_date,
    plannedStartMinute: row.planned_start_minute,
    plannedEndMinute: row.planned_end_minute,
    plannedMinutes: row.planned_end_minute - row.planned_start_minute,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    notes: row.notes ?? null,
    duplicatedFromId: row.duplicated_from_id ?? null,
    splitFromId: row.split_from_id ?? null,
    // The cancellation wins over the two lifecycle timestamps, and it can only be set on a block that
    // never started -- migration 236's practice_activity_cancel_before_start guarantees that, so this is
    // an ordering and not a decision about which of two true things to show.
    state: row.cancelled_at ? "cancelled" : activityState(row.started_at ?? null, row.ended_at ?? null),
  };
}

// ── THE SEVEN-DAY WEEK (s4) ──────────────────────────────────────────────────────────────────────────

/**
 * The week, Monday to Sunday, with every day's activities, locations and workload.
 *
 * ⚠ A FAILED READ IS NOT AN EMPTY WEEK, and the flags are shaped so a screen cannot confuse the two.
 * Seven days are always returned because s2 requires them, but a day whose read failed carries
 * `unavailable: true` and `workload: null` rather than a zeroed summary. "You have nothing on Thursday"
 * and "I could not find out about Thursday" are different sentences, and only one of them should ever be
 * shown to somebody deciding whether to take a theatre list.
 *
 * @param opts.date any date inside the week wanted. Defaults to the practice's today.
 */
export async function plannerWeek(
  admin: any, ctx: WorkspaceContext, opts: { date?: string; at?: Date } = {},
): Promise<PlannerWeek> {
  // ⚠ THE ERROR IS CHECKED. Discarded, a failed workspace read silently becomes "UTC", `today` is then
  // computed for the wrong calendar day, the week is built around the wrong Monday, and the result is a
  // confident week from a query that never succeeded. activity.ts records this exact bug.
  const { data: ws, error: wsError } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = ws?.timezone || "UTC";
  const at = opts.at ?? new Date();
  const todayDate = practiceToday(timezone, at);
  const anchor = isDate(opts.date) ? opts.date : todayDate;
  const weekStart = weekStartDate(anchor);
  const weekEnd = addDays(weekStart, 6);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const skeleton = (unavailable: boolean, detail: string | null): PlannerWeek => ({
    timezone, todayDate, weekStartDate: weekStart, weekEndDate: weekEnd,
    days: dates.map(date => emptyDay(date, todayDate, unavailable)),
    workload: unavailable ? null : emptyWeekWorkload(),
    unavailable, detail, truncated: false,
  });

  if (wsError) return skeleton(true, wsError.message);
  if (!ctx.capabilities.includes(CAN_VIEW))
    return skeleton(true, `${CAN_VIEW} is required`);

  const { data: rows, error } = await admin.from("practice_activity")
    .select(PLANNER_COLUMNS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("practitioner_id", ctx.userId)
    .gte("plan_date", weekStart).lte("plan_date", weekEnd)
    .order("plan_date", { ascending: true })
    .order("planned_start_minute", { ascending: true })
    .limit(WEEK_ROW_CAP + 1);
  if (error) return skeleton(true, error.message);

  const all = (rows ?? []) as any[];
  const truncated = all.length > WEEK_ROW_CAP;
  const kept = truncated ? all.slice(0, WEEK_ROW_CAP) : all;

  // The places and the institutions behind them, in one round trip each rather than an embedded join
  // per row: the travel buffers are needed for the hops anyway, so the map has to exist regardless.
  const [{ data: locs, error: locError }, { data: facs, error: facError }] = await Promise.all([
    admin.from("practice_location")
      .select("id, name, facility_id, travel_buffer_minutes").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_facility").select("id, name").eq("workspace_id", ctx.workspaceId),
  ]);
  // A location read that failed would silently rename every place to null and zero every travel buffer,
  // which reads as "no travel needed anywhere" -- the one wrong answer this module must never give.
  if (locError || facError) return skeleton(true, (locError ?? facError)!.message);

  const locById = new Map(((locs ?? []) as any[]).map(l => [l.id, l]));
  const facilityById = new Map(((facs ?? []) as any[]).map(f => [f.id, f]));

  // s6's template half, read and never written. Suspended and closed sessions are excluded: they
  // generate nothing and are not what the regular week currently says.
  // ⚠ TRY THE RECURRENCE COLUMNS, THEN FALL BACK -- MIGRATION 274 IS APPLIED BY HAND.
  //
  // PostgREST refuses the WHOLE query when one selected column does not exist, and skeleton(true) turns
  // that into an unavailable planner week. So naming migration 274's two columns unconditionally meant that
  // on any database where 274 had not been applied, the entire planner went dark -- not merely
  // un-recurrence-aware, which is all this change was supposed to risk. availability-config,
  // practice-sessions and booking-rules all try-then-fall-back for exactly this reason, and
  // readRecurrence() answers WEEKLY for a row without the columns, so the fallback degrades to the
  // behaviour this file had before.
  const TEMPLATE_BASE = "id, weekday, starts_minute, ends_minute, location_id, slot_kind, note";
  const readTemplates = (columns: string) => admin.from("practice_availability_template")
    .select(columns)
    .eq("workspace_id", ctx.workspaceId).eq("status", "active")
    .order("weekday").order("starts_minute");
  let tmplRes = await readTemplates(`${TEMPLATE_BASE}, ${RECURRENCE_COLUMNS}`);
  if (tmplRes.error && MISSING_COLUMN_CODES.has(String(tmplRes.error.code)))
    tmplRes = await readTemplates(TEMPLATE_BASE);
  const { data: templates, error: tmplError } = tmplRes;
  if (tmplError) return skeleton(true, tmplError.message);

  const byDate = new Map<string, PlannerActivity[]>();
  for (const r of kept) {
    const list = byDate.get(r.plan_date) ?? [];
    list.push(shape(r, locById, facilityById));
    byDate.set(r.plan_date, list);
  }

  const days = dates.map(date =>
    buildDay(date, todayDate, byDate.get(date) ?? [], locById, (templates ?? []) as any[]));

  return {
    timezone, todayDate, weekStartDate: weekStart, weekEndDate: weekEnd,
    days,
    workload: rollUp(days),
    unavailable: false, detail: null, truncated,
  };
}

function emptyTravel(): DayTravel {
  return {
    bufferMinutes: 0, basis: "typed_buffer", measured: false, note: TRAVEL_BASIS_NOTE,
    hops: [], shortfalls: [],
  };
}

function emptyDay(date: string, todayDate: string, unavailable: boolean): PlannerDay {
  const weekday = isoWeekday(date);
  return {
    date, weekday,
    weekdayName: WEEKDAY_NAME[weekday], weekdayShort: WEEKDAY_SHORT[weekday],
    isToday: date === todayDate, isPast: date < todayDate,
    activities: [], locations: [], travel: emptyTravel(), conflicts: [], templateSessions: [],
    // NULL, not a zeroed summary. A day nobody could read has no workload, and "0 minutes planned" is a
    // claim about a query that failed.
    workload: unavailable ? null : {
      activityCount: 0, cancelledCount: 0, plannedMinutes: 0, committedMinutes: 0,
      spanMinutes: null, firstStartMinute: null, lastEndMinute: null, gapMinutes: 0,
      byType: [], unassignedCount: 0,
    },
    unavailable,
  };
}

const emptyWeekWorkload = (): WeekWorkload => ({
  activityCount: 0, cancelledCount: 0, plannedMinutes: 0, committedMinutes: 0,
  daysWithActivities: 0, conflictCount: 0, travelShortfallCount: 0,
  travelBufferMinutes: 0, travelBasis: "typed_buffer", travelMeasured: false,
  byType: [], locationCount: 0,
});

function buildDay(
  date: string, todayDate: string, activities: PlannerActivity[],
  locById: Map<string, any>, templates: any[],
): PlannerDay {
  const day = emptyDay(date, todayDate, false);
  day.activities = activities;

  // CANCELLED BLOCKS ARE ON THE WEEK AND OUT OF THE ARITHMETIC. They are drawn struck through -- that is
  // the whole reason 236 voids instead of deleting -- but a cancelled clinic occupies no time, blocks
  // nothing and needs no travel, so every calculation below runs on the live ones.
  const live = activities.filter(a => a.state !== "cancelled")
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

  // ---- LOCATIONS, as a route. Consecutive blocks at one place are one visit, matching locationDay() in
  // hospital-booking.ts: the practitioner goes to Mulago once, not once per clinic.
  let unassignedCount = 0;
  for (const a of live) {
    if (!a.locationId) { unassignedCount++; continue; }
    const last = day.locations[day.locations.length - 1];
    if (last && last.locationId === a.locationId) {
      last.lastEndMinute = Math.max(last.lastEndMinute, a.plannedEndMinute);
      last.activityCount++;
      continue;
    }
    day.locations.push({
      locationId: a.locationId,
      name: a.locationName ?? "a location that no longer exists",
      facilityName: a.facilityName,
      firstStartMinute: a.plannedStartMinute,
      lastEndMinute: a.plannedEndMinute,
      activityCount: 1,
      travelBufferMinutes: locById.get(a.locationId)?.travel_buffer_minutes ?? 0,
    });
  }

  // ---- TRAVEL. Typed buffers, summed. See DayTravel and PLANNER_REFUSES.
  for (let i = 1; i < day.locations.length; i++) {
    const from = day.locations[i - 1], to = day.locations[i];
    const gapMinutes = to.firstStartMinute - from.lastEndMinute;
    const neededMinutes = to.travelBufferMinutes;
    const hop: TravelHop = {
      fromName: from.name, toName: to.name, gapMinutes, neededMinutes,
      sufficient: gapMinutes >= neededMinutes,
    };
    day.travel.hops.push(hop);
    day.travel.bufferMinutes += neededMinutes;
    if (!hop.sufficient) day.travel.shortfalls.push(hop);
  }

  // ---- CONFLICTS (s7). REPORTED here, REFUSED by activityConflict() on the write path -- the same
  // arrangement locationDay() takes with impossible moves, and for the same reason: a clash created
  // before two sites were linked, or by a write that predates this module, still exists and the
  // practitioner needs to see it rather than discover it on the road.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (overlaps(a.plannedStartMinute, a.plannedEndMinute, b.plannedStartMinute, b.plannedEndMinute)) {
        const samePlace = (a.locationId ?? null) === (b.locationId ?? null);
        day.conflicts.push({
          code: "ACTIVITY_OVERLAP",
          message: samePlace
            ? `${a.title} and ${b.title} overlap at ${hhmm(Math.max(a.plannedStartMinute, b.plannedStartMinute))}`
            : `you cannot be at ${a.locationName ?? "no particular place"} and ${b.locationName ?? "no particular place"} at the same time`,
          activityIds: [a.id, b.id],
        });
      }
    }
  }
  for (const hop of day.travel.shortfalls)
    day.conflicts.push({
      code: "ACTIVITY_TRAVEL_CONFLICT",
      message: `only ${hop.gapMinutes} minutes between ${hop.fromName} and ${hop.toName}, which needs ${hop.neededMinutes}`,
      activityIds: [],
    });

  // ---- WORKLOAD.
  const windows = live.map(a => ({ s: a.plannedStartMinute, e: a.plannedEndMinute }));
  const committedMinutes = unionMinutes(windows);
  const firstStartMinute = live.length ? Math.min(...windows.map(w => w.s)) : null;
  const lastEndMinute = live.length ? Math.max(...windows.map(w => w.e)) : null;
  const spanMinutes = firstStartMinute !== null && lastEndMinute !== null
    ? lastEndMinute - firstStartMinute : null;

  const byType = new Map<string, { count: number; minutes: number }>();
  for (const a of live) {
    const cur = byType.get(a.activityType) ?? { count: 0, minutes: 0 };
    cur.count++; cur.minutes += a.plannedMinutes;
    byType.set(a.activityType, cur);
  }

  day.workload = {
    activityCount: live.length,
    cancelledCount: activities.length - live.length,
    plannedMinutes: live.reduce((n, a) => n + a.plannedMinutes, 0),
    committedMinutes,
    spanMinutes,
    firstStartMinute,
    lastEndMinute,
    gapMinutes: spanMinutes === null ? 0 : spanMinutes - committedMinutes,
    byType: [...byType.entries()].map(([activityType, v]) => ({
      activityType, label: ACTIVITY_LABEL[activityType as ActivityType] ?? activityType, ...v,
    })).sort((a, b) => b.minutes - a.minutes),
    unassignedCount,
  };

  // ---- s6: THE TEMPLATE BESIDE THE REALITY. `coveredByPlan` false is an override -- the regular week
  // says clinic and today's plan does not -- which is precisely what s6 means by "the daily plan
  // overrides the template without destroying it".
  // ⚠ THE RECURRENCE, NOT JUST THE WEEKDAY. Migration 274 lets a session run every 2, 3 or 4 weeks from
  // an anchor date, and matching on weekday alone would draw an alternate-Saturday clinic on EVERY
  // Saturday -- a planner that shows a clinic the practitioner is not running. occursOn() is the same
  // function the slot generator uses to decide which occurrences to materialise, so the planner and the
  // diary cannot disagree about which Saturdays exist. readRecurrence() answers WEEKLY for any row
  // without the columns, so this is unchanged for every session that is not fortnightly.
  day.templateSessions = templates
    .filter(t => t.weekday === day.weekday && occursOn(day.date, t.weekday, readRecurrence(t)))
    .map(t => ({
      id: t.id,
      startsMinute: t.starts_minute,
      endsMinute: t.ends_minute,
      locationId: t.location_id ?? null,
      locationName: t.location_id ? locById.get(t.location_id)?.name ?? null : null,
      slotKind: t.slot_kind,
      note: t.note ?? null,
      coveredByPlan: live.some(a =>
        overlaps(a.plannedStartMinute, a.plannedEndMinute, t.starts_minute, t.ends_minute)),
    }));

  return day;
}

function rollUp(days: PlannerDay[]): WeekWorkload | null {
  // If ANY day is unreadable the week total is unknowable, and a partial total presented as a week is
  // the same lie as a zero presented as an empty day.
  if (days.some(d => d.unavailable || d.workload === null)) return null;

  const week = emptyWeekWorkload();
  const byType = new Map<string, { count: number; minutes: number }>();
  const locationIds = new Set<string>();

  for (const d of days) {
    const w = d.workload!;
    week.activityCount += w.activityCount;
    week.cancelledCount += w.cancelledCount;
    week.plannedMinutes += w.plannedMinutes;
    week.committedMinutes += w.committedMinutes;
    if (w.activityCount > 0) week.daysWithActivities++;
    week.conflictCount += d.conflicts.length;
    week.travelShortfallCount += d.travel.shortfalls.length;
    week.travelBufferMinutes += d.travel.bufferMinutes;
    for (const t of w.byType) {
      const cur = byType.get(t.activityType) ?? { count: 0, minutes: 0 };
      cur.count += t.count; cur.minutes += t.minutes;
      byType.set(t.activityType, cur);
    }
    for (const l of d.locations) locationIds.add(l.locationId);
  }

  week.byType = [...byType.entries()].map(([activityType, v]) => ({
    activityType, label: ACTIVITY_LABEL[activityType as ActivityType] ?? activityType, ...v,
  })).sort((a, b) => b.minutes - a.minutes);
  week.locationCount = locationIds.size;
  return week;
}

// ── CONFLICT DETECTION (s7) ──────────────────────────────────────────────────────────────────────────

/**
 * CAN A BLOCK SIT ON THIS DATE, AT THIS TIME, AT THIS PLACE?
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE SAME TWO TESTS sessionConflict() APPLIES TO THE TEMPLATE, applied to the day.
 *
 *   OVERLAP  nobody is in two places at one time, WHETHER OR NOT THEY ARE THE SAME PLACE. The
 *            same-location-only version of this check is a bug CPR-SET-002 shipped: a Tuesday with
 *            09:00-13:00 at Aga Khan and 09:00-13:00 at TMR International, both accepted, because
 *            "different locations may legitimately overlap". They may not. The reasoning and the real
 *            practice that found it are recorded above sessionConflict() in availability-config.ts.
 *
 *   TRAVEL   two blocks at different places need the DESTINATION's typed buffer between them. Migration
 *            228's rule, and the buffer belongs to whichever place is being travelled to.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * CANCELLED BLOCKS DO NOT CONFLICT. A clinic that was called off occupies no time, and refusing to plan
 * over it would make cancellation useless -- the block would still hold Thursday morning hostage.
 *
 * FINISHED BLOCKS DO. A clinic that already ran occupied that time, and planning another thing into it
 * would be double-booking the past. Returned as a refusal rather than silently allowed.
 *
 * `excludeId` keeps a block from conflicting with ITSELF while being moved, extended or relocated --
 * the same problem and the same fix as sessionConflict's own excludeId.
 *
 * @returns null when the placement is clear. A refusal object otherwise, ready to be returned as-is.
 */
export async function activityConflict(admin: any, ctx: WorkspaceContext, args: {
  planDate: string; plannedStartMinute: number; plannedEndMinute: number;
  locationId: string | null; excludeId?: string;
}): Promise<Refusal | null> {
  const { data: existing, error } = await admin.from("practice_activity")
    .select("id, title, planned_start_minute, planned_end_minute, location_id")
    .eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .eq("plan_date", args.planDate).is("cancelled_at", null)
    .limit(WEEK_ROW_CAP);
  // ⚠ NEVER "no rows, so no conflict". A failed read here would let every double-booking through, and
  // the failure would be invisible because a clear day looks exactly the same.
  if (error)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the day: ${error.message}` };

  const others = ((existing ?? []) as any[]).filter(a => a.id !== args.excludeId);
  if (others.length === 0) return null;

  const locationIds = [...new Set(
    [args.locationId, ...others.map(a => a.location_id)].filter(Boolean),
  )] as string[];
  const { data: locs, error: locError } = locationIds.length
    ? await admin.from("practice_location").select("id, name, travel_buffer_minutes")
      .eq("workspace_id", ctx.workspaceId).in("id", locationIds)
    : { data: [], error: null };
  if (locError)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the locations: ${locError.message}` };

  const locById = new Map(((locs ?? []) as any[]).map(l => [l.id, l]));
  const nameOf = (id: string | null) => (id ? locById.get(id)?.name ?? "another place" : "no particular place");
  const here = args.locationId ? locById.get(args.locationId) : null;

  for (const a of others) {
    const clash = overlaps(a.planned_start_minute, a.planned_end_minute,
      args.plannedStartMinute, args.plannedEndMinute);
    const samePlace = (a.location_id ?? null) === (args.locationId ?? null);

    if (clash)
      return {
        ok: false, status: 409, code: "ACTIVITY_OVERLAP",
        message: samePlace
          ? `that overlaps ${hhmm(a.planned_start_minute)}-${hhmm(a.planned_end_minute)}, already on this day at ${nameOf(a.location_id)}`
          : `you cannot be at ${nameOf(args.locationId)} and ${nameOf(a.location_id)} at the same time -- ${hhmm(a.planned_start_minute)}-${hhmm(a.planned_end_minute)} is already on this day`,
      };

    if (samePlace) continue;
    const gapBefore = args.plannedStartMinute - a.planned_end_minute;   // the other one first, then this
    const gapAfter = a.planned_start_minute - args.plannedEndMinute;    // this one first, then the other
    const needBefore = here?.travel_buffer_minutes ?? 0;
    const needAfter = locById.get(a.location_id)?.travel_buffer_minutes ?? 0;

    if (gapBefore >= 0 && gapBefore < needBefore)
      return {
        ok: false, status: 409, code: "ACTIVITY_TRAVEL_CONFLICT",
        message: `only ${gapBefore} minutes between ${nameOf(a.location_id)} and ${nameOf(args.locationId)}, which needs ${needBefore}`,
      };
    if (gapAfter >= 0 && gapAfter < needAfter)
      return {
        ok: false, status: 409, code: "ACTIVITY_TRAVEL_CONFLICT",
        message: `that would leave only ${gapAfter} minutes to reach ${nameOf(a.location_id)}, which needs ${needAfter}`,
      };
  }
  return null;
}

// ── THE ACTIONS (s5) ─────────────────────────────────────────────────────────────────────────────────
//
// EIGHT FUNCTIONS RATHER THAN ONE editActivity(), which is the opposite of the choice editSession() made
// next door, so the reason is written down. Those four template operations share one conflict check and
// differ only in arguments. These do not: move refuses a started block, extend allows one, shorten needs
// no conflict check at all and cancel needs a database constraint behind it. Folding them into one
// function would put four incompatible guard sets behind one `if`, and the failure mode of getting that
// wrong is a silent double-booking rather than a compile error.
//
// EVERY ONE OF THEM AUDITS, and none of them emits a domain event. planActivity() sets that precedent
// and migration 236 s7 records why: migration 233's catalogue is closed and has no activity.cancelled,
// activity.moved or activity.split, so a planner that emitted would announce a duplicated block while a
// hand-planned one stayed silent, and a projection built on the difference would be wrong about the plan.

const nowIso = () => new Date().toISOString();

/**
 * The caller's own block, or nothing.
 *
 * FILTERED ON practitioner_id AS WELL AS workspace_id, which is what makes every "not found" below a
 * tenancy boundary rather than a lookup miss -- another practice's Thursday is not merely invisible, it
 * is unreachable, and it answers with the same 404 an absent block would.
 */
async function loadOwn(admin: any, ctx: WorkspaceContext, id: string) {
  const { data, error } = await admin.from("practice_activity")
    .select(PLANNER_COLUMNS)
    .eq("id", id).eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
    .maybeSingle();
  return { row: error ? null : data, error };
}

/** The guards every action shares, in one place so none of them can be quietly skipped. */
function guard(row: any, opts: {
  needsPlanned?: boolean; needsNotEnded?: boolean;
} = {}): Refusal | null {
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.cancelled_at)
    return { ok: false, status: 422, code: "ALREADY_CANCELLED", message: "that activity was cancelled" };
  if (opts.needsPlanned && row.started_at)
    return {
      ok: false, status: 422, code: "ALREADY_STARTED",
      message: row.ended_at
        ? "that activity is over -- the plan is not rewritten to match what happened"
        : "that activity has already started",
    };
  if (opts.needsNotEnded && row.ended_at)
    return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that activity is over" };
  return null;
}

const forbidden = (code: string): Refusal =>
  ({ ok: false, status: 403, code: "FORBIDDEN", message: `${code} is required` });

const invalid = (message: string): Refusal =>
  ({ ok: false, status: 400, code: "VALIDATION_ERROR", message });

function validWindow(startMinute: number, endMinute: number): Refusal | null {
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute))
    return invalid("a window is a whole number of minutes from midnight");
  if (startMinute < 0 || startMinute > 1440 || endMinute < 0 || endMinute > 1440)
    return invalid("a window must sit inside the day, between 0 and 1440 minutes");
  if (endMinute <= startMinute)
    return invalid("an activity cannot end before it begins");
  return null;
}

// ---- MOVE ------------------------------------------------------------------------------------------

/**
 * s5's Move, and s5's drag-and-drop "across time and dates".
 *
 * DURATION IS PRESERVED WHEN ONLY THE START MOVES, because that is what dragging a block means. Passing
 * a start without an end and getting a block that ran to its old end time would silently stretch or
 * shrink every drag, and the practitioner would be correcting the length of things they only meant to
 * slide.
 *
 * REFUSES A BLOCK THAT HAS STARTED. Yesterday's ward round is not a thing you can reschedule.
 */
export async function moveActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { planDate?: string; plannedStartMinute?: number; plannedEndMinute?: number },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; planDate: string; plannedStartMinute: number; plannedEndMinute: number; changed: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) return refusal;

  if (input.planDate !== undefined && !isDate(input.planDate))
    return invalid("a date is YYYY-MM-DD");

  const planDate = input.planDate ?? row.plan_date;
  const startMinute = input.plannedStartMinute ?? row.planned_start_minute;
  const duration = row.planned_end_minute - row.planned_start_minute;
  const endMinute = input.plannedEndMinute
    ?? (input.plannedStartMinute !== undefined ? startMinute + duration : row.planned_end_minute);

  const bad = validWindow(startMinute, endMinute);
  if (bad) return bad;

  const changed = [
    planDate !== row.plan_date ? "planDate" : null,
    startMinute !== row.planned_start_minute ? "plannedStartMinute" : null,
    endMinute !== row.planned_end_minute ? "plannedEndMinute" : null,
  ].filter(Boolean) as string[];
  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const conflict = await activityConflict(admin, ctx, {
    planDate, plannedStartMinute: startMinute, plannedEndMinute: endMinute,
    locationId: row.location_id ?? null, excludeId: id,
  });
  if (conflict) return conflict;

  const { error: writeError } = await admin.from("practice_activity").update({
    plan_date: planDate, planned_start_minute: startMinute, planned_end_minute: endMinute,
    updated_at: nowIso(),
  }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "MOVE_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_moved",
    payload: {
      activityId: id, changed,
      from: { planDate: row.plan_date, start: hhmm(row.planned_start_minute), end: hhmm(row.planned_end_minute) },
      to: { planDate, start: hhmm(startMinute), end: hhmm(endMinute) },
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, planDate, plannedStartMinute: startMinute, plannedEndMinute: endMinute, changed } };
}

// ---- DUPLICATE -------------------------------------------------------------------------------------

/** No practitioner copies a block onto more days than this in one gesture, and an unbounded list is a
 *  loop of writes a mistyped payload can start. */
const DUPLICATE_DATE_CAP = 31;

/**
 * s5's Duplicate: copy a block onto one or more other dates.
 *
 * EACH DATE IS DECIDED SEPARATELY, following duplicateSession() next door. "Copy to Monday, Wednesday
 * and Friday" where Wednesday already has a clashing theatre list must copy to two days and say why the
 * third did not -- refusing all three makes the practitioner work out which, and copying all three
 * creates the double-booking the conflict check exists to prevent.
 *
 * THE COPY IS NEVER CANCELLED AND NEVER RUNNING. A cancelled block may be duplicated -- that is how a
 * called-off clinic is put on next week -- but the cancellation, the start and the end belong to the
 * original and are not carried over. The notes are, because a note like "bring the ultrasound" is part
 * of what the block IS.
 */
export async function duplicateActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: {
    toDates: string[];
    plannedStartMinute?: number; plannedEndMinute?: number;
    locationId?: string | null; facilityId?: string | null;
  },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ created: { date: string; id: string }[]; refused: { date: string; reason: string }[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);
  if (!Array.isArray(input.toDates) || input.toDates.length === 0)
    return invalid("choose at least one date to copy to");
  if (input.toDates.length > DUPLICATE_DATE_CAP)
    return invalid(`a copy can reach at most ${DUPLICATE_DATE_CAP} dates at once`);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  // NO STATE GUARD BEYOND EXISTENCE. Duplicating a finished clinic onto next Tuesday is the ordinary
  // way a week gets built, and duplicating a cancelled one is how it gets rescheduled.
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const startMinute = input.plannedStartMinute ?? row.planned_start_minute;
  const endMinute = input.plannedEndMinute ?? row.planned_end_minute;
  const bad = validWindow(startMinute, endMinute);
  if (bad) return bad;

  const locationId = input.locationId !== undefined ? input.locationId : row.location_id ?? null;
  const facilityId = input.facilityId !== undefined ? input.facilityId : row.facility_id ?? null;
  if (locationId) {
    const known = await knownLocation(admin, ctx, locationId);
    if (known) return known;
  }

  const created: { date: string; id: string }[] = [];
  const refused: { date: string; reason: string }[] = [];

  for (const date of [...new Set(input.toDates)]) {
    if (!isDate(date)) { refused.push({ date: String(date), reason: "not a date" }); continue; }

    const conflict = await activityConflict(admin, ctx, {
      planDate: date, plannedStartMinute: startMinute, plannedEndMinute: endMinute, locationId,
    });
    if (conflict) { refused.push({ date, reason: conflict.message }); continue; }

    const { data, error: insertError } = await admin.from("practice_activity").insert({
      workspace_id: ctx.workspaceId,
      practitioner_id: row.practitioner_id ?? ctx.userId,
      activity_type: row.activity_type, title: row.title,
      plan_date: date, planned_start_minute: startMinute, planned_end_minute: endMinute,
      facility_id: facilityId, location_id: locationId, room: row.room ?? null,
      notes: row.notes ?? null,
      duplicated_from_id: row.id,
    }).select("id").maybeSingle();
    if (insertError || !data) {
      refused.push({ date, reason: insertError?.message ?? "the copy was not created" });
      continue;
    }
    created.push({ date, id: data.id as string });
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_duplicated",
    payload: { activityId: id, created: created.map(c => c.date), refused },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { created, refused } };
}

// ---- SPLIT -----------------------------------------------------------------------------------------

/**
 * s5's Split: one block becomes two that abut at `atMinute`.
 *
 * NO CONFLICT CHECK, and that is a decision rather than an omission. Both halves lie strictly inside the
 * original window, so a split can create no overlap and no travel gap the original did not already have
 * -- running the check would only be able to refuse a clash that already exists, which would make a
 * pre-existing double-booking impossible to tidy up.
 *
 * ⚠ THE ORDER OF THE TWO WRITES IS CHOSEN FOR ITS FAILURE MODE. There is no transaction: every engine
 * here talks to PostgREST one statement per round trip. Inserting the second half first and then failing
 * to shorten the first would leave two blocks covering the same afternoon -- a double-booking created by
 * the very operation that is supposed to be safe. Shortening first and then failing to insert leaves a
 * short block and lost time, which is visible, harmless and fixed by extendActivity. So: shorten, then
 * insert, and if the insert fails put the original window back and say whether that worked.
 */
export async function splitActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { atMinute: number; secondTitle?: string },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ firstId: string; secondId: string; firstEndMinute: number; secondStartMinute: number }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  // A RUNNING BLOCK CANNOT BE SPLIT because there is no honest answer to which half the practitioner is
  // in: started_at belongs to one row and the encounters recorded so far inherited that row as their
  // context. Ending it and planning the remainder is the operation that keeps both facts true.
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) return refusal;

  const { atMinute } = input;
  if (!Number.isInteger(atMinute))
    return invalid("a split point is a whole number of minutes from midnight");
  if (atMinute <= row.planned_start_minute || atMinute >= row.planned_end_minute)
    return invalid(`a split must fall inside ${hhmm(row.planned_start_minute)}-${hhmm(row.planned_end_minute)}`);

  const secondTitle = (input.secondTitle ?? "").trim() || row.title;
  if (secondTitle.length > 200) return invalid("a title is at most 200 characters");

  const { error: shortenError } = await admin.from("practice_activity")
    .update({ planned_end_minute: atMinute, updated_at: nowIso() }).eq("id", id);
  if (shortenError)
    return { ok: false, status: 500, code: "SPLIT_FAILED", message: shortenError.message };

  const { data, error: insertError } = await admin.from("practice_activity").insert({
    workspace_id: ctx.workspaceId,
    practitioner_id: row.practitioner_id ?? ctx.userId,
    activity_type: row.activity_type, title: secondTitle,
    plan_date: row.plan_date,
    planned_start_minute: atMinute, planned_end_minute: row.planned_end_minute,
    facility_id: row.facility_id ?? null, location_id: row.location_id ?? null, room: row.room ?? null,
    notes: row.notes ?? null,
    split_from_id: row.id,
  }).select("id").maybeSingle();

  if (insertError || !data) {
    // Put it back, and REPORT whether that worked. A restore that silently failed would leave the
    // practitioner with a block half the length they planned and a message saying nothing happened.
    const { error: restoreError } = await admin.from("practice_activity")
      .update({ planned_end_minute: row.planned_end_minute, updated_at: nowIso() }).eq("id", id);
    return {
      ok: false, status: 500, code: "SPLIT_FAILED",
      message: restoreError
        ? `the second half was not created (${insertError?.message ?? "no row"}) and the original could NOT be restored: ${restoreError.message}`
        : `the second half was not created and the original window was restored: ${insertError?.message ?? "no row"}`,
    };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_split",
    payload: {
      activityId: id, secondActivityId: data.id, atMinute,
      was: { start: hhmm(row.planned_start_minute), end: hhmm(row.planned_end_minute) },
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return {
    ok: true,
    value: {
      firstId: id, secondId: data.id as string,
      firstEndMinute: atMinute, secondStartMinute: atMinute,
    },
  };
}

// ---- EXTEND AND SHORTEN ----------------------------------------------------------------------------

/**
 * s5's Extend: the block runs later than planned.
 *
 * ALLOWED WHILE THE BLOCK IS RUNNING, unlike move. A clinic overrunning is the normal case, not an
 * error -- activity.ts says so and reports `overrunMinutes` rather than correcting it -- and extending
 * the plan is how a practitioner says "this is going to take until one". Refused once it has ENDED,
 * because at that point the plan would be being rewritten to match what already happened.
 */
export async function extendActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { byMinutes: number },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; plannedEndMinute: number; byMinutes: number }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsNotEnded: true });
  if (refusal) return refusal;

  const { byMinutes } = input;
  if (!Number.isInteger(byMinutes) || byMinutes <= 0)
    return invalid("extend by a whole number of minutes greater than nought");

  const endMinute = row.planned_end_minute + byMinutes;
  // 1440 is midnight. A block cannot run past the end of its own day, because plan_date and the minute
  // columns are migration 232's whole vocabulary for when something is -- there is no way to express
  // 23:30 to 00:30, and inventing one here would put an activity on a date it is not on.
  if (endMinute > 1440)
    return invalid(`that would run past midnight -- ${hhmm(row.planned_end_minute)} plus ${byMinutes} minutes does not fit in the day`);

  const conflict = await activityConflict(admin, ctx, {
    planDate: row.plan_date, plannedStartMinute: row.planned_start_minute, plannedEndMinute: endMinute,
    locationId: row.location_id ?? null, excludeId: id,
  });
  if (conflict) return conflict;

  const { error: writeError } = await admin.from("practice_activity")
    .update({ planned_end_minute: endMinute, updated_at: nowIso() }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "EXTEND_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_extended",
    payload: { activityId: id, byMinutes, from: hhmm(row.planned_end_minute), to: hhmm(endMinute) },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, plannedEndMinute: endMinute, byMinutes } };
}

/**
 * s5's Shorten.
 *
 * NO CONFLICT CHECK, for the reason editSession() exempts a suspend: taking time OUT of a day can never
 * create an overlap, and can only ever widen the gap before whatever comes next. Running the check
 * anyway would mean a day that is ALREADY double-booked could not be tidied up, because the first thing
 * a practitioner would try -- making one of the two blocks shorter -- would be refused by the clash it
 * is fixing.
 */
export async function shortenActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { byMinutes: number },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; plannedEndMinute: number; byMinutes: number }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsNotEnded: true });
  if (refusal) return refusal;

  const { byMinutes } = input;
  if (!Number.isInteger(byMinutes) || byMinutes <= 0)
    return invalid("shorten by a whole number of minutes greater than nought");

  const endMinute = row.planned_end_minute - byMinutes;
  if (endMinute <= row.planned_start_minute)
    return invalid(`that would leave nothing -- the block starts at ${hhmm(row.planned_start_minute)} and runs ${row.planned_end_minute - row.planned_start_minute} minutes`);

  const { error: writeError } = await admin.from("practice_activity")
    .update({ planned_end_minute: endMinute, updated_at: nowIso() }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "SHORTEN_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_shortened",
    payload: { activityId: id, byMinutes, from: hhmm(row.planned_end_minute), to: hhmm(endMinute) },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, plannedEndMinute: endMinute, byMinutes } };
}

// ---- CANCEL ----------------------------------------------------------------------------------------

/**
 * s5's Cancel. CPR-CORE-001 s13: voided, never deleted.
 *
 * THE BLOCK STAYS ON THE WEEK. Struck through, with who called it off, when, and why if they said. A
 * deleted row would take the audit trail's subject with it, would leave any encounter that inherited it
 * pointing at nothing, and would make "what happened to Thursday" -- the exact question a cancellation
 * raises -- unanswerable.
 *
 * REFUSES A BLOCK THAT HAS STARTED, and the database refuses it too
 * (practice_activity_cancel_before_start, migration 236). A clinic that ran is a clinic that happened.
 * Marking it cancelled would retroactively unmake the setting of every clinical record made in it.
 */
export async function cancelActivity(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { reason?: string } = {},
  opts: { at?: Date; source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; cancelledAtIso: string; reason: string | null }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) {
    // The started case gets its own sentence here rather than the shared one, because it is the only
    // refusal in this module with an obvious next action and the practitioner should be told it.
    if (refusal.code === "ALREADY_STARTED")
      return { ...refusal, message: "that activity has already started -- end it rather than cancelling it" };
    return refusal;
  }

  // Trimmed to null rather than stored as an empty string: "" and NULL would both mean "no reason given"
  // and every reader would have to know about both.
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 300)
    return invalid("a cancellation reason is at most 300 characters");

  const at = (opts.at ?? new Date()).toISOString();
  const { error: writeError } = await admin.from("practice_activity").update({
    cancelled_at: at, cancelled_by: ctx.userId, cancellation_reason: reason, updated_at: nowIso(),
  }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "CANCEL_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_cancelled",
    payload: {
      activityId: id, activityType: row.activity_type, planDate: row.plan_date,
      start: hhmm(row.planned_start_minute), end: hhmm(row.planned_end_minute), reason,
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, cancelledAtIso: at, reason } };
}

// ---- CHANGE LOCATION -------------------------------------------------------------------------------

/** Both sides checked against the caller's workspace, so a block can never point at another practice's
 *  place -- which would leak that practice's location names into this one's week. */
async function knownLocation(admin: any, ctx: WorkspaceContext, locationId: string): Promise<Refusal | null> {
  const { data, error } = await admin.from("practice_location")
    .select("id").eq("id", locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  return null;
}

async function knownFacility(admin: any, ctx: WorkspaceContext, facilityId: string): Promise<Refusal | null> {
  const { data, error } = await admin.from("practice_facility")
    .select("id").eq("id", facilityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  return null;
}

/**
 * s5's Change Location.
 *
 * ⚠ THE CONFLICT CHECK RUNS EVEN THOUGH THE TIME HAS NOT MOVED, and this is the case the check exists
 * for. Two blocks that sat happily at one hospital, one at 09:00-12:00 and one at 12:30-15:00, become
 * impossible the moment the second is moved to a site forty minutes away -- nothing about the clock
 * changed and the day just became unworkable.
 *
 * REFUSES A BLOCK THAT HAS STARTED. Encounters recorded during it inherit it as their context, so
 * relocating it would move the setting of a clinical record after the fact -- a change nothing
 * downstream could detect, because an encounter carries the activity id and not a copy of the place.
 */
export async function changeActivityLocation(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { locationId?: string | null; facilityId?: string | null; room?: string | null },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; changed: string[] }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  const refusal = guard(row, { needsPlanned: true });
  if (refusal) return refusal;

  const locationId = input.locationId !== undefined ? input.locationId : row.location_id ?? null;
  const facilityId = input.facilityId !== undefined ? input.facilityId : row.facility_id ?? null;
  const room = input.room !== undefined ? (input.room?.trim() || null) : row.room ?? null;
  if (room && room.length > 80) return invalid("a room is at most 80 characters");

  if (locationId && locationId !== (row.location_id ?? null)) {
    const bad = await knownLocation(admin, ctx, locationId);
    if (bad) return bad;
  }
  if (facilityId && facilityId !== (row.facility_id ?? null)) {
    const bad = await knownFacility(admin, ctx, facilityId);
    if (bad) return bad;
  }

  const changed = [
    locationId !== (row.location_id ?? null) ? "locationId" : null,
    facilityId !== (row.facility_id ?? null) ? "facilityId" : null,
    room !== (row.room ?? null) ? "room" : null,
  ].filter(Boolean) as string[];
  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  if (changed.includes("locationId")) {
    const conflict = await activityConflict(admin, ctx, {
      planDate: row.plan_date,
      plannedStartMinute: row.planned_start_minute, plannedEndMinute: row.planned_end_minute,
      locationId, excludeId: id,
    });
    if (conflict) return conflict;
  }

  const { error: writeError } = await admin.from("practice_activity").update({
    location_id: locationId, facility_id: facilityId, room, updated_at: nowIso(),
  }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "RELOCATE_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_relocated",
    payload: {
      activityId: id, changed,
      from: { locationId: row.location_id ?? null, facilityId: row.facility_id ?? null, room: row.room ?? null },
      to: { locationId, facilityId, room },
    },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, changed } };
}

// ---- ADD NOTES -------------------------------------------------------------------------------------

/**
 * s5's Add Notes.
 *
 * NO STATE GUARD AT ALL, which is the only action here that has none, so the reason is written down. A
 * note is commentary on the block and not part of the plan: annotating a clinic that has finished
 * ("ran over, three patients rebooked") and annotating one that was cancelled ("theatre list pulled")
 * are both exactly when a practitioner reaches for this. Refusing either would leave the one place the
 * explanation belongs unwritable at the one moment it is wanted.
 *
 * PASSING AN EMPTY STRING CLEARS THE NOTE, and it is stored as NULL rather than "" so that no reader has
 * to treat two different values as the same absence.
 */
export async function addActivityNotes(
  admin: any, ctx: WorkspaceContext, id: string,
  input: { notes: string | null },
  opts: { source?: EventSource; correlationId?: string } = {},
): Promise<Result<{ id: string; notes: string | null; cleared: boolean }>> {
  if (!ctx.capabilities.includes(CAN_PLAN)) return forbidden(CAN_PLAN);

  const { row, error } = await loadOwn(admin, ctx, id);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const notes = (input.notes ?? "").trim() || null;
  if (notes && notes.length > 2000) return invalid("a note is at most 2000 characters");
  if (notes === (row.notes ?? null))
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const { error: writeError } = await admin.from("practice_activity")
    .update({ notes, updated_at: nowIso() }).eq("id", id);
  if (writeError) return { ok: false, status: 500, code: "NOTES_FAILED", message: writeError.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.activity_notes_changed",
    // THE NOTE ITSELF IS NOT IN THE AUDIT PAYLOAD. practice_audit_event is retained for compliance and
    // is not the place to accumulate copies of free text that may name a patient. Its length and whether
    // it was cleared are enough to answer "who changed the note on Thursday".
    payload: { activityId: id, cleared: notes === null, length: notes?.length ?? 0 },
    correlationId: opts.correlationId, source: opts.source ?? "web",
  });
  return { ok: true, value: { id, notes, cleared: notes === null } };
}
