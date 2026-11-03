// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- date ranges and day keys. Days are the platform's reporting days (Africa/Nairobi, a fixed
// UTC+3 zone with no daylight change), the same day boundary everywhere on the dashboard so a learner's "active days" and the
// summary's daily active figure agree.
import type { DateRange, RangePreset } from "./types";

export const DAY_TZ = "Africa/Nairobi";
const TZ_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of an instant in the reporting time zone. */
export function dayKey(iso: string | Date): string {
  return fmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** The instant a reporting day starts, as ISO. */
export const dayStart = (day: string): string => new Date(new Date(day + "T00:00:00Z").getTime() - TZ_OFFSET_MS).toISOString();

/** The Monday of the week a day key falls in, for the weekly trend. */
export function weekKey(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

/** The instant the reporting day of `now` started, as ISO. */
export const startOfDay = (now: Date): string => dayStart(dayKey(now));

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Parses the range controls. Custom needs both days, inclusive, at most 366 days, never in the future. */
export function parseRange(params: { range?: string | null; from?: string | null; to?: string | null }, now = new Date()): DateRange {
  const preset = (["today", "7d", "30d", "90d", "custom"].includes(params.range ?? "") ? params.range : "30d") as RangePreset;
  const to = now.toISOString();
  const today0 = startOfDay(now);
  if (preset === "custom" && isDay(params.from) && isDay(params.to) && params.from <= params.to) {
    const fromMs = new Date(dayStart(params.from)).getTime();
    const toMs = Math.min(now.getTime(), new Date(dayStart(params.to)).getTime() + DAY_MS - 1);
    if (toMs - fromMs <= 366 * DAY_MS && fromMs < toMs)
      return { preset, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), label: `${params.from} to ${params.to}` };
  }
  if (preset === "today") return { preset, from: today0, to, label: "Today" };
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  return { preset: preset === "custom" ? "30d" : preset, from: new Date(new Date(today0).getTime() - (days - 1) * DAY_MS).toISOString(), to, label: `Last ${days} days` };
}

export const inRange = (iso: string | null | undefined, r: { from: string; to: string }): boolean => !!iso && iso >= r.from && iso <= r.to;
