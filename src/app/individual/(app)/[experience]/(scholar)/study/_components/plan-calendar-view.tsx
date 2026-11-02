"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CALENDAR_KIND, CALENDAR_REACH_DAYS } from "@/lib/individual/scholar/study-calendar-kinds";
import type { CalendarItem, CalendarView } from "@/lib/individual/scholar/study-calendar";
import { addDay, entryTypeLabel, type AgendaDay, type LinkOption } from "@/lib/individual/scholar/plan-view";
import { StudyCalendar } from "./study-calendar";
import { AddActivity, EntryActions, whenLine } from "./plan-entries";
import { cardCls, fieldCls, labelCls, primaryBtn, secondaryBtn } from "./plan-style";
import { ErrorLine, PlanDialog, ScholarPlanChip, YourEntryChip, callJson, errorOf } from "./plan-ui";

// MY PLAN -> CALENDAR (PLP-01..04, owner GO "My Plan Calendar Enhancement"). A 7-day agenda by default, day by day (one column on a phone, no
// sideways scroll); "Month" shows the existing month calendar. The learner's own entries carry a "Your entry" chip and a person icon, Scholar's
// plan a "Scholar plan" chip and a sparkle: the word always shows, colour is never the only cue. Scholar activities are opened and moved (the
// existing calendar route); the learner's entries are edited, moved, marked done and deleted here and never touched by Scholar.
// A view of records and choices. Not an assessment.

const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const KIND_CHIP: Record<Exclude<CalendarItem["kind"], "personal" | "planned">, string> = {
  due_revision: "border-green-300 bg-green-50 text-green-900",
  completed: "border-gray-300 bg-gray-50 text-gray-800",
  monthly_review: "border-amber-300 bg-amber-50 text-amber-900",
};

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

function AgendaItem({ item, date, today, accent, links }: { item: CalendarItem; date: string; today: string; accent: string; links: readonly LinkOption[] }) {
  const occ = item.occurrence ?? null;
  const personal = item.kind === "personal" && occ;
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-kind={item.kind}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-gray-900">
            {personal ? <YourEntryChip /> : item.kind === "planned"
              ? <ScholarPlanChip />
              : <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${KIND_CHIP[item.kind as keyof typeof KIND_CHIP]}`}><span aria-hidden>{CALENDAR_KIND[item.kind].glyph}</span>{CALENDAR_KIND[item.kind].word}</span>}
            <span className="min-w-0 break-words">{item.title}</span>
            {item.minutes ? <span className="text-[12.5px] font-normal tabular-nums text-gray-600">{item.minutes} min</span> : null}
          </p>
          {personal && occ && (
            <p className="mt-0.5 text-[13px] text-gray-700">
              {entryTypeLabel(occ.entryType)} · {whenLine(occ)}
              {occ.link ? ` · about ${occ.link.label}` : ""}
              {occ.recurring ? " · repeats" : ""}
              {occ.moved ? " · moved" : ""}
            </p>
          )}
          {personal && occ?.status === "completed" && <p className="mt-0.5 text-[12.5px] font-semibold text-gray-800">Done (self-reported: your word, not recorded learning)</p>}
          {personal && occ?.description && <p className="mt-0.5 break-words text-[13px] text-gray-700">{occ.description}</p>}
          {!personal && item.detail && <p className="mt-0.5 text-[13px] text-gray-700">{item.detail}</p>}
          {!personal && item.movedFrom && <p className="mt-0.5 text-[12.5px] text-gray-700">Moved by you from {shortDay(item.movedFrom)}.</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {personal && occ ? <EntryActions occ={occ} today={today} links={links} accent={accent} /> : <ScholarActions item={item} date={date} today={today} accent={accent} />}
        </div>
      </div>
    </li>
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

export function PlanAgenda(p: CalendarPanelProps) {
  const first = p.days[0]?.date ?? p.today, last = p.days[p.days.length - 1]?.date ?? p.today;
  return (
    <section aria-labelledby="plan-agenda-h" className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="plan-agenda-h" className="text-[16px] font-bold text-gray-900">{shortDay(first)} to {shortDay(last)}</h2>
        <div className="flex flex-wrap gap-2">
          {p.canAdd && <AddActivity accent={p.accent} today={p.today} links={p.links} />}
          <Link href={p.monthHref} className={secondaryBtn}>Month</Link>
        </div>
      </div>
      <nav aria-label="Week" className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={p.prevHref} className={secondaryBtn}>‹ Earlier</Link>
        {p.thisWeekHref && <Link href={p.thisWeekHref} className={secondaryBtn}>Today</Link>}
        <Link href={p.nextHref} className={secondaryBtn}>Later ›</Link>
      </nav>
      <Legend />
      <Notes notes={p.notes} unattached={p.unattached} />
      <ol className="mt-3 space-y-3">
        {p.days.map(d => (
          <li key={d.date} className={`rounded-xl border p-3 ${d.today ? "border-gray-900" : "border-gray-200"}`}>
            <h3 className="text-[14.5px] font-bold text-gray-900">{longDay(d.date)}{d.today ? " (today)" : ""}</h3>
            {d.items.length === 0
              ? <p className="mt-1 text-[13.5px] text-gray-600">{d.past ? "Nothing was recorded on this day." : "Nothing planned or due."}</p>
              : <ul className="mt-2 divide-y divide-gray-100">{d.items.map(i => <AgendaItem key={i.key} item={i} date={d.date} today={p.today} accent={p.accent} links={p.links} />)}</ul>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-gray-800" aria-label="What the marks mean">
      <li className="inline-flex items-center gap-1.5"><YourEntryChip /> you added it</li>
      <li className="inline-flex items-center gap-1.5"><ScholarPlanChip /> planned from your practice</li>
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

/** The existing month calendar, with the learner's own entries actionable and the Add activity button above it. */
export function PlanMonth({ view, accent, prevHref, nextHref, todayHref, weekHref, canAdd, links }: {
  view: CalendarView; accent: string; prevHref: string; nextHref: string; todayHref: string; weekHref: string; canAdd: boolean; links: readonly LinkOption[];
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {canAdd && <AddActivity accent={accent} today={view.today} links={links} />}
        <Link href={weekHref} className={secondaryBtn}>Back to 7 days</Link>
      </div>
      <StudyCalendar view={view} accent={accent} prevHref={prevHref} nextHref={nextHref} todayHref={todayHref} title="Month"
        entryActions={item => (item.kind === "personal" && item.occurrence ? <EntryActions occ={item.occurrence} today={view.today} links={links} accent={accent} /> : null)} />
      <UnattachedMonth view={view} />
    </div>
  );
}
function UnattachedMonth({ view }: { view: CalendarView }) {
  return view.unattached.length ? <Notes notes={[]} unattached={view.unattached} /> : null;
}
