// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE PLACE THAT DECIDES WHAT A TIME LOOKS LIKE.
//
// ---- WHY THIS EXISTS ---------------------------------------------------------------------------------
//
// `new Date(x).toLocaleString()` with no locale uses THE RUNTIME'S locale. On a server that is whatever
// the container was built with; in a browser it is whatever the user's machine says. So the same
// timestamp could render "2:30 PM" server-side and "14:30" after hydration, or differ between two
// people looking at the same screen -- and in a clinical product a time that reads differently to two
// people is a genuine hazard, not a cosmetic one.
//
// Ninety call sites across the app were doing exactly that. This module is the single answer.
//
// ---- THE TWO DECISIONS -------------------------------------------------------------------------------
//
// en-GB, because the product is built for East Africa: day-before-month, and 24-hour by default.
//
// hourCycle "h23", NOT hour12:false. They differ at exactly one moment: several engines render midnight
// as "24:00" under hour12:false, and "24:00" on a ward round is the kind of thing somebody reads as
// tomorrow. practice-time.ts already carries a comment about this trap; h23 is the fix rather than the
// workaround.
//
// ---- TIME ZONES --------------------------------------------------------------------------------------
//
// `timeZone` is OPTIONAL and should be passed wherever the practice's own clock is known -- CPR-140 and
// CPR-300 established that the practice's day, not the reader's, is the one that matters. Omitting it
// falls back to the runtime zone, which is right for things that are about the reader (when did I sign
// in) and wrong for things about the practice (when is this clinic).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type When = Date | string | number | null | undefined;

const toDate = (v: When): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Everything here shares this, so a format can never drift between two call sites. */
const base = (timeZone?: string): Intl.DateTimeFormatOptions => ({
  hourCycle: "h23",
  ...(timeZone ? { timeZone } : {}),
});

/** "14:30" */
export function formatTime(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...base(timeZone) });
}

/** "14:30:05" -- only where the second genuinely matters, such as an audit trail. */
export function formatTimeWithSeconds(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", ...base(timeZone),
  });
}

/** "4 Aug 2026" */
export function formatDate(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", ...base(timeZone),
  });
}

/** "4 Aug 2026, 14:30" */
export function formatDateTime(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", ...base(timeZone),
  });
}

/** "Tue 4 Aug, 14:30" -- for a diary, where the weekday is what a person navigates by. */
export function formatDayTime(value: When, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", ...base(timeZone),
  });
}

/**
 * Minutes past local midnight as "14:30".
 *
 * The counterpart for values that were never instants -- a weekly template's start, a clinic's opening
 * hour. Migrations 229 and 230 store those as minutes precisely because "opens at 09:00" is true on
 * every date, and formatting them through a Date would invent one.
 */
export function formatMinuteOfDay(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE READER'S CLOCK. Design: docs/design/LOCAL-TIME-ZONES.md.
//
// Only for a time that is about the reader: when I saved, answered or started something. Never a practice
// schedule (CPR-140, CPR-300 above), never a calendar day, never a streak or "today".
//
// A null clock means the feature is off for this reader: formatForReader then gives what the call site
// gave before, in the zone it used before.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The product's home zone, used when nothing better is known. */
export const DEFAULT_READER_ZONE = "Africa/Kampala";
/** Set by the browser. Holds the DEVICE's zone. A person's own choice lives in user_preferences.timezone. */
export const READER_ZONE_COOKIE = "cmp_reader_tz";

export type ReaderZoneSource = "choice" | "device" | "network" | "default";
export type ReaderClock = { zone: string; source: ReaderZoneSource };

// The zone name comes from a cookie the browser can change, and zone names match in any letter case, so these caches
// could otherwise grow without end. Real zones number about 600: past the limit a cache simply starts again.
const CACHE_LIMIT = 1000;
const remember = <V,>(cache: Map<string, V>, key: string, value: V): V => {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
};

const knownZones = new Map<string, true>();

/** The zone name if it is a real IANA zone this runtime knows, else null. Never throws. */
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  if (knownZones.has(tz)) return tz;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); } catch { return null; }
  remember(knownZones, tz, true);
  return tz;
}

/** Pure. The reader's zone: their own choice, then this device, then the network's estimate, then the home zone. */
export function resolveReaderClock(input: { choice?: unknown; device?: unknown; network?: unknown }): ReaderClock {
  const choice = validTimeZone(input.choice);
  if (choice) return { zone: choice, source: "choice" };
  const device = validTimeZone(input.device);
  if (device) return { zone: device, source: "device" };
  const network = validTimeZone(input.network);
  if (network) return { zone: network, source: "network" };
  return { zone: DEFAULT_READER_ZONE, source: "default" };
}

/** Pure. What the browser should do on seeing its own zone. Refreshes only for a real change, so it cannot loop. */
export function readerZoneSync(input: { device: unknown; cookie: string | null | undefined; clock: ReaderClock }): { write: string | null; refresh: boolean } {
  const device = validTimeZone(input.device);
  if (!device || device === input.cookie) return { write: null, refresh: false };
  return { write: device, refresh: input.clock.source !== "choice" && input.clock.zone !== device };
}

/** Pure. The cookie line that keeps this device's zone for a year. */
export function readerZoneCookie(zone: string, secure: boolean): string {
  return `${READER_ZONE_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes this zone is ahead of UTC at this instant. Follows daylight saving. */
export function zoneOffsetMinutes(at: Date, zone: string): number {
  const f = offsetFormatters.get(zone) ?? remember(offsetFormatters, zone, new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }));
  const parts = f.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

const eastAfrica = ["Africa/Kampala", "Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Addis_Ababa", "Africa/Mogadishu", "Africa/Djibouti", "Africa/Asmara"];
const centralAfrica = ["Africa/Kigali", "Africa/Lusaka", "Africa/Harare", "Africa/Maputo", "Africa/Blantyre", "Africa/Lubumbashi", "Africa/Gaborone", "Africa/Bujumbura", "Africa/Khartoum", "Africa/Juba", "Africa/Windhoek"];
const westAfrica = ["Africa/Lagos", "Africa/Kinshasa", "Africa/Luanda", "Africa/Douala", "Africa/Libreville", "Africa/Niamey", "Africa/Ndjamena", "Africa/Bangui", "Africa/Brazzaville"];
const gmtOnly = ["Africa/Accra", "Africa/Abidjan", "Africa/Dakar", "Africa/Bamako", "Africa/Banjul", "Africa/Conakry", "Africa/Freetown", "Africa/Lome", "Africa/Monrovia"];

// [the name, the offset it means in minutes, the zones it may name]. The offset is checked at the instant, so a
// name can never be wrong: a zone whose real offset does not match reads as "UTC+3" instead.
const ZONE_NAMES: readonly (readonly [string, number, readonly string[]])[] = [
  ["EAT", 180, eastAfrica], ["CAT", 120, centralAfrica], ["WAT", 60, westAfrica], ["GMT", 0, gmtOnly],
  ["SAST", 120, ["Africa/Johannesburg", "Africa/Maseru", "Africa/Mbabane"]],
  ["GMT", 0, ["Europe/London"]], ["BST", 60, ["Europe/London"]],
  ["IST", 330, ["Asia/Kolkata", "Asia/Calcutta"]],
  ["EST", -300, ["America/New_York"]], ["EDT", -240, ["America/New_York"]],
  ["CST", -360, ["America/Chicago"]], ["CDT", -300, ["America/Chicago"]],
  ["MST", -420, ["America/Denver"]], ["MDT", -360, ["America/Denver"]],
  ["PST", -480, ["America/Los_Angeles"]], ["PDT", -420, ["America/Los_Angeles"]],
];

/** "EAT" where a name is certain, else "UTC", "UTC+3", "UTC-3:30". The same on the server and in every browser. */
export function zoneLabel(at: Date, zone: string): string {
  const offset = zoneOffsetMinutes(at, zone);
  const named = ZONE_NAMES.find(([, minutes, zones]) => minutes === offset && zones.includes(zone));
  if (named) return named[0];
  if (offset === 0) return "UTC";
  const abs = Math.abs(offset);
  return `UTC${offset < 0 ? "-" : "+"}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
}

export const READER_SHAPES = {
  /** "6 Nov 2026" */
  date: { day: "numeric", month: "short", year: "numeric" },
  /** "6 November 2026" */
  dateLong: { day: "numeric", month: "long", year: "numeric" },
  /** "6 Nov" */
  dayMonth: { day: "numeric", month: "short" },
  /** "6 Nov 2026, 23:22" */
  dateTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
  /** "6 Nov, 23:22" */
  dayMonthTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  /** "23:22" */
  time: { hour: "2-digit", minute: "2-digit" },
  /** "23:22:05" */
  timeSeconds: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;
export type ReaderShape = keyof typeof READER_SHAPES;

/** A value that was only ever a calendar day. It has no instant, so no zone may move it. */
const isCalendarDay = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * THE ONE ROUTE for a time about the reader, on the server and in the browser.
 *
 * On: in the reader's zone, with the zone named wherever a time of day shows ("6 Nov 2026, 23:22 EAT").
 * Off (clock null): what the call site gave before, in `legacyZone`, which is the zone that site used (none means the runtime's).
 * A bare YYYY-MM-DD is never moved. An unreadable value gives "", and a zone this runtime does not know never throws.
 */
export function formatForReader(value: When, clock: ReaderClock | null | undefined, shape: ReaderShape, legacyZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  const options: Intl.DateTimeFormatOptions = READER_SHAPES[shape];
  if (!clock) return d.toLocaleString("en-GB", { ...options, ...(legacyZone ? { timeZone: legacyZone } : {}) });
  if (isCalendarDay(value)) return d.toLocaleString("en-GB", { ...options, timeZone: "UTC" });
  const zone = validTimeZone(clock.zone) ?? DEFAULT_READER_ZONE;
  const text = d.toLocaleString("en-GB", { ...options, hourCycle: "h23", timeZone: zone });
  return "hour" in options ? `${text} ${zoneLabel(d, zone)}` : text;
}
