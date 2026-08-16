"use client";

import Link from "next/link";
import type { PlannerDay, PlannerSession } from "@/lib/practice/planner";
import {
  CAPACITY_BASIS_LABEL, CAPACITY_BASIS_NOTE, CONFLICT_LABEL, DAY_OFF_LABEL,
} from "@/lib/practice/planner-constants";
import {
  APPOINTMENT_STATUS_CHIP, OUTCOME_CHIP, hhmm, hoursMinutes, longDate, plannerHref,
  type PlannerUrlState,
} from "./planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CP-PLAN-002 s7 -- THE DAY/SESSION CONTEXT, which CPR-PLN-002 s5.3 now mounts INSIDE the Day
// Inspector's Overview tab rather than as a card of its own.
//
// "When a day/session is selected, show a contextual panel RATHER THAN FORCING NAVIGATION AWAY", with a
// day/session header, a capacity summary, a compact time-ordered patient list, quick actions and a
// conflict state. The outer chrome belongs to DayInspector; this component renders content only, so the
// inspector stays ONE bounded panel and not a stack of nested cards.
//
// ⚠ THE CAPACITY FIGURES ARE THE PRACTITIONER'S OWN DIARY AND THE PANEL SAYS SO. CAPACITY_BASIS_NOTE is
// rendered under them every time, for the same reason TRAVEL_BASIS_NOTE is rendered under the travel
// figure: a practitioner who believes "4 free" is what a patient would be offered will promise a slot
// that their own notice period refuses. The booking rules belong to the booking engine and are not
// applied here.
//
// ⚠ AND `available === null` IS PRINTED AS WORDS, NEVER AS NOUGHT. A session nobody has generated times
// for has no free count; nought would read as a full clinic.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function ContextPanel({ day, session, canManage, urlState, onBook }: {
  day: PlannerDay;
  /** Null when a whole DAY is selected rather than one session. Both are valid selections. */
  session: PlannerSession | null;
  canManage: boolean;
  urlState: PlannerUrlState;
  onBook: (date: string, startMinute: number | null) => void;
}) {
  const appointments = session
    ? day.appointments.filter(a => session.appointmentIds.includes(a.id))
    : day.appointments;
  const capacity = session ? session.capacity : null;
  const dayCapacity = day.capacity;

  return (
    <div className="border-t border-gray-100 pt-3">
      {/* ── HEADER: date, location, session, time ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[14px] font-bold text-gray-900">
          {session ? "Session" : "Day"}
        </h2>
        <span className="text-[12px] text-gray-500">{day.weekdayName} {longDate(day.date)}</span>
        {session && (
          <Link scroll={false}
            href={plannerHref({ ...urlState, sel: null })}
            className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Whole day
          </Link>
        )}
      </div>

      {session && (
        <p className="mt-0.5 text-[13px] font-semibold text-gray-800">
          {hhmm(session.startMinute)}-{hhmm(session.endMinute)} · {session.locationName ?? "no location"}
          <span className="ml-1 font-normal text-gray-500">{session.slotKindLabel}</span>
        </p>
      )}

      {day.unavailable ? (
        <p className="mt-2 text-[12px] font-semibold text-rose-700">
          This day could not be read, so it has no summary and no list. That is not the same as a day
          with nothing on it.
        </p>
      ) : (
        <>
          {/* ── CONFLICT STATE. First, because it is the thing somebody must not scroll past. ──── */}
          {day.conflicts.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {day.conflicts.map((c, i) => (
                <li key={`${c.code}-${i}`} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700">
                    {CONFLICT_LABEL[c.code] ?? c.code}
                  </p>
                  <p className="text-[12px] text-rose-800">{c.message}</p>
                  {c.code === "SCHEDULE_OVERRIDE_CONFLICT" && (
                    <p className="mt-0.5 text-[11px] text-rose-700">
                      Nothing has been moved. These patients are still booked and still expect to be seen.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* ── CAPACITY SUMMARY ────────────────────────────────────────────────────────────────── */}
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              {CAPACITY_BASIS_LABEL}
            </p>
            {capacity ? (
              <>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <Stat value={capacity.slots === null ? "-" : String(capacity.slots)} label="Slots" />
                  <Stat value={String(capacity.booked)} label="Booked" />
                  <Stat
                    value={capacity.available === null ? "-" : String(capacity.available)}
                    label={capacity.blocked ? "Free (blocked)" : "Free"} />
                </div>
                {capacity.available === null && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">
                    {capacity.availableUnknownReason}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-gray-400">
                  {capacity.appointmentMinutes}-minute appointments. {CAPACITY_BASIS_NOTE}
                </p>
              </>
            ) : dayCapacity ? (
              <>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <Stat value={dayCapacity.slots === null ? "-" : String(dayCapacity.slots)} label="Slots" />
                  <Stat value={String(dayCapacity.booked)} label="Booked" />
                  <Stat value={dayCapacity.available === null ? "-" : String(dayCapacity.available)} label="Free" />
                </div>
                <dl className="mt-2 flex flex-col gap-0.5 text-[12px]">
                  <Line term="Sessions" value={String(dayCapacity.sessionCount)} />
                  <Line term="Booked time" value={hoursMinutes(dayCapacity.bookedMinutes)} />
                  {dayCapacity.blockedMinutes > 0 &&
                    <Line term="Blocked" value={hoursMinutes(dayCapacity.blockedMinutes)} />}
                </dl>
                {dayCapacity.sessionsNotGenerated > 0 && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">
                    {dayCapacity.sessionsNotGenerated} session
                    {dayCapacity.sessionsNotGenerated === 1 ? " has" : "s have"} no generated times, so
                    their free time is not counted above.{" "}
                    {/* CPR-PLAN-002's comp writes "Not configured -- Set up" here, and the state is
                        real, so the pointer ships -- for someone who can act on it. For anyone else
                        the sentence names where it lives instead of offering a door that refuses. */}
                    {canManage ? (
                      <Link href="/practice/setup/availability"
                        className="font-bold text-[var(--cp-primary-deep)] hover:underline">
                        Generate them in Practice Setup
                      </Link>
                    ) : (
                      <span className="font-normal">Times are generated in Practice Setup.</span>
                    )}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-gray-400">{CAPACITY_BASIS_NOTE}</p>
              </>
            ) : (
              // ⚠ NO SESSION AT ALL IS NOT NOUGHT CAPACITY. Nothing about this day has been measured.
              <p className="mt-1 text-[12px] text-gray-500">
                {DAY_OFF_LABEL} on this date, so there is no capacity to summarise.{" "}
                {canManage ? (
                  <Link href="/practice/setup/availability"
                    className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    Set up availability
                  </Link>
                ) : (
                  <span>Availability is set up in Practice Setup.</span>
                )}
              </p>
            )}
          </div>

          {/* ── WHAT HAPPENED. The practice owner's second sentence, and the honest half of it. ──── */}
          {day.happened && (day.happened.isPast || day.isToday) && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                What happened
              </p>
              {appointments.length === 0 && day.activities.length === 0 ? (
                <p className="mt-1 text-[12px] text-gray-500">
                  Nothing was booked and nothing was planned on this date, so there is nothing to report.
                </p>
              ) : (
                <>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[12px]">
                    <Outcome n={day.happened.seen} label="seen, with a consultation recorded" tone="good" />
                    <Outcome n={day.happened.consultationStarted} label="consultation started, not finished" />
                    <Outcome n={day.happened.markedComplete} label="marked complete, no consultation recorded" />
                    <Outcome n={day.happened.arrived} label="arrived" />
                    <Outcome n={day.happened.didNotAttend} label="did not attend" tone="bad" />
                    <Outcome n={day.happened.cancelled} label="cancelled" />
                    <Outcome n={day.happened.expected} label="still expected" />
                    {/* ⚠ THE ONE THAT MATTERS. Not an accusation and not an error -- a gap in the record. */}
                    <Outcome n={day.happened.notRecorded} label="with nothing recorded" tone="gap" />
                    <Outcome n={day.happened.activitiesRan} label="of your own blocks actually ran" />
                  </ul>
                  {day.happened.notRecorded > 0 && (
                    <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      &quot;Nothing recorded&quot; means nobody marked the booking and no consultation was
                      written against it. It does not mean the patient was seen, and it does not mean they
                      failed to attend -- this practice holds no fact either way.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── APPOINTMENTS: compact, time-ordered, with status and drill-in ────────────────────── */}
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              {session ? "Booked into this session" : "Booked on this day"}
            </p>
            {appointments.length === 0 ? (
              <p className="mt-1 text-[12px] text-gray-500">
                {day.hasProgram
                  ? "Nobody is booked in yet."
                  : "Nobody is booked, and there is no program on this date either."}
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {appointments.map(a => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-1.5 text-[12px]">
                    <span className={`w-[44px] shrink-0 tabular-nums ${a.voided
                      ? "text-gray-400 line-through" : "text-gray-600"}`}>
                      {hhmm(a.startMinute)}
                    </span>
                    {a.href ? (
                      <Link href={a.href} className={`min-w-0 flex-1 truncate hover:underline ${a.voided
                        ? "text-gray-400 line-through" : "text-gray-800"}`}>
                        {a.patientName}
                      </Link>
                    ) : (
                      <span className={`min-w-0 flex-1 truncate ${a.voided
                        ? "text-gray-400 line-through" : "text-gray-800"}`}>
                        {a.patientName}
                      </span>
                    )}
                    {/* On a past day the OUTCOME is the useful chip; on a future one it is the status.
                        Both come off the payload; neither is inferred here. */}
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      (day.isPast || day.isToday
                        ? OUTCOME_CHIP[a.outcome]
                        : APPOINTMENT_STATUS_CHIP[a.status]) ?? "bg-slate-100 text-slate-600"}`}>
                      {day.isPast || day.isToday ? a.outcomeLabel : a.statusLabel}
                    </span>
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
          </div>

          {/* ── QUICK ACTIONS ───────────────────────────────────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
            {canManage && (
              <button type="button"
                onClick={() => onBook(day.date, session ? session.startMinute : null)}
                className="rounded-lg border border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 px-2.5 py-1 text-[12px] font-semibold text-[var(--cp-primary-deep)]">
                Add activity here
              </button>
            )}
            <Link scroll={false}
              href={plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null })}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Open the day
            </Link>
            {/* ⚠ BOOKING A PATIENT IS THE APPOINTMENT BOOK'S JOB, AND CPR-PLN-002 s7 PUTS THE BOOK FORM
                IN DAY MODE. This is a jump to it -- to the Day view when another view is open, to the
                anchor when the Day view already is -- not a second booking form: s8 forbids a second
                surface over one store, and a duplicate form is exactly that. */}
            <Link scroll={false}
              href={`${plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null })}#appointment-book`}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Book a patient
            </Link>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Blocking time and changing the regular week are done in Practice Setup. This panel does not
            rewrite your program.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-1.5">
      <p className="text-[16px] font-bold text-gray-900 tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}

/** One counted outcome. Nought is not drawn -- "0 did not attend" is noise, not information. */
function Outcome({ n, label, tone }: { n: number; label: string; tone?: "good" | "bad" | "gap" }) {
  if (n === 0) return null;
  return (
    <li className={tone === "bad" ? "text-rose-700" : tone === "gap"
      ? "font-semibold text-amber-800" : tone === "good" ? "text-emerald-800" : "text-gray-700"}>
      <span className="font-bold tabular-nums">{n}</span> {label}
    </li>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="min-w-0 flex-1 truncate text-gray-500">{term}</dt>
      <dd className="shrink-0 font-semibold text-gray-800 tabular-nums">{value}</dd>
    </div>
  );
}
