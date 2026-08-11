"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LOCKOUT_CLEARS, LOCKOUT_NEVER_CLEARS, LOCK_FORGOTTEN_NOTE, LOCK_HONEST_NOTE, LOCK_MIN_LENGTH,
  checkPin, enrolLock, lockMessage, unlock, type LockRecord, type LockState,
} from "@/lib/practice/offline-lock";
import { forgetLock, loadLock, saveLock } from "@/lib/practice/offline-lock-store";
import { holdSessionKey, sessionKey } from "@/lib/practice/offline-session";
import { lastCachedWorkspace, purgeOfflineWorkspace } from "@/lib/practice/offline-store";

// CP-OFFLINE-SURVEY-001 s5 precondition 0 — the PIN, on screen, in the two places it is needed.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ IT NEVER BLOCKS THE PRODUCT. THIS IS THE DESIGN DECISION THE WHOLE COMPONENT TURNS ON.
//
// The PIN protects the OFFLINE COPY. It is not an application login and must never behave like one: a
// practitioner sitting in front of a working connection has no reason to be stopped by a device
// credential, and a full-screen gate in the shell would be a second sign-in for something that is not
// signing in.
//
// So a locked device simply STOPS MAINTAINING A COPY, and says so in one line. The clinic runs exactly
// as it did. What is lost by ignoring this prompt is tomorrow's offline day, not today's work.
//
// ⚠ AND IT NEVER TOUCHES THE OUTBOX. The user's decision of 2026-08-10: the PIN gates copies, never
// captured work. This module does not import outbox-store, and the harness asserts it.
//
// ── WHY THE SAME COMPONENT SERVES BOTH SURFACES ─────────────────────────────────────────────────────
//
// The shell needs the key to WRITE the cache; /practice/offline needs it to READ. They are separate
// documents, so each asks for the PIN on its own -- which is once per tab, as decided, and is the honest
// consequence of never persisting the key.
//
//   variant="inline"  a quiet line in the shell. Ignoring it is a supported choice.
//   variant="page"    the offline page, where there is nothing to see until it is unlocked.

type Props = {
  variant: "inline" | "page";
  /** Called whenever the key becomes available, so the caller can cache or read with it. */
  onUnlocked?: (key: CryptoKey) => void;
  /** Rendered under the prompt on the offline page once unlocked. */
  children?: React.ReactNode;
};

export default function DeviceLockPrompt({ variant, onUnlocked, children }: Props) {
  const [record, setRecord] = useState<LockRecord | null>(null);
  const [state, setState] = useState<LockState | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reread = useCallback(async () => {
    const loaded = await loadLock(new Date());
    setRecord(loaded.record); setDetail(loaded.detail);
    // ⚠ A key already held by this tab means unlocked, whatever the stored record says. The record does
    // not know about this tab; the session holder does.
    const held = sessionKey();
    if (held) { setUnlocked(true); setState("unlocked"); onUnlocked?.(held); return; }
    setUnlocked(false); setState(loaded.state);
  }, [onUnlocked]);

  useEffect(() => { queueMicrotask(() => { void reread(); }); }, [reread]);

  const strength = checkPin(pin);

  async function doEnrol() {
    setProblem(null);
    if (pin !== confirmPin) { setProblem("The two PINs are not the same."); return; }
    const check = checkPin(pin);
    if (!check.ok) { setProblem(check.reason ?? "That PIN cannot be used."); return; }
    setBusy(true);
    const made = await enrolLock(pin, new Date());
    if (!made.ok) { setBusy(false); setProblem(made.reason); return; }
    const saved = await saveLock(made.record);
    if (!saved.ok) { setBusy(false); setProblem(saved.reason ?? "The PIN could not be saved."); return; }

    // ⚠ WHAT IS ALREADY CACHED WAS SEALED UNDER A RANDOM KEY AND MUST GO. Once the PIN becomes the only
    // way in, those records could never be opened again -- they would sit on the disk as ciphertext
    // nobody can account for. They are COPIES, so clearing them costs one reconnection.
    // ⚠ purgeOfflineWorkspace touches the CACHE database only. The outbox is a different database and is
    // not reachable from here.
    const ws = await lastCachedWorkspace();
    if (ws) await purgeOfflineWorkspace(ws);

    holdSessionKey(made.key, new Date());
    setBusy(false); setPin(""); setConfirmPin(""); setEnrolling(false);
    setNotice("A PIN is now set on this device. What was already stored here has been cleared and will be fetched again while you are online.");
    onUnlocked?.(made.key);
    void reread();
  }

  async function doUnlock() {
    if (!record) return;
    setBusy(true); setProblem(null);
    const result = await unlock(record, pin, new Date());
    setBusy(false);
    // The attempt counter moved either way, so it is saved either way -- else a reload resets it.
    await saveLock(result.record);
    if (!result.ok) {
      setRecord(result.record); setState(result.state); setProblem(result.reason);
      // ⚠ A LOCKOUT CLEARS THE CACHES AND NOTHING ELSE.
      if (result.state === "locked_out") {
        const ws = await lastCachedWorkspace();
        if (ws) await purgeOfflineWorkspace(ws);
      }
      setPin("");
      return;
    }
    holdSessionKey(result.key, new Date());
    setRecord(result.record); setState("unlocked"); setUnlocked(true); setPin("");
    onUnlocked?.(result.key);
  }

  async function doForget() {
    setBusy(true);
    const ws = await lastCachedWorkspace();
    if (ws) await purgeOfflineWorkspace(ws);
    await forgetLock();
    setBusy(false); setUnlocked(false);
    setNotice("The PIN has been removed from this device, and what was stored under it has been cleared.");
    void reread();
  }

  // ── THE OFFLINE PAGE: nothing to show until it is open ───────────────────────────────────────────
  if (variant === "page") {
    if (state === "not_enrolled" || unlocked) return <>{children}</>;
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-gray-900">This device is locked</h1>
        {detail && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{detail}</p>
        )}
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700">
          {state === null ? "Checking this device…" : lockMessage(state, record, new Date())}
        </p>
        {/* ⚠ SAID ON THE LOCK SCREEN, WHERE THE FEAR IS. Somebody who has forgotten their PIN needs to
            know what they have and have not lost BEFORE they start guessing. */}
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] leading-relaxed text-gray-700">
          <p><strong>Cleared if this locks out:</strong> {LOCKOUT_CLEARS.join(", ")} — copies the practice still holds.</p>
          <p className="mt-1"><strong>Never cleared:</strong> {LOCKOUT_NEVER_CLEARS.join(", ")}.</p>
        </div>
        {state !== "locked_out" && (
          <div className="mt-3 flex flex-col gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-600">Your PIN</span>
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} autoComplete="current-password"
                onKeyDown={e => { if (e.key === "Enter") void doUnlock(); }}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)]" />
            </label>
            {problem && <p className="text-[12px] text-rose-700">{problem}</p>}
            <button type="button" disabled={busy || state === "cooling_down"} onClick={doUnlock}
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
              {busy ? "Checking…" : "Unlock"}
            </button>
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
          Signing in again with your password when you have a connection always works. The PIN only opens
          what is already stored here.
        </p>
      </div>
    );
  }

  // ── THE SHELL: one quiet line, never a wall ──────────────────────────────────────────────────────
  if (notice) return <p className="text-[10.5px] text-gray-400">{notice}</p>;

  if (state === "not_enrolled") {
    if (!enrolling)
      return (
        <p className="text-[10.5px] text-gray-400">
          No PIN is set on this device, so anything held here for offline use can be read by anyone who
          opens this browser.{" "}
          <button type="button" onClick={() => setEnrolling(true)} className="underline hover:text-gray-600">
            Set a PIN
          </button>
        </p>
      );
    return (
      <div className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-[12px] leading-relaxed text-gray-700">{LOCK_HONEST_NOTE}</p>
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
          {LOCK_FORGOTTEN_NOTE}
        </p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-600">
            A PIN for this device (at least {LOCK_MIN_LENGTH} characters)
          </span>
          <input type="password" value={pin} onChange={e => setPin(e.target.value)} autoComplete="new-password"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)]" />
        </label>
        {pin && (
          <p className={`text-[11px] ${strength.ok ? "text-gray-600" : "text-rose-700"}`}>
            {strength.ok ? `Strength: ${strength.strength}. Longer is meaningfully harder to guess.` : strength.reason}
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-600">Type it again</span>
          <input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} autoComplete="new-password"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)]" />
        </label>
        {problem && <p className="text-[12px] text-rose-700">{problem}</p>}
        <span className="flex gap-2">
          <button type="button" disabled={busy} onClick={doEnrol}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            {busy ? "Setting…" : "Set this PIN"}
          </button>
          <button type="button" onClick={() => { setEnrolling(false); setPin(""); setConfirmPin(""); setProblem(null); }}
            className="text-[12px] text-gray-500 hover:underline">Cancel</button>
        </span>
      </div>
    );
  }

  if (unlocked)
    return (
      <p className="text-[10.5px] text-gray-400">
        This device is unlocked, so the offline copy is being kept up to date.{" "}
        <button type="button" disabled={busy} onClick={doForget} className="underline hover:text-gray-600">
          Remove the PIN and clear what is stored
        </button>
      </p>
    );

  // Locked, cooling down or locked out. ⚠ One line and an input -- never a wall.
  return (
    <div className="mt-1 max-w-md">
      <p className="text-[10.5px] leading-relaxed text-gray-500">
        {state ? lockMessage(state, record, new Date()) : "Checking this device…"}{" "}
        <span className="text-gray-400">
          Until it is unlocked, nothing new is stored for offline use. Today&rsquo;s work is unaffected.
        </span>
      </p>
      {state !== "locked_out" && (
        <span className="mt-1 flex items-center gap-2">
          <input type="password" value={pin} onChange={e => setPin(e.target.value)} autoComplete="current-password"
            onKeyDown={e => { if (e.key === "Enter") void doUnlock(); }} placeholder="PIN"
            className="w-36 rounded border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-[var(--cp-primary)]" />
          <button type="button" disabled={busy || state === "cooling_down"} onClick={doUnlock}
            className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 disabled:opacity-40">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </span>
      )}
      {problem && <p className="mt-1 text-[11px] text-rose-700">{problem}</p>}
    </div>
  );
}
