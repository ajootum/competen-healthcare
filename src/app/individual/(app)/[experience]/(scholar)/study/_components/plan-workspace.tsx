"use client";

import Link from "next/link";
import { useId, useState, type CSSProperties } from "react";
import { rangeLabel, type AgendaDay, type EntryForm, type LinkOption } from "@/lib/individual/scholar/plan-view";
import {
  calendarHref, cellLabel, dayChip, dayUnits, dotSlice, emptyDayActions, itemsOfDay, longDayLabel, monthGridDates, planStudyPrefill, spanMonthLabel, stepDate,
  type DotKind, type PlanSpan,
} from "@/lib/individual/scholar/plan-workspace";
import { EntryEditor } from "./plan-entries";
import { AgendaRows, Notes } from "./plan-agenda-rows";
import { pillOutline, pillPrimary, squareBtn } from "./plan-style";
import { CalendarIcon, ChevronIcon } from "./plan-ui";

// MY PLAN -> CALENDAR (CE-03 mobile-first, to the owner's mockup). A real 7-column grid, Monday first, month or one week, then the selected day's
// agenda directly under it (beside it on a wide container). A day's cell carries only a few dots, never titles: blue planned study, green completed,
// purple the learner's own entries; busy time is a hatched cell; today is ringed in the accent, the selected day in the information colour. An empty day
// stays plain and selectable. Selecting a day is local (the month is already loaded) and kept in the address (?date=) so Today and back keep it.
// Scholar suggestions appear only on days the plan schedules them (never every free day), and as dots, not cards. A view of records and choices.

const WEEKDAY_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOT_COLOUR: Record<DotKind, string> = { planned: "var(--cmp-color-information)", done: "var(--cmp-color-success)", mine: "var(--cmp-role-indigo-accent)" };
const HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, var(--cmp-app-border) 4px 5px)";
const dayNum = (iso: string) => Number(iso.slice(8, 10));

function Dot({ kind }: { kind: DotKind }) {
  return <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: DOT_COLOUR[kind] }} />;
}

export type WorkspaceProps = {
  accent: string; today: string; base: string;
  /** Query parts kept on every link (the connected study session). */
  extra: Record<string, string>;
  studyId: string | null;
  span: PlanSpan; date: string; month: string;
  /** Every date the grid draws, with its items (the loaded months). */
  days: AgendaDay[];
  canAdd: boolean; canDecide: boolean;
  links: readonly LinkOption[];
  notes: string[];
  unattached: { ref: string; originalDate: string | null; scheduledDate: string | null }[];
  /** ?add=1: open the Add activity dialog on this day at once ("Plan today"). */
  openAdd: boolean;
};

export function PlanWorkspace(p: WorkspaceProps) {
  const uid = useId();
  const [selected, setSelected] = useState(p.date);
  const [seen, setSeen] = useState(p.date);
  const [editor, setEditor] = useState<{ prefill?: Partial<EntryForm> } | null>(p.openAdd ? {} : null);
  const [freed, setFreed] = useState<string[]>([]);
  // A new address (another month, "Plan today", back from Today) selects the day it names.
  if (seen !== p.date) { setSeen(p.date); setSelected(p.date); }

  const byDate = new Map(p.days.map(d => [d.date, d]));
  const weeks = p.span === "month" ? monthGridDates(p.month) : [p.days.map(d => d.date)];
  const inMonth = (d: string) => p.span === "week" || d.slice(0, 7) === p.month;
  const hrefAt = (span: PlanSpan, date: string, more: Record<string, string | null> = {}) => calendarHref(p.base, { span, date, today: p.today, extra: { ...p.extra, ...more } });
  const keepUrl = (date: string, more: Record<string, string | null> = {}) => { try { window.history.replaceState(null, "", hrefAt(p.span, date, more)); } catch { /* the address stays as it was */ } };
  function select(date: string) { setSelected(date); keepUrl(date); }
  function closeEditor() { setEditor(null); keepUrl(selected); }

  const first = p.days[0]?.date ?? p.today, last = p.days[p.days.length - 1]?.date ?? p.today;
  const heading = p.span === "month" ? spanMonthLabel(p.month) : rangeLabel(first, last);
  const unit = p.span === "month" ? "month" : "week";
  const items = itemsOfDay(p.days, selected);
  const chip = dayChip(items);
  const actions = emptyDayActions({ date: selected, today: p.today, canAdd: p.canAdd });
  const isFreed = freed.includes(selected);
  const ctx = { date: selected, today: p.today, accent: p.accent, links: p.links, studyId: p.studyId, canDecide: p.canDecide, elseHref: `${p.base}?view=today${p.studyId ? `&study=${encodeURIComponent(p.studyId)}` : ""}` };

  return (
    <div className="@container/plan">
      {/* the toolbar: month nav on the left; Week | Month and Add on the right (they wrap under on a phone) */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={hrefAt(p.span, stepDate({ span: p.span, date: selected }, -1, p.today))} className={squareBtn} aria-label={`Previous ${unit}`}><ChevronIcon dir="left" size={18} /></Link>
          <h2 className="min-w-0 text-[18px] font-bold leading-tight text-gray-900 sm:text-[20px]" aria-live="polite">{heading}</h2>
          <Link href={hrefAt(p.span, stepDate({ span: p.span, date: selected }, 1, p.today))} className={squareBtn} aria-label={`Next ${unit}`}><ChevronIcon dir="right" size={18} /></Link>
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label="Calendar span">
            <ul className="inline-flex rounded-full border border-gray-300 bg-white p-0.5">
              {(["week", "month"] as const).map(s => {
                const on = p.span === s;
                return (
                  <li key={s}>
                    <Link href={hrefAt(s, selected)} aria-current={on ? "page" : undefined}
                      className={`inline-flex min-h-9 items-center rounded-full px-3 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "text-white" : "text-gray-800 hover:bg-gray-50"}`}
                      style={on ? { background: p.accent } : undefined}>{s === "week" ? "Week" : "Month"}</Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {p.canAdd && (
            <button type="button" className={pillPrimary} style={{ background: p.accent }} onClick={() => setEditor({})}>
              <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Add activity
            </button>
          )}
        </div>
      </div>
      <Notes notes={p.notes} unattached={p.unattached} />

      <div className="mt-3 grid gap-4 @5xl/plan:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @5xl/plan:items-start">
        <div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-gray-600" aria-hidden>{WEEKDAY_HEAD.map(w => <div key={w}>{w}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1" role="group" aria-label={`${heading}: choose a day`}>
            {weeks.flat().map(date => {
              const n = dayNum(date);
              if (!inMonth(date)) {
                // A day of the neighbouring month: shown greyed on a light fill, inert (that month is not loaded here).
                return <div key={date} aria-hidden data-outside className="min-h-12 rounded-lg border border-gray-200 bg-gray-100 p-1 text-[12.5px] font-semibold tabular-nums text-gray-500 @3xl/plan:min-h-16">{n}</div>;
              }
              const day = byDate.get(date);
              const dayItems = day?.items ?? [];
              const { units, unavailable } = dayUnits(dayItems);
              const { shown, more } = dotSlice(units);
              const isToday = date === p.today, on = date === selected;
              const style: CSSProperties = {};
              if (unavailable) style.backgroundImage = HATCH;
              if (on && !isToday) { style.borderColor = "var(--cmp-color-information)"; style.backgroundColor = "var(--cmp-surface-information)"; style.boxShadow = "inset 0 0 0 1px var(--cmp-color-information)"; }
              else if (isToday) { style.borderColor = p.accent; style.backgroundColor = "var(--cmp-activity-plan-chip)"; style.boxShadow = `inset 0 0 0 ${on ? 2 : 1}px ${p.accent}`; }
              return (
                <button key={date} type="button" onClick={() => select(date)} aria-pressed={on} data-day={date}
                  aria-label={cellLabel(longDayLabel(date), isToday, dayItems)}
                  className="flex min-h-12 flex-col items-start justify-between gap-1 rounded-lg border border-gray-200 bg-transparent p-1 text-left hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] @3xl/plan:min-h-16"
                  style={style}>
                  <span className={`text-[12.5px] tabular-nums text-gray-900 ${isToday ? "font-extrabold" : "font-semibold"}`}>{n}</span>
                  <span className="flex flex-wrap items-center gap-[3px]" aria-hidden>
                    {shown.map(u => <Dot key={u.key} kind={u.dot} />)}
                    {more > 0 && <span className="text-[10px] font-semibold leading-none text-gray-700">+{more}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-gray-800" aria-label="What the marks mean" data-testid="calendar-legend">
            <li className="inline-flex items-center gap-1.5"><Dot kind="planned" />Planned study</li>
            <li className="inline-flex items-center gap-1.5"><Dot kind="done" />Completed</li>
            <li className="inline-flex items-center gap-1.5"><Dot kind="mine" />My entries (exams, deadlines, placements)</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded border border-gray-300" style={{ backgroundImage: HATCH }} />Unavailable / busy</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded border border-gray-300" />No plan (available)</li>
          </ul>
        </div>

        {/* the selected day: a tinted header band with the day and what is on it, then its rows */}
        <section aria-labelledby={`${uid}-day`} className="border-t border-gray-200 pt-4 @5xl/plan:border-l @5xl/plan:border-t-0 @5xl/plan:pl-4 @5xl/plan:pt-0" data-testid="selected-day">
          <header className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "var(--cmp-surface-information)", color: "var(--cmp-text-information)" }}>
            <h3 id={`${uid}-day`} className="flex min-w-0 items-center gap-2 text-[15px] font-bold"><CalendarIcon size={18} /><span>{longDayLabel(selected)}{selected === p.today ? " (Today)" : ""}</span></h3>
            {chip && <span className="rounded-full border border-current px-3 py-0.5 text-[12.5px] font-semibold">{chip}</span>}
          </header>
          <div aria-live="polite">
            {items.length > 0 ? (
              <AgendaRows items={items} ctx={ctx} />
            ) : (
              <div className="py-4" data-testid="agenda-empty">
                <p className="text-[15px] font-semibold text-gray-900">{selected < p.today ? "Nothing recorded." : "Nothing planned."}</p>
                {isFreed ? (
                  <p className="mt-1 text-[13.5px] text-gray-600">Left free.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {actions.includes("add") && <button type="button" className={pillOutline} onClick={() => setEditor({})}>Add activity</button>}
                    {actions.includes("plan") && <button type="button" className={pillPrimary} style={{ background: p.accent }} onClick={() => setEditor({ prefill: planStudyPrefill(p.days, p.links, p.today) })}>Plan study</button>}
                    {actions.includes("free") && <button type="button" className={pillOutline} onClick={() => setFreed(f => [...f, selected])}>Leave free</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {editor && <EntryEditor key={`${selected}-${editor.prefill ? "plan" : "add"}`} mode={{ kind: "create", date: selected, prefill: editor.prefill }} today={p.today} links={p.links} accent={p.accent} onClose={closeEditor} />}
    </div>
  );
}
