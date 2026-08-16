"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlannerDay, PlannerRange, PlannerSession } from "@/lib/practice/planner";
import {
  AGENDA_BANDS, AGENDA_QUICK_RANGES, AGENDA_EXTEND_STEP_DAYS,
  DAY_OFF_LABEL, DAY_UNREADABLE_LABEL,
  type PlannerFilters, type PlannerPeriod,
} from "@/lib/practice/planner-constants";
import {
  APPOINTMENT_STATUS_CHIP, OUTCOME_CHIP, capacityPhrase, filterDay, hhmm, longDate, shortDate,
  shiftDate, plannerHref, toneFor, locationTone,
  type PlannerUrlState,
} from "./planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PLAN-002 s8 (2026-08-16) -- THE AGENDA, REBUILT AS A PRIORITISED INDEX.
//
// The old list was CP-PLAN-002 s5's flat chronology: every day in the period, every session open, every
// patient row rendered at once -- which over the default month was exactly the "long chronological dump"
// the new specification opens by naming. Three changes, all s8's:
//
//   PAST / TODAY / UPCOMING   one list, three bands. Today is always anchored and expanded; the past
//                             shows what actually has something on it and loads older history on
//                             request; upcoming is the bounded horizon the chips choose.
//   COLLAPSED ROWS            a session is ONE LINE -- time, place, type, booked/free or what actually
//                             happened -- and the patient names live behind its chevron (s8.3: names
//                             hidden until the practitioner asks). Selecting the counts populates the
//                             Item Preview beside this list without navigating away.
//   BOUNDED, THEN EXTENDED    "Show earlier days" and "Show more days" widen the period by one step
//                             through the URL, so the server reads exactly what is shown and a bookmark
//                             of the widened list still means the widened list.
//
// ⚠ WHAT A PAST ROW MAY SAY. The comp writes "3 seen · 1 not seen · 3 complete". "Not seen" is refused:
// it folds a recorded did-not-attend and a booking NOBODY WROTE ANYTHING ABOUT into one figure, and the
// second half of that figure is not a fact about the patient. The row uses the engine's own outcome
// vocabulary -- seen / DNA / not recorded -- the same words the month grid uses, because HFE-07 wants
// one vocabulary across the four views and the honest one already exists.
//
// ⚠ DAYS WITH NOTHING ON THEM: in the PAST they are omitted (s8.1 asks for "recent meaningful items");
// in UPCOMING a run of them folds into one quiet line (s8.2's day-off row, without 42 of them); a day
// that COULD NOT BE READ is always its own rose row, in either band, because a hole in the answer must
// never look like a quiet weekend.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function AgendaList({ range, period, filters, urlState }: {
  range: PlannerRange;
  period: PlannerPeriod;
  filters: PlannerFilters;
  urlState: PlannerUrlState;
}) {
  const today = range.todayDate;
  // One expansion state for every row; today's rows default OPEN (s8.1: today is expanded), the rest
  // default closed. Stored sparsely so "never touched" and "closed by hand" both work.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const rowOpen = (key: string, def: boolean) => openRows[key] ?? def;
  const toggleRow = (key: string, def: boolean) =>
    setOpenRows(o => ({ ...o, [key]: !(o[key] ?? def) }));

  const days = range.days.map(day => ({ day, shown: filterDay(day, filters) }));
  const past = days.filter(r => r.day.date < today && (r.day.unavailable || !r.shown.empty));
  const todayRows = days.filter(r => r.day.date === today);
  const upcoming = days.filter(r => r.day.date > today);
  const todayInPeriod = today >= period.fromDate && today <= period.toDate;
  const daysWithSomething = days.filter(r => !r.day.unavailable && !r.shown.empty).length;

  // The band bodies, keyed the same way AGENDA_BANDS is, so the render below is one loop over s8.1's
  // list and a band cannot be dropped without the harness noticing the label go missing.
  const chip = (active: boolean) =>
    `rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${active
      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
      : "border-gray-200 text-gray-600 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]"}`;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 px-4 py-3">
        <h2 className="text-[15px] font-bold text-gray-900">Agenda</h2>
        <span className="text-[12px] text-gray-500">
          {longDate(period.fromDate)} to {longDate(period.toDate)} · {range.days.length} days
        </span>
        <span className="ml-auto text-[12px] text-gray-500">
          {daysWithSomething} day{daysWithSomething === 1 ? "" : "s"} with something on
        </span>
      </div>

      {/* ── s3's CONTEXTUAL QUICK RANGES. The Agenda's own three; "Custom period" already lives on the
          navigator above and is not duplicated into a second pair of date fields here. ─────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-4 py-2">
        {AGENDA_QUICK_RANGES.map(r => {
          const from = today;
          const to = shiftDate(today, r.aheadDays);
          const active = period.fromDate === from && period.toDate === to;
          return (
            <Link key={r.key} scroll={false}
              href={plannerHref({ ...urlState, view: "agenda", date: today, from, to, sel: null })}
              aria-current={active ? "page" : undefined}
              title={r.aheadDays === 0 ? "Today only" : `Today and the ${r.aheadDays} days after it`}
              className={chip(active)}>
              {r.label}
            </Link>
          );
        })}
        <span className="text-[11px] text-gray-400">
          For any other period, use Custom period in the navigator above.
        </span>
      </div>

      {days.length === 0 || (past.length === 0 && todayRows.length === 0 && upcoming.length === 0) ? (
        <p className="px-4 py-8 text-center text-[13px] text-gray-500">
          Nothing is on between {longDate(period.fromDate)} and {longDate(period.toDate)}. Every day in
          this period was read; none of them holds an appointment, a session or an activity that matches
          what you are showing.
        </p>
      ) : (
        <div className="flex flex-col">
          {AGENDA_BANDS.map(band => (
            <section key={band.key} aria-label={band.label}>
              <div className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-1.5">
                <h3 className={`text-[11px] font-bold uppercase tracking-wide ${band.key === "today"
                  ? "text-[var(--cp-primary-deep)]" : "text-gray-500"}`}>
                  {band.label}
                </h3>
                {band.key === "today" && (
                  <span className="text-[12px] font-semibold text-gray-700">{longDate(today)}</span>
                )}
                {/* s8.1: older history loads ON REQUEST -- one press widens the period one step back. */}
                {band.key === "past" && !range.rangeCapped && (
                  <Link scroll={false}
                    href={plannerHref({
                      ...urlState, view: "agenda",
                      from: shiftDate(period.fromDate, -AGENDA_EXTEND_STEP_DAYS), to: period.toDate,
                    })}
                    className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    Show {AGENDA_EXTEND_STEP_DAYS} earlier days
                  </Link>
                )}
              </div>

              {band.key === "past" && (
                past.length === 0 ? (
                  <p className="px-4 py-2 text-[12px] text-gray-400">
                    {period.fromDate > today
                      ? `This period starts ${longDate(period.fromDate)}, after today, so it has no past days.`
                      : period.fromDate === today
                        ? "This period starts today, so there is nothing behind it to show."
                        : "Nothing in this period's past days matches what you are showing."}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {past.map(r => (
                      <AgendaDay key={r.day.date} day={r.day} shown={r.shown} urlState={urlState}
                        today={today} rowOpen={rowOpen} toggleRow={toggleRow} defaultOpen={false}
                        locationColors={range.locationColors} />
                    ))}
                  </ul>
                )
              )}

              {band.key === "today" && (
                !todayInPeriod ? (
                  <p className="px-4 py-2 text-[12px] text-gray-500">
                    Today, {longDate(today)}, is outside this period.{" "}
                    <Link scroll={false}
                      href={plannerHref({ ...urlState, view: "agenda", date: today, from: today, to: today, sel: null })}
                      className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      Jump to today
                    </Link>
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {todayRows.map(r => (
                      <AgendaDay key={r.day.date} day={r.day} shown={r.shown} urlState={urlState}
                        today={today} rowOpen={rowOpen} toggleRow={toggleRow} defaultOpen
                        locationColors={range.locationColors} />
                    ))}
                  </ul>
                )
              )}

              {band.key === "upcoming" && (
                <>
                  {upcoming.length === 0 ? (
                    <p className="px-4 py-2 text-[12px] text-gray-400">
                      This period ends {period.toDate < today ? "before today" : "today"}, so it holds no
                      upcoming days.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {foldQuietRuns(upcoming).map(item => item.kind === "run" ? (
                        <li key={`run-${item.fromDate}`} className="px-4 py-1.5">
                          <p className="text-[12px] text-gray-400">
                            <span className="font-semibold uppercase tracking-wide text-gray-400">
                              {item.fromDate === item.toDate
                                ? `${item.weekdayShort} ${shortDate(item.fromDate)}`
                                : `${shortDate(item.fromDate)} - ${shortDate(item.toDate)}`}
                            </span>
                            {" · "}
                            {item.hidden > 0
                              ? `${item.hidden} hidden by the controls above`
                              : DAY_OFF_LABEL}
                          </p>
                        </li>
                      ) : (
                        <AgendaDay key={item.row.day.date} day={item.row.day} shown={item.row.shown}
                          urlState={urlState} today={today} rowOpen={rowOpen} toggleRow={toggleRow}
                          defaultOpen={false} locationColors={range.locationColors} />
                      ))}
                    </ul>
                  )}
                  {/* s8.3: incremental "Show more days", never an unrestricted multi-week render. */}
                  {!range.rangeCapped && (
                    <div className="border-t border-gray-100 px-4 py-2 text-center">
                      <Link scroll={false}
                        href={plannerHref({
                          ...urlState, view: "agenda",
                          from: period.fromDate, to: shiftDate(period.toDate, AGENDA_EXTEND_STEP_DAYS),
                        })}
                        className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        Show {AGENDA_EXTEND_STEP_DAYS} more days
                      </Link>
                    </div>
                  )}
                </>
              )}
            </section>
          ))}

          {/* What the outcome words mean, once, under the list -- every figure above renders from the
              recorded facts the engine carries, and the third sentence is the one that stops a gap in
              the record reading as a patient's failure. */}
          <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
            Booked = scheduled into the session. Seen = a consultation was recorded. Not recorded = the
            day passed and nobody wrote anything down -- that is a gap in the record, not a patient who
            failed to attend. All times in {range.timezone}.
          </p>
        </div>
      )}
    </section>
  );
}

// ── ONE DAY OF THE LIST ──────────────────────────────────────────────────────────────────────────────

function AgendaDay({ day, shown, urlState, today, rowOpen, toggleRow, defaultOpen, locationColors }: {
  day: PlannerDay;
  shown: ReturnType<typeof filterDay>;
  urlState: PlannerUrlState;
  today: string;
  rowOpen: (key: string, def: boolean) => boolean;
  toggleRow: (key: string, def: boolean) => void;
  /** True for the Today band: its sessions open with their patients showing (s8.1). */
  defaultOpen: boolean;
  locationColors: Record<string, string>;
}) {
  const dayHref = plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null, sel: null });
  const loose = shown.appointments.filter(
    a => !shown.sessions.some(s => s.appointmentIds.includes(a.id)));

  return (
    <li className={`px-4 py-2.5 ${day.isToday ? "bg-[var(--cp-primary)]/[0.03]" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        {/* s9's one-action move to the day: the date IS the link, and it says so on hover. */}
        <Link scroll={false} href={dayHref}
          className="group text-[13px] font-bold text-gray-900 hover:underline">
          {day.weekdayShort} {shortDate(day.date)}
          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 opacity-0 group-hover:opacity-100">
            Open day →
          </span>
        </Link>
        {day.isToday && (
          <span className="rounded-full bg-[var(--cp-primary)]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--cp-primary-deep)]">
            Today
          </span>
        )}
        {day.capacity && (
          <span className="text-[11px] text-gray-500">{capacityPhrase(day.capacity)}</span>
        )}
        {/* s8.1: exceptions outrank a normal zero. The conflict count is rose and first in the eye. */}
        {day.conflicts.length > 0 && (
          <Link scroll={false} href={dayHref}
            className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-200">
            {day.conflicts.length} conflict{day.conflicts.length === 1 ? "" : "s"}
          </Link>
        )}
      </div>

      {day.unavailable ? (
        <p className="mt-1 text-[12px] font-semibold text-rose-700">
          {DAY_UNREADABLE_LABEL}. Nothing is being claimed about this date.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1">
          {day.isToday && shown.empty && shown.hidden === 0 && (
            <p className="text-[12px] text-gray-500">
              {day.dayOff ? `${DAY_OFF_LABEL} on this date and nothing planned.` : "Nothing is on today."}{" "}
              <Link scroll={false} href={dayHref}
                className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Open the day to add an activity
              </Link>
            </p>
          )}

          {shown.sessions.map(s => (
            <SessionRow key={s.id} day={day} session={s} shown={shown} urlState={urlState}
              today={today} open={rowOpen(s.id, defaultOpen)} onToggle={() => toggleRow(s.id, defaultOpen)}
              locationColors={locationColors} />
          ))}

          {/* Bookings that sit in no session: s8.1's outside-session exception, visibly elevated and
              patient-level on purpose -- s4 shows patient detail "only on expansion OR EXCEPTION". */}
          {loose.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50">
              <p className="border-b border-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                Outside any session
              </p>
              <ul className="divide-y divide-amber-100/60">
                {loose.map(a => <AppointmentRow key={a.id} a={a} past={day.isPast} />)}
              </ul>
            </div>
          )}

          {shown.activities.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {shown.activities.map(a => (
                <li key={a.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${toneFor(a.activityType).dot}`} aria-hidden />
                  <span className="w-[86px] shrink-0 tabular-nums text-gray-500">
                    {hhmm(a.plannedStartMinute)}-{hhmm(a.plannedEndMinute)}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${a.state === "cancelled"
                    ? "text-gray-400 line-through" : "text-gray-800"}`}>
                    {a.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-500">{a.label}</span>
                  <span className="shrink-0 text-[11px] text-gray-500">{a.locationName ?? "no location"}</span>
                </li>
              ))}
            </ul>
          )}

          {shown.hidden > 0 && (
            <p className="text-[11px] text-gray-400">
              {shown.hidden} more on this day {shown.hidden === 1 ? "is" : "are"} hidden by the controls above.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ── ONE SESSION, AS ONE LINE (s8.2), WITH ITS PATIENTS BEHIND THE CHEVRON (s8.3) ────────────────────

function SessionRow({ day, session: s, shown, urlState, today, open, onToggle, locationColors }: {
  day: PlannerDay;
  session: PlannerSession;
  shown: ReturnType<typeof filterDay>;
  urlState: PlannerUrlState;
  today: string;
  open: boolean;
  onToggle: () => void;
  locationColors: Record<string, string>;
}) {
  const inside = shown.appointments.filter(a => s.appointmentIds.includes(a.id));
  const selected = urlState.sel === s.id && urlState.date === day.date;
  const tone = locationTone(s.locationId, s.locationId ? locationColors[s.locationId] : null);

  // What a PAST session's line says instead of a free count: the engine's outcome words, non-zero parts
  // only -- the same three the month cell shows, because they are the ones worth acting on.
  const all = day.appointments.filter(a => s.appointmentIds.includes(a.id));
  const n = (o: string) => all.filter(a => a.outcome === o).length;
  const outcomes: [number, string, string][] = [
    [n("seen"), "seen", "text-emerald-700"],
    [n("did_not_attend"), "DNA", "text-rose-700"],
    [n("not_recorded"), "not recorded", "font-semibold text-amber-800"],
  ];

  return (
    <div className={`rounded-lg border ${selected
      ? "border-[var(--cp-primary-border)] ring-1 ring-[var(--cp-primary)]/20"
      : s.capacity.blocked ? "border-gray-200 bg-gray-50" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2.5 py-1.5">
        <button type="button" onClick={onToggle} aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the bookings in this session, in this list`}
          className="shrink-0 self-center rounded-md px-1 text-[12px] text-gray-500 hover:bg-gray-100">
          {open ? "⌃" : "⌄"}
        </button>
        <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${s.capacity.blocked ? "bg-gray-300" : tone.dot}`} />
        <span className="text-[12px] font-bold tabular-nums text-gray-800">
          {hhmm(s.startMinute)}-{hhmm(s.endMinute)}
        </span>
        <span className="min-w-0 truncate text-[12px] text-gray-700">{s.locationName ?? "no location"}</span>
        <span className="shrink-0 text-[11px] text-gray-500">{s.slotKindLabel}</span>
        {s.capacity.blocked && (
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-600">
            Blocked
          </span>
        )}
        {s.source === "program" && (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">
            No times generated
          </span>
        )}

        {/* The counts, at the end of the line. On a past day: what happened. Otherwise: booked/free.
            Either way the figures are a LINK that selects this session into the Item Preview (s8.3) --
            a count you cannot open is a claim you cannot check. */}
        <Link scroll={false}
          href={plannerHref({ ...urlState, view: "agenda", date: day.date, sel: selected ? null : s.id })}
          aria-label={selected ? "Close the preview of this session" : "Preview this session beside the list"}
          className="ml-auto shrink-0 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          {day.date < today ? (
            <>
              {s.capacity.booked} booked
              {outcomes.filter(([count]) => count > 0).map(([count, word, cls]) => (
                <span key={word} className={cls}>{` · ${count} ${word}`}</span>
              ))}
            </>
          ) : capacityPhrase(s.capacity)}
        </Link>
      </div>

      {open && (
        inside.length === 0 ? (
          <p className="border-t border-gray-100 px-2.5 py-1.5 text-[12px] text-gray-400">
            {s.capacity.booked === 0
              ? "Nobody is booked in."
              : "None of its bookings match what you are showing."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-50 border-t border-gray-100">
            {inside.map(a => <AppointmentRow key={a.id} a={a} past={day.isPast} />)}
          </ul>
        )
      )}
    </div>
  );
}

/**
 * Consecutive upcoming days with nothing to show fold into ONE line (s8.2's day-off state without
 * forty of them). A day that could not be read NEVER folds -- it stays its own rose row.
 */
function foldQuietRuns(rows: { day: PlannerDay; shown: ReturnType<typeof filterDay> }[]): (
  | { kind: "day"; row: { day: PlannerDay; shown: ReturnType<typeof filterDay> } }
  | { kind: "run"; fromDate: string; toDate: string; weekdayShort: string; hidden: number }
)[] {
  const out: ReturnType<typeof foldQuietRuns> = [];
  for (const row of rows) {
    const quiet = !row.day.unavailable && row.shown.empty;
    if (!quiet) { out.push({ kind: "day", row }); continue; }
    const last = out[out.length - 1];
    if (last && last.kind === "run") {
      last.toDate = row.day.date;
      last.hidden += row.shown.hidden;
    } else {
      out.push({
        kind: "run", fromDate: row.day.date, toDate: row.day.date,
        weekdayShort: row.day.weekdayShort, hidden: row.shown.hidden,
      });
    }
  }
  return out;
}

function AppointmentRow({ a, past }: { a: PlannerRange["days"][number]["appointments"][number]; past: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5">
      <span className="w-[86px] shrink-0 text-[12px] font-semibold tabular-nums text-gray-700">
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
