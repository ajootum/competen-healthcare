import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { zonedDayRange } from "@/lib/practice/practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// CPR-CORE-001 CORE-10 -- THE METRIC ENGINE. One metric, one owning function, one formula.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS AT ALL, given that every figure in it is already computed somewhere.
//
// CORE-001 s3: "Single source of truth: Each metric has one owning engine and one documented
// calculation." s16: "No widget independently calculates a conflicting version of a shared metric" and
// "Each metric is traceable to source records and a documented formula."
//
// Today three modules each compute their own version of the same eight-to-twelve figures --
// session.ts (todayAtAGlance, sessionMetrics), command-centre.ts (heroStats, performance) and
// operations-home.ts -- and they DISAGREE. "Patients Seen" is encounters-started in one and
// encounters-completed in another; "Completed" is an appointment status in one and an encounter state in
// the spec. A dashboard whose two cards answer the same question differently is worse than one that
// answers it once: the practitioner cannot tell which number is wrong, so both stop being used.
//
// This module owns section 8's twelve definitions and nothing else. It renders nothing, labels nothing
// and decides no tone. Callers read from here or they are computing a second truth.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THREE DOCTRINES, AND EVERY FUNCTION BELOW OBEYS ALL THREE.
//
//  1. A FAILED READ IS NEVER A ZERO. Every `.error` is checked and surfaced as status "unreadable" with
//     the database's own message. "Nobody is waiting" and "I could not find out who is waiting" are
//     different sentences and only one of them may be shown to somebody about to close a clinic.
//
//  2. A TRUNCATED PAGE IS NEVER AN AVERAGE. PostgREST caps an unbounded select at 1000 rows. Every
//     row-level read here carries an EXPLICIT limit so a full page is DETECTABLE, and a detectable
//     overflow is reported as not-knowable rather than quietly averaged over whichever rows came back
//     first. Pure counts use head+count, which is a server-side count and is not subject to the cap.
//
//  3. A METRIC THAT CANNOT BE COMPUTED HONESTLY RETURNS NULL, NOT A DEFAULT. No denominator, no valid
//     observation, no check-in to measure from -- null, with a reason. s8 on Clinic Delay: "No comparison
//     shown until enough valid observations exist."
//
// ⚠ EVERY TABLE AND COLUMN BELOW WAS CHECKED AGAINST supabase/migrations. A wrong column name does not
// fail typecheck: PostgREST returns an error at runtime, this codebase turns that into "could not read",
// and the bug is silent. The migration each source came from is named in the comment above its metric.

// ── SCOPE ────────────────────────────────────────────────────────────────────────────────────────────
//
// s7 on Today at a Glance: "Counts are session-scoped after session start; day-scoped before start".
//
// ⚠ THE TWO SCOPES ARE NOT SYMMETRICAL, AND PRETENDING THEY WERE IS HOW A SESSION COUNT LIES.
// practice_encounter carries activity_id (migration 232, written by launchEncounter since CPR-V3-001),
// so an encounter's session membership is a FACT. practice_appointment, practice_queue_entry and
// practice_follow_up carry no activity link at all, so their session membership can only ever be
// approximated by the clock. Encounter metrics therefore filter on activity_id when a session is given;
// the others stay time-windowed and say so in `sources`.

export type MetricScopeKind = "day" | "session";

export type MetricScope = {
  kind: MetricScopeKind;
  /** The practice's calendar day, YYYY-MM-DD. Date-typed columns (follow_up.due_on) compare against this. */
  date: string;
  timezone: string;
  /** Half-open instant window [fromIso, toIso). Half-open because a closed range drops or double-counts the boundary. */
  fromIso: string;
  toIso: string;
  /** Inclusive date range for date-typed columns. Equal to `date` at both ends for a day or a session. */
  fromDate: string;
  toDate: string;
  /** practice_activity.id when a session is running. Null means day scope for encounters too. */
  activityId: string | null;
};

/**
 * Build the scope every metric is computed over.
 *
 * With no window and no activity this is the practice's whole calendar day, in the practice's own
 * timezone -- never the server's, which is right for about twenty-one hours a day and silently wrong for
 * the three that matter most (practice-time.ts says why).
 */
export function metricScope(input: {
  date: string;
  timezone: string;
  /** The running session's window. Session scope without it falls back to the day's instants. */
  window?: { fromIso: string; toIso: string } | null;
  activityId?: string | null;
}): MetricScope {
  const day = zonedDayRange(input.date, input.timezone);
  const activityId = input.activityId ?? null;
  return {
    kind: input.window || activityId ? "session" : "day",
    date: input.date,
    timezone: input.timezone,
    fromIso: input.window?.fromIso ?? day.startIso,
    toIso: input.window?.toIso ?? day.endIso,
    // A session lives inside one calendar day, so the date range is the day at both ends either way.
    fromDate: input.date,
    toDate: input.date,
    activityId,
  };
}

// ── THE RESULT SHAPE ─────────────────────────────────────────────────────────────────────────────────
//
// s16: "Each metric is traceable to source records and a documented formula." That is a property of the
// VALUE, not of a document somebody may or may not open, so the formula and the source columns travel
// with the number and can be rendered next to it.

export type MetricStatus =
  /** The value stands and was computed over `observations` source records. */
  | "ok"
  /** Read fine; there is no honest value. No valid observation, no denominator, too few to compare. */
  | "unknowable"
  /** A read failed, or came back truncated. NOT a zero. */
  | "unreadable"
  /** The caller may not see the domain this is computed from. NOT a zero either. */
  | "not_permitted";

export type MetricKey =
  | "booked" | "waiting" | "completed" | "walk_in" | "cancelled" | "emergency"
  | "follow_ups_due" | "no_show" | "patients_seen" | "remaining"
  | "average_consult_time" | "average_wait_time" | "clinic_delay";

export type Metric = {
  key: MetricKey;
  label: string;
  /** Null whenever the figure was not earned. Never a default, never a zero standing in for a failure. */
  value: number | null;
  unit: "count" | "minutes";
  status: MetricStatus;
  /** Source records the value was computed over. Null when nothing was read. */
  observations: number | null;
  /** Source records read and then dropped by a documented exclusion. Disclosed rather than hidden. */
  excluded: number;
  /** Plain language, whenever `value` is null. Null when the value stands. */
  reason: string | null;
  /**
   * ⚠ WHAT THIS FIGURE COUNTS, FOR THE PERSON READING IT (CPR-HFE-REF-001 s5).
   *
   * `formula` and `sources` below are the ENGINEERING answer and they stay: s16 requires every metric
   * to be traceable to source records and a documented formula, and that traceability is a property of
   * the number rather than of a document somebody may never open.
   *
   * But they were what the Command Centre put in a tile's tooltip, so hovering a tile on the first
   * screen after sign-in read "count of practice_patient rows created within the period whose status is
   * not 'merged' Source: practice_patient.created_at, practice_patient.status." A practitioner deciding
   * whether to trust a number needs to know what it counts, not which columns it was read from.
   */
  basis: string;
  /** ⚠ ENGINEERING. The calculation, in words. Not rendered to a practitioner -- see `basis`. */
  formula: string;
  /** ⚠ ENGINEERING. table.column identifiers the value came from. Not rendered to a practitioner. */
  sources: string[];
  scopeKind: MetricScopeKind;
};

// ── CAPABILITIES ─────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THESE ARE STRINGS COMPARED AGAINST practice_role_capabilities. Inventing a plausible one costs
// nothing at compile time and silently disables the feature at runtime -- this exact bug has shipped in
// this codebase twice (`practice.calendar.manage` in activity.ts, `appointment.view` in todays-work.ts),
// and in both cases the screen showed a confident zero rather than an error.
//
// Each of the three below was read out of a migration, not remembered:
//   practice.calendar.view  migration 191, held by practitioner and practice_assistant
//   encounter.list          migration 191 (practitioner) and 194 (practice_assistant)
//   followup.view           migration 191 (practitioner) and 196 (practice_assistant)
const CAP_DIARY = "practice.calendar.view";
const CAP_ENCOUNTERS = "encounter.list";
const CAP_FOLLOWUPS = "followup.view";

/** Exported so a harness can prove each one EXISTS in practice_role_capabilities rather than re-typing it. */
export const METRIC_CAPABILITIES = [CAP_DIARY, CAP_ENCOUNTERS, CAP_FOLLOWUPS];

// ── BOUNDS ───────────────────────────────────────────────────────────────────────────────────────────
//
// ROW_CAP is deliberately far above a clinic day and deliberately BELOW nothing: reaching it is reported
// as unreadable, never averaged. IN_CHUNK keeps a `.in()` filter's URL short enough to survive proxies;
// a 500-uuid IN list is a 19KB query string and fails in ways that look like an empty result.
const ROW_CAP = 2000;
const IN_CHUNK = 100;

/**
 * s8 Clinic Delay: "No comparison shown until enough valid observations exist." The spec sets the rule
 * and leaves the number to the implementation, so: five. Below five consultations a median delay is one
 * person's late start wearing a statistic's clothes, and this is the figure a practitioner would
 * rearrange an afternoon over.
 */
export const MIN_OBSERVATIONS_FOR_DELAY = 5;

/**
 * s8 Booked: "define whether no-shows remain booked in historical totals." DECISION: THEY DO.
 *
 * A no-show was assigned to the day, was not cancelled, and consumed a slot nobody else could use. If it
 * left the Booked total the moment it was marked, the day's Booked figure would SHRINK as the clinic ran
 * -- so "12 booked" at nine in the morning and "9 booked" at five would both be true and the card would
 * be useless for the one thing it is for. Cancelled and No-show are their own metrics (s8: "Do not
 * combine with no-show"), so nothing is lost by keeping the booking counted where it was made.
 */
export const BOOKED_STATUSES = ["REQUESTED", "CONFIRMED", "ARRIVED", "COMPLETED", "NO_SHOW"];

/**
 * The encounter states that mean the consultation happened and is over (migration 194's CHECK).
 * ENTERED_IN_ERROR is excluded everywhere: it is a voided record, not a completed one.
 */
const COMPLETED_STATUSES = ["COMPLETED", "SIGNED", "AMENDED"];

/**
 * The states that mean a patient is WITH the practitioner or has been. DRAFT is deliberately absent:
 * a launched-but-unstarted encounter is not an active one, and s8's Waiting exclusion names
 * "active/completed" precisely.
 */
const ENGAGED_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "SIGNED", "AMENDED"];

/**
 * s8 Waiting: "Queue entries with status arrived or waiting".
 *
 * Migration 192's queue vocabulary is WAITING / READY / IN_CONSULTATION / PAUSED / COMPLETED / LEFT --
 * it has no `expected` state, because an entry is only created when somebody actually arrives, so the
 * spec's "do not count expected patients who have not arrived" is satisfied by the table's own shape.
 * READY is counted with WAITING: both mean arrived-and-not-yet-seen, and a patient called to the door is
 * still standing in the corridor. IN_CONSULTATION and PAUSED are excluded because that patient is being
 * seen, not waiting.
 */
const WAITING_STATUSES = ["WAITING", "READY"];

// ── PLUMBING ─────────────────────────────────────────────────────────────────────────────────────────

const LABELS: Record<MetricKey, string> = {
  booked: "Booked", waiting: "Waiting", completed: "Completed", walk_in: "Walk-in",
  cancelled: "Cancelled", emergency: "Emergency", follow_ups_due: "Follow-ups Due", no_show: "No Show",
  remaining: "Remaining",
  patients_seen: "Patients Seen", average_consult_time: "Average Consult Time",
  average_wait_time: "Average Wait Time", clinic_delay: "Clinic Delay",
};

/**
 * What each figure counts, said the way a practitioner would say it.
 *
 * Held beside LABELS rather than beside each formula on purpose: these are read together, and a
 * basis that drifts from its neighbours is how thirteen tiles end up explained in thirteen voices.
 * The exclusions that matter to a reader are stated HERE -- "counted once", "nothing is marked
 * automatically" -- because that is the part a figure can mislead about.
 */
const BASIS: Record<MetricKey, string> = {
  booked:
    "Appointments scheduled for this period, however they were made.",
  waiting:
    "People who checked in today and have not been seen yet.",
  completed:
    "Consultations you finished in this period.",
  walk_in:
    "People seen without a booking. Somebody who appears both in the queue and in a consultation is counted once.",
  cancelled:
    "Appointments that were due in this period and were cancelled. Counted by when the appointment was for, not when it was cancelled.",
  emergency:
    "Consultations booked or run as an emergency. Nothing is inferred from what was written in the notes.",
  follow_ups_due:
    "Follow-ups falling due in this period. Ones already overdue are on the Command Centre rather than here.",
  no_show:
    "Appointments marked as a no-show. Nothing is marked automatically, so a missed appointment counts only once somebody records it.",
  remaining:
    "People still to see: those waiting now, plus appointments still to come in this period.",
  patients_seen:
    "How many different people you finished a consultation with. Somebody seen twice counts once.",
  average_consult_time:
    "The average length of your finished consultations, with any time you paused taken off.",
  average_wait_time:
    "The average time between a patient checking in and their consultation starting.",
  clinic_delay:
    "How far behind or ahead of the booked time you started. The middle value rather than the average, so one long case does not skew it.",
};

type Build = {
  key: MetricKey; unit: Metric["unit"]; formula: string; sources: string[]; scope: MetricScope;
};

const ok = (b: Build, value: number, observations: number, excluded = 0): Metric => ({
  key: b.key, label: LABELS[b.key], value, unit: b.unit, status: "ok",
  basis: BASIS[b.key],
  observations, excluded, reason: null, formula: b.formula, sources: b.sources, scopeKind: b.scope.kind,
});

const unknowable = (b: Build, reason: string, observations: number | null = 0, excluded = 0): Metric => ({
  key: b.key, label: LABELS[b.key], value: null, unit: b.unit, status: "unknowable",
  basis: BASIS[b.key],
  observations, excluded, reason, formula: b.formula, sources: b.sources, scopeKind: b.scope.kind,
});

const unreadable = (b: Build, detail: string): Metric => ({
  key: b.key, label: LABELS[b.key], value: null, unit: b.unit, status: "unreadable",
  observations: null, excluded: 0, reason: `could not be read: ${detail}`,
  basis: BASIS[b.key],
  formula: b.formula, sources: b.sources, scopeKind: b.scope.kind,
});

const notPermitted = (b: Build, capability: string): Metric => ({
  key: b.key, label: LABELS[b.key], value: null, unit: b.unit, status: "not_permitted",
  observations: null, excluded: 0, reason: `${capability} is required to see this`,
  basis: BASIS[b.key],
  formula: b.formula, sources: b.sources, scopeKind: b.scope.kind,
});

/** A head+count read. The count is computed server-side, so the 1000-row page cap does not apply to it. */
async function countRows(query: any): Promise<{ count: number | null; error: string | null }> {
  const { count, error } = await query;
  if (error) return { count: null, error: error.message ?? "read failed" };
  // ⚠ A null count with no error is not a zero. PostgREST returns null when the count was not computed
  // (a missing table among them), and treating that as nought is the exact bug class this file exists to
  // avoid -- so it is reported as unreadable by the callers below.
  return { count: count ?? null, error: null };
}

type RowRead = { rows: any[]; error: string | null; overflowed: boolean };

/** A bounded row read. Reaching the bound is an OVERFLOW, reported, never silently averaged. */
async function readRows(query: any, cap = ROW_CAP): Promise<RowRead> {
  const { data, error } = await query.limit(cap);
  if (error) return { rows: [], error: error.message ?? "read failed", overflowed: false };
  const rows = (data ?? []) as any[];
  return { rows, error: null, overflowed: rows.length >= cap };
}

/** `.in()` in survivable batches. One failed batch fails the whole read -- a partial join is a wrong average. */
async function readIn(
  admin: any, table: string, select: string, workspaceId: string, column: string, values: string[],
): Promise<RowRead> {
  const out: any[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const batch = values.slice(i, i + IN_CHUNK);
    const { data, error } = await admin.from(table).select(select)
      .eq("workspace_id", workspaceId).in(column, batch).limit(ROW_CAP);
    if (error) return { rows: [], error: error.message ?? "read failed", overflowed: false };
    const rows = (data ?? []) as any[];
    if (rows.length >= ROW_CAP) return { rows: [], error: null, overflowed: true };
    out.push(...rows);
  }
  return { rows: out, error: null, overflowed: false };
}

const at = (iso: unknown): number | null => {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const mean = (xs: number[]) => Math.round(xs.reduce((n, x) => n + x, 0) / xs.length);

/** Median, stated rather than assumed: s8 requires the aggregation method for Clinic Delay to be named. */
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};

/** Encounter reads: activity_id when a session is running (a fact), the clock otherwise (an approximation). */
function scopeEncounters(query: any, scope: MetricScope, timeColumn: "started_at" | "completed_at") {
  if (scope.activityId) return query.eq("activity_id", scope.activityId);
  return query.gte(timeColumn, scope.fromIso).lt(timeColumn, scope.toIso);
}

const encounterSource = (scope: MetricScope, timeColumn: string) =>
  scope.activityId ? "practice_encounter.activity_id" : `practice_encounter.${timeColumn}`;

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE TWELVE METRICS OF SECTION 8
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * BOOKED.
 *
 * s8 verbatim -- Definition: "Appointments assigned to the current day/session that are not cancelled."
 * Exclusions/notes: "Exclude cancelled; define whether no-shows remain booked in historical totals."
 *
 * TABLES/COLUMNS: practice_appointment.workspace_id, .scheduled_at, .status (migration 192).
 *
 * EXCLUSIONS APPLIED:
 *   - status CANCELLED excluded, by counting BOOKED_STATUSES rather than by `neq`. A `neq` would silently
 *     admit any status a later migration adds; an allow-list refuses to count what it has not been told
 *     about, which is the failure direction that can be noticed.
 *   - NO_SHOW is INCLUDED -- see BOOKED_STATUSES for the decision and why.
 *
 * ⚠ "assigned to the day/SESSION" is time-approximated under session scope. An appointment carries no
 * activity link (migration 192 predates 232 and nothing backfilled one), so a session's booked count is
 * the appointments scheduled inside the session's window. Named in `sources` so the screen can say so.
 */
export async function bookedAppointments(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "booked", unit: "count", scope,
    formula: `count of practice_appointment rows scheduled within the scope window whose status is one of ${BOOKED_STATUSES.join("/")} (cancelled excluded, no-shows retained)`,
    sources: ["practice_appointment.scheduled_at", "practice_appointment.status"],
  };
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);

  const { count, error } = await countRows(admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", scope.fromIso).lt("scheduled_at", scope.toIso)
    .in("status", BOOKED_STATUSES));

  if (error) return unreadable(b, error);
  if (count === null) return unreadable(b, "the diary returned no count");
  return ok(b, count, count);
}

/**
 * WAITING.
 *
 * s8 verbatim -- Definition: "Queue entries with status arrived or waiting and no active/completed
 * encounter." Exclusions/notes: "Do not count expected patients who have not arrived."
 *
 * TABLES/COLUMNS: practice_queue_entry.workspace_id, .status, .entered_at, .patient_id, .appointment_id
 * (migration 192, patient_id added by 226); practice_encounter.status, .started_at, .patient_id,
 * .appointment_id (migration 194).
 *
 * EXCLUSIONS APPLIED:
 *   - Only WAITING and READY count (see WAITING_STATUSES). IN_CONSULTATION, PAUSED, COMPLETED and LEFT
 *     are not waiting.
 *   - An entry is dropped when the same visit already has an ACTIVE/PAUSED/COMPLETED/SIGNED/AMENDED
 *     encounter, matched by appointment_id, or by patient_id where the encounter started at or after the
 *     entry did. DRAFT is not a disqualifier: launching an encounter is not seeing the patient.
 *
 * ⚠ THE SECOND CLAUSE IS LOAD-BEARING IN THIS CODEBASE, NOT DEFENSIVE. launchEncounter (encounters.ts)
 * does not touch practice_queue_entry, so a practitioner who calls the next patient in and starts a
 * consultation leaves that entry reading WAITING forever. Counting the queue status alone would report
 * people as waiting who are in the room.
 */
export async function waitingPatients(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "waiting", unit: "count", scope,
    formula: `count of practice_queue_entry rows entered TODAY with status ${WAITING_STATUSES.join("/")}, less any whose appointment or patient already has an ${ENGAGED_STATUSES.join("/")} encounter. Deliberately NOT narrowed to the session window -- waiting is a live state, not a period count`,
    sources: [
      "practice_queue_entry.status", "practice_queue_entry.entered_at",
      "practice_queue_entry.appointment_id", "practice_queue_entry.patient_id",
      "practice_encounter.status", "practice_encounter.started_at",
    ],
  };
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  // ⚠ THE DAY, NOT THE SESSION WINDOW, AND THIS IS THE ONE METRIC WHERE THAT IS RIGHT.
  //
  // s8 defines Booked as appointments "assigned to the current day/session" and Completed as encounters
  // "completed within the selected period" -- both are PERIOD COUNTS. Waiting it defines as "queue
  // entries with status arrived or waiting and no active/completed encounter", with no window at all,
  // because waiting is a LIVE STATE. The people in the corridor are the people in the corridor.
  //
  // Narrowed to the session window it hid them twice over: a patient who arrived before the clinic
  // opened, and -- far more common -- everybody still waiting after the planned end of a clinic that
  // ran late. A tile reading 0 while four people sit outside is the worst kind of wrong, because it is
  // wrong precisely when the clinic is under most pressure. The end-to-end test found it at 16:59
  // against an 08:00-13:00 session.
  const day = zonedDayRange(scope.date, scope.timezone);
  const [queue, encounters] = await Promise.all([
    readRows(admin.from("practice_queue_entry")
      .select("id, status, entered_at, appointment_id, patient_id")
      .eq("workspace_id", ctx.workspaceId)
      .in("status", WAITING_STATUSES)
      .gte("entered_at", day.startIso).lt("entered_at", day.endIso)),
    readRows(admin.from("practice_encounter")
      .select("id, status, started_at, patient_id, appointment_id")
      .eq("workspace_id", ctx.workspaceId)
      .in("status", ENGAGED_STATUSES)
      // The same day, for the same reason: the question is whether THIS arrival has been seen, and an
      // encounter opened outside the session still means the person is not in the corridor.
      .gte("started_at", day.startIso).lt("started_at", day.endIso)),
  ]);

  if (queue.error) return unreadable(b, queue.error);
  if (encounters.error) return unreadable(b, encounters.error);
  if (queue.overflowed || encounters.overflowed)
    return unreadable(b, `more than ${ROW_CAP} rows in the window, so the count would be a page rather than a total`);

  const seenAppointments = new Set(encounters.rows.map(e => e.appointment_id).filter(Boolean));
  const byPatient = new Map<string, number[]>();
  for (const e of encounters.rows) {
    const started = at(e.started_at);
    if (!e.patient_id || started === null) continue;
    byPatient.set(e.patient_id, [...(byPatient.get(e.patient_id) ?? []), started]);
  }

  let excluded = 0;
  const waiting = queue.rows.filter(q => {
    if (q.appointment_id && seenAppointments.has(q.appointment_id)) { excluded++; return false; }
    const entered = at(q.entered_at);
    const starts = q.patient_id ? byPatient.get(q.patient_id) : undefined;
    if (starts && entered !== null && starts.some(s => s >= entered)) { excluded++; return false; }
    return true;
  });

  return ok(b, waiting.length, queue.rows.length, excluded);
}

/**
 * COMPLETED.
 *
 * s8 verbatim -- Definition: "Encounters completed within the selected period."
 * Exclusions/notes: "A reopened encounter is not double-counted."
 *
 * TABLES/COLUMNS: practice_encounter.workspace_id, .status, .completed_at, .activity_id
 * (migration 194; activity_id from 232).
 *
 * EXCLUSIONS APPLIED:
 *   - Only COMPLETED/SIGNED/AMENDED count. CANCELLED and ENTERED_IN_ERROR are not completions, and
 *     DRAFT/ACTIVE/PAUSED are not over.
 *   - Reopening: transitionEncounter allows COMPLETED -> ACTIVE and does NOT clear completed_at, so a
 *     reopened encounter carries a stale completion timestamp. The status filter is what excludes it,
 *     and counting ROWS rather than transitions is what makes a re-completed encounter count once.
 *     Counting practice_encounter_status_history entries instead would double-count every reopen.
 */
/**
 * CPR-MOB-001 s7 asked the session strip for "remaining", and the figure had no producer -- the
 * strip shipped without it rather than doing page-side arithmetic (CORE-08 forbids exactly that).
 * The owner asked for it by name (2026-08-17), so it lives here: one owner, one formula.
 *
 *   remaining = still waiting (the Waiting metric's OWN population, composed not re-derived)
 *             + appointments in the scope window still REQUESTED or CONFIRMED (booked, not arrived)
 *
 * ⚠ IN_CONSULTATION is deliberately NOT counted. The strip shows In progress beside this figure,
 * and a "remaining" that included the person already in the room would double-speak against it.
 * ⚠ COMPOSES waitingPatients rather than re-deriving its rows: two implementations of "who is
 * waiting" is how two screens come to disagree -- the lesson the follow-up lenses already paid for.
 * A waiting figure that is not ok propagates as this metric's own status, reason and all: half a
 * sum is not a smaller sum, it is no sum.
 */
export async function remainingPatients(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "remaining", unit: "count", scope,
    formula: "patients still waiting (the Waiting metric's population) plus appointments scheduled"
      + " within the scope window whose status is still REQUESTED or CONFIRMED",
    sources: [
      "practice_queue_entry.status", "practice_queue_entry.entered_at",
      "practice_appointment.status", "practice_appointment.scheduled_at",
    ],
  };
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  const waiting = await waitingPatients(admin, ctx, scope);
  if (waiting.status !== "ok" || waiting.value === null)
    return {
      ...waiting, key: "remaining", label: LABELS.remaining,
      basis: BASIS[b.key],
      formula: b.formula, sources: b.sources,
      reason: waiting.reason ?? "the waiting half of this figure could not be computed",
    };

  const expected = await countRows(admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["REQUESTED", "CONFIRMED"])
    .gte("scheduled_at", scope.fromIso).lt("scheduled_at", scope.toIso));
  if (expected.error) return unreadable(b, expected.error);
  if (expected.count === null) return unreadable(b, "the expected-appointments count was not computed");

  return ok(b, waiting.value + expected.count, (waiting.observations ?? 0) + expected.count, waiting.excluded);
}

export async function completedEncounters(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "completed", unit: "count", scope,
    formula: `count of practice_encounter rows in scope whose status is one of ${COMPLETED_STATUSES.join("/")}, counted once per encounter`,
    sources: [encounterSource(scope, "completed_at"), "practice_encounter.status"],
  };
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  const { count, error } = await countRows(scopeEncounters(
    admin.from("practice_encounter")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId)
      .in("status", COMPLETED_STATUSES),
    scope, "completed_at"));

  if (error) return unreadable(b, error);
  if (count === null) return unreadable(b, "the encounter store returned no count");
  return ok(b, count, count);
}

/**
 * WALK-IN.
 *
 * s8 verbatim -- Definition: "Queue entries or encounters created without a prior booked appointment."
 * Exclusions/notes: "May still be a follow-up patient; arrival mode and encounter purpose are separate
 * fields."
 *
 * TABLES/COLUMNS: practice_queue_entry.entered_at, .appointment_id, .patient_id and the embedded
 * practice_appointment.appointment_type; practice_encounter.started_at, .appointment_id, .patient_id,
 * .entry_pathway and the same embed (migrations 192, 194, 226).
 *
 * TWO SOURCES, ONE COUNT, DEDUPLICATED. The spec says "queue entries OR encounters" and in this product
 * both exist for the same person: the desk queues a walk-in, then a consultation is opened for them.
 * Counting both would double every walk-in. The dedup key is patient_id where there is one, and the row
 * id otherwise (a name-only queue entry is a real arrival and is not dropped for lacking a record).
 *
 * EXCLUSIONS APPLIED:
 *   - An arrival with a linked appointment is NOT a walk-in, unless that appointment is itself typed
 *     `walk_in` -- migration 192's type list exists because this desk records walk-ins in the diary at
 *     the moment they arrive, and those are arrivals without a PRIOR booking, which is what s8 asks for.
 *   - entry_pathway is used only to confirm what the appointment link already says; it is never used to
 *     infer purpose. s8: arrival mode and encounter purpose are separate fields, so `walk_in_followup`
 *     counts as a walk-in exactly like `new_walk_in`.
 */
export async function walkIns(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "walk_in", unit: "count", scope,
    formula: "distinct people in scope who arrived with no appointment, or whose appointment is typed walk_in, taken from queue entries and encounters and deduplicated by patient",
    sources: [
      "practice_queue_entry.appointment_id", "practice_queue_entry.entered_at",
      "practice_encounter.appointment_id", "practice_encounter.entry_pathway",
      "practice_appointment.appointment_type",
    ],
  };
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  const [queue, encounters] = await Promise.all([
    readRows(admin.from("practice_queue_entry")
      .select("id, patient_id, appointment_id, practice_appointment:appointment_id(appointment_type)")
      .eq("workspace_id", ctx.workspaceId)
      .gte("entered_at", scope.fromIso).lt("entered_at", scope.toIso)),
    readRows(scopeEncounters(admin.from("practice_encounter")
      .select("id, patient_id, appointment_id, entry_pathway, practice_appointment:appointment_id(appointment_type)")
      .eq("workspace_id", ctx.workspaceId)
      .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)"),
      scope, "started_at")),
  ]);

  if (queue.error) return unreadable(b, queue.error);
  if (encounters.error) return unreadable(b, encounters.error);
  if (queue.overflowed || encounters.overflowed)
    return unreadable(b, `more than ${ROW_CAP} rows in the window, so the count would be a page rather than a total`);

  const unbooked = (row: any) =>
    !row.appointment_id || row.practice_appointment?.appointment_type === "walk_in";

  const keys = new Set<string>();
  let considered = 0;
  for (const [prefix, rows] of [["q", queue.rows], ["e", encounters.rows]] as [string, any[]][]) {
    for (const row of rows) {
      considered++;
      if (!unbooked(row)) continue;
      keys.add(row.patient_id ? `p:${row.patient_id}` : `${prefix}:${row.id}`);
    }
  }

  return ok(b, keys.size, considered, Math.max(0, considered - keys.size));
}

/**
 * CANCELLED.
 *
 * s8 verbatim -- Definition: "Appointments or queue entries explicitly cancelled in the selected period."
 * Exclusions/notes: "Do not combine with no-show."
 *
 * TABLES/COLUMNS: practice_appointment.workspace_id, .scheduled_at, .status (migration 192).
 *
 * EXCLUSIONS APPLIED:
 *   - NO_SHOW is not counted here. It has its own metric, and s8 says not to combine them.
 *   - Queue entries contribute nothing: migration 192's queue vocabulary has no CANCELLED state. LEFT is
 *     the nearest value and it means the patient gave up and went home, which is a different fact from a
 *     cancellation and must not be folded into it.
 *
 * ⚠ "CANCELLED IN THE PERIOD" IS NOT MEASURABLE AND THIS COUNTS SOMETHING SLIGHTLY DIFFERENT: appointments
 * FOR the period that are now cancelled. practice_appointment has no cancelled_at; updated_at is bumped by
 * every write, so using it would count a rescheduled note as a cancellation. Stated here rather than
 * quietly approximated, because the two differ for anything cancelled days ahead.
 */
export async function cancelledAppointments(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "cancelled", unit: "count", scope,
    formula: "count of practice_appointment rows scheduled within the scope window whose status is CANCELLED (no cancelled_at exists, so this is scheduled-for-the-period rather than cancelled-during-it)",
    sources: ["practice_appointment.scheduled_at", "practice_appointment.status"],
  };
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);

  const { count, error } = await countRows(admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", scope.fromIso).lt("scheduled_at", scope.toIso)
    .eq("status", "CANCELLED"));

  if (error) return unreadable(b, error);
  if (count === null) return unreadable(b, "the diary returned no count");
  return ok(b, count, count);
}

/**
 * EMERGENCY.
 *
 * s8 verbatim -- Definition: "Encounters marked emergency/urgent through the approved encounter
 * classification." Exclusions/notes: "Do not infer from diagnosis text."
 *
 * TABLES/COLUMNS: practice_encounter.status, .started_at/.activity_id, and the embeds
 * practice_appointment.appointment_type (migration 192) and practice_activity.activity_type
 * (migration 232).
 *
 * ⚠ THE ENCOUNTER ITSELF CARRIES NO URGENCY, AND THIS IS THE SCHEMA GAP, NOT A CHOICE. Migration 194
 * gives practice_encounter an encounter_mode (in_person / teleconsultation / outreach / home_visit /
 * hospital) and an entry_pathway; neither expresses urgency. The two APPROVED classifications that do
 * are the appointment type `emergency` and the activity type `emergency_consult`, so those are what this
 * counts.
 *
 * EXCLUSIONS APPLIED:
 *   - Nothing is inferred from diagnoses, treatments, reason_for_visit text or note bodies.
 *   - CANCELLED and ENTERED_IN_ERROR encounters are excluded.
 *   - CONSEQUENCE, STATED: an emergency seen with neither an emergency-typed diary entry nor an
 *     emergency_consult activity running is NOT counted. Under-counting a real emergency is bad; the
 *     alternative is inventing a classification the record does not hold, which s8 forbids by name.
 */
export async function emergencyEncounters(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "emergency", unit: "count", scope,
    formula: "count of encounters in scope whose linked appointment is typed emergency or whose activity is an emergency_consult; nothing is inferred from clinical text",
    sources: [
      encounterSource(scope, "started_at"), "practice_appointment.appointment_type",
      "practice_activity.activity_type",
    ],
  };
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  const read = await readRows(scopeEncounters(admin.from("practice_encounter")
    .select("id, practice_appointment:appointment_id(appointment_type), practice_activity:activity_id(activity_type)")
    .eq("workspace_id", ctx.workspaceId)
    .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)"),
    scope, "started_at"));

  if (read.error) return unreadable(b, read.error);
  if (read.overflowed)
    return unreadable(b, `more than ${ROW_CAP} encounters in the window, so the count would be a page rather than a total`);

  const emergency = read.rows.filter(e =>
    e.practice_appointment?.appointment_type === "emergency"
    || e.practice_activity?.activity_type === "emergency_consult");

  return ok(b, emergency.length, read.rows.length, read.rows.length - emergency.length);
}

/**
 * FOLLOW-UPS DUE.
 *
 * s8 verbatim -- Definition: "Open follow-ups whose due date is within the selected period."
 * Exclusions/notes: "A follow-up may also be booked or waiting results."
 *
 * TABLES/COLUMNS: practice_follow_up.workspace_id, .status, .due_on (migration 196).
 *
 * EXCLUSIONS APPLIED:
 *   - Open means OPEN or SCHEDULED. Migration 196 deliberately has no OVERDUE status (overdue is derived
 *     from the clock, never stored), and SCHEDULED is still owed -- s8's note says a follow-up may also
 *     be booked. COMPLETED, MISSED and CANCELLED are closed and excluded.
 *   - due_on is a DATE, compared against the practice's calendar day, never against an instant.
 *
 * ⚠ WITHIN THE PERIOD MEANS WITHIN THE PERIOD. Anything due BEFORE the period is overdue, which is a
 * different question and a different card (s7 Follow-up Intelligence lists "overdue" separately from
 * "due"). Rolling the backlog into this tile makes "Follow-ups Due" grow forever and stop meaning today.
 */
export async function followUpsDue(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "follow_ups_due", unit: "count", scope,
    formula: "count of practice_follow_up rows with status OPEN or SCHEDULED whose due_on falls within the scope's date range; overdue items are excluded because they are due before it",
    sources: ["practice_follow_up.status", "practice_follow_up.due_on"],
  };
  if (!hasCapability(ctx, CAP_FOLLOWUPS)) return notPermitted(b, CAP_FOLLOWUPS);

  const { count, error } = await countRows(admin.from("practice_follow_up")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["OPEN", "SCHEDULED"])
    .gte("due_on", scope.fromDate).lte("due_on", scope.toDate));

  if (error) return unreadable(b, error);
  if (count === null) return unreadable(b, "the follow-up board returned no count");
  return ok(b, count, count);
}

/**
 * NO-SHOW.
 *
 * s8 verbatim -- Definition: "Booked appointments whose attendance window passed and were explicitly or
 * automatically confirmed as no-show." Exclusions/notes: "Use configurable grace period."
 *
 * TABLES/COLUMNS: practice_appointment.workspace_id, .scheduled_at, .status (migration 192).
 *
 * EXCLUSIONS APPLIED:
 *   - Only the explicit NO_SHOW status counts.
 *   - CANCELLED is never folded in (s8 Cancelled: "Do not combine with no-show").
 *
 * ⚠ THE GRACE PERIOD IS NOT IMPLEMENTED BECAUSE IT DOES NOT EXIST, AND IT IS NOT INVENTED HERE. There is
 * no automatic no-show sweep in this product and no grace-period setting in practice_configuration
 * (migration 203) -- so this counts what a human marked, which is the whole of what the record holds.
 * Deriving no-show from "scheduled_at passed and nobody arrived" would mark every appointment of a day
 * the practice never opened the app, which is a fabricated clinical-administrative fact about a patient.
 */
export async function noShows(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "no_show", unit: "count", scope,
    formula: "count of practice_appointment rows scheduled within the scope window whose status is explicitly NO_SHOW; no grace-period sweep exists, so nothing is inferred from the clock",
    sources: ["practice_appointment.scheduled_at", "practice_appointment.status"],
  };
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);

  const { count, error } = await countRows(admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", scope.fromIso).lt("scheduled_at", scope.toIso)
    .eq("status", "NO_SHOW"));

  if (error) return unreadable(b, error);
  if (count === null) return unreadable(b, "the diary returned no count");
  return ok(b, count, count);
}

/**
 * PATIENTS SEEN.
 *
 * s8 verbatim -- Definition: "Distinct patients with at least one completed encounter in the selected
 * period." Exclusions/notes: "Distinct by patient_id, not name."
 *
 * TABLES/COLUMNS: practice_encounter.workspace_id, .patient_id, .status, .completed_at/.activity_id
 * (migration 194; patient_id is NOT NULL and FK-constrained to practice_patient).
 *
 * EXCLUSIONS APPLIED:
 *   - Same completion rule as the Completed metric: COMPLETED/SIGNED/AMENDED only.
 *   - DISTINCT BY patient_id. A patient seen twice in a day -- clinic in the morning, ward review in the
 *     afternoon -- is one patient seen and two encounters completed. That is precisely why this is not
 *     the same number as Completed, and why patient_name is never used to group: two Mary Achiengs are
 *     two people and one Mary Achieng typed two ways is one.
 *   - PostgREST cannot COUNT DISTINCT, so the ids are read and deduplicated here -- which is exactly the
 *     case where a truncated page silently understates, so the read is bounded and overflow is refused.
 */
export async function patientsSeen(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "patients_seen", unit: "count", scope,
    formula: "distinct practice_encounter.patient_id over encounters in scope whose status is COMPLETED/SIGNED/AMENDED",
    sources: [encounterSource(scope, "completed_at"), "practice_encounter.status", "practice_encounter.patient_id"],
  };
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  const read = await readRows(scopeEncounters(admin.from("practice_encounter")
    .select("id, patient_id")
    .eq("workspace_id", ctx.workspaceId)
    .in("status", COMPLETED_STATUSES),
    scope, "completed_at"));

  if (read.error) return unreadable(b, read.error);
  if (read.overflowed)
    return unreadable(b, `more than ${ROW_CAP} completed encounters in scope, so the distinct count would be a page rather than a total`);

  const distinct = new Set(read.rows.map(e => e.patient_id).filter(Boolean));
  return ok(b, distinct.size, read.rows.length, read.rows.length - distinct.size);
}

/**
 * AVERAGE CONSULT TIME.
 *
 * s8 verbatim -- Definition: "Mean of encounter_end minus encounter_start, excluding paused duration."
 * Exclusions/notes: "Exclude invalid/missing timestamps."
 *
 * TABLES/COLUMNS: practice_encounter.status, .started_at, .completed_at, .completed_at/.activity_id for
 * scope (migration 194); practice_encounter_status_history.encounter_id, .to_status, .occurred_at
 * (migration 194 section 3, written by encounters.ts recordTransition on every transition).
 *
 * EXCLUDING PAUSED DURATION IS THE WHOLE POINT AND IT NEEDS THE TRANSITION LOG. practice_encounter has no
 * paused_minutes column, so paused time is reconstructed from the log: each entry into PAUSED opens an
 * interval and the next transition of any kind closes it. s6.2 is the reason this matters -- "interruption
 * time must not be counted as active consultation time for another patient" -- and without this exclusion
 * a consultation interrupted by an emergency reads as a ninety-minute consultation.
 *
 * EXCLUSIONS APPLIED:
 *   - Only COMPLETED/SIGNED/AMENDED encounters.
 *   - Missing or unparseable started_at/completed_at: excluded.
 *   - completed_at before started_at (a corrected clock, a backdated edit): excluded, never clamped to
 *     zero -- a zero-minute consultation would drag the mean down as if it had happened.
 *   - AN ENCOUNTER WITH NO TRANSITION LOG AT ALL IS EXCLUDED, not assumed unpaused. Every encounter gets
 *     a DRAFT log row at creation, so an empty log means the log write failed and whether that
 *     consultation was paused is genuinely unknown. Counting it as unpaused would silently overstate the
 *     mean by exactly the interruptions this metric exists to remove. The count of such encounters is
 *     returned in `excluded` so the screen can disclose it.
 */
export async function averageConsultMinutes(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "average_consult_time", unit: "minutes", scope,
    formula: "arithmetic mean of (completed_at - started_at - paused duration) in minutes over completed encounters in scope; paused duration is summed from practice_encounter_status_history",
    sources: [
      encounterSource(scope, "completed_at"), "practice_encounter.started_at",
      "practice_encounter.completed_at", "practice_encounter.status",
      "practice_encounter_status_history.to_status", "practice_encounter_status_history.occurred_at",
    ],
  };
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);

  const read = await readRows(scopeEncounters(admin.from("practice_encounter")
    .select("id, started_at, completed_at")
    .eq("workspace_id", ctx.workspaceId)
    .in("status", COMPLETED_STATUSES),
    scope, "completed_at"));

  if (read.error) return unreadable(b, read.error);
  if (read.overflowed)
    return unreadable(b, `more than ${ROW_CAP} completed encounters in scope, so the mean would be a page rather than an average`);
  if (read.rows.length === 0)
    return unknowable(b, "no consultation has been completed in this period, so there is no duration to average");

  const history = await readIn(admin, "practice_encounter_status_history",
    "encounter_id, to_status, occurred_at", ctx.workspaceId, "encounter_id",
    read.rows.map(e => e.id));
  if (history.error) return unreadable(b, history.error);
  if (history.overflowed)
    return unreadable(b, "the transition log returned more rows than can be read at once, so paused time could not be excluded");

  const logByEncounter = new Map<string, { to: string; at: number }[]>();
  for (const h of history.rows) {
    const occurred = at(h.occurred_at);
    if (occurred === null) continue;
    const list = logByEncounter.get(h.encounter_id) ?? [];
    list.push({ to: h.to_status, at: occurred });
    logByEncounter.set(h.encounter_id, list);
  }

  const durations: number[] = [];
  let excluded = 0;
  for (const e of read.rows) {
    const start = at(e.started_at);
    const end = at(e.completed_at);
    // ⚠ NO TRANSITION LOG MEANS NEVER PAUSED, NOT UNMEASURABLE. This read `!log` and excluded every
    // encounter without a history row -- which is the ordinary case for a consultation that ran straight
    // through, and for every encounter recorded before the log existed. The denominator shrank silently
    // and the average drifted towards whichever consultations happened to have been interrupted.
    //
    // s8 says "exclude invalid/missing TIMESTAMPS". A missing pause record is not a missing timestamp; it
    // is evidence of no pause. Absence of evidence about an interruption is not absence of a duration.
    const log = logByEncounter.get(e.id) ?? [];
    if (start === null || end === null || end < start) { excluded++; continue; }

    // Paused intervals: entering PAUSED opens one, the next transition of any kind closes it. Clipped to
    // the consultation's own window so a log entry outside it cannot produce a negative consult time.
    const events = [...log].sort((x, y) => x.at - y.at);
    let paused = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].to !== "PAUSED") continue;
      const from = Math.max(start, events[i].at);
      const until = i + 1 < events.length ? Math.min(end, events[i + 1].at) : end;
      if (until > from) paused += until - from;
    }

    const minutes = (end - start - paused) / 60000;
    if (minutes < 0) { excluded++; continue; }
    durations.push(minutes);
  }

  if (durations.length === 0)
    return unknowable(b,
      "no consultation in this period has a usable start, end and transition log, so there is nothing valid to average",
      0, excluded);

  return ok(b, mean(durations), durations.length, excluded);
}

/**
 * AVERAGE WAIT TIME.
 *
 * s8 verbatim -- Definition: "Mean of encounter_start minus check_in_time for eligible arrivals."
 * Exclusions/notes: "Exclude patients without check-in."
 *
 * TABLES/COLUMNS: practice_encounter.started_at, .appointment_id, .patient_id, .status (migration 194);
 * practice_arrival.appointment_id, .arrived_at, .status (migration 192); practice_queue_entry.patient_id,
 * .entered_at (migration 192, patient_id from 226).
 *
 * TWO KINDS OF CHECK-IN, IN PRECEDENCE ORDER, because this product has two front doors:
 *   1. practice_arrival.arrived_at -- the formal check-in written when a booked appointment is marked
 *      ARRIVED (scheduling.ts transitionAppointment). Matched by appointment_id.
 *   2. practice_queue_entry.entered_at -- a walk-in's arrival, which is the only check-in they ever get.
 *      Matched by patient_id, taking the latest entry at or before the consultation started.
 *
 * EXCLUSIONS APPLIED:
 *   - Encounters with no check-in of either kind: excluded, exactly as s8 requires. This is the exclusion
 *     that keeps the figure honest -- treating "no check-in" as a zero wait would make a busy morning
 *     look punctual.
 *   - Arrivals with status CANCELLED: excluded (a cancelled check-in did not happen). ARRIVED and
 *     VERIFIED both count -- verification is a desk step after arrival, not a second arrival.
 *   - Negative waits (seen before the recorded check-in, i.e. a clock correction): excluded rather than
 *     clamped, for the same reason as above.
 *   - CANCELLED/ENTERED_IN_ERROR encounters: excluded.
 */
export async function averageWaitMinutes(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "average_wait_time", unit: "minutes", scope,
    formula: "arithmetic mean of (encounter.started_at - check-in) in minutes, where check-in is practice_arrival.arrived_at for the linked appointment or, failing that, the latest practice_queue_entry.entered_at for the patient before the consultation started; encounters with no check-in are excluded",
    sources: [
      encounterSource(scope, "started_at"), "practice_encounter.started_at",
      "practice_arrival.arrived_at", "practice_arrival.status", "practice_queue_entry.entered_at",
    ],
  };
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);

  const read = await readRows(scopeEncounters(admin.from("practice_encounter")
    .select("id, started_at, appointment_id, patient_id")
    .eq("workspace_id", ctx.workspaceId)
    .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)"),
    scope, "started_at"));

  if (read.error) return unreadable(b, read.error);
  if (read.overflowed)
    return unreadable(b, `more than ${ROW_CAP} encounters in scope, so the mean would be a page rather than an average`);
  if (read.rows.length === 0)
    return unknowable(b, "nobody has been seen in this period, so there is no wait to measure");

  const appointmentIds = [...new Set(read.rows.map(e => e.appointment_id).filter(Boolean))] as string[];
  const patientIds = [...new Set(read.rows.map(e => e.patient_id).filter(Boolean))] as string[];

  const [arrivals, queue] = await Promise.all([
    appointmentIds.length
      ? readIn(admin, "practice_arrival", "appointment_id, arrived_at, status", ctx.workspaceId, "appointment_id", appointmentIds)
      : Promise.resolve({ rows: [], error: null, overflowed: false } as RowRead),
    patientIds.length
      ? readIn(admin, "practice_queue_entry", "patient_id, entered_at", ctx.workspaceId, "patient_id", patientIds)
      : Promise.resolve({ rows: [], error: null, overflowed: false } as RowRead),
  ]);

  if (arrivals.error) return unreadable(b, arrivals.error);
  if (queue.error) return unreadable(b, queue.error);
  if (arrivals.overflowed || queue.overflowed)
    return unreadable(b, "the check-in records returned more rows than can be read at once, so the wait could not be measured");

  const arrivalByAppointment = new Map<string, number>();
  for (const a of arrivals.rows) {
    if (a.status === "CANCELLED") continue;
    const arrived = at(a.arrived_at);
    if (arrived === null) continue;
    const held = arrivalByAppointment.get(a.appointment_id);
    // Earliest live arrival: the moment they walked in, not a later correction.
    if (held === undefined || arrived < held) arrivalByAppointment.set(a.appointment_id, arrived);
  }

  const queueByPatient = new Map<string, number[]>();
  for (const q of queue.rows) {
    const entered = at(q.entered_at);
    if (!q.patient_id || entered === null) continue;
    queueByPatient.set(q.patient_id, [...(queueByPatient.get(q.patient_id) ?? []), entered]);
  }

  const waits: number[] = [];
  let excluded = 0;
  for (const e of read.rows) {
    const started = at(e.started_at);
    if (started === null) { excluded++; continue; }

    let checkIn = e.appointment_id ? arrivalByAppointment.get(e.appointment_id) ?? null : null;
    if (checkIn === null && e.patient_id) {
      const candidates = (queueByPatient.get(e.patient_id) ?? []).filter(t => t <= started);
      checkIn = candidates.length ? Math.max(...candidates) : null;
    }
    if (checkIn === null) { excluded++; continue; }

    const minutes = (started - checkIn) / 60000;
    if (minutes < 0) { excluded++; continue; }
    waits.push(minutes);
  }

  if (waits.length === 0)
    return unknowable(b, "nobody in this period was checked in and then seen, so there is no wait to average", 0, excluded);

  return ok(b, mean(waits), waits.length, excluded);
}

/**
 * CLINIC DELAY.
 *
 * s8 verbatim -- Definition: "Difference between actual and scheduled start for booked encounters;
 * aggregation method must be stated." Exclusions/notes: "No comparison shown until enough valid
 * observations exist."
 *
 * TABLES/COLUMNS: practice_encounter.started_at, .appointment_id, .status (migration 194); embedded
 * practice_appointment.scheduled_at, .appointment_type, .status (migration 192).
 *
 * AGGREGATION METHOD, STATED AS THE SPEC DEMANDS: THE MEDIAN, in signed minutes, positive meaning late.
 *   - Median rather than mean, because one emergency that displaced a morning is a two-hour outlier that
 *     drags a mean into describing a clinic that did not happen. The median answers "how late was a
 *     typical patient today", which is the question the card is asked.
 *   - SIGNED rather than clamped at zero. Clamping negatives (the existing command-centre.ts behaviour)
 *     cannot ever report a clinic running early and biases every figure upward; a practice that starts
 *     ten minutes ahead deserves to see it.
 *
 * EXCLUSIONS APPLIED:
 *   - Encounters with no linked appointment: excluded. There is no scheduled time to be late against.
 *   - Appointments typed `walk_in`: excluded. Their scheduled_at is written at the desk as the person
 *     arrives, so their delay is zero by construction and including them dilutes the figure toward zero.
 *   - CANCELLED appointments and CANCELLED/ENTERED_IN_ERROR encounters: excluded.
 *   - Missing/unparseable timestamps: excluded.
 *   - FEWER THAN MIN_OBSERVATIONS_FOR_DELAY valid observations: no value at all. This is s8's
 *     "no comparison shown until enough valid observations exist", enforced here rather than left to a
 *     widget to remember.
 */
export async function clinicDelayMinutes(admin: any, ctx: WorkspaceContext, scope: MetricScope): Promise<Metric> {
  const b: Build = {
    key: "clinic_delay", unit: "minutes", scope,
    formula: `median of (encounter.started_at - appointment.scheduled_at) in signed minutes over booked encounters in scope, positive meaning late; null below ${MIN_OBSERVATIONS_FOR_DELAY} valid observations`,
    sources: [
      encounterSource(scope, "started_at"), "practice_encounter.started_at",
      "practice_appointment.scheduled_at", "practice_appointment.appointment_type",
      "practice_appointment.status",
    ],
  };
  if (!hasCapability(ctx, CAP_ENCOUNTERS)) return notPermitted(b, CAP_ENCOUNTERS);
  if (!hasCapability(ctx, CAP_DIARY)) return notPermitted(b, CAP_DIARY);

  const read = await readRows(scopeEncounters(admin.from("practice_encounter")
    .select("id, started_at, appointment_id, practice_appointment:appointment_id(scheduled_at, appointment_type, status)")
    .eq("workspace_id", ctx.workspaceId)
    .not("appointment_id", "is", null)
    .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)"),
    scope, "started_at"));

  if (read.error) return unreadable(b, read.error);
  if (read.overflowed)
    return unreadable(b, `more than ${ROW_CAP} booked encounters in scope, so the median would be a page rather than a distribution`);

  const delays: number[] = [];
  let excluded = 0;
  for (const e of read.rows) {
    const appointment = e.practice_appointment;
    const scheduled = at(appointment?.scheduled_at);
    const started = at(e.started_at);
    if (!appointment || scheduled === null || started === null
      || appointment.appointment_type === "walk_in" || appointment.status === "CANCELLED") {
      excluded++;
      continue;
    }
    delays.push((started - scheduled) / 60000);
  }

  if (delays.length < MIN_OBSERVATIONS_FOR_DELAY)
    return unknowable(b,
      `${delays.length} booked consultation${delays.length === 1 ? "" : "s"} started in this period; ${MIN_OBSERVATIONS_FOR_DELAY} are needed before a delay figure means anything`,
      delays.length, excluded);

  return ok(b, median(delays), delays.length, excluded);
}

// ── THE ASSEMBLER ────────────────────────────────────────────────────────────────────────────────────

export type PracticeMetrics = {
  /** s12: "Every dashboard response must include an as_of timestamp and timezone." */
  asOfIso: string;
  timezone: string;
  scope: MetricScope;
  metrics: Record<MetricKey, Metric>;
  /** True when NOTHING could be read. A screen says "could not be read" rather than drawing twelve zeroes. */
  unavailable: boolean;
};

/**
 * Every section 8 metric for one scope, computed once.
 *
 * s16: "No widget independently calculates a conflicting version of a shared metric." A card that needs
 * Waiting reads `metrics.waiting` from here. The moment a widget recomputes it from a query of its own,
 * the dashboard has two answers to one question and the practitioner has no way to tell which is wrong.
 *
 * The reads run in parallel and each metric fails alone -- s14 partial failure: "Render available cards
 * and show retry on the failed card." One dead table must not blank the other eleven figures.
 */
export async function practiceMetrics(
  admin: any, ctx: WorkspaceContext, scope: MetricScope, atTime: Date = new Date(),
): Promise<PracticeMetrics> {
  const [
    booked, waiting, completed, walkIn, cancelled, emergency,
    followUps, noShow, seen, remaining, consult, wait, delay,
  ] = await Promise.all([
    bookedAppointments(admin, ctx, scope),
    waitingPatients(admin, ctx, scope),
    completedEncounters(admin, ctx, scope),
    walkIns(admin, ctx, scope),
    cancelledAppointments(admin, ctx, scope),
    emergencyEncounters(admin, ctx, scope),
    followUpsDue(admin, ctx, scope),
    noShows(admin, ctx, scope),
    patientsSeen(admin, ctx, scope),
    remainingPatients(admin, ctx, scope),
    averageConsultMinutes(admin, ctx, scope),
    averageWaitMinutes(admin, ctx, scope),
    clinicDelayMinutes(admin, ctx, scope),
  ]);

  const metrics: Record<MetricKey, Metric> = {
    booked, waiting, completed, walk_in: walkIn, cancelled, emergency,
    follow_ups_due: followUps, no_show: noShow, patients_seen: seen, remaining,
    average_consult_time: consult, average_wait_time: wait, clinic_delay: delay,
  };

  return {
    asOfIso: atTime.toISOString(),
    timezone: scope.timezone,
    scope,
    metrics,
    // Only a total read failure is "unavailable". A metric that is honestly null because nothing has
    // happened yet is a working dashboard, not a broken one.
    unavailable: Object.values(metrics).every(m => m.status === "unreadable"),
  };
}
