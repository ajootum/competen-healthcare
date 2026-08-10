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
// is one a redesign can drop with nothing failing. PUBLICATION_NOTICE arrives the same way.
//
// ⚠ AND THE SHARE SHEET IS DRAWN ONLY WHEN THE ADDRESS ACTUALLY OPENS.
//
// `view.sharing` used to arrive whenever a handle existed, so this screen offered a QR code, a print
// button and WhatsApp, Facebook and LinkedIn links for a URL the resolver refuses -- an invitation to
// print a dead address onto a card and post it publicly. The gate is now on the server, asked of
// resolveHandle itself; this file renders `view.address` instead of guessing, and there is deliberately
// no branch here that can put the share sheet back.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Props = { identity: IdentitySetupView };

type Check = { handle: string; url: string | null; state: "invalid" | "available" | "unavailable" | "unreadable" };

/** The five discovery keys, in the practitioner's terms, when a mode has to be named in a sentence. */
const modeLabel = (view: IdentitySetupView, key: string | null) =>
  view.discoveryModes.find(m => m.key === key)?.label ?? key ?? "not set";

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

  /**
   * CPR-GROWTH-001 s2 -- record that the practitioner took a share action.
   *
   * !! FIRE AND FORGET, AND DELIBERATELY NOT AWAITED. Copying a link must not wait on a milestone write,
   * and must not fail if one fails. The route records nothing but the milestone.
   *
   * !! IT MEANS "THEY SHARED", NEVER "A PATIENT RECEIVED". This screen already says "Nothing was sent."
   * and that stays true: Competen cannot observe a WhatsApp message or a poster on a wall.
   */
  const recordShare = (via: string) => {
    void fetch("/api/v1/practice/identity", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recordShare", via }),
    }).catch(() => { /* a milestone nobody could record is not a share that did not happen */ });
  };

  /** Which mode the practitioner has selected to publish AS. Never pre-selected — publishing is a choice. */
  const [chosenMode, setChosenMode] = useState<string | null>(null);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  /**
   * ⚠ HOW FAR A FAILED PUBLISH GOT. Kept because a refusal at the last step has already moved the
   * lifecycle at an earlier one, and "it failed" alone leaves somebody unable to tell a retry from a
   * fresh start.
   */
  const [publishProgress, setPublishProgress] = useState<string[] | null>(null);

  const [profile, setProfile] = useState({
    displayName: identity.displayName ?? "",
    qualifications: identity.publicProfile.qualifications,
    specialties: identity.publicProfile.specialties,
    subSpecialty: identity.publicProfile.subSpecialty,
    biography: identity.publicProfile.biography,
    languages: identity.publicProfile.languages,
    consultationTypes: identity.publicProfile.consultationTypes,
  });

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

  /**
   * ⚠ RETURNS THE BODY EVEN WHEN THE REQUEST FAILED, because a refused publish carries how far it got and
   * discarding that is exactly the information a half-finished sequence needs to hand back.
   */
  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; payload: Record<string, unknown> }> {
    setBusy(true); setError(null); setDone(null); setPublishProgress(null);
    try {
      const res = await fetch("/api/v1/practice/identity", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((payload?.error as { message?: string })?.message
          ?? "That did not work, and the reason did not come back.");
        return { ok: false, payload };
      }
      return { ok: true, payload };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return { ok: false, payload: {} };
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const res = await fetch("/api/v1/practice/identity");
    if (!res.ok) return;
    const payload = await res.json();
    if (payload?.identity) {
      const next = payload.identity as IdentitySetupView;
      setView(next);
      setProfile({
        displayName: next.displayName ?? "",
        qualifications: next.publicProfile.qualifications,
        specialties: next.publicProfile.specialties,
        subSpecialty: next.publicProfile.subSpecialty,
        biography: next.publicProfile.biography,
        languages: next.publicProfile.languages,
        consultationTypes: next.publicProfile.consultationTypes,
      });
    }
  }

  async function issue() {
    const { ok, payload } = await post({ action: "issue" });
    if (!ok) return;
    setDone(`Your practitioner number is ${String(payload.practitionerNumber)}. No public address was created.`);
    await refresh();
  }

  async function claim() {
    const { ok, payload } = await post({ action: "claim", handle: normalised });
    if (!ok) return;
    setDone(`Claimed. Your booking address is ${String(payload.bookingUrl)}. It does not open yet — nothing is published until you say so below.`);
    setTyped(""); setCheck(null); setConfirmedFor(null);
    await refresh();
  }

  async function publish() {
    if (!chosenMode) return;
    const { ok, payload } = await post({ action: "publish", discovery: chosenMode });
    if (!ok) {
      // ⚠ WHAT DID HAPPEN, BESIDE WHAT DID NOT.
      const completed = Array.isArray(payload.completed) ? (payload.completed as string[]) : [];
      setPublishProgress(completed);
      return;
    }
    setPublishConfirmed(false); setChosenMode(null);
    setDone(payload.address === "resolves"
      ? `Published. ${String(payload.bookingUrl)} now opens for a patient.`
      : payload.address === "unreadable"
        ? `The settings were saved, but whether your address opens could not be checked just now — ${String(payload.addressReason ?? "no reason was returned")}. Nothing further was changed.`
        : `The settings were saved and your address still does not open. ${String(payload.addressReason ?? "")}`);
    await refresh();
  }

  /**
   * ⚠ ONE CALL, NO CONFIRMATION STEP WHEN IT IS SWITCHING OFF. Somebody making their page private may be
   * doing it because a patient, an employer or a stranger has become a problem, and a confirmation dialog
   * is friction at precisely the wrong moment. Turning it back on is the act that gets the warning.
   */
  async function setDiscovery(mode: string) {
    const { ok, payload } = await post({ action: "discovery", discovery: mode });
    if (!ok) return;
    const address = payload.address as IdentitySetupView["address"] | undefined;
    setDone(mode === "hidden"
      ? "Your page is hidden. It stops opening immediately, for everybody, including anyone holding a printed card. Your handle stays yours."
      : address?.state === "resolves"
        ? `Changed to ${modeLabel(view, mode)}. Your page opens.`
        : `Changed to ${modeLabel(view, mode)}. Your page still does not open — see what remains below.`);
    await refresh();
  }

  async function saveProfile() {
    const { ok } = await post({ action: "profile", ...profile });
    if (!ok) return;
    setDone(view.address.state === "resolves"
      ? "Saved. Your page is open, so this is what a patient reading it sees."
      : "Saved. Your page does not open yet, so nobody else can read this.");
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
            {/* ⚠ CLAIMED IS NOT OPEN, AND THE SENTENCE SAYS WHICH. A handle is the name; whether the
                page answers is the section below, and conflating them is how a dead link gets shared. */}
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              Claimed. This is your address{view.address.state === "resolves"
                ? ", and it opens."
                : view.address.state === "unreadable"
                  ? ". Whether it opens could not be checked just now."
                  : ", though it does not open yet."}
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

      {/* ── Who can reach your page (s7, s10) ────────────────────────────────────────────────────── */}
      {view.state !== "none" && (
        <section className={card}>
          <h2 className="text-[14px] font-bold text-gray-900">Who can reach your page</h2>

          {/* ⚠ THE PLAIN ANSWER FIRST, AND IT IS THE RESOLVER'S OWN. Nothing on this screen decides
              whether the address opens; it renders what resolveHandle said when the page was built. */}
          {view.address.state === "resolves" ? (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
              <p className="text-[12px] leading-relaxed text-emerald-900">
                <span className="font-semibold">Your address opens.</span> A patient who follows{" "}
                <span className="break-all font-mono">{view.bookingUrl}</span> reaches your page, and it
                is set to <span className="font-semibold">{modeLabel(view, view.discovery)}</span>.
              </p>
            </div>
          ) : view.address.state === "unreadable" ? (
            <div className="mt-2 rounded-lg border border-gray-200 bg-slate-50 p-3">
              <p className="text-[12px] leading-relaxed text-gray-700">
                <span className="font-semibold">This could not be checked.</span> Nothing below is a
                statement about whether your page opens, and nothing has been changed.
              </p>
              {view.address.reason && <p className="mt-1 text-[11px] text-gray-500">{view.address.reason}</p>}
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-[12px] leading-relaxed text-amber-900">
                <span className="font-semibold">Your address does not open.</span> Somebody following it
                today is told the page does not exist &mdash; so there is nothing here to print, scan or
                send yet.
              </p>
              {view.address.remaining.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {view.address.remaining.map(r => (
                    <li key={r} className="flex items-start gap-2 text-[12px] leading-relaxed text-amber-900">
                      <span aria-hidden className="text-amber-500">○</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
              {view.address.reason && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-amber-900">{view.address.reason}</p>
              )}
            </div>
          )}

          {/* ── Publishing, for an address that does not open yet ──────────────────────────────── */}
          {view.state === "claimed" && view.address.state === "does_not_resolve" && (
            <div className="mt-3">
              <p className="text-[12px] font-semibold text-gray-900">Open your page</p>

              {/* ⚠ THE EMAIL IS READ, NOT ASKED. There is no "yes, my email is verified" control here and
                  there must never be one: the state means somebody checked, and the person being checked
                  cannot be the one who says so. */}
              {view.emailConfirmed.state !== "confirmed" && (
                <div className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50/70 p-3">
                  <p className="text-[12px] leading-relaxed text-rose-900">
                    {view.emailConfirmed.reason
                      ?? "Your sign-in email could not be confirmed, so publishing will be refused."}
                  </p>
                </div>
              )}

              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                Choose who should be able to reach you. Nothing is selected for you, and nothing changes
                until you confirm.
              </p>

              <ul className="mt-1.5 space-y-1.5">
                {/* ⚠ `hidden` IS NOT AN OPTION HERE. It is where you already are; publishing to it would
                    move your lifecycle and open nothing, and the engine refuses it for that reason. */}
                {view.discoveryModes.filter(m => m.key !== "hidden").map(m => (
                  <li key={m.key}>
                    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                      chosenMode === m.key
                        ? "border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/[0.06]"
                        : "border-gray-200 hover:bg-gray-50"}`}>
                      <input type="radio" name="discovery-mode" value={m.key}
                        checked={chosenMode === m.key}
                        onChange={() => { setChosenMode(m.key); setPublishConfirmed(false); }}
                        className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-gray-900">{m.label}</span>
                        <span className="block text-[11.5px] leading-relaxed text-gray-600">{m.detail}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              {/* ⚠ WHAT BECOMES VISIBLE, AND TO WHOM, BEFORE THE BUTTON. The payload's own sentence. */}
              <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                  Before you publish
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-amber-900">{view.publicationNotice}</p>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                Publishing confirms your sign-in email, records your identity as active, and sets your
                discovery mode &mdash; in that order, so that nothing becomes reachable if a step is
                refused. Nothing here sends a message, and nobody is told your page has opened.
              </p>

              {chosenMode && (
                publishConfirmed ? (
                  <div className="mt-2.5 rounded-lg border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.06] p-3">
                    <p className="text-[12px] leading-relaxed text-gray-800">
                      Open <span className="break-all font-mono font-bold">{view.bookingUrl}</span> as{" "}
                      <span className="font-bold">{modeLabel(view, chosenMode)}</span>? You can return to
                      hidden at any time, and your handle stays yours either way &mdash; it can never be
                      released to anybody else.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button type="button" onClick={publish}
                        disabled={busy || view.emailConfirmed.state !== "confirmed"}
                        className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                        {busy ? "Publishing…" : `Yes, open my page as ${modeLabel(view, chosenMode)}`}
                      </button>
                      <button type="button" onClick={() => setPublishConfirmed(false)} disabled={busy}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                        Not yet
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPublishConfirmed(true)}
                    disabled={view.emailConfirmed.state !== "confirmed"}
                    className="mt-2.5 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                    Publish as {modeLabel(view, chosenMode)}
                  </button>
                )
              )}

              {publishProgress && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
                  {publishProgress.length === 0
                    ? "Nothing was changed — it stopped at the first step."
                    : `It got as far as: ${publishProgress.join(", ")}. Nothing after that was changed.`}
                </p>
              )}
            </div>
          )}

          {/* ── Changing it afterwards, including switching it off ─────────────────────────────── */}
          {view.state === "claimed" && view.address.state !== "no_handle" && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-[12px] font-semibold text-gray-900">Change who can reach you</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                This takes effect immediately. Going private stops your page opening for everybody at
                once, including anybody holding a card or a code you have already given out &mdash; that
                is the one thing on this screen that never asks you to confirm.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {view.discoveryModes.map(m => (
                  <li key={m.key}>
                    <button type="button" title={m.detail} disabled={busy || m.key === view.discovery}
                      onClick={() => setDiscovery(m.key)}
                      className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50 ${
                        m.key === view.discovery
                          ? "border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/[0.06] text-[var(--cp-primary-deep)]"
                          : m.key === "hidden"
                            ? "border-gray-300 text-gray-800 hover:bg-gray-50"
                            : "border-gray-200 text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5"}`}>
                      {m.key === "hidden" ? "Make my page private" : m.label}
                      {m.key === view.discovery && <span className="ml-1 text-[10px] font-normal">· current</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── What a patient reads (s6) ────────────────────────────────────────────────────────────── */}
      {view.state !== "none" && (
        <section className={card}>
          <h2 className="text-[14px] font-bold text-gray-900">What your page says about you</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            {view.address.state === "resolves"
              ? "These are the only fields your page shows, and it is open — so anybody who reaches it reads them."
              : "These are the only fields your page would show. Nobody can read them while your page does not open, and saving them publishes nothing."}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-600">Name on the identity</span>
              <input value={profile.displayName}
                onChange={e => setProfile({ ...profile, displayName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-600">Qualifications</span>
              <input value={profile.qualifications} placeholder="MBChB, MMed"
                onChange={e => setProfile({ ...profile, qualifications: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-600">Specialties</span>
              <input value={profile.specialties} placeholder="Paediatrics"
                onChange={e => setProfile({ ...profile, specialties: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
            {/* Its own field rather than a second thing typed into Specialties: PIS-000 s9 resolves
                search by specialty, and two concepts in one box make that search worse with every
                practitioner who joins. Nothing verifies it, exactly like the four fields around it. */}
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-600">Sub-specialty</span>
              <input value={profile.subSpecialty} placeholder="Paediatric urology"
                onChange={e => setProfile({ ...profile, subSpecialty: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-600">Languages</span>
              <input value={profile.languages} placeholder="English, Luganda"
                onChange={e => setProfile({ ...profile, languages: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-semibold text-gray-600">Consultation types</span>
              <input value={profile.consultationTypes} placeholder="In person, follow-up"
                onChange={e => setProfile({ ...profile, consultationTypes: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-semibold text-gray-600">About you</span>
              <textarea value={profile.biography} rows={4}
                onChange={e => setProfile({ ...profile, biography: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] leading-relaxed text-gray-900 focus:border-[var(--cp-primary)] focus:outline-none" />
            </label>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
            Your practitioner number and your handle appear on the page too, and neither is editable.
            Nothing else is shown &mdash; there is no rating, no review count, no photograph and no
            response time, because this product measures none of them.
          </p>

          <button type="button" onClick={saveProfile} disabled={busy}
            className="mt-2.5 rounded-lg border border-gray-300 px-4 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </section>
      )}

      {/* ── CPB-002's Booking & Sharing Workspace ────────────────────────────────────────────────── */}
      {/* ⚠ `view.sharing` IS NULL UNLESS resolveHandle SAID THE ADDRESS OPENS. Everything below leaves
          this product for somewhere it cannot be corrected — a card, a poster, a WhatsApp message — so
          it must never be drawn for an address that answers a patient with "no such page". */}
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
            {/* Drawn in this process from the address above. No external image service ever sees it.
                ⚠ THE SVG MUST BE CONSTRAINED OR IT SITS ON TOP OF EVERYTHING BESIDE IT. `bookingQr`
                asks the encoder for `width: 320`, which emits width="320" height="320" ATTRIBUTES on the
                svg element. An intrinsic size like that ignores the 144px wrapper, so the code overflowed
                its box and overlapped the share buttons and both paragraphs -- found by the practice
                owner on the page immediately after publishing the platform's first booking address.
                A percentage width on the child is what makes it obey the box it is in. */}
            <div className="w-36 shrink-0 rounded-lg border border-gray-200 bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: view.sharing.qrSvg }} />
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-[12px] font-semibold text-gray-900">{view.sharing.url}</p>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {view.sharing.targets.map(t => (
                  <li key={t.key}>
                    {t.href ? (
                      <a href={t.href} target="_blank" rel="noopener noreferrer" title={t.detail}
                        onClick={() => recordShare(t.key)}
                        className="inline-block rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5">
                        {t.label}
                        {/* ⚠ SAID ON THE BUTTON, not only in a tooltip. Facebook and LinkedIn receive
                            the address the moment it is clicked. */}
                        {t.leavesCompeten && <span className="ml-1 text-[10px] font-normal text-gray-400">↗</span>}
                      </a>
                    ) : (
                      <button type="button" title={t.detail}
                        onClick={() => { void navigator.clipboard?.writeText(view.sharing!.url); recordShare(t.key); setDone("Link copied. Nothing was sent."); }}
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
                  onClick={() => recordShare("qr_png")}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                  Download PNG
                </a>
                <a href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(view.sharing.qrSvg)}`}
                  download={`${view.sharing.handle}-booking-qr.svg`}
                  onClick={() => recordShare("qr_svg")}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                  Download SVG
                </a>
                <Link href={view.sharing.printPath} target="_blank" onClick={() => recordShare("print")}
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
