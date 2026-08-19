"use client";

import { useState, type ReactNode } from "react";
import type { PlannerActivity, PlannerWeek } from "@/lib/practice/planner";
import { PLANNER_ACTIONS, DUPLICATE_DATE_CAP } from "@/lib/practice/planner-constants";
import { TimeInput } from "@/components/ui/wall-clock";
import { hhmm, minuteOfDay, shortDate, type LocationOption, type Notice, type RunAction } from "./planner-ui";

// s5's ACTIONS ON A PLANNED BLOCK.
//
// ⚠ THE BUTTON ROW IS RENDERED FROM PLANNER_ACTIONS, NOT TYPED OUT HERE, so a screen offering an action
// and an engine implementing one cannot drift apart. An action the constants declare but this screen has
// no control for is NAMED at the bottom rather than silently dropped -- the failure mode being avoided
// is a practitioner told an action exists by a specification and unable to find it.
//
// ⚠ NOTHING HERE DECIDES ANYTHING. Every guard -- a started block cannot be moved, a split must fall
// inside the window, a cancellation reason is at most 300 characters -- belongs to planner.ts, and its
// refusal is rendered word for word. Duplicating those rules in the browser is how a screen comes to
// refuse something the engine allows, or worse, to allow something it does not.

/** Every action key this screen has a control for, each bound to one exported engine function. */
const HANDLED: Record<string, true> = {
  move: true, duplicate: true, split: true, extend: true, shorten: true,
  cancel: true, change_location: true, add_notes: true,
};

// CPR-MOB-001 s8 ("Move activity -- tap Move/Edit; drag is optional, not required"): these tap
// controls ARE the mobile move story, so below md every one of them is thumb-height and every field
// is 16px (under 16px iOS zooms the page on focus -- s16). max-md:* no-ops; desktop is unchanged.
const BTN = "rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12px]";
const PRIMARY = "rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12px]";
const FIELD = "rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-800 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";

export default function ActivityActions({ activity: a, locations, week, busy, notice, run }: {
  activity: PlannerActivity;
  locations: LocationOption[];
  week: PlannerWeek;
  busy: boolean;
  notice: Notice;
  run: RunAction;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // CPR-PLAN-002 s5.2 (2026-08-16): the eight controls sit BEHIND one disclosure per block until the
  // block is the thing being worked on. Eight buttons under every block was a fifth of the day's
  // vertical height saying nothing; one "Actions" control says the same thing in one line. A refusal
  // or a result KEEPS the row open -- collapsing an error would eat the engine's answer.
  const [actionsOpen, setActionsOpen] = useState(false);
  const showActions = actionsOpen || notice !== null;

  const offered = PLANNER_ACTIONS.filter(x => x.implemented && HANDLED[x.key]);
  const declaredElsewhere = PLANNER_ACTIONS.filter(x => !HANDLED[x.key]);

  const go = (action: string, body: Record<string, unknown>) => run(action, { id: a.id, ...body }, a.id);

  if (!showActions) {
    return (
      <div className="mt-2 border-t border-gray-200/70 pt-2">
        <button type="button" aria-expanded={false} disabled={busy}
          onClick={() => setActionsOpen(true)}
          className={BTN}>
          Actions ⌄
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-gray-200/70 pt-2">
      <div className="flex flex-wrap gap-1.5">
        {/* Collapsing is refused, with the reason on the control, while an answer is showing -- folding
            the row would eat the engine's own words about what just happened. */}
        <button type="button" aria-expanded disabled={busy || notice !== null}
          title={notice !== null ? "The answer below stays visible until you act on this block again" : undefined}
          onClick={() => { setActionsOpen(false); setOpen(null); }}
          className={`${BTN} border-[var(--cp-primary)] text-[var(--cp-primary-deep)]`}>
          Actions ⌃
        </button>
        {offered.map(x => (
          <button key={x.key} type="button" disabled={busy}
            aria-expanded={open === x.key}
            onClick={() => setOpen(open === x.key ? null : x.key)}
            className={`${BTN} ${open === x.key ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]" : ""}`}>
            {x.label}
          </button>
        ))}
      </div>

      {open === "move" && <MoveForm a={a} busy={busy} go={go} />}
      {open === "duplicate" && <DuplicateForm a={a} week={week} busy={busy} go={go} />}
      {open === "split" && <SplitForm a={a} busy={busy} go={go} />}
      {open === "extend" && (
        <Row label="Run later by">
          {[15, 30, 60].map(n => (
            <button key={n} type="button" disabled={busy} className={BTN}
              onClick={() => go("extend", { byMinutes: n })}>+{n}m</button>
          ))}
        </Row>
      )}
      {open === "shorten" && (
        <Row label="Finish earlier by">
          {[15, 30, 60].map(n => (
            <button key={n} type="button" disabled={busy} className={BTN}
              onClick={() => go("shorten", { byMinutes: n })}>-{n}m</button>
          ))}
        </Row>
      )}
      {open === "cancel" && <CancelForm busy={busy} go={go} />}
      {open === "change_location" && <LocationForm a={a} locations={locations} busy={busy} go={go} />}
      {open === "add_notes" && <NotesForm a={a} busy={busy} go={go} />}

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-1.5 text-[12px] font-semibold ${notice.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}>
          {notice.message}
        </p>
      )}

      {declaredElsewhere.length > 0 && (
        <p className="mt-1.5 text-[11px] text-gray-400">
          Declared in the planner&apos;s action list but not on this screen yet:{" "}
          {declaredElsewhere.map(x => x.label).join(", ")}.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </div>
  );
}

function MoveForm({ a, busy, go }: { a: PlannerActivity; busy: boolean; go: (action: string, body: Record<string, unknown>) => void }) {
  const [date, setDate] = useState(a.planDate);
  const [start, setStart] = useState(hhmm(a.plannedStartMinute));
  const minute = minuteOfDay(start);
  return (
    <Row label="Move to">
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className={FIELD} aria-label="New date" />
      {/* The shared 24-hour control -- the owner's clock decision; see CalendarConsole. The pattern,
          keypad, tooltip and touch sizing live in TimeInput, not in a copy here. */}
      <TimeInput value={start} onChange={setStart} className={FIELD} ariaLabel="New start time" placeholder="09:00" />
      <button type="button" disabled={busy || minute === null} className={PRIMARY}
        onClick={() => go("move", { planDate: date, plannedStartMinute: minute })}>
        Move
      </button>
      {/* The engine keeps the duration when only the start changes -- that is what moving a block means. */}
      <span className="text-[11px] text-gray-400">keeps its length</span>
    </Row>
  );
}

/** Add `n` days to an ISO date without touching a Date object's local timezone. */
function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * s5's Duplicate.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS OFFERED SIX DATES AGAINST AN ENGINE THAT ACCEPTS 31, and the six were not a rule -- they were
 * whatever `week.days` happened to hold. Building a month of the same clinic meant five separate trips
 * through the planner, each one a page of navigation to reach the same block again. Nothing in
 * CPR-V5-005 asks for a one-week ceiling; the ceiling was the data source showing through the control.
 *
 * ⚠ AND THE FIX IS NOT 31 CHECKBOXES (CPR-PD-013 s8 says so in as many words). Three ways in, each
 * matching a real intention:
 *
 *   THE WEEK, as before -- "also Wednesday and Friday" stays one tap per day and is unchanged.
 *   A REPEAT -- "same weekday, next N weeks" is how a recurring clinic is actually described, and it
 *     is the case the old control could not express at all.
 *   A DATE -- one arbitrary date, for the cover shift that follows no pattern.
 *
 * ⚠ THE CAP IS SHOWN, NOT JUST ENFORCED. s8 asks for selected-count feedback and the effective
 * maximum, and a control that silently stops adding is a control that looks broken. The engine remains
 * the authority: it re-checks the cap, de-duplicates, and decides every date separately.
 *
 * ⚠ AND A BIG BATCH IS READ BACK BEFORE IT RUNS. s8's review summary. Past a handful the chips stop
 * being scannable, so the dates are listed in order with their count -- copying a block onto twelve
 * days is not something to discover afterwards from a toast.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
function DuplicateForm({ a, week, busy, go }: {
  a: PlannerActivity; week: PlannerWeek; busy: boolean; go: (action: string, body: Record<string, unknown>) => void;
}) {
  const [dates, setDates] = useState<string[]>([]);
  const [oneOff, setOneOff] = useState("");
  const [weeks, setWeeks] = useState(4);

  const atCap = dates.length >= DUPLICATE_DATE_CAP;
  // Never the source date, never a duplicate, never past the cap. The engine enforces all three too --
  // this is so the control behaves, not so the rule is decided here.
  const add = (incoming: string[]) => setDates(v => {
    const next = [...v];
    for (const d of incoming) {
      if (d === a.planDate || next.includes(d) || next.length >= DUPLICATE_DATE_CAP) continue;
      next.push(d);
    }
    return next.sort();
  });
  const toggle = (d: string) => setDates(v => v.includes(d) ? v.filter(x => x !== d) : [...v, d].sort());

  // "Same weekday, next N weeks" -- from the block's own date, so the weekday is inherently right.
  const repeatDates = Array.from({ length: weeks }, (_, i) => addDays(a.planDate, (i + 1) * 7));

  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Copy to</p>

      {/* 1. This week, unchanged. */}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {week.days.filter(d => d.date !== a.planDate).map(d => (
          <label key={d.date}
            className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12px] ${dates.includes(d.date)
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
              : "border-gray-200 text-gray-700"}`}>
            <input type="checkbox" className="sr-only" checked={dates.includes(d.date)} onChange={() => toggle(d.date)} />
            {d.weekdayShort} {shortDate(d.date)}
          </label>
        ))}
      </div>

      {/* 2. The repeat, and 3. any single date. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-gray-500">Repeat weekly</span>
        <select className={FIELD} value={weeks} disabled={busy}
          aria-label="How many weeks to repeat for"
          onChange={e => setWeeks(Number(e.target.value))}>
          {[2, 3, 4, 6, 8, 12].map(n => <option key={n} value={n}>{n} weeks</option>)}
        </select>
        <button type="button" className={BTN} disabled={busy || atCap}
          onClick={() => add(repeatDates)}>
          Add {weeks} &times; {week.days.find(d => d.date === a.planDate)?.weekdayShort ?? "same weekday"}
        </button>
        <span className="text-gray-300">|</span>
        <input type="date" className={FIELD} value={oneOff} disabled={busy}
          aria-label="Copy to a specific date"
          onChange={e => setOneOff(e.target.value)} />
        <button type="button" className={BTN} disabled={busy || !oneOff || atCap}
          onClick={() => { add([oneOff]); setOneOff(""); }}>
          Add date
        </button>
      </div>

      {/* The selection, its count and the maximum it is working against. */}
      {dates.length > 0 && (
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50/60 px-2 py-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold text-gray-700">
              {dates.length} of {DUPLICATE_DATE_CAP} date{dates.length === 1 ? "" : "s"} selected
            </span>
            <button type="button" className="text-[10.5px] font-semibold text-gray-500 hover:text-gray-800 hover:underline"
              disabled={busy} onClick={() => setDates([])}>
              Clear
            </button>
            {atCap && (
              <span className="text-[10.5px] text-[var(--cmp-text-critical)]">
                That is the most one copy can reach. Copy these, then repeat for the rest.
              </span>
            )}
          </div>
          {/* s8's review summary: past a handful, chips stop being readable and the list is read back. */}
          <p className="mt-1 text-[10.5px] leading-relaxed text-gray-600">
            {dates.length > 5
              ? <>Will copy onto: {dates.map(d => shortDate(d)).join(", ")}.</>
              : <>{dates.map(d => shortDate(d)).join(", ")}</>}
          </p>
        </div>
      )}

      <div className="mt-1.5">
        <button type="button" disabled={busy || dates.length === 0} className={PRIMARY}
          onClick={() => go("duplicate", { toDates: dates })}>
          Copy to {dates.length} date{dates.length === 1 ? "" : "s"}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-gray-400">
        Each date is decided on its own. A date that clashes is refused and named; the rest still copy.
      </p>
    </div>
  );
}

function SplitForm({ a, busy, go }: { a: PlannerActivity; busy: boolean; go: (action: string, body: Record<string, unknown>) => void }) {
  const [at, setAt] = useState(hhmm(Math.floor((a.plannedStartMinute + a.plannedEndMinute) / 2)));
  const [title, setTitle] = useState("");
  const minute = minuteOfDay(at);
  return (
    <Row label="Split at">
      <TimeInput value={at} onChange={setAt} className={FIELD} ariaLabel="Split time" placeholder="12:00" />
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="title of the second half"
        className={`${FIELD} min-w-[180px]`} aria-label="Title of the second half" />
      <button type="button" disabled={busy || minute === null} className={PRIMARY}
        onClick={() => go("split", { atMinute: minute, secondTitle: title })}>
        Split
      </button>
    </Row>
  );
}

function CancelForm({ busy, go }: { busy: boolean; go: (action: string, body: Record<string, unknown>) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Row label="Cancel because">
      <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="reason (optional)"
        className={`${FIELD} min-w-[220px]`} aria-label="Cancellation reason" />
      <button type="button" disabled={busy}
        className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50 max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12px]"
        onClick={() => go("cancel", { reason })}>
        Cancel this activity
      </button>
      {/* It stays on the week, struck through. CPR-CORE-001 s13: voided, never deleted. */}
      <span className="text-[11px] text-gray-400">it stays on the week, struck through</span>
    </Row>
  );
}

function LocationForm({ a, locations, busy, go }: {
  a: PlannerActivity; locations: LocationOption[]; busy: boolean;
  go: (action: string, body: Record<string, unknown>) => void;
}) {
  const [locationId, setLocationId] = useState(a.locationId ?? "");
  const [room, setRoom] = useState(a.room ?? "");
  return (
    <Row label="Move it to">
      <select value={locationId} onChange={e => setLocationId(e.target.value)} className={FIELD} aria-label="Location">
        <option value="">No location</option>
        {locations.map(l => (
          <option key={l.id} value={l.id}>{l.facility ? `${l.name} — ${l.facility}` : l.name}</option>
        ))}
      </select>
      <input type="text" value={room} onChange={e => setRoom(e.target.value)} placeholder="room"
        className={FIELD} aria-label="Room" />
      <button type="button" disabled={busy} className={PRIMARY}
        onClick={() => go("change_location", { locationId: locationId || null, room })}>
        Change location
      </button>
    </Row>
  );
}

function NotesForm({ a, busy, go }: { a: PlannerActivity; busy: boolean; go: (action: string, body: Record<string, unknown>) => void }) {
  const [notes, setNotes] = useState(a.notes ?? "");
  return (
    <div className="mt-2">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor={`notes-${a.id}`}>
        Notes
      </label>
      <textarea id={`notes-${a.id}`} value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        className={`${FIELD} mt-1 block w-full`} />
      <div className="mt-1 flex items-center gap-2">
        <button type="button" disabled={busy} className={PRIMARY} onClick={() => go("add_notes", { notes })}>
          Save note
        </button>
        <span className="text-[11px] text-gray-400">an empty note clears it</span>
      </div>
    </div>
  );
}
