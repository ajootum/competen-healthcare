"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { IdentitySetupView } from "@/lib/practice/identity-service";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PIS-000 s3's claim, as a screen.
//
// ⚠ FOUR STATES, NOT TWO. `none` (no identity row yet), `unclaimed` (a number but no address),
// `claimed`, and `unreadable`. An unclaimed address renders AS UNCLAIMED -- with the reason it matters
// and the control that fixes it -- never as an empty field and never as an error. A failed read says it
// failed; it is not drawn as "you have nothing".
//
// ⚠ THE URL IS SHOWN BEFORE THE BUTTON IS PRESSED, in full, as it will be printed. That is the entire
// reason this screen exists rather than a text field on a settings tab: a public name should not be
// chosen from a placeholder.
//
// ⚠ THE PERMANENCE WARNING IS THE PAYLOAD'S OWN SENTENCE. It comes from HANDLE_PERMANENCE_NOTICE in the
// engine, so the harness checks the same words the practitioner reads. A warning that lives only in JSX
// is one a redesign can drop with nothing failing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Props = { identity: IdentitySetupView };

type Check = { handle: string; url: string | null; state: "invalid" | "available" | "unavailable" | "unreadable" };

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const CHECK_TONE: Record<Check["state"], { text: string; mark: string; label: string }> = {
  available: { text: "text-emerald-700", mark: "✓", label: "available" },
  unavailable: { text: "text-rose-700", mark: "✕", label: "not available" },
  invalid: { text: "text-amber-700", mark: "!", label: "not a valid handle" },
  unreadable: { text: "text-slate-500", mark: "?", label: "could not be checked" },
};

export default function BookingAddressConsole({ identity }: Props) {
  const [view, setView] = useState(identity);
  const [typed, setTyped] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  /**
   * ⚠ WHICH HANDLE WAS CONFIRMED, NOT WHETHER SOMETHING WAS. A boolean would have to be reset from an
   * effect every time a character is typed, and a confirmation left standing over a handle that has since
   * changed is a button that claims a different address from the one it names.
   */
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The normalisation the engine applies, applied here too so the preview is the address that would
  // actually be written rather than what was typed. The server normalises again; this is a preview, not
  // a validation.
  const normalised = typed.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // ⚠ THE PREFIX COMES FROM THE PAYLOAD, NOT FROM A LITERAL HERE. This line used to read
  // `${view.host}/@${normalised}` and it was a SECOND construction of the booking link -- so when
  // CPB-002 moved the address to /practice/book/@handle, this preview would have gone on quietly
  // showing the old shape to the one person choosing a name they can never change.
  const previewUrl = normalised ? `${view.urlPrefix}${normalised}` : null;
  const confirming = normalised !== "" && confirmedFor === normalised;
  // ⚠ A CHECK FOR A DIFFERENT HANDLE IS NOT AN ANSWER ABOUT THIS ONE. Derived rather than cleared from an
  // effect, so a stale "available" can never survive a keystroke.
  const current = check && check.handle === normalised ? check : null;

  const latest = useRef(0);

  const runCheck = useCallback(async (handle: string) => {
    const seq = ++latest.current;
    setChecking(true);
    try {
      const res = await fetch(`/api/v1/practice/identity/handle-check?handle=${encodeURIComponent(handle)}`);
      const body = await res.json();
      // ⚠ AN OUT-OF-ORDER ANSWER IS DISCARDED. Two keystrokes in flight can land backwards, and a stale
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

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await fetch("/api/v1/practice/identity", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error?.message ?? "That did not work, and the reason did not come back.");
        return null;
      }
      return payload as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const res = await fetch("/api/v1/practice/identity");
    if (!res.ok) return;
    const payload = await res.json();
    if (payload?.identity) setView(payload.identity as IdentitySetupView);
  }

  async function issue() {
    const payload = await post({ action: "issue" });
    if (!payload) return;
    setDone(`Your practitioner number is ${String(payload.practitionerNumber)}. No public address was created.`);
    await refresh();
  }

  async function claim() {
    const payload = await post({ action: "claim", handle: normalised });
    if (!payload) return;
    setDone(`Claimed. Your booking address is ${String(payload.bookingUrl)}.`);
    setTyped(""); setCheck(null); setConfirmedFor(null);
    await refresh();
  }

  // ── unreadable ───────────────────────────────────────────────────────────────────────────────────
  if (view.state === "unreadable") {
    return (
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">This could not be read</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          Your practitioner identity could not be read just now, so nothing on this page is a statement
          about your practice. Nothing has been changed, and nothing will be issued or claimed until the
          answer comes back.
        </p>
        {view.reason && <p className="mt-2 text-[11px] text-gray-400">{view.reason}</p>}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── The identity itself ─────────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-gray-900">Your practitioner identity</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              A permanent number that belongs to you rather than to this practice. It stays with you if
              you close this practice or open another, and it is never reused.
            </p>
          </div>
          <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            view.state === "none" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {view.state === "none" ? "Not issued" : "Issued"}
          </span>
        </div>

        {view.state === "none" ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
            <p className="text-[12px] leading-relaxed text-amber-900">
              You do not have a practitioner number yet. Practices created before identities were issued
              automatically do not have one, and nothing else here can be set up until it exists.
              Issuing it publishes nothing: your discovery setting starts at hidden and no address is
              created.
            </p>
            <button type="button" onClick={issue} disabled={busy}
              className="mt-2.5 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {busy ? "Issuing…" : "Issue my practitioner number"}
            </button>
          </div>
        ) : (
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Practitioner number</dt>
              <dd className="text-[15px] font-bold tracking-wide text-gray-900">{view.practitionerNumber}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Name on the identity</dt>
              <dd className="text-[13px] font-semibold text-gray-800">{view.displayName}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Who can find you</dt>
              <dd className="text-[13px] font-semibold text-gray-800">
                {view.discovery === "hidden" ? "Nobody — hidden" : view.discovery}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* ── The address ─────────────────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">Your handle</h2>

        {view.state === "claimed" ? (
          <>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              Claimed. This is the address patients would use.
            </p>
            <p className="mt-2 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[13px] font-semibold text-gray-900">
              {view.bookingUrl}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{view.permanenceNotice}</p>
          </>
        ) : view.state === "none" ? (
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
            Unclaimed. You can choose a handle once your practitioner number has been issued above.
          </p>
        ) : (
          <>
            {/* ⚠ UNCLAIMED, SAID PLAINLY, WITH WHAT IT COSTS AND WHAT IT BUYS. */}
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              <span className="font-semibold text-gray-900">Unclaimed.</span> You have no public address
              yet, so there is nothing for a patient to open and no booking page can be published.
              Nothing has been chosen for you.
            </p>

            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">Before you choose</p>
              <p className="mt-1 text-[12px] leading-relaxed text-amber-900">{view.permanenceNotice}</p>
            </div>

            {view.suggestions.length > 0 && (
              <div className="mt-3">
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

            <label className="mt-3 block text-[11px] font-semibold text-gray-600" htmlFor="handle-input">
              Your handle
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden className="text-[15px] font-bold text-gray-400">@</span>
              <input id="handle-input" value={typed} onChange={e => setTyped(e.target.value)}
                autoComplete="off" spellCheck={false} maxLength={40}
                placeholder="yourname"
                className="w-full max-w-[320px] rounded-lg border border-gray-300 px-3 py-2 font-mono text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </div>

            {/* ⚠ THE URL, IN FULL, BEFORE ANYTHING IS COMMITTED. */}
            <div className="mt-2.5 rounded-lg border border-dashed border-gray-300 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                What patients would see
              </p>
              <p className="mt-0.5 break-all font-mono text-[13px] font-semibold text-gray-900">
                {previewUrl ?? `${view.host}/@…`}
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
                <div className="rounded-lg border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.06] p-3">
                  <p className="text-[12px] leading-relaxed text-gray-800">
                    Claim <span className="font-mono font-bold">@{normalised}</span> as your permanent
                    handle? Your address becomes{" "}
                    <span className="break-all font-mono font-bold">{previewUrl}</span>. If you ever
                    change it, this one stays attached to you and cannot be given to anybody else.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button type="button" onClick={claim} disabled={busy}
                      className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                      {busy ? "Claiming…" : `Yes, claim @${normalised}`}
                    </button>
                    <button type="button" onClick={() => setConfirmedFor(null)} disabled={busy}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                      Not yet
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmedFor(normalised)}
                  className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                  Claim @{normalised}
                </button>
              )
            )}
          </>
        )}
      </section>

      {/* ── CPB-002's Booking & Sharing Workspace ────────────────────────────────────────────────── */}
      {view.sharing && (
        <section className={card}>
          <h2 className="text-[14px] font-bold text-gray-900">Share your booking link</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            {/* ⚠ THE DISTINCTION IS THE WHOLE SECTION. None of these buttons sends anything: each opens
                the other application with the message already written, and you press send. */}
            Nothing here sends a message. Each option opens the app you choose with the text already
            written &mdash; you decide who receives it.
          </p>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            {/* Drawn in this process from the address above. No external image service ever sees it. */}
            <div className="w-36 shrink-0 rounded-lg border border-gray-200 bg-white p-2"
              dangerouslySetInnerHTML={{ __html: view.sharing.qrSvg }} />
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-[12px] font-semibold text-gray-900">{view.sharing.url}</p>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {view.sharing.targets.map(t => (
                  <li key={t.key}>
                    {t.href ? (
                      <a href={t.href} target="_blank" rel="noopener noreferrer" title={t.detail}
                        className="inline-block rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5">
                        {t.label}
                        {/* ⚠ SAID ON THE BUTTON, not only in a tooltip. Facebook and LinkedIn receive
                            the address the moment it is clicked. */}
                        {t.leavesCompeten && <span className="ml-1 text-[10px] font-normal text-gray-400">↗</span>}
                      </a>
                    ) : (
                      <button type="button" title={t.detail}
                        onClick={() => { void navigator.clipboard?.writeText(view.sharing!.url); setDone("Link copied. Nothing was sent."); }}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5">
                        {t.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10.5px] leading-relaxed text-gray-400">
                {view.sharing.targets.filter(t => t.leavesCompeten).map(t => t.label).join(" and ")} open
                their own share windows, and receive your booking address when you click. Nothing on this
                page contacts them until you do.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <a href={view.sharing.qrPngDataUrl} download={`${view.sharing.handle}-booking-qr.png`}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                  Download PNG
                </a>
                <a href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(view.sharing.qrSvg)}`}
                  download={`${view.sharing.handle}-booking-qr.svg`}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                  Download SVG
                </a>
                <Link href={view.sharing.printPath} target="_blank"
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                  Print assets
                </Link>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-400">{view.sharing.pdfNote}</p>
            </div>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] font-semibold text-gray-700">Put it on your website</summary>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              A plain link rather than a widget: nothing of ours runs on your site, so there is nothing
              for you to audit and nothing that can break when we deploy.
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-gray-800">
              {view.sharing.embed}
            </pre>
          </details>
        </section>
      )}

      {/* ── The booking page, which is a different thing ─────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[14px] font-bold text-gray-900">Your booking page</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          An address is not a booking page. The page &mdash; what patients see, which locations and
          appointment types you expose, and the one-time code that verifies them &mdash; is configured
          separately, and it cannot be published without a handle.
        </p>
        <ul className="mt-2.5 space-y-1.5 text-[12px]">
          <li className="flex items-start gap-2">
            <span aria-hidden className={view.handle ? "text-emerald-600" : "text-amber-500"}>
              {view.handle ? "✓" : "○"}
            </span>
            <span className="text-gray-700">
              {view.handle
                ? <>A handle to publish at &mdash; <span className="font-mono">@{view.handle}</span>.</>
                : "A handle to publish at. Until you claim one, the database itself refuses a published booking page — there is nothing for it to be published at."}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-slate-300">–</span>
            <span className="text-gray-500">
              {view.bookingPage.state === "unreadable"
                ? `Your booking page could not be read, so its state is unknown${view.bookingPage.reason ? ` — ${view.bookingPage.reason}` : ""}.`
                : view.bookingPage.state === "present"
                  ? `A booking page exists and is ${view.bookingPage.publishState ?? "in an unknown state"}. Nothing in this build edits or publishes it yet.`
                  : "No booking page has been created. Nothing in this build creates one yet — the store exists, the screen does not."}
            </span>
          </li>
        </ul>
        <p className="mt-2.5 text-[11px] leading-relaxed text-gray-400">
          <Link href="/practice/setup" className="font-semibold text-[var(--cp-primary)] hover:underline">
            Back to Practice Setup
          </Link>
        </p>
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
          {done}
        </p>
      )}
    </div>
  );
}
