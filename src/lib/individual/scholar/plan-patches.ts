import type { Occurrence } from "../learning-plan/types";
import { agendaItemOrder, type AgendaDay } from "./plan-view";
import { personalItem, type CalendarItem } from "./study-calendar";

// ── MY PLAN: INSTANT UPDATES ── scholar/plan-perf-01 ─────────────────────────────────────────────────────────────────
//
// Pure. After the learner adds, moves, postpones, edits, completes or deletes something, the page shows the change at once and the server's own answer
// follows (router.refresh). These are the small changes laid over the days the server last sent. They never leave the browser: the server is
// asked as before and decides everything, and a refused request takes its patch off again. A patch is applied to whatever the server sent, so a
// repeated application is harmless (an item is found by its key, never added twice).

export type PlanPatch =
  /** An item is gone (deleted, cancelled, "Not this"): by its key, or every item of an entry series. */
  | { kind: "remove"; key?: string; entryId?: string }
  /** A planned activity, the monthly review or an occurrence moved to another day. `restore` puts a Scholar activity back (no "moved" mark). */
  | { kind: "move"; key: string; to: string; restore?: boolean }
  /** An item shown differently (edited, marked done). The key may change (a new title does not change an occurrence key). */
  | { kind: "replace"; key: string; item: CalendarItem }
  /** A new item on a day (an entry just added: it is a pending row until the server confirms it). */
  | { kind: "add"; date: string; item: CalendarItem };

/** A row for an entry the server has not confirmed yet: it has no real id, so the row offers no actions (they would name an entry that does not exist). */
export const PENDING_ENTRY = "pending";
export const isPendingItem = (i: Pick<CalendarItem, "occurrence">): boolean => i.occurrence?.entryId === PENDING_ENTRY;

/** Pure. The occurrence a just-submitted entry form will become, for the pending row (the server's answer replaces it). */
export function pendingOccurrence(token: string, f: { entryType: Occurrence["entryType"]; title: string; description: string | null; date: string; startTime: string | null; endTime: string | null; durationMinutes: number | null; recurring: boolean }): Occurrence {
  return {
    key: `${PENDING_ENTRY}@${token}`, entryId: PENDING_ENTRY, experience: "scholar", entryType: f.entryType, title: f.title, description: f.description, date: f.date, occurrenceDate: f.date,
    startTime: f.startTime, endTime: f.endTime, allDay: !f.startTime, durationMinutes: f.durationMinutes, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: f.recurring,
  };
}

/** Pure. The items of one day with the patches that concern it laid over them. */
export function applyPlanPatches(days: readonly AgendaDay[], patches: readonly PlanPatch[]): AgendaDay[] {
  if (!patches.length) return days as AgendaDay[];
  let out = days.map(d => ({ ...d, items: [...d.items] }));
  const has = (date: string, key: string) => out.find(d => d.date === date)?.items.some(i => i.key === key) ?? false;
  for (const p of patches) {
    if (p.kind === "remove") {
      out = out.map(d => ({ ...d, items: d.items.filter(i => !(p.key !== undefined && i.key === p.key) && !(p.entryId !== undefined && i.occurrence?.entryId === p.entryId)) }));
    } else if (p.kind === "add") {
      out = out.map(d => (d.date === p.date && !has(d.date, p.item.key) ? { ...d, items: agendaItemOrder([...d.items, p.item]) } : d));
    } else if (p.kind === "replace") {
      out = out.map(d => ({ ...d, items: d.items.map(i => (i.key === p.key ? p.item : i)) }));
    } else {
      const from = out.find(d => d.items.some(i => i.key === p.key));
      const found = from?.items.find(i => i.key === p.key);
      if (!from || !found || from.date === p.to) continue;
      const moved: CalendarItem = found.occurrence
        ? personalItem({ ...found.occurrence, date: p.to, moved: found.occurrence.occurrenceDate !== p.to })
        : { ...found, movedFrom: p.restore ? null : found.movedFrom ?? from.date };
      out = out.map(d => (d.date === from.date ? { ...d, items: d.items.filter(i => i.key !== p.key) } : d.date === p.to ? { ...d, items: agendaItemOrder([...d.items, moved]) } : d));
    }
  }
  return out;
}

/** Pure. One day's rows (the Today list) with the patches laid over them. A move TO this day is shown, a move away removes it. */
export function applyPlanPatchesToDay(date: string, items: readonly CalendarItem[], patches: readonly PlanPatch[]): CalendarItem[] {
  if (!patches.length) return items as CalendarItem[];
  // the other end of a move is not on this list, so the move is read as "gone from this day" or "arrives on this day"
  const day: AgendaDay = { date, today: false, past: false, items: [...items] };
  const spare: AgendaDay = { date: "\u0000elsewhere", today: false, past: false, items: [] };
  const out = applyPlanPatches([day, spare], patches.map(p => (p.kind === "move" && p.to !== date ? { ...p, to: spare.date } : p)));
  return out[0].items;
}
