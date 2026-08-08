import {
  OFFLINE_DAY_KEYS, OFFLINE_PATIENT_KEYS, OFFLINE_SESSION_KEYS,
  keysOutsideAllowList, readOfflineDay, type OfflineDay, type OfflineReadResult,
} from "@/lib/practice/offline-projection";
import { generateCacheKey, openRecord, sealRecord, type SealedRecord } from "@/lib/practice/offline-crypto";

// CP-OFFLINE-SURVEY-001 s3.3 step 1 — the browser store. ⚠ BROWSER ONLY: every function here touches
// `indexedDB` and will throw anywhere else. Nothing server-side imports it.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE OBJECT STORE PER CONCERN, KEYED BY WORKSPACE.
//
//   day   the sealed clinic day, keyed `${workspaceId}` -- one workspace-day, replaced on every write
//   key   the AES-GCM key for that workspace, non-extractable, keyed the same way
//
// Both are deleted together. A key without a record is harmless; a record without a key is unreadable,
// which is the same as absent -- but leaving either behind after a purge would be a purge that did not
// purge, so `purgeOfflineDay` removes the pair and reports what it removed.
//
// ⚠ WHY THE ALLOW-LIST IS RE-APPLIED HERE, in the browser, when the server already projected.
//
// Because this is the WRITE, and s3.8.1's rule is about the write: "a cache that stores everything and
// renders a subset has stored everything". The server projection is what keeps the dropped fields off the
// wire; this check is what keeps them out of the store if that projection is ever loosened, if a second
// caller appears, or if a future endpoint hands this function a fuller payload. It REFUSES rather than
// trimming: a payload carrying a field nobody allowed is a payload nobody has reasoned about, and silently
// trimming it would let the change land unnoticed.
//
// ⚠ NOT A SYNC LAYER, AND NOTHING HERE WRITES BACK. There is no queue, no outbox, no pending state and no
// mutation of a stored record. Phase one is read-only, and the way that is kept true is that the only
// writer is `cacheOfflineDay`, whose input comes from the server and is never edited by the browser.

const DB_NAME = "competen-practice-offline";
const DB_VERSION = 1;
const STORE_DAY = "day";
const STORE_KEY = "key";
/**
 * ⚠ WHICH WORKSPACE, AND NOTHING ELSE. The offline page cannot ask the server which practice the person
 * was in, so the last one written is remembered here -- an opaque uuid, no name, no membership, nothing
 * that means anything to somebody reading the store. It is removed by the same purge as the day itself.
 */
const STORE_META = "meta";
const META_ACTIVE = "activeWorkspace";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DAY)) db.createObjectStore(STORE_DAY);
      if (!db.objectStoreNames.contains(STORE_KEY)) db.createObjectStore(STORE_KEY);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB could not be opened"));
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`IndexedDB ${mode} on ${store} failed`));
  });
}

/**
 * ⚠ THE ALLOW-LIST CHECK, RUN BEFORE ANYTHING IS SEALED.
 *
 * Returns the offending field names. Empty means the payload is exactly what was agreed.
 */
export function fieldsNotAllowed(day: OfflineDay): string[] {
  const bad = keysOutsideAllowList(day, OFFLINE_DAY_KEYS as readonly string[])
    .map(k => `day.${k}`);
  for (const p of day.patients ?? [])
    for (const k of keysOutsideAllowList(p, OFFLINE_PATIENT_KEYS as readonly string[])) bad.push(`patient.${k}`);
  for (const s of day.sessions ?? [])
    for (const k of keysOutsideAllowList(s, OFFLINE_SESSION_KEYS as readonly string[])) bad.push(`session.${k}`);
  return [...new Set(bad)];
}

export type CacheWriteResult =
  | { ok: true; patients: number }
  | { ok: false; reason: string };

/** Write one workspace's clinic day, sealed. Replaces whatever was there. */
export async function cacheOfflineDay(day: OfflineDay): Promise<CacheWriteResult> {
  const bad = fieldsNotAllowed(day);
  if (bad.length > 0)
    return { ok: false, reason: `nothing was stored: the payload carried fields that are not on the offline allow-list (${bad.join(", ")})` };

  try {
    const db = await openDb();
    let key = await tx<CryptoKey | undefined>(db, STORE_KEY, "readonly", s => s.get(day.workspaceId));
    if (!key) {
      key = await generateCacheKey();
      await tx(db, STORE_KEY, "readwrite", s => s.put(key as CryptoKey, day.workspaceId));
    }
    const sealed = await sealRecord(key, day);
    await tx(db, STORE_DAY, "readwrite", s => s.put(sealed, day.workspaceId));
    await tx(db, STORE_META, "readwrite", s => s.put(day.workspaceId, META_ACTIVE));
    db.close();
    return { ok: true, patients: day.patients.length };
  } catch (e) {
    return { ok: false, reason: `nothing was stored: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * Read the cached day, and DELETE it if it may not be shown.
 *
 * ⚠ THE EXPIRY IS EVALUATED HERE, ON EVERY READ, AND IT DELETES RATHER THAN HIDES (s3.8.2). This is the
 * only control that acts on a device that never reconnects: revocation, the platform flag and the
 * practice's own switch all need the device to come online. A record that is merely hidden is a record
 * still on the disk.
 */
export async function loadOfflineDay(workspaceId: string, now: Date = new Date()): Promise<OfflineReadResult> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    return { state: "none", purge: false, reason: `This device's offline store could not be opened: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }

  try {
    const sealed = await tx<SealedRecord | undefined>(db, STORE_DAY, "readonly", s => s.get(workspaceId));
    const key = await tx<CryptoKey | undefined>(db, STORE_KEY, "readonly", s => s.get(workspaceId));
    if (!sealed || !key) { db.close(); return readOfflineDay(null, now); }

    const day = await openRecord<OfflineDay>(key, sealed);
    // A record that will not decrypt is treated exactly as an absent one -- and removed, because it can
    // never become readable again.
    if (!day) {
      await tx(db, STORE_DAY, "readwrite", s => s.delete(workspaceId));
      db.close();
      return { state: "none", purge: false, reason: "What was stored on this device could not be read back, so it has been removed." };
    }

    const result = readOfflineDay(day, now);
    if (result.state !== "ok" && result.purge) {
      await tx(db, STORE_DAY, "readwrite", s => s.delete(workspaceId));
      await tx(db, STORE_KEY, "readwrite", s => s.delete(workspaceId));
    }
    db.close();
    return result;
  } catch (e) {
    db.close();
    return { state: "none", purge: false, reason: `This device's offline store could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/**
 * Remove everything held for a workspace -- the day AND its key.
 *
 * Called when a switch says off (s3.8.6: "turning it off must PURGE, not merely stop caching"), on
 * sign-out, and whenever the reader finds a record it may not show.
 */
export async function purgeOfflineDay(workspaceId: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const db = await openDb();
    await tx(db, STORE_DAY, "readwrite", s => s.delete(workspaceId));
    await tx(db, STORE_KEY, "readwrite", s => s.delete(workspaceId));
    await tx(db, STORE_META, "readwrite", s => s.delete(META_ACTIVE));
    db.close();
    return { ok: true, reason: "Anything held for this practice on this device has been removed." };
  } catch (e) {
    // ⚠ REPORTED, NEVER SWALLOWED. A purge that failed and said nothing is the worst outcome here: the
    // practice believes the data is gone and it is not.
    return { ok: false, reason: `This device's offline store could not be cleared: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * The workspace the last cached day belonged to, or null.
 *
 * ⚠ The offline page has no server to ask. Without this it would have to guess, and guessing wrong means
 * showing one practice's clinic day to somebody working in another.
 */
export async function lastCachedWorkspace(): Promise<string | null> {
  try {
    const db = await openDb();
    const id = await tx<string | undefined>(db, STORE_META, "readonly", s => s.get(META_ACTIVE));
    db.close();
    return id ?? null;
  } catch {
    return null;
  }
}

/** Everything, every workspace. Used on sign-out, where no workspace id is in hand. */
export async function purgeAllOffline(): Promise<{ ok: boolean; reason: string }> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve({ ok: true, reason: "The offline store has been removed from this device." });
      req.onerror = () => resolve({ ok: false, reason: "The offline store could not be removed from this device." });
      req.onblocked = () => resolve({ ok: false, reason: "The offline store could not be removed while another tab has it open." });
    } catch (e) {
      resolve({ ok: false, reason: `The offline store could not be removed: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
    }
  });
}
