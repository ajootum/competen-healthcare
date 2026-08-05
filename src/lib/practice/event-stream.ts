import type { WorkspaceContext } from "@/lib/practice/access";
import { PRACTICE_EVENT_TYPES, type PracticeEventType } from "@/lib/practice/events";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

// CPR-CORE-001 CORE-09, second half: THE DASHBOARD EVENT STREAM.
//
// s10: `GET /practice/stream` -- "SSE/WebSocket stream of dashboard-relevant events."
// s12: "Operational items should update through SSE or WebSocket where available. Polling fallback may
//       run every 30-60 seconds."
// s18: "Event propagation is observable and retryable."
//
// ── WHAT published_at MEANS, AND WHAT IT DOES NOT ───────────────────────────────────────────────────
//
// It means: this event has been emitted to a live stream AT LEAST ONCE. That is an observability marker
// (s18's "observable"), not a delivery receipt.
//
// ⚠ IT IS NOT PER-SUBSCRIBER DELIVERY AND MUST NEVER BE READ AS ONE. Two practitioners with the dashboard
// open are two connections over one table: if a stream skipped rows that were already published, the
// second one would silently miss everything the first had seen. So THE CURSOR IS PER CONNECTION and
// published_at is never used to filter. A stream that filtered on it would work perfectly in testing,
// where one client is connected, and lose events in a two-person practice.
//
// ── HOW A DROPPED CONNECTION CATCHES UP ─────────────────────────────────────────────────────────────
//
// SSE's own `Last-Event-ID` header. The browser sends back the id of the last event it received, and the
// stream resumes from there -- so a laptop closed over lunch replays what it missed rather than starting
// blank and pretending the morning was quiet. That is s18's "retryable", and it is why the cursor is
// ordered by `recorded_at` rather than `occurred_at`: a retried or backdated emit has an occurred_at in
// the past and would fall BEHIND a cursor that ordered by it, which is exactly the event a reader would
// then never see.

/**
 * The event types that change something on the Practice Command Centre.
 *
 * DECLARED, not "all of them". s7's feeder matrix names the update triggers card by card, and a stream
 * that pushed every type would make the dashboard re-render on things it does not draw -- which costs a
 * server render per event and teaches the client to ignore the ones that matter.
 */
export const DASHBOARD_EVENTS: PracticeEventType[] = [
  // Start Your Day, Session Status, Today's Timeline, and the scope of everything else.
  "activity.started", "activity.paused", "activity.completed",
  "session.started", "session.paused", "session.resumed", "session.closed",
  // Today at a Glance, Run Your Clinic, Waiting Queue.
  "appointment.created", "appointment.cancelled",
  "patient.checked_in", "queue.entry_created", "queue.entry_status_changed",
  // Current Encounter, Completed, Patients Seen, Practice Performance, the timeline.
  "encounter.created", "encounter.started", "encounter.paused", "encounter.completed",
  "encounter.reopened",
  // Follow-up Intelligence and Operational Alerts.
  "followup.created", "followup.booked", "followup.due", "followup.completed",
  "result.received", "result.reviewed",
  "alert.created", "alert.resolved",
  // Tasks, Messages, Recent Documents.
  "task.created", "task.completed",
  "document.created", "document.signed", "document.issued",
  "message.received",
  // Practice Intelligence.
  "metric.snapshot_created",
];

/**
 * The types NOT streamed, stated so the omission is a decision somebody made rather than a gap.
 * `activity.planned` and `activity.confirmed` change tomorrow's plan, not today's dashboard.
 */
export const NOT_STREAMED: PracticeEventType[] =
  PRACTICE_EVENT_TYPES.filter(t => !DASHBOARD_EVENTS.includes(t));

export type StreamedEvent = {
  id: string;
  eventType: PracticeEventType;
  /** The cursor. ISO, and the value a client sends back as Last-Event-ID is this row's `id`. */
  recordedAt: string;
  occurredAt: string;
  patientId: string | null;
  encounterId: string | null;
  sessionId: string | null;
};

/** How many events one poll may carry. A burst larger than this is drained over successive polls. */
export const STREAM_BATCH = 200;

/**
 * Dashboard-relevant events for one practice, after a cursor.
 *
 * ⚠ SCOPED TO THE WORKSPACE, ALWAYS. s13: "every query must be tenant/practice scoped and practitioner
 * authorised." An event stream is precisely where a missing tenancy filter leaks the shape of another
 * clinic's whole day, and it leaks it continuously rather than once.
 *
 * The error is returned rather than thrown: a stream that throws kills the connection, and a dropped
 * connection looks to the client exactly like a quiet practice.
 */
export async function eventsSince(
  admin: any, ctx: WorkspaceContext, cursor: { recordedAt: string; id: string } | null,
): Promise<{ events: StreamedEvent[]; error: string | null }> {
  let q = admin.from("practice_domain_event")
    .select("id, event_type, recorded_at, occurred_at, patient_id, encounter_id, session_id")
    .eq("workspace_id", ctx.workspaceId)
    .in("event_type", DASHBOARD_EVENTS)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(STREAM_BATCH);

  // STRICTLY AFTER the cursor, and the id breaks the tie. Two events recorded in the same millisecond are
  // ordinary -- a switch closes one session and opens another -- and `gt` on the timestamp alone would
  // drop the second of them forever.
  if (cursor) q = q.or(`recorded_at.gt.${cursor.recordedAt},and(recorded_at.eq.${cursor.recordedAt},id.gt.${cursor.id})`);

  const { data, error } = await q;
  if (error) return { events: [], error: error.message };

  return {
    events: ((data ?? []) as any[]).map(r => ({
      id: r.id,
      eventType: r.event_type,
      recordedAt: r.recorded_at,
      occurredAt: r.occurred_at,
      patientId: r.patient_id ?? null,
      encounterId: r.encounter_id ?? null,
      sessionId: r.session_id ?? null,
    })),
    error: null,
  };
}

/**
 * Stamp events as having reached a live stream (s18 "observable").
 *
 * ⚠ ONLY WHERE published_at IS STILL NULL. Re-stamping would move the timestamp every time a second
 * client connected and replayed the same history, turning "when did this first reach a stream" into
 * "when did somebody last open a laptop".
 *
 * A failure here is REPORTED AND SWALLOWED, never fatal: the event has already been delivered to the
 * client by the time this runs, and failing the stream over a bookkeeping write would drop a working
 * connection to keep a marker tidy.
 */
export async function markPublished(admin: any, ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const { error } = await admin.from("practice_domain_event")
    .update({ published_at: new Date().toISOString() })
    .in("id", ids).is("published_at", null);
  return error ? error.message : null;
}

/** The newest cursor in a batch, or the one we came in with. */
export function advance(
  events: StreamedEvent[], current: { recordedAt: string; id: string } | null,
) {
  const last = events[events.length - 1];
  return last ? { recordedAt: last.recordedAt, id: last.id } : current;
}
