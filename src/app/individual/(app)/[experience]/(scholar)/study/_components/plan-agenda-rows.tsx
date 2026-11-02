"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { CALENDAR_REACH_DAYS } from "@/lib/individual/scholar/study-calendar-kinds";
import type { CalendarItem } from "@/lib/individual/scholar/study-calendar";
import { addDay, type LinkOption } from "@/lib/individual/scholar/plan-view";
import { planRefOfKey, startHref } from "@/lib/individual/scholar/plan-today-view";
import { doneAtOfKey, groupCompleted, groupTitle, isDuePlanItem, rowIconKind, rowSubtitle, rowWhen, type DayRow } from "@/lib/individual/scholar/plan-workspace";
import { EntryActions } from "./plan-entries";
import { fieldCls, focusRing, labelCls, menuItemCls, pillOutline, pillPrimary, primaryBtn, secondaryBtn, whenChipCls } from "./plan-style";
import { ChevronIcon, ClockIcon, ErrorLine, PlanDialog, RowIcon, RowMenu, callJson, errorOf } from "./plan-ui";

// MY PLAN -> THE ROWS OF ONE DAY (CE-03 mobile-first), shared by the Calendar's selected-day panel and Today. A row: a round tinted icon, the title,
// a muted line (what it is and its status), the length in a small clock chip, then ONE main action (Start / Open for Scholar's items, Edit for the
// learner's own) and a small menu for the rest. Completed records of the same material and kind fold into one row with a disclosure (display only:
// every record keeps its own key and link). Every action is one that already exists (the calendar move route, the plan decision route, the entry routes).

const CAL_API = "/api/individual/scholar/study-calendar";
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** True once the page is on the device: times of day are the learner's own local time, which the server cannot know. */
const subscribeNone = () => () => {};
export const useOnDevice = () => useSyncExternalStore(subscribeNone, () => true, () => false);
const timeOf = (at: string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Move a Scholar activity or the monthly review (the existing calendar route), as a small dialog. */
export function ScholarMove({ item, date, today, accent, onClose }: { item: CalendarItem; date: string; today: string; accent: string; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [to, setTo] = useState(date < today ? today : date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(body: unknown) {
    setBusy(true); setError("");
    const r = await callJson(CAL_API, "POST", body);
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

/** Scholar's own item: Start / Open, and (for a suggestion) a Change menu: Move, Postpone, Something else, Not this. */
function ScholarActions({ item, date, today, accent, studyId, canDecide, elseHref, onError }: {
  item: CalendarItem; date: string; today: string; accent: string; studyId: string | null; canDecide: boolean; elseHref: string; onError: (m: string) => void;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const planned = item.kind === "planned";
  const canMove = item.movable && !!item.entry;
  const next = addDay(date < today ? today : date, 1);
  const canPostpone = canMove && next <= addDay(today, CALENDAR_REACH_DAYS);
  const ref = planRefOfKey(item.key);
  const href = startHref(item.href, studyId);
  const open = item.kind === "due_revision" || isDuePlanItem(item);

  async function call(url: string, body: unknown) {
    setBusy(true); onError("");
    const r = await callJson(url, "POST", body);
    setBusy(false);
    if (!r.ok) { onError(errorOf(r)); return; }
    router.refresh();
  }
  const e = item.entry;
  const hasMenu = planned || canMove;
  return (
    <>
      {href && <Link href={href} className={pillPrimary} style={{ background: accent }}>{open ? "Open" : "Start"}<span className="sr-only">: {item.title}</span></Link>}
      {hasMenu && (
        <RowMenu label={`Change: ${item.title}`} trigger="change">
          {canMove && <button type="button" className={menuItemCls} onClick={() => setMoving(true)}>Move</button>}
          {canPostpone && e && <button type="button" className={menuItemCls} disabled={busy} onClick={() => void call(CAL_API, { action: "reschedule", kind: e.kind, ref: e.ref, originalDate: e.originalDate, scheduledDate: next })}>Postpone to tomorrow</button>}
          {planned && <Link href={elseHref} className={menuItemCls}>Something else</Link>}
          {planned && canDecide && ref && <button type="button" className={menuItemCls} disabled={busy} onClick={() => void call("/api/individual/scholar/plan/decision", { kind: "recommendation_declined", ref })}>Not this</button>}
        </RowMenu>
      )}
      {moving && <ScholarMove item={item} date={date} today={today} accent={accent} onClose={() => setMoving(false)} />}
    </>
  );
}

export type RowsContext = {
  date: string; today: string; accent: string; links: readonly LinkOption[]; studyId: string | null;
  /** The plan can remember "Not this" (migration 840). */
  canDecide: boolean;
  /** Where "Something else" goes: Today, which lists the alternatives. */
  elseHref: string;
};

/** The frame of a row: icon, text, and a group of chip and actions that sits beside the text, or on its own line under it on a narrow container. */
function RowFrame({ icon, title, sub, chip, children, error }: { icon: React.ReactNode; title: string; sub: string; chip?: string; children?: React.ReactNode; error?: string }) {
  return (
    <>
      <div className="flex min-w-0 flex-1 basis-44 items-start gap-3">
        {icon}
        <div className="min-w-0">
          <p className="break-words text-[15px] font-bold leading-snug text-gray-900">{title}</p>
          {sub && <p className="truncate text-[13px] text-gray-600">{sub}</p>}
        </div>
      </div>
      <div className="flex w-full items-center justify-end gap-2 @sm:w-auto">
        {chip ? <span className={whenChipCls}><ClockIcon size={13} />{chip}</span> : null}
        {children}
      </div>
      {error ? <div className="w-full"><ErrorLine text={error} /></div> : null}
    </>
  );
}

function ItemRow({ item, ctx }: { item: CalendarItem; ctx: RowsContext }) {
  const [error, setError] = useState("");
  const occ = item.kind === "personal" ? item.occurrence ?? null : null;
  const chip = rowWhen(item);
  return (
    <li data-kind={item.kind} data-key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 py-3 last:border-b-0">
      <RowFrame icon={<RowIcon kind={rowIconKind(item)} />} title={item.title} sub={rowSubtitle(item, ctx.date)} chip={chip} error={error}>
        {occ ? (
          <>
            <EntryActions occ={occ} today={ctx.today} links={ctx.links} accent={ctx.accent} part="edit" />
            <EntryActions occ={occ} today={ctx.today} links={ctx.links} accent={ctx.accent} part="menu" />
          </>
        ) : item.kind === "completed" ? (
          item.href ? <Link href={startHref(item.href, ctx.studyId) ?? item.href} className={pillPrimary} style={{ background: ctx.accent }}>Open<span className="sr-only">: {item.title}</span></Link> : null
        ) : (
          <ScholarActions item={item} date={ctx.date} today={ctx.today} accent={ctx.accent} studyId={ctx.studyId} canDecide={ctx.canDecide} elseHref={ctx.elseHref} onError={setError} />
        )}
      </RowFrame>
    </li>
  );
}

/** Completed records of one material and kind, as one row with a disclosure listing each (a time and a link). Nothing is merged: every record is listed. */
export function DoneGroup<T extends { key: string; title: string; href: string | null }>({ row, studyId }: { row: Extract<DayRow<T>, { type: "group" }>; studyId: string | null }) {
  const onDevice = useOnDevice();
  return (
    <li data-group={row.key} className="border-b border-gray-100 py-1 last:border-b-0">
      <details className="group">
        <summary className={`flex min-h-12 cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden ${focusRing}`}>
          <RowIcon kind="done" />
          <span className="min-w-0 flex-1 break-words text-[15px] font-bold leading-snug text-gray-900">{groupTitle(row.title, row.kind, row.count)}</span>
          <span className="text-gray-600 transition-transform group-open:rotate-180"><ChevronIcon dir="down" size={18} /></span>
        </summary>
        <ul className="mb-2 ml-12 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {row.items.map((r, n) => {
            const at = doneAtOfKey(r.key);
            const href = r.href ? startHref(r.href, studyId) ?? r.href : null;
            return (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13.5px] text-gray-800">
                <span className="tabular-nums">{at && onDevice ? timeOf(at) : `Session ${n + 1}`}</span>
                {href && <Link href={href} className={`${pillOutline} min-h-9`}>Open<span className="sr-only"> session {n + 1}: {r.title}</span></Link>}
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

/** One day's items as rows: completed records folded, everything else one row each. */
export function AgendaRows({ items, ctx }: { items: readonly CalendarItem[]; ctx: RowsContext }) {
  const completed = items.filter(i => i.kind === "completed");
  const rows = groupCompleted(completed);
  const others = items.filter(i => i.kind !== "completed");
  return (
    <ul className="@container" data-testid="agenda-rows">
      {others.map(i => <ItemRow key={i.key} item={i} ctx={ctx} />)}
      {rows.map(r => (r.type === "group" ? <DoneGroup key={r.key} row={r} studyId={ctx.studyId} /> : <ItemRow key={r.item.key} item={r.item} ctx={ctx} />))}
    </ul>
  );
}

/** Notes the calendar carries, and moves that match no current activity (offered for removal). */
export function Notes({ notes, unattached }: { notes: string[]; unattached: { ref: string; originalDate: string | null; scheduledDate: string | null }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function remove(ref: string) {
    setBusy(ref); setError("");
    const r = await callJson(CAL_API, "POST", { action: "restore", kind: "plan_activity", ref });
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

export { longDay };
