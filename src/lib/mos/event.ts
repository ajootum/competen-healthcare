// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-CORE-MOS-001 §5 — THE OPERATIONAL EVENT EMITTER.
//
// ⚠ THIS FUNCTION MUST NEVER BREAK THE THING IT IS MEASURING. Telemetry sits inside a booking, a save,
// a sign-in. If a write to the event store can throw, then the day the event store is unavailable is
// the day practitioners cannot book — and the observability layer becomes the outage. So `emitEvent`
// catches everything, returns a result, and never rejects. A caller that awaits it and ignores the
// result is behaving correctly.
//
// ⚠ AND IT REFUSES PHI BEFORE THE DATABASE DOES. The table carries a CHECK that rejects known
// patient-identifying keys in metadata, which is the floor. This guard exists above it for two reasons:
// the error a developer sees names the offending key instead of a constraint, and a rejected row is a
// LOST EVENT — the whole write fails, so the operational fact disappears along with the mistake. Better
// to catch it where it can be fixed than to lose the measurement.
//
// The event NAME is checked against the catalogue too. §6 makes the catalogue authoritative precisely
// so a typo cannot become a permanent second series that no query notices is a duplicate.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** §5's outcome vocabulary. `started` is what makes an attempt countable, and therefore a rate formable. */
export type Outcome = "started" | "success" | "failure" | "timeout" | "cancelled";

export const OUTCOMES: Outcome[] = ["started", "success", "failure", "timeout", "cancelled"];

/**
 * CPR-CORE-MOS-001 §7's eight critical journeys.
 *
 * ⚠ MIRRORED FROM THE DATABASE, NOT AUTHORED HERE. mos_journey is the source; this constant exists so
 * TypeScript can name a journey, and the phase 2 harness fails if the two lists ever differ.
 */
export const JOURNEY_KEYS = [
  "sign_in", "open_planner", "patient_booking", "start_encounter",
  "save_encounter", "create_follow_up", "issue_document", "generate_invoice",
] as const;
export type JourneyKey = (typeof JOURNEY_KEYS)[number];

/** §6's minimum event catalogue, mirrored from mos_event_name. Pinned against the database by the harness. */
export const EVENT_NAMES = [
  "practice.access.started", "practice.access.succeeded", "practice.access.failed",
  "practice.planner.opened", "practice.planner.open_failed",
  "practice.booking.started", "practice.booking.created", "practice.booking.failed", "practice.booking.cancelled",
  "practice.encounter.started", "practice.encounter.save_attempted", "practice.encounter.saved",
  "practice.encounter.save_failed", "practice.encounter.completed",
  // ⚠ THE THREE `.attempted` NAMES EXIST BECAUSE §6's CATALOGUE IS NOT UNIFORM. Some of its entries name
  // an ACT (encounter.started, booking.started) and carry all three outcomes on one name; others name a
  // RESULT (followup.created, document.issued, invoice.generated) and cannot — "created, with outcome
  // started" is a sentence nobody should have to reconcile. Without an attempt event those three
  // journeys could record what succeeded and never how often it was tried, which is the missing
  // denominator this substrate exists to supply. Added deliberately by migration 314.
  "practice.followup.attempted",
  "practice.followup.created", "practice.followup.failed", "practice.followup.completed",
  "practice.document.issue_attempted",
  "practice.document.generated", "practice.document.issued", "practice.document.issue_failed",
  "practice.invoice.generate_attempted",
  "practice.invoice.generated", "practice.invoice.generate_failed",
  "practice.sync.started", "practice.sync.completed", "practice.sync.failed", "practice.sync.conflict_detected",
  "practice.communication.queued", "practice.communication.sent", "practice.communication.delivered",
  "practice.communication.failed",
  "practice.ai.requested", "practice.ai.completed", "practice.ai.failed", "practice.ai.timed_out",
  "practice.ai.rate_limited",
  "practice.trial.started", "practice.trial.ended", "practice.entitlement.changed",
  "practice.configuration.proposed", "practice.configuration.approved", "practice.configuration.activated",
  "practice.configuration.failed", "practice.configuration.rolled_back",
  "practice.release.deployed",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Metadata keys that may never appear on an operational event.
 *
 * ⚠ THE SAME LIST THE DATABASE CONSTRAINT HOLDS, and the harness pins them equal. Two copies of a rule
 * that can disagree is worse than one copy in the wrong place, so neither is allowed to drift.
 */
export const FORBIDDEN_METADATA_KEYS = [
  "patient_id", "patient_name", "patient_ref", "mrn", "nhs_number",
  "date_of_birth", "dob", "diagnosis", "medication", "clinical_note",
  "notes", "symptoms", "allergy",
];

export type EmitInput = {
  eventName: EventName;
  /** Null only for an event genuinely not attributable to one Practice, such as a platform deployment. */
  practiceId?: string | null;
  practitionerId?: string | null;
  sessionId?: string | null;
  /** §14 requires it. One id per transaction, reused by every event in that transaction. */
  correlationId: string;
  /** The step WITHIN a journey. The journey itself comes from the catalogue and is never passed here. */
  journeyStep?: string | null;
  component: string;
  outcome: Outcome;
  durationMs?: number | null;
  /** Only meaningful on a failure or a timeout — the database rejects it on anything else. */
  failureCode?: string | null;
  releaseVersion?: string | null;
  subjectType?: string;
  subjectId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to now. Pass it when recording something that happened earlier. */
  occurredAt?: string;
};

export type EmitResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** A correlation id for one transaction. Every event in that transaction carries the same one. */
export const newCorrelationId = (): string => crypto.randomUUID();

export async function emitEvent(admin: Admin, e: EmitInput): Promise<EmitResult> {
  try {
    if (!(EVENT_NAMES as readonly string[]).includes(e.eventName)) {
      return { ok: false, error: `"${e.eventName}" is not in the event catalogue. Add it to mos_event_name deliberately rather than emitting a name nothing aggregates.` };
    }
    if (!e.correlationId) {
      return { ok: false, error: "correlationId is required — an event that cannot be joined to its transaction cannot reconstruct a journey." };
    }
    const meta = e.metadata ?? {};
    const offending = Object.keys(meta).filter(k => FORBIDDEN_METADATA_KEYS.includes(k));
    if (offending.length > 0) {
      return { ok: false, error: `operational metadata may not carry patient-identifying keys — remove ${offending.join(", ")}.` };
    }
    if (e.failureCode && e.outcome !== "failure" && e.outcome !== "timeout") {
      return { ok: false, error: `a failureCode belongs only to a failure or a timeout, not to "${e.outcome}".` };
    }

    const row = {
      event_name: e.eventName,
      occurred_at: e.occurredAt ?? new Date().toISOString(),
      practice_id: e.practiceId ?? null,
      practitioner_id: e.practitionerId ?? null,
      session_id: e.sessionId ?? null,
      correlation_id: e.correlationId,
      journey_step: e.journeyStep ?? null,
      component: e.component,
      outcome: e.outcome,
      duration_ms: e.durationMs ?? null,
      failure_code: e.failureCode ?? null,
      release_version: e.releaseVersion ?? null,
      subject_type: e.subjectType ?? (e.practiceId ? "practice" : "product"),
      subject_id: e.subjectId ?? e.practiceId ?? null,
      metadata: meta,
    };

    const res = await admin.from("mos_event").insert(row).select("event_id").limit(1);
    if (res.error || !res.data?.[0]?.event_id) {
      return { ok: false, error: String(res.error?.message ?? "the event store did not return an id") };
    }
    return { ok: true, eventId: res.data[0].event_id as string };
  } catch (err) {
    // ⚠ THE CATCH IS THE POINT. Whatever went wrong — network, schema, serialization — the caller is
    // in the middle of a booking or a save, and telemetry does not get to fail that.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Attempts and successes for a journey, which is the pair Product Health has never been able to form.
 *
 * ⚠ THE DENOMINATOR IS `started`, NOT THE ROW COUNT. Counting every event of a journey would inflate
 * the base with successes and failures of the same attempt, and the resulting rate would be a number
 * with no meaning that still looked like one.
 */
export async function journeyOutcomes(admin: Admin, journeyKey: JourneyKey, sinceIso: string): Promise<
  { attempts: number; successes: number; failures: number } | null
> {
  const res = await admin.from("mos_journey_event")
    .select("outcome")
    .eq("journey_key", journeyKey)
    .gte("occurred_at", sinceIso);
  if (res.error || !Array.isArray(res.data)) return null;
  const rows = res.data as { outcome: string }[];
  return {
    attempts: rows.filter(r => r.outcome === "started").length,
    successes: rows.filter(r => r.outcome === "success").length,
    failures: rows.filter(r => r.outcome === "failure" || r.outcome === "timeout").length,
  };
}
