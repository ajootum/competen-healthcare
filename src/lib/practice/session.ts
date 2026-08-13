import type { WorkspaceContext } from "@/lib/practice/access";
import { zonedDayRange, dueDateFrom } from "@/lib/practice/practice-time";
import { pauseLedger, type TodaysPlan, type PlannedActivity } from "@/lib/practice/activity";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// CPR-V5-001 SESSION ENGINE -- the layer that makes the dashboard operational rather than appointmental.
//
// "The dashboard should no longer revolve around appointments. It should revolve around the practitioner's
// current operational context and the encounters that occur within it." Everything here is scoped to the
// RUNNING ACTIVITY when there is one, and to the day when there is not -- which is what s9 means by "the
// entire dashboard must automatically change based on confirmed current activity and location".
//
// ── WHAT IS DERIVED, AND FROM WHAT ──────────────────────────────────────────────────────────────────
//
// Nothing in here is stored. Every figure is computed from rows that exist plus the clock, so none of it
// can go stale and none of it needs a background job:
//
//   session progress          elapsed / planned duration
//   time remaining            planned end - now
//   patients seen             encounters COMPLETED inside the session window
//   average minutes/patient   mean of (completed_at - started_at) over those encounters
//   patients remaining        appointments for this session not yet completed or cancelled
//   running behind            projected finish - planned end, where projected finish is
//                             now + (remaining x average). Honest because both inputs are measured.
//
// ⚠ AVERAGE AND PROJECTION ARE NULL UNTIL THEY ARE EARNED. With no completed encounter there is no
// average, and with no average there is no projection -- so "Running behind" is ABSENT rather than 0.
// A projection built on a default of ten minutes a patient is a guess wearing a number's clothes, and
// the one figure a practitioner would actually change their afternoon over must not be invented.
//
// ⚠ ENCOUNTERS ARE MATCHED BY TIME, NOT BY activity_id. Migration 232 added the column and nothing
// writes it yet, so filtering on it would report every session as empty. The window is the honest
// approximation available today; when encounters start carrying their activity this becomes an equality
// and the numbers get sharper rather than different.
//
// ── PAUSED TIME COMES OUT OF THE ARITHMETIC (CPR-V5-004, migration 235) ─────────────────────────────
//
// CPR-CORE-001 s6.2 says interruption time must not be counted as active consultation time for another
// patient. The same sentence one rung up is that interruption time must not be counted as elapsed
// SESSION time -- and until migration 235 there was nothing to subtract, so a clinic paused for lunch
// kept burning through the progress bar and the time-remaining figure while nobody was in the room. The
// practitioner then read a number wrong by exactly the length of the break, in the direction that makes
// them cut consultations short.
//
// Two of the three clock figures change, and both in the same direction:
//
//   minutesElapsed    (now - startedAt) MINUS the paused minutes. Time the session actually ran.
//   progressPercent   the same numerator over the planned duration.
//   minutesRemaining  measured against the planned end PUSHED OUT by the paused minutes. A clinic
//                     stopped for forty minutes finishes forty minutes later -- the work did not go
//                     away while nobody was doing it.
//
// The visible consequence, and the thing worth checking by hand: WHILE A SESSION IS PAUSED, NEITHER
// FIGURE MOVES. The paused total grows at exactly the rate the wall clock does, so it cancels.
//
// ⚠ windowStartIso AND windowEndIso ARE NOT ADJUSTED. They are the PLAN, and dashboard.ts scopes every
// s8 metric by them -- widening the window for a pause would silently change which appointments and
// encounters belong to the session, so a break would alter the patient counts as well as the clock. The
// adjustment belongs to the countdown, not to the definition of what is in the session.

export type SessionMetrics = {
  activity: PlannedActivity;
  startedAtIso: string;
  /** 0-100, clamped, net of pauses. Past the planned end it stays at 100 and `overrunMinutes` carries the rest. */
  progressPercent: number;
  /** Minutes the session has actually been RUNNING: wall clock since it started, less the pauses. */
  minutesElapsed: number;
  /** Null once the pause-adjusted end has passed -- "remaining" is not a negative number, it is over. */
  minutesRemaining: number | null;
  patientsRemaining: number | null;
  windowStartIso: string;
  windowEndIso: string;
  /**
   * Total minutes this session has been paused so far.
   *
   * ⚠ NULL WHEN THE PAUSE LEDGER COULD NOT BE READ, and never 0. Zero is a claim that the clinic ran
   * without interruption -- and it is the value the two figures above are computed against, so reporting
   * an unreadable ledger as 0 would hand back exactly the un-corrected progress bar this feature exists
   * to remove, with nothing anywhere saying so. When this is null, `progressPercent` and
   * `minutesRemaining` are the raw clock and may overstate progress: a screen should say it cannot tell
   * rather than draw a bar it has no basis for.
   */
  pausedMinutes: number | null;
  /** A pause is open right now. False when the ledger is unreadable, which `pausedMinutes` says. */
  isPaused: boolean;
  /** When the open pause began. Null when the session is running or the ledger is unreadable. */
  pausedSince: string | null;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A session plus the two patient figures s8 defines and metrics.ts owns.
 *
 * ⚠ THIS TYPE EXISTS SO THE SESSION ENGINE CANNOT COUNT PATIENTS. sessionMetrics used to read encounters
 * and compute patientsSeen and an average itself -- a second, subtly different answer to two of s8's
 * twelve metrics, living one card away from the first. s16 forbids exactly that. The session engine now
 * owns the CLOCK (window, progress, elapsed, remaining) and is HANDED the patient figures.
 */
export type SessionWithFigures = SessionMetrics & {
  patientsSeen: number | null;
  averageMinutesPerPatient: number | null;
  /** Minutes past the planned end the session is projected to finish. Null when unknowable. */
  runningBehindMinutes: number | null;
};

/**
 * The projection, from figures measured elsewhere.
 *
 * ⚠ NULL UNTIL EARNED, and this is the assertion that keeps the comp honest. The mockup prints
 * "Running behind 12 min" and "18 min" average; both are unknowable until an encounter has finished.
 * With no average there is no projection -- and this is the one figure on the page somebody would
 * rearrange an afternoon over, so a default would be a guess wearing a number's clothes.
 */
export function withPatientFigures(
  session: SessionMetrics,
  patientsSeen: number | null,
  averageMinutesPerPatient: number | null,
  at: Date = new Date(),
): SessionWithFigures {
  let runningBehindMinutes: number | null = null;
  if (averageMinutesPerPatient !== null && session.patientsRemaining !== null) {
    const projectedFinishMs = at.getTime() + session.patientsRemaining * averageMinutesPerPatient * 60000;
    const behind = Math.round((projectedFinishMs - Date.parse(session.windowEndIso)) / 60000);
    if (behind > 0) runningBehindMinutes = behind;
  }
  return { ...session, patientsSeen, averageMinutesPerPatient, runningBehindMinutes };
}

/**
 * Zone 1 and Zone 5 of the comp: what this session is, and how it is going.
 *
 * Returns null when nothing is running -- the caller renders the activity picker instead, which is what
 * "start the day in one click" (s10) needs to exist for.
 */
export async function sessionMetrics(
  admin: any, ctx: WorkspaceContext, plan: TodaysPlan, at: Date = new Date(),
): Promise<SessionMetrics | null> {
  const activity = plan.current;
  if (!activity || !activity.startedAt) return null;

  const { startIso } = zonedDayRange(plan.date, plan.timezone);
  const dayStartMs = Date.parse(startIso);
  const windowStartMs = dayStartMs + activity.plannedStartMinute * 60000;
  const windowEndMs = dayStartMs + activity.plannedEndMinute * 60000;
  const nowMs = at.getTime();

  const plannedMinutes = activity.plannedEndMinute - activity.plannedStartMinute;
  // Elapsed is measured from when the session ACTUALLY started, not from its planned start. A clinic
  // that opened twenty minutes late is not twenty minutes through it.
  const startedMs = Date.parse(activity.startedAt);

  // Migration 235's ledger, read through the engine that owns it rather than queried here. Two modules
  // summing pause intervals their own way is the drift s16 forbids, and it would drift only between a
  // session's summary and the bar the practitioner is watching -- one screen apart.
  const pauses = await pauseLedger(admin, ctx.workspaceId, activity.id, { at });
  const pausedMs = (pauses.pausedMinutes ?? 0) * 60000;

  const runningMs = Math.max(0, nowMs - startedMs - pausedMs);
  const minutesElapsed = Math.round(runningMs / 60000);
  // The finish line moves out by whatever the session was stopped for. While a pause is open both this
  // and `minutesElapsed` stand still, because the paused total grows at the wall clock's own rate.
  const adjustedEndMs = windowEndMs + pausedMs;
  const minutesRemaining = nowMs >= adjustedEndMs ? null : Math.round((adjustedEndMs - nowMs) / 60000);

  // Still to see: appointments in this session's window that are neither finished nor called off.
  const appt = await admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", new Date(windowStartMs).toISOString())
    .lt("scheduled_at", new Date(windowEndMs).toISOString())
    .not("status", "in", "(COMPLETED,CANCELLED,NO_SHOW)");
  const patientsRemaining = appt.error ? null : (appt.count ?? 0);

  return {
    activity,
    startedAtIso: activity.startedAt,
    // Measured from when the session ACTUALLY started, matching `minutesElapsed` above. Computed from the
    // PLANNED start it contradicted its own comment: a clinic that opened twenty minutes late showed
    // twenty minutes of progress before anybody had been seen. Net of pauses for the same reason: an
    // hour of which forty minutes were a break is twenty minutes of clinic.
    progressPercent: plannedMinutes > 0
      ? clamp(Math.round((runningMs / (plannedMinutes * 60000)) * 100), 0, 100)
      : 0,
    minutesElapsed,
    minutesRemaining,
    patientsRemaining,
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
    pausedMinutes: pauses.pausedMinutes,
    isPaused: pauses.isPaused,
    pausedSince: pauses.pausedSince,
  };
}

// ── TODAY AT A GLANCE: MOVED, NOT DELETED ───────────────────────────────────────────────────────────
//
// `todayAtAGlance` used to live here and counted the eight tiles itself. Its definitions disagreed with
// CPR-CORE-001 s8 in five places -- Waiting read from appointment status rather than the queue, so a
// walk-in was invisible and a patient already in the room was still counted as waiting; Completed
// counted a clerical desk action rather than a clinical one; Follow-ups Due folded the entire overdue
// backlog into "due".
//
// The tiles are now a VIEW of src/lib/practice/metrics.ts, assembled in dashboard.ts. This function was
// removed rather than corrected: s16's rule is not "compute it correctly twice", it is "no widget
// independently calculates a conflicting version of a shared metric". Two correct implementations drift
// into two answers just as surely as a wrong one -- only later, and more quietly.

// ── THE WAITING QUEUE, SPLIT THREE WAYS (s4) ────────────────────────────────────────────────────────
//
// Booked / Walk-ins / Emergency. The split is derived from the APPOINTMENT the queue entry points at:
// no appointment means somebody walked in, and an appointment typed `emergency` means an interruption.
// The queue table itself has no type column, and adding one would give two places to disagree about
// what a walk-in is.

export type QueueGroup = { key: string; label: string; entries: QueueRow[] };
export type QueueRow = {
  id: string; name: string; timeLabel: string; waitingMinutes: number; status: string;
  /**
   * !! THE PATIENT, NOT THE QUEUE ENTRY. `id` above is the queue row's own id, and `name` is a
   * DENORMALISED copy on that row -- so before this field the corridor knew who was waiting only as text.
   * Anything wanting to act on the patient (Capture Later's one-tap Seen creates an encounter linked to
   * them) had nothing to act on. Nullable because a walk-in can be in the queue before being registered,
   * and a button that cannot act must not be drawn rather than guess.
   */
  patientId: string | null;
};

/**
 * How many people this list will draw before it stops.
 *
 * ⚠ THE READ USED TO BE UNBOUNDED, which does NOT mean it returned everybody -- PostgREST stops at a
 * thousand rows on its own and says nothing. The queue then reported `total: rows.length`, so a
 * practice with more waiting than that was told it had exactly a thousand, and the number looked
 * ordinary. A silent truncation reads as "that is all", which is the one thing it is not.
 */
export const QUEUE_LIMIT = 200;

export async function waitingQueue(
  admin: any, ctx: WorkspaceContext, at: Date = new Date(),
): Promise<{ groups: QueueGroup[]; total: number | null; unavailable: boolean; capped: boolean }> {
  // ⚠ THE TOTAL COMES FROM THE DATABASE, NOT FROM THE ROWS. `count: exact` is computed over the whole
  // matching set and is unaffected by the limit, so the figure on the badge stays true even when the
  // list beneath it is trimmed. Counting the returned array instead is what made the cap invisible.
  const { data, error, count } = await admin.from("practice_queue_entry")
    .select(
      "id, patient_id, patient_name, status, entered_at, appointment_id, practice_appointment:appointment_id(appointment_type)",
      { count: "exact" })
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["WAITING", "READY", "IN_CONSULTATION"])
    .order("entered_at", { ascending: true })
    // One past the bound, purely so a full page can be told from a truncated one.
    .limit(QUEUE_LIMIT + 1);

  if (error) return { groups: [], total: null, unavailable: true, capped: false };

  const loaded = (data ?? []) as any[];
  const capped = loaded.length > QUEUE_LIMIT;
  const rows = capped ? loaded.slice(0, QUEUE_LIMIT) : loaded;
  const shape = (q: any): QueueRow => ({
    id: q.id, name: q.patient_name, status: q.status, patientId: q.patient_id ?? null,
    timeLabel: new Date(q.entered_at).toISOString().slice(11, 16),
    waitingMinutes: Math.max(0, Math.round((at.getTime() - Date.parse(q.entered_at)) / 60000)),
  });

  const isEmergency = (q: any) => q.practice_appointment?.appointment_type === "emergency";
  const isWalkIn = (q: any) => !q.appointment_id || q.practice_appointment?.appointment_type === "walk_in";

  const groups: QueueGroup[] = [
    { key: "booked", label: "Booked", entries: rows.filter(q => !isEmergency(q) && !isWalkIn(q)).map(shape) },
    { key: "walk_ins", label: "Walk-ins", entries: rows.filter(q => !isEmergency(q) && isWalkIn(q)).map(shape) },
    { key: "emergency", label: "Emergency", entries: rows.filter(isEmergency).map(shape) },
  ];
  // ⚠ `count` FIRST, and rows.length only if the database declined to count. The two differ exactly
  // when the cap bit, which is the case this whole change exists for -- preferring rows.length would
  // reinstate the bug while looking like a safe fallback.
  return { groups, total: count ?? rows.length, unavailable: false, capped };
}

// ── ACTIVE FOLLOW-UPS, FIVE LENSES (s6) ─────────────────────────────────────────────────────────────
//
// ⚠ THESE OVERLAP AND ARE NOT A TOTAL. A scheduled investigation result due today appears in three of
// them. They are five questions about the same list, not five slices of it, and the UI must never sum
// them -- which is why this returns no total and the labels are questions rather than categories.

export type FollowUpLens = { key: string; label: string; count: number | null; href: string };

export async function activeFollowUps(
  admin: any, ctx: WorkspaceContext, today: string,
): Promise<FollowUpLens[]> {
  const base = () => admin.from("practice_follow_up")
    .select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId);

  // ⚠ THIS IS NOW THE ONLY PLACE FOLLOW-UP COUNTS ARE COMPUTED, and it had to become so because the
  // second implementation DISAGREED with this one. command-centre.ts computed its own set and the two
  // gave different answers for the same word on two screens a click apart:
  //
  //   "Overdue"      here: OPEN or SCHEDULED past its date.  There: OPEN only. A booked-but-late
  //                  follow-up was overdue on one page and not on the other.
  //   "Booked Today" there, and it was not today's -- it counted every SCHEDULED follow-up ever. The
  //                  label was simply false, and this file's own name for the same query is "Booked".
  //   The counts     there came from a .limit(2000) row fetch counted in JavaScript, so a practice with
  //                  more than two thousand follow-ups was quietly given wrong numbers. These are
  //                  `count: exact, head: true` -- the database counts, and no cap applies.
  //
  // ONE OWNER PER METRIC (CPR-CORE-001 s16.11). Two implementations do not merely risk drift; these had
  // already drifted, and nothing failed, because each was correct against itself.
  const weekAhead = dueDateFrom(today, 7);

  const [dueToday, overdue, waitingResults, booked, completed, needBooking, dueWeek] = await Promise.all([
    base().in("status", ["OPEN", "SCHEDULED"]).eq("due_on", today),
    base().in("status", ["OPEN", "SCHEDULED"]).lt("due_on", today),
    // "Waiting Results" is a real kind, not a status invented for this card.
    base().in("status", ["OPEN", "SCHEDULED"]).eq("kind", "investigation_result"),
    base().eq("status", "SCHEDULED"),
    base().eq("status", "COMPLETED"),
    // OPEN and not yet past due: an obligation nobody has booked a slot for. SCHEDULED is excluded
    // because that is precisely the one that HAS been booked.
    base().eq("status", "OPEN").gte("due_on", today),
    base().eq("status", "OPEN").gte("due_on", today).lte("due_on", weekAhead),
  ]);

  const n = (r: any) => (r.error ? null : (r.count ?? 0));
  return [
    { key: "due_today", label: "Due Today", count: n(dueToday), href: "/practice/follow-ups" },
    { key: "overdue", label: "Overdue", count: n(overdue), href: "/practice/follow-ups" },
    { key: "waiting_results", label: "Waiting Results", count: n(waitingResults), href: "/practice/follow-ups" },
    { key: "booked", label: "Booked", count: n(booked), href: "/practice/follow-ups" },
    { key: "completed", label: "Completed", count: n(completed), href: "/practice/follow-ups" },
    { key: "need_booking", label: "Need Booking", count: n(needBooking), href: "/practice/follow-ups" },
    { key: "due_week", label: "Due This Week", count: n(dueWeek), href: "/practice/follow-ups" },
  ];
}

// ── OPERATIONAL ALERTS (s5) ─────────────────────────────────────────────────────────────────────────
//
// Rule-based over real rows, NOT generated prose. Each alert is a count that is non-zero and a link to
// the list behind it, so nothing here can claim something that is not sitting in a table. An alert with
// a count of nought does not render at all: a quiet practice should show an empty card, not four
// reassurances, or the card becomes wallpaper and the one real alert is missed inside it.

export type Alert = { key: string; text: string; href: string; tone: "danger" | "warning" | "info" };

export async function operationalAlerts(
  admin: any, ctx: WorkspaceContext, today: string,
): Promise<{ alerts: Alert[]; unavailable: boolean }> {
  const [results, overdue, drafts] = await Promise.all([
    admin.from("practice_incoming_document").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "RECEIVED"),
    admin.from("practice_follow_up").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"])
      .lt("due_on", today).eq("priority", "urgent"),
    admin.from("practice_encounter").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "DRAFT"),
  ]);

  const alerts: Alert[] = [];
  const add = (r: any, tone: Alert["tone"], key: string, href: string, one: string, many: (n: number) => string) => {
    if (r.error || !r.count) return;
    alerts.push({ key, tone, href, text: r.count === 1 ? one : many(r.count) });
  };
  add(results, "info", "results", "/practice/inbox",
    "1 incoming document is waiting to be reviewed.", n => `${n} incoming documents are waiting to be reviewed.`);
  add(overdue, "danger", "overdue", "/practice/follow-ups",
    "1 urgent follow-up is overdue.", n => `${n} urgent follow-ups are overdue.`);
  add(drafts, "warning", "drafts", "/practice/encounters",
    "1 encounter is incomplete.", n => `${n} encounters are incomplete.`);

  return { alerts, unavailable: [results, overdue, drafts].every((r: any) => r.error) };
}

/** Draft encounters, so an interruption can be resumed rather than lost (s4 "support continuation"). */
export async function draftEncounters(admin: any, ctx: WorkspaceContext, limit = 3) {
  const { data, error } = await admin.from("practice_encounter")
    .select("id, started_at, practice_patient:patient_id(display_name)")
    .eq("workspace_id", ctx.workspaceId).eq("status", "DRAFT")
    .order("started_at", { ascending: false }).limit(limit);
  if (error) return null;
  return ((data ?? []) as any[]).map(e => ({
    id: e.id,
    patientName: e.practice_patient?.display_name ?? "Unnamed patient",
    startedAtIso: e.started_at,
  }));
}
