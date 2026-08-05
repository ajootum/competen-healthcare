import type { WorkspaceContext } from "@/lib/practice/access";
import { zonedDayRange } from "@/lib/practice/practice-time";
import type { TodaysPlan, PlannedActivity } from "@/lib/practice/activity";

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

export type SessionMetrics = {
  activity: PlannedActivity;
  startedAtIso: string;
  /** 0-100, clamped. Past the planned end it stays at 100 and `overrunMinutes` carries the rest. */
  progressPercent: number;
  minutesElapsed: number;
  /** Null once the planned end has passed -- "remaining" is not a negative number, it is over. */
  minutesRemaining: number | null;
  patientsRemaining: number | null;
  windowStartIso: string;
  windowEndIso: string;
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
  const minutesElapsed = Math.max(0, Math.round((nowMs - startedMs) / 60000));
  const minutesRemaining = nowMs >= windowEndMs ? null : Math.round((windowEndMs - nowMs) / 60000);

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
    // twenty minutes of progress before anybody had been seen.
    progressPercent: plannedMinutes > 0
      ? clamp(Math.round(((nowMs - startedMs) / (plannedMinutes * 60000)) * 100), 0, 100)
      : 0,
    minutesElapsed,
    minutesRemaining,
    patientsRemaining,
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
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
export type QueueRow = { id: string; name: string; timeLabel: string; waitingMinutes: number; status: string };

export async function waitingQueue(
  admin: any, ctx: WorkspaceContext, at: Date = new Date(),
): Promise<{ groups: QueueGroup[]; total: number | null; unavailable: boolean }> {
  const { data, error } = await admin.from("practice_queue_entry")
    .select("id, patient_name, status, entered_at, appointment_id, practice_appointment:appointment_id(appointment_type)")
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["WAITING", "READY", "IN_CONSULTATION"])
    .order("entered_at", { ascending: true });

  if (error) return { groups: [], total: null, unavailable: true };

  const rows = (data ?? []) as any[];
  const shape = (q: any): QueueRow => ({
    id: q.id, name: q.patient_name, status: q.status,
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
  return { groups, total: rows.length, unavailable: false };
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

  const [dueToday, overdue, waitingResults, booked, completed] = await Promise.all([
    base().in("status", ["OPEN", "SCHEDULED"]).eq("due_on", today),
    base().in("status", ["OPEN", "SCHEDULED"]).lt("due_on", today),
    // "Waiting Results" is a real kind, not a status invented for this card.
    base().in("status", ["OPEN", "SCHEDULED"]).eq("kind", "investigation_result"),
    base().eq("status", "SCHEDULED"),
    base().eq("status", "COMPLETED"),
  ]);

  const n = (r: any) => (r.error ? null : (r.count ?? 0));
  return [
    { key: "due_today", label: "Due Today", count: n(dueToday), href: "/practice/follow-ups" },
    { key: "overdue", label: "Overdue", count: n(overdue), href: "/practice/follow-ups" },
    { key: "waiting_results", label: "Waiting Results", count: n(waitingResults), href: "/practice/follow-ups" },
    { key: "booked", label: "Booked", count: n(booked), href: "/practice/follow-ups" },
    { key: "completed", label: "Completed", count: n(completed), href: "/practice/follow-ups" },
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
