"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

// CPR-SET-002 v4 — the writes: sessions, exceptions, clinics and booking rules.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE MESSAGE THIS COMPONENT MUST GET RIGHT IS THE ONE AFTER REMOVING A SESSION.
//
// Removing a Tuesday clears its future slots -- except the ones somebody is booked into, which survive
// by design. If the screen says only "session removed", a practitioner reasonably concludes the Tuesday
// is clear and stops expecting those patients. So the result reports BOTH numbers, and the kept ones
// are the sentence that leads.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = [
  [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"],
  [5, "Friday"], [6, "Saturday"], [7, "Sunday"],
] as const;

const SLOT_KINDS = [
  ["clinic", "Clinic"], ["telemedicine", "Telemedicine"], ["emergency_reserve", "Emergency reserve"],
  ["admin", "Admin"], ["blocked", "Blocked"],
] as const;

const EXCEPTION_KINDS = [
  ["leave", "Leave or holiday", "takes the day"],
  ["closure", "Temporary closure", "takes the day"],
  ["extra_session", "One-off session", "adds time"],
  ["extended_hours", "Extended hours", "adds time"],
] as const;

const APPOINTMENT_TYPES = [
  ["new_consultation", "New patient"], ["scheduled_followup", "Follow-up"],
  ["walk_in", "Walk-in"], ["emergency", "Emergency"],
  ["hospital_consultation", "Hospital consult"], ["teleconsultation", "Telemedicine"],
  ["home_visit", "Home visit"],
] as const;

const input = "rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export default function AvailabilityConsole({ locations, clinics, rules, inert, today, canSetRules }: {
  locations: any[]; clinics: any[]; rules: any[]; inert: any[]; today: string; canSetRules: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [session, setSession] = useState({
    weekday: "2", from: "09:00", to: "13:00",
    locationId: locations[0]?.id ?? "", clinicId: "", slotKind: "clinic",
  });
  const [exception, setException] = useState({
    kind: "leave", fromDate: today, toDate: today, from: "09:00", to: "13:00",
    locationId: "", reason: "",
  });
  const [clinic, setClinic] = useState({ locationId: locations[0]?.id ?? "", name: "" });
  const [rule, setRule] = useState({
    locationId: "", appointmentType: "",
    leadTimeMinutes: "0", bookingHorizonDays: "", walkInDailyLimit: "",
    cancellationNoticeMinutes: "0", emergencyReserveMinutes: "0",
  });

  async function send(payload: Record<string, unknown>, describe: (d: any) => string) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/availability-config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      return;
    }
    setNotice({ kind: "ok", text: describe(data) });
    router.refresh();
  }

  const generationLine = (g: any) =>
    !g ? "" : ` ${g.slotsCreated} slot${g.slotsCreated === 1 ? "" : "s"} generated.`;

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
          ? "bg-emerald-50 text-emerald-900"
          : "bg-rose-50 text-rose-900"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Add to the regular week ─────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-[12px] text-violet-700">＋</span>
            <h2 className="text-[13px] font-bold text-gray-900">Add a session to the regular week</h2>
          </div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
            e.preventDefault();
            send({
              action: "add_session", weekday: Number(session.weekday),
              startsMinute: toMinutes(session.from), endsMinute: toMinutes(session.to),
              locationId: session.locationId || null, clinicId: session.clinicId || null,
              slotKind: session.slotKind,
            }, d => `Session added.${generationLine(d.generation)}`);
          }}>
            <select value={session.weekday} onChange={e => setSession(s => ({ ...s, weekday: e.target.value }))}
              className={`${input} w-32`} aria-label="Day of the week">
              {WEEKDAYS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
            </select>
            <input type="time" value={session.from} onChange={e => setSession(s => ({ ...s, from: e.target.value }))}
              className={`${input} w-28`} aria-label="Session start" required />
            <input type="time" value={session.to} onChange={e => setSession(s => ({ ...s, to: e.target.value }))}
              className={`${input} w-28`} aria-label="Session end" required />
            <select value={session.locationId} onChange={e => setSession(s => ({ ...s, locationId: e.target.value, clinicId: "" }))}
              className={`${input} min-w-[140px] flex-1`} aria-label="Location">
              <option value="">Anywhere</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {clinics.filter(c => c.location_id === session.locationId).length > 0 && (
              <select value={session.clinicId} onChange={e => setSession(s => ({ ...s, clinicId: e.target.value }))}
                className={`${input} w-40`} aria-label="Clinic">
                <option value="">No clinic</option>
                {clinics.filter(c => c.location_id === session.locationId)
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={session.slotKind} onChange={e => setSession(s => ({ ...s, slotKind: e.target.value }))}
              className={`${input} w-40`} aria-label="Kind of session">
              {SLOT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              Add
            </button>
          </form>
          <p className="mt-2 text-[10px] text-gray-400">
            Adding a session regenerates the next 90 days straight away, so the calendar is right before
            this message disappears.
          </p>
        </section>

        {/* ── Dates that differ ───────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100 text-[12px] text-amber-700">⚑</span>
            <h2 className="text-[13px] font-bold text-gray-900">Record a date that differs</h2>
          </div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
            e.preventDefault();
            const adds = exception.kind === "extra_session" || exception.kind === "extended_hours";
            send({
              action: "add_exception", kind: exception.kind,
              fromDate: exception.fromDate, toDate: exception.toDate,
              locationId: exception.locationId || null,
              startsMinute: adds ? toMinutes(exception.from) : null,
              endsMinute: adds ? toMinutes(exception.to) : null,
              reason: exception.reason || undefined,
            }, d => `Recorded.${generationLine(d.generation)}`);
          }}>
            <select value={exception.kind} onChange={e => setException(s => ({ ...s, kind: e.target.value }))}
              className={`${input} w-44`} aria-label="Kind">
              {EXCEPTION_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input type="date" value={exception.fromDate} onChange={e => setException(s => ({ ...s, fromDate: e.target.value, toDate: s.toDate < e.target.value ? e.target.value : s.toDate }))}
              className={`${input} w-40`} aria-label="From date" required />
            <input type="date" value={exception.toDate} min={exception.fromDate}
              onChange={e => setException(s => ({ ...s, toDate: e.target.value }))}
              className={`${input} w-40`} aria-label="To date" required />
            {/* ADDING TIME REQUIRES SAYING WHEN; REMOVING IT DOES NOT. The fields appear only for the
                two kinds that add, because leave takes the day. */}
            {(exception.kind === "extra_session" || exception.kind === "extended_hours") && (
              <>
                <input type="time" value={exception.from} onChange={e => setException(s => ({ ...s, from: e.target.value }))}
                  className={`${input} w-28`} aria-label="Start" required />
                <input type="time" value={exception.to} onChange={e => setException(s => ({ ...s, to: e.target.value }))}
                  className={`${input} w-28`} aria-label="End" required />
              </>
            )}
            <select value={exception.locationId} onChange={e => setException(s => ({ ...s, locationId: e.target.value }))}
              className={`${input} min-w-[130px] flex-1`} aria-label="Location">
              <option value="">Everywhere</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input placeholder="Reason (optional)" value={exception.reason}
              onChange={e => setException(s => ({ ...s, reason: e.target.value }))}
              className={`${input} min-w-[130px] flex-1`} />
            <button type="submit" disabled={busy}
              className="rounded-lg bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              Record
            </button>
          </form>
          <p className="mt-2 text-[10px] text-gray-400">
            Leave and closures take the whole day. A one-off session or extended hours adds time, so they
            need a start and an end.
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── Clinics ─────────────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cp-primary)]/12 text-[12px] text-[var(--cp-primary-deep)]">◎</span>
            <h2 className="text-[13px] font-bold text-gray-900">Add a clinic</h2>
          </div>
          <form className="flex flex-col gap-2" onSubmit={e => {
            e.preventDefault();
            send({ action: "add_clinic", locationId: clinic.locationId, name: clinic.name },
              () => `${clinic.name} added.`);
          }}>
            <select value={clinic.locationId} onChange={e => setClinic(c => ({ ...c, locationId: e.target.value }))}
              className={input} aria-label="Location" required>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input placeholder="e.g. Neurology Clinic" value={clinic.name}
              onChange={e => setClinic(c => ({ ...c, name: e.target.value }))} className={input} required />
            <button type="submit" disabled={busy || !clinic.name.trim() || !clinic.locationId}
              className="rounded-lg border border-gray-200 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Add clinic
            </button>
          </form>
          <p className="mt-2 text-[10px] text-gray-400">
            A clinic is a named service inside a location, not a second location — so no travel time is
            expected between two clinics in one hospital.
          </p>
        </section>

        {/* ── Booking rules ───────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-100 text-[12px] text-rose-700">⚌</span>
            <h2 className="text-[13px] font-bold text-gray-900">Booking rules</h2>
            <span className="text-[11px] text-gray-500">{rules.length} set</span>
          </div>

          {rules.length > 0 && (
            <ul className="mb-3 space-y-1">
              {rules.map((r: any) => (
                <li key={r.id} className="rounded-lg bg-[var(--cp-canvas)] px-2.5 py-1.5 text-[11px]">
                  <span className="font-semibold text-gray-800">
                    {r.location_id ? locations.find(l => l.id === r.location_id)?.name ?? "a location" : "Practice-wide"}
                    {r.appointment_type ? ` · ${String(r.appointment_type).replace(/_/g, " ")}` : ""}
                  </span>
                  <span className="ml-1.5 text-gray-600">
                    {r.lead_time_minutes > 0 ? `${r.lead_time_minutes} min notice` : "no notice needed"}
                    {r.booking_horizon_days ? ` · ${r.booking_horizon_days} days ahead` : ""}
                    {r.walk_in_daily_limit != null ? ` · ${r.walk_in_daily_limit} walk-ins a day` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canSetRules ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
              e.preventDefault();
              send({
                action: "set_booking_rule",
                locationId: rule.locationId || null, appointmentType: rule.appointmentType || null,
                leadTimeMinutes: Number(rule.leadTimeMinutes) || 0,
                bookingHorizonDays: rule.bookingHorizonDays,
                walkInDailyLimit: rule.walkInDailyLimit,
                cancellationNoticeMinutes: Number(rule.cancellationNoticeMinutes) || 0,
                emergencyReserveMinutes: Number(rule.emergencyReserveMinutes) || 0,
              }, () => "Rule saved. Bookings are checked against it from now on.");
            }}>
              <select value={rule.locationId} onChange={e => setRule(r => ({ ...r, locationId: e.target.value }))}
                className={`${input} w-40`} aria-label="Applies to location">
                <option value="">Whole practice</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select value={rule.appointmentType} onChange={e => setRule(r => ({ ...r, appointmentType: e.target.value }))}
                className={`${input} w-40`} aria-label="Applies to type">
                <option value="">All types</option>
                {APPOINTMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label className="flex flex-col text-[10px] text-gray-500">
                Notice (min)
                <input type="number" min={0} value={rule.leadTimeMinutes}
                  onChange={e => setRule(r => ({ ...r, leadTimeMinutes: e.target.value }))} className={`${input} w-24`} />
              </label>
              <label className="flex flex-col text-[10px] text-gray-500">
                Days ahead
                <input type="number" min={1} placeholder="no limit" value={rule.bookingHorizonDays}
                  onChange={e => setRule(r => ({ ...r, bookingHorizonDays: e.target.value }))} className={`${input} w-24`} />
              </label>
              <label className="flex flex-col text-[10px] text-gray-500">
                Walk-ins/day
                <input type="number" min={0} placeholder="no limit" value={rule.walkInDailyLimit}
                  onChange={e => setRule(r => ({ ...r, walkInDailyLimit: e.target.value }))} className={`${input} w-24`} />
              </label>
              <button type="submit" disabled={busy}
                className="rounded-lg bg-rose-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                Save rule
              </button>
            </form>
          ) : (
            <p className="text-[12px] text-gray-400">You do not have permission to change booking rules.</p>
          )}

          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            Notice and days-ahead are enforced: a booking that breaks either is refused, and the refusal
            names this rule. Walk-ins ignore notice — they arrive without any — but not the daily limit.
            Blank means no limit; zero walk-ins a day means none.
          </p>

          {/* CPR-360's rule for a column nothing reads: LISTED, not offered as a switch. */}
          {inert.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              {inert.map((i: any) => (
                <p key={i.field} className="text-[10px] leading-relaxed text-gray-500">
                  <span className="font-semibold">Not offered here:</span> {i.label}. {i.reason}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
