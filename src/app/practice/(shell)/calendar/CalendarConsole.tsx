"use client";

import { useState } from "react";
import Link from "next/link";

// The diary console (CPR-V2-003 V3), Day mode only since CPR-PLN-002: the day's schedule, availability
// blocks and the booking form -- book, walk-in, check in, cancel, no-show, complete. Every action calls
// the engine through the API and re-fetches the day, so what renders is always what the database holds;
// nothing is optimistically invented client-side on a clinical diary.
//
// ⚠ TWO THINGS THIS CONSOLE POINTS AT AND NO LONGER DOES (CPR-PLN-002 s8):
//   the live queue        Current Session's, since HFE-001 s7.2. The Waiting card below is a count that
//                         routes there, never a second queue console.
//   starting a consult    Current Session's too. This console used to create encounters from an arrived
//                         booking; start, pause and finish are Current Session's verbs, so an arrived
//                         patient's row now points there instead. Check-in stays HERE, because marking
//                         an arrival is appointment-book work; what happens to the arrived patient is not.
//
// ⚠ AND ONE CONTROL IT NO LONGER DUPLICATES: its own date strip. The planner's navigator above this
// console owns "which day am I looking at" (CPR-PLN-002 s5.1), and a second date strip here pointed at
// URLs that dropped the view -- two date controls on one screen is two ideas of the day being edited.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Day = { appointments: any[]; queue: any[]; blocks: any[] };

const TYPES = [
  ["new_consultation", "New consultation"],
  ["scheduled_followup", "Scheduled follow-up"],
  ["walk_in", "Walk-in"],
  ["emergency", "Emergency"],
  ["hospital_consultation", "Hospital consultation"],
  ["teleconsultation", "Teleconsultation"],
  ["home_visit", "Home / community visit"],
] as const;

const STATUS_TONE: Record<string, string> = {
  REQUESTED: "bg-gray-100 text-gray-600",
  CONFIRMED: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]",
  ARRIVED: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  COMPLETED: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  CANCELLED: "bg-gray-100 text-gray-400",
  NO_SHOW: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
};

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function CalendarConsole({ date, timezone, canManage, initial, locations = [] }: {
  date: string;
  /** The practice's own timezone -- every time on this console renders in it, never in UTC slices. */
  timezone: string;
  canManage: boolean; initial: Day;
  /** Where this practice works. Empty when none has been set up, and the picker then hides itself. */
  locations?: { id: string; name: string; type: string; facility: { name: string } | null }[];
}) {
  const [day, setDay] = useState<Day>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState({ patientName: "", patientPhone: "", appointmentType: "new_consultation", time: "09:00", durationMinutes: "20", reason: "", locationId: "" });

  async function refresh() {
    const r = await fetch(`/api/v1/practice/appointments?date=${date}`);
    if (r.ok) { const d = await r.json(); setDay({ appointments: d.appointments, queue: d.queue, blocks: d.blocks }); }
  }

  async function act(fn: () => Promise<Response>, okText: string) {
    setBusy(true); setNotice(null);
    const res = await fn();
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setNotice({ kind: "err", text: e?.error?.message ?? e?.error ?? "That did not work." });
    } else {
      setNotice({ kind: "ok", text: okText });
      await refresh();
    }
    setBusy(false);
  }

  // ⚠ A SCHEDULED BOOKING SENDS WALL-CLOCK date+time; the server composes the instant in the practice
  // timezone. This used to send `${date}T${form.time}:00.000Z` -- declaring the practice's 09:00 to be
  // 09:00 UTC, three hours wrong in Kampala. A walk-in still sends a real instant: it is happening NOW.
  const book = (walkIn: boolean) => act(() => fetch("/api/v1/practice/appointments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: form.patientName, patientPhone: form.patientPhone || undefined,
      appointmentType: walkIn ? "walk_in" : form.appointmentType,
      ...(walkIn ? { scheduledAt: new Date().toISOString() } : { date, time: form.time }),
      durationMinutes: Number(form.durationMinutes) || 20,
      reason: form.reason || undefined,
      locationId: form.locationId || undefined,
    }),
  }), walkIn ? "Walk-in registered." : "Appointment booked.");

  const transition = (id: string, action: string, label: string) =>
    act(() => fetch(`/api/v1/practice/appointments/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    }), label);

  // The queueMove handler left with the queue card (HFE-001 s7.2), and startEncounter left with
  // CPR-PLN-002 s8: queue transitions AND starting a consultation are Current Session's verbs now.
  // What remains here is the appointment lifecycle -- which is the book's.

  // ⚠ IN THE PRACTICE TIMEZONE, not a UTC slice. The old `.toISOString().slice(11, 16)` rendered a
  // correctly-stored Kampala 09:30 as 06:30 on this one console while every other screen said 09:30.
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });

  return (
    <div className="max-w-6xl">
      {/* The label used to say UTC while fmt() rendered practice time -- a lie in small print. The
          date strip that sat beside it is gone: the planner's navigator owns the day. */}
      <p className="text-[13px] text-gray-500">{date} &middot; times in the practice&apos;s timezone</p>

      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-4 grid lg:grid-cols-3 gap-4">
        {/* Today's schedule */}
        <section className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Today&apos;s schedule</h2>
          {day.appointments.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No appointments on this day.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {day.appointments.map(a => (
                <li key={a.id} className="rounded-lg border border-gray-100 px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-gray-500">{fmt(a.scheduled_at)}</span>
                    <span className="text-[13px] font-semibold text-gray-900">{a.patient_name}</span>
                    <span className="text-[11px] text-gray-400">{a.appointment_type.replace(/_/g, " ")} · {a.duration_minutes}m</span>
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status}</span>
                  </div>
                  {a.status === "ARRIVED" && (
                    <div className="mt-1.5">
                      {a.patient_id ? (
                        // ⚠ A POINTER, NOT A CONSOLE (CPR-PLN-002 s8). This patient is checked in and
                        // queued; starting, pausing and finishing the consultation is Current Session's
                        // work, and there is exactly one place that does it.
                        <Link href="/practice/today"
                          className="rounded border border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 px-2.5 py-1 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/10">
                          Start the consultation in Current Session &rarr;
                        </Link>
                      ) : (
                        <p className="text-[10px] text-gray-400">
                          Diary entry only — register this person in Patients to open a clinical record.
                        </p>
                      )}
                    </div>
                  )}
                  {canManage && (
                    <div className="mt-1.5 flex gap-1.5 flex-wrap">
                      {a.status === "REQUESTED" && <button disabled={busy} onClick={() => transition(a.id, "confirm", "Confirmed.")} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">Confirm</button>}
                      {a.status === "CONFIRMED" && <button disabled={busy} onClick={() => transition(a.id, "arrive", "Checked in and queued.")} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">Check in</button>}
                      {a.status === "CONFIRMED" && <button disabled={busy} onClick={() => transition(a.id, "no_show", "Marked as no-show.")} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">No-show</button>}
                      {a.status === "ARRIVED" && <button disabled={busy} onClick={() => transition(a.id, "complete", "Completed.")} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">Complete</button>}
                      {["REQUESTED", "CONFIRMED", "ARRIVED"].includes(a.status) && <button disabled={busy} onClick={() => transition(a.id, "cancel", "Cancelled.")} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)]">Cancel</button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {day.blocks.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Availability</p>
              <ul className="mt-1 flex flex-col gap-1">
                {day.blocks.map(b => (
                  <li key={b.id} className="text-[12px] text-gray-500">
                    <span className="font-mono">{fmt(b.starts_at)}–{fmt(b.ends_at)}</span> · {b.status}{b.note ? ` · ${b.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {/* CPR-HFE-001 v1.1 s7.2: THE LIVE QUEUE LEFT THE PLANNER. Once a patient has arrived and is
              waiting, that state is managed in Current Session -- the planner keeps a COUNT that
              routes there (s10: pointer, never a duplicate console). Check-in stays above, because
              marking an arrival is appointment-book work; what happens to the arrived patient is not. */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Waiting</h2>
            <Link href="/practice/today"
              className="mt-2 flex items-baseline gap-2 rounded-lg border border-gray-100 px-3 py-2 text-[12px] hover:bg-gray-50">
              <span className="text-gray-800">
                {day.queue.length === 0 ? "Nobody is waiting" : `${day.queue.length} waiting`}
              </span>
              <span className="ml-auto font-semibold text-[var(--cp-primary-deep)]">Manage in Current Session &rarr;</span>
            </Link>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
              The planner plans. Starting, pausing and finishing consultations for people who have
              arrived happens in Current Session, so there is exactly one place a live queue is run.
            </p>
          </section>

          {/* Book / walk-in (quick actions) */}
          {canManage && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-[13px] font-bold text-gray-900">Book</h2>
              <form className="mt-2 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); book(false); }}>
                <input required placeholder="Patient name" value={form.patientName} onChange={e => setForm(p => ({ ...p, patientName: e.target.value }))} className={input} />
                <input placeholder="Phone (optional)" value={form.patientPhone} onChange={e => setForm(p => ({ ...p, patientPhone: e.target.value }))} className={input} />
                <div className="grid grid-cols-2 gap-2">
                  {/* 24-hour text input, not type="time" -- the native picker renders 12-hour on many
                      machines and the owner asked for the 24-hour clock. */}
                  <input required value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                    pattern="^([01]?\d|2[0-3]):[0-5]\d$" placeholder="09:00" inputMode="numeric"
                    title="24-hour clock, HH:MM — for example 09:00 or 14:30" className={input} />
                  <input type="number" min={5} max={480} value={form.durationMinutes} onChange={e => setForm(p => ({ ...p, durationMinutes: e.target.value }))} className={input} title="Duration in minutes" />
                </div>
                <select value={form.appointmentType} onChange={e => setForm(p => ({ ...p, appointmentType: e.target.value }))} className={input}>
                  {TYPES.filter(([k]) => k !== "walk_in").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>

                {/* WHERE. A practitioner who works at two hospitals has to say which one, and the engine
                    refuses a booking that leaves no time to get between them. Hidden entirely when the
                    practice has one place, because then the question does not arise. */}
                {locations.length > 1 && (
                  <select value={form.locationId} onChange={e => setForm(p => ({ ...p, locationId: e.target.value }))}
                    className={input} title="Where this appointment happens">
                    <option value="">Where — not specified</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name}{l.type === "hospital" && !l.facility ? " (no facility linked)" : ""}
                      </option>
                    ))}
                  </select>
                )}

                <input placeholder="Reason (optional)" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} className={input} />
                <div className="flex gap-2">
                  <button type="submit" disabled={busy || !form.patientName.trim()}
                    className="flex-1 rounded-lg bg-[var(--cp-primary)] py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                    Book appointment
                  </button>
                  <button type="button" disabled={busy || !form.patientName.trim()} onClick={() => book(true)}
                    className="flex-1 rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    Register walk-in now
                  </button>
                </div>
              </form>
              <p className="mt-2 text-[10px] text-gray-400">
                A booking made here carries a name only. To open a clinical record for someone, register
                them in Patients and book from their record — or search for them there and start the
                encounter directly.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
