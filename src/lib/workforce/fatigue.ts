// Fatigue exposure engine (UMW-WFM-003 / SSW-WFM-003) — ONE implementation, two workspaces.
//
// This started life inside the SSW attendance loader. The Unit Manager needs the same numbers from a
// different angle (a unit over weeks, rather than one supervisor over one shift), and two copies of a
// fatigue calculation would eventually disagree — at which point a supervisor and their manager would be
// looking at different answers to "is this nurse overworked". So it lives here and both consume it.
//
// WHAT IT MEASURES, precisely: exposure from ROSTERED shifts. It is not a clinical judgement about any
// individual, and the surfaces that render it say so. Where a shift has no recorded start/end it counts
// toward consecutive days but NOT toward hours, and the result reports `hoursPartial` so a caller can never
// present an understated total as if it were complete.
//
// Thresholds are configurable per tenant/unit through the existing WCE (workspace_config_overrides) —
// UMW-WFM-003 requires "fatigue thresholds configurable by organisation". resolveFatigueThresholds() reads
// them, falling back to the defaults below, which mirror the roster-governance rules already in the UMW.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadConfigOverrides, resolveSettings, type ScopeCtx } from "@/lib/config/workspace-config";

export const FATIGUE_CONFIG_PATH = "workforce.fatigue";

export type FatigueThresholds = {
  consecutiveDays: number;   // consecutive rostered days before flagging
  weekHours: number;         // rostered hours in 7 days before flagging
  restHours: number;         // minimum gap between shifts
  nightRun: number;          // night shifts in the window before flagging
};

export const DEFAULT_THRESHOLDS: FatigueThresholds = {
  consecutiveDays: 5, weekHours: 48, restHours: 11, nightRun: 4,
};

// A shift as this engine needs it. Deliberately minimal so any caller can map its own rows in.
export type ShiftRow = {
  staffId: string;
  date: string | null;          // YYYY-MM-DD
  startsAt?: string | null;
  endsAt?: string | null;
  shiftType?: string | null;
};

export type FatigueRow = {
  staffId: string;
  shifts: number;
  days: number;
  consecutive: number;
  nights: number;
  hours: number | null;        // null when NO shift in the window had recorded times
  hoursPartial: boolean;       // true when SOME shifts had no times
  rest: number | null;         // shortest gap between a shift ending and the next starting
  flags: string[];
  band: "none" | "watch" | "high";
};

const DAY = 86400000;

export function hoursOfShift(s: ShiftRow): number | null {
  if (!s.startsAt || !s.endsAt) return null;
  const h = (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3.6e6;
  // A negative or >24h span is a data error, not a 30-hour shift — excluded rather than believed.
  return h > 0 && h <= 24 ? Math.round(h * 10) / 10 : null;
}

// Longest run of consecutive calendar days present in the set.
export function consecutiveDays(dates: Iterable<string>): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0, run = 0, prev: number | null = null;
  for (const d of sorted) {
    const t = new Date(`${d}T00:00:00Z`).getTime();
    if (Number.isNaN(t)) continue;
    run = prev != null && t - prev === DAY ? run + 1 : 1;
    prev = t;
    best = Math.max(best, run);
  }
  return best;
}

// Shortest gap between any shift ending and the next shift starting.
export function shortestRest(shifts: ShiftRow[]): number | null {
  const ends = shifts.map(s => s.endsAt).filter(Boolean).map(e => new Date(e!).getTime()).sort((a, b) => a - b);
  const starts = shifts.map(s => s.startsAt).filter(Boolean).map(s => new Date(s!).getTime()).sort((a, b) => a - b);
  let min: number | null = null;
  for (const e of ends) {
    const next = starts.find(s => s > e);
    if (next == null) continue;
    const gap = (next - e) / 3.6e6;
    if (min == null || gap < min) min = gap;
  }
  return min == null ? null : Math.round(min * 10) / 10;
}

// Compute exposure per staff member over whatever window the caller supplied.
//
// Only staff who cross a threshold get flags, but EVERY staff member is returned with their numbers, so a
// caller can show "24 staff, 3 flagged" rather than only the bad news.
export function computeFatigue(shifts: ShiftRow[], thresholds = DEFAULT_THRESHOLDS): FatigueRow[] {
  const byStaff = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    if (!s.staffId || !s.date) continue;
    if (!byStaff.has(s.staffId)) byStaff.set(s.staffId, []);
    byStaff.get(s.staffId)!.push(s);
  }

  return [...byStaff.entries()].map(([staffId, rows]) => {
    const dates = rows.map(r => r.date!).filter(Boolean);
    const withHours = rows.map(hoursOfShift).filter((h): h is number => h != null);
    const hours = withHours.length ? Math.round(withHours.reduce((a, b) => a + b, 0) * 10) / 10 : null;
    const consecutive = consecutiveDays(dates);
    const nights = rows.filter(r => r.shiftType === "night").length;
    const rest = shortestRest(rows);

    const flags: string[] = [];
    if (consecutive >= thresholds.consecutiveDays) flags.push(`${consecutive} consecutive days rostered`);
    if (hours != null && hours >= thresholds.weekHours) flags.push(`${hours}h rostered in the window`);
    if (rest != null && rest < thresholds.restHours) flags.push(`${rest}h between shifts`);
    if (nights >= thresholds.nightRun) flags.push(`${nights} night shifts`);

    // A short rest gap is the sharpest signal (it is a rule breach, not a trend), so it alone reaches high.
    const high = flags.length >= 2 || (rest != null && rest < thresholds.restHours);
    const band: FatigueRow["band"] = flags.length === 0 ? "none" : high ? "high" : "watch";
    return {
      staffId, shifts: rows.length, days: new Set(dates).size, consecutive, nights,
      hours, hoursPartial: withHours.length > 0 && withHours.length < rows.length,
      rest, flags, band,
    };
  }).sort((a, b) => {
    const rank = (r: FatigueRow) => (r.band === "high" ? 0 : r.band === "watch" ? 1 : 2);
    return rank(a) - rank(b) || b.consecutive - a.consecutive;
  });
}

// Tenant/unit-configurable thresholds (UMW-WFM-003 "fatigue thresholds configurable by organisation").
// Fails soft to the defaults, so a missing override store never breaks a safety surface.
export async function resolveFatigueThresholds(admin: any, ctx: ScopeCtx): Promise<{ thresholds: FatigueThresholds; configured: boolean }> {
  try {
    const { provisioned, rows } = await loadConfigOverrides(admin);
    if (!provisioned) return { thresholds: DEFAULT_THRESHOLDS, configured: false };
    const eff = resolveSettings(rows, ctx, FATIGUE_CONFIG_PATH) as any;
    const merged: FatigueThresholds = {
      consecutiveDays: Number(eff?.consecutiveDays) || DEFAULT_THRESHOLDS.consecutiveDays,
      weekHours: Number(eff?.weekHours) || DEFAULT_THRESHOLDS.weekHours,
      restHours: Number(eff?.restHours) || DEFAULT_THRESHOLDS.restHours,
      nightRun: Number(eff?.nightRun) || DEFAULT_THRESHOLDS.nightRun,
    };
    const configured = JSON.stringify(merged) !== JSON.stringify(DEFAULT_THRESHOLDS);
    return { thresholds: merged, configured };
  } catch {
    return { thresholds: DEFAULT_THRESHOLDS, configured: false };
  }
}
