"use client";

import Link from "next/link";
import type { PlannerRange } from "@/lib/practice/planner";
import {
  DAY_UNREADABLE_LABEL, type PlannerFilters, type PlannerPeriod,
} from "@/lib/practice/planner-constants";
import {
  APPOINTMENT_STATUS_CHIP, OUTCOME_CHIP, capacityPhrase, filterDay, hhmm, longDate, plannerHref, toneFor,
  type PlannerUrlState,
} from "./planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CP-PLAN-002 s5 -- THE AGENDA.
//
// "Find/review bookings over arbitrary periods. Chronological grouped list by date/session; optimized for
// PATIENT NAMES, TIMES, LOCATIONS AND STATUSES."
//
// So this is the one view where the patient is the unit rather than the block: every appointment is a
// row with a name, a time, a place and a state, grouped under its date and its session.
//
// ⚠ DAYS WITH NOTHING ON THEM ARE OMITTED, AND DAYS THAT COULD NOT BE READ ARE NOT. A quiet Tuesday adds
// nothing to a list somebody is scanning for a booking; a Tuesday whose read failed is a hole in the
// answer, and leaving it out would let this list imply there is nothing there.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function AgendaList({ range, period, filters, urlState }: {
  range: PlannerRange;
  period: PlannerPeriod;
  filters: PlannerFilters;
  urlState: PlannerUrlState;
}) {
  const rows = range.days.map(day => ({ day, shown: filterDay(day, filters) }))
    .filter(r => r.day.unavailable || !r.shown.empty);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 px-4 py-3">
        <h2 className="text-[15px] font-bold text-gray-900">Agenda</h2>
        <span className="text-[12px] text-gray-500">
          {longDate(period.fromDate)} to {longDate(period.toDate)} · {range.days.length} days
        </span>
        <span className="ml-auto text-[12px] text-gray-500">
          {rows.filter(r => !r.day.unavailable).length} day
          {rows.filter(r => !r.day.unavailable).length === 1 ? "" : "s"} with something on
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-gray-500">
          Nothing is on between {longDate(period.fromDate)} and {longDate(period.toDate)}. Every day in
          this period was read; none of them holds an appointment, a session or an activity that matches
          what you are showing.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(({ day, shown }) => (
            <li key={day.date} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link scroll={false}
                  href={plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null, sel: null })}
                  className="text-[14px] font-bold text-gray-900 hover:underline">
                  {day.weekdayName}, {longDate(day.date)}
                </Link>
                {day.isToday && (
                  <span className="rounded-full bg-[var(--cp-primary)]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--cp-primary-deep)]">
                    Today
                  </span>
                )}
                {day.capacity && (
                  <span className="text-[12px] text-gray-500">{capacityPhrase(day.capacity)}</span>
                )}
                {day.conflicts.length > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                    {day.conflicts.length} conflict{day.conflicts.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {day.unavailable ? (
                <p className="mt-1 text-[12px] font-semibold text-rose-700">
                  {DAY_UNREADABLE_LABEL}. Nothing is being claimed about this date.
                </p>
              ) : (
                <div className="mt-1.5 flex flex-col gap-2">
                  {/* GROUPED BY SESSION, which is what s5 asks for -- then anything outside one. */}
                  {shown.sessions.map(s => {
                    const inside = shown.appointments.filter(a => s.appointmentIds.includes(a.id));
                    return (
                      <div key={s.id} className="rounded-xl border border-gray-200">
                        <div className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 px-3 py-1.5">
                          <span className="text-[12px] font-bold tabular-nums text-gray-800">
                            {hhmm(s.startMinute)}-{hhmm(s.endMinute)}
                          </span>
                          <span className="text-[12px] text-gray-700">{s.locationName ?? "no location"}</span>
                          <span className="text-[11px] text-gray-500">{s.slotKindLabel}</span>
                          {s.capacity.blocked && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                              Blocked
                            </span>
                          )}
                          <Link scroll={false}
                            href={plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null, sel: s.id })}
                            className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                            {capacityPhrase(s.capacity)}
                          </Link>
                        </div>
                        {inside.length === 0 ? (
                          <p className="px-3 py-1.5 text-[12px] text-gray-400">
                            {s.capacity.booked === 0
                              ? "No bookings in this session."
                              : "No bookings match what you are showing."}
                          </p>
                        ) : (
                          <ul className="divide-y divide-gray-50">
                            {inside.map(a => <AppointmentRow key={a.id} a={a} past={day.isPast} />)}
                          </ul>
                        )}
                      </div>
                    );
                  })}

                  {/* Appointments that sit in no session at all -- a walk-in, or a booking made before
                      the session existed. Named rather than dropped. */}
                  {(() => {
                    const loose = shown.appointments.filter(
                      a => !shown.sessions.some(s => s.appointmentIds.includes(a.id)));
                    if (loose.length === 0) return null;
                    return (
                      <div className="rounded-xl border border-dashed border-gray-200">
                        <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                          Outside any session
                        </p>
                        <ul className="divide-y divide-gray-50">
                          {loose.map(a => <AppointmentRow key={a.id} a={a} past={day.isPast} />)}
                        </ul>
                      </div>
                    );
                  })()}

                  {shown.activities.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {shown.activities.map(a => (
                        <li key={a.id} className="flex items-baseline gap-2 text-[12px]">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneFor(a.activityType).dot}`} aria-hidden />
                          <span className="w-[92px] shrink-0 tabular-nums text-gray-500">
                            {hhmm(a.plannedStartMinute)}-{hhmm(a.plannedEndMinute)}
                          </span>
                          <span className={`min-w-0 flex-1 truncate ${a.state === "cancelled"
                            ? "text-gray-400 line-through" : "text-gray-800"}`}>
                            {a.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-gray-500">{a.label}</span>
                          <span className="shrink-0 text-[11px] text-gray-500">
                            {a.locationName ?? "no location"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {shown.hidden > 0 && (
                    <p className="text-[11px] text-gray-400">
                      {shown.hidden} more on this day are hidden by the controls above.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AppointmentRow({ a, past }: { a: PlannerRange["days"][number]["appointments"][number]; past: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5">
      <span className="w-[92px] shrink-0 text-[12px] font-semibold tabular-nums text-gray-700">
        {hhmm(a.startMinute)}-{hhmm(a.endMinute)}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${a.voided
        ? "text-gray-400 line-through" : "font-semibold text-gray-900"}`}>
        {a.patientName}
      </span>
      <span className="shrink-0 text-[11px] text-gray-500">{a.typeLabel}</span>
      <span className="shrink-0 text-[11px] text-gray-500">{a.locationName ?? "no location"}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        APPOINTMENT_STATUS_CHIP[a.status] ?? "bg-slate-100 text-slate-600"}`}>
        {a.statusLabel}
      </span>
      {/* WHAT HAPPENED, beside what was booked -- and only where the two say different things, so the
          row does not read "Confirmed - Expected" on every future booking. */}
      {past && a.outcomeLabel !== a.statusLabel && (
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          OUTCOME_CHIP[a.outcome] ?? "bg-slate-100 text-slate-600"}`}>
          {a.outcomeLabel}
        </span>
      )}
      {a.href ? (
        <Link href={a.href} className="shrink-0 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Open
        </Link>
      ) : (
        <span className="shrink-0 text-[11px] text-gray-400">booked by name only</span>
      )}
    </li>
  );
}
