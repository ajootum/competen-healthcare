// COMP-SYNC-001 s5 (Transaction Event Model) + CP-OFFLINE-SURVEY-001 s5 — PHASE TWO, THE TRANSACTION
// OUTBOX. The record, the state machine, the backoff and the escalation.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ NOTHING IN PHASE TWO MAY ACCEPT A WRITE UNTIL ALL SEVEN PRECONDITIONS HOLD. THIS MODULE IS ONE OF
// THEM AND IT IS INERT ON ITS OWN.
//
// The survey states the line in one sentence: "A client that accepts a write it cannot later deliver has
// taken a clinical record and destroyed it -- and destroyed it silently, which is the part that matters."
// A crashed app loses a note VISIBLY and the practitioner rewrites it. A queued note that never syncs is
// BELIEVED SAVED by the only person who could rewrite it, and that belief suppresses the paper backup a
// practitioner in an intermittent clinic would otherwise have kept.
//
// So this file builds the queue and NOTHING calls it yet. No screen, no form, no engine. The seven:
//   0. local re-authentication            NOT BUILT
//   1. durable local persistence          this module + outbox-store.ts
//   2. per-record pending/syncing/FAILED  this module
//   3. idempotent server acceptance       schema exists (practice_domain_event), endpoints NOT BUILT
//   4. bounded failure that ESCALATES     this module
//   5. a conflict surface                 NOT BUILT
//   6. export for the undeliverable       this module (the shape) + a screen, NOT BUILT
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE RULE THAT DECIDES THE ARCHITECTURE: THE OUTBOX IS EXEMPT FROM EXPIRY. FULL STOP.
//
// The user's decision of 2026-08-08, and it is the difference between a cache and a record:
//
//   Expiry governs a cached COPY of server data. The server still holds that, so expiring it loses
//   ACCESS, not data. Data the practitioner CAPTURED offline is THE ONLY COPY IN EXISTENCE. It must
//   never be expired by a timer, purged on revocation, or dropped on flag-off.
//
// ⚠ And the warning that came with it: "the obvious implementation is one purge routine over one local
// database, and the obvious implementation would delete both." That is now a live hazard rather than a
// hypothetical -- `purgeAllOffline()` in offline-store.ts calls `indexedDB.deleteDatabase(...)`, which on
// a shared database would destroy captured clinical notes on sign-out.
//
// THEREFORE: THE OUTBOX LIVES IN ITS OWN INDEXEDDB DATABASE, not in a new object store beside the
// caches. A separate database cannot be caught by a `deleteDatabase` aimed at the other one, and the
// separation is structural rather than a rule somebody has to remember. See outbox-store.ts.

/** Bumped when the record shape below changes. ⚠ Unlike a cache, an outbox record is NEVER discarded
 *  for being from an older schema -- it is the only copy. It is marked for a human instead. */
export const OUTBOX_SCHEMA_VERSION = 1;

// ── THE STATE MACHINE ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ SIX STATES, AND THE SPLIT THAT MATTERS IS `failed` vs `refused` vs `undeliverable`.
//
// Precondition 2 says the visible states are "pending / syncing / FAILED -- the third is the one that
// matters and the one most implementations render as the second". Retrying forever renders as syncing
// and reads as progress. So a transaction that is not going to succeed must LEAVE the retry loop and
// say so.
//
//   pending        accepted locally, waiting for a connection. The normal resting state.
//   sending        an upload is in flight for this record right now.
//   delivered      the server acknowledged it. ⚠ The only state in which the local copy is redundant.
//   failed         the attempt did not complete and MAY succeed later -- no connection, a timeout, a 5xx.
//                  Retried with backoff. Still counts as work in hand.
//   refused        ⚠ the server understood it and said no (a validation error, a permission refusal).
//                  RETRYING CANNOT HELP. Retrying a refusal is how a queue hides a loss behind activity.
//   undeliverable  it can never be applied as written -- the patient was merged, the encounter signed,
//                  the device revoked. ⚠ Precondition 6: it must be EXPORTABLE AND READABLE BY A HUMAN,
//                  never discarded. COMP-OFF-001 Principle 4: "No accepted user action shall be
//                  silently discarded."
export type OutboxState =
  | "pending" | "sending" | "delivered" | "failed" | "refused" | "undeliverable"
  /**
   * ⚠ SEPARATE FROM `refused`, AND THE DIFFERENCE IS THAT THIS ONE HAS A WAY OUT.
   *
   * A refusal means the practice will not take this, ever, as written. A conflict means somebody else
   * changed the record while the practitioner was away, so BOTH values are valid work and a person has
   * to choose. Collapsing them would present a solvable problem as a dead end -- and the practitioner
   * would stop looking at the queue.
   */
  | "conflicted";

/** The states in which the record still holds work nobody has dealt with. Drives the pending counter. */
export const OUTBOX_UNRESOLVED: readonly OutboxState[] = ["pending", "sending", "failed"] as const;

/** ⚠ The states that need a PERSON, not a retry. These are what the queue must shout about. */
export const OUTBOX_NEEDS_A_HUMAN: readonly OutboxState[] = ["refused", "undeliverable", "conflicted"] as const;

/** ⚠ `delivered` is the ONLY state in which the local copy may be removed. Asserted by the harness. */
export const OUTBOX_SAFE_TO_REMOVE: readonly OutboxState[] = ["delivered"] as const;

export type OutboxOperation = "create" | "update" | "delete";

/**
 * COMP-SYNC-001 s5's transaction event, field for field.
 *
 * ⚠ THE ID IS GENERATED ON THE CLIENT AND IS THE IDEMPOTENCY KEY. Precondition 3: "a retry must not
 * create a second encounter". The server records this id and a repeat returns the original outcome
 * rather than applying it twice. A server-generated id could not do that -- by the time the client
 * learns it, the thing it identifies has already happened, which is exactly the case a retry is for.
 */
export type OutboxRecord = {
  schemaVersion: number;
  /** COMP-SYNC-001 s5 "globally unique transaction ID (UUID)". Generated at accept time, never reused. */
  id: string;
  workspaceId: string;
  /** s5 "device ID". The cookie value already used by practice_session, not a fingerprint. */
  deviceId: string;
  userId: string;
  /** s5 "entity type and entity identifier". */
  entityType: string;
  /** The entity's own UUID, generated on the client for a `create` so it is stable before it syncs. */
  entityId: string;
  operation: OutboxOperation;
  /** s5 "payload (delta where possible)". Opaque here -- this module never interprets it. */
  payload: unknown;
  /**
   * s5 "version number". The version the practitioner was looking at when they acted -- the basis for
   * optimistic concurrency (COMP-SYNC-001 s8), and the house convention already: `expectedVersion` and
   * a 409 VERSION_CONFLICT. Null for a create, which has no prior version.
   */
  baseVersion: number | null;
  /** s5 "sequence number". Monotonic per device. ⚠ ORDER IS A CORRECTNESS PROPERTY -- see below. */
  sequence: number;
  /** When the practitioner acted. ⚠ Not when it synced -- the record must carry the clinical instant. */
  createdAt: string;
  state: OutboxState;
  /** s5 "retry count". */
  attempts: number;
  /** s5 "last error", in words a person can read. Null before the first failure. */
  lastError: string | null;
  lastAttemptAt: string | null;
  /** When it stopped being a retry problem and became somebody's problem. Null until it escalates. */
  escalatedAt: string | null;
  /**
   * ⚠ PRESENT ONLY WHEN `state === "conflicted"`. COMP-CONF-001 s6: "preserve both values until
   * resolved". `payload` above is what the practitioner recorded; this is what the practice held when
   * the upload was refused. The device is the only place both sides exist -- the ledger deliberately
   * stores no clinical payload -- so losing this loses the comparison.
   */
  conflict?: {
    currentVersion: number | null;
    theirs: Record<string, unknown>;
    labels: Record<string, string>;
    insignificant: string[];
    /** Recorded when a person settles it. ⚠ Kept on the record, never replaced by the outcome. */
    decision?: { resolution: string; reason: string; decidedAt: string };
  };
};

// ── ORDERING ────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ COMP-SYNC-001 s9 requires "ordered event processing" and it is not a nicety: an update to an
// encounter that arrives before the create that made it refers to a row the server does not have. The
// sequence number is assigned AT ACCEPT TIME and never renumbered, so the order the practitioner worked
// in is the order the server sees, whatever order the retries happen to complete in.
//
// ⚠ CP-SYNC-001 s4's ENTITY ORDER (configuration, patients, appointments, encounters, ... attachments)
// is a DIFFERENT thing and is deliberately not implemented here as a sort. Sorting a queue by entity
// type would reorder one practitioner's own actions -- registering a patient, then editing them, then
// registering another -- and break the causality the sequence exists to preserve. The entity order
// matters for a FULL first sync, where there is no causal history to preserve, and that is where it
// belongs.

/** The queue, in the order it must be sent. Stable, and independent of how the records were stored. */
export function outboxSendOrder(records: OutboxRecord[]): OutboxRecord[] {
  return [...records].sort((a, b) => a.sequence - b.sequence);
}

/**
 * ⚠ A BLOCKED RECORD BLOCKS ITS SUCCESSORS ON THE SAME ENTITY, AND ONLY THOSE.
 *
 * If a create is `refused`, every later update to that same entity is unsendable -- the row it edits will
 * never exist. Sending them anyway produces a cascade of confusing server errors that bury the one real
 * failure. But a refusal on ONE patient must not stop another patient's encounter syncing, which is what
 * a single global "stop on first error" would do, and that is how a whole day's work stays stuck behind
 * one bad row.
 */
export function outboxSendable(records: OutboxRecord[]): OutboxRecord[] {
  const blocked = new Set<string>();
  for (const r of outboxSendOrder(records))
    if (OUTBOX_NEEDS_A_HUMAN.includes(r.state)) blocked.add(`${r.entityType}:${r.entityId}`);
  return outboxSendOrder(records)
    .filter(r => r.state === "pending" || r.state === "failed")
    .filter(r => !blocked.has(`${r.entityType}:${r.entityId}`));
}

/** Records held back because an earlier change to the same entity needs a person. Never silent. */
export function outboxBlocked(records: OutboxRecord[]): OutboxRecord[] {
  const blocked = new Set<string>();
  for (const r of outboxSendOrder(records))
    if (OUTBOX_NEEDS_A_HUMAN.includes(r.state)) blocked.add(`${r.entityType}:${r.entityId}`);
  return outboxSendOrder(records)
    .filter(r => (r.state === "pending" || r.state === "failed") && blocked.has(`${r.entityType}:${r.entityId}`));
}

// ── BOUNDED FAILURE (precondition 4) ────────────────────────────────────────────────────────────────
//
// ⚠ "After N attempts or T hours, the queue must SHOUT -- not retry forever in silence. This is the
// single most-skipped requirement in offline builds and the one that converts a delay into a loss."
//
// Both limits exist because they catch different failures. ATTEMPTS catches a record the server keeps
// rejecting while the device is online and busy. TIME catches a device that is simply never online: it
// could sit at one attempt for a fortnight and, on an attempts-only rule, never escalate at all -- which
// is precisely the four-day-trip case this programme is for.

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;

/** COMP-SYNC-001 s9 "retry with exponential backoff", capped so a long queue keeps making progress. */
export const OUTBOX_BACKOFF_BASE_MS = 30_000;
export const OUTBOX_BACKOFF_CAP_MS = 30 * 60 * 1000;

export function outboxBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(OUTBOX_BACKOFF_CAP_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

/** Whether enough time has passed since the last attempt to try this one again. */
export function outboxDueAt(record: OutboxRecord): number {
  if (!record.lastAttemptAt) return 0;
  return Date.parse(record.lastAttemptAt) + outboxBackoffMs(record.attempts);
}

/**
 * ⚠ THE ESCALATION TEST, AND IT IS DELIBERATELY NOT A STATE CHANGE.
 *
 * An escalated record stays `failed` and stays in the retry loop -- if the connection comes back it
 * should still go. What changes is that it is now ALSO somebody's problem, and the screen must say so.
 * Moving it to a terminal state would be the product deciding, on a timer, that a practitioner's note is
 * not worth trying again.
 */
export function outboxShouldEscalate(record: OutboxRecord, now: Date): boolean {
  if (record.state !== "failed") return false;
  if (record.escalatedAt) return false;
  if (record.attempts >= OUTBOX_MAX_ATTEMPTS) return true;
  return now.getTime() - Date.parse(record.createdAt) >= OUTBOX_ESCALATE_AFTER_MS;
}

/** Everything a person has to be told about, in the order of how loudly. */
export function outboxNeedingAttention(records: OutboxRecord[], now: Date): OutboxRecord[] {
  return outboxSendOrder(records).filter(r =>
    OUTBOX_NEEDS_A_HUMAN.includes(r.state) || !!r.escalatedAt || outboxShouldEscalate(r, now));
}

// ── TRANSITIONS ─────────────────────────────────────────────────────────────────────────────────────
//
// Pure. Each returns a NEW record; nothing here mutates, so a caller cannot half-apply a transition and
// leave a record in a state no rule produced.

export function outboxEnqueue(args: {
  id: string; workspaceId: string; deviceId: string; userId: string;
  entityType: string; entityId: string; operation: OutboxOperation;
  payload: unknown; baseVersion: number | null; sequence: number; at: Date;
}): OutboxRecord {
  return {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    id: args.id, workspaceId: args.workspaceId, deviceId: args.deviceId, userId: args.userId,
    entityType: args.entityType, entityId: args.entityId, operation: args.operation,
    payload: args.payload, baseVersion: args.baseVersion, sequence: args.sequence,
    createdAt: args.at.toISOString(),
    state: "pending", attempts: 0, lastError: null, lastAttemptAt: null, escalatedAt: null,
  };
}

export function outboxMarkSending(record: OutboxRecord, now: Date): OutboxRecord {
  return { ...record, state: "sending", lastAttemptAt: now.toISOString() };
}

export function outboxMarkDelivered(record: OutboxRecord): OutboxRecord {
  return { ...record, state: "delivered", lastError: null };
}

/**
 * A transient failure. ⚠ `attempts` increments HERE and nowhere else, so the backoff and the escalation
 * count the same thing.
 */
export function outboxMarkFailed(record: OutboxRecord, error: string, now: Date): OutboxRecord {
  const next: OutboxRecord = {
    ...record, state: "failed", attempts: record.attempts + 1,
    lastError: error.slice(0, 500), lastAttemptAt: now.toISOString(),
  };
  return outboxShouldEscalate(next, now) ? { ...next, escalatedAt: now.toISOString() } : next;
}

/**
 * The server understood and said no. ⚠ IT LEAVES THE RETRY LOOP IMMEDIATELY and is escalated at once --
 * there is nothing to wait for, and a refusal that sits quietly accruing attempts is a loss with a
 * progress bar on it.
 */
export function outboxMarkRefused(record: OutboxRecord, reason: string, now: Date): OutboxRecord {
  return {
    ...record, state: "refused", attempts: record.attempts + 1,
    lastError: reason.slice(0, 500), lastAttemptAt: now.toISOString(), escalatedAt: now.toISOString(),
  };
}

/**
 * Somebody else changed the record first.
 *
 * ⚠ IT DOES NOT INCREMENT `attempts`. A conflict is not a failed attempt -- the upload arrived, was
 * understood and was answered. Counting it would push a solvable problem toward the attempt ceiling and
 * escalate it as though the connection were bad.
 */
export function outboxMarkConflict(
  record: OutboxRecord, reason: string, detail: NonNullable<OutboxRecord["conflict"]>, now: Date,
): OutboxRecord {
  return {
    ...record, state: "conflicted", lastError: reason.slice(0, 500),
    lastAttemptAt: now.toISOString(), escalatedAt: now.toISOString(), conflict: detail,
  };
}

/** It can never be applied as written. Kept, exportable, and never deleted by anything automatic. */
export function outboxMarkUndeliverable(record: OutboxRecord, reason: string, now: Date): OutboxRecord {
  return {
    ...record, state: "undeliverable", lastError: reason.slice(0, 500), escalatedAt: now.toISOString(),
  };
}

/**
 * ⚠ THE ONLY WAY BACK INTO THE QUEUE FROM A TERMINAL STATE IS A PERSON ASKING FOR IT.
 *
 * CP-OFF-UI-001 s6 wants a "retry synchronization option" and s7 a "retry failed items". This is that,
 * and it is a deliberate act: the attempt count is reset so the retry gets a fair run, and `escalatedAt`
 * is cleared so it can escalate again rather than being permanently marked. What is NOT cleared is
 * `lastError` -- the history of why it failed belongs to the record.
 */
export function outboxRetryByHand(record: OutboxRecord): OutboxRecord {
  if (record.state === "delivered") return record;
  return { ...record, state: "pending", attempts: 0, escalatedAt: null };
}

// ── WHAT MAY BE REMOVED, AND WHEN ───────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS THE FUNCTION THE EXEMPTION LIVES IN. Everything else in the offline programme deletes on a
// timer; this one refuses to. It takes no clock argument AT ALL, so an expiry cannot be added to it
// without changing the signature -- which is a change somebody has to justify rather than slip in.

export function outboxRemovable(records: OutboxRecord[]): OutboxRecord[] {
  return records.filter(r => OUTBOX_SAFE_TO_REMOVE.includes(r.state));
}

/**
 * ⚠ THE ASSERTION THE HARNESS EXISTS FOR: nothing not yet delivered may be removed, for any reason --
 * not age, not a revoked device, not a switched-off flag, not a sign-out.
 */
export function outboxWouldLoseWork(records: OutboxRecord[], removing: string[]): OutboxRecord[] {
  const ids = new Set(removing);
  return records.filter(r => ids.has(r.id) && r.state !== "delivered");
}

// ── WHAT A PERSON IS TOLD ───────────────────────────────────────────────────────────────────────────

export type OutboxSummary = {
  /** CP-SYNC-001 s7's "pending synchronization counter". */
  unresolved: number;
  pending: number;
  sending: number;
  failed: number;
  /** ⚠ Counted separately from `failed` because it is a different sentence to a person. */
  needsAttention: number;
  /** Null when nothing has ever been delivered -- ⚠ never rendered as "never synced" without knowing. */
  lastDeliveredAt: string | null;
  sentence: string;
};

/**
 * ⚠ EVERY SENTENCE HERE MUST BE TRUE TODAY, and the one that must never appear is "saved" on its own.
 * COMP-SYNC-001 s4 step 6 says the UI shows "Saved locally" -- LOCALLY is load-bearing and is never
 * dropped, because "Saved" is what a practitioner reads as "the practice has it".
 */
export function outboxSummary(records: OutboxRecord[], now: Date): OutboxSummary {
  const by = (s: OutboxState) => records.filter(r => r.state === s).length;
  const attention = outboxNeedingAttention(records, now).length;
  const delivered = records.filter(r => r.state === "delivered" && r.lastAttemptAt)
    .map(r => r.lastAttemptAt as string).sort();
  const unresolved = records.filter(r => OUTBOX_UNRESOLVED.includes(r.state)).length;

  const sentence =
    attention > 0
      ? `${attention} ${attention === 1 ? "item needs" : "items need"} your attention: ${attention === 1 ? "it has" : "they have"} not reached the practice and will not without you. Nothing has been deleted.`
      : unresolved > 0
        ? `${unresolved} ${unresolved === 1 ? "item is" : "items are"} saved on this device and waiting to reach the practice.`
        : "Everything recorded on this device has reached the practice.";

  return {
    unresolved, pending: by("pending"), sending: by("sending"), failed: by("failed"),
    needsAttention: attention,
    lastDeliveredAt: delivered.length ? delivered[delivered.length - 1] : null,
    sentence,
  };
}

/** The per-record line CP-SYNC-001 s7 requires. ⚠ `failed` never renders as `sending`. */
export function outboxRecordLabel(record: OutboxRecord): { label: string; detail: string | null } {
  switch (record.state) {
    case "pending": return { label: "Saved on this device", detail: "Waiting for a connection to the practice." };
    case "sending": return { label: "Sending", detail: null };
    case "delivered": return { label: "At the practice", detail: null };
    case "failed": return {
      label: record.escalatedAt ? "Not sent — needs you" : "Not sent yet",
      detail: record.lastError ? `Last attempt: ${record.lastError}` : "The last attempt did not get through.",
    };
    case "refused": return {
      label: "The practice refused this",
      detail: record.lastError ? `${record.lastError} Retrying will not change this on its own.` : "Retrying will not change this on its own.",
    };
    case "conflicted": return {
      label: "Someone else changed this",
      detail: record.lastError
        ? `${record.lastError} Both values are kept until you decide.`
        : "The practice changed while you were offline. Both values are kept until you decide.",
    };
    case "undeliverable": return {
      label: "Cannot be filed as written",
      detail: record.lastError ? `${record.lastError} It is kept here and can be exported.` : "It is kept here and can be exported.",
    };
  }
}
