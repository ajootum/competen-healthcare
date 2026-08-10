import { lockStateOf, type LockRecord, type LockState } from "@/lib/practice/offline-lock";

// CP-OFFLINE-SURVEY-001 s5 precondition 0 — where the device PIN is kept.
// ⚠ BROWSER ONLY: every function here touches `indexedDB`.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A THIRD DATABASE, AND EACH OF THE THREE HAS A DIFFERENT LIFETIME. THAT IS THE WHOLE FILING SYSTEM.
//
//   competen-practice-offline   THE CACHES. Copies the practice still holds. Expire on a timer, are
//                               purged when a practice switches caching off, and the WHOLE DATABASE is
//                               deleted on sign-out by purgeAllOffline().
//   competen-practice-outbox    CAPTURED WORK. The only copy in existence. Exempt from expiry, from
//                               revocation and from flag-off. Nothing automatic may delete it.
//   competen-practice-lock      THIS. The device credential.
//
// ⚠ WHY THE LOCK IS NOT IN THE CACHE DATABASE, WHICH IS THE OBVIOUS PLACE: `purgeAllOffline()` deletes
// that database on sign-out. A PIN kept there would be forgotten every time somebody signed out, so the
// practitioner would be asked to invent a new one on every return -- and a credential people are forced
// to re-choose weekly becomes the same four digits every time. The PIN is a property of the DEVICE, not
// of the cached data it protects.
//
// ⚠ AND WHY IT IS NOT IN THE OUTBOX DATABASE EITHER, even though that one also survives: the user's
// decision of 2026-08-10 is that the PIN gates the CACHES and NEVER captured work. Sharing a database
// with the outbox would be the first step toward sharing a key with it, and a forgotten PIN would then
// destroy the only copy of a consultation. Three concerns, three databases, no shared fate.

const DB_NAME = "competen-practice-lock";
const DB_VERSION = 1;
const STORE = "lock";
const KEY = "device";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The device lock store could not be opened"));
  });
}

/** Resolves on commit, not on request success -- losing a lock write means losing access to the cache. */
function commit<T>(
  db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let result: T;
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => reject(req.error ?? new Error("The device lock store could not be written"));
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error("The device lock write was rolled back"));
  });
}

export type LockLoad = {
  record: LockRecord | null;
  state: LockState;
  /** ⚠ Non-null when the store could not be read. `state` is then "locked", never "not_enrolled". */
  detail: string | null;
};

/**
 * ⚠ AN UNREADABLE LOCK STORE REPORTS "locked", NOT "not_enrolled".
 *
 * Reading it as not-enrolled would offer to set a new PIN on a device that already has one, and the new
 * PIN would derive a different key -- so the caches sealed under the old one would become unreadable and
 * be deleted as corrupt. A transient IndexedDB fault would silently wipe the day's list. Unknown means
 * locked, and locked means ask.
 */
export async function loadLock(now: Date = new Date()): Promise<LockLoad> {
  try {
    const db = await openDb();
    const record = await commit<LockRecord | undefined>(db, "readonly", s => s.get(KEY));
    db.close();
    return { record: record ?? null, state: lockStateOf(record ?? null, now), detail: null };
  } catch (e) {
    return {
      record: null, state: "locked",
      detail: `This device's PIN could not be read: ${String((e as Error)?.message ?? e).slice(0, 160)}`,
    };
  }
}

export async function saveLock(record: LockRecord): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const db = await openDb();
    await commit(db, "readwrite", s => s.put(record, KEY));
    db.close();
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `The PIN could not be saved on this device: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * Remove the PIN from this device.
 *
 * ⚠ THE CALLER MUST PURGE THE CACHES IN THE SAME BREATH. They are sealed under a key derived from the
 * PIN, so once this row is gone nothing can ever open them -- they would sit on the disk as ciphertext
 * nobody can read or account for. `forgetLock` does not do it here because this module must not import
 * the cache store: that import is what would let a future edit reach the outbox from the lock path.
 */
export async function forgetLock(): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const db = await openDb();
    await commit(db, "readwrite", s => s.delete(KEY));
    db.close();
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `The PIN could not be removed from this device: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}
