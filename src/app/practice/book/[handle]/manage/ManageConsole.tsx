"use client";

import { useCallback, useState } from "react";
import { maskEmail, maskPhone } from "../appointment/BookingWizard";
import { IdentityStrip, type SummaryIdentity } from "../appointment/BookingSummary";
import { buildIcs, directionsUrl } from "@/lib/practice/calendar-invite";
import { appointmentTypeLabel } from "@/lib/practice/practice-session-constants";

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
  appointmentType: string; locationName: string | null; locationId: string | null;
  instructions: string | null;
  locationMode: string | null; locationAddress: string | null; locationMapUrl: string | null;
  canReschedule: boolean; canCancel: boolean; whyNot: string | null;
};

type Slot = { startsAt: string; minutes: number; locationId: string | null; locationName: string | null };

export default function ManageConsole({ handle, identity, timezone }: {
  handle: string; identity: SummaryIdentity; timezone: string;
}) {
  const [busy, setBusy] = useState(false);
  /** Which reference was just copied, so the button can say so rather than flashing nothing. */
  const [copied, setCopied] = useState<string | null>(null);
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
  /** §10: which location the reschedule search is scoped to. "" means every location. */
  const [rescheduleAt, setRescheduleAt] = useState<string>("");
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");

  /**
   * §8 / AC-08 / §20: a directions link ONLY where the practice set a destination.
   *
   * ⚠ directionsUrl RETURNS NULL FOR A NAME ALONE, and that is the whole reason it is used here rather
   * than a search URL built from the location name. §8: "Do not invent addresses from free text." Two
   * clinics share a name; a street repeats in another town; and the wrong guess sends somebody who is
   * unwell to the wrong building. §20 says the fallback is the name with no map action, which is what
   * a null produces.
   */
  const directionsFor = useCallback((b: Booking) =>
    directionsUrl({ name: b.locationName, address: b.locationAddress, mapUrl: b.locationMapUrl }),
  []);

  /**
   * §7: the calendar event.
   *
   * ⚠ NO REASON FOR VISIT (§7, AC-07). "Do not place sensitive clinical free text such as reason for
   * visit in a third-party calendar event by default" -- so the event carries who, what kind, when and
   * where, and the sentence the patient typed about their child stays out of Google's servers.
   */
  const icsFor = useCallback((b: Booking) => buildIcs({
    reference: b.reference,
    practitioner: identity.displayName,
    startsAt: b.scheduledAt,
    minutes: b.durationMinutes,
    locationName: b.locationName,
    address: b.locationAddress,
  // ⚠ THE STAMP IS PASSED IN, because buildIcs takes one rather than reading a clock -- the same
  // decision that keeps it testable. A calendar entry generated now is stamped now.
  }, new Date().toISOString()), [identity.displayName]);

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
          {/* ── §3/§5: THE STATE, LED WITH, AND NOT CARRIED BY COLOUR ────────────────────────────────
              §5: "Do not rely on green colour alone to communicate confirmation." The word and the mark
              both say it, and the heading changes with the state rather than the tint doing the work. */}
          <p className="flex items-center gap-2">
            <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${
              b.status === "CANCELLED" ? "bg-gray-200 text-gray-600" : "bg-emerald-100 text-emerald-700"}`}>
              {b.status === "CANCELLED" ? "×" : "✓"}
            </span>
            <span className="text-[14px] font-bold text-gray-900">
              {b.status === "CANCELLED" ? "Appointment cancelled"
                : b.status === "COMPLETED" ? "Appointment details"
                  : "Your appointment is confirmed"}
            </span>
          </p>

          {/* §12 / AC-18: after a cancellation, the useful next action is a new appointment -- offered
              here rather than leaving somebody on a dead record with no way forward. */}
          {b.status === "CANCELLED" && (
            <p className="mt-2">
              <a href={`/practice/book/@${handle}/appointment`}
                className="inline-block rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12.5px] font-semibold text-white">
                Book another appointment →
              </a>
            </p>
          )}

          {/* §6: the facts, in the order a patient reads them. */}
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Date &amp; time</dt>
              <dd className="text-[13px] font-bold text-gray-900">{fmt(b.scheduledAt)}</dd>
              <dd className="text-[11.5px] text-gray-600">{b.durationMinutes} minutes</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Where</dt>
              <dd className="text-[13px] font-semibold text-gray-900">{b.locationName ?? "Not recorded"}</dd>
              <dd className="text-[11.5px] text-gray-600">
                {b.locationMode === "virtual" ? "Online consultation" : "In-person"}
              </dd>
              {/* ⚠ §8 / AC-08 / §20: DIRECTIONS ONLY WHERE A DESTINATION EXISTS, and the address is
                  shown as text either way. "Directions unavailable -- show location name without a dead
                  map action" is the spec's own line, and a link that opens a search for a name is the
                  guess §8 forbids. */}
              {directionsFor(b) && (
                <dd className="mt-0.5">
                  <a href={directionsFor(b)!} target="_blank" rel="noopener noreferrer"
                    className="text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    View location / directions ↗
                  </a>
                </dd>
              )}
              {b.locationAddress && (
                <dd className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{b.locationAddress}</dd>
              )}
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Appointment</dt>
              <dd className="text-[13px] font-semibold text-gray-900">{appointmentTypeLabel(b.appointmentType)}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Practitioner</dt>
              <dd className="text-[13px] font-semibold text-gray-900">{identity.displayName}</dd>
              {identity.specialty && <dd className="text-[11.5px] text-gray-600">{identity.specialty}</dd>}
            </div>
          </dl>

          {/* ── §7: ADD TO CALENDAR ──────────────────────────────────────────────────────────────────
              ⚠ ICS, AND NO REASON FOR VISIT IN IT (§7, AC-07). The event carries who, what kind, when
              and where; the clinical free text a patient typed is not put into a third-party calendar.
              One standards-based file rather than three provider buttons, because a Google link and an
              Outlook link are two more constructions of the same event to disagree with this one. */}
          {b.status !== "CANCELLED" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <span className="text-[12px] font-semibold text-gray-800">Add to calendar</span>
              <a download={`appointment-${b.reference}.ics`}
                href={`data:text/calendar;charset=utf-8,${encodeURIComponent(icsFor(b))}`}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Download (.ics)
              </a>
              <span className="text-[11px] text-gray-500">Opens in Google, Outlook, Apple Calendar and others.</span>
            </div>
          )}

          {/* ── §14: BEFORE YOUR APPOINTMENT, CONFIGURATION-DRIVEN ──────────────────────────────────
              ⚠ THE COMP'S THREE TILES ARE NOT BUILT. "Arrive 15 minutes early", "bring your ID",
              "bring relevant documents" are sensible and are also advice this practice never wrote.
              §14: "Do not display instructions not explicitly configured for the appointment context"
              and "Provide a neutral empty state ... rather than inventing advice." So this renders what
              the practice actually set, and nothing at all when it set nothing. */}
          {b.instructions && (
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-gray-900">Before your appointment</p>
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-700">{b.instructions}</p>
            </div>
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
                  // §10: the current location first. Opening this releases nothing (AC-13).
                  setRescheduleAt(b.locationId ?? "");
                  const r = await call({
                    action: "times", appointmentType: b.appointmentType,
                    locationId: b.locationId ?? null,
                    to: new Date(Date.now() + 28 * 86400000).toISOString(),
                  });
                  if (r) setSlots((r.slots ?? []) as Slot[]);
                }}>
                {/* §9 / AC-04: the patient's word for it. "Move" is what the system does. */}
                Reschedule appointment
              </button>
            )}
            {b.canCancel && (
              // ⚠ §9 / AC-05: NEVER EQUAL WEIGHT TO CONTINUATION, and the destructive sense carried by
              // the word, not by the colour -- "Cancel appointment" says it in greyscale.
              <button type="button" disabled={busy}
                onClick={() => { setCancelling(b); setMoving(null); setReason(""); setNotice(null); }}
                className="rounded-lg px-3 py-2.5 text-[12.5px] font-semibold text-rose-700 underline underline-offset-2 hover:bg-rose-50 disabled:opacity-50">
                Cancel appointment
              </button>
            )}
          </div>

          {/* ── §6 / AC-03: THE REFERENCE, LOW IN THE HIERARCHY ──────────────────────────────────────
              It led this card as a grey chip beside the date. §2 lists that as a defect: "Booking
              reference is visually prominent despite low patient importance." It matters to whoever
              answers the telephone, so it stays -- at the bottom, with a way to copy it. */}
          {/* ── §13: COMMUNICATION STATE ─────────────────────────────────────────────────────────────
              ⚠ IT NAMES THE ADDRESS THAT WAS PROVED, and masks it. This is the inbox the patient just
              verified with a code to open this page, which is also the one the booking is attached to --
              mineOrRefuse only returns bookings for the verified destination, so the two cannot differ.

              ⚠ AND IT PROMISES NO REMINDER. The comp says "We'll send you a reminder before your
              appointment"; §13 permits that only "if reminders are configured", and this product has no
              reminder at all -- CONFIGURABLE_MESSAGE_TYPES is booking confirmations, cancellation
              notices and rescheduling notices, and nothing schedules a message before a visit. A
              reassurance that nobody is going to act on is worse than silence, because a patient who
              relies on it stops setting their own.

              ⚠ NOR DOES IT MENTION SMS. §13: "Do not claim SMS/WhatsApp delivery when those channels
              are not active." This page verifies by email because email is the only channel this
              deployment can send on, so email is the only one named. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-100 pt-2.5 text-[11.5px]">
            <span aria-hidden>✉</span>
            <span className="text-gray-600">Messages about this appointment go to</span>
            <span className="font-semibold text-gray-800">{maskEmail(destination)}</span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
              Verified
            </span>
          </div>

          <p className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5 text-[11px] text-gray-500">
            Booking reference
            <span className="font-mono font-semibold text-gray-700">{b.reference}</span>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(b.reference); setCopied(b.reference); }}
              className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {copied === b.reference ? "Copied" : "Copy"}
            </button>
          </p>

          {/* ── MOVE ────────────────────────────────────────────────────────────────────────────── */}
          {moving?.reference === b.reference && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="text-[12.5px] font-bold text-gray-900">Choose a new time</h3>
              <p className="mt-0.5 text-[11.5px] text-gray-600">
                Your appointment stays as it is until you choose one.
              </p>

              {/* ── §10: START AT THE CURRENT LOCATION, AND PERMIT CHANGING IT ────────────────────────
                  ⚠ THIS SEARCHED EVERY LOCATION FROM THE START AND SAID NOTHING ABOUT IT. §10 asks it
                  to "start from the current location but permit Change location"; the times were drawn
                  from the whole estate with no label, so a patient rescheduling from TMR could pick a
                  Monday that only exists at Aga Khan and read it as another TMR slot. §11: "Every
                  alternative must identify location; never make cross-location rescheduling
                  ambiguous." The engine was already right -- it moves the appointment to the chosen
                  slot's location -- which is what made the silent version dangerous rather than merely
                  untidy: the booking really would have moved hospitals. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {([[b.locationId ?? "", b.locationName ?? "This location"], ["", "All locations"]] as const)
                  .filter((v, i, a) => i === 0 || v[0] !== a[0][0])
                  .map(([id, label]) => (
                    <button key={label} type="button" disabled={busy}
                      onClick={async () => {
                        setRescheduleAt(id); setSlots(null);
                        const r = await call({
                          action: "times", appointmentType: b.appointmentType,
                          locationId: id || null,
                          to: new Date(Date.now() + 28 * 86400000).toISOString(),
                        });
                        if (r) setSlots((r.slots ?? []) as Slot[]);
                      }}
                      className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold ${
                        rescheduleAt === id
                          ? "bg-[var(--cp-primary)] text-white"
                          : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                      {label}
                    </button>
                  ))}
              </div>

              {slots === null && <p className="mt-2 text-[12px] text-gray-500">Reading the diary…</p>}
              {slots !== null && slots.length === 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
                  {rescheduleAt
                    ? "There are no other times at this location in the next four weeks. Try all locations, or keep your current time."
                    : "There are no other times available in the next four weeks. Your existing appointment is unchanged."}
                </p>
              )}
              {slots !== null && slots.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {slots.slice(0, 40).map(s => {
                    // §11's example is an EARLIER alternative at another facility -- worth naming,
                    // because it is the reason to look beyond the current location at all.
                    const elsewhere = !!s.locationId && s.locationId !== b.locationId;
                    const earlier = Date.parse(s.startsAt) < Date.parse(b.scheduledAt);
                    return (
                      <button key={`${s.startsAt}-${s.locationId ?? ""}`} type="button" disabled={busy}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-100 px-3 py-2 text-left hover:bg-gray-200 disabled:opacity-50"
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
                        <span className="text-[12px] font-semibold text-gray-800">{fmt(s.startsAt)}</span>
                        <span className="flex items-center gap-1.5">
                          {earlier && elsewhere && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              Earlier
                            </span>
                          )}
                          {/* ⚠ THE LOCATION IS ON EVERY OPTION, not only the ones that differ. A label
                              that appears only sometimes is one a patient learns to stop reading. */}
                          {s.locationName && (
                            <span className={`text-[11px] ${elsewhere ? "font-semibold text-[var(--cp-primary-deep)]" : "text-gray-600"}`}>
                              {s.locationName}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
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
              {/* ⚠ §12: RESTATE WHAT IS BEING CANCELLED. "Restate date, time, practitioner and location
                  before confirmation" -- this asked a patient to confirm a destructive act against a
                  heading alone, on a page that may list more than one appointment. Somebody cancelling
                  the wrong one of two has no way back from here. */}
              <dl className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px]">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-gray-500">When</dt>
                  <dd className="font-semibold text-gray-900">{fmt(b.scheduledAt)}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-gray-500">Where</dt>
                  <dd className="font-semibold text-gray-900">{b.locationName ?? "Not recorded"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-gray-500">With</dt>
                  <dd className="font-semibold text-gray-900">{identity.displayName}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
                {/* §12's own recommended sentence. It says what cancelling DOES rather than only that it
                    is final -- somebody hesitating deserves to know the time goes back to the diary. */}
                This will release the appointment time for another patient, and cannot be undone from here.
              </p>
              <label className="mt-2 block max-w-md">
                <span className="text-[11.5px] font-semibold text-gray-700">
                  Reason (optional)
                </span>
                <textarea value={reason} rows={2} maxLength={500}
                  onChange={e => setReason(e.target.value)}
                  className={`mt-1 ${CONTROL}`} />
              </label>
              {/* ⚠ §12: THE SAFE ACTION IS THE PRIMARY ONE, AND IT COMES FIRST. Keeping the appointment
                  is what most people who reach this screen actually want; the destructive act stays
                  available, named in full, and does not wear the primary button. */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className={PRIMARY} onClick={() => setCancelling(null)}>
                  Keep appointment
                </button>
                <button type="button" disabled={busy}
                  className="text-[12.5px] font-semibold text-rose-700 underline underline-offset-2 disabled:opacity-50"
                  onClick={async () => {
                    const r = await call({ action: "cancel", token, reference: b.reference, reason });
                    if (!r) return;
                    setCancelling(null);
                    setNotice(String(r.confirmationNote ?? "This appointment has been cancelled."));
                    await loadList(token);
                  }}>
                  {busy ? "Cancelling…" : "Yes, cancel appointment"}
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
