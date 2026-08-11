"use client";

import { lockSessionValid } from "@/lib/practice/offline-lock";

// CP-OFFLINE-SURVEY-001 s5 precondition 0 — where the unlocked data key lives while a session lasts.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ MODULE STATE, ON PURPOSE, AND IT IS THE ONLY PLACE THIS KEY MAY EXIST.
//
// The user's decision of 2026-08-11: the PIN is typed once per tab, then again after the practice's idle
// period. That requires the unwrapped data key to outlive a React component and survive navigation --
// and Next moves between pages inside a tab CLIENT-SIDE, so a module-level variable does exactly that
// and nothing more.
//
// ⚠ WHAT IT MUST NEVER DO IS PERSIST. Not sessionStorage, not localStorage, not IndexedDB. Writing it
// anywhere puts the key back beside the ciphertext and undoes the entire point of wrapping it -- a
// CryptoKey cannot even be serialised without being extractable, and the moment somebody works around
// that, the PIN protects nothing. A hard reload losing the key is the DESIGN, not a defect: it is what
// makes "once per tab" mean anything.
//
// ⚠ AND IT IS NOT SHARED WITH THE OFFLINE PAGE. /practice/offline is a separate document with its own
// module instances, so it asks for the PIN itself. That is correct rather than unfortunate: it is a
// different page load, reached at a different moment, and the alternative would be persisting the key.

let dataKey: CryptoKey | null = null;
let unlockedAt: string | null = null;

/** Hold the key for this tab. Called only by the unlock prompt, immediately after a successful unwrap. */
export function holdSessionKey(key: CryptoKey, at: Date = new Date()): void {
  dataKey = key;
  unlockedAt = at.toISOString();
}

/**
 * The key, or null when there is none or the session has aged out.
 *
 * ⚠ THE TIMEOUT IS CHECKED ON EVERY READ, not by a timer. A timer that fired while the tab was
 * backgrounded would be unreliable in exactly the case that matters -- a phone in a pocket -- and a
 * timer that did not fire would leave the key live past its window without anybody noticing.
 */
export function sessionKey(now: Date = new Date()): CryptoKey | null {
  if (!dataKey) return null;
  if (!lockSessionValid(unlockedAt, now)) { clearSessionKey(); return null; }
  return dataKey;
}

/** When this tab was unlocked, or null. Read-only; the screen uses it to say how long is left. */
export function sessionUnlockedAt(): string | null {
  return unlockedAt;
}

/**
 * Forget the key.
 *
 * ⚠ CALLED ON SIGN-OUT AND ON LOCKOUT, and it is not a substitute for either of those doing their own
 * work: this drops a handle in memory and touches no stored data. The caches are cleared by
 * purgeOfflineWorkspace, and the outbox is never cleared by anything here.
 */
export function clearSessionKey(): void {
  dataKey = null;
  unlockedAt = null;
}
