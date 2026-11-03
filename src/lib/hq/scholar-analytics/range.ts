// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- date ranges and day keys. Days are the platform's reporting days (Africa/Nairobi), the
// same day boundary everywhere on the dashboard so a learner's "active days" and the summary's DAU agree.
import type { DateRange, RangePreset } from "./types";

export const DAY_TZ = "Africa/Nairobi";
const DAY_MS = 86_400_000;

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of an instant in the reporting time zone. */
export function dayKey(iso: string | Date): string {
  return fmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** The ISO week label (Monday) of a day key, for the weekly trend. */
export function weekKey(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCTime?.(0);
  const monday = new Date(d.getTime() - dow * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** The instant the reporting day of `now` started, as ISO. */
export function startOfDay(now: Date): string {
  const day = dayKey(now);
  // the offset of the zone at that instant, found from the formatted parts
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DAY_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 0), m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  const local = new Date(now.getTime() - (h * 60 + m) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
  void day;
  return local.toISOString();
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Parses the range controls. Custom needs both days, inclusive, at most 366 days, never in the future. */
export function parseRange(params: { range?: string | null; from?: string | null; to?: string | null }, now = new Date()): DateRange {
  const preset = (["today", "7d", "30d", "90d", "custom"].includes(params.range ?? "") ? params.range : "30d") as RangePreset;
  const to = now.toISOString();
  const today0 = startOfDay(now);
  if (preset === "custom" && isDay(params.from) && isDay(params.to) && params.from <= params.to) {
    const fromMs = new Date(params.from + "T00:00:00Z").getTime() - 3 * 3_600_000;
    const toMs = Math.min(now.getTime(), new Date(params.to + "T00:00:00Z").getTime() + DAY_MS - 3 * 3_600_000);
    if (toMs - fromMs <= 366 * DAY_MS && fromMs < toMs)
      return { preset, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), label: `${params.from} to ${params.to}` };
  }
  if (preset === "today") return { preset, from: today0, to, label: "Today" };
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  return { preset: preset === "custom" ? "30d" : preset, from: new Date(new Date(today0).getTime() - (days - 1) * DAY_MS).toISOString(), to, label: `Last ${days} days` };
}

export const inRange = (iso: string | null | undefined, r: { from: string; to: string }): boolean => !!iso && iso >= r.from && iso <= r.to;
