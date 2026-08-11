"use client";

import Link from "next/link";
import type { PlannerDay, PlannerRange } from "@/lib/practice/planner";
import {
  DAY_OFF_LABEL, DAY_UNREADABLE_LABEL, PLANNER_WEEKDAYS,
  type PlannerFilters, type PlannerPeriod,
} from "@/lib/practice/planner-constants";
import {
  capacityPhrase, filterDay, hhmm, locationTone, plannerHref, toneFor, NO_LOCATION_TONE,
  type PlannerUrlState,
} from "./planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CP-PLAN-002 s5/s6 -- THE MONTH.
//
// "Standard month grid; each working day shows compact location/session and booked/free counts; click day
// to drill down." And s6, which is the half that is easy to get wrong: "Day off/no program should be
// VISUALLY DISTINCT WITHOUT CREATING AN APPOINTMENT-LIKE RECORD."
//
// ⚠ SO A DAY OFF IS A CELL STYLE AND NOT A ROW. `day.dayOff` is a boolean the engine derives from the
// absence of a program; drawing it as a card that says "Day off" in the same shape as a clinic would put
// an object in the diary that nobody created and nothing can be booked into.
//
// ⚠ THREE STATES PER CELL, AND THEY LOOK DIFFERENT:
//     has a program   session cards with booked and free counts
//     no program      muted, the words "No program", no card
//     unreadable      rose, "Could not be read", and NO COUNTS AT ALL -- a day whose read failed must
//                     never render "0 booked", which is the one thing a zero here would mean.
//
// ⚠ AND EVERY FIGURE IS A LINK. "8 booked - 4 free" opens the Day view with that session selected, where
// those eight are listed by name. A count you cannot open is a claim you cannot check.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function MonthGrid({ range, period, filters, urlState, selectedDate }: {
  range: PlannerRange;
  period: PlannerPeriod;
  filters: PlannerFilters;
  urlState: PlannerUrlState;
  selectedDate: string;
}) {
  // The engine read the WHOLE GRID, Monday to Sunday, including the neighbouring months' days -- so the
  // first and last rows carry real data rather than blanks a reader would take for empty days.
  const weeks: PlannerDay[][] = [];
  for (let i = 0; i < range.days.length; i += 7) weeks.push(range.days.slice(i, i + 7));

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {PLANNER_WEEKDAYS.map(([n, long, short]) => (
          <div key={n} className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-gray-500">
            <abbr title={long} className="no-underline">{short}</abbr>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {weeks.flat().map(day => (
          <MonthCell key={day.date} day={day} period={period} filters={filters}
            urlState={urlState} selected={day.date === selectedDate}
            locationColors={range.locationColors} />
        ))}
      </div>

      {/* ── THE CLINIC LEGEND (the owner, 2026-08-12, from the design comp) ─────────────────────────
          Built from the locations actually ON this grid, so it cannot list a clinic the month does not
          contain. The hue is a scanning aid; the words on each block remain the identity. */}
      <MonthLegend range={range} />

      <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
        Counts are for your own diary. A session with no generated times shows no free count rather than
        nought -- there is nothing to count until times are generated in Practice Setup.
      </p>
    </section>
  );
}

function MonthLegend({ range }: { range: PlannerRange }) {
  const places = new Map<string, string>();
  let hasNoLocation = false;
  let hasDayOff = false;
  for (const day of range.days) {
    if (day.dayOff) hasDayOff = true;
    for (const s of day.sessions) {
      if (s.locationId) places.set(s.locationId, s.locationName ?? "Unnamed location");
      else hasNoLocation = true;
    }
  }
  if (places.size === 0 && !hasNoLocation && !hasDayOff) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-3 py-2">
      {[...places.entries()].map(([id, name]) => (
        <span key={id} className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <span aria-hidden className={`h-2 w-2 rounded-full ${locationTone(id, range.locationColors[id]).dot}`} />{name}
        </span>
      ))}
      {hasNoLocation && (
        <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <span aria-hidden className={`h-2 w-2 rounded-full ${NO_LOCATION_TONE.dot}`} />No location named
        </span>
      )}
      {hasDayOff && (
        <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <span aria-hidden className="h-2 w-2 rounded-full bg-gray-300" />Day off
        </span>
      )}
    </div>
  );
}

function MonthCell({ day, period, filters, urlState, selected, locationColors }: {
  day: PlannerDay; period: PlannerPeriod; filters: PlannerFilters;
  urlState: PlannerUrlState; selected: boolean;
  locationColors: Record<string, string>;
}) {
  const inMonth = day.date >= period.focusFromDate && day.date <= period.focusToDate;
  const shown = filterDay(day, filters);

  const dayHref = plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null, sel: null });

  return (
    <div className={`min-h-[112px] border-b border-r border-gray-100 p-1.5 ${
      day.unavailable ? "bg-rose-50/50"
        : !inMonth ? "bg-gray-50/60"
          : day.dayOff ? "bg-gray-50/40"
            : "bg-white"} ${selected ? "ring-1 ring-inset ring-[var(--cp-primary)]/40" : ""}`}>
      <div className="flex items-baseline gap-1">
        <Link href={dayHref} scroll={false}
          className={`text-[12px] font-bold tabular-nums ${day.isToday
            ? "rounded-full bg-[var(--cp-primary)] px-1.5 text-white"
            : inMonth ? "text-gray-800 hover:underline" : "text-gray-400 hover:underline"}`}>
          {Number(day.date.slice(8, 10))}
        </Link>
        {day.conflicts.length > 0 && (
          <Link href={dayHref} scroll={false}
            className="ml-auto rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">
            {day.conflicts.length}!
          </Link>
        )}
      </div>

      {/* ⚠ UNREADABLE FIRST, AND WITH NO NUMBERS. Everything below this branch is a statement about a
          day that was actually read. */}
      {day.unavailable ? (
        <p className="mt-1 text-[10px] font-semibold text-rose-700">{DAY_UNREADABLE_LABEL}</p>
      ) : day.dayOff ? (
        // s6's day off: distinct, quiet, and NOT a card. There is no record here to click into.
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {day.exceptions.find(e => e.effect === "removes")?.kindLabel ?? DAY_OFF_LABEL}
        </p>
      ) : (
        <div className="mt-1 flex flex-col gap-1">
          {shown.sessions.slice(0, 3).map(s => {
            // Per-clinic tint (the comp's month view): the practitioner's chosen colour when one is
            // set, else the stable hash. A blocked session stays grey whatever its place: "this time
            // is not bookable" outranks "where it would have been".
            const tone = locationTone(s.locationId, s.locationId ? locationColors[s.locationId] : null);
            return (
            <Link key={s.id} scroll={false}
              href={plannerHref({ ...urlState, view: "day", date: day.date, from: null, to: null, sel: s.id })}
              className={`block rounded-md border px-1.5 py-1 text-left ${s.capacity.blocked
                ? "border-gray-200 bg-gray-100"
                : tone.card}`}>
              <p className={`truncate text-[10px] font-semibold tabular-nums ${s.capacity.blocked ? "text-gray-800" : tone.time}`}>
                {hhmm(s.startMinute)}-{hhmm(s.endMinute)}
              </p>
              <p className={`truncate text-[10px] ${s.capacity.blocked ? "text-gray-600" : tone.place}`}>
                {s.locationName ?? s.slotKindLabel}
              </p>
              {/* THE COUNTS. A link, because each of them is the length of a list. */}
              <p className={`truncate text-[10px] font-semibold ${s.capacity.available === null
                ? "text-amber-700" : "text-[var(--cp-primary-deep)]"}`}>
                {s.source === "program" && s.capacity.available === null
                  ? `${s.capacity.booked} booked · times not generated`
                  : capacityPhrase(s.capacity)}
              </p>
            </Link>
            );
          })}
          {shown.sessions.length > 3 && (
            <Link href={dayHref} scroll={false} className="text-[10px] font-semibold text-gray-500 hover:underline">
              +{shown.sessions.length - 3} more session{shown.sessions.length - 3 === 1 ? "" : "s"}
            </Link>
          )}

          {/* Activities that are not sessions -- a ward round, a meeting, leave -- named, not counted. */}
          {shown.activities.slice(0, 2).map(a => (
            <Link key={a.id} href={dayHref} scroll={false}
              className="flex items-center gap-1 truncate text-[10px] text-gray-700 hover:underline">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneFor(a.activityType).dot}`} aria-hidden />
              <span className={`truncate ${a.state === "cancelled" ? "text-gray-400 line-through" : ""}`}>
                {a.title}
              </span>
            </Link>
          ))}

          {shown.empty && (
            <p className="text-[10px] text-gray-400">
              {shown.hidden > 0 ? `${shown.hidden} hidden by filters` : "Nothing on"}
            </p>
          )}

          {/* ⚠ WHAT HAPPENED, on a day that has been. The practice owner asked to see it from the
              calendar itself. Only the two figures worth acting on are shown here -- the whole
              breakdown is in the panel when the day is selected -- and "nothing recorded" is one of
              them precisely because it is the one nobody goes looking for. */}
          {day.isPast && day.happened && (day.happened.seen > 0 || day.happened.notRecorded > 0
            || day.happened.didNotAttend > 0) && (
            <Link href={dayHref} scroll={false} className="truncate text-[10px] hover:underline">
              {day.happened.seen > 0 && <span className="text-emerald-700">{day.happened.seen} seen</span>}
              {day.happened.didNotAttend > 0 && (
                <span className="text-rose-700">{day.happened.seen > 0 ? " · " : ""}{day.happened.didNotAttend} DNA</span>
              )}
              {day.happened.notRecorded > 0 && (
                <span className="font-semibold text-amber-800">
                  {day.happened.seen > 0 || day.happened.didNotAttend > 0 ? " · " : ""}
                  {day.happened.notRecorded} not recorded
                </span>
              )}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
