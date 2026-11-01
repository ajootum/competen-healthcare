"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CALENDAR_KIND, CALENDAR_REACH_DAYS, type CalendarKind } from "@/lib/individual/scholar/study-calendar-kinds";
import type { CalendarDay, CalendarItem, CalendarView } from "@/lib/individual/scholar/study-calendar";
import { addDays } from "@/lib/individual/scholar/monthly-review";

// SCHOLAR-MONTHLY-REVIEW-01 -- the study calendar on Progress, under the study plan. A month: a 7-column grid on tablet and
// desktop, an agenda list on a phone (no horizontal scroll, no nested scroll). Four kinds of mark, each with its own WORD, GLYPH
// and colour, never colour alone. A day opens inline with direct links. A planned activity or the monthly review can be moved
// (only where migration 830 is present); a card is never moved: its review date belongs to spaced review.
//
// ⚠ A view of records that exist. Not an assessment. 44px targets (48px on a coarse pointer), labels on every control.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const secondary = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-3 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;
const field = `block min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 pointer-coarse:min-h-[48px] ${focusRing}`;

const CHIP: Record<CalendarKind, string> = {
  planned: "border-blue-300 bg-blue-50 text-blue-900",
  due_revision: "border-green-300 bg-green-50 text-green-900",
  completed: "border-gray-300 bg-gray-50 text-gray-800",
  monthly_review: "border-amber-300 bg-amber-50 text-amber-900",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Chip({ kind, count, short }: { kind: CalendarKind; count?: number | null; short?: boolean }) {
  const k = CALENDAR_KIND[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${CHIP[kind]}`}>
      <span aria-hidden="true">{k.glyph}</span>{short ? null : k.word}{count ? <span className="tabular-nums"> {count}</span> : null}
    </span>
  );
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/individual/scholar/study-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, error: json.error };
  } catch { return { ok: false, error: "Competen could not be reached. Check your connection and try again." }; }
}

/** One item of a day: what it is, why, a link, and (where it can be moved) Move and Put back. */
function ItemRow({ item, date, today, accent }: { item: CalendarItem; date: string; today: string; accent: string }) {
  const router = useRouter();
  const uid = useId();
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState(date < today ? today : date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const horizon = addDays(today, CALENDAR_REACH_DAYS);
  async function run(body: unknown) {
    setBusy(true); setError("");
    const r = await post(body);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "That could not be saved just now."); return; }
    setMoving(false); router.refresh();
  }
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-gray-900">
            <Chip kind={item.kind} count={item.kind === "due_revision" ? null : item.count} />
            <span className="min-w-0 break-words">{item.title}</span>
            {item.minutes ? <span className="text-[12.5px] font-normal tabular-nums text-gray-600">{item.minutes} min</span> : null}
          </p>
          {item.detail && <p className="mt-0.5 text-[13px] text-gray-700">{item.detail}</p>}
          {item.movedFrom && <p className="mt-0.5 text-[12.5px] text-gray-700">Moved by you from {shortDay(item.movedFrom)}.</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {item.href && <Link href={item.href} className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[13.5px] font-semibold text-white hover:opacity-90 pointer-coarse:min-h-[48px] ${focusRing}`} style={{ background: accent }}>Open<span className="sr-only">: {item.title}</span></Link>}
          {item.movable && item.entry && <button type="button" className={secondary} disabled={busy} onClick={() => setMoving(m => !m)} aria-expanded={moving}>Move<span className="sr-only"> {item.title}</span></button>}
          {item.movable && item.entry && item.movedFrom && <button type="button" className={secondary} disabled={busy} onClick={() => run({ action: "restore", kind: item.entry!.kind, ref: item.entry!.ref })}>Put back<span className="sr-only"> {item.title}</span></button>}
        </div>
      </div>
      {moving && item.entry && (
        <form className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3" onSubmit={e => { e.preventDefault(); run({ action: "reschedule", kind: item.entry!.kind, ref: item.entry!.ref, originalDate: item.entry!.originalDate, scheduledDate: to }); }}>
          <div>
            <label htmlFor={`${uid}-d`} className="block text-[13px] font-semibold text-gray-800">Move to</label>
            <input id={`${uid}-d`} type="date" className={field} value={to} min={today} max={horizon} required onChange={e => setTo(e.target.value)} />
          </div>
          <button type="submit" className={secondary} disabled={busy || !to}>{busy ? "Saving…" : "Save the new day"}</button>
          <button type="button" className={secondary} disabled={busy} onClick={() => setMoving(false)}>Cancel</button>
          <p className="w-full text-[12.5px] text-gray-700">This moves the plan only. It never changes when a card is due.</p>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-[13px] font-semibold text-red-800">{error}</p>}
    </li>
  );
}

function DayItems({ day, today, accent }: { day: CalendarDay; today: string; accent: string }) {
  return day.items.length === 0
    ? <p className="text-[13.5px] text-gray-700">{day.date > today ? "Nothing is planned or due on this day." : "Nothing was recorded on this day."}</p>
    : <ul className="divide-y divide-gray-100">{day.items.map(i => <ItemRow key={i.key} item={i} date={day.date} today={today} accent={accent} />)}</ul>;
}

export function StudyCalendar({ view, accent, prevHref, nextHref, todayHref }: {
  view: CalendarView; accent: string;
  /** The Progress addresses of the neighbouring months and of this month, keeping the other parts of the query. */
  prevHref: string; nextHref: string; todayHref: string;
}) {
  const firstWithItems = view.days.find(d => d.today) ?? view.days.find(d => d.items.length) ?? view.days[0];
  const [selected, setSelected] = useState<string>(firstWithItems?.date ?? "");
  const day = view.days.find(d => d.date === selected) ?? firstWithItems;
  const agenda = view.days.filter(d => d.items.length > 0 || d.today);

  return (
    <section aria-labelledby="cal-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cal-h" className="text-[15px] font-bold text-gray-900">Study calendar</h2>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">A view of your study — not an assessment</span>
      </div>

      <nav aria-label="Calendar month" className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={prevHref} className={secondary} aria-label="Previous month">‹ Previous</Link>
        <p className="min-w-[10rem] text-center text-[15px] font-bold text-gray-900" aria-live="polite">{view.label}</p>
        <Link href={nextHref} className={secondary} aria-label="Next month">Next ›</Link>
        {view.month !== view.today.slice(0, 7) && <Link href={todayHref} className={secondary}>This month</Link>}
      </nav>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-gray-800" aria-label="What the marks mean">
        {(Object.keys(CALENDAR_KIND) as CalendarKind[]).map(k => <li key={k} className="inline-flex items-center gap-1.5"><Chip kind={k} short /> {CALENDAR_KIND[k].word}</li>)}
      </ul>
      {view.notes.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{view.notes.map(n => <li key={n}>{n}</li>)}</ul>}

      {/* tablet and desktop: the month grid, then the chosen day */}
      <div className="mt-3 hidden md:block">
        <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-semibold text-gray-600" aria-hidden="true">{WEEKDAYS.map(w => <div key={w}>{w}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {view.weeks.flat().map(d => {
            const kinds = [...new Set(d.items.map(i => i.kind))] as CalendarKind[];
            const on = d.date === day?.date;
            if (!d.inMonth) return <div key={d.date} className="min-h-[5.5rem] rounded-lg bg-gray-50/60" aria-hidden="true" />;
            return (
              <button key={d.date} type="button" onClick={() => setSelected(d.date)} aria-pressed={on}
                aria-label={`${longDay(d.date)}${d.today ? ", today" : ""}: ${d.items.length ? d.items.map(i => `${CALENDAR_KIND[i.kind].word} ${i.title}`).join("; ") : "nothing"}`}
                className={`flex min-h-[5.5rem] flex-col items-start gap-1 rounded-lg border p-1.5 text-left hover:bg-gray-50 ${on ? "border-gray-900 bg-gray-50" : "border-gray-200"} ${d.past ? "text-gray-600" : "text-gray-900"} ${focusRing}`}>
                <span className={`text-[13px] font-semibold tabular-nums ${d.today ? "rounded-full px-1.5 text-white" : ""}`} style={d.today ? { background: accent } : undefined}>{Number(d.date.slice(8, 10))}{d.today ? <span className="sr-only"> (today)</span> : null}</span>
                <span className="flex flex-wrap gap-1">
                  {kinds.slice(0, 3).map(k => {
                    const list = d.items.filter(i => i.kind === k);
                    return <Chip key={k} kind={k} count={k === "due_revision" ? list[0]?.count : list.length > 1 ? list.length : null} short />;
                  })}
                </span>
              </button>
            );
          })}
        </div>
        {day && (
          <div className="mt-3 rounded-xl border border-gray-200 p-3" aria-live="polite">
            <h3 className="text-[14px] font-bold text-gray-900">{longDay(day.date)}{day.today ? " (today)" : ""}</h3>
            <div className="mt-2"><DayItems day={day} today={view.today} accent={accent} /></div>
          </div>
        )}
      </div>

      {/* a phone: the agenda, days with something on them */}
      <div className="mt-3 md:hidden">
        {agenda.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 p-3 text-[13.5px] text-gray-700">Nothing is planned, due or recorded in {view.label}.</p> : (
          <ol className="space-y-3">
            {agenda.map(d => (
              <li key={d.date} className="rounded-xl border border-gray-200 p-3">
                <h3 className="text-[14px] font-bold text-gray-900">{longDay(d.date)}{d.today ? " (today)" : ""}</h3>
                <div className="mt-2"><DayItems day={d} today={view.today} accent={accent} /></div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
