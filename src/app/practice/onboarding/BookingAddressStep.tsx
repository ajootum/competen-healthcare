"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IdentitySetupView } from "@/lib/practice/identity-service";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PIS-000 s3 -- THE BOOKING ADDRESS, OFFERED DURING ONBOARDING. OPTIONAL, AND NOT FIRST.
//
// The practice owner asked for this: claiming a handle was reachable only from Practice Setup, which is
// a place you go once you already know it exists. handle-offer.ts decides WHERE this appears; this file
// is what appears.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THREE ACTS, AND THIS SCREEN PERFORMS AT MOST ONE OF THEM PER PRESS.
//
//   issue    creates the identity ROW -- a permanent practitioner number, a private profile, discovery
//            hidden. It publishes nothing and it writes no handle. Its own button, its own sentence.
//   claim    writes the PUBLIC HANDLE. It is the only permanent public act here, and it happens only
//            after the practitioner has typed a name, seen the finished URL, and confirmed the second
//            of two presses.
//   publish  is not on this screen AT ALL. Onboarding is not where somebody decides to become findable
//            by strangers, and an address that is claimed does not open until they say so in Practice
//            Setup. Nothing here changes a discovery mode.
//
// Issuing does NOT chain into claiming. After the number is issued this screen re-reads and shows the
// claim box, and the practitioner may still skip -- if issuing silently produced an address, the
// separation the identity API is built around would exist only in the API.
//
// ⚠ SKIPPING COSTS NOTHING AND IS SAID SO, IN THOSE WORDS. It writes nothing, it does not reserve a
// name, it does not delay activation, and the address stays available afterwards under Practice Setup ->
// Identity & Address. An "optional" step whose decline is quiet or ambiguous is not optional.
//
// ⚠ A FAILED READ RENDERS AS A FAILED READ. `unreadable` never draws the claim box: telling somebody
// their address is unclaimed when the truth is that nobody could check would invite a SECOND permanent
// name for a person who may already have one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Check = { handle: string; url: string | null; state: "invalid" | "available" | "unavailable" | "unreadable" };

const CHECK_TONE: Record<Check["state"], { text: string; mark: string; label: string }> = {
  available: { text: "text-emerald-700", mark: "✓", label: "available" },
  unavailable: { text: "text-rose-700", mark: "✕", label: "not available" },
  invalid: { text: "text-amber-700", mark: "!", label: "not a valid handle" },
  unreadable: { text: "text-slate-500", mark: "?", label: "could not be checked" },
};

const skipButton =
  "rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const primaryButton =
  "rounded-xl bg-[var(--cp-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";

export default function BookingAddressStep({
  kind, view, onRefresh, onSkip,
}: {
  kind: "claim" | "issue" | "unreadable";
  /** Null only when the read failed outright, in which case `kind` is "unreadable". */
  view: IdentitySetupView | null;
  /** Re-read the identity after a write, so what is rendered next is what the server actually holds. */
  onRefresh: () => Promise<void>;
  /** Decline, and go on to the next required step. Writes nothing. */
  onSkip: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  /**
   * ⚠ WHICH HANDLE WAS CONFIRMED, NOT WHETHER SOMETHING WAS -- the same reason the Practice Setup
   * console keeps a string here. A standing confirmation over a handle that has since been retyped is a
   * button that claims a different, permanent address from the one it names.
   */
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ handle: string; url: string } | null>(null);

  // The engine's normalisation, applied here so the preview is the address that would be WRITTEN rather
  // than what was typed. The server normalises again; this is a preview, never a validation.
  const normalised = typed.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // ⚠ THE PREFIX COMES FROM THE PAYLOAD. A second construction of the booking link here is one string
  // literal away from previewing an address this application does not serve -- to the one person
  // choosing a name they can never change.
  const previewUrl = normalised && view ? `${view.urlPrefix}${normalised}` : null;
  // A check for a different handle is not an answer about this one. Derived, so no keystroke can leave
  // a stale "available" standing.
  const current = check && check.handle === normalised ? check : null;
  const confirming = normalised !== "" && confirmedFor === normalised;

  const latest = useRef(0);
  const runCheck = useCallback(async (handle: string) => {
    const seq = ++latest.current;
    setChecking(true);
    try {
      const res = await fetch(`/api/v1/practice/identity/handle-check?handle=${encodeURIComponent(handle)}`);
      const body = await res.json();
      // An out-of-order answer is discarded: two keystrokes in flight can land backwards, and a stale
      // "available" over a fresh "taken" is the one wrong answer this screen must never show.
      if (seq !== latest.current) return;
      if (!res.ok) { setCheck({ handle, url: null, state: "unreadable" }); return; }
      setCheck(body as Check);
    } catch {
      if (seq === latest.current) setCheck({ handle, url: null, state: "unreadable" });
    } finally {
      if (seq === latest.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!normalised) return;
    const t = setTimeout(() => { void runCheck(normalised); }, 350);
    return () => clearTimeout(t);
  }, [normalised, runCheck]);

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/practice/identity", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((payload?.error as { message?: string })?.message
          ?? "That did not work, and the reason did not come back. Nothing was changed.");
        return null;
      }
      return payload;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Creates the row and the permanent number. Writes no handle, and does not continue into one. */
  async function issue() {
    const payload = await post({ action: "issue" });
    if (!payload) return;
    await onRefresh();
  }

  /** The one permanent public act on this screen. */
  async function claim() {
    const payload = await post({ action: "claim", handle: normalised });
    if (!payload) return;
    setClaimed({ handle: normalised, url: String(payload.bookingUrl ?? "") });
    setTyped(""); setCheck(null); setConfirmedFor(null);
  }

  const header = (
    <>
      <h2 className="text-[15px] font-bold text-gray-900">Your booking address</h2>
      <p className="mt-0.5 text-[12px] text-gray-400">
        Optional &mdash; this is not one of the required steps, and skipping it changes nothing.
      </p>
    </>
  );

  // ── Claimed, just now. Said plainly: an address is not an open page. ─────────────────────────────
  if (claimed) {
    return (
      <div>
        {header}
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <p className="text-[13px] font-semibold text-emerald-900">@{claimed.handle} is yours.</p>
          <p className="mt-1 break-all font-mono text-[12px] font-semibold text-emerald-900">{claimed.url}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-emerald-900">
            It does not open yet, and nothing has been published. Deciding who can reach your page is a
            separate choice you make later, in Practice Setup.
          </p>
        </div>
        <button type="button" onClick={onSkip} className={`${primaryButton} mt-5`}>
          Continue setup
        </button>
      </div>
    );
  }

  // ── The read failed. No control, no claim about what exists. ─────────────────────────────────────
  if (kind === "unreadable" || !view) {
    return (
      <div>
        {header}
        <div className="mt-4 rounded-xl border border-gray-200 bg-slate-50 p-4">
          <p className="text-[13px] leading-relaxed text-gray-700">
            Whether you already have a booking address could not be checked just now, so nothing is
            offered here &mdash; claiming a second one would be permanent, and a name can never be given
            back. Nothing has been changed.
          </p>
          {view?.reason && <p className="mt-1.5 text-[11px] text-gray-500">{view.reason}</p>}
          <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
            You can pick this up any time under Practice Setup &rarr; Identity &amp; Address.
          </p>
        </div>
        <button type="button" onClick={onSkip} className={`${primaryButton} mt-5`}>Continue setup</button>
      </div>
    );
  }

  // ── No identity row at all. A different act, with its own button. ────────────────────────────────
  if (kind === "issue") {
    return (
      <div>
        {header}
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-[13px] leading-relaxed text-amber-900">
            You do not have a practitioner number yet, so there is nothing for an address to hang off.
            Issuing one publishes nothing: it is a permanent number that belongs to you rather than to
            this practice, your profile stays private, and <span className="font-semibold">no public
              address is created</span> &mdash; you would still choose that yourself, afterwards.
          </p>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={issue} disabled={busy} className={primaryButton}>
            {busy ? "Issuing…" : "Issue my practitioner number"}
          </button>
          <button type="button" onClick={onSkip} disabled={busy} className={skipButton}>
            Skip &mdash; I&apos;ll do this later
          </button>
        </div>
      </div>
    );
  }

  // ── The offer proper. ────────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {header}

      <p className="mt-3 text-[13px] leading-relaxed text-gray-600">
        Your handle is the <span className="font-semibold">@name</span> in the link you would give a
        patient. Nothing has been chosen for you, and nothing here makes your page reachable &mdash;
        claiming an address and opening it to patients are two different decisions, and the second one
        is not on this screen.
      </p>

      {/* ⚠ THE PAYLOAD'S OWN SENTENCE, so the harness checks the words the practitioner reads. */}
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">Before you choose</p>
        <p className="mt-1 text-[12px] leading-relaxed text-amber-900">{view.permanenceNotice}</p>
      </div>

      {view.suggestions.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-gray-500">
            From your name, and free right now. Suggestions only &mdash; nothing is applied until you claim it.
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {view.suggestions.map(s => (
              <li key={s}>
                <button type="button" onClick={() => setTyped(s)}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 font-mono text-[12px] text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5">
                  @{s}
                </button>
              </li>
            ))}
          </ul>
          {view.suggestionsIncomplete && (
            <p className="mt-1 text-[10.5px] text-gray-400">
              Some candidates could not be checked, so this list may be shorter than it should be.
            </p>
          )}
        </div>
      )}

      <label className="mt-4 block text-xs font-semibold text-gray-600" htmlFor="onboarding-handle">
        Your handle
      </label>
      <div className="mt-1 flex items-center gap-2">
        <span aria-hidden className="text-[15px] font-bold text-gray-400">@</span>
        <input id="onboarding-handle" value={typed} onChange={e => setTyped(e.target.value)}
          autoComplete="off" spellCheck={false} maxLength={40} placeholder="yourname"
          className="w-full max-w-[320px] rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-[var(--cp-primary)] focus:ring-4 focus:ring-[var(--cp-primary)]/10" />
      </div>

      {/* ⚠ THE FINISHED URL, BEFORE ANYTHING IS COMMITTED. */}
      <div className="mt-2.5 rounded-xl border border-dashed border-gray-300 bg-slate-50 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">What patients would see</p>
        <p className="mt-0.5 break-all font-mono text-[13px] font-semibold text-gray-900">
          {previewUrl ?? `${view.urlPrefix}…`}
        </p>
        {normalised && normalised !== typed.trim().replace(/^@+/, "") && (
          <p className="mt-1 text-[10.5px] text-gray-500">
            Handles are lowercase letters and digits only, so what you typed becomes
            <span className="font-mono"> @{normalised}</span>.
          </p>
        )}
      </div>

      <p className="mt-2 min-h-[18px] text-[12px] font-semibold">
        {checking && !current ? <span className="text-gray-400">Checking…</span>
          : current ? (
            <span className={CHECK_TONE[current.state].text}>
              {CHECK_TONE[current.state].mark} @{current.handle} is {CHECK_TONE[current.state].label}
            </span>
          ) : null}
      </p>

      {current?.state === "available" && (
        confirming ? (
          <div className="rounded-xl border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.06] p-3">
            <p className="text-[12px] leading-relaxed text-gray-800">
              Claim <span className="font-mono font-bold">@{normalised}</span> as your permanent handle?
              Your address becomes <span className="break-all font-mono font-bold">{previewUrl}</span>.
              If you ever change it, this one stays attached to you and cannot be given to anybody else.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" onClick={claim} disabled={busy} className={primaryButton}>
                {busy ? "Claiming…" : `Yes, claim @${normalised}`}
              </button>
              <button type="button" onClick={() => setConfirmedFor(null)} disabled={busy} className={skipButton}>
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmedFor(normalised)} className={primaryButton}>
            Claim @{normalised}
          </button>
        )
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
          {error}
        </p>
      )}

      {/* ── The decline, and what it costs, which is nothing ───────────────────────────────────── */}
      <div className="mt-5 border-t border-gray-100 pt-4">
        <button type="button" onClick={onSkip} disabled={busy} className={skipButton}>
          Skip &mdash; I&apos;ll choose my address later
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Skipping writes nothing and reserves nothing. Your setup finishes exactly the same way, and
          your address is waiting under Practice Setup &rarr; Identity &amp; Address whenever you want
          it. No name is held for you in the meantime, so the one you like today may be taken later
          &mdash; that is the only thing waiting costs.
        </p>
      </div>
    </div>
  );
}
