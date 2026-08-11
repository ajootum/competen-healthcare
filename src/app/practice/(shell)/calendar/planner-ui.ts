// CPR-V5-005 -- the presentation helpers the Practice Planner screen needs, and NOTHING that touches the
// database.
//
// ⚠ THIS FILE IS IMPORTED BY "use client" COMPONENTS. It may import from planner-constants.ts and
// activity-constants.ts (both deliberately database-free) and from nothing else in src/lib/practice.
// planner.ts imports activity.ts -> metrics.ts -> access.ts -> `next/headers`, and a client component
// that pulls in so much as one string from that chain fails `next build` with an import trace on pages
// nobody touched. tsc and eslint both pass while it is broken. See the header of planner-constants.ts.
//
// ⚠ THE ONE EXCEPTION IS `import type`, WHICH IS ERASED BEFORE ANY BUNDLE EXISTS. PlannerDay is imported
// from planner.ts below as a TYPE ONLY -- write `import { type X }` or `import type { X }` and nothing
// reaches the browser; drop the word `type` and the whole chain does. The planner harness asserts that
// every planner.ts import in this directory is type-only, because the difference is one word.

import { ACTIVITY_TYPES } from "@/lib/practice/activity-constants";
import {
  activityPasses, appointmentPasses, sessionPasses, type PlannerFilters,
} from "@/lib/practice/planner-constants";
import type { PlannerDay } from "@/lib/practice/planner";

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

// ── PER-CLINIC HUES (the owner, 2026-08-12, matching the design comp's month view) ─────────────────
//
// ⚠ SAME DOCTRINE AS THE ACTIVITY TONES ABOVE: the hue is NOT load-bearing. Every session block still
// names its place in words; the colour only lets a month be scanned -- TMR purple, Nsambya green --
// the way the comp draws it.
//
// ASSIGNED BY HASHING THE LOCATION ID, not by list order: order-based assignment recolours every
// clinic the day a new location is added, and a colour that silently changes meaning between visits
// is worse than no colour. The hash keeps each clinic's hue stable for the life of the location. With
// more locations than palette entries two clinics share a hue -- acceptable, because the words are
// the identity and the hue is a scanning aid.
export type LocationTone = {
  card: string; time: string; place: string; dot: string;
  /** Background only -- the Day view tints a session card's HEADER BAND, keeping the booking list on white. */
  band: string;
};

/** Every pickable slot's full tone, keyed by the registry in planner-constants. */
const TONE_BY_SLOT: Record<string, LocationTone> = {
  indigo: { card: "border-indigo-200 bg-indigo-50/70 hover:border-indigo-400", time: "text-indigo-900", place: "text-indigo-700", dot: "bg-indigo-500", band: "bg-indigo-50/70" },
  emerald: { card: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-400", time: "text-emerald-900", place: "text-emerald-700", dot: "bg-emerald-500", band: "bg-emerald-50/70" },
  teal: { card: "border-teal-200 bg-teal-50/70 hover:border-teal-400", time: "text-teal-900", place: "text-teal-700", dot: "bg-teal-500", band: "bg-teal-50/70" },
  violet: { card: "border-violet-200 bg-violet-50/70 hover:border-violet-400", time: "text-violet-900", place: "text-violet-700", dot: "bg-violet-500", band: "bg-violet-50/70" },
  sky: { card: "border-sky-200 bg-sky-50/70 hover:border-sky-400", time: "text-sky-900", place: "text-sky-700", dot: "bg-sky-500", band: "bg-sky-50/70" },
  orange: { card: "border-orange-200 bg-orange-50/70 hover:border-orange-400", time: "text-orange-900", place: "text-orange-700", dot: "bg-orange-500", band: "bg-orange-50/70" },
  rose: { card: "border-rose-200 bg-rose-50/70 hover:border-rose-400", time: "text-rose-900", place: "text-rose-700", dot: "bg-rose-500", band: "bg-rose-50/70" },
  fuchsia: { card: "border-fuchsia-200 bg-fuchsia-50/70 hover:border-fuchsia-400", time: "text-fuchsia-900", place: "text-fuchsia-700", dot: "bg-fuchsia-500", band: "bg-fuchsia-50/70" },
  lime: { card: "border-lime-200 bg-lime-50/70 hover:border-lime-400", time: "text-lime-900", place: "text-lime-700", dot: "bg-lime-600", band: "bg-lime-50/70" },
  cyan: { card: "border-cyan-200 bg-cyan-50/70 hover:border-cyan-400", time: "text-cyan-900", place: "text-cyan-700", dot: "bg-cyan-500", band: "bg-cyan-50/70" },
};

// ⚠ THE AUTOMATIC PALETTE IS THE FIRST SIX, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING: the hash
// below assigns clinics into it, and reordering would silently recolour every clinic that has not
// picked a colour. A clinic that HAS picked one (practice_location.color_slot, migration 290) is
// immune -- its choice wins over the hash.
const AUTO_PALETTE: LocationTone[] = [
  TONE_BY_SLOT.indigo, TONE_BY_SLOT.emerald, TONE_BY_SLOT.teal,
  TONE_BY_SLOT.violet, TONE_BY_SLOT.sky, TONE_BY_SLOT.orange,
];

/** The comp's "Other / Special": a session with no location gets amber, distinct from every clinic. */
export const NO_LOCATION_TONE: LocationTone = {
  card: "border-amber-200 bg-amber-50/70 hover:border-amber-400", time: "text-amber-900", place: "text-amber-800", dot: "bg-amber-500", band: "bg-amber-50/70",
};

/**
 * The tone for a place: the practitioner's CHOSEN slot when one is set (the owner, 2026-08-12:
 * "so i can choose colors for the different clinics"), else the stable hash. An unknown slot value
 * falls back to the hash rather than crashing a calendar over a stale string.
 */
export function locationTone(locationId: string | null | undefined, chosenSlot?: string | null): LocationTone {
  if (!locationId) return NO_LOCATION_TONE;
  if (chosenSlot && TONE_BY_SLOT[chosenSlot]) return TONE_BY_SLOT[chosenSlot];
  let h = 0;
  for (let i = 0; i < locationId.length; i++) h = ((h * 31) + locationId.charCodeAt(i)) >>> 0;
  return AUTO_PALETTE[h % AUTO_PALETTE.length];
}

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

// ── CP-PLAN-002: THE URL IS THE STATE, AND THE FILTER IS APPLIED IN ONE PLACE ────────────────────────

/**
 * ⚠ EVERY CONTROL ON THIS SCREEN IS A LINK, and the whole planner state is in the query string: which
 * view, which day, which custom period, what is selected and what is filtered.
 *
 * The reason is not tidiness. The appointment book underneath the planner already reads `?date=`, the
 * server does the range read, and s3 requires a "Go to date" and a period a practitioner can come back
 * to. Client state would give two ideas of "the day I am looking at" on one screen -- which is how
 * somebody edits Thursday while reading Wednesday -- and would make every one of these controls
 * unlinkable and unbookmarkable.
 */
export type PlannerUrlState = {
  view?: string;
  date?: string | null;
  from?: string | null;
  to?: string | null;
  sel?: string | null;
  show?: string | null;
  location?: string | null;
  activityType?: string | null;
  appointmentType?: string | null;
  status?: string | null;
  q?: string | null;
};

/** Builds /practice/calendar?... dropping everything empty, so a default never appears in the URL. */
export function plannerHref(state: PlannerUrlState): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | null | undefined) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  };
  put("view", state.view);
  put("date", state.date);
  put("from", state.from);
  put("to", state.to);
  put("sel", state.sel);
  put("show", state.show === "all" ? null : state.show);
  put("location", state.location);
  put("activityType", state.activityType);
  put("appointmentType", state.appointmentType);
  put("status", state.status);
  put("q", state.q);
  const qs = p.toString();
  return qs ? `/practice/calendar?${qs}` : "/practice/calendar";
}

/**
 * One day, narrowed by s4's content controls.
 *
 * ⚠ THE PREDICATES ARE IMPORTED, NEVER RESTATED. appointmentPasses, activityPasses and sessionPasses
 * live in planner-constants.ts and are the same functions the harness exercises; a second copy of the
 * "Walk-ins" rule written in a component is a rule that can quietly disagree with the one being tested.
 *
 * ⚠ AND IT REPORTS WHAT IT HID. A filtered day that simply looks empty is indistinguishable from a day
 * with nothing on it, which is the distinction this whole product is built around.
 */
export function filterDay(day: PlannerDay, f: PlannerFilters): {
  activities: PlannerDay["activities"];
  appointments: PlannerDay["appointments"];
  sessions: PlannerDay["sessions"];
  hidden: number;
  empty: boolean;
} {
  const activities = day.activities.filter(a => activityPasses(f, a));
  const appointments = day.appointments.filter(a => appointmentPasses(f, a));
  const sessions = day.sessions.filter(s => sessionPasses(f, {
    slotKind: s.slotKind, slotKindLabel: s.slotKindLabel, status: s.status,
    locationId: s.locationId, locationName: s.locationName,
    blocked: s.capacity.blocked, available: s.capacity.available, note: s.note,
  }));
  const shown = activities.length + appointments.length + sessions.length;
  const total = day.activities.length + day.appointments.length + day.sessions.length;
  return { activities, appointments, sessions, hidden: total - shown, empty: shown === 0 };
}

/** How an appointment status is drawn. Every one of migration 192's six has an entry. */
export const APPOINTMENT_STATUS_CHIP: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-indigo-100 text-indigo-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-rose-100 text-rose-700",
  NO_SHOW: "bg-rose-100 text-rose-700",
};

/**
 * ⚠ HOW AN OUTCOME IS DRAWN. `not_recorded` is AMBER, not grey and not red.
 *
 * It is not an error and it is not a did-not-attend: it is a booking whose day has passed and whose
 * outcome nobody wrote down, which is something a practice can act on. Drawing it in the same grey as
 * "Expected" would hide it; drawing it in the same red as "Did not attend" would accuse the patient.
 */
export const OUTCOME_CHIP: Record<string, string> = {
  seen: "bg-emerald-100 text-emerald-800",
  consultation_started: "bg-amber-100 text-amber-800",
  marked_complete: "bg-slate-100 text-slate-700",
  arrived: "bg-indigo-100 text-indigo-700",
  did_not_attend: "bg-rose-100 text-rose-700",
  cancelled: "bg-rose-50 text-rose-600",
  expected: "bg-slate-100 text-slate-500",
  not_recorded: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
};

/**
 * ⚠ HOW A FREE COUNT IS WORDED, in one place, so no screen can round the unknown down to nought.
 *
 * `available === null` means the session has no generated times and there is nothing to count. "0 free"
 * would read as a full clinic; "free times not generated" is what is actually true.
 */
export function capacityPhrase(c: { booked: number; available: number | null }): string {
  return `${c.booked} booked · ${c.available === null ? "free not calculable" : `${c.available} free`}`;
}
