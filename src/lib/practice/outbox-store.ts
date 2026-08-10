import {
  OUTBOX_SCHEMA_VERSION, outboxEnqueue, outboxRemovable,
  type OutboxOperation, type OutboxRecord,
} from "@/lib/practice/outbox-model";
import { generateCacheKey, openRecord, sealRecord, type SealedRecord } from "@/lib/practice/offline-crypto";

// CP-OFFLINE-SURVEY-001 s5 precondition 1 — DURABLE LOCAL PERSISTENCE FOR CAPTURED WORK.
// ⚠ BROWSER ONLY: every function here touches `indexedDB` and will throw anywhere else.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ ITS OWN DATABASE. THIS IS THE MOST IMPORTANT LINE IN THE FILE.
//
// `offline-store.ts` holds the CACHES -- the clinic day and the guidance library -- in a database named
// `competen-practice-offline`, and it deletes from that database freely: on expiry, on a practice
// switching offline access off, and on sign-out via `purgeAllOffline()`, which calls
// `indexedDB.deleteDatabase()` on the whole thing.
//
// Every one of those is correct for a cache and CATASTROPHIC for captured work. A cached day is a COPY
// -- the server still holds it, so deleting it loses access. A note the practitioner typed with no
// signal is THE ONLY COPY IN EXISTENCE.
//
// The user's rule, from 2026-08-08: "THE OUTBOX IS EXEMPT FROM EXPIRY. FULL STOP." And the warning that
// came with it: "the obvious implementation is one purge routine over one local database, and the
// obvious implementation would delete both."
//
// A separate DATABASE (not a separate object store) is what makes that structural instead of
// remembered. `deleteDatabase("competen-practice-offline")` cannot reach this one, whoever calls it and
// for whatever reason. The harness asserts the two names differ and that no purge in offline-store.ts
// names this database.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const DB_NAME = "competen-practice-outbox";
const DB_VERSION = 1;
/** One sealed transaction per key. Keyed by the transaction UUID, which is also the idempotency key. */
const STORE_RECORDS = "records";
/** The AES key, and the sequence counter. Both must survive a restart or ordering breaks. */
const STORE_META = "meta";
const META_KEY = "cacheKey";
const META_SEQUENCE = "sequence";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) db.createObjectStore(STORE_RECORDS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The outbox database could not be opened"));
  });
}

/**
 * ⚠ RESOLVES ON `transaction.oncomplete`, NOT ON `request.onsuccess`. THIS IS PRECONDITION 1.
 *
 * The survey requires "durable local persistence that survives tab close, crash and OS restart, proven
 * by test. IndexedDB with an EXPLICIT TRANSACTION COMMIT, not an in-memory queue with a `beforeunload`
 * flush."
 *
 * `request.onsuccess` fires when the operation has been performed against the transaction -- the
 * transaction can still abort afterwards, and then the write never happened. `oncomplete` is the point at
 * which the browser has committed. `offline-store.ts` resolves on `onsuccess`, which is right for a cache
 * (a lost write means re-fetching) and wrong here (a lost write means a lost consultation).
 *
 * ⚠ Read this before "simplifying" the two files into one helper: they differ on purpose, and the
 * difference is invisible in every test that does not kill the process mid-write.
 */
function commit<T>(
  db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result: T;
    const req = run(t.objectStore(store));
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => reject(req.error ?? new Error(`The outbox ${mode} on ${store} failed`));
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error("The outbox write was rolled back and did not happen"));
    t.onerror = () => reject(t.error ?? new Error("The outbox transaction failed"));
  });
}

async function cacheKey(db: IDBDatabase): Promise<CryptoKey> {
  const held = await commit<CryptoKey | undefined>(db, STORE_META, "readonly", s => s.get(META_KEY));
  if (held) return held;
  const fresh = await generateCacheKey();
  await commit(db, STORE_META, "readwrite", s => s.put(fresh, META_KEY));
  return fresh;
}

/**
 * ⚠ THE SEQUENCE IS ALLOCATED IN ONE TRANSACTION WITH THE WRITE THAT USES IT.
 *
 * Read-then-write across two transactions lets two enqueues racing in two tabs read the same number and
 * both claim it. Duplicate sequence numbers make the send order ambiguous, and an update overtaking its
 * own create is a server error nobody can reproduce. One transaction, one number.
 */
export type EnqueueResult =
  | { ok: true; record: OutboxRecord }
  /** ⚠ The caller MUST treat this as "the work was not accepted" and say so. See the header of accept(). */
  | { ok: false; reason: string };

/**
 * Accept one transaction into the outbox.
 *
 * ⚠⚠ THE CALLER MUST NOT TELL THE PRACTITIONER ANYTHING WAS SAVED UNTIL THIS RETURNS `ok: true`.
 *
 * That is the whole of the survey's s3.5 line, restated at the only place it can be enforced: "the line
 * is crossed the moment any UI accepts input that the user reasonably believes is recorded -- and it is
 * crossed by the ACCEPTANCE, not by the failure." A screen that renders "Saved locally" optimistically
 * and then handles the rejection quietly has already crossed it.
 */
export async function outboxAccept(args: {
  workspaceId: string; deviceId: string; userId: string;
  entityType: string; entityId: string; operation: OutboxOperation;
  payload: unknown; baseVersion: number | null; at?: Date;
}): Promise<EnqueueResult> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    return { ok: false, reason: `nothing was saved on this device: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }

  try {
    const key = await cacheKey(db);

    // One transaction: read the counter, write the next one, write the record. If any part fails the
    // whole thing aborts and no number is consumed.
    const next = await new Promise<number>((resolve, reject) => {
      const t = db.transaction([STORE_META, STORE_RECORDS], "readwrite");
      let allocated = 0;
      const read = t.objectStore(STORE_META).get(META_SEQUENCE);
      read.onsuccess = () => {
        allocated = (typeof read.result === "number" ? read.result : 0) + 1;
        t.objectStore(STORE_META).put(allocated, META_SEQUENCE);
      };
      t.oncomplete = () => resolve(allocated);
      t.onabort = () => reject(t.error ?? new Error("the outbox sequence could not be allocated"));
      t.onerror = () => reject(t.error ?? new Error("the outbox sequence transaction failed"));
    });

    const record = outboxEnqueue({
      id: (globalThis as unknown as { crypto: Crypto }).crypto.randomUUID(),
      workspaceId: args.workspaceId, deviceId: args.deviceId, userId: args.userId,
      entityType: args.entityType, entityId: args.entityId, operation: args.operation,
      payload: args.payload, baseVersion: args.baseVersion, sequence: next, at: args.at ?? new Date(),
    });

    const sealed = await sealRecord(key, record);
    await commit(db, STORE_RECORDS, "readwrite", s => s.put(sealed, record.id));
    db.close();
    return { ok: true, record };
  } catch (e) {
    db.close();
    return { ok: false, reason: `nothing was saved on this device: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * ⚠ AN UNREADABLE RECORD IS REPORTED, NEVER DELETED -- the opposite of the cache's rule.
 *
 * `loadOfflineDay` deletes a record that will not decrypt, because a cache that cannot be read is the
 * same as an absent one and the server still holds the data. Here it is the only copy, so a decrypt
 * failure means work has been lost. Deleting it would erase the evidence that anything existed; the
 * practitioner would never learn a consultation went missing.
 *
 * So it comes back as a synthetic `undeliverable` record carrying what little is known -- the id, which
 * is enough for somebody to say "something was recorded on this device on this day and cannot be read".
 */
export type OutboxLoad = {
  records: OutboxRecord[];
  /** ⚠ True when at least one stored record could not be read back. Never hidden. */
  unreadable: number;
  /** Null when the store was read cleanly. */
  detail: string | null;
};

export async function outboxLoad(): Promise<OutboxLoad> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    // ⚠ NOT an empty outbox. An outbox that cannot be opened is unknown, and rendering it as "nothing
    // waiting" would tell a practitioner their work had arrived.
    return { records: [], unreadable: 0, detail: `The outbox on this device could not be opened: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }

  try {
    const key = await commit<CryptoKey | undefined>(db, STORE_META, "readonly", s => s.get(META_KEY));
    const sealed = await commit<SealedRecord[]>(db, STORE_RECORDS, "readonly", s => s.getAll());
    const ids = await commit<IDBValidKey[]>(db, STORE_RECORDS, "readonly", s => s.getAllKeys());
    db.close();

    if (!key)
      return {
        records: [], unreadable: sealed.length,
        detail: sealed.length
          ? `${sealed.length} item${sealed.length === 1 ? "" : "s"} recorded on this device cannot be read back, because the key that protected them is not on this device any more. They have NOT been deleted.`
          : null,
      };

    const records: OutboxRecord[] = [];
    let unreadable = 0;
    for (let i = 0; i < sealed.length; i++) {
      const opened = await openRecord<OutboxRecord>(key, sealed[i]);
      if (opened && opened.schemaVersion === OUTBOX_SCHEMA_VERSION) { records.push(opened); continue; }
      unreadable++;
      // A record from a future schema is NOT discarded either -- see OUTBOX_SCHEMA_VERSION.
      records.push({
        schemaVersion: OUTBOX_SCHEMA_VERSION, id: String(ids[i]),
        workspaceId: "", deviceId: "", userId: "",
        entityType: "unknown", entityId: "", operation: "create",
        payload: null, baseVersion: null, sequence: Number.MAX_SAFE_INTEGER,
        createdAt: new Date(0).toISOString(), state: "undeliverable", attempts: 0,
        lastError: "This item was recorded on this device and cannot be read back. It has not been deleted.",
        lastAttemptAt: null, escalatedAt: new Date(0).toISOString(),
      });
    }

    return {
      records, unreadable,
      detail: unreadable
        ? `${unreadable} item${unreadable === 1 ? "" : "s"} recorded on this device cannot be read back. They are listed and have NOT been deleted.`
        : null,
    };
  } catch (e) {
    db.close();
    return { records: [], unreadable: 0, detail: `The outbox on this device could not be read: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}

/** Replace one record with its transitioned self. The only write path after `outboxAccept`. */
export async function outboxSave(record: OutboxRecord): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const db = await openDb();
    const key = await cacheKey(db);
    const sealed = await sealRecord(key, record);
    await commit(db, STORE_RECORDS, "readwrite", s => s.put(sealed, record.id));
    db.close();
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `the outbox on this device could not be updated: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * ⚠ THE ONLY DELETION IN THIS FILE, AND IT TAKES NO CLOCK.
 *
 * It removes DELIVERED records and nothing else. There is no age argument, no workspace argument and no
 * "force" -- an expiry could not be added without changing the signature, which is a change somebody has
 * to justify in review rather than slip in as a parameter default.
 *
 * ⚠ It re-reads and re-checks state at the point of deletion rather than trusting the caller's list. A
 * caller holding a stale record could otherwise ask for the deletion of something that had since failed.
 */
export async function outboxRemoveDelivered(): Promise<{ removed: number; reason: string | null }> {
  const loaded = await outboxLoad();
  if (loaded.detail && loaded.records.length === 0) return { removed: 0, reason: loaded.detail };

  const removable = outboxRemovable(loaded.records);
  if (removable.length === 0) return { removed: 0, reason: null };

  try {
    const db = await openDb();
    for (const r of removable) await commit(db, STORE_RECORDS, "readwrite", s => s.delete(r.id));
    db.close();
    return { removed: removable.length, reason: null };
  } catch (e) {
    return { removed: 0, reason: `delivered items could not be cleared from this device: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * PRECONDITION 6 — the recovery path for the undeliverable.
 *
 * "When a queued write genuinely cannot be applied [...] it must be EXPORTABLE AND READABLE BY A HUMAN,
 * not discarded." So this returns plain JSON with the payloads intact, for a person to read, print or
 * hand to somebody who can re-enter it.
 *
 * ⚠ IT EXPORTS EVERYTHING NOT DELIVERED, not only the terminal states. A practitioner whose device is
 * dying does not need the product's opinion about which of their notes are recoverable.
 */
export async function outboxExport(): Promise<{ exportedAt: string; records: OutboxRecord[]; note: string; detail: string | null }> {
  const loaded = await outboxLoad();
  return {
    exportedAt: new Date().toISOString(),
    records: loaded.records.filter(r => r.state !== "delivered"),
    note: "Work recorded on this device that has not reached the practice. Nothing here has been deleted from the device by producing this file.",
    detail: loaded.detail,
  };
}
