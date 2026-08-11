// COMP-SEC-001 s4 / s10 and CP-OFFLINE-SURVEY-001 s5 precondition 0 — LOCAL RE-AUTHENTICATION.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHAT THIS GATES, AND WHAT IT DELIBERATELY DOES NOT. THE USER'S DECISION OF 2026-08-10.
//
//   GATED:     the cached clinic day and the cached guidance library. Both are COPIES -- the server
//              still holds them -- so losing access to them loses access, not data.
//   NOT GATED: THE OUTBOX. Work the practitioner captured offline is the only copy in existence, and
//              "no accepted work is lost" is an acceptance criterion in CP-OFF-001 s9, CP-SYNC-001 s9
//              and COMP-SYNC-001 s11.
//
// The alternative was rejected on exactly that ground: a PIN that gated everything would mean a
// practitioner who forgets it in a clinic with no signal has permanently destroyed a consultation. The
// product would be deleting clinical work on a memory lapse and failing its own acceptance criteria to
// do it.
//
// ⚠ SO THIS MODULE MUST NEVER IMPORT outbox-store.ts, AND THE HARNESS ASSERTS THAT. The separation is
// the decision; an import would be the decision quietly reversed.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ WHAT A PIN ACTUALLY BUYS, STATED HONESTLY BEFORE ANY OF IT REACHES A SCREEN.
//
// offline-crypto.ts says a key sitting beside its ciphertext "raises cost; it does not change the
// category", and that "a PIN-derived key would be the honest design". This is that design -- the cache
// key is DERIVED from the PIN and is never stored -- so without the PIN the ciphertext is genuinely
// unreadable rather than merely un-navigated-to. That IS a category change.
//
// But the entropy is small and pretending otherwise would be the fourth over-claim this product has had
// to withdraw. A six-digit PIN is 10^6 possibilities. At LOCK_ITERATIONS the derivation costs roughly a
// third of a second on a laptop, so an attacker with a disk image and no time pressure works through the
// whole space in days, not centuries. A longer or alphanumeric secret moves that by orders of magnitude,
// which is why the strength hint below is not decoration.
//
// ⚠ AND THE LOCKOUT COUNTER IS LOCAL, so it constrains somebody TYPING AT THE DEVICE and nobody else. An
// attacker with the disk image never sees it. It is a control against a person who picks up a phone, not
// against forensics. LOCK_HONEST_NOTE is the only sentence any screen may print about this.

/** ⚠ The ONLY sentence about the device lock that any surface may print. Do not strengthen it. */
export const LOCK_HONEST_NOTE =
  "Your PIN unlocks what is stored on this device — it is used to unscramble it, and it is not kept "
  + "anywhere, so nobody can look it up. A longer PIN is meaningfully harder to guess than a short one. "
  + "This protects against someone picking up your device. It is not proof against someone with time and "
  + "the right tools.";

/** ⚠ The sentence that must accompany enrolment, because the consequence is irreversible. */
export const LOCK_FORGOTTEN_NOTE =
  "If you forget this PIN there is no way to recover what is stored on this device — not by us, not by "
  + "your practice. You would sign in again with your password when you next have a connection, and the "
  + "day's list and your practice guidance would be fetched fresh. Anything you recorded while offline is "
  + "NOT protected by this PIN and is never lost this way.";

// ── POLICY ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ SIX, NOT FOUR. Four digits is 10,000 possibilities: at the cost below, a disk image falls in under an
 * hour, which is not a control, it is a speed bump with a lock icon. Six is the floor, and the strength
 * hint pushes past it.
 */
export const LOCK_MIN_LENGTH = 6;
export const LOCK_MAX_LENGTH = 64;

/** PBKDF2-SHA256. The only thing between a small secret and the plaintext, so it is deliberately slow. */
export const LOCK_ITERATIONS = 600_000;
export const LOCK_SALT_BYTES = 16;

/** Failures before the device stops accepting attempts at all (COMP-SEC-001 s10). */
export const LOCK_MAX_ATTEMPTS = 10;
/** Failures before each further attempt is delayed. Slows guessing without punishing a fat finger. */
export const LOCK_COOLDOWN_AFTER = 3;
export const LOCK_COOLDOWN_BASE_MS = 15_000;
export const LOCK_COOLDOWN_CAP_MS = 10 * 60 * 1000;

/**
 * COMP-SEC-001 s4 "offline session supported within configurable validity period" and "automatic session
 * timeout". How long an unlock lasts before the PIN is asked for again.
 */
export const LOCK_SESSION_MS = 15 * 60 * 1000;

export type LockState =
  /** No PIN has been set on this device. ⚠ Not the same as unlocked -- nothing is protected. */
  | "not_enrolled"
  | "locked"
  /** Too many recent failures; attempts refused until `retryAt`. */
  | "cooling_down"
  /** ⚠ TERMINAL ON THIS DEVICE. The caches are gone; the outbox is untouched. */
  | "locked_out"
  | "unlocked";

/** What is persisted about the lock. ⚠ The KEY is not here, and that is the point of the design. */
export type LockRecord = {
  salt: number[];
  iterations: number;
  /** A known plaintext sealed with the derived key. Opening it proves the PIN without storing it. */
  verifier: { iv: number[]; ciphertext: number[] };
  createdAt: string;
  failures: number;
  /** Set while cooling down. */
  retryAt: string | null;
  lockedOutAt: string | null;
};

/** The constant the verifier seals. Its value is irrelevant; that it decodes is the whole test. */
export const LOCK_VERIFIER_PLAINTEXT = "competen-practice-offline-lock-v1";

// ── PURE POLICY ─────────────────────────────────────────────────────────────────────────────────────

export type PinCheck = { ok: boolean; reason: string | null; strength: "weak" | "fair" | "strong" };

/**
 * ⚠ IT REPORTS STRENGTH RATHER THAN REFUSING ABOVE THE FLOOR. A practitioner forced through a password
 * policy at the start of a clinic picks the thing they can type fastest and writes it on the case. The
 * floor is enforced; beyond it the honest thing is to say what is stronger and let them choose.
 */
export function checkPin(pin: string): PinCheck {
  const trimmed = pin ?? "";
  if (trimmed.length < LOCK_MIN_LENGTH)
    return {
      ok: false, strength: "weak",
      reason: `A PIN needs at least ${LOCK_MIN_LENGTH} characters. Shorter than that can be guessed by someone who takes your device away with them.`,
    };
  if (trimmed.length > LOCK_MAX_LENGTH)
    return { ok: false, strength: "weak", reason: `A PIN can be at most ${LOCK_MAX_LENGTH} characters.` };
  if (/^(.)\1+$/.test(trimmed))
    return { ok: false, strength: "weak", reason: "That is the same character repeated, which is one of the first things anybody tries." };
  if (/^(?:0123456789|123456789|12345678|1234567|123456|654321|987654321)$/.test(trimmed))
    return { ok: false, strength: "weak", reason: "That is one of the most common PINs there is." };

  const hasLetters = /[a-z]/i.test(trimmed);
  const strength = hasLetters && trimmed.length >= 10 ? "strong"
    : hasLetters || trimmed.length >= 8 ? "fair" : "weak";
  return { ok: true, reason: null, strength };
}

export function lockCooldownMs(failures: number): number {
  if (failures < LOCK_COOLDOWN_AFTER) return 0;
  return Math.min(LOCK_COOLDOWN_CAP_MS, LOCK_COOLDOWN_BASE_MS * 2 ** (failures - LOCK_COOLDOWN_AFTER));
}

/** The state a stored record is in right now. ⚠ `null` means no PIN was ever set, not "unlocked". */
export function lockStateOf(record: LockRecord | null, now: Date): LockState {
  if (!record) return "not_enrolled";
  if (record.lockedOutAt) return "locked_out";
  if (record.retryAt && now.getTime() < Date.parse(record.retryAt)) return "cooling_down";
  return "locked";
}

/** Applied after a failed attempt. Returns the record to store. */
export function lockAfterFailure(record: LockRecord, now: Date): LockRecord {
  const failures = record.failures + 1;
  if (failures >= LOCK_MAX_ATTEMPTS)
    return { ...record, failures, retryAt: null, lockedOutAt: now.toISOString() };
  const wait = lockCooldownMs(failures);
  return { ...record, failures, retryAt: wait ? new Date(now.getTime() + wait).toISOString() : null };
}

/** Applied after a correct PIN. The counter resets -- a fat finger yesterday is not evidence today. */
export function lockAfterSuccess(record: LockRecord): LockRecord {
  return { ...record, failures: 0, retryAt: null };
}

export function lockAttemptsLeft(record: LockRecord): number {
  return Math.max(0, LOCK_MAX_ATTEMPTS - record.failures);
}

/**
 * What a person is told. ⚠ EVERY BRANCH SAYS WHAT HAPPENS TO CAPTURED WORK, because that is the fear the
 * screen has to answer and it is the one thing this lock never touches.
 */
export function lockMessage(state: LockState, record: LockRecord | null, now: Date): string {
  switch (state) {
    case "not_enrolled":
      return "No PIN is set on this device, so anything stored here can be read by anyone who opens this browser.";
    case "unlocked":
      return "This device is unlocked.";
    case "cooling_down": {
      const secs = record?.retryAt ? Math.max(1, Math.ceil((Date.parse(record.retryAt) - now.getTime()) / 1000)) : 0;
      return `Too many wrong attempts. Try again in ${secs} second${secs === 1 ? "" : "s"}. ${record ? lockAttemptsLeft(record) : 0} attempts remain before this device clears what it is holding.`;
    }
    case "locked_out":
      return "This device has cleared the day's list and the practice guidance it was holding, after too many wrong attempts. Anything you recorded while offline is untouched and still here. Sign in with your password when you have a connection to start again.";
    case "locked":
      return record && record.failures > 0
        ? `Enter your PIN. ${lockAttemptsLeft(record)} attempts remain before this device clears what it is holding.`
        : "Enter your PIN to see what is stored on this device.";
  }
}

/**
 * ⚠ WHAT A LOCKOUT DESTROYS, AS DATA RATHER THAN AS A COMMENT.
 *
 * The harness asserts this list never grows to include captured work. A lockout is allowed to be
 * destructive precisely because everything it destroys is a copy the practice still holds.
 */
export const LOCKOUT_CLEARS = ["cached clinic day", "cached practice guidance"] as const;
export const LOCKOUT_NEVER_CLEARS = ["the outbox", "captured encounters", "anything not yet synchronised"] as const;

// ── DERIVATION ──────────────────────────────────────────────────────────────────────────────────────

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("Web Crypto is not available in this browser, so a device PIN cannot be used.");
  return c.subtle;
};

const bytes = (n: number[]): Uint8Array => Uint8Array.from(n);

/**
 * PBKDF2 → AES-GCM, non-extractable.
 *
 * ⚠ `extractable: false` so the derived key cannot be read back out and cached somewhere convenient,
 * which would quietly undo the whole design: the point is that the key exists only while the session
 * lasts and only because somebody typed the PIN.
 */
export async function deriveLockKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export type EnrolResult =
  | { ok: true; record: LockRecord; key: CryptoKey }
  | { ok: false; reason: string };

/** Set a PIN on this device. ⚠ Returns the key so the caller can re-seal caches under it immediately. */
export async function enrolLock(pin: string, now: Date = new Date()): Promise<EnrolResult> {
  const check = checkPin(pin);
  if (!check.ok) return { ok: false, reason: check.reason ?? "That PIN cannot be used." };

  try {
    const salt = new Uint8Array(LOCK_SALT_BYTES);
    (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(salt);
    const key = await deriveLockKey(pin, salt, LOCK_ITERATIONS);

    const iv = new Uint8Array(12);
    (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(iv);
    const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key,
      new TextEncoder().encode(LOCK_VERIFIER_PLAINTEXT));

    return {
      ok: true, key,
      record: {
        salt: Array.from(salt), iterations: LOCK_ITERATIONS,
        verifier: { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ct)) },
        createdAt: now.toISOString(), failures: 0, retryAt: null, lockedOutAt: null,
      },
    };
  } catch (e) {
    return { ok: false, reason: `A PIN could not be set on this device: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}

export type UnlockResult =
  | { ok: true; key: CryptoKey; record: LockRecord }
  /** ⚠ `state` tells the caller whether to offer another try, wait, or stop. */
  | { ok: false; state: LockState; record: LockRecord; reason: string };

/**
 * Try a PIN.
 *
 * ⚠ IT REFUSES BEFORE DERIVING when cooling down or locked out. Deriving first would burn 600,000
 * iterations of the device's battery on an attempt that was never going to be accepted, and on a phone
 * in a clinic that is a real cost.
 */
export async function unlock(record: LockRecord, pin: string, now: Date = new Date()): Promise<UnlockResult> {
  const state = lockStateOf(record, now);
  if (state === "locked_out" || state === "cooling_down")
    return { ok: false, state, record, reason: lockMessage(state, record, now) };

  try {
    const key = await deriveLockKey(pin, bytes(record.salt), record.iterations);
    const opened = await subtle().decrypt(
      { name: "AES-GCM", iv: bytes(record.verifier.iv) as unknown as BufferSource },
      key, bytes(record.verifier.ciphertext) as unknown as BufferSource,
    ).then(b => new TextDecoder().decode(b)).catch(() => null);

    if (opened !== LOCK_VERIFIER_PLAINTEXT) {
      const next = lockAfterFailure(record, now);
      const nextState = lockStateOf(next, now);
      return { ok: false, state: nextState, record: next, reason: lockMessage(nextState, next, now) };
    }
    return { ok: true, key, record: lockAfterSuccess(record) };
  } catch (e) {
    // ⚠ A DERIVATION FAILURE IS NOT A WRONG PIN and must not consume an attempt. Counting it would let a
    // browser quirk lock somebody out of their own device.
    return {
      ok: false, state: lockStateOf(record, now), record,
      reason: `The PIN could not be checked on this device: ${String((e as Error)?.message ?? e).slice(0, 160)}`,
    };
  }
}

/** Whether an unlock from `at` is still valid at `now` (COMP-SEC-001 s4's session timeout). */
export function lockSessionValid(unlockedAt: string | null, now: Date): boolean {
  if (!unlockedAt) return false;
  const elapsed = now.getTime() - Date.parse(unlockedAt);
  return elapsed >= 0 && elapsed < LOCK_SESSION_MS;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE KEY-ENCRYPTION-KEY, AND WHY THE OBVIOUS DESIGN CANNOT WORK.
//
// The first attempt (2026-08-11, built and reverted) derived a key from the PIN and sealed the caches
// with it directly. That fails on a fact about where the two halves live:
//
//   THE WRITER  OfflineCacheWriter, inside the practice (shell). Online, on every page load.
//   THE READER  /practice/offline, OUTSIDE the shell so it renders with no connection.
//
// A PIN typed on the reader gives the READER a key. The writer, elsewhere, has none -- so it keeps
// sealing with the old random key, the reader cannot decrypt, and `loadOfflineDay` DELETES what it
// cannot decrypt. Setting a PIN would have destroyed every cached day and protocol.
//
// ⚠ AND A DERIVED KEY CANNOT SIMPLY BE KEPT. A non-extractable CryptoKey cannot be serialised, so it
// cannot survive a page load; and storing it WOULD put the key back beside the ciphertext, which is the
// whole thing the PIN was for.
//
// THE STANDARD SHAPE, AND THE ONE BUILT HERE:
//
//   PIN + salt --PBKDF2--> KEK        never stored, never leaves memory, re-derived on each unlock
//   random data key                   wraps under the KEK
//   WRAPPED BYTES                     this is what is stored, and it is useless without the PIN
//   unlock: derive KEK -> unwrap      the data key lives in memory for the session
//
// The data key is the one the caches are actually sealed with, so BOTH halves can hold it once the
// session is unlocked -- which is what makes a single PIN prompt serve the writer and the reader alike.
//
// ⚠ THE DATA KEY IS EXTRACTABLE, AND THAT IS NOT AN OVERSIGHT. It has to be, to be wrapped at all. The
// honest reading is offline-crypto.ts's: script running as this origin can decrypt with a
// non-extractable key anyway, so extractability changes the cost of an attack that has already
// succeeded, not whether it succeeds. What the KEK genuinely changes is the case the PIN is FOR -- a
// device examined without script execution, where the ciphertext is now useless on its own.

/** AES-KW wrapping key derived from the PIN. ⚠ Never stored, in any form. */
export async function deriveKek(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    base, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

/**
 * A fresh data key, and its wrapped form.
 *
 * ⚠ THE CALLER STORES ONLY `wrapped`. Writing the key itself anywhere would undo the entire design, and
 * this function deliberately returns them together so the mistake has to be made in plain sight.
 */
export async function newWrappedDataKey(kek: CryptoKey): Promise<{ key: CryptoKey; wrapped: number[] }> {
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrapped = await subtle().wrapKey("raw", key, kek, "AES-KW");
  return { key, wrapped: Array.from(new Uint8Array(wrapped)) };
}

/**
 * ⚠ NULL ON FAILURE, NEVER A THROW. A wrong PIN produces a KEK that cannot unwrap, and AES-KW's
 * integrity check rejects. The caller must treat that exactly as a wrong PIN -- which it is -- rather
 * than as a fault, or a mistyped digit would read as a broken device.
 */
export async function unwrapDataKey(kek: CryptoKey, wrapped: number[]): Promise<CryptoKey | null> {
  try {
    return await subtle().unwrapKey(
      "raw", Uint8Array.from(wrapped) as unknown as BufferSource, kek, "AES-KW",
      { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

/**
 * ⚠ CHANGING THE PIN MUST NOT RE-KEY THE DATA. The data key is unwrapped with the old PIN and re-wrapped
 * with the new one -- the caches are never touched, so a PIN change costs nothing and loses nothing.
 * Generating a fresh data key instead would silently orphan every cached record, which is the same
 * failure this whole module exists to avoid.
 */
export async function rewrapDataKey(dataKey: CryptoKey, newKek: CryptoKey): Promise<number[]> {
  const wrapped = await subtle().wrapKey("raw", dataKey, newKek, "AES-KW");
  return Array.from(new Uint8Array(wrapped));
}
