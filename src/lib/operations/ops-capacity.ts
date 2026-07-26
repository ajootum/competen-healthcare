// UMW-OPC-003 Capacity & Bed Coordination Centre loader. The live bed/capacity picture over op_beds (+ op_patients
// for occupancy detail, op_flow_blockers for the waiting list, op_ops_snapshots for occupancy trend / turnover /
// forecast, op_resources for support capacity). Computes the KPI ribbon, capacity-mix donut, occupancy trend, beds
// by category (bed_type), the ward bed-status map, the bed-request/waiting list (expected admissions + no-bed
// blockers), the bed-turnover centre, a naive next-day forecast and threshold-derived capacity alerts. Read-only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, pct, delta } from "./ops-shared";

const CATS: { label: string; types: string[] }[] = [
  { label: "General Beds", types: ["standard", "overflow"] },
  { label: "Critical Care", types: ["critical_care"] },
  { label: "Isolation", types: ["isolation"] },
  { label: "Paediatric", types: ["paediatric"] },
  { label: "Theatre / Recovery", types: ["theatre", "recovery"] },
];

export async function loadCapacityCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { beds, patients, blockers, resources, cur, prev } = c;

  const by = (s: string) => beds.filter(b => b.status === s).length;
  const totalBeds = beds.length;
  const occupied = by("occupied"), available = by("available"), cleaning = by("cleaning"), reserved = by("reserved"), oos = by("out_of_service");
  const occupancy = totalBeds ? pct(occupied, totalBeds) : (cur.occupancy_pct ?? 0);
  const predictedAvailability = Math.max(0, available + (cur.discharges ?? 0) - (cur.admissions ?? 0));

  const kpis = {
    totalBeds, occupied, occupancy, available, cleaning, reserved, oos,
    predictedAvailability,
    admissionsToday: cur.admissions ?? null, dischargesToday: cur.discharges ?? null,
    occDelta: delta(cur.occupancy_pct, prev.occupancy_pct),
    availDelta: delta(available, null),
  };

  const overview = [
    { label: "Occupied", n: occupied, color: "#22c55e" },
    { label: "Available", n: available, color: "#3b82f6" },
    { label: "Cleaning", n: cleaning, color: "#f59e0b" },
    { label: "Reserved", n: reserved, color: "#a855f7" },
    { label: "Out of Service", n: oos, color: "#64748b" },
  ];

  // Beds by category (bed_type). Only categories present in this unit.
  const byCategory = CATS.map(cat => {
    const set = beds.filter(b => cat.types.includes(b.bed_type ?? "standard"));
    const occ = set.filter(b => b.status === "occupied").length;
    return { label: cat.label, total: set.length, occupied: occ, available: set.filter(b => b.status === "available").length, pct: pct(occ, set.length) };
  }).filter(c2 => c2.total > 0);

  // Ward bed-status map (colour by operational bed status).
  const bedGrid = beds.slice(0, 30).map(b => ({ label: b.label, status: b.status }));

  // Bed requests / waiting list — expected admissions + no-bed flow blockers (no dedicated request store yet).
  const expected = patients.filter(p => p.operational_status === "expected");
  const noBed = blockers.filter(b => b.category === "no_bed");
  const waiting = [
    ...expected.slice(0, 4).map(p => ({ label: p.label, source: "Expected admission", priority: p.risk_level === "high" ? "High" : "Medium", at: p.created_at })),
    ...noBed.slice(0, 3).map(b => ({ label: b.detail ?? "Awaiting bed", source: "No bed available", priority: "High", at: b.created_at })),
  ].slice(0, 6);

  // Bed turnover centre.
  const turnover = {
    dischargesToday: cur.discharges ?? null,
    avgCleaningMins: null, // no per-bed cleaning-duration store — shown as "—"
    turnoverTarget: 3,
    bedTurnover: cur.bed_turnover != null ? Number(cur.bed_turnover) : null,
    pendingCleaning: cleaning,
    beforeNoonPct: cur.discharge_before_noon_pct ?? null,
  };

  // Support resources (theatres, transport, etc.).
  const supportResources = resources.map(r => ({ name: r.name, category: r.category, total: r.total, available: r.available, demand: r.demand }));

  // Occupancy trend + naive forecast from daily snapshots.
  const trend = c.daily.slice(-12).map((s: any) => Number(s.occupancy_pct) || 0);
  const forecast = c.daily.slice(-4).map((s: any) => ({ label: s.period, occupancy: s.occupancy_pct, admissions: s.admissions, discharges: s.discharges }));

  // Threshold-derived capacity alerts.
  const alerts: { tone: string; title: string; sub: string }[] = [];
  if (occupancy >= 90) alerts.push({ tone: "rose", title: "High Occupancy", sub: `Current occupancy ${occupancy}% — above 90% threshold` });
  if (available <= Math.max(1, Math.round(totalBeds * 0.05))) alerts.push({ tone: "amber", title: "Low Availability", sub: `Only ${available} bed${available === 1 ? "" : "s"} available` });
  if (cleaning >= 2) alerts.push({ tone: "amber", title: "Cleaning Backlog", sub: `${cleaning} beds awaiting cleaning` });
  if ((cur.admissions ?? 0) > (cur.discharges ?? 0)) alerts.push({ tone: "amber", title: "Admission Surge", sub: `${cur.admissions} admissions vs ${cur.discharges} discharges (snapshot)` });
  if (predictedAvailability > available) alerts.push({ tone: "emerald", title: "Discharge Opportunity", sub: `+${predictedAvailability - available} beds expected from planned discharges` });

  return { provisioned: true as const, hasData: c.hasData, kpis, overview, byCategory, bedGrid, waiting, turnover, supportResources, trend, forecast, alerts, asOf: cur.period ?? null };
}
