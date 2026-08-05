// CPR-V5-005 -- the presentation helpers the Practice Planner screen needs, and NOTHING that touches the
// database.
//
// ⚠ THIS FILE IS IMPORTED BY "use client" COMPONENTS. It may import from planner-constants.ts and
// activity-constants.ts (both deliberately database-free) and from nothing else in src/lib/practice.
// planner.ts imports activity.ts -> metrics.ts -> access.ts -> `next/headers`, and a client component
// that pulls in so much as one string from that chain fails `next build` with an import trace on pages
// nobody touched. tsc and eslint both pass while it is broken. See the header of planner-constants.ts.

import { ACTIVITY_TYPES } from "@/lib/practice/activity-constants";

export const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute) % 60).padStart(2, "0")}`;

/** "1h 30m" / "45m" / "2h". COUNTS AND DURATIONS ONLY -- nothing on this screen renders a percentage. */
export function hoursMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${sign}${h}h ${m}m`;
  if (h) return `${sign}${h}h`;
  return `${sign}${m}m`;
}

/** "09:30" -> 570. Returns null on anything that is not a time, so a caller never sends NaN to an engine. */
export function minuteOfDay(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

// Dates are formatted by hand rather than through Intl. The same string has to come out of the server
// render and the browser hydration, and Intl's data is not guaranteed to be identical in both.
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "05 Aug 2026" from an ISO date, with no clock arithmetic and therefore no chance of slipping a day. */
export function longDate(dateIso: string): string {
  const [y, m, d] = dateIso.split("-");
  return `${d} ${MONTH[Number(m) - 1] ?? m} ${y}`;
}

/** "05 Aug". */
export function shortDate(dateIso: string): string {
  const [, m, d] = dateIso.split("-");
  return `${d} ${MONTH[Number(m) - 1] ?? m}`;
}

/** Shift an ISO date by whole days, anchored at noon so no timezone can move it. */
export const shiftDate = (dateIso: string, days: number) =>
  new Date(Date.parse(`${dateIso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * One hue per activity type, for the block, the dot and the legend.
 *
 * ⚠ THE HUE IS NOT LOAD-BEARING. It exists so a week can be scanned, and every block also carries its
 * type in words -- a screen where the only way to tell a theatre list from a ward round is the colour is
 * unreadable to anybody who cannot separate the two.
 *
 * KEYED BY STRING WITH A FALLBACK, because migration 237 widens the type list and this table must not be
 * the thing that decides which types a screen can draw. An unknown type gets slate and its own label.
 */
export type Tone = { dot: string; chip: string; bar: string; soft: string };

const FALLBACK: Tone = {
  dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700", bar: "bg-slate-400", soft: "bg-slate-50",
};

const TONE: Record<string, Tone> = {
  outpatient_clinic: { dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700", bar: "bg-indigo-500", soft: "bg-indigo-50/60" },
  ward_round: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50/60" },
  theatre: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700", bar: "bg-rose-500", soft: "bg-rose-50/60" },
  emergency_consult: { dot: "bg-red-600", chip: "bg-red-50 text-red-700", bar: "bg-red-600", soft: "bg-red-50/60" },
  virtual_clinic: { dot: "bg-cyan-500", chip: "bg-cyan-50 text-cyan-700", bar: "bg-cyan-500", soft: "bg-cyan-50/60" },
  telephone_review: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700", bar: "bg-sky-500", soft: "bg-sky-50/60" },
  administration: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700", bar: "bg-amber-500", soft: "bg-amber-50/60" },
  teaching: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700", bar: "bg-violet-500", soft: "bg-violet-50/60" },
  meeting: { dot: "bg-fuchsia-500", chip: "bg-fuchsia-50 text-fuchsia-700", bar: "bg-fuchsia-500", soft: "bg-fuchsia-50/60" },
  research: { dot: "bg-teal-500", chip: "bg-teal-50 text-teal-700", bar: "bg-teal-500", soft: "bg-teal-50/60" },
  leave: { dot: "bg-lime-600", chip: "bg-lime-50 text-lime-700", bar: "bg-lime-600", soft: "bg-lime-50/60" },
  travel: { dot: "bg-orange-500", chip: "bg-orange-50 text-orange-700", bar: "bg-orange-500", soft: "bg-orange-50/60" },
  custom: { dot: "bg-slate-500", chip: "bg-slate-100 text-slate-700", bar: "bg-slate-500", soft: "bg-slate-50" },
};

export const toneFor = (activityType: string): Tone => TONE[activityType] ?? FALLBACK;

/** The legend's rows. Read out of the constants so a new type appears here the day it is added. */
export const LEGEND_TYPES: readonly string[] = ACTIVITY_TYPES;

/** A place a block can be put, as the screen needs it. Loaded by bookingLocations() on the server. */
export type LocationOption = { id: string; name: string; facility: string | null };

/**
 * How every control on this screen reaches an engine: one POST, and TRUE only when the engine agreed.
 * `subject` is what the answer is about (an activity id, or "add") so a refusal can be shown against the
 * thing it refers to rather than in one shared box at the top of the page.
 */
export type RunAction =
  (action: string, body: Record<string, unknown>, subject: string) => Promise<boolean>;

export type Notice = { subject: string; tone: "ok" | "error"; message: string } | null;

/** How a block's state is drawn. `cancelled` is struck through -- migration 236 voids, never deletes. */
export const STATE_CHIP: Record<string, string> = {
  planned: "bg-slate-100 text-slate-600",
  running: "bg-emerald-100 text-emerald-700",
  done: "bg-slate-100 text-slate-500",
  cancelled: "bg-rose-100 text-rose-700",
};
