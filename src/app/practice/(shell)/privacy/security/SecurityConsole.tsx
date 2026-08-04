"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/datetime";

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

export default function SecurityConsole({ posture, sessions, glass, canManage, canReview, me }: {
  posture: any; sessions: any[]; glass: any; canManage: boolean; canReview: boolean; me: string;
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
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Devices signed in</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{posture.liveSessions}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">{posture.trustedDevices} marked trusted</p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Record reads logged</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{posture.accessEventsLast7Days}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">in the last 7 days</p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Emergency access</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{posture.breakGlass.awaitingReview}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              awaiting review{posture.breakGlass.live > 0 ? ` · ${posture.breakGlass.live} live now` : ""}
            </p>
          </div>
          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-500">Consents</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{posture.consents.active}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              active · {posture.consents.expiringSoon} expiring · {posture.consents.withdrawn} withdrawn
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
          {sessions.length === 0 ? (
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
                      {canManage && s.name ? `${s.name} · ` : ""}
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
              <span className="text-[11px] text-gray-500">{glass.awaitingReview} awaiting review</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Somebody took access to a record they would not normally see. Every episode stays here until
              a second person has read it &mdash; nothing ages out.
            </p>
            {glass.episodes.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">None. That is the usual state.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {glass.episodes.map((e: any) => (
                  <li key={e.id} className="border-b border-gray-100 py-1.5 last:border-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-semibold text-gray-800">{e.name ?? "Unnamed member"}</span>
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
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-start gap-2 text-[12px] text-gray-700">
              <input type="checkbox" className="mt-0.5" checked={posture.policy.mfa_required} disabled={busy}
                onChange={e => send({ mfaRequired: e.target.checked })} />
              <span>
                Require two-factor authentication
                {/* The limit, next to the switch. */}
                <span className="block text-[10px] text-gray-500">
                  Two-factor is set up on the Competen account, not here. Turning this on means this
                  practice will not open without it &mdash; it does not enrol anybody.
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
          </div>
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
