"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOCKOUT_CLEARS, LOCKOUT_NEVER_CLEARS, LOCK_FORGOTTEN_NOTE, LOCK_HONEST_NOTE, LOCK_MIN_LENGTH,
  checkPin, enrolLock, lockMessage, lockStateOf, unlock, type LockRecord, type LockState,
} from "@/lib/practice/offline-lock";
import { forgetLock, loadLock, saveLock } from "@/lib/practice/offline-lock-store";
import { clearSessionKey, holdSessionKey, sessionKey } from "@/lib/practice/offline-session";
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

  // ⚠⚠ onUnlocked IS HELD IN A REF, AND THAT IS NOT A STYLE CHOICE -- IT IS AN INFINITE LOOP FIX.
  //
  // `reread` used to close over onUnlocked and list it as a dependency, and the effect below depends on
  // `reread`. OfflineCacheWriter passes `onUnlocked={() => setAttempt(a => a + 1)}` -- a NEW ARROW ON
  // EVERY RENDER. So: render -> new callback identity -> new reread -> effect re-runs -> it finds a held
  // key -> calls onUnlocked -> setAttempt -> render. Measured on a real device at roughly 160 iterations
  // per second, `attempt` climbing from 2 to 3,875 in 24 seconds.
  //
  // ⚠ AND IT WAS DORMANT UNTIL AN UNLOCK SUCCEEDED, because the onUnlocked call sits behind `if (held)`.
  // A locked device is fine; the loop starts the instant the PIN is accepted. That is why it presented
  // as "unlocking does nothing": the writer's own effect was torn down and restarted on every one of
  // those renders (its probe recorded cancelled:true every time), so it reached the cache step never,
  // while the key it needed was sitting right there -- sessionKeyNull:false in all 2,540 samples.
  //
  // The ref means a caller that does not memoise cannot restart this component's effects. Depending on
  // a parent to wrap a handler in useCallback is a contract nobody can see and everybody breaks.
  const onUnlockedRef = useRef(onUnlocked);
  useEffect(() => { onUnlockedRef.current = onUnlocked; }, [onUnlocked]);

  const reread = useCallback(async () => {
    const loaded = await loadLock(new Date());
    setRecord(loaded.record); setDetail(loaded.detail);
    // ⚠ A key already held by this tab means unlocked, whatever the stored record says. The record does
    // not know about this tab; the session holder does.
    const held = sessionKey();
    if (held) { setUnlocked(true); setState("unlocked"); onUnlockedRef.current?.(held); return; }
    setUnlocked(false); setState(loaded.state);
    // ⚠ A NOTICE DESCRIBES A COMPLETED ACTION, SO IT EXPIRES WHEN THE DEVICE RE-LOCKS. "A PIN is now set
    // on this device... will be fetched again while you are online" is true the moment it is written and
    // stale once the session has timed out. Carrying it onto a locked screen would have the product
    // reassuring somebody about a copy while asking them to unlock the thing holding it.
    // ⚠ Cleared HERE, in the callback that observes the transition -- not in an effect keyed on `state`,
    // which is a setState-in-effect cascade and is rejected by the lint rule for good reason.
    if (loaded.state !== "not_enrolled") setNotice(null);
    // ⚠ NO DEPENDENCIES. Everything this reads is either module state or a ref; adding onUnlocked back
    // reinstates the loop above.
  }, []);

  useEffect(() => { queueMicrotask(() => { void reread(); }); }, [reread]);

  // ════════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ THE COUNTDOWN HAS TO TICK, OR THE BUTTON NEVER COMES BACK.
  //
  // A cooldown rendered the sentence "Try again in 15 seconds" ONCE and then nothing re-ran. `state`
  // stayed "cooling_down" for ever, so `disabled={busy || state === "cooling_down"}` stayed true for
  // ever: after three mistyped digits the only way to get a fourth attempt was to RELOAD THE PAGE.
  //
  // ⚠ Which offline is the one thing a practitioner cannot safely be told to do -- and the screen never
  // told them to. It simply sat there counting down to a moment that never arrived. The owner reached it
  // on 2026-08-11 on their third attempt.
  //
  // It ticks off the record already in memory, so no store is read once a second; the interval exists
  // only while cooling down and clears itself the moment the wait is over.
  // ════════════════════════════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (state !== "cooling_down" || !record) return;
    const id = setInterval(() => {
      const now = new Date();
      const next = lockStateOf(record, now);
      // Still waiting: rewrite the message so the seconds visibly count down rather than freezing.
      if (next === "cooling_down") { setProblem(lockMessage(next, record, now)); return; }
      // The wait is over. The error goes with it -- leaving it up would say "try again in 0 seconds".
      setState(next); setProblem(null);
    }, 1000);
    return () => clearInterval(id);
  }, [state, record]);

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
    // ⚠ THIS USED TO BE `if (!record) return;` -- A SILENT NO-OP, and the control stayed enabled while
    // the record loaded. Pressing Unlock before it arrived did nothing at all: no message, no failure
    // recorded, nothing on screen. Somebody typing a correct PIN and pressing Enter three times has no
    // way to tell that from a PIN that was refused, and the attempt counter stays where it was, so even
    // the trail cannot tell you afterwards. Now it says so, and the buttons below are disabled until
    // the record exists, so the sentence should be unreachable rather than merely informative.
    if (!record) {
      setProblem("This device is still being checked. Try again in a moment.");
      return;
    }
    // ⚠ AN EMPTY BOX IS NOT A WRONG PIN, AND IT MUST NOT COST AN ATTEMPT. unlock() treats "" as a
    // mismatch, which increments failures against a counter that CLEARS WHAT THE DEVICE IS HOLDING when
    // it runs out. A stray Enter on an empty field should never move a destructive counter, so it is
    // refused here, before the attempt is spent.
    if (pin.length === 0) {
      setProblem("Enter your PIN first. An empty box is not counted as a failed attempt.");
      return;
    }
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
    // ════════════════════════════════════════════════════════════════════════════════════════════════
    // ⚠⚠ THE KEY IN MEMORY MUST GO WITH THE RECORD THAT WRAPS IT, AND IT USED NOT TO.
    //
    // forgetLock() deletes the stored record. The unwrapped data key sat in module state untouched, and
    // TWO things followed from that, both silent:
    //
    //   1. reread() consults sessionKey() BEFORE the stored state, so a device whose PIN had just been
    //      removed still reported "This device is unlocked" -- offering to remove a PIN that was
    //      already gone, and never offering to set a new one.
    //   2. ⚠ WORSE: the writer kept sealing new records under a key whose wrapping record no longer
    //      existed. Nothing could unwrap them after a reload, so loadOfflineDay would delete them on
    //      sight -- the device filling with ciphertext nobody can account for, which is precisely the
    //      "rubble" the writer's own comment says it holds off to avoid.
    // ════════════════════════════════════════════════════════════════════════════════════════════════
    clearSessionKey();
    setBusy(false); setUnlocked(false);
    setNotice("The PIN has been removed from this device, and what was stored under it has been cleared.");
    void reread();
  }

  // ── THE OFFLINE PAGE: nothing to show until it is open ───────────────────────────────────────────
  if (variant === "page") {
    if (state === "not_enrolled" || unlocked) return <>{children}</>;

    // ⚠ NOTHING IS ASSERTED UNTIL THE DEVICE HAS BEEN READ. `state` is null on the server and until the
    // first store read resolves, and this branch used to fall through to the heading below -- so EVERY
    // visitor, including one with no PIN set at all, was served "This device is locked" and then had it
    // swapped out on hydration. Measured in the rendered HTML on 2026-08-11: the phrase is in the server
    // response for a device the server knows nothing about. A screen may not name a state it has not
    // checked; that is the same rule as the checklist that described the saved document.
    if (state === null)
      return <p className="text-[12.5px] leading-relaxed text-gray-600">Checking this device&hellip;</p>;

    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-gray-900">This device is locked</h1>
        {detail && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{detail}</p>
        )}
        {/* ⚠ THE SAME SENTENCE WAS PRINTED TWICE -- grey here, red below -- because a failed unlock puts
            the state message into `problem` as well. The owner's screenshot of 2026-08-11 shows "Too many
            wrong attempts. Try again in 15 seconds. 7 attempts remain..." rendered word for word in both
            places. Whichever is showing, it says the current state once.
            ⚠ AND THE ERROR IS RENDERED HERE, OUTSIDE THE INPUT BLOCK, not inside it. It used to live
            beside the field -- which a LOCKOUT hides -- so suppressing this line without moving that one
            would have left a locked-out device explaining nothing. */}
        {problem ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-rose-700">{problem}</p>
        ) : (
          // `state` cannot be null here -- the branch above returns on null.
          <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700">
            {lockMessage(state, record, new Date())}
          </p>
        )}
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
            {/* disabled until the record loads: see doUnlock for the no-op this prevents. */}
            <button type="button" disabled={busy || !record || state === "cooling_down"} onClick={doUnlock}
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
              {busy ? "Checking…" : !record ? "Checking this device…" : "Unlock"}
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
  //
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ THIS USED TO BE `if (notice) return <p>{notice}</p>` -- AN EARLY RETURN, ABOVE EVERYTHING.
  //
  // A notice is set by exactly two actions: enrolling a PIN, and removing one. Once either had
  // happened, that one static sentence replaced the ENTIRE prompt for the life of the component, and
  // nothing ever cleared it.
  //
  // ⚠ SO ENROLLING A PIN REMOVED THE ONLY WAY TO USE IT. The unlock session lasts LOCK_SESSION_MS --
  // fifteen minutes. When it expired the writer correctly reported `locked` and rendered this prompt
  // to get the practitioner back in, and this prompt answered with "A PIN is now set on this
  // device..." and NO INPUT. The device then stored nothing for the rest of the tab, with no visible
  // control to change that and no sentence saying anything was wrong. Removing a PIN had the mirror
  // failure: the "Set a PIN" affordance vanished permanently.
  //
  // It is now a line rendered BESIDE the live state, never in place of it. The state always wins,
  // because the state is the thing with a control attached.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const noticeLine = notice
    ? <p className="text-[10.5px] leading-relaxed text-gray-400">{notice}</p>
    : null;

  if (state === "not_enrolled") {
    if (!enrolling)
      return (
        <div className="flex flex-col gap-1">
          {/* ⚠ BESIDE, NOT INSTEAD OF. Removing a PIN sets a notice, and while that notice replaced this
              branch the practitioner could never set another one. */}
          {noticeLine}
          <p className="text-[10.5px] text-gray-400">
            No PIN is set on this device, so anything held here for offline use can be read by anyone who
            opens this browser.{" "}
            <button type="button" onClick={() => setEnrolling(true)} className="underline hover:text-gray-600">
              Set a PIN
            </button>
          </p>
        </div>
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
      <div className="flex flex-col gap-1">
        {/* Enrolment's notice lands here -- it says the device was cleared and will be fetched again.
            ⚠ The CONFIRMATION that it came back is the writer's own line, not this one: this component
            knows about the PIN and nothing about what was stored under it. Claiming a copy exists from
            here would be asserting something this file cannot see. */}
        {noticeLine}
        <p className="text-[10.5px] text-gray-400">
          This device is unlocked, so the offline copy is being kept up to date.{" "}
          <button type="button" disabled={busy} onClick={doForget} className="underline hover:text-gray-600">
            Remove the PIN and clear what is stored
          </button>
        </p>
      </div>
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
          <button type="button" disabled={busy || !record || state === "cooling_down"} onClick={doUnlock}
            className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 disabled:opacity-40">
            {busy ? "Checking…" : !record ? "Checking…" : "Unlock"}
          </button>
        </span>
      )}
      {problem && <p className="mt-1 text-[11px] text-rose-700">{problem}</p>}
    </div>
  );
}
