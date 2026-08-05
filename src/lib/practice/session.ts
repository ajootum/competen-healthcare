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
  patientsSeen: number | null;
  patientsRemaining: number | null;
  averageMinutesPerPatient: number | null;
  /** Minutes past the planned end the session is projected to finish. Null when unknowable. */
  runningBehindMinutes: number | null;
  windowStartIso: string;
  windowEndIso: string;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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

  // Encounters inside the window. `.select` with an explicit error check, because a failed read here must
  // leave the figures NULL rather than reporting a session in which nobody has been seen.
  const enc = await admin.from("practice_encounter")
    .select("id, status, started_at, completed_at")
    .eq("workspace_id", ctx.workspaceId)
    .gte("started_at", new Date(windowStartMs).toISOString())
    .lte("started_at", new Date(windowEndMs).toISOString());

  let patientsSeen: number | null = null;
  let averageMinutesPerPatient: number | null = null;
  if (!enc.error) {
    const done = ((enc.data ?? []) as any[])
      .filter(e => e.completed_at && ["COMPLETED", "SIGNED", "AMENDED"].includes(e.status));
    patientsSeen = done.length;
    if (done.length > 0) {
      const total = done.reduce((n, e) =>
        n + Math.max(0, (Date.parse(e.completed_at) - Date.parse(e.started_at)) / 60000), 0);
      averageMinutesPerPatient = Math.round(total / done.length);
    }
  }

  // Still to see: appointments in this session's window that are neither finished nor called off.
  const appt = await admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", new Date(windowStartMs).toISOString())
    .lt("scheduled_at", new Date(windowEndMs).toISOString())
    .not("status", "in", "(COMPLETED,CANCELLED,NO_SHOW)");
  const patientsRemaining = appt.error ? null : (appt.count ?? 0);

  // Projected finish, and only when both inputs were measured rather than assumed.
  let runningBehindMinutes: number | null = null;
  if (averageMinutesPerPatient !== null && patientsRemaining !== null) {
    const projectedFinishMs = nowMs + patientsRemaining * averageMinutesPerPatient * 60000;
    const behind = Math.round((projectedFinishMs - windowEndMs) / 60000);
    if (behind > 0) runningBehindMinutes = behind;
  }

  return {
    activity,
    startedAtIso: activity.startedAt,
    progressPercent: plannedMinutes > 0
      ? clamp(Math.round(((nowMs - windowStartMs) / (plannedMinutes * 60000)) * 100), 0, 100)
      : 0,
    minutesElapsed,
    minutesRemaining,
    patientsSeen,
    patientsRemaining,
    averageMinutesPerPatient,
    runningBehindMinutes,
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
  };
}

// ── TODAY AT A GLANCE (s3) ──────────────────────────────────────────────────────────────────────────
//
// The comp's eight counters. Each is a COUNT OF ROWS matching a status or a type -- there is no derived
// or blended figure among them, so every tile is the length of a list somebody can open and check.
//
// SCOPED TO THE SESSION WHEN ONE IS RUNNING, to the day otherwise. That is the whole point of s9: the
// same eight tiles mean "my clinic" during a clinic and "my day" outside one.

export type GlanceTile = { key: string; label: string; count: number | null; href: string; tone: string };

export async function todayAtAGlance(
  admin: any, ctx: WorkspaceContext,
  opts: { fromIso: string; toIso: string; today: string; scope: "session" | "day" },
): Promise<{ tiles: GlanceTile[]; scope: "session" | "day"; unavailable: boolean }> {
  const base = () => admin.from("practice_appointment")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", opts.fromIso).lt("scheduled_at", opts.toIso);

  const [booked, waiting, completed, walkIns, emergency, cancelled, noShow, followUps] = await Promise.all([
    base().in("status", ["REQUESTED", "CONFIRMED"]),
    base().eq("status", "ARRIVED"),
    base().eq("status", "COMPLETED"),
    base().eq("appointment_type", "walk_in"),
    base().eq("appointment_type", "emergency"),
    base().eq("status", "CANCELLED"),
    base().eq("status", "NO_SHOW"),
    admin.from("practice_follow_up").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"]).lte("due_on", opts.today),
  ]);

  const n = (r: any) => (r.error ? null : (r.count ?? 0));
  const tiles: GlanceTile[] = [
    { key: "booked", label: "Booked", count: n(booked), href: "/practice/calendar", tone: "primary" },
    { key: "waiting", label: "Waiting", count: n(waiting), href: "/practice/calendar", tone: "info" },
    { key: "completed", label: "Completed", count: n(completed), href: "/practice/encounters", tone: "success" },
    { key: "walk_ins", label: "Walk-ins", count: n(walkIns), href: "/practice/calendar", tone: "warning" },
    { key: "cancelled", label: "Cancelled", count: n(cancelled), href: "/practice/calendar", tone: "danger" },
    { key: "emergency", label: "Emergency", count: n(emergency), href: "/practice/calendar", tone: "danger" },
    { key: "follow_ups_due", label: "Follow-ups Due", count: n(followUps), href: "/practice/follow-ups", tone: "info" },
    { key: "no_show", label: "No Show", count: n(noShow), href: "/practice/calendar", tone: "neutral" },
  ];
  // The scope is the CALLER's, because only it knows whether a session is running. Returned here so the
  // screen labels the tiles with the window they were actually counted over -- "3 waiting" means very
  // different things across a clinic and across a day, and an unlabelled figure is the wrong one half
  // the time.
  return { tiles, scope: opts.scope, unavailable: tiles.every(t => t.count === null) };
}

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
