/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */
// audit.ts is imported for emitAudited at the foot of this file. It imports NOTHING itself (its own
// header explains why: it is pulled into four client bundles through constant modules), and events.ts
// is server-only -- no client component imports it -- so this costs no browser bundle a byte.
import { audit } from "@/lib/practice/audit";
// CPR-CORE-001 DOMAIN EVENT OUTBOX -- the one place a state change is announced. Migration 233.
//
// s3: "Dashboard summaries update from domain events rather than direct widget-to-database queries."
// Seventeen frozen cards each asking the database its own question is how two cards come to disagree
// about the same number, and why nothing on the page knows that anything changed. s9 gives the
// vocabulary; s9.1 gives the envelope; this module is the writer.
//
// -- WHY A FAILED EMIT DOES NOT FAIL THE WRITE IT DESCRIBES ------------------------------------------
//
// The choice is real and it goes the other way from what "never lose an event" suggests, so the argument
// is written down here rather than assumed.
//
// There is no transaction to join. Every engine in this codebase talks to PostgREST over HTTP, one
// statement per round trip, so the state change and the outbox insert are already two separate commits.
// Making the operation fail on a failed emit therefore CANNOT roll the state change back. It would take
// a clinic that genuinely started and report it as a 500 -- and the practitioner, quite reasonably,
// presses Start again, gets ALREADY_RUNNING, and now believes the system is broken during a clinic.
// The write is not protected by the refusal; only the practitioner's afternoon is spent on it.
//
// The two failures are also not the same size. A lost event costs freshness: s12 mandates a 30-60 second
// polling fallback, so the card repaints within a minute anyway, and because the outbox is derived from
// state (practice_activity.started_at/ended_at remain the record of what happened) a reconciler can
// always find the state changes that have no event and replay them. A lost state change costs the work.
// Degrading the cheap thing to protect the expensive one is the whole trade.
//
// So: emit AFTER the write commits, never before. Never throw. Never swallow silently either -- the
// error is returned, and callers surface it as a warning alongside a successful result, because an
// outbox that has been quietly failing for a week is exactly the sort of thing nobody notices until a
// projection is rebuilt and comes out wrong.

export const PRACTICE_EVENT_TYPES = [
  "activity.planned", "activity.confirmed", "activity.started", "activity.paused", "activity.completed",
  "session.started", "session.paused", "session.resumed", "session.closed",
  "appointment.created", "appointment.cancelled",
  "patient.checked_in",
  "queue.entry_created", "queue.entry_status_changed",
  "encounter.created", "encounter.started", "encounter.paused", "encounter.completed",
  "encounter.reopened",
  "followup.created", "followup.booked", "followup.due", "followup.completed",
  "result.received", "result.reviewed",
  "task.created", "task.completed",
  "document.created", "document.signed", "document.issued",
  "message.received",
  "alert.created", "alert.resolved",
  "metric.snapshot_created",
] as const;
export type PracticeEventType = (typeof PRACTICE_EVENT_TYPES)[number];

/**
 * s9.1's source. The channel the state change arrived through, which s13 requires on every
 * state-changing action.
 */
export const EVENT_SOURCES = ["web", "mobile", "integration", "system"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** The envelope's current version. Bump when a payload key changes meaning, not when one is added. */
export const EVENT_ENVELOPE_VERSION = 1;

/**
 * s9.1, in this build's names.
 *
 * `practiceId` is the workspace id: practice_workspace is the row it points at, and the column is
 * workspace_id for the same reason every other practice table spells it that way.
 */
export type EventEnvelope = {
  eventType: PracticeEventType;
  practiceId: string;
  /** Whose work this is. NOT the actor -- see below. */
  practitionerId: string;
  /** Who caused it. s13: every state-changing action records an actor. */
  actorId: string;
  source: EventSource;
  occurredAt?: Date | string;
  locationId?: string | null;
  activityInstanceId?: string | null;
  sessionId?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  version?: number;
  payload?: Record<string, unknown>;
};

export type EmitResult =
  | { ok: true; eventId: string }
  | { ok: false; code: string; message: string };

const isUuidish = (v: string) => /^[0-9a-fA-F-]{36}$/.test(v);

/**
 * Write one domain event to the outbox.
 *
 * NEVER THROWS, and that is load-bearing rather than defensive habit: this is called after a clinical
 * or operational write has already committed, and an exception escaping here would turn a completed
 * operation into a 500 that the caller cannot undo. A transport failure -- a dropped connection, a TLS
 * interception that breaks fetch -- REJECTS rather than returning `{ error }`, so the try/catch is
 * catching a real failure mode and not an imaginary one.
 *
 * NEVER DISCARDS THE ERROR EITHER. Every failure comes back with a code and a message for the caller to
 * report. A silent `.catch(() => {})` here would have been two lines shorter and would have made a
 * broken outbox indistinguishable from a quiet practice.
 */
export async function emitEvent(admin: any, envelope: EventEnvelope): Promise<EmitResult> {
  // Validated before the round trip, because the database's answer to a bad envelope is a constraint
  // violation whose message names a column rather than the thing the caller got wrong.
  if (!PRACTICE_EVENT_TYPES.includes(envelope.eventType))
    return { ok: false, code: "UNKNOWN_EVENT_TYPE", message: `${envelope.eventType} is not in the s9 catalogue` };
  if (!EVENT_SOURCES.includes(envelope.source))
    return { ok: false, code: "UNKNOWN_SOURCE", message: `${envelope.source} is not a source` };

  // AN EVENT WITHOUT AN ACTOR IS NOT AN AUDITABLE EVENT (s13), and an event without a practitioner
  // belongs to no dashboard. Refused here rather than defaulted: defaulting the actor to the subject is
  // the exact fiction that makes a delegated action look like the practitioner's own.
  if (!envelope.actorId || !isUuidish(envelope.actorId))
    return { ok: false, code: "ACTOR_REQUIRED", message: "an event must carry the actor who caused it" };
  if (!envelope.practitionerId || !isUuidish(envelope.practitionerId))
    return { ok: false, code: "PRACTITIONER_REQUIRED", message: "an event must say whose work it is" };
  if (!envelope.practiceId || !isUuidish(envelope.practiceId))
    return { ok: false, code: "PRACTICE_REQUIRED", message: "an event must be scoped to a practice" };

  const occurredAt = envelope.occurredAt
    ? (envelope.occurredAt instanceof Date ? envelope.occurredAt.toISOString() : envelope.occurredAt)
    : new Date().toISOString();

  try {
    const { data, error } = await admin.from("practice_domain_event").insert({
      workspace_id: envelope.practiceId,
      event_type: envelope.eventType,
      version: envelope.version ?? EVENT_ENVELOPE_VERSION,
      occurred_at: occurredAt,
      practitioner_id: envelope.practitionerId,
      actor_id: envelope.actorId,
      source: envelope.source,
      location_id: envelope.locationId ?? null,
      activity_instance_id: envelope.activityInstanceId ?? null,
      session_id: envelope.sessionId ?? null,
      patient_id: envelope.patientId ?? null,
      encounter_id: envelope.encounterId ?? null,
      payload: envelope.payload ?? {},
      // published_at is left null on purpose. The dispatcher has not been built (CORE-09's stream half),
      // and marking a row delivered at insert time would hand the first real dispatcher an empty backlog
      // and a week of events nobody ever sent.
    }).select("id").maybeSingle();

    if (error) return { ok: false, code: "EMIT_FAILED", message: error.message };
    if (!data) return { ok: false, code: "EMIT_FAILED", message: "the event was not written" };
    return { ok: true, eventId: data.id };
  } catch (e) {
    return { ok: false, code: "EMIT_THREW", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Emit several events and collect the failures as sentences a caller can pass back to a screen.
 *
 * SEQUENTIAL AND NEVER SHORT-CIRCUITED. When switching activity emits a close and a start, the close
 * failing must not cost the start: they describe two different writes that both already happened, and
 * an outbox missing only the second one is worse than an outbox missing both, because a projection
 * would then read a session that never ended.
 */
export async function emitEvents(admin: any, envelopes: EventEnvelope[]): Promise<string[]> {
  const warnings: string[] = [];
  for (const envelope of envelopes) {
    const result = await emitEvent(admin, envelope);
    if (!result.ok) warnings.push(`${envelope.eventType}: ${result.code} ${result.message}`);
  }
  return warnings;
}

// ── WHAT NOTHING EMITS, AND WHY ─────────────────────────────────────────────────────────────────────
//
// ⚠ THE CATALOGUE HAD THIRTY-FOUR TYPES AND TWELVE PRODUCERS, AND NOTHING ANYWHERE SAID SO. Every one
// of the other twenty-two read, from this file, as a thing the product announces. DASHBOARD_EVENTS then
// declared thirty-two of the thirty-four as triggers the Command Centre re-renders on -- so twenty of
// its declared triggers could never fire, and the page fell back to its 30-60 second poll for
// appointments, check-in, the queue, results, tasks, documents and messages. It worked, slowly, which is
// precisely why nobody found it.
//
// Sixteen of the twenty-two are now emitted. THESE SIX ARE NOT, and each is here
// with the reason rather than left to look like the same oversight the other seventeen were. This is
// NOT_STREAMED's idea applied to production instead of consumption: an omission somebody decided beats
// an omission somebody has to rediscover.
//
// ⚠ ADDING A KEY HERE IS NOT A WAY TO SILENCE THE COVERAGE HARNESS. It is a claim that no state change
// exists in the product, and scripts/practice-event-coverage-harness.ts asserts the claim from the
// other side: it fails if a type listed here turns out to have an emit site after all.
export const NO_PRODUCER: Readonly<Record<string, string>> = {
  // No activity is ever confirmed. planActivity writes a plan and startActivity runs it; there is no
  // intermediate acceptance step in the lifecycle, in the engine or in migration 232's columns.
  "activity.confirmed":
    "the activity lifecycle has no confirm step -- a block is planned, then started",
  // ⚠ THIS ONE WAS ALREADY A DECISION, WRITTEN DOWN, AND IT IS NOT AN OVERSIGHT TO CORRECT.
  // activity.ts's pauseEvents() explains it in full: the catalogue has `activity.paused` and NO
  // `activity.resumed`, so emitting the activity half of a pause would announce a stop that no event
  // in this vocabulary can ever announce the end of, and a projection built on it would show every
  // paused session as permanently stopped -- correctly, on the evidence it was given. The session half
  // IS a matched pair (session.paused / session.resumed) and is what gets emitted. The session and the
  // activity are the same row in this build, so nothing is lost.
  //
  // Closing this properly means adding activity.resumed to the catalogue, which is a schema change to
  // migration 233's CHECK and not a wiring job.
  "activity.paused":
    "deliberate -- the catalogue has no activity.resumed, so the pair would be unclosable; session.paused/resumed carries it (see pauseEvents in activity.ts)",

  // Due-ness is DERIVED, not stored. FOLLOW_UP_DUE_STATES (overdue / due_today / due_this_week /
  // upcoming / draft / closed) is computed from due_on against the practice's today, every read.
  // FOLLOW_UP_TRANSITIONS has no DUE state to move to, so there is no moment to announce -- and a
  // nightly job that emitted one would be announcing the calendar, not a change anybody made.
  "followup.due":
    "a follow-up becomes due by the date arriving, not by anybody changing it -- FOLLOW_UP_DUE_STATES is derived from due_on at read time",

  // There is no alert substrate. No practice_alert table exists in any migration, and no engine in
  // src/lib/practice raises or resolves one. The Command Centre's Operational Alerts are computed from
  // the underlying records each render. Emitting these would require inventing the feature first.
  "alert.created": "no alert record exists -- there is no practice_alert table and no engine that raises one",
  "alert.resolved": "no alert record exists -- see alert.created",

  // Metrics are computed live by practiceMetrics on every read and never stored, so no snapshot is ever
  // taken. This is a deliberate property of that engine, not a gap in it: a stored figure and a
  // recomputed one disagree the moment the underlying rows change.
  "metric.snapshot_created": "practiceMetrics computes on read and stores nothing -- no snapshot is ever created",
};

/**
 * Emit, and put the failure somewhere a person will find it.
 *
 * ⚠ THIS EXISTS BECAUSE OF THE SHAPE OF THE CALL SITES, NOT BECAUSE WARNINGS ARE UNIMPORTANT. The three
 * engines that emitted before this all had somewhere to put `eventWarnings`: activity.ts and
 * encounters.ts return them alongside a success, and a screen can say "it happened, the outbox did not
 * hear about it". Seventeen new emit sites sit in functions whose return shapes are read by hundreds of
 * callers, and widening all of them to carry a warning nobody renders would be a large change that buys
 * a string nobody looks at.
 *
 * The alternative was `await emitEvents(...)` with the result dropped, which is what follow-ups.ts does
 * today -- and that makes a broken outbox indistinguishable from a quiet practice, the exact failure
 * emitEvent's own header refuses to allow.
 *
 * So the failure goes to the audit trail: durable, queryable, already scoped to the workspace, and the
 * one place somebody investigating "why has the dashboard not moved since Tuesday" would actually look.
 * The audit write is the LAST thing and its own failure is swallowed by audit() (which logs), because a
 * failure to record a failure must not become a third failure.
 *
 * NEVER THROWS and never fails the caller: like emitEvents, this runs after a write has committed.
 */
export async function emitAudited(
  admin: any, envelopes: EventEnvelope[], correlationId?: string,
): Promise<string[]> {
  const warnings = await emitEvents(admin, envelopes);
  if (warnings.length > 0) {
    await audit(admin, {
      workspaceId: envelopes[0]?.practiceId ?? null,
      actorId: envelopes[0]?.actorId ?? null,
      eventType: "practice.event_emit_failed",
      payload: { types: envelopes.map(e => e.eventType), warnings },
      correlationId,
    });
  }
  return warnings;
}
