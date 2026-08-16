"use client";

import Link from "next/link";
import type { PlannerActivity, PlannerDay, PlannerWeek } from "@/lib/practice/planner";
import { PLANNER_STATE_LABEL, type PlannerFilters } from "@/lib/practice/planner-constants";
import {
  hhmm, hoursMinutes, longDate, toneFor, locationTone, STATE_CHIP, filterDay, capacityPhrase, plannerHref,
  APPOINTMENT_STATUS_CHIP, OUTCOME_CHIP,
  type LocationOption, type Notice, type RunAction, type PlannerUrlState,
} from "./planner-ui";
import ActivityActions from "./ActivityActions";

// s3's CENTRE COLUMN -- the Daily Planner for whichever day the week panel has selected.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// DRAG AND DROP (s5) IS NOT BUILT, AND IS NOT HALF-BUILT EITHER.
//
// The engine behind it exists -- moveActivity() takes a date and a start minute and preserves the
// duration exactly as a drag would -- and the appointment Timeline on this same route already drags
// APPOINTMENTS. What is missing is the planner's own pointer surface: a block that follows the finger,
// snaps back when the engine refuses, and reads its position from server-supplied minutes rather than
// from the browser's clock. A dragging surface that silently leaves a block where it was dropped after
// a refusal is worse than none, because the practitioner walks away believing the day moved.
//
// So every s5 action is here as an EXPLICIT CONTROL instead, which is one or two interactions (s10) and
// tells the truth about what happened either way.
//
// THE DAY IS A FLOW, NOT AN ABSOLUTE-POSITIONED RAIL. Blocks are drawn in clock order with the unspoken
// -for time between them named. Absolute positioning would stack two overlapping blocks on top of one
// another -- and an overlap is exactly the thing the practitioner most needs to SEE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function DayPlanner({
  day, week, canManage, locations, busy, notice, run, onAdd, filters, urlState, selectedSessionId,
}: {
  day: PlannerDay;
  week: PlannerWeek;
  canManage: boolean;
  locations: LocationOption[];
  busy: string | null;
  notice: Notice;
  run: RunAction;
  onAdd: () => void;
  filters: PlannerFilters;
  urlState: PlannerUrlState;
  selectedSessionId: string | null;
}) {
  const shown = filterDay(day, filters);
  const ordered = [...shown.activities].sort((a, b) =>
    a.plannedStartMinute - b.plannedStartMinute || a.plannedEndMinute - b.plannedEndMinute);
  const conflicted = new Set(day.conflicts.flatMap(c => c.activityIds));
  const w = day.workload;
  const loose = shown.appointments.filter(
    a => !shown.sessions.some(s => s.appointmentIds.includes(a.id)));

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3">
        <h2 className="text-[16px] font-bold text-gray-900">
          {day.weekdayName}, {longDate(day.date)}
        </h2>
        <span className="text-[12px] text-gray-500">
          {day.locations.length > 0
            ? day.locations.map(l => l.name).join(" → ")
            : "no location on this day"}
        </span>
        {/* The timezone is on the navigator's chip once for the whole screen -- CPR-PLAN-002 s3 asks
            for it in the shell and NOT repeated in every card. */}
        {w && w.firstStartMinute !== null && w.lastEndMinute !== null && (
          <span className="ml-auto text-[12px] font-semibold text-gray-600 tabular-nums">
            {hhmm(w.firstStartMinute)} - {hhmm(w.lastEndMinute)}
          </span>
        )}
      </div>

      {day.unavailable ? (
        <p className="px-4 py-6 text-[13px] font-semibold text-rose-700">
          This day could not be read, so nothing is shown for it. That is not the same as an empty day.
          {week.detail ? ` The database said: ${week.detail}` : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-4">
          {/* s6 THE TEMPLATE BESIDE THE REALITY. Read-only here on purpose: changing the regular week is
              editSession() in Practice Setup, and a planner that rewrote it from one afternoon would
              change every future Tuesday silently. */}
          {day.templateSessions.length > 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Your regular {day.weekdayName}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {day.templateSessions.map(t => (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                    <span className="tabular-nums text-gray-700">{hhmm(t.startsMinute)} - {hhmm(t.endsMinute)}</span>
                    <span className="text-gray-600">{t.locationName ?? "no location"}</span>
                    <span className="text-gray-400">{t.slotKind}</span>
                    {t.coveredByPlan
                      ? <span className="text-[11px] font-semibold text-emerald-700">covered by today&apos;s plan</span>
                      : <span className="text-[11px] font-semibold text-amber-700">not on today&apos;s plan</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-gray-400">
                Changing this week does not change your template. The regular week is edited in Practice Setup.
              </p>
            </div>
          )}

          {/* ── CP-PLAN-002 s5's DAY: "Chronological sessions, appointments, free/blocked periods,
              location, status and quick actions." The sessions and the patients booked into them, from
              the SAME payload the month grid counts and the agenda lists. ──────────────────────── */}
          {shown.sessions.length > 0 && (
            <div className="flex flex-col gap-2">
              {shown.sessions.map(s => {
                const inside = shown.appointments.filter(a => s.appointmentIds.includes(a.id));
                // Per-clinic tint on the HEADER BAND only (the owner, 2026-08-12, carried over from
                // the month view) -- the booking list below stays on white for readability, and a
                // blocked session stays grey whatever its place. The practitioner's chosen colour
                // wins over the hash.
                const tone = locationTone(s.locationId, s.locationId ? week.locationColors[s.locationId] : null);
                return (
                  <section key={s.id}
                    className={`overflow-hidden rounded-xl border ${selectedSessionId === s.id
                      ? "border-[var(--cp-primary-border)] ring-1 ring-[var(--cp-primary)]/20"
                      : "border-gray-200"} ${s.capacity.blocked ? "bg-gray-50" : "bg-white"}`}>
                    <div className={`flex flex-wrap items-baseline gap-2 border-b border-gray-100 px-3 py-2 ${s.capacity.blocked ? "" : tone.band}`}>
                      <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${s.capacity.blocked ? "bg-gray-300" : tone.dot}`} />
                      <span className={`text-[13px] font-bold tabular-nums ${s.capacity.blocked ? "text-gray-800" : tone.time}`}>
                        {hhmm(s.startMinute)} - {hhmm(s.endMinute)}
                      </span>
                      <span className={`text-[13px] ${s.capacity.blocked ? "text-gray-700" : tone.place}`}>{s.locationName ?? "no location"}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {s.slotKindLabel}
                      </span>
                      {s.source === "program" && (
                        // ⚠ A PROGRAM SESSION IS NOT BOOKABLE TIME. It is the regular week saying a clinic
                        // runs; until times are generated there is nothing for anybody to take.
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                          No times generated
                        </span>
                      )}
                      {s.capacity.blocked && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-700">
                          Blocked
                        </span>
                      )}
                      <Link scroll={false}
                        href={plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null, sel: s.id })}
                        className="ml-auto text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        {capacityPhrase(s.capacity)}
                      </Link>
                    </div>
                    {inside.length === 0 ? (
                      <p className="px-3 py-1.5 text-[12px] text-gray-400">
                        {s.capacity.booked === 0
                          ? "No bookings in this session."
                          : "No bookings in this session match what you are showing."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-gray-50">
                        {inside.map(a => (
                          <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-1.5">
                            <span className={`w-[46px] shrink-0 text-[12px] tabular-nums ${a.voided
                              ? "text-gray-400 line-through" : "text-gray-600"}`}>
                              {hhmm(a.startMinute)}
                            </span>
                            {a.href ? (
                              <Link href={a.href} className={`min-w-0 flex-1 truncate text-[13px] hover:underline ${a.voided
                                ? "text-gray-400 line-through" : "font-semibold text-gray-900"}`}>
                                {a.patientName}
                              </Link>
                            ) : (
                              <span className={`min-w-0 flex-1 truncate text-[13px] ${a.voided
                                ? "text-gray-400 line-through" : "font-semibold text-gray-900"}`}>
                                {a.patientName}
                              </span>
                            )}
                            <span className="shrink-0 text-[11px] text-gray-500">{a.typeLabel}</span>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              APPOINTMENT_STATUS_CHIP[a.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {a.statusLabel}
                            </span>
                            {/* WHAT HAPPENED, on a day that has been. Only where it says something the
                                status does not, so a future row is not labelled twice. */}
                            {(day.isPast || day.isToday) && a.outcomeLabel !== a.statusLabel && (
                              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                                OUTCOME_CHIP[a.outcome] ?? "bg-slate-100 text-slate-600"}`}>
                                {a.outcomeLabel}
                              </span>
                            )}
                            {a.arrivedMinute !== null && (
                              <span className="shrink-0 text-[10px] text-gray-500">
                                arrived {hhmm(a.arrivedMinute)}
                              </span>
                            )}
                            {a.encounterHref && (
                              <Link href={a.encounterHref}
                                className="shrink-0 text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                                consultation
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {loose.length > 0 && (
            <section className="rounded-xl border border-dashed border-gray-200">
              <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Booked outside any session
              </p>
              <ul className="divide-y divide-gray-50">
                {loose.map(a => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-[12px]">
                    <span className="w-[46px] shrink-0 tabular-nums text-gray-600">{hhmm(a.startMinute)}</span>
                    <span className={`min-w-0 flex-1 truncate ${a.voided
                      ? "text-gray-400 line-through" : "font-semibold text-gray-900"}`}>
                      {a.patientName}
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-500">{a.typeLabel}</span>
                    <span className="shrink-0 text-[11px] text-gray-500">{a.statusLabel}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {ordered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">
              {shown.hidden > 0
                ? `Nothing here matches what you are showing -- ${shown.hidden} hidden by the filters.`
                : day.dayOff
                  ? "No program and nothing planned on this date."
                  /* Walkthrough 2026-08-17 #11: "Nothing is planned" under a four-patient clinic is a
                     true sentence about ACTIVITIES that reads as a lie about the DAY. When the book
                     holds bookings, the empty state says which register is empty and which is not. */
                  : shown.appointments.length > 0
                    ? `No activity is planned for this day -- the ${shown.appointments.length === 1
                      ? "booking above runs" : `${shown.appointments.length} bookings above run`} from the
                      appointment book either way. Add the clinic as an activity to run it as a session
                      with the cockpit.`
                    : "Nothing is planned for this day."}
            </p>
          ) : (
            ordered.map((a, i) => {
              const prev = ordered.slice(0, i).filter(p => p.state !== "cancelled").at(-1);
              const gap = prev && a.state !== "cancelled" ? a.plannedStartMinute - prev.plannedEndMinute : null;
              return (
                <div key={a.id} className="flex flex-col gap-2">
                  {gap !== null && gap > 0 && (
                    <p className="pl-16 text-[11px] text-gray-400">{hoursMinutes(gap)} unspoken for</p>
                  )}
                  <ActivityBlock
                    activity={a} conflicted={conflicted.has(a.id)} canManage={canManage}
                    locations={locations} week={week} busy={busy} notice={notice} run={run}
                  />
                </div>
              );
            })
          )}

          {canManage && (
            <button type="button" onClick={onAdd}
              className="mt-1 rounded-xl border border-dashed border-gray-300 px-3 py-3 text-[13px] font-semibold text-gray-600 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]">
              + Add Activity
            </button>
          )}

          <p className="text-[11px] text-gray-400">
            Blocks are moved with the Move control. Dragging a block to a new time is not built on this
            screen yet.
          </p>
        </div>
      )}
    </section>
  );
}

function ActivityBlock({ activity: a, conflicted, canManage, locations, week, busy, notice, run }: {
  activity: PlannerActivity; conflicted: boolean; canManage: boolean;
  locations: LocationOption[]; week: PlannerWeek;
  busy: string | null; notice: Notice; run: RunAction;
}) {
  const tone = toneFor(a.activityType);
  const cancelled = a.state === "cancelled";

  // CPR-PLAN-002 s5.2: the CURRENT activity outranks historical ones. Read off the recorded state --
  // started and not ended -- never off the browser's clock, which the server render does not share.
  // A finished block steps back to grey; a running one carries the ring.
  const stateEmphasis = a.state === "running"
    ? `border-emerald-300 ring-1 ring-emerald-200 ${tone.soft}`
    : a.state === "done" ? "border-gray-200 bg-gray-50/70" : `border-gray-200 ${tone.soft}`;

  return (
    <article className={`flex gap-3 rounded-xl border px-3 py-2.5 ${conflicted
      ? "border-rose-300 bg-rose-50/40"
      : cancelled ? "border-gray-200 bg-gray-50" : stateEmphasis}`}>
      <div className="w-12 shrink-0 pt-0.5 text-right">
        <p className={`text-[12px] font-bold tabular-nums ${cancelled ? "text-gray-400 line-through" : "text-gray-800"}`}>
          {hhmm(a.plannedStartMinute)}
        </p>
        <p className="text-[11px] tabular-nums text-gray-400">{hhmm(a.plannedEndMinute)}</p>
      </div>
      <span className={`w-1 shrink-0 rounded-full ${cancelled ? "bg-gray-300" : tone.bar}`} aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-[14px] font-bold ${cancelled ? "text-gray-400 line-through" : "text-gray-900"}`}>
            {a.title}
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.chip}`}>
            {a.label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_CHIP[a.state] ?? STATE_CHIP.planned}`}>
            {PLANNER_STATE_LABEL[a.state] ?? a.state}
          </span>
          {conflicted && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
              In conflict
            </span>
          )}
          <span className="ml-auto text-[11px] text-gray-500 tabular-nums">{hoursMinutes(a.plannedMinutes)}</span>
        </div>

        <p className="mt-0.5 text-[12px] text-gray-600">
          {a.locationName ?? "No location"}
          {a.facilityName ? ` · ${a.facilityName}` : ""}
          {a.room ? ` · ${a.room}` : ""}
        </p>

        {a.notes && <p className="mt-1 text-[12px] text-gray-600">{a.notes}</p>}

        {cancelled && (
          <p className="mt-1 text-[12px] font-semibold text-rose-700">
            Cancelled{a.cancelledAt ? ` on ${a.cancelledAt.slice(0, 10)}` : ""}
            {a.cancellationReason ? `: ${a.cancellationReason}` : ". No reason was given."}
          </p>
        )}

        {/* Lineage, because a copy and a split are things the practitioner did and may want to trace. */}
        {(a.duplicatedFromId || a.splitFromId) && (
          <p className="mt-1 text-[11px] text-gray-400">
            {a.duplicatedFromId ? "Copied from another block. " : ""}
            {a.splitFromId ? "The second half of a split block." : ""}
          </p>
        )}

        {canManage && (
          <ActivityActions
            activity={a} locations={locations} week={week}
            busy={busy === a.id} notice={notice?.subject === a.id ? notice : null} run={run}
          />
        )}
      </div>
    </article>
  );
}
