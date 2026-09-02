"use client";

import { useCallback, useState } from "react";
import { maskEmail, maskPhone } from "../appointment/BookingWizard";
import { IdentityStrip, type SummaryIdentity } from "../appointment/BookingSummary";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-FLOW-002 s13 -- MANAGING A BOOKING YOU ALREADY HAVE.
//
// ⚠ EVERY REFUSAL ON THIS SCREEN IS THE SERVER'S. Whether a booking may be moved or cancelled is
// `canReschedule` / `canCancel` on the engine's own payload, derived from the appointment's state and
// the practice's rule -- and `whyNot` is the sentence that goes with them. This file never computes
// eligibility, because a screen that decided it would eventually disagree with the engine that enforces
// it, and the patient would meet that disagreement as a button that does nothing.
//
// ⚠ AND ASKING FOR A CODE TELLS NOBODY ANYTHING. The answer is identical whether or not that address
// has a booking here. There is no "we found no bookings for that email" state before verification,
// because that sentence is an enumeration oracle wearing a helpful tone.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const CONTROL =
  "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const PRIMARY =
  "rounded-lg bg-[var(--cp-primary)] px-4 py-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50";
const SECONDARY =
  "rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-[12.5px] font-semibold text-gray-700 disabled:opacity-50";
const CARD = "rounded-xl border border-gray-200 bg-white p-4";

type Booking = {
  reference: string; status: string; scheduledAt: string; durationMinutes: number;
  appointmentType: string; locationName: string | null; instructions: string | null;
  canReschedule: boolean; canCancel: boolean; whyNot: string | null;
};

type Slot = { startsAt: string; minutes: number; locationId: string | null; locationName: string | null };

export default function ManageConsole({ handle, identity, timezone }: {
  handle: string; identity: SummaryIdentity; timezone: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [destination, setDestination] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [listIncomplete, setListIncomplete] = useState(false);
  const [moving, setMoving] = useState<Booking | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");

  const fmt = useCallback((iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
        timeZone: timezone,
      });
    } catch { return iso; }
  }, [timezone]);

  async function call(body: any) {
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/v1/practice/public/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      // ⚠ THE SERVER'S SENTENCE, NOT A REWRITE OF IT. It is the only part of the answer that says what
      // to do next.
      if (!res.ok) { setProblem(data?.error?.message ?? `That did not work (${res.status}).`); return null; }
      return data;
    } catch (e) {
      setProblem(`Nothing could be sent just now: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally { setBusy(false); }
  }

  async function loadList(t: string) {
    const r = await call({ action: "list", token: t });
    if (!r) return;
    setBookings((r.bookings ?? []) as Booking[]);
    setListIncomplete(r.listIncomplete === true);
  }

  // ══ NOT VERIFIED YET ═══════════════════════════════════════════════════════════════════════════
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <div className={CARD}><IdentityStrip identity={identity} locationName={null} /></div>

        <section className={CARD}>
          <h1 className="text-[15px] font-bold text-gray-900">Your appointment</h1>
          {!challengeId ? (
            <>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                Enter the email address you booked with and we will send you a 6-digit code.
              </p>
              <label className="mt-3 block max-w-sm">
                <span className="text-[12px] font-semibold text-gray-800">Email address</span>
                <input value={destination} onChange={e => setDestination(e.target.value)}
                  type="email" autoComplete="email" className={`mt-1 ${CONTROL}`} />
              </label>
              {problem && <Problem text={problem} />}
              <button type="button" className={`mt-3 ${PRIMARY}`} disabled={busy || !destination.trim()}
                onClick={async () => {
                  const r = await call({ action: "request_code", channel: "email", destination });
                  if (r?.challengeId) setChallengeId(String(r.challengeId));
                }}>
                {busy ? "Sending…" : "Send me a code"}
              </button>
            </>
          ) : (
            <>
              <h2 className="mt-1 text-[13px] font-bold text-gray-900">Check your email</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                We sent a 6-digit code to <span className="font-semibold text-gray-800">
                  {destination.includes("@") ? maskEmail(destination) : maskPhone(destination)}
                </span>.
              </p>
              <label className="mt-3 flex flex-col text-[11px] font-semibold text-gray-700">
                Enter the code
                <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  aria-label="Six-digit verification code"
                  className={`mt-0.5 max-w-[220px] tracking-[0.4em] ${CONTROL}`} />
              </label>
              {problem && <Problem text={problem} />}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} disabled={busy || code.length !== 6}
                  onClick={async () => {
                    const v = await call({ action: "confirm_code", challengeId, code });
                    if (!v?.token) return;
                    setToken(String(v.token));
                    await loadList(String(v.token));
                  }}>
                  {busy ? "Checking…" : "Show my appointment"}
                </button>
                <button type="button" className={SECONDARY} disabled={busy}
                  onClick={() => { setChallengeId(null); setCode(""); }}>
                  Use a different address
                </button>
              </div>
              <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                Not arrived? Check your spam folder. The code expires a few minutes after it is sent.
              </p>
            </>
          )}
        </section>
      </div>
    );
  }

  // ══ VERIFIED ═══════════════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}><IdentityStrip identity={identity} locationName={null} /></div>

      {notice && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-emerald-900">
          {notice}
        </p>
      )}
      {problem && <Problem text={problem} />}

      {bookings !== null && bookings.length === 0 && (
        <section className={CARD}>
          <h1 className="text-[15px] font-bold text-gray-900">Nothing to show</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
            There are no upcoming appointments booked with this address at this practice. If you booked
            using a different email, verify that address instead.
          </p>
        </section>
      )}

      {(bookings ?? []).map(b => (
        <section key={b.reference} className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-bold text-gray-900">{fmt(b.scheduledAt)}</h2>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">
              {b.reference}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-gray-600">
            {b.durationMinutes} minutes{b.locationName ? ` · ${b.locationName}` : ""}
          </p>
          {b.instructions && (
            <p className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-600">{b.instructions}</p>
          )}

          {/* ⚠ WHY NOT, WHERE NEITHER IS OFFERED. A disabled pair of buttons with no reason is a screen
              that looks broken; the engine already wrote the sentence. */}
          {!b.canReschedule && !b.canCancel && b.whyNot && (
            <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 p-3 text-[11.5px] leading-relaxed text-gray-600">
              {b.whyNot}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {b.canReschedule && (
              <button type="button" className={SECONDARY} disabled={busy}
                onClick={async () => {
                  setMoving(b); setCancelling(null); setSlots(null); setNotice(null);
                  const r = await call({
                    action: "times", appointmentType: b.appointmentType,
                    to: new Date(Date.now() + 28 * 86400000).toISOString(),
                  });
                  if (r) setSlots((r.slots ?? []) as Slot[]);
                }}>
                Move this appointment
              </button>
            )}
            {b.canCancel && (
              <button type="button" className={SECONDARY} disabled={busy}
                onClick={() => { setCancelling(b); setMoving(null); setReason(""); setNotice(null); }}>
                Cancel this appointment
              </button>
            )}
          </div>

          {/* ── MOVE ────────────────────────────────────────────────────────────────────────────── */}
          {moving?.reference === b.reference && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="text-[12.5px] font-bold text-gray-900">Choose a new time</h3>
              {slots === null && <p className="mt-1 text-[12px] text-gray-500">Reading the diary…</p>}
              {slots !== null && slots.length === 0 && (
                <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                  There are no other times available in the next four weeks. Your existing appointment is
                  unchanged.
                </p>
              )}
              {slots !== null && slots.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {slots.slice(0, 40).map(s => (
                    <button key={s.startsAt} type="button" disabled={busy}
                      className="rounded-lg bg-gray-100 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                      onClick={async () => {
                        const r = await call({
                          action: "reschedule", token, reference: b.reference, scheduledAt: s.startsAt,
                        });
                        if (!r) return;
                        setMoving(null); setSlots(null);
                        // The engine's own sentence about whether anything was sent -- never this
                        // screen's guess about the practice's channels.
                        setNotice(String(r.confirmationNote ?? "Your appointment has been moved."));
                        await loadList(token);
                      }}>
                      {fmt(s.startsAt)}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className={`mt-3 ${SECONDARY}`} onClick={() => { setMoving(null); setSlots(null); }}>
                Keep my current time
              </button>
            </div>
          )}

          {/* ── CANCEL ──────────────────────────────────────────────────────────────────────────── */}
          {cancelling?.reference === b.reference && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="text-[12.5px] font-bold text-gray-900">Cancel this appointment?</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                This frees the time for somebody else and cannot be undone from here.
              </p>
              <label className="mt-2 block max-w-md">
                <span className="text-[11.5px] font-semibold text-gray-700">
                  Reason (optional)
                </span>
                <textarea value={reason} rows={2} maxLength={500}
                  onChange={e => setReason(e.target.value)}
                  className={`mt-1 ${CONTROL}`} />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy}
                  className="rounded-lg bg-rose-600 px-4 py-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                  onClick={async () => {
                    const r = await call({ action: "cancel", token, reference: b.reference, reason });
                    if (!r) return;
                    setCancelling(null);
                    setNotice(String(r.confirmationNote ?? "This appointment has been cancelled."));
                    await loadList(token);
                  }}>
                  {busy ? "Cancelling…" : "Yes, cancel it"}
                </button>
                <button type="button" className={SECONDARY} onClick={() => setCancelling(null)}>
                  Keep this appointment
                </button>
              </div>
            </div>
          )}
        </section>
      ))}

      {/* ⚠ A CAPPED LIST SAYS SO. Telling somebody they have one appointment because a read stopped at
          its limit is how a person misses the second one. */}
      {listIncomplete && (
        <p className="text-[11.5px] leading-relaxed text-amber-900">
          There may be more appointments than are shown here. Contact the practice if one is missing.
        </p>
      )}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] leading-relaxed text-rose-800">
      {text}
    </p>
  );
}
