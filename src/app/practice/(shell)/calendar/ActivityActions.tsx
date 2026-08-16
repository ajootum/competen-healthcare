"use client";

import { useState, type ReactNode } from "react";
import type { PlannerActivity, PlannerWeek } from "@/lib/practice/planner";
import { PLANNER_ACTIONS } from "@/lib/practice/planner-constants";
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

const BTN = "rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const PRIMARY = "rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const FIELD = "rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-800";

export default function ActivityActions({ activity: a, locations, week, busy, notice, run }: {
  activity: PlannerActivity;
  locations: LocationOption[];
  week: PlannerWeek;
  busy: boolean;
  notice: Notice;
  run: RunAction;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const offered = PLANNER_ACTIONS.filter(x => x.implemented && HANDLED[x.key]);
  const declaredElsewhere = PLANNER_ACTIONS.filter(x => !HANDLED[x.key]);

  const go = (action: string, body: Record<string, unknown>) => run(action, { id: a.id, ...body }, a.id);

  return (
    <div className="mt-2 border-t border-gray-200/70 pt-2">
      <div className="flex flex-wrap gap-1.5">
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
      {/* 24-hour text entry -- the owner's clock decision; see CalendarConsole. */}
      <input value={start} onChange={e => setStart(e.target.value)} className={FIELD} aria-label="New start time"
        pattern="^([01]?d|2[0-3]):[0-5]d$" placeholder="09:00" inputMode="numeric"
        title="24-hour clock, HH:MM -- for example 09:00 or 14:30" />
      <button type="button" disabled={busy || minute === null} className={PRIMARY}
        onClick={() => go("move", { planDate: date, plannedStartMinute: minute })}>
        Move
      </button>
      {/* The engine keeps the duration when only the start changes -- that is what moving a block means. */}
      <span className="text-[11px] text-gray-400">keeps its length</span>
    </Row>
  );
}

function DuplicateForm({ a, week, busy, go }: {
  a: PlannerActivity; week: PlannerWeek; busy: boolean; go: (action: string, body: Record<string, unknown>) => void;
}) {
  const [dates, setDates] = useState<string[]>([]);
  const toggle = (d: string) => setDates(v => v.includes(d) ? v.filter(x => x !== d) : [...v, d]);
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Copy to</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {week.days.filter(d => d.date !== a.planDate).map(d => (
          <label key={d.date}
            className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${dates.includes(d.date)
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
              : "border-gray-200 text-gray-700"}`}>
            <input type="checkbox" className="sr-only" checked={dates.includes(d.date)} onChange={() => toggle(d.date)} />
            {d.weekdayShort} {shortDate(d.date)}
          </label>
        ))}
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
      <input value={at} onChange={e => setAt(e.target.value)} className={FIELD} aria-label="Split time"
        pattern="^([01]?d|2[0-3]):[0-5]d$" placeholder="12:00" inputMode="numeric"
        title="24-hour clock, HH:MM -- for example 09:00 or 14:30" />
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
        className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
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
