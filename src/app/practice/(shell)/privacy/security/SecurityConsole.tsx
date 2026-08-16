"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/datetime";
import { SESSION_PREVIEW_EVENT, CONSOLE_IDLE_OPTIONS } from "@/lib/practice/session-engine";

// CPR-370's security surface: devices, emergency access, consent counts and the policy.
//
// THE COMP'S SECURITY SCORE, MFA COVERAGE PERCENTAGE, COMPLIANCE BADGES AND AUDIT-READINESS FIGURE ARE
// ALL ABSENT, and the panel that would have held them says what this product cannot know instead. That
// panel is the most useful thing on the page: a practitioner deciding whether to trust a system with
// patient records is better served by an honest list of unknowns than by four green ticks.
//
// "SIGN OUT THIS DEVICE" IS THE ONE CONTROL HERE THAT COULD LIE, so the sentence limiting it sits beside
// the button and not in a footnote. Revoking locks the device out of the practice on its next request --
// which is real and enforced by the shell -- and does not end the platform session.

const card = "rounded-xl border border-gray-200 bg-white p-4";
const input = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ⚠ A FIGURE THAT COULD NOT BE READ IS NOT A NOUGHT.
 *
 * Every count on this page used to arrive as a number whatever happened, because the engines behind it
 * wrote `data ?? []` and `count ?? 0`. The worst of them printed a large "0" above the words "record
 * reads logged — in the last 7 days" on a FAILED COUNT: the page whose first guarantee is that every read
 * of a patient record is logged, telling a practice that none had been. They now arrive as null when the
 * read did not happen, and this is the one place that renders that.
 */
const figure = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));
const unreadable = "This figure could not be read just now. It is not nought — reload to try again.";

export default function SecurityConsole({
  posture, sessions, sessionsReadable, sessionNamesReadable, glass, canManage, canReview, me,
}: {
  posture: any; sessions: any[]; sessionsReadable: boolean; sessionNamesReadable: boolean;
  glass: any; canManage: boolean; canReview: boolean; me: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function send(body: unknown) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/security", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {posture && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Devices signed in</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{figure(posture.liveSessions)}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              {posture.sessionsReadable ? `${figure(posture.trustedDevices)} marked trusted` : unreadable}
            </p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Sign-ins recorded</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{figure(posture.authEvents?.signInsLast7Days)}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              {posture.authEvents?.readable === false ? unreadable
                : `in the last 7 days · ${figure(posture.authEvents?.refusalsLast7Days)} turned away`}
            </p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Record reads logged</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{figure(posture.accessEventsLast7Days)}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              {posture.accessLogReadable === false ? unreadable : "in the last 7 days"}
            </p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Emergency access</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{figure(posture.breakGlass.awaitingReview)}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              {posture.breakGlassReadable === false ? unreadable
                : `awaiting review${posture.breakGlass.live > 0 ? ` · ${posture.breakGlass.live} live now` : ""}`}
            </p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Consents</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{figure(posture.consents.active)}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              {posture.consents.readable === false ? unreadable
                : `active · ${figure(posture.consents.expiringSoon)} expiring · ${figure(posture.consents.withdrawn)} withdrawn`}
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 grid lg:grid-cols-2 gap-4 items-start">
        {/* ── Devices ─────────────────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">
            {canManage ? "Devices in this practice" : "Your devices"}
          </h2>
          {/* The sentence that stops this control being a lie. Beside the buttons, not in a footnote. */}
          <p className="mt-0.5 text-[11px] text-gray-500">
            Locking a device out refuses it here on its next request. It does <strong>not</strong> sign
            that person out of Competen &mdash; this product cannot end a platform session.
          </p>
          {/* ⚠ "NOTHING RECORDED YET" IS A CLAIM ABOUT THIS PRACTICE, and until now it was also what a
              failed read produced. An administrator looking for the laptop somebody had just lost would
              have been shown an empty list and concluded there was nothing to lock out. */}
          {!sessionsReadable ? (
            <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
              The device list could not be read just now, so it is not shown. This is <strong>not</strong>{" "}
              an empty list &mdash; there may be devices signed in that are not appearing. Nothing has
              changed. Reload to try again.
            </p>
          ) : sessions.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {sessions.map((s: any) => (
                <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-gray-800">
                      {s.device_label ?? "Unnamed device"}
                      {s.trusted && <span className="ml-1 text-[10px] font-normal text-gray-500">· trusted</span>}
                    </span>
                    <span className="block truncate text-[10px] text-gray-500">
                      {canManage
                        ? (sessionNamesReadable ? (s.name ? `${s.name} · ` : "") : "name unavailable · ")
                        : ""}
                      {String(s.user_agent ?? "unknown browser").slice(0, 60)}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-right">
                    <span className="block text-[10px] text-gray-500">
                      {s.live ? `last used ${new Date(s.last_seen_at).toLocaleDateString()}` : "locked out"}
                    </span>
                    {s.live && s.user_id === me && (
                      <button type="button" disabled={busy}
                        onClick={() => send({ trustSessionId: s.id, trusted: !s.trusted })}
                        className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        {s.trusted ? "Untrust" : "Trust this device"}
                      </button>
                    )}
                    {s.live && canManage && (
                      <button type="button" disabled={busy} onClick={() => {
                        const reason = prompt("Why is this device being locked out?");
                        if (reason !== null) send({ revokeSessionId: s.id, reason });
                      }} className="ml-2 text-[10px] text-[var(--cmp-text-critical)] hover:underline">
                        Lock out
                      </button>
                    )}
                    {!s.live && s.revoked_reason && (
                      <span className="block text-[10px] text-gray-400">{s.revoked_reason}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Emergency access ────────────────────────────────────────────────────────────────────── */}
        {canReview && (
          <section className={card}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold text-gray-900">Emergency access</h2>
              <span className="text-[11px] text-gray-500">{figure(glass.awaitingReview)} awaiting review</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Somebody took access to a record they would not normally see. Every episode stays here until
              a second person has read it &mdash; nothing ages out.
            </p>
            {/* ⚠ "None. That is the usual state." IS REASSURANCE, and reassurance produced by a failed
                read is the worst output this panel could have. The list is the control; a control that
                quietly stops showing things is not one. */}
            {glass.readable === false ? (
              <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
                The emergency-access list could not be read just now, so it is not shown. This is{" "}
                <strong>not</strong> the same as there being none, and episodes may be awaiting review that
                are not appearing here. Reload to try again.
              </p>
            ) : glass.episodes.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">None. That is the usual state.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {glass.episodes.map((e: any) => (
                  <li key={e.id} className="border-b border-gray-100 py-1.5 last:border-0">
                    <div className="flex items-baseline gap-2">
                      {/* "Unnamed member" is a statement about a person, and on a failed name lookup it
                          would be made about a named clinician. */}
                      <span className="text-[12px] font-semibold text-gray-800">
                        {glass.namesReadable === false ? "Name unavailable" : (e.name ?? "Unnamed member")}
                      </span>
                      {e.live && (
                        <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-critical)]">
                          live now
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-gray-500">
                        {formatDateTime(e.started_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-600">{e.reason}</p>
                    {e.reviewed_at ? (
                      <p className="mt-0.5 text-[10px] text-gray-500">
                        Reviewed by {e.reviewedByName ?? "somebody"} &mdash; {e.review_note}
                      </p>
                    ) : e.user_id === me ? (
                      // Nobody reviews their own, so the control is not offered rather than
                      // offered-and-refused.
                      <p className="mt-0.5 text-[10px] text-gray-400">Yours &mdash; somebody else reviews it.</p>
                    ) : reviewing === e.id ? (
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <input value={note} onChange={ev => setNote(ev.target.value)}
                          placeholder="What did you find?" className={`${input} w-56`} />
                        <button type="button" disabled={busy || !note.trim()}
                          onClick={() => send({ reviewBreakGlassId: e.id, note })}
                          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                          Record the review
                        </button>
                        <button type="button" onClick={() => setReviewing(null)}
                          className="text-[11px] text-gray-500 hover:underline">Cancel</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => { setReviewing(e.id); setNote(""); }}
                        className="mt-0.5 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        Review it
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {canManage && posture && (
        <section className={`${card} mt-4`}>
          <h2 className="text-[13px] font-bold text-gray-900">Policy</h2>
          {/* AN UNREADABLE POLICY IS NOT AN "OFF" ONE. Both switches below are rendered from stored
              values; when the read failed those values are placeholders, and an unchecked box would tell
              a practice that requires two-factor authentication that it does not. Say so and offer
              nothing to click, rather than showing a switch that is answering a question it cannot. */}
          {posture.policyReadable === false ? (
            <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
              This practice&rsquo;s policy could not be read just now, so it is not shown and cannot be
              changed from here. Nothing has changed. Reload to try again.
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-[12px] text-gray-700">
                <input type="checkbox" className="mt-0.5" checked={posture.policy.mfa_required} disabled={busy}
                  onChange={e => send({ mfaRequired: e.target.checked })} />
                <span>
                  Require two-factor authentication
                  {/* ⚠ THE TRAP, STILL NEXT TO THE SWITCH -- softened only by the truth changing.
                      /practice/two-factor exists now (2026-08-16), so a member shut out by this switch
                      has a door back in. The lockout warning stays, because "there is a door" and
                      "everyone has walked through it" are different sentences. */}
                  <span className="block text-[10px] text-gray-500">
                    Two-factor lives on the Competen account. Members set one up at
                    Practice&nbsp;&rarr;&nbsp;Two-factor authentication (/practice/two-factor), which
                    stays reachable even when this practice refuses them. Turning this on still shuts
                    out everyone without a factor &mdash; including you, from your next page load &mdash;
                    until they enrol there. Set yours up FIRST.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px] text-gray-700">
                <input type="checkbox" className="mt-0.5" checked={posture.policy.break_glass_enabled} disabled={busy}
                  onChange={e => send({ breakGlassEnabled: e.target.checked })} />
                <span>
                  Allow emergency access
                  <span className="block text-[10px] text-gray-500">
                    Lasts {posture.policy.break_glass_minutes} minutes, always logged, always reviewed.
                    Turning it off means a clinician facing an emergency is refused instead.
                  </span>
                </span>
              </label>
              {/* ⚠ THE IDLE RULE STARTED WORKING IN THIS RELEASE AND HAD NEVER WORKED BEFORE, so it is
                  stated rather than left to be discovered. It was written into the database and enforced
                  in code from the start, and could never fire: the device cookie was re-minted on every
                  request, so no browser was ever seen twice and no idle interval could be measured. */}
              <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                <strong className="text-gray-800">Idle sign-out:</strong>{" "}
                {posture.idleLimitEnforced
                  ? `set to ${posture.idleLimitMinutes} minutes. A device left unused for longer is locked out of this practice and has to sign in again.`
                  : "not set, so no device is ever locked out for sitting unused."}{" "}
                This limit now takes effect; until this release it was recorded but could never fire,
                because every request looked like a new device. An idle lock-out is cleared by signing in
                again &mdash; a lock-out somebody applied by hand is not.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── THE SESSION LIFECYCLE (COMP-AUTH-001) ────────────────────────────────────────────────────
          The panel that says what the idle rule, the lock screen and the pause actually do HERE, what
          they have already done, and the things this build does not do at all. It rides on the posture,
          which the page reads only for a caller holding practice.settings.manage -- so a member without
          it sees the behaviour itself (the Pause button, and the warning where a limit is set) but not
          these figures. That is a permission rather than a failure, and it is why the panel says nothing
          when `posture` is null instead of rendering an empty one. */}
      {posture?.sessionLifetime && (
        <SessionLifetimePanel life={posture.sessionLifetime} canManage={canManage} busy={busy} send={send} />
      )}

      {/* ── WHAT THE SIGN-IN RECORD COVERS, AND WHAT IT DOES NOT ──────────────────────────────────── */}
      {posture?.authEvents && (
        <section className={`${card} mt-4`}>
          <h2 className="text-[13px] font-bold text-gray-900">The sign-in record</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            Until this release nothing in this product recorded that anybody had ever signed in. Both
            lists below come from the code that writes the trail, so this panel cannot describe more than
            is actually recorded.
          </p>
          <div className="mt-3 grid sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-[11px] font-semibold text-gray-700">Recorded</h3>
              <ul className="mt-1.5 flex flex-col gap-1">
                {posture.authEvents.recordedTypes.map((t: any) => (
                  <li key={t.type} className="flex items-baseline gap-2 text-[11.5px] leading-snug text-gray-700">
                    <span aria-hidden className="text-[var(--cmp-text-success)]">✓</span>{t.what}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-semibold text-gray-700">Not recorded, and why</h3>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {posture.authEvents.notRecordedHere.map((n: any) => (
                  <li key={n.what} className="text-[11.5px] leading-snug text-gray-600">
                    <span aria-hidden className="mr-1.5 text-gray-400">—</span>
                    <strong className="font-semibold text-gray-700">{n.what}</strong> {n.why}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {posture.authEvents.readable === false && (
            <p className="mt-3 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
              The sign-in record itself could not be read just now, so the figures above it are shown as
              unavailable rather than as nought. Reload to try again.
            </p>
          )}
        </section>
      )}

      {posture && (
        <div className="mt-4 grid lg:grid-cols-2 gap-4 items-start">
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">What this product guarantees</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Each of these is a property of the code, and each is asserted by a test that has been made
              to fail on purpose.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {posture.guarantees.map((g: string, i: number) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px] text-gray-700">
                  <span aria-hidden className="text-[var(--cmp-text-success)]">✓</span>{g}
                </li>
              ))}
            </ul>
          </section>

          {/* THE PANEL THE COMP HAS NO ROOM FOR, and the most useful one here. */}
          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">What this page cannot tell you</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              The design this was built from shows a security score, an encryption badge, a data-residency
              label and three compliance ticks. None of them is knowable from inside this application, so
              none is shown.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {posture.notKnowableFromHere.map((s: string, i: number) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px] text-gray-600">
                  <span aria-hidden className="text-gray-400">—</span>{s}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

/**
 * COMP-AUTH-001's session lifecycle, said plainly.
 *
 * ⚠ THE HEADLINE IS THE MODE, AND FOR EVERY PRACTICE ALIVE TODAY THE MODE IS "no limit set". This panel
 * exists so that reads as a fact rather than as an absence: a practice looking for an idle rule should
 * find out in one sentence that it has none, see what one would have cost it, and be able to WATCH the
 * behaviour before switching it on. A security page that showed a countdown nobody had configured would
 * be the same class of claim as the score this page refuses to print.
 */
function SessionLifetimePanel({ life, canManage, busy, send }: {
  life: any; canManage: boolean; busy: boolean; send: (body: unknown) => void;
}) {
  const observed = life.observed ?? {};
  const enforcing = life.mode === "ENFORCE";
  const unknown = life.mode === "UNKNOWN";

  return (
    <section className={`${card} mt-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold text-gray-900">Sessions: idle, locked and paused</h2>
        {/* ⚠ THE REHEARSAL. "Ship it warn-only-capable" — a practice must be able to see this before it
            bites. One window event; the guard runs the real warning and the real cover against the real
            decision, and nothing is changed, recorded or shown to anybody else. */}
        <button type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(SESSION_PREVIEW_EVENT))}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50">
          Show me what this looks like
        </button>
      </div>

      {/* THREE STATES, and the third is not "off". */}
      <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] leading-relaxed text-gray-600">
        {unknown ? (
          <>
            <strong className="text-gray-800">This could not be read.</strong>{" "}
            This practice&rsquo;s policy did not come back just now, so nothing here is being applied:
            no screen is being covered and no session is being counted. That is <strong>not</strong> the
            same as having no limit. Reload to try again.
          </>
        ) : enforcing ? (
          <>
            <strong className="text-gray-800">Idle limit: {life.idleMinutes} minutes.</strong>{" "}
            A warning and a countdown appear {life.warningSeconds} seconds before the end. If nobody
            answers, the screen is covered and a password brings it back. A session actually in use tells
            this practice so every {Math.round(life.heartbeatSeconds / 60)} minutes, so working on one
            page for a long time no longer looks like an empty desk.
          </>
        ) : (
          <>
            <strong className="text-gray-800">No idle limit is set.</strong>{" "}
            Nothing counts down, nothing is covered and nobody is signed out for being away. What does
            happen is a count: a session left unused for more than {life.idleObservationMinutes} minutes
            is noted in the sign-in record, so this practice can see what a limit would have done before
            setting one.
          </>
        )}
      </p>

      {canManage && !unknown && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-[12px] font-semibold text-gray-700" htmlFor="idle-limit">Idle limit</label>
          <select id="idle-limit" disabled={busy} value={life.idleMinutes ?? ""}
            onChange={e => send({ sessionIdleMinutes: e.target.value === "" ? null : Number(e.target.value) })}
            className={input}>
            <option value="">No limit</option>
            {CONSOLE_IDLE_OPTIONS.map(m => <option key={m} value={m}>{m} minutes</option>)}
            {/* A limit set through the API outside this list is shown rather than silently replaced by
                the nearest option, which would misreport what is actually stored. */}
            {life.idleMinutes && !(CONSOLE_IDLE_OPTIONS as readonly number[]).includes(life.idleMinutes) && (
              <option value={life.idleMinutes}>{life.idleMinutes} minutes</option>
            )}
          </select>
          <span className="text-[10.5px] leading-snug text-gray-500">
            The shortest offered here is {Math.min(...CONSOLE_IDLE_OPTIONS)} minutes. The database accepts
            5, and this page does not offer it: a limit shorter than a consultation covers the screen of
            somebody who is in the middle of one.
          </span>
        </div>
      )}

      <div className="mt-3 grid sm:grid-cols-2 gap-4">
        <div>
          <h3 className="text-[11px] font-semibold text-gray-700">What has happened, last 7 days</h3>
          {life.observedReadable === false ? (
            <p className="mt-1.5 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-warning)]">
              The sign-in record could not be read, so these are shown as unavailable rather than as
              nought. Reload to try again.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1 text-[11.5px] text-gray-600">
              <li>{figure(observed.screensCoveredLast7Days)} screens covered, of which {figure(observed.pausesLast7Days)} were paused on purpose</li>
              <li>{figure(observed.idleStretchesObservedLast7Days)} idle stretches past {life.idleObservationMinutes} minutes {enforcing ? "before the limit was set" : "— what a limit would have caught"}</li>
              <li>{figure(observed.sessionsPastAbsoluteObservationLast7Days)} sessions still open more than {Math.round(life.absoluteObservationMinutes / 60)} hours after signing in</li>
            </ul>
          )}
          {/* ⚠ THE FLOOR, NOT THE TOTAL. A tab closed before it could report writes nothing, and no later
              request can reconstruct it. A practice counting locks must know that. */}
          <p className="mt-1.5 text-[10.5px] leading-snug text-gray-400">
            The first figure is a floor rather than a total: a tab closed at the moment it covered itself
            reports nothing, and nothing afterwards can recover it.
          </p>
        </div>
        <div>
          <h3 className="text-[11px] font-semibold text-gray-700">What is not built</h3>
          <ul className="mt-1.5 flex flex-col gap-1.5 text-[11.5px] leading-snug text-gray-600">
            {/* THE CAP COMP-AUTH-001 ASKS FOR, AND WHY THERE ISN'T ONE. Read from the engine so this
                cannot describe a control the code does not have. */}
            <li>
              <strong className="font-semibold text-gray-700">No cap on session age.</strong>{" "}
              {life.absoluteLifetime?.notEnforced} {life.absoluteLifetime?.whatWouldBuildIt}
            </li>
            {life.clinicalPauseNotBuilt?.map((s: string) => (
              <li key={s}><span aria-hidden className="mr-1 text-gray-300">—</span>{s}</li>
            ))}
            {life.resumeMethodsNotBuilt?.map((s: string) => (
              <li key={s}><span aria-hidden className="mr-1 text-gray-300">—</span>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
