import type { WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/practice/activity";
import { formatMinuteOfDay } from "@/lib/datetime";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// CPR-V5-001 s4 SESSION TIMELINE -- the day as it actually went, in the order it went.
//
// The rest of the session engine answers "how is this going" in aggregate: seen, remaining, behind. This
// one answers the other half of s4, "what has happened so far", and it is the card a practitioner reads
// when they have lost the thread of their own morning -- after an interruption, or when writing up.
//
// ── WHAT AN EVENT IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────────
//
// EVERY EVENT IS ONE TIMESTAMP ON ONE ROW THAT EXISTS. Nothing here is inferred, blended or rounded into
// existence:
//
//   activity_started    practice_activity.started_at      "Morning Clinic started"
//   activity_ended      practice_activity.ended_at        "Morning Clinic ended"
//   arrival             practice_queue_entry.entered_at   "Walk-in - Mary Achieng"
//   encounter_started   practice_encounter.started_at     "John Smith"
//
// ⚠ THE PLANNED-BUT-NOT-STARTED ENTRIES ARE SEPARATED, NOT MIXED IN. The comp's later rows ("Ward
// Review", "MDT Meeting") are usually still ahead of the clock, and a plan is not an event: an activity
// that never ran would otherwise sit in the timeline all afternoon looking like it had. They come back
// in `upcoming` with `occurred: false`, so a screen can draw them under a divider -- and so that a caller
// which concatenates the two arrays anyway still has the flag to tell them apart.
//
// ── DERIVED, NOT STORED ─────────────────────────────────────────────────────────────────────────────
//
// No table, no migration, no event log. An events table would be a second place for the day to be
// recorded and therefore a second place for it to disagree with the rows people actually edit -- a
// cancelled encounter would stay on the timeline, because nothing would have gone back to delete its
// event. Reading the timestamps every time cannot drift from them.
//
// ── THE CLOCK IS THE PRACTICE'S ─────────────────────────────────────────────────────────────────────
//
// `minuteOfDay` is minutes from the start of the PRACTICE'S day, and `timeLabel` is formatted from that
// rather than from the instant. A browser doing `new Date(iso).getHours()` reads the laptop's timezone,
// which is right until somebody travels; the same trap timeline.ts documents for the calendar.
//
// ⚠ ARRIVALS AND ENCOUNTERS ARE WORKSPACE-WIDE, ACTIVITIES ARE THE PRACTITIONER'S. practice_encounter and
// practice_queue_entry carry no practitioner column (migrations 192/194), and practice_encounter's
// activity_id -- which would give the link -- is written by nothing yet, so filtering on it would report
// every session as empty (session.ts records the same finding). So in a single-practitioner workspace
// this is exactly their day, and in a shared one it is the practice's day. That is stated here rather
// than fixed with a guess, and it becomes an equality the day encounters start carrying their activity.

export type TimelineEventKind =
  | "activity_started"
  | "activity_ended"
  | "activity_planned"
  | "arrival"
  | "encounter_started";

export type TimelineEvent = {
  /** Stable and source-prefixed, so two sources cannot collide on a row id. */
  id: string;
  kind: TimelineEventKind;
  /** Minutes from the start of the practice's day -- the only positioning number a screen needs. */
  minuteOfDay: number;
  /** "08:15", on the practice's wall clock. Formatted from minuteOfDay, never from the instant. */
  timeLabel: string;
  atIso: string;
  label: string;
  /** The second line: where, or what kind of visit. Null when there is nothing true to add. */
  detail: string | null;
  /** An emergency or a walk-in: the row the comp highlights. Derived, so the page never re-derives it. */
  interruption: boolean;
  /** False for the planned entries in `upcoming`. Nothing in `events` is ever false. */
  occurred: boolean;
  href: string | null;
};

export type TimelineSourceState = "ok" | "unavailable" | "not_permitted";

export type TimelineSource = {
  key: "activities" | "arrivals" | "encounters";
  label: string;
  state: TimelineSourceState;
};

export type SessionTimeline = {
  date: string;
  timezone: string;
  dayStartIso: string;
  /** What happened, earliest first. */
  events: TimelineEvent[];
  /** What is still planned and has not started. NOT events -- `occurred` is false on every one. */
  upcoming: TimelineEvent[];
  sources: TimelineSource[];
  /**
   * True when NOT ONE source could be read -- so the caller says "could not read the day" instead of
   * drawing a blank one. Read with `sources` to tell "the query failed" from "you may not see this".
   */
  unavailable: boolean;
  /**
   * True when SOME source failed. The timeline is real but incomplete, and a screen that says nothing
   * about it is claiming a quiet morning it has not actually checked.
   */
  partial: boolean;
};

export type SessionTimelineOptions = {
  /** The practice's date, YYYY-MM-DD. Defaults to the practice's today, never the server's. */
  date?: string;
  /** The practice timezone, when the caller already read it (todaysPlan returns it) -- saves a query. */
  timezone?: string;
  at?: Date;
};

// practice.home.view is what activity.ts already requires to read a day's plan; the other two are the
// capabilities the encounter list and the waiting room are gated on everywhere else in this codebase.
const CAN_ACTIVITIES = "practice.home.view";
const CAN_ENCOUNTERS = "encounter.list";
const CAN_QUEUE = ["queue.manage", "practice.calendar.view"];

const RANK: Record<TimelineEventKind, number> = {
  activity_started: 0,
  arrival: 1,
  encounter_started: 2,
  activity_ended: 3,
  activity_planned: 4,
};

/** An appointment typed `emergency` is an interruption; no appointment at all means somebody walked in. */
const apptType = (row: any): string | null => row?.practice_appointment?.appointment_type ?? null;

/**
 * The chronological operational events of one day (CPR-V5-001 s4).
 *
 * A FAILED READ IS NEVER AN EMPTY TIMELINE. Every query's `error` is checked and reported through
 * `sources` / `unavailable` / `partial`, because "nothing has happened yet" and "I could not find out"
 * are different sentences, and only one of them should be shown to somebody halfway through a clinic.
 *
 * A MISSING CAPABILITY CONTRIBUTES NO EVENTS AND IS NOT AN ERROR. An assistant without encounter.list
 * gets a timeline of arrivals, marked `not_permitted` on that source, rather than a refusal.
 */
export async function sessionTimeline(
  admin: any, ctx: WorkspaceContext, opts: SessionTimelineOptions = {},
): Promise<SessionTimeline> {
  const at = opts.at ?? new Date();

  let timezone: string = opts.timezone ?? "";
  if (!timezone) {
    const { data: ws } = await admin.from("practice_workspace")
      .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
    timezone = (ws?.timezone as string) || "UTC";
  }
  const date = opts.date ?? practiceToday(timezone, at);
  const { startIso, endIso } = zonedDayRange(date, timezone);
  const dayStartMs = Date.parse(startIso);

  const can = (cap: string) => ctx.capabilities.includes(cap);
  const canActivities = can(CAN_ACTIVITIES);
  const canEncounters = can(CAN_ENCOUNTERS);
  const canQueue = CAN_QUEUE.some(can);

  const [act, arrivals, encounters] = await Promise.all([
    canActivities
      ? admin.from("practice_activity")
        .select("id, activity_type, title, room, planned_start_minute, started_at, ended_at, " +
          "practice_facility:facility_id(name), practice_location:location_id(name)")
        .eq("workspace_id", ctx.workspaceId)
        .eq("practitioner_id", ctx.userId)
        .eq("plan_date", date)
        .order("planned_start_minute", { ascending: true })
      : null,
    canQueue
      ? admin.from("practice_queue_entry")
        .select("id, patient_name, status, entered_at, appointment_id, " +
          "practice_appointment:appointment_id(appointment_type)")
        .eq("workspace_id", ctx.workspaceId)
        .gte("entered_at", startIso).lt("entered_at", endIso)
        .order("entered_at", { ascending: true })
      : null,
    canEncounters
      // CANCELLED and ENTERED_IN_ERROR are excluded: a record withdrawn as an error is not a thing that
      // happened, and leaving it on the timeline would be the one lie this card cannot afford.
      ? admin.from("practice_encounter")
        .select("id, status, started_at, entry_pathway, " +
          "practice_patient:patient_id(display_name), practice_appointment:appointment_id(appointment_type)")
        .eq("workspace_id", ctx.workspaceId)
        .gte("started_at", startIso).lt("started_at", endIso)
        .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)")
        .order("started_at", { ascending: true })
      : null,
  ]);

  const state = (permitted: boolean, r: any): TimelineSourceState =>
    !permitted ? "not_permitted" : r?.error ? "unavailable" : "ok";

  const sources: TimelineSource[] = [
    { key: "activities", label: "Sessions", state: state(canActivities, act) },
    { key: "arrivals", label: "Arrivals", state: state(canQueue, arrivals) },
    { key: "encounters", label: "Consultations", state: state(canEncounters, encounters) },
  ];

  const events: TimelineEvent[] = [];
  const upcoming: TimelineEvent[] = [];

  // An instant becomes a place on the day, or it becomes nothing. An activity that ran past midnight has
  // an ended_at that belongs to tomorrow's timeline, not today's, and clamping it to 23:59 would invent a
  // finish nobody witnessed.
  const push = (into: TimelineEvent[], e: Omit<TimelineEvent, "minuteOfDay" | "timeLabel" | "atIso">, atMs: number) => {
    const minuteOfDay = Math.floor((atMs - dayStartMs) / 60000);
    if (minuteOfDay < 0 || minuteOfDay >= 1440) return;
    into.push({ ...e, minuteOfDay, timeLabel: formatMinuteOfDay(minuteOfDay), atIso: new Date(atMs).toISOString() });
  };

  if (act && !act.error) {
    for (const a of ((act.data ?? []) as any[])) {
      const label = ACTIVITY_LABEL[a.activity_type as ActivityType] ?? a.activity_type;
      const where = [a.practice_facility?.name, a.practice_location?.name, a.room]
        .filter(Boolean).join(" - ") || null;
      const detail = where ? `${label} - ${where}` : label;

      if (a.started_at) {
        push(events, {
          id: `activity-start:${a.id}`, kind: "activity_started",
          label: `${a.title} started`, detail,
          interruption: a.activity_type === "emergency_consult",
          occurred: true, href: "/practice/activity",
        }, Date.parse(a.started_at));
      }
      if (a.ended_at) {
        push(events, {
          id: `activity-end:${a.id}`, kind: "activity_ended",
          label: `${a.title} ended`, detail,
          interruption: false, occurred: true, href: "/practice/activity",
        }, Date.parse(a.ended_at));
      }
      if (!a.started_at) {
        // planned_start_minute is already local wall-clock minutes from midnight (migration 232's
        // convention), so this instant is built from the day's start rather than parsed from a column.
        push(upcoming, {
          id: `activity-planned:${a.id}`, kind: "activity_planned",
          label: a.title, detail,
          interruption: a.activity_type === "emergency_consult",
          occurred: false, href: "/practice/activity",
        }, dayStartMs + a.planned_start_minute * 60000);
      }
    }
  }

  if (arrivals && !arrivals.error) {
    for (const q of ((arrivals.data ?? []) as any[])) {
      const type = apptType(q);
      const emergency = type === "emergency";
      const walkIn = !q.appointment_id || type === "walk_in";
      const name = q.patient_name || "Unnamed patient";
      push(events, {
        id: `arrival:${q.id}`, kind: "arrival",
        label: emergency ? `Emergency - ${name}` : walkIn ? `Walk-in - ${name}` : `${name} arrived`,
        detail: q.status === "LEFT" ? "Left before being seen" : null,
        interruption: emergency || walkIn,
        occurred: true, href: "/practice/calendar",
      }, Date.parse(q.entered_at));
    }
  }

  if (encounters && !encounters.error) {
    for (const e of ((encounters.data ?? []) as any[])) {
      const emergency = apptType(e) === "emergency";
      // entry_pathway is the encounter's OWN account of how the patient got here (migration 194), and it
      // is the honest one for a walk-in: a walk-in encounter has no appointment to ask.
      const walkIn = e.entry_pathway === "new_walk_in" || e.entry_pathway === "walk_in_followup";
      push(events, {
        id: `encounter:${e.id}`, kind: "encounter_started",
        label: e.practice_patient?.display_name ?? "Unnamed patient",
        detail: emergency ? "Emergency" : walkIn ? "Walk-in" : null,
        interruption: emergency || walkIn,
        occurred: true, href: `/practice/encounters/${e.id}`,
      }, Date.parse(e.started_at));
    }
  }

  // Chronological, and within a minute in the order a day happens: a session opens, patients arrive, they
  // are seen, the session closes. Ties are otherwise arbitrary, and an arbitrary order of two rows on the
  // same minute changes between reloads, which reads as the page glitching.
  const chronological = (a: TimelineEvent, b: TimelineEvent) =>
    a.minuteOfDay - b.minuteOfDay || RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id);
  events.sort(chronological);
  upcoming.sort(chronological);

  return {
    date, timezone, dayStartIso: startIso,
    events, upcoming, sources,
    unavailable: sources.every(s => s.state !== "ok"),
    partial: sources.some(s => s.state === "unavailable"),
  };
}
