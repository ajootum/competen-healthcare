"use client";

import { ACTIVITY_TYPES } from "@/lib/practice/activity-constants";
import { PLANNER_QUICK_ACTIONS, activityLabel } from "@/lib/practice/planner-constants";
import { minuteOfDay, type LocationOption, type Notice } from "./planner-ui";

// s9's ADD ACTIVITY, and what every Quick Action opens.
//
// AN INLINE PANEL RATHER THAN A DIALOG, deliberately. A modal owes the reader focus trapping, a labelled
// role, an escape route and a restored focus target; an inline panel in the column it belongs to owes
// none of that and loses nothing, because nothing behind it is disabled while it is open.
//
// ⚠ THE TYPE LIST IS THE UNION OF WHAT THE SCHEMA ACCEPTS AND WHAT THE QUICK ACTIONS OFFER. Migration
// 232 wrote eight activity types into a CHECK constraint and 237 widens it; PLANNER_QUICK_ACTIONS may
// name a type before ACTIVITY_TYPES does. Taking the union means a quick action can never open a form
// whose select cannot represent the type it just chose -- and if the database has not caught up, the
// engine refuses the write and says so in its own words. Nothing here guesses which types are legal.

export type AddDraft = {
  activityType: string;
  title: string;
  planDate: string;
  start: string;
  end: string;
  locationId: string;
};

// CPR-MOB-001 s16: below md every field is thumb-height, and 16px -- below 16px iOS zooms the whole
// page on focus. max-md:* no-ops; the desktop form is unchanged at md and up.
const FIELD = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] text-gray-800 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";

const TYPE_OPTIONS: string[] = [
  ...ACTIVITY_TYPES,
  ...PLANNER_QUICK_ACTIONS.map(q => String(q.key)).filter(k => !(ACTIVITY_TYPES as readonly string[]).includes(k)),
];

export default function AddActivityForm({ draft, setDraft, locations, busy, notice, onSubmit, onCancel, bare }: {
  draft: AddDraft;
  setDraft: (d: AddDraft) => void;
  locations: LocationOption[];
  busy: boolean;
  notice: Notice;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  /** CPR-MOB-001 s8: true when FullScreenSheet supplies the frame -- the card chrome and the heading
      would then be a card inside a dialog saying its own name twice. The FIELDS are identical. */
  bare?: boolean;
}) {
  const startMinute = minuteOfDay(draft.start);
  const endMinute = minuteOfDay(draft.end);
  const set = (patch: Partial<AddDraft>) => setDraft({ ...draft, ...patch });

  return (
    <form
      className={bare ? "" : "rounded-2xl border border-[var(--cp-primary-border)] bg-white p-4"}
      onSubmit={e => {
        e.preventDefault();
        onSubmit({
          activityType: draft.activityType,
          title: draft.title,
          planDate: draft.planDate,
          plannedStartMinute: startMinute,
          plannedEndMinute: endMinute,
          locationId: draft.locationId || null,
        });
      }}
    >
      {!bare && <h2 className="text-[14px] font-bold text-gray-900">Add an activity</h2>}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Type
          <select className={FIELD} value={draft.activityType} onChange={e => set({ activityType: e.target.value })}>
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{activityLabel(t)}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:col-span-2">
          Title
          <input className={FIELD} value={draft.title} onChange={e => set({ title: e.target.value })}
            placeholder={activityLabel(draft.activityType)} />
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Date
          <input type="date" className={FIELD} value={draft.planDate} onChange={e => set({ planDate: e.target.value })} />
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          From
          {/* 24-hour text entry, not type="time" -- the native picker follows the OS locale and draws
              AM/PM on many machines; the owner asked for the 24-hour clock (CalendarConsole records
              the decision). The value shape is identical (HH:MM), so nothing downstream changes. */}
          <input required className={FIELD} value={draft.start} onChange={e => set({ start: e.target.value })}
            pattern="^([01]?\d|2[0-3]):[0-5]\d$" placeholder="09:00" inputMode="numeric"
            title="24-hour clock, HH:MM -- for example 09:00 or 14:30" />
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          To
          <input required className={FIELD} value={draft.end} onChange={e => set({ end: e.target.value })}
            pattern="^([01]?\d|2[0-3]):[0-5]\d$" placeholder="17:00" inputMode="numeric"
            title="24-hour clock, HH:MM -- for example 09:00 or 14:30" />
        </label>

        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:col-span-2">
          Location
          <select className={FIELD} value={draft.locationId} onChange={e => set({ locationId: e.target.value })}>
            <option value="">No location</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.facility ? `${l.name} — ${l.facility}` : l.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2 max-md:flex-wrap">
        {/* CPR-MOB-001 s4: the one primary action of this task grows to touch-primary size below md. */}
        <button type="submit" disabled={busy || startMinute === null || endMinute === null}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 max-md:min-h-[var(--cp-touch-primary)] max-md:flex-1 max-md:text-[14px]">
          {busy ? "Adding…" : "Add activity"}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-[var(--cp-touch)]">
          Cancel
        </button>
        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"}
            className={`text-[12px] font-semibold ${notice.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}>
            {notice.message}
          </p>
        )}
      </div>
    </form>
  );
}
