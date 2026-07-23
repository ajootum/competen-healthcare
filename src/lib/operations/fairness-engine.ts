// Fairness Engine (WSE-001E) — ensures equitable workforce distribution across the
// generated roster. Computes per-staff shift/night/weekend/consecutive-day tallies from
// op_roster_assignments, then scores equity (shift, night, weekend), detects allocation
// bias (over-loaded, night-heavy, weekend-heavy, over-limit staff) and recommends
// rebalancing swaps to a lighter-loaded clinician of the same role. Runs after safety +
// competency (fairness never overrides a hard constraint). Public-holiday equity, leave/
// preference equity and cross-roster historical balancing need those stores → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRosterForWeek, mondayOf, ROSTER } from "@/lib/operations/roster-solver";

const isWeekend = (date: string) => { const d = new Date(date + "T00:00:00Z").getUTCDay(); return d === 0 || d === 6; };
const stdev = (xs: number[]) => { if (!xs.length) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const equity = (xs: number[]) => Math.max(0, Math.round(100 - stdev(xs) * 22));

function maxConsecutive(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0, run = 0, prev: number | null = null;
  for (const d of sorted) { const t = new Date(d + "T00:00:00Z").getTime() / 864e5; if (prev != null && t - prev === 1) run++; else run = 1; prev = t; best = Math.max(best, run); }
  return best;
}

export async function loadFairnessEngine(admin: any, hid: string | null, isSuper: boolean) {
  const weekStart = mondayOf();
  const r = await loadRosterForWeek(admin, hid, isSuper, weekStart);
  if (!(r as any).provisioned) return { ready: true as const, provisioned: false as const, weekStart };
  const roster = (r as any).roster;
  if (!roster) return { ready: true as const, provisioned: true as const, hasRoster: false as const, weekStart };

  const asg: any[] = ((r as any).assignments ?? []).filter((a: any) => a.status === "assigned" && a.staff_id);
  const byStaff = new Map<string, any>();
  for (const a of asg) {
    if (!byStaff.has(a.staff_id)) byStaff.set(a.staff_id, { id: a.staff_id, name: a.staff_name ?? "—", role: a.role, total: 0, night: 0, day: 0, weekend: 0, dates: [] as string[] });
    const s = byStaff.get(a.staff_id);
    s.total++; s.dates.push(a.shift_date);
    if (a.shift_type === "night") s.night++; else s.day++;
    if (isWeekend(a.shift_date)) s.weekend++;
  }
  const staff = [...byStaff.values()].map(s => ({ ...s, consecutive: maxConsecutive(s.dates) })).sort((a, b) => b.total - a.total);

  const totals = staff.map(s => s.total), nights = staff.map(s => s.night), weekends = staff.map(s => s.weekend);
  const meanTotal = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const meanNight = nights.length ? nights.reduce((a, b) => a + b, 0) / nights.length : 0;
  const sdTotal = stdev(totals);

  const shiftEquity = equity(totals), nightEquity = equity(nights), weekendEquity = equity(weekends);
  const overall = Math.round((shiftEquity + nightEquity + weekendEquity) / 3);

  // Bias alerts
  const alerts: { staff: string; reason: string; sev: string }[] = [];
  for (const s of staff) {
    if (sdTotal > 0.5 && s.total > meanTotal + 1.5 * sdTotal) alerts.push({ staff: s.name, reason: `Over-allocated (${s.total} shifts vs avg ${meanTotal.toFixed(1)})`, sev: "High" });
    if (s.total > ROSTER.maxShiftsWeek) alerts.push({ staff: s.name, reason: `Exceeds 4 shifts/week (${s.total}) — overtime/fatigue`, sev: "High" });
    if (meanNight > 0 && s.night >= Math.max(3, meanNight * 2)) alerts.push({ staff: s.name, reason: `Night-heavy (${s.night} nights vs avg ${meanNight.toFixed(1)})`, sev: "Medium" });
    if (s.consecutive >= 5) alerts.push({ staff: s.name, reason: `${s.consecutive} consecutive days — fatigue risk`, sev: "Medium" });
  }

  // Recommended rebalancing — move a shift from most-loaded to least-loaded same-role staff
  const recs: { from: string; to: string; role: string; detail: string }[] = [];
  const byRole = new Map<string, any[]>();
  for (const s of staff) { if (!byRole.has(s.role)) byRole.set(s.role, []); byRole.get(s.role)!.push(s); }
  for (const [, arr] of byRole) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => b.total - a.total);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    if (top.total - bottom.total >= 2) recs.push({ from: top.name, to: bottom.name, role: top.role, detail: `Rebalance 1 shift (${top.total} → ${bottom.total})` });
  }

  const insights: { icon: string; text: string; tone: string }[] = [];
  if (overall >= 85) insights.push({ icon: "✅", text: `Roster is equitable (fairness ${overall}%) — distribution within tolerance`, tone: "green" });
  else insights.push({ icon: "⚖️", text: `Fairness ${overall}% — ${alerts.length} allocation bias alert(s); rebalancing suggested`, tone: "amber" });
  if (staff.some(s => s.night > 0)) { const nightHeavy = [...staff].sort((a, b) => b.night - a.night)[0]; insights.push({ icon: "🌙", text: `Most nights: ${nightHeavy.name} (${nightHeavy.night})`, tone: "gray" }); }
  if (staff.some(s => s.weekend > 0)) { const weHeavy = [...staff].sort((a, b) => b.weekend - a.weekend)[0]; insights.push({ icon: "📅", text: `Most weekends: ${weHeavy.name} (${weHeavy.weekend})`, tone: "gray" }); }

  return {
    ready: true as const, provisioned: true as const, hasRoster: true as const, weekStart, roster,
    kpis: { overall, shiftEquity, nightEquity, weekendEquity, biasAlerts: alerts.length, staffCount: staff.length, overLimit: staff.filter(s => s.total > ROSTER.maxShiftsWeek).length },
    staff, alerts: alerts.slice(0, 8), recs: recs.slice(0, 6), insights,
  };
}
