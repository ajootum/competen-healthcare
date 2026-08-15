// CPR-PCA-HFE-012 s6 -- the month grid's arithmetic, and nothing else.
//
// ⚠ THIS MODULE IMPORTS NOTHING. It is shared by a server page and a harness, and the constants-file
// rule applies: a pure-arithmetic module that grows an import grows a client-bundle dependency chain.
//
// ⚠ THE DAY AN ITEM LANDS ON IS THE PRACTICE'S DAY, NOT THE SERVER'S. A ward round at 23:30 Kampala
// time is stored as 20:30 UTC; bucketed in UTC it would render on the previous day's cell -- the same
// zoned-day trap workspaceClock and zonedDayRange exist for, applied to the render side.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The practice-calendar day (YYYY-MM-DD) an instant falls on. Falls back to UTC only if the zone is unusable. */
export function zonedDayOf(iso: string, timezone: string | null | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    // en-CA formats as YYYY-MM-DD, which is the one locale trick this codebase allows itself.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * The weeks of the month containing anchorDate, Monday-first, as YYYY-MM-DD strings with null padding.
 * Pure calendar shape: no timezone belongs here, because "August has 31 days and starts on a Saturday"
 * is true in every timezone.
 */
export function monthGridWeeks(anchorDate: string): (string | null)[][] {
  const y = Number(anchorDate.slice(0, 4));
  const m = Number(anchorDate.slice(5, 7));
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return [];

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // getUTCDay: Sunday 0. Monday-first column index: Monday 0 .. Sunday 6.
  const firstColumn = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  const pad = (n: number) => String(n).padStart(2, "0");
  const cells: (string | null)[] = [
    ...Array.from({ length: firstColumn }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type DayBucket = { procedures: number; activities: number; cpdMinutes: number };

/**
 * Counts per practice-calendar day for the unified activity record's items. Procedures and logged
 * activities are counted APART -- the grid's two chips are the two summary bands in miniature, and one
 * merged number would erase the distinction the whole page is built on.
 */
export function bucketActivityDays(items: any[], timezone: string | null | undefined): Record<string, DayBucket> {
  const out: Record<string, DayBucket> = {};
  for (const item of items ?? []) {
    const day = zonedDayOf(String(item?.occurredAt ?? ""), timezone);
    if (!day) continue;
    const bucket = (out[day] ??= { procedures: 0, activities: 0, cpdMinutes: 0 });
    if (item.recordKind === "procedure") bucket.procedures += 1;
    else bucket.activities += 1;
    bucket.cpdMinutes += Number(item.cpd_minutes ?? 0) || 0;
  }
  return out;
}
