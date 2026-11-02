"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CALENDAR_KIND, CALENDAR_REACH_DAYS } from "@/lib/individual/scholar/study-calendar-kinds";
import type { CalendarItem, CalendarView } from "@/lib/individual/scholar/study-calendar";
import { addDay, agendaTone, dayParts, entryTypeLabel, isAvailableDay, rangeLabel, whenLabel, type AgendaDay, type AgendaTone, type LinkOption } from "@/lib/individual/scholar/plan-view";
import { StudyCalendar } from "./study-calendar";
import { AddActivity, EntryActions } from "./plan-entries";
import { cardCls, fieldCls, focusRing, labelCls, primaryBtn, quietBtn, secondaryBtn } from "./plan-style";
import { CalendarOffIcon, CheckIcon, ErrorLine, PersonIcon, PlanDialog, ScholarPlanChip, SparkleIcon, YourEntryChip, callJson, errorOf } from "./plan-ui";

// MY PLAN -> CALENDAR (PLP-01..04, owner GO "My Plan Calendar Enhancement"). A 7-day agenda by default, day by day (one column on a phone, no
// sideways scroll); "Month" shows the existing month calendar. The learner's own entries carry a "Your entry" chip and a person icon, Scholar's
// plan a "Scholar plan" chip and a sparkle: the word always shows, colour is never the only cue. Scholar activities are opened and moved (the
// existing calendar route); the learner's entries are edited, moved, marked done and deleted here and never touched by Scholar.
// A view of records and choices. Not an assessment.

const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Move a Scholar activity or the monthly review (the existing calendar route), as a small dialog. */
function ScholarMove({ item, date, today, accent, onClose }: { item: CalendarItem; date: string; today: string; accent: string; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [to, setTo] = useState(date < today ? today : date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(body: unknown) {
    setBusy(true); setError("");
    const r = await callJson("/api/individual/scholar/study-calendar", "POST", body);
    setBusy(false);
    if (!r.ok) { setError(errorOf(r)); return; }
    onClose(); router.refresh();
  }
  const e = item.entry!;
  return (
    <PlanDialog title={`Move: ${item.title}`} onClose={onClose}>
      <form onSubmit={ev => { ev.preventDefault(); void save({ action: "reschedule", kind: e.kind, ref: e.ref, originalDate: e.originalDate, scheduledDate: to }); }}>
        <label htmlFor={`${uid}-d`} className={labelCls}>Move to</label>
        <input id={`${uid}-d`} type="date" className={`${fieldCls} max-w-xs`} value={to} min={today} max={addDay(today, CALENDAR_REACH_DAYS)} required onChange={ev => setTo(ev.target.value)} />
        <p className="mt-1 text-[12.5px] text-gray-600">This moves the plan only. It never changes when a card is due.</p>
        <div className="mt-3"><ErrorLine text={error} /></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} style={{ background: accent }} disabled={busy}>{busy ? "Saving…" : "Save the new day"}</button>
          {item.movedFrom && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void save({ action: "restore", kind: e.kind, ref: e.ref })}>Put back</button>}
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </PlanDialog>
  );
}

function ScholarActions({ item, date, today, accent }: { item: CalendarItem; date: string; today: string; accent: string }) {
  const [moving, setMoving] = useState(false);
  return (
    <>
      {item.href && <Link href={item.href} className={`${secondaryBtn}`}>Open<span className="sr-only">: {item.title}</span></Link>}
      {item.movable && item.entry && <button type="button" className={secondaryBtn} onClick={() => setMoving(true)}>Move<span className="sr-only">: {item.title}</span></button>}
      {moving && <ScholarMove item={item} date={date} today={today} accent={accent} onClose={() => setMoving(false)} />}
    </>
  );
}

const TONE_ROW: Record<AgendaTone, string> = {
  mine: "border-transparent bg-[var(--cmp-role-indigo-soft)]",
  scholar: "border-transparent bg-gray-100",
  unavailable: "border-transparent bg-amber-50",
  done: "border-gray-200 bg-white",
};
const TONE_WORD: Record<AgendaTone, string> = { mine: "Your activity", scholar: "Scholar recommendation", unavailable: "Unavailable", done: "Done" };
function ToneIcon({ tone }: { tone: AgendaTone }) {
  return tone === "mine" ? <PersonIcon size={18} /> : tone === "unavailable" ? <CalendarOffIcon size={18} /> : tone === "done" ? <CheckIcon size={18} /> : <SparkleIcon size={18} />;
}

/** The second line of a row: when and how long ("7:00 PM · 30 min"), else a short word for the kind. */
function rowLine(item: CalendarItem): string {
  const occ = item.occurrence ?? null;
  if (occ) return [whenLabel(occ), occ.status === "completed" ? "Done (self-reported)" : ""].filter(Boolean).join(" · ");
  return whenLabel({ minutes: item.minutes }) || (item.kind === "completed" ? "Done" : item.kind === "monthly_review" ? "Optional" : "");
}

/** One item of a day, as a tinted row the learner can open: title, when and how long, and a mark on the right for whose it is. */
function AgendaRow({ item, onOpen }: { item: CalendarItem; onOpen: () => void }) {
  const tone = agendaTone(item);
  const line = rowLine(item);
  return (
    <li data-kind={item.kind} data-tone={tone}>
      <button type="button" onClick={onOpen} aria-haspopup="dialog"
        className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left hover:brightness-[0.97] pointer-coarse:min-h-[var(--cmp-touch-min)] ${TONE_ROW[tone]} ${focusRing}`}>
        <span className="min-w-0">
          <span className="block break-words text-[15px] font-semibold text-gray-900">{item.title}</span>
          {line && <span className="block text-[13px] text-gray-700">{line}</span>}
          <span className="sr-only"> {TONE_WORD[tone]}. Open details.</span>
        </span>
        <span className="text-gray-700" title={TONE_WORD[tone]}><ToneIcon tone={tone} /></span>
      </button>
    </li>
  );
}

/** The details of one item: what it is, when, and the actions that already exist (edit, move, mark done and delete for the learner's own; open and move for Scholar's). */
function ItemDetails({ item, date, today, accent, links, onClose }: { item: CalendarItem; date: string; today: string; accent: string; links: readonly LinkOption[]; onClose: () => void }) {
  const occ = item.occurrence ?? null;
  const personal = item.kind === "personal" && occ;
  const tone = agendaTone(item);
  return (
    <PlanDialog title={item.title} onClose={onClose}>
      <p className="flex flex-wrap items-center gap-2 text-[13.5px] text-gray-800">
        {personal ? <YourEntryChip /> : item.kind === "planned" ? <ScholarPlanChip /> : <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11.5px] font-semibold text-gray-800"><ToneIcon tone={tone} />{CALENDAR_KIND[item.kind].word}</span>}
        <span>{longDay(date)}</span>
      </p>
      {personal && occ ? (
        <div className="mt-2 space-y-1 text-[14px] text-gray-800">
          <p>{entryTypeLabel(occ.entryType)} · {whenLabel(occ)}{occ.link ? ` · about ${occ.link.label}` : ""}{occ.recurring ? " · repeats" : ""}{occ.moved ? " · moved" : ""}</p>
          {occ.status === "completed" && <p className="font-semibold">Done (self-reported: your word, not recorded learning)</p>}
          {occ.description && <p className="break-words">{occ.description}</p>}
        </div>
      ) : (
        <div className="mt-2 space-y-1 text-[14px] text-gray-800">
          {item.minutes ? <p>{item.minutes} minutes</p> : null}
          {item.detail && <p>{item.detail}</p>}
          {item.movedFrom && <p className="text-[13px]">Moved by you from {shortDay(item.movedFrom)}.</p>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {personal && occ ? <EntryActions occ={occ} today={today} links={links} accent={accent} /> : <ScholarActions item={item} date={date} today={today} accent={accent} />}
        <button type="button" className={secondaryBtn} onClick={onClose}>Close</button>
      </div>
    </PlanDialog>
  );
}

export type CalendarPanelProps = {
  accent: string; today: string;
  days: AgendaDay[];
  /** Addresses of the neighbouring weeks, this week, and the month view. */
  prevHref: string; nextHref: string; thisWeekHref: string | null; monthHref: string;
  /** The learner's own entries can be added (migration 840's calendar tables are present). */
  canAdd: boolean;
  links: readonly LinkOption[];
  notes: string[];
  unattached: { ref: string; originalDate: string | null; scheduledDate: string | null }[];
};

/** Week | Month: a segmented control of two real links, the current one marked (aria-current, a raised surface), at least the touch minimum. */
function SpanToggle({ current, weekHref, monthHref }: { current: "week" | "month"; weekHref: string; monthHref: string }) {
  const cls = (on: boolean) => `flex min-h-[44px] w-full items-center justify-center rounded-full px-4 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`;
  return (
    <nav aria-label="Calendar span" className="mt-3">
      <ul className="grid grid-cols-2 gap-1 rounded-full bg-gray-100 p-1">
        <li className="flex"><Link href={weekHref} aria-current={current === "week" ? "page" : undefined} className={cls(current === "week")}>Week</Link></li>
        <li className="flex"><Link href={monthHref} aria-current={current === "month" ? "page" : undefined} className={cls(current === "month")}>Month</Link></li>
      </ul>
    </nav>
  );
}

export function PlanAgenda(p: CalendarPanelProps) {
  const first = p.days[0]?.date ?? p.today, last = p.days[p.days.length - 1]?.date ?? p.today;
  // The details open for one item. They close by themselves once the page refreshes with new days (after an edit, a move, a delete).
  const [opened, setOpened] = useState<{ key: string; date: string; days: AgendaDay[] } | null>(null);
  const shownDay = opened && opened.days === p.days ? p.days.find(d => d.date === opened.date) : undefined;
  const shown = shownDay?.items.find(i => i.key === opened?.key) ?? null;
  return (
    <section aria-labelledby="plan-agenda-h" className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="plan-agenda-h" className="text-[22px] font-bold leading-tight text-gray-900">Calendar</h2>
          <p className="text-[13.5px] text-gray-700">{rangeLabel(first, last)}</p>
        </div>
        {p.canAdd && <AddActivity accent={p.accent} today={p.today} links={p.links} />}
      </div>
      <SpanToggle current="week" weekHref={p.thisWeekHref ?? "#"} monthHref={p.monthHref} />
      <nav aria-label="Week" className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={p.prevHref} className={quietBtn}>‹ Earlier</Link>
        {p.thisWeekHref && <Link href={p.thisWeekHref} className={quietBtn}>Today</Link>}
        <Link href={p.nextHref} className={quietBtn}>Later ›</Link>
      </nav>
      <Notes notes={p.notes} unattached={p.unattached} />
      <ol className="mt-4 space-y-3">
        {p.days.map(d => {
          const parts = dayParts(d.date);
          return (
            <li key={d.date} className="flex gap-3" data-day={d.date}>
              <div className={`w-11 shrink-0 pt-2 text-center ${d.today ? "text-gray-900" : "text-gray-700"}`} aria-hidden>
                <p className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[17px] font-bold tabular-nums ${d.today ? "bg-gray-900 text-white" : ""}`}>{parts.num}</p>
                <p className="text-[12px]">{parts.weekday}</p>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="sr-only">{longDay(d.date)}{d.today ? " (today)" : ""}</h3>
                {isAvailableDay(d)
                  ? <p className="flex min-h-[48px] items-center rounded-xl border border-dashed border-gray-300 px-4 text-[13.5px] text-gray-600" data-testid="agenda-available">{d.past ? "Nothing recorded" : "Available"}</p>
                  : <ul className="space-y-2">{d.items.map(i => <AgendaRow key={i.key} item={i} onOpen={() => setOpened({ key: i.key, date: d.date, days: p.days })} />)}</ul>}
              </div>
            </li>
          );
        })}
      </ol>
      <Legend />
      {shown && opened && <ItemDetails item={shown} date={opened.date} today={p.today} accent={p.accent} links={p.links} onClose={() => setOpened(null)} />}
    </section>
  );
}

function Legend() {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-gray-800" aria-label="What the marks mean" data-testid="agenda-legend">
      <li className="inline-flex items-center gap-1.5"><PersonIcon />My activities</li>
      <li className="inline-flex items-center gap-1.5"><SparkleIcon />Scholar recommendations</li>
      <li className="inline-flex items-center gap-1.5"><CalendarOffIcon size={14} />Unavailable</li>
      <li className="inline-flex items-center gap-1.5"><CheckIcon size={14} />Done</li>
    </ul>
  );
}

function Notes({ notes, unattached }: { notes: string[]; unattached: CalendarPanelProps["unattached"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function remove(ref: string) {
    setBusy(ref); setError("");
    const r = await callJson("/api/individual/scholar/study-calendar", "POST", { action: "restore", kind: "plan_activity", ref });
    setBusy("");
    if (!r.ok) { setError(errorOf(r)); return; }
    router.refresh();
  }
  const rest = notes.filter(n => !/earlier move could not be matched/i.test(n));
  if (!rest.length && !unattached.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {rest.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{rest.map(n => <li key={n}>{n}</li>)}</ul>}
      {unattached.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[13px] font-semibold text-amber-950">An earlier move could not be matched to a current activity, so it is not applied to anything. You can remove it.</p>
          <ul className="mt-1 space-y-1">
            {unattached.map(u => (
              <li key={u.ref} className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-amber-950">
                <span>Moved{u.originalDate ? ` from ${shortDay(u.originalDate)}` : ""}{u.scheduledDate ? ` to ${shortDay(u.scheduledDate)}` : ""}</span>
                <button type="button" className={secondaryBtn} disabled={busy === u.ref} onClick={() => void remove(u.ref)}>Remove<span className="sr-only"> this move</span></button>
              </li>
            ))}
          </ul>
          <ErrorLine text={error} />
        </div>
      )}
    </div>
  );
}

/** The existing month calendar, with the learner's own entries actionable, the Add activity button above it and the same Week | Month toggle. */
export function PlanMonth({ view, accent, prevHref, nextHref, todayHref, weekHref, canAdd, links }: {
  view: CalendarView; accent: string; prevHref: string; nextHref: string; todayHref: string; weekHref: string; canAdd: boolean; links: readonly LinkOption[];
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <h2 className="text-[22px] font-bold leading-tight text-gray-900">Calendar</h2>
          <p className="text-[13.5px] text-gray-700">{view.label}</p>
        </div>
        {canAdd && <AddActivity accent={accent} today={view.today} links={links} />}
      </div>
      <div className="mb-3 px-1"><SpanToggle current="month" weekHref={weekHref} monthHref="#" /></div>
      <StudyCalendar view={view} accent={accent} prevHref={prevHref} nextHref={nextHref} todayHref={todayHref} title="Month"
        entryActions={item => (item.kind === "personal" && item.occurrence ? <EntryActions occ={item.occurrence} today={view.today} links={links} accent={accent} /> : null)} />
      <UnattachedMonth view={view} />
    </div>
  );
}
function UnattachedMonth({ view }: { view: CalendarView }) {
  return view.unattached.length ? <Notes notes={[]} unattached={view.unattached} /> : null;
}
