"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  idleDecision, shouldHeartbeat, SESSION_ACTIVITY_EVENTS, SESSION_PREVIEW_EVENT,
  IDLE_OBSERVATION_MINUTES, LOCK_CAUSE, LOCK_SCREEN_TRUTHS, RESUME_METHODS_NOT_BUILT, LOCK_ESCAPE_LABEL,
  type IdlePhase, type SessionLimits, type LockCause,
} from "@/lib/practice/session-engine";

// The browser half of COMP-AUTH-001's session lifecycle: activity detection, the sixty-second warning,
// the lock screen, and Clinical Pause Mode.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHAT THIS DOES ON THE DAY IT SHIPS, FOR EVERY PRACTICE THAT EXISTS: A PAUSE BUTTON, AND NOTHING ELSE.
//
// The one live `practice_security_policy` row carries `session_idle_minutes: null`, so `limits.mode` is
// OBSERVE everywhere. In OBSERVE nothing counts down, nothing is covered, nothing is refused and not one
// heartbeat is sent -- `shouldHeartbeat` returns false outside ENFORCE, which is what keeps this from
// adding a request per tab per two minutes to a product where it would buy nothing. The only thing that
// happens is one audit row per idle stretch longer than thirty minutes, which is the measurement
// COMP-SECURITY-SURVEY-001 s6.5 asks for BEFORE anybody enforces anything.
//
// A practice that sets an idle limit gets the warning, the countdown and the cover. A practice whose
// policy could not be read gets mode UNKNOWN, and UNKNOWN does nothing at all -- a control that cannot
// run must not act.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NO DECISION IS MADE IN THIS FILE. Every one comes from `session-engine.ts`, which is pure and proved
// by a harness. What lives here is listeners, timers and markup -- the parts that cannot be tested
// without a browser -- and they are deliberately dull.
//
// ⚠ AND THE COVER IS A COVER. It is drawn over the page, the page is not re-rendered or navigated away
// from, and nothing typed into a half-finished note is discarded. That is what makes "restore the exact
// workspace after unlock" true here without a single line of state restoration: there is nothing to
// restore, because nothing was taken away. It is also why the screen says plainly that somebody holding
// the device can get behind it with developer tools. It hides a record from the room; it is not a
// boundary, and this product has already shipped one screen that claimed more than it did.
//
// ⚠ WHY EVERY TIMER VALUE IS A REF AND THE WHOLE OF THE RENDER COMES OUT OF ONE `view` OBJECT.
//
// Idle time changes a thousand times a second and is rendered about once. Keeping it in state would
// re-render the entire Practice shell on every scroll event; reading a ref during render is what React's
// own rule forbids and is unsound under concurrent rendering. So the clock, the marks and the outcome of
// every decision are computed in ONE callback on a timer, which is the only place refs are read, and the
// component renders whatever that callback last published. The publish deliberately bails out when
// nothing visible changed, so an ordinary working session re-renders NOT AT ALL between warnings.

const STORAGE_KEY = "practice.session.lock";
/** A stored cover older than this is ignored on mount. See the note where it is read. */
const STORED_LOCK_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** The clock. One evaluation a second; publishing is what is rationed, not ticking. */
const TICK_MS = 1000;

type Stored = { cause: LockCause; at: number };

/** Everything the markup below reads. Nothing else may reach it. */
type View = {
  phase: IdlePhase;
  /** ⚠ ONLY DURING "WARNING". Carrying it in every phase would re-render the shell once a second for ever. */
  secondsToLock: number | null;
  previewing: boolean;
  previewLocked: boolean;
  lockedCause: LockCause | null;
};

const sameView = (a: View | null, b: View): boolean =>
  !!a && a.phase === b.phase && a.secondsToLock === b.secondsToLock && a.previewing === b.previewing
  && a.previewLocked === b.previewLocked && a.lockedCause === b.lockedCause;

async function say(action: string, extra: Record<string, unknown> = {}): Promise<Response | null> {
  try {
    return await fetch("/api/v1/practice/security/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }), keepalive: true,
    });
  } catch {
    // ⚠ A REPORT THAT DID NOT ARRIVE MUST NOT CHANGE WHAT THE SCREEN DOES. The cover is drawn because
    // the person has been away, not because a POST succeeded; failing to tell the server is a gap in the
    // audit trail (named in AUTH_EVENTS_NOT_RECORDED_HERE) and never a reason to leave a record on show.
    return null;
  }
}

export default function PracticeSessionGuard({ limits }: { limits: SessionLimits }) {
  const [view, setView] = useState<View | null>(null);

  const lastActivity = useRef(0);
  const lastBeat = useRef(0);
  const activeSinceBeat = useRef(false);
  const observedStretch = useRef<number | null>(null);
  const beating = useRef(false);
  const locked = useRef<Stored | null>(null);
  const previewStartedAt = useRef<number | null>(null);

  /**
   * The one place refs are read, the one place a decision has consequences, and the only writer of `view`.
   *
   * Called from a timer and from event handlers. Never from render.
   */
  const evaluate = useCallback(() => {
    const t = Date.now();
    const preview = previewStartedAt.current;
    const previewing = preview !== null;

    // ── the real clock ────────────────────────────────────────────────────────────────────────────
    const idleMs = Math.max(0, t - lastActivity.current);
    const real = idleDecision({ idleMs, limits });

    // ── the rehearsal's synthetic clock, started at the warning boundary so it takes a minute rather
    //    than half an hour ──────────────────────────────────────────────────────────────────────────
    //
    // Its limits: this practice's own number where it has one, COMP-AUTH-001's thirty-minute default
    // where it has not, and always ENFORCE -- the whole point is to see what enforcing would look like.
    const previewLimits: SessionLimits = {
      ...limits, mode: "ENFORCE", idleMinutes: limits.idleMinutes ?? IDLE_OBSERVATION_MINUTES,
    };
    const lockAtMs = (previewLimits.idleMinutes ?? IDLE_OBSERVATION_MINUTES) * 60_000;
    const rehearsal = previewing
      ? idleDecision({
        idleMs: lockAtMs - previewLimits.warningSeconds * 1000 + (t - preview),
        limits: previewLimits,
      })
      : null;

    // ── consequences. NONE of them during a rehearsal: a preview that recorded a lock, sent a beat or
    //    covered the screen for real would be a control rather than a look at one ────────────────────
    if (!previewing) {
      if (real.phase === "LOCK" && !locked.current) {
        const entry: Stored = { cause: LOCK_CAUSE.IDLE, at: t };
        locked.current = entry;
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry)); } catch { /* ignore */ }
        void say("locked", { cause: LOCK_CAUSE.IDLE });
      }

      // The measurement, OBSERVE only. One row per idle STRETCH: the stretch is identified by the
      // activity mark it began from, so a reported stretch is not reported again on the next tick, and
      // a fresh stretch after the person came back and left again is a fresh row -- which is what makes
      // the count answer "how often would this have happened".
      if (real.phase === "OBSERVED" && !locked.current && observedStretch.current !== lastActivity.current) {
        observedStretch.current = lastActivity.current;
        void say("idle_observed", { idleMinutes: Math.round(idleMs / 60_000) });
      }

      // ⚠ THIS IS WHAT STOPS AN IDLE LIMIT LOCKING SOMEBODY OUT MID-NOTE. `last_seen_at` used to move
      // only on a full page load, so twenty-five minutes of continuous typing on one page looked exactly
      // like twenty-five minutes of an abandoned desk. `shouldHeartbeat` requires ACTIVITY since the last
      // beat -- a timer alone would keep every forgotten tab alive for ever and quietly retire the rule.
      if (!beating.current && shouldHeartbeat({
        activeSinceLastBeat: activeSinceBeat.current,
        msSinceLastBeat: t - lastBeat.current,
        locked: locked.current !== null,
        limits,
      })) {
        beating.current = true;
        activeSinceBeat.current = false;
        lastBeat.current = t;
        void say("heartbeat").then(res => {
          beating.current = false;
          // 423 is the server saying this device is no longer allowed in -- revoked by a person, or
          // idled out before the beat arrived. /practice/access-status names which and carries the way
          // back for the one that has one.
          if (res && res.status === 423) window.location.assign("/practice/access-status");
        });
      }
    }

    const phase = previewing ? (rehearsal?.phase ?? "ACTIVE") : real.phase;
    const next: View = {
      phase,
      secondsToLock: phase === "WARNING"
        ? (previewing ? rehearsal?.secondsToLock ?? null : real.secondsToLock)
        : null,
      previewing,
      previewLocked: previewing && rehearsal?.phase === "LOCK",
      lockedCause: locked.current?.cause ?? null,
    };
    // Bail out when nothing visible moved. Returning the previous object is how React is told not to
    // re-render, and it is why a one-second timer costs an ordinary session nothing.
    setView(prev => (sameView(prev, next) ? prev : next));
  }, [limits]);

  // ── Activity detection (COMP-AUTH-001 "Activity Detection") ──────────────────────────────────────
  //
  // Passive listeners on the window, so nothing here can delay a scroll or swallow a keystroke in a
  // clinical note. `visibilitychange` counts because coming back to a tab is unambiguously a person
  // arriving at it -- and because a browser that throttled our timer while hidden needs a fresh mark.
  //
  // ⚠ THE MARK IS A REF, NOT STATE. A scroll fires dozens of times a second and each one would otherwise
  // re-render every page in this product.
  useEffect(() => {
    const t = Date.now();
    lastActivity.current = t;
    lastBeat.current = t;

    // Restore a cover this tab had drawn before a reload.
    //
    // ⚠ THE POINT IS THE ACCIDENTAL REFRESH. Somebody pauses, walks away, and the page is reloaded:
    // without this the record is back on the screen. It is `sessionStorage`, so it dies with the tab and
    // cannot follow anybody to a new one, and a cover older than twelve hours is discarded rather than
    // honoured -- a stale mark from a forgotten tab must never greet somebody who has just signed in.
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Stored;
        if (s && typeof s.at === "number" && t - s.at <= STORED_LOCK_MAX_AGE_MS)
          locked.current = { cause: s.cause === LOCK_CAUSE.PAUSED ? LOCK_CAUSE.PAUSED : LOCK_CAUSE.IDLE, at: s.at };
        else sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* storage unavailable: the cover simply does not survive the reload */ }

    const mark = () => { lastActivity.current = Date.now(); activeSinceBeat.current = true; };
    for (const e of SESSION_ACTIVITY_EVENTS) window.addEventListener(e, mark, { passive: true });

    const open = () => { previewStartedAt.current = Date.now(); evaluate(); };
    window.addEventListener(SESSION_PREVIEW_EVENT, open);

    // The first publish. In a callback rather than in the effect body, so this never renders on the
    // server and never cascades a render synchronously out of an effect.
    const kick = setTimeout(evaluate, 0);
    const id = setInterval(evaluate, TICK_MS);
    return () => {
      clearTimeout(kick); clearInterval(id);
      for (const e of SESSION_ACTIVITY_EVENTS) window.removeEventListener(e, mark);
      window.removeEventListener(SESSION_PREVIEW_EVENT, open);
    };
  }, [evaluate]);

  const pause = useCallback(() => {
    if (locked.current) return;
    const entry: Stored = { cause: LOCK_CAUSE.PAUSED, at: Date.now() };
    locked.current = entry;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry)); } catch { /* ignore */ }
    void say("locked", { cause: LOCK_CAUSE.PAUSED });
    evaluate();
  }, [evaluate]);

  const staySignedIn = useCallback(() => {
    if (previewStartedAt.current !== null) { previewStartedAt.current = null; evaluate(); return; }
    lastActivity.current = Date.now();
    activeSinceBeat.current = true;
    evaluate();
  }, [evaluate]);

  const unlocked = useCallback(() => {
    locked.current = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    const t = Date.now();
    lastActivity.current = t;
    lastBeat.current = t;
    activeSinceBeat.current = false;
    observedStretch.current = null;
    evaluate();
  }, [evaluate]);

  const closePreview = useCallback(() => { previewStartedAt.current = null; evaluate(); }, [evaluate]);

  if (!view) return null;

  const covered = view.lockedCause !== null;
  const showBanner = !covered && !view.previewLocked && view.phase === "WARNING";

  return (
    <>
      {/* CLINICAL PAUSE MODE (COMP-AUTH-001): one press, on every Practice page, whatever the policy
          says. It is not tied to the idle limit -- a clinician stepping away from a patient wants the
          record off the screen NOW, and making that depend on a setting somebody has to switch on first
          would be a control nobody has. */}
      <button
        type="button" onClick={pause}
        title="Cover this screen. Nothing is saved, discarded or signed out; a password brings it back."
        className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 pointer-coarse:min-h-[var(--cp-touch)]"
      >
        Pause
      </button>

      {showBanner && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[90] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[var(--cmp-text-warning)]/30 bg-[var(--cmp-surface-warning)] px-4 py-3 shadow-lg"
        >
          <p className="text-[13px] font-semibold text-[var(--cmp-text-warning)]">
            {view.previewing ? "Preview — " : ""}
            This screen will be covered in {view.secondsToLock ?? 0} second{view.secondsToLock === 1 ? "" : "s"}
          </p>
          {/* ⚠ EVERY CLAUSE HERE IS TRUE OF THE COVER. It does not sign anybody out and it does not
              discard a half-typed note. A warning that overstated what was about to happen would send
              people rushing to save work that was never at risk. */}
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--cmp-text-warning)]/90">
            This practice covers a screen that has sat unused. Nothing is signed out and nothing you have
            typed is discarded &mdash; a password brings it back.
          </p>
          <button type="button" onClick={staySignedIn}
            className="mt-2 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white">
            {view.previewing ? "End the preview" : "Stay signed in"}
          </button>
        </div>
      )}

      {(covered || view.previewLocked) && (
        <LockScreen
          cause={view.lockedCause ?? LOCK_CAUSE.IDLE}
          preview={!covered && view.previewLocked}
          onClosePreview={closePreview}
          onUnlocked={unlocked}
        />
      )}
    </>
  );
}

/**
 * The cover.
 *
 * ⚠ IT DELIBERATELY DOES NOT USE THE SHARED Modal/useDismiss PAIR. Every other dialog in this product
 * closes on Escape and on a click outside, and both would defeat this one entirely: a lock screen that a
 * keypress dismisses is a screensaver. It declares the same semantics by hand -- `role="dialog"`,
 * `aria-modal`, a name, and a Tab trap -- so a screen-reader user is told the page behind is unavailable
 * rather than being left reading a patient record the sighted user can no longer see.
 *
 * ⚠ AND THE ESCAPE HATCH IS UNCONDITIONAL. "Sign out and start again" is rendered before the password
 * field is even tried and stays rendered when the password is refused, because the one thing this screen
 * must never be is the only thing between somebody and their work. This product has already shipped a
 * screen that told people to use a control that did not exist; a cover with no way past it would be that
 * mistake made larger.
 */
function LockScreen({ cause, preview, onClosePreview, onUnlocked }: {
  cause: LockCause; preview: boolean; onClosePreview: () => void; onUnlocked: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The address is filled in when the session is still alive and left blank when it is not -- which is
  // the case COMP-SECURITY-SURVEY-001 s6.6 warns about, "the user is stuck behind a lock screen that
  // cannot authenticate". They are not stuck: `signInWithPassword` needs no existing session, so typing
  // the address is the whole difference, and the field is editable for exactly that reason.
  useEffect(() => {
    if (preview) return;
    let alive = true;
    void createClient().auth.getUser()
      .then(({ data }) => { if (alive && data.user?.email) setEmail(data.user.email); })
      .catch(() => { /* leave it blank; the field is typeable */ });
    return () => { alive = false; };
  }, [preview]);

  // Keep Tab inside the panel. Not a convenience: without it a keyboard user walks straight into the
  // patient record underneath and reads out the thing the cover exists to hide.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const focusable = panel.current.querySelectorAll<HTMLElement>("input, button");
    if (focusable.length === 0) return;
    const firstEl = focusable[0], lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: authError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (authError) {
      // The message is the platform's own. It is not counted anywhere and cannot be: failed sign-ins do
      // not reach this product (securityPosture.failedSignInAttemptsVisibleHere), which is also why
      // nothing here can -- or does -- lock an account after a few wrong attempts.
      setError(authError.message || "That password was not accepted.");
      setBusy(false); setPassword(""); return;
    }

    // ⚠ THE SECOND HALF, AND THE HALF THAT MAKES UNLOCKING REAL. Re-authenticating moved GoTrue's
    // `last_sign_in_at`, and handing that to `touchSession` is what lifts an idle lock-out applied while
    // the screen was covered. Without it the cover would lift and the very next navigation would bounce
    // the person to /practice/access-status.
    const res = await say("unlocked", { cause });
    if (res && res.status === 423) { window.location.assign("/practice/access-status"); return; }
    setPassword(""); setBusy(false);
    onUnlocked();
  }

  const titleId = "practice-lock-title";
  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trap}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--cp-shell)] p-6"
    >
      <div ref={panel} className="w-full max-w-md rounded-2xl bg-white p-7">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {preview ? "Preview" : cause === LOCK_CAUSE.PAUSED ? "Paused" : "Covered while unused"}
        </p>
        <h2 id={titleId} className="mt-1 text-lg font-bold text-gray-900">
          {preview ? "This is what a covered screen looks like"
            : cause === LOCK_CAUSE.PAUSED ? "This screen is paused" : "This screen has been covered"}
        </h2>

        <ul className="mt-3 flex flex-col gap-1.5">
          {LOCK_SCREEN_TRUTHS.map(t => (
            <li key={t} className="flex items-baseline gap-2 text-[11.5px] leading-snug text-gray-600">
              <span aria-hidden className="text-gray-300">&mdash;</span>{t}
            </li>
          ))}
        </ul>

        {preview ? (
          <>
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] leading-snug text-gray-600">
              Nothing has been covered, changed or recorded. This is a rehearsal of the screen, shown only
              to you, right now. Close it and carry on.
            </p>
            <button type="button" onClick={onClosePreview}
              className="mt-4 w-full rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white">
              Close the preview
            </button>
          </>
        ) : (
          <form onSubmit={unlock} className="mt-4 flex flex-col gap-2">
            <label className="text-[11px] font-semibold text-gray-500" htmlFor="practice-lock-email">
              Your Competen sign-in address
            </label>
            <input id="practice-lock-email" type="email" autoComplete="username" value={email}
              onChange={e => setEmail(e.target.value)} required
              className="rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10" />
            <label className="mt-1 text-[11px] font-semibold text-gray-500" htmlFor="practice-lock-password">
              Password
            </label>
            <input id="practice-lock-password" type="password" autoComplete="current-password" value={password}
              onChange={e => setPassword(e.target.value)} required autoFocus
              className="rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10" />

            {error && (
              <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
                {error} You can try again, or sign out and start again below.
              </p>
            )}

            <button type="submit" disabled={busy || !password}
              className="mt-1 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
              {busy ? "Unlocking…" : "Unlock"}
            </button>

            {/* ⚠ ALWAYS RENDERED, NEVER DISABLED BY A FAILURE. The way out does not depend on the way in
                working. */}
            <button type="button"
              onClick={async () => {
                try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
                await createClient().auth.signOut();
                window.location.assign("/practice/sign-in?return_to=/practice/home");
              }}
              className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {LOCK_ESCAPE_LABEL}
            </button>

            {/* The resume methods COMP-AUTH-001 asks for and this product does not have, on the screen
                that would have used them. An unwarned reader would go looking for them. */}
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-gray-400">Why is there no PIN or fingerprint?</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {RESUME_METHODS_NOT_BUILT.map(r => (
                  <li key={r} className="text-[11px] leading-snug text-gray-500">&mdash; {r}</li>
                ))}
              </ul>
            </details>
          </form>
        )}
      </div>
    </div>
  );
}
