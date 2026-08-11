"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlannerDay, PlannerWeek } from "@/lib/practice/planner";
import { TRAVEL_BASIS_LABEL } from "@/lib/practice/planner-constants";
import { hhmm, hoursMinutes, locationTone, shortDate, toneFor, plannerHref, type PlannerUrlState } from "./planner-ui";

// s4 THE WEEKLY PLANNER -- Monday to Sunday, ALL SEVEN, ALWAYS.
//
// ⚠ A DAY THAT COULD NOT BE READ IS NOT AN EMPTY DAY. plannerWeek() returns seven rows whatever happens
// and flags the ones it could not read with `unavailable` and a null workload, precisely so this panel
// can say "I could not find out about Thursday" rather than drawing a clear Thursday. "You have nothing
// on" and "I do not know" are different sentences and only one of them is safe to show somebody
// deciding whether to take a theatre list.
//
// THE CURRENT DAY IS EXPANDED BY DEFAULT (s4). The others collapse to their counts, which is enough to
// see where the week is heavy without scrolling past seven open lists.

export default function WeekPanel({ week, selectedDate, canManage, onAdd, urlState }: {
  week: PlannerWeek;
  selectedDate: string;
  canManage: boolean;
  onAdd: (date: string) => void;
  /** ⚠ Carried through every day link so choosing a day does not clear the filters or the view. */
  urlState: PlannerUrlState;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [selectedDate]: true });
  const toggle = (date: string) => setExpanded(e => ({ ...e, [date]: !e[date] }));

  return (
    <aside className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-[14px] font-bold text-gray-900">My Week</h2>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {week.days.length} days
        </span>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {week.days.map(day => (
          <DayCard
            key={day.date} day={day}
            selected={day.date === selectedDate}
            open={!!expanded[day.date]}
            onToggle={() => toggle(day.date)}
            canManage={canManage}
            onAdd={() => onAdd(day.date)}
            urlState={urlState}
          />
        ))}
      </div>
    </aside>
  );
}

function DayCard({ day, selected, open, onToggle, canManage, onAdd, urlState }: {
  day: PlannerDay; selected: boolean; open: boolean; onToggle: () => void;
  canManage: boolean; onAdd: () => void; urlState: PlannerUrlState;
}) {
  const w = day.workload;
  const live = day.activities.filter(a => a.state !== "cancelled");

  return (
    <section
      className={`rounded-xl border ${selected
        ? "border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/[0.04] ring-1 ring-[var(--cp-primary)]/20"
        : "border-gray-200 bg-white"}`}
    >
      {/* ⚠ TWO CONTROLS SIT HERE AND THEY DO DIFFERENT THINGS. The LINK reviews the day -- it drives the
          centre panel and the Day panel through ?date=. The CHEVRON only expands this row in place. Both
          already worked, and a practitioner driving the product asked whether reviewing another day was
          possible at all, because the link carried NO hover state, NO cursor affordance and NO label: it
          rendered as a bold heading that happened to be clickable, next to a chevron that looked like the
          interactive thing and did something else. Correct code, invisible to the person using it. */}
      <div className="flex items-center gap-1 px-2 py-2">
        <Link href={plannerHref({ ...urlState, date: day.date, sel: null })} scroll={false}
          aria-current={selected ? "page" : undefined}
          aria-label={selected
            ? `${day.weekdayName} ${shortDate(day.date)}, currently being reviewed`
            : `Review ${day.weekdayName} ${shortDate(day.date)}`}
          className={`group flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-2 py-1 text-left transition-colors
            ${selected ? "bg-[var(--cp-primary)]/[0.06]" : "hover:bg-gray-100 focus-visible:bg-gray-100"}`}>
          <span className={`text-[13px] font-bold ${day.isToday ? "text-[var(--cp-primary-deep)]" : "text-gray-900"}`}>
            {day.weekdayShort}
          </span>
          <span className="text-[12px] text-gray-500">{shortDate(day.date)}</span>
          {day.isToday && (
            <span className="rounded-full bg-[var(--cp-primary)]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--cp-primary-deep)]">
              Today
            </span>
          )}
          {day.conflicts.length > 0 && (
            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              {day.conflicts.length} conflict{day.conflicts.length === 1 ? "" : "s"}
            </span>
          )}
          {/* The state, in words. The ring around the card said which day was selected only to somebody who
              already knew the ring meant that -- and said nothing at all about the other six being openable. */}
          <span className="ml-auto shrink-0 pl-2 text-[10px] font-semibold uppercase tracking-wide">
            {selected
              ? <span className="text-[var(--cp-primary-deep)]">Reviewing</span>
              : <span className="text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Review →</span>}
          </span>
        </Link>
        <button type="button" onClick={onToggle}
          aria-expanded={open}
          // ⚠ SAYS WHAT IT DOES, not just which way it points. "Expand" beside a link that navigates is
          // ambiguous; this names the difference so the two controls cannot be confused by a screen reader
          // either.
          aria-label={`${open ? "Hide" : "Show"} ${day.weekdayName} ${shortDate(day.date)} detail in this list`}
          title={open ? "Hide detail here" : "Show detail here"}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-gray-500 hover:bg-gray-100">
          {open ? "⌃" : "⌄"}
        </button>
      </div>

      {day.unavailable ? (
        <p className="px-3 pb-3 text-[12px] font-semibold text-rose-700">
          This day could not be read. Nothing is being claimed about it.
        </p>
      ) : open ? (
        <div className="px-3 pb-3">
          {/* WHERE, in clock order. Consecutive blocks at one place are one visit. Each place carries
              its clinic dot (the owner, 2026-08-12) -- the same hue this location has on the month
              grid and the day view, so the three screens read as one diary. */}
          {day.locations.length > 0 && (
            <p className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-semibold text-gray-700">
              {day.locations.map((l, i) => (
                <span key={`${l.locationId}-${i}`} className="flex items-center gap-1">
                  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${locationTone(l.locationId).dot}`} />
                  <span className="truncate">{l.name}</span>
                  {i < day.locations.length - 1 && <span aria-hidden className="text-gray-400">→</span>}
                </span>
              ))}
            </p>
          )}

          {live.length === 0 && day.activities.length === 0 && (
            <p className="text-[12px] text-gray-400">Nothing planned.</p>
          )}

          <ul className="flex flex-col gap-1">
            {day.activities.map(a => (
              <li key={a.id} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneFor(a.activityType).dot}`} aria-hidden />
                <span className={`min-w-0 flex-1 truncate text-[12px] ${a.state === "cancelled"
                  ? "text-gray-400 line-through" : "text-gray-800"}`}>
                  {a.title}
                </span>
                <span className={`shrink-0 text-[11px] tabular-nums ${a.state === "cancelled" ? "text-gray-400 line-through" : "text-gray-500"}`}>
                  {hhmm(a.plannedStartMinute)} - {hhmm(a.plannedEndMinute)}
                </span>
              </li>
            ))}
          </ul>

          {/* WORKLOAD SUMMARY (s4). Counts and durations. No rate, no target. */}
          {w && (
            <p className="mt-2 text-[11px] text-gray-500">
              {w.activityCount} activit{w.activityCount === 1 ? "y" : "ies"}
              {" · "}{hoursMinutes(w.committedMinutes)} spoken for
              {w.cancelledCount > 0 ? ` · ${w.cancelledCount} cancelled` : ""}
              {w.unassignedCount > 0 ? ` · ${w.unassignedCount} with no location` : ""}
            </p>
          )}

          {/* TRAVEL INDICATOR (s4). ⚠ An allowance the practitioner typed, never a measured time. */}
          {day.travel.hops.length > 0 && (
            <p className="mt-1 text-[11px] text-gray-500">
              {TRAVEL_BASIS_LABEL}: <span className="font-semibold">{hoursMinutes(day.travel.bufferMinutes)}</span>
              {" "}across {day.travel.hops.length} move{day.travel.hops.length === 1 ? "" : "s"}
              {day.travel.shortfalls.length > 0 && (
                <span className="font-semibold text-rose-700"> · {day.travel.shortfalls.length} does not fit</span>
              )}
            </p>
          )}

          {canManage && (
            <button type="button" onClick={onAdd}
              className="mt-2 w-full rounded-lg border border-dashed border-gray-300 px-2 py-1.5 text-[12px] font-semibold text-gray-600 hover:border-[var(--cp-primary)] hover:text-[var(--cp-primary-deep)]">
              + Add Activity
            </button>
          )}
        </div>
      ) : (
        // COLLAPSED: still shows activities counted, location and workload, which is what s4 asks each
        // day to display. Collapsing hides the list, not the facts.
        <p className="px-3 pb-2.5 text-[11px] text-gray-500">
          {w
            ? `${w.activityCount} activit${w.activityCount === 1 ? "y" : "ies"} · ${hoursMinutes(w.committedMinutes)}`
            : "no summary"}
          {day.locations.length > 0 ? ` · ${day.locations.map(l => l.name).join(", ")}` : ""}
          {day.travel.bufferMinutes > 0 ? ` · ${hoursMinutes(day.travel.bufferMinutes)} travel allowance` : ""}
        </p>
      )}
    </section>
  );
}
