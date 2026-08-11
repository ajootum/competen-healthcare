import {
  OFFLINE_DAY_KEYS, OFFLINE_PATIENT_KEYS, OFFLINE_SESSION_KEYS,
  keysOutsideAllowList, readOfflineDay, type OfflineDay, type OfflineReadResult,
} from "@/lib/practice/offline-projection";
import {
  OFFLINE_GUIDANCE_DOC_KEYS, OFFLINE_GUIDANCE_LIBRARY_KEYS, OFFLINE_GUIDANCE_SECTION_KEYS,
  guidanceKeysOutsideAllowList, readOfflineGuidance,
  type OfflineGuidanceLibrary, type OfflineGuidanceReadResult,
} from "@/lib/practice/offline-guidance";
import {
  OFFLINE_CLINICAL_PACK_KEYS, OFFLINE_CLINICAL_RECORD_KEYS,
  clinicalKeysOutsideAllowList, readOfflineClinical,
  type OfflineClinicalPack, type OfflineClinicalReadResult,
} from "@/lib/practice/offline-clinical";
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
/**
 * 2 adds the guidance stores. `onupgradeneeded` creates only what is missing, so a device holding a
 * version-1 day keeps it — the upgrade adds stores and destroys nothing.
 */
const DB_VERSION = 3;
const STORE_DAY = "day";
const STORE_KEY = "key";
/**
 * The clinical carry, and ⚠ ITS OWN KEY AGAIN -- a THIRD one, for the third lifetime.
 *
 * Day: end of the clinic day. Guidance: seven days. Clinical: five. Three different expiries mean three
 * different moments at which a key is deleted, and any pair sharing one would leave the survivor sealed
 * under a key that no longer exists -- decrypt fails, the record is treated as corrupt, and it is
 * deleted. See the STORE_GUIDANCE comment: that trap was reasoned about once and it applies again here
 * without modification.
 */
const STORE_CLINICAL = "clinical";
const STORE_CLINICAL_KEY = "clinicalKey";
/**
 * The cached guidance library, and ⚠ ITS OWN KEY, SEPARATE FROM THE DAY'S.
 *
 * ⚠ THE TRAP THIS AVOIDS, WHICH LOOKS LIKE CORRECT CODE: the day and the guidance have DIFFERENT
 * LIFETIMES on purpose — the day dies at the end of the clinic day, the guidance lasts a week. If they
 * shared one AES key, `purgeOfflineDay` deleting that key on the nightly expiry would leave the guidance
 * record encrypted under a key that no longer exists. It would then fail to decrypt, be treated as
 * corrupt and be deleted — so the week-long guidance cache would silently evaporate every midnight, and
 * every function involved would look right in isolation.
 *
 * Two keys, two purges, and `purgeOfflineDay` deliberately does not touch either guidance store.
 */
const STORE_GUIDANCE = "guidance";
const STORE_GUIDANCE_KEY = "guidanceKey";
/**
 * ⚠ WHICH WORKSPACE, AND NOTHING ELSE. The offline page cannot ask the server which practice the person
 * was in, so the last one written is remembered here -- an opaque uuid, no name, no membership, nothing
 * that means anything to somebody reading the store. It is removed by the same purge as the day itself.
 */
const STORE_META = "meta";
const META_ACTIVE = "activeWorkspace";
/**
 * The practitioner's OWN primary navigation, so the offline shell can look like the shell.
 *
 * ⚠ STORED UNENCRYPTED, DELIBERATELY, AND THE REASONING MATTERS. These are the product's own section
 * names -- "Patients", "Encounters" -- filtered to the ones this account holds. They contain no patient
 * data, name nobody, and a device holding them discloses nothing about any person's care. `META_ACTIVE`
 * above already keeps an opaque workspace id on the same terms.
 *
 * ⚠ AND IT HAS TO BE READABLE WITHOUT THE PIN. The frame is drawn before anything is unlocked; sealing
 * this would mean a locked device shows a blank navy column, which is exactly the "looks broken" problem
 * the frame exists to fix. The rule holds where it matters: the DAY and the GUIDANCE stay sealed.
 */
const META_NAV = "primaryNav";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DAY)) db.createObjectStore(STORE_DAY);
      if (!db.objectStoreNames.contains(STORE_KEY)) db.createObjectStore(STORE_KEY);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      if (!db.objectStoreNames.contains(STORE_GUIDANCE)) db.createObjectStore(STORE_GUIDANCE);
      if (!db.objectStoreNames.contains(STORE_GUIDANCE_KEY)) db.createObjectStore(STORE_GUIDANCE_KEY);
      if (!db.objectStoreNames.contains(STORE_CLINICAL)) db.createObjectStore(STORE_CLINICAL);
      if (!db.objectStoreNames.contains(STORE_CLINICAL_KEY)) db.createObjectStore(STORE_CLINICAL_KEY);
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ `derived` IS ACCEPTED AND NOTHING PASSES IT YET. READ THIS BEFORE WIRING THE DEVICE PIN.
//
// offline-lock.ts derives an AES key from a PIN and never stores it -- the honest design offline-crypto.ts
// has asked for since it was written. Wiring it looks like a small change and IT IS NOT, because the two
// halves of this cache live in different places:
//
//   THE WRITER  OfflineCacheWriter.tsx, inside the practice (shell). Online, on every page load.
//   THE READER  /practice/offline, deliberately OUTSIDE the shell so it renders with no connection.
//
// A PIN prompt on the reader gives the READER a derived key. The WRITER, in the shell, has no PIN and
// would keep sealing with the per-workspace random key. The reader would then fail to decrypt -- and
// `loadOfflineDay` DELETES what it cannot decrypt, on the correct reasoning that an unreadable cache is
// the same as an absent one.
//
// So the naive wiring means: a practitioner sets a PIN to protect their device, and every cached day and
// every cached protocol is silently destroyed on the next read. Every file involved is correct on its
// own. This was built, caught before it shipped on 2026-08-11, and reverted.
//
// ⚠ WHAT WOULD ACTUALLY CLOSE IT, so this is a decision rather than a hole: the unlock has to live where
// the WRITING happens -- the shell -- and the derived key has to survive navigation, which a
// non-extractable CryptoKey cannot. The usual shape is a key-encryption-key: the PIN derives a KEK, the
// KEK wraps a random data key, and the WRAPPED key is what is stored. Unlocking unwraps it once per
// session. That still needs the shell to hold the session, and it is a real piece of work rather than a
// parameter.
//
// Until then this argument stays unused, because a PIN that protects nothing is worse than no PIN: it
// tells a practitioner their device is safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** Write one workspace's clinic day, sealed. Replaces whatever was there. */
export async function cacheOfflineDay(day: OfflineDay, derived?: CryptoKey): Promise<CacheWriteResult> {
  const bad = fieldsNotAllowed(day);
  if (bad.length > 0)
    return { ok: false, reason: `nothing was stored: the payload carried fields that are not on the offline allow-list (${bad.join(", ")})` };

  try {
    const db = await openDb();
    // ⚠ A SUPPLIED KEY IS NEVER STORED. It is derived from the PIN and exists only while this session is
    // unlocked -- writing it beside the ciphertext would put the key back next to the lock and undo the
    // whole point of deriving it. When there is no PIN the old behaviour stands, and offline-crypto.ts
    // is candid about what that defends against.
    let key = derived;
    if (!key) {
      key = await tx<CryptoKey | undefined>(db, STORE_KEY, "readonly", s => s.get(day.workspaceId));
      if (!key) {
        key = await generateCacheKey();
        await tx(db, STORE_KEY, "readwrite", s => s.put(key as CryptoKey, day.workspaceId));
      }
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
export async function loadOfflineDay(
  workspaceId: string, now: Date = new Date(), derived?: CryptoKey,
): Promise<OfflineReadResult> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    return { state: "none", purge: false, reason: `This device's offline store could not be opened: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }

  try {
    const sealed = await tx<SealedRecord | undefined>(db, STORE_DAY, "readonly", s => s.get(workspaceId));
    const key = derived ?? await tx<CryptoKey | undefined>(db, STORE_KEY, "readonly", s => s.get(workspaceId));
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
    // ⚠ THE POINTER GOES ONLY IF NOTHING IS LEFT TO POINT AT, and getting this wrong is invisible.
    // META_ACTIVE is how the offline page knows which workspace to load, for the guidance as well as the
    // day. Deleting it unconditionally here — which is what this did before guidance existed — meant the
    // nightly day expiry orphaned a perfectly valid week-long guidance cache: still stored, still
    // decryptable, and unreachable because nothing could name its workspace.
    await dropPointerIfOrphaned(db, workspaceId, STORE_DAY);
    db.close();
    return { ok: true, reason: "Anything held for this practice on this device has been removed." };
  } catch (e) {
    // ⚠ REPORTED, NEVER SWALLOWED. A purge that failed and said nothing is the worst outcome here: the
    // practice believes the data is gone and it is not.
    return { ok: false, reason: `This device's offline store could not be cleared: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * ⚠⚠ THE POINTER GOES ONLY WHEN NOTHING AT ALL IS LEFT TO POINT AT -- AND "NOTHING" NOW MEANS THREE
 * STORES, NOT ONE.
 *
 * META_ACTIVE is how the offline page knows which workspace to load. Each purge used to check exactly
 * ONE other store by hand: purgeOfflineDay looked at guidance, purgeOfflineGuidance looked at the day.
 * That was correct while there were two caches and became wrong the moment a third arrived -- the
 * NIGHTLY day expiry would have deleted the pointer while a five-day clinical pack was still sealed on
 * the device, leaving it stored, decryptable and unreachable because nothing could name its workspace.
 *
 * ⚠ THE SAME BUG THE STORE_GUIDANCE COMMENT DESCRIBES, RE-ARMED BY ADDING A CACHE. So the check is no
 * longer written out per call site: this function asks every sealed store except the one just emptied,
 * and a FOURTH cache is covered by adding its name to one array below rather than by remembering to
 * amend three purges.
 */
async function dropPointerIfOrphaned(
  db: IDBDatabase, workspaceId: string, justCleared: string,
): Promise<void> {
  const SEALED_STORES = [STORE_DAY, STORE_GUIDANCE, STORE_CLINICAL];
  for (const store of SEALED_STORES) {
    if (store === justCleared) continue;
    const held = await tx<SealedRecord | undefined>(db, store, "readonly", s => s.get(workspaceId));
    // Something still needs the pointer. Leave it exactly where it is.
    if (held) return;
  }
  await tx(db, STORE_META, "readwrite", s => s.delete(META_ACTIVE));
}

// ── THE GUIDANCE LIBRARY ────────────────────────────────────────────────────────────────────────────
//
// Same shape as the day above, same allow-list-before-sealing discipline, and ⚠ DELIBERATELY NOT THE SAME
// LIFETIME. See the STORE_GUIDANCE comment at the top for the trap that separation exists to avoid.
//
// ⚠ IT IS STILL SEALED EVEN THOUGH IT NAMES NOBODY. Guidance is not patient data, so the disclosure case
// is much weaker than the day's -- but a practice's clinical protocols are its own work, they are not
// public, and there is no reason to hold them in the clear when the sealing machinery is already here.
// What sealing does and does not achieve is stated once, in OFFLINE_ENCRYPTION_NOTE, and not re-claimed.

/** Fields on the guidance payload that are not on the allow-list. Empty means it is what was agreed. */
export function guidanceFieldsNotAllowed(library: OfflineGuidanceLibrary): string[] {
  const bad = guidanceKeysOutsideAllowList(library, OFFLINE_GUIDANCE_LIBRARY_KEYS as readonly string[])
    .map(k => `library.${k}`);
  for (const d of library.documents ?? []) {
    for (const k of guidanceKeysOutsideAllowList(d, OFFLINE_GUIDANCE_DOC_KEYS as readonly string[]))
      bad.push(`document.${k}`);
    for (const s of d.sections ?? [])
      for (const k of guidanceKeysOutsideAllowList(s, OFFLINE_GUIDANCE_SECTION_KEYS as readonly string[]))
        bad.push(`section.${k}`);
  }
  return [...new Set(bad)];
}

export type GuidanceWriteResult =
  | { ok: true; documents: number }
  | { ok: false; reason: string };

/** Write one workspace's guidance library, sealed. Replaces whatever was there. */
export async function cacheOfflineGuidance(
  library: OfflineGuidanceLibrary, derived?: CryptoKey,
): Promise<GuidanceWriteResult> {
  const bad = guidanceFieldsNotAllowed(library);
  if (bad.length > 0)
    return { ok: false, reason: `nothing was stored: the guidance payload carried fields that are not on the offline allow-list (${bad.join(", ")})` };

  try {
    const db = await openDb();
    let key = derived;
    if (!key) {
      key = await tx<CryptoKey | undefined>(db, STORE_GUIDANCE_KEY, "readonly", s => s.get(library.workspaceId));
      if (!key) {
        key = await generateCacheKey();
        await tx(db, STORE_GUIDANCE_KEY, "readwrite", s => s.put(key as CryptoKey, library.workspaceId));
      }
    }
    const sealed = await sealRecord(key, library);
    await tx(db, STORE_GUIDANCE, "readwrite", s => s.put(sealed, library.workspaceId));
    // The same pointer the day uses. Written by whichever cache ran last; both name the same workspace.
    await tx(db, STORE_META, "readwrite", s => s.put(library.workspaceId, META_ACTIVE));
    db.close();
    return { ok: true, documents: library.documents.length };
  } catch (e) {
    return { ok: false, reason: `nothing was stored: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * Read the cached guidance, and DELETE it if it may not be shown.
 *
 * ⚠ Expiry is evaluated here, on every read, and it DELETES rather than hides -- the same rule as the day
 * and for the same reason: it is the only control that reaches a device that never reconnects.
 */
export async function loadOfflineGuidance(
  workspaceId: string, now: Date = new Date(), derived?: CryptoKey,
): Promise<OfflineGuidanceReadResult> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    return { state: "none", purge: false, reason: `This device's offline store could not be opened: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }

  try {
    const sealed = await tx<SealedRecord | undefined>(db, STORE_GUIDANCE, "readonly", s => s.get(workspaceId));
    const key = derived ?? await tx<CryptoKey | undefined>(db, STORE_GUIDANCE_KEY, "readonly", s => s.get(workspaceId));
    if (!sealed || !key) { db.close(); return readOfflineGuidance(null, now); }

    const library = await openRecord<OfflineGuidanceLibrary>(key, sealed);
    if (!library) {
      await tx(db, STORE_GUIDANCE, "readwrite", s => s.delete(workspaceId));
      db.close();
      return { state: "none", purge: false, reason: "The guidance stored on this device could not be read back, so it has been removed." };
    }

    const result = readOfflineGuidance(library, now);
    if (result.state !== "ok" && result.purge) {
      await tx(db, STORE_GUIDANCE, "readwrite", s => s.delete(workspaceId));
      await tx(db, STORE_GUIDANCE_KEY, "readwrite", s => s.delete(workspaceId));
    }
    db.close();
    return result;
  } catch (e) {
    db.close();
    return { state: "none", purge: false, reason: `This device's guidance store could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/** Remove the guidance held for a workspace -- the library AND its key. Leaves the day alone. */
export async function purgeOfflineGuidance(workspaceId: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const db = await openDb();
    await tx(db, STORE_GUIDANCE, "readwrite", s => s.delete(workspaceId));
    await tx(db, STORE_GUIDANCE_KEY, "readwrite", s => s.delete(workspaceId));
    await dropPointerIfOrphaned(db, workspaceId, STORE_GUIDANCE);
    db.close();
    return { ok: true, reason: "The practice guidance held on this device has been removed." };
  } catch (e) {
    // ⚠ REPORTED, NEVER SWALLOWED -- see purgeOfflineDay.
    return { ok: false, reason: `This device's guidance store could not be cleared: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * Everything held for a workspace: the day AND the guidance.
 *
 * ⚠ THIS IS WHAT "TURN IT OFF" MUST CALL, not `purgeOfflineDay`. s3.8.6's switch is a practice saying
 * "do not hold my practice's data on that device", and a purge that left a week of protocols behind
 * would be a purge that did not purge. `purgeOfflineDay` remains day-only because the nightly expiry
 * calls it, and that must not take the guidance with it.
 */
export async function purgeOfflineWorkspace(workspaceId: string): Promise<{ ok: boolean; reason: string }> {
  const day = await purgeOfflineDay(workspaceId);
  const guidance = await purgeOfflineGuidance(workspaceId);
  // ⚠ THE CLINICAL PACK IS THE MOST IMPORTANT ONE FOR THIS FUNCTION TO REACH. It is the most sensitive
  // thing this device holds, so a "turn it off" that left allergies and medication behind would be the
  // switch failing at exactly the case it was asked for.
  const clinical = await purgeOfflineClinical(workspaceId);
  if (day.ok && guidance.ok && clinical.ok)
    return { ok: true, reason: "Anything held for this practice on this device has been removed." };
  return {
    ok: false,
    reason: [
      day.ok ? null : day.reason,
      guidance.ok ? null : guidance.reason,
      clinical.ok ? null : clinical.reason,
    ].filter(Boolean).join(" "),
  };
}

// ── THE CLINICAL CARRY ──────────────────────────────────────────────────────────────────────────────
//
// Same shape as the two caches above, same allow-list-before-sealing discipline, its own key and its own
// lifetime -- and ⚠ ONE RULE NEITHER OF THE OTHERS HAS: it will not be written to a device with no PIN.
// That decision lives in the WRITER rather than here, because this module is the mechanism and the writer
// is the policy; see OfflineCacheWriter. What this module guarantees is that the payload is sealed and
// that the allow-list held, which is the same guarantee it gives the other two.

/** Fields on the clinical payload that are not on the allow-list. Empty means it is what was agreed. */
export function clinicalFieldsNotAllowed(pack: OfflineClinicalPack): string[] {
  const bad = clinicalKeysOutsideAllowList(pack, OFFLINE_CLINICAL_PACK_KEYS as readonly string[])
    .map(k => `pack.${k}`);
  for (const r of pack.records ?? [])
    for (const k of clinicalKeysOutsideAllowList(r, OFFLINE_CLINICAL_RECORD_KEYS as readonly string[]))
      bad.push(`record.${k}`);
  return [...new Set(bad)];
}

export type ClinicalWriteResult =
  | { ok: true; records: number }
  | { ok: false; reason: string };

/**
 * Write one workspace's clinical carry, sealed. Replaces whatever was there.
 *
 * ⚠ `derived` IS REQUIRED IN PRACTICE EVEN THOUGH THE TYPE ALLOWS IT TO BE ABSENT. The other two caches
 * fall back to a generated random key when no PIN is set, because a day list behind a random key beside
 * its ciphertext is still better than nothing. This payload does not get that fallback from its caller:
 * the writer refuses to call this at all without a device key. The parameter keeps the same shape as its
 * siblings so the three cannot drift apart, and the refusal is stated where it can be enforced.
 */
export async function cacheOfflineClinical(
  pack: OfflineClinicalPack, derived?: CryptoKey,
): Promise<ClinicalWriteResult> {
  const bad = clinicalFieldsNotAllowed(pack);
  if (bad.length > 0)
    return { ok: false, reason: `nothing was stored: the clinical payload carried fields that are not on the offline allow-list (${bad.join(", ")})` };

  try {
    const db = await openDb();
    let key = derived;
    if (!key) {
      key = await tx<CryptoKey | undefined>(db, STORE_CLINICAL_KEY, "readonly", s => s.get(pack.workspaceId));
      if (!key) {
        key = await generateCacheKey();
        await tx(db, STORE_CLINICAL_KEY, "readwrite", s => s.put(key as CryptoKey, pack.workspaceId));
      }
    }
    const sealed = await sealRecord(key, pack);
    await tx(db, STORE_CLINICAL, "readwrite", s => s.put(sealed, pack.workspaceId));
    await tx(db, STORE_META, "readwrite", s => s.put(pack.workspaceId, META_ACTIVE));
    db.close();
    return { ok: true, records: pack.records.length };
  } catch (e) {
    return { ok: false, reason: `nothing was stored: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * Read the cached clinical carry, and DELETE it if it may not be shown.
 *
 * ⚠ Expiry is evaluated on every read and it DELETES rather than hides. For this cache that is not
 * merely the established rule: a six-day-old medication list cannot be told apart from a correct one by
 * anybody looking at it, so leaving it in place behind a warning would be leaving a decision to somebody
 * who has no way to make it.
 */
export async function loadOfflineClinical(
  workspaceId: string, now: Date = new Date(), derived?: CryptoKey,
): Promise<OfflineClinicalReadResult> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    return { state: "none", purge: false, reason: `This device's offline store could not be opened: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }

  try {
    const sealed = await tx<SealedRecord | undefined>(db, STORE_CLINICAL, "readonly", s => s.get(workspaceId));
    const key = derived ?? await tx<CryptoKey | undefined>(db, STORE_CLINICAL_KEY, "readonly", s => s.get(workspaceId));
    if (!sealed || !key) { db.close(); return readOfflineClinical(null, now); }

    const pack = await openRecord<OfflineClinicalPack>(key, sealed);
    if (!pack) {
      await tx(db, STORE_CLINICAL, "readwrite", s => s.delete(workspaceId));
      db.close();
      return { state: "none", purge: false, reason: "The clinical records stored on this device could not be read back, so they have been removed." };
    }

    const result = readOfflineClinical(pack, now);
    if (result.state !== "ok" && result.purge) {
      await tx(db, STORE_CLINICAL, "readwrite", s => s.delete(workspaceId));
      await tx(db, STORE_CLINICAL_KEY, "readwrite", s => s.delete(workspaceId));
    }
    db.close();
    return result;
  } catch (e) {
    db.close();
    return { state: "none", purge: false, reason: `This device's clinical store could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/** Remove the clinical carry held for a workspace -- the pack AND its key. Leaves the others alone. */
export async function purgeOfflineClinical(workspaceId: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const db = await openDb();
    await tx(db, STORE_CLINICAL, "readwrite", s => s.delete(workspaceId));
    await tx(db, STORE_CLINICAL_KEY, "readwrite", s => s.delete(workspaceId));
    await dropPointerIfOrphaned(db, workspaceId, STORE_CLINICAL);
    db.close();
    return { ok: true, reason: "The clinical records held on this device have been removed." };
  } catch (e) {
    // ⚠ REPORTED, NEVER SWALLOWED -- see purgeOfflineDay.
    return { ok: false, reason: `This device's clinical store could not be cleared: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/** One primary section, as the practitioner's own sidebar shows it. No hrefs are followed offline. */
export type CachedNavItem = { href: string; label: string; icon: string };

/**
 * Remember the practitioner's primary navigation.
 *
 * ⚠ WRITTEN EVEN WHEN THE DEVICE IS LOCKED, because the frame needs it before anything is unlocked, and
 * it is not sealed. Called by the cache writer alongside the day.
 */
export async function cacheNav(items: CachedNavItem[]): Promise<void> {
  try {
    const db = await openDb();
    await tx(db, STORE_META, "readwrite", s => s.put(items, META_NAV));
    db.close();
  } catch {
    // ⚠ Silent, and it is the one place in this file that is. A sidebar that could not be remembered
    // costs a plainer offline screen; nothing about the day or the guidance depends on it.
  }
}

/** The remembered navigation, or an empty list. ⚠ Empty means UNKNOWN, and the frame says so. */
export async function cachedNav(): Promise<CachedNavItem[]> {
  try {
    const db = await openDb();
    const items = await tx<CachedNavItem[] | undefined>(db, STORE_META, "readonly", s => s.get(META_NAV));
    db.close();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
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

/**
 * Everything, every workspace. Used on sign-out, where no workspace id is in hand.
 *
 * ⚠⚠ IT DELETES THE WHOLE CACHE DATABASE, AND IT MUST NEVER REACH THE OUTBOX.
 *
 * `outbox-store.ts` holds work the practitioner CAPTURED offline -- the only copy in existence -- and the
 * user's rule of 2026-08-08 is that it is exempt from expiry, from revocation and from flag-off. This
 * function is exactly the "one purge routine over one local database" that rule warns about.
 *
 * The protection is STRUCTURAL, not a condition below: the outbox is a SEPARATE INDEXEDDB DATABASE
 * (`competen-practice-outbox`), so `deleteDatabase(DB_NAME)` cannot touch it. ⚠ Do not "tidy" the outbox
 * into a store in this database. The harness asserts the two names differ and that this file never names
 * the outbox database.
 */
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
