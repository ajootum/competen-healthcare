import type { WorkspaceContext } from "@/lib/practice/access";
import {
  MEASUREMENT_ENTITY_TYPE, parameterMeasurementApplier,
} from "@/lib/practice/sync-appliers/parameter-measurement";

// CP-OFFLINE-SURVEY-001 s5 precondition 3 (IDEMPOTENT SERVER ACCEPTANCE) — the apply side, over
// migration 284's practice_sync_transaction. COMP-SYNC-001 s4/s5/s9, CP-SYNC-001 s3/s6.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHAT THIS GUARANTEES, AND IT IS ONE SENTENCE: SENDING THE SAME TRANSACTION TWICE CHANGES NOTHING
// THE SECOND TIME, AND ANSWERS THE SAME WAY IT ANSWERED THE FIRST.
//
// The failure it exists to prevent is not exotic. A device uploads an encounter, the server commits, the
// connection dies before the response arrives. From the device nothing happened, so it retries. Without
// the ledger the patient now has two consultations for one visit, and nobody can tell which is real.
//
// ⚠ THE LEDGER IS CONSULTED BEFORE THE APPLY AND WRITTEN AFTER IT, AND THE ORDER IS NOT NEGOTIABLE. A
// row written first would claim an outcome that had not happened yet, so a crash between the two would
// leave a transaction recorded as applied that never was -- and a retry would be told "already done" and
// discard the only copy. Recording after means a crash leaves it UNRECORDED, the retry re-applies, and
// the worst case is the duplicate the entity-level version check then catches. Wrong in the safe
// direction.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE APPLIER REGISTRY IS EMPTY, AND THAT IS THE HONEST STATE RATHER THAN AN UNFINISHED ONE.
//
// An applier turns one uploaded transaction into a real row. Nothing in this product captures offline
// yet -- s5's line is uncrossed, `outboxAccept` has no callers, and the outbox harness asserts it. So
// every applier written today would be a write path with no producer: speculative code, untestable
// against a real payload, and a new way into the patient record that nothing exercises.
//
// APPLIERS ARRIVE WITH THEIR CAPTURE SCREENS, one entity at a time, each with the conflict semantics its
// own data needs. Until then an upload of any entity type is REFUSED BY NAME, which is a true answer, and
// the harness proves the mechanics by registering its own applier rather than by shipping one.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped, as
   everywhere in src/lib/practice. */

export const SYNC_TABLE = "practice_sync_transaction";
export const SYNC_MIGRATION = "284-sync-transaction-ledger";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ RETENTION: THE LEDGER IS NEVER PURGED, AND THAT IS A DECISION TAKEN ON 2026-08-11, NOT AN OMISSION.
//
// Migration 284 shipped with retention unset and flagged as open. It was then argued the other way and
// settled: THERE IS NO PROVABLY SAFE WINDOW.
//
//   Deleting a row RESTORES THE DUPLICATE IT WAS PREVENTING. The whole value of this table is that a
//   transaction id it has seen can never be applied twice. The outbox is exempt from expiry by the
//   user's decision of 2026-08-08, so a device may hold an unsent transaction indefinitely -- there is
//   no age at which a retry becomes impossible, only ages at which it becomes unlikely.
//
//   And the cost of keeping it is small. A row is a few hundred bytes with no clinical payload (284
//   deliberately stores none). A practice at a thousand transactions a day is about 70 MB a year, on a
//   table with three indexes and no joins.
//
// ⚠ WHEN TO REVISIT, so this is a decision with a trigger rather than a shrug: if a single practice ever
// exceeds roughly ten million rows, or the table's index bloat starts showing in the status query, the
// answer is ARCHIVAL -- move old rows somewhere a lookup can still reach them -- and NOT deletion. A
// transaction id that cannot be found is a transaction that can be applied again.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** COMP-SYNC-001 s5. What the device uploads, one per accepted action. */
export type SyncTransaction = {
  id: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  operation: "create" | "update" | "delete";
  payload: unknown;
  baseVersion: number | null;
  clientSequence: number;
  /** When the practitioner acted, which may be days before this upload. */
  occurredAt: string;
  payloadHash?: string | null;
};

/** The three verdicts migration 284 admits. There is no `pending` -- see the migration for why. */
export type SyncStatus = "applied" | "refused" | "conflict";

export type SyncVerdict = {
  id: string;
  /** ⚠ The PERSISTED vocabulary, and only three values because migration 284 admits only three. */
  status: SyncStatus;
  /** The version the record settled at. Null for a delete, and for anything not applied. */
  appliedVersion: number | null;
  errorCode: string | null;
  /** ⚠ In words a practitioner can read. The database refuses a blank one. */
  errorMessage: string | null;
  /** True when this was already in the ledger and no work was repeated. */
  duplicate: boolean;
  /**
   * ⚠⚠ NOT PERSISTED, AND IT IS THE MOST IMPORTANT FIELD ON THIS TYPE.
   *
   * `refused` in outbox-model.ts means THE SERVER UNDERSTOOD AND SAID NO -- it leaves the retry loop and
   * escalates at once, because retrying a refusal is how a queue hides a loss behind a progress bar.
   *
   * But some things this engine cannot complete are TRANSIENT: the ledger would not read, the applier
   * threw halfway. Those must come back as work still in hand, or the device abandons a real
   * consultation over a database blip. The ledger has no row for them (there is no verdict to record),
   * so this flag is how the route tells the client to mark it `failed` -- retried with backoff -- rather
   * than `refused`.
   *
   * ⚠ THE TWO VOCABULARIES ARE NOT THE SAME AND CONFLATING THEM LOSES WORK. Asserted by the harness.
   */
  retryable: boolean;
  /**
   * ⚠ PRESENT ONLY ON A CONFLICT, AND NEVER PERSISTED. COMP-CONF-001 s6 second rule: "preserve both
   * values until resolved". The device holds `mine`; this is the other side, sent back so the device can
   * build the comparison. It is not written to the ledger -- migration 284 keeps clinical payloads out
   * of it on purpose, and this is a clinical payload.
   */
  conflict?: {
    currentVersion: number | null;
    theirs: Record<string, unknown>;
    labels: Record<string, string>;
    insignificant: string[];
  };
};

/**
 * What an applier must do. It receives ONE transaction and either changes the world or explains why not.
 *
 * ⚠ AN APPLIER MUST BE THE SAME WRITE PATH THE ONLINE PRODUCT USES, not a second one. A parallel writer
 * that skips the engine skips its validation, its audit and its events -- and the offline path would then
 * be the lenient way into the record. Wrap the engine function, do not reimplement it.
 */
export type SyncApplier = (
  admin: any, ctx: WorkspaceContext, tx: SyncTransaction,
) => Promise<
  | { ok: true; version: number | null }
  /** The server understood and will not do it. Retrying cannot help. */
  | { ok: false; conflict?: false; code: string; message: string }
  /**
   * Somebody else changed the record first. CP-SYNC-001 s6 -- never silently overwrite.
   *
   * ⚠ IT RETURNS THE CURRENT VALUES OF THE CONTESTED FIELDS, AND THE ENGINE DOES NOT STORE THEM.
   * COMP-CONF-001 s6 requires "display clear comparison to the user", and the comparison needs both
   * sides. The device already holds `mine` -- it is the only copy. So `theirs` travels back in the
   * upload response and the comparison is built ON THE DEVICE, which keeps migration 284's decision
   * intact: the ledger records verdicts, never clinical payloads.
   */
  | {
      ok: false; conflict: true; code: string; message: string; currentVersion: number | null;
      /** Current server values, keyed like the submitted delta. */
      theirs?: Record<string, unknown>;
      /** Human labels per field. ⚠ Without these the screen shows column names. */
      labels?: Record<string, string>;
      /** Fields this applier declares NOT clinically significant. Everything unlisted is. */
      insignificant?: string[];
    }
>;

/**
 * ⚠ ONE ENTRY, AND IT ARRIVED WITH ITS CAPTURE SCREEN. The rule this file shipped with stands: adding an
 * applier without a producer creates a write path into the patient record that nothing exercises. It was
 * empty from `af83915a` until all seven of CP-OFFLINE-SURVEY-001 s5's preconditions held -- the last of
 * them, durability, proved in a real browser by `practice-outbox-durability-harness.ts`.
 *
 * ⚠ REGISTERED HERE RATHER THAN BY THE APPLIER CALLING BACK INTO THIS MAP, because `SYNC_ENTITY_TYPES`
 * below is a SNAPSHOT taken at module load. An applier that registered itself on import would populate
 * the map after that line had already run, leaving the status endpoint reporting no syncable entities
 * while uploads of that very type succeeded -- true, green, and silently inconsistent.
 *
 * ⚠ The applier imports `SyncApplier` from this file with `import type`, which TypeScript erases, so the
 * two-way reference is a compile-time one and there is no runtime cycle.
 */
export const SYNC_APPLIERS: Record<string, SyncApplier> = {
  [MEASUREMENT_ENTITY_TYPE]: parameterMeasurementApplier,
};

export const SYNC_ENTITY_TYPES: string[] = Object.keys(SYNC_APPLIERS);

/** Bounded so one upload cannot hold a connection open indefinitely. COMP-SYNC-001 s7 is incremental. */
export const SYNC_MAX_BATCH = 100;

// ── VALIDATION ──────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ REFUSED, NOT DROPPED. A transaction this server will not take must come back with a verdict the
// device can render, because the device is holding the only copy and needs to know it is holding it.
// Silently ignoring a malformed transaction would leave it `pending` on the device for ever, counted in
// a queue that never drains, which is the shape of a loss.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateTransaction(tx: SyncTransaction): { ok: true } | { ok: false; code: string; message: string } {
  if (!tx || typeof tx !== "object") return { ok: false, code: "MALFORMED", message: "This item was not readable as a transaction." };
  if (!UUID.test(tx.id ?? "")) return { ok: false, code: "BAD_ID", message: "This item carries no usable transaction identifier, so it cannot be filed safely." };
  if (!UUID.test(tx.entityId ?? "")) return { ok: false, code: "BAD_ENTITY_ID", message: "This item does not say which record it belongs to." };
  if (!tx.entityType || typeof tx.entityType !== "string")
    return { ok: false, code: "BAD_ENTITY_TYPE", message: "This item does not say what kind of record it is." };
  if (!["create", "update", "delete"].includes(tx.operation))
    return { ok: false, code: "BAD_OPERATION", message: "This item does not say what it was meant to do." };
  if (!tx.occurredAt || Number.isNaN(Date.parse(tx.occurredAt)))
    return { ok: false, code: "BAD_TIMESTAMP", message: "This item does not carry a readable time, so it cannot be placed in the record." };

  // ⚠ MIRRORS MIGRATION 284's CONSTRAINTS SO THE REFUSAL IS A SENTENCE RATHER THAN A CONSTRAINT NAME.
  // The database is still the authority -- this is reported, not re-implemented, exactly as
  // guidanceReadiness reports what the guidance constraints will do.
  if (tx.operation === "update" && (tx.baseVersion === null || tx.baseVersion === undefined))
    return {
      ok: false, code: "NO_BASE_VERSION",
      message: "This change does not say which version of the record it was made against, so applying it could overwrite somebody else's work unseen.",
    };
  if (tx.operation === "create" && tx.baseVersion !== null && tx.baseVersion !== undefined)
    return { ok: false, code: "CREATE_WITH_BASE_VERSION", message: "This item claims to create a record that already had a version." };

  if (!SYNC_APPLIERS[tx.entityType])
    return {
      ok: false, code: "ENTITY_NOT_SYNCABLE",
      // ⚠ NAMES THE TYPE. "Unsupported" alone leaves a practitioner unable to say what is stuck.
      message: `This practice cannot yet file "${tx.entityType}" records that were made offline. It is still on this device and has not been lost.`,
    };
  return { ok: true };
}

// ── THE LEDGER ──────────────────────────────────────────────────────────────────────────────────────

export type LedgerLookup =
  | { state: "absent" }
  | { state: "found"; verdict: SyncVerdict }
  /** ⚠ NOT "absent". An unreadable ledger must not be treated as "never seen" -- see applyTransaction. */
  | { state: "unreadable"; detail: string };

export async function lookupTransaction(
  admin: any, workspaceId: string, id: string,
): Promise<LedgerLookup> {
  const { data, error } = await admin.from(SYNC_TABLE)
    .select("id, status, applied_version, error_code, error_message")
    .eq("workspace_id", workspaceId).eq("id", id).maybeSingle();

  if (error) return { state: "unreadable", detail: error.message ?? "the synchronisation ledger could not be read" };
  if (!data) return { state: "absent" };
  return {
    state: "found",
    verdict: {
      id: data.id, status: data.status as SyncStatus, appliedVersion: data.applied_version ?? null,
      errorCode: data.error_code ?? null, errorMessage: data.error_message ?? null,
      duplicate: true, retryable: false,
    },
  };
}

/**
 * Apply one transaction, idempotently.
 *
 * ⚠ THE UNREADABLE-LEDGER BRANCH IS THE ONE WORTH READING TWICE. If the ledger cannot be read we do NOT
 * know whether this transaction was applied before. Applying anyway risks a duplicate consultation;
 * refusing permanently would discard real work. So it is answered as a RETRYABLE failure -- the device
 * keeps the record, stays `failed` rather than `refused`, and tries again when the database is well. The
 * only outcome that must never happen here is a silent apply on an unknown history.
 */
export async function applyTransaction(
  admin: any, ctx: WorkspaceContext, tx: SyncTransaction, opts: { actorId: string },
): Promise<SyncVerdict> {
  const seen = await lookupTransaction(admin, ctx.workspaceId, tx.id);
  if (seen.state === "found") return seen.verdict;
  if (seen.state === "unreadable")
    return {
      id: tx.id, status: "refused", appliedVersion: null, duplicate: false, retryable: true,
      errorCode: "LEDGER_UNREADABLE",
      errorMessage: `This could not be filed because the practice could not check whether it had already arrived (${seen.detail}). It is still on this device. Nothing was changed.`,
    };

  const valid = validateTransaction(tx);
  if (!valid.ok) {
    await recordVerdict(admin, ctx, tx, opts.actorId, {
      status: "refused", appliedVersion: null, errorCode: valid.code, errorMessage: valid.message,
    });
    return { id: tx.id, status: "refused", appliedVersion: null, errorCode: valid.code, errorMessage: valid.message, duplicate: false, retryable: false };
  }

  const applier = SYNC_APPLIERS[tx.entityType];
  let outcome: Awaited<ReturnType<SyncApplier>>;
  try {
    outcome = await applier(admin, ctx, tx);
  } catch (e) {
    // ⚠ A THROWN APPLIER IS NOT A REFUSAL. It is an unknown outcome -- the write may have half happened.
    // Reported as retryable, and DELIBERATELY NOT WRITTEN TO THE LEDGER, so the retry re-checks rather
    // than being told it already succeeded.
    return {
      id: tx.id, status: "refused", appliedVersion: null, duplicate: false, retryable: true,
      errorCode: "APPLY_FAILED",
      errorMessage: `The practice could not file this just now (${String((e as Error)?.message ?? e).slice(0, 200)}). It is still on this device.`,
    };
  }

  if (outcome.ok) {
    await recordVerdict(admin, ctx, tx, opts.actorId, {
      status: "applied", appliedVersion: outcome.version, errorCode: null, errorMessage: null,
    });
    return { id: tx.id, status: "applied", appliedVersion: outcome.version, errorCode: null, errorMessage: null, duplicate: false, retryable: false };
  }

  const status: SyncStatus = outcome.conflict ? "conflict" : "refused";
  await recordVerdict(admin, ctx, tx, opts.actorId, {
    status, appliedVersion: null, errorCode: outcome.code, errorMessage: outcome.message,
  });
  return {
    id: tx.id, status, appliedVersion: null, errorCode: outcome.code, errorMessage: outcome.message,
    duplicate: false, retryable: false,
    conflict: outcome.conflict
      ? {
          currentVersion: outcome.currentVersion,
          theirs: outcome.theirs ?? {},
          labels: outcome.labels ?? {},
          insignificant: outcome.insignificant ?? [],
        }
      : undefined,
  };
}

/**
 * ⚠ THE LEDGER WRITE NEVER CHANGES THE ANSWER THE CALLER GETS.
 *
 * If the apply succeeded and this insert fails, the work IS done and telling the device otherwise would
 * make it retry a completed write. The failure is swallowed here on purpose and the cost is stated: a
 * later retry of that same transaction finds no ledger row, re-applies, and is caught by the entity
 * version check rather than by this table.
 */
async function recordVerdict(
  admin: any, ctx: WorkspaceContext, tx: SyncTransaction, actorId: string,
  v: { status: SyncStatus; appliedVersion: number | null; errorCode: string | null; errorMessage: string | null },
): Promise<void> {
  try {
    await admin.from(SYNC_TABLE).insert({
      id: tx.id, workspace_id: ctx.workspaceId, device_id: tx.deviceId, actor_id: actorId,
      entity_type: tx.entityType, entity_id: tx.entityId, operation: tx.operation,
      base_version: tx.operation === "create" ? null : tx.baseVersion ?? null,
      client_sequence: tx.clientSequence, occurred_at: tx.occurredAt,
      status: v.status, applied_version: v.appliedVersion,
      error_code: v.errorCode, error_message: v.errorMessage,
      payload_hash: tx.payloadHash ?? null,
    });
  } catch {
    // Deliberately silent. See the header.
  }
}

/**
 * A whole upload, in the order the practitioner worked.
 *
 * ⚠ SORTED BY clientSequence HERE AS WELL AS ON THE DEVICE. COMP-SYNC-001 s9 requires ordered
 * processing, and a payload can arrive reordered by anything between the two -- a proxy, a retry that
 * merged batches, or a client bug. An update applied before its create fails against a row that does not
 * exist yet, and the practitioner sees a refusal for work that was fine.
 */
export async function applyBatch(
  admin: any, ctx: WorkspaceContext, transactions: SyncTransaction[], opts: { actorId: string },
): Promise<{ verdicts: SyncVerdict[]; applied: number; refused: number; conflicts: number }> {
  const ordered = [...transactions].sort((a, b) => (a.clientSequence ?? 0) - (b.clientSequence ?? 0));
  const verdicts: SyncVerdict[] = [];
  for (const tx of ordered) verdicts.push(await applyTransaction(admin, ctx, tx, opts));
  return {
    verdicts,
    applied: verdicts.filter(v => v.status === "applied").length,
    refused: verdicts.filter(v => v.status === "refused").length,
    conflicts: verdicts.filter(v => v.status === "conflict").length,
  };
}

// ── STATUS (COMP-SYNC-001 s10, CP-OFF-UI-001 s7) ────────────────────────────────────────────────────

export type SyncStatusReport = {
  /** ⚠ Three states. `failed` is not `absent` and neither is an empty ledger. */
  state: "ok" | "absent" | "failed";
  detail: string | null;
  lastReceivedAt: string | null;
  applied: number;
  refused: number;
  conflicts: number;
  /** The rows a person has to look at, newest first. Never a bare count. */
  needsAttention: {
    id: string; entityType: string; entityId: string; operation: string;
    status: string; errorCode: string | null; errorMessage: string | null;
    occurredAt: string; receivedAt: string;
  }[];
  /** ⚠ Named so a screen can say WHY nothing can be filed yet, rather than showing an empty success. */
  syncableEntityTypes: string[];
};

const isMissingTable = (error: any) =>
  !!error && (error.code === "42P01" || /does not exist/i.test(error.message ?? ""));

export async function syncStatus(admin: any, workspaceId: string): Promise<SyncStatusReport> {
  const shell = {
    lastReceivedAt: null, applied: 0, refused: 0, conflicts: 0,
    needsAttention: [] as SyncStatusReport["needsAttention"],
    syncableEntityTypes: SYNC_ENTITY_TYPES,
  };

  const { data, error } = await admin.from(SYNC_TABLE)
    .select("id, entity_type, entity_id, operation, status, error_code, error_message, occurred_at, received_at")
    .eq("workspace_id", workspaceId)
    .order("received_at", { ascending: false })
    .limit(500);

  if (isMissingTable(error))
    return { ...shell, state: "absent", detail: `Migration "${SYNC_MIGRATION}" has not been applied, so nothing can be filed from a device yet.` };
  // ⚠ A FAILED READ IS NEVER A ZERO. `data == null` with no error is also a failure, not an empty ledger.
  if (error || data == null)
    return { ...shell, state: "failed", detail: error?.message ?? "the synchronisation ledger came back as neither rows nor an error" };

  const rows = data as any[];
  return {
    state: "ok", detail: null,
    lastReceivedAt: rows.length ? rows[0].received_at : null,
    applied: rows.filter(r => r.status === "applied").length,
    refused: rows.filter(r => r.status === "refused").length,
    conflicts: rows.filter(r => r.status === "conflict").length,
    needsAttention: rows.filter(r => r.status !== "applied").map(r => ({
      id: r.id, entityType: r.entity_type, entityId: r.entity_id, operation: r.operation,
      status: r.status, errorCode: r.error_code, errorMessage: r.error_message,
      occurredAt: r.occurred_at, receivedAt: r.received_at,
    })),
    syncableEntityTypes: SYNC_ENTITY_TYPES,
  };
}
