// UMW-OPC-009 Operational Forecasting & Predictive Intelligence loader. Builds naive projections from the real
// op_ops_snapshots daily history (admissions / discharges / occupancy / LOS / staffing / escalation-rate), a live ICU
// occupancy from critical_care beds, a staffing forecast from snapshot required/available FTE, flow bottlenecks from
// op_flow_blockers, a composite operational-risk score, template scenario multipliers over the data-derived baseline
// and rule-based recommendations. Forecasts are naive (recent-mean + trend) and labelled as such — never presented as
// a trained model. Forecast accuracy has no predicted-vs-actual store and is surfaced as illustrative. Read-only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, pct } from "./ops-shared";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function loadForecastCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { daily, beds, blockers, cur } = c;

  const hist = daily.slice(-14);
  const num = (k: string, arr = hist) => arr.map((s: any) => Number(s[k]) || 0);
  const recent = (k: string, n = 5) => num(k).slice(-n);

  // Naive next-period projection (recent mean).
  const predAdmissions = Math.round(mean(recent("admissions")));
  const predDischarges = Math.round(mean(recent("discharges")));
  const predOccupancy = Math.round(mean(recent("occupancy_pct")));
  const predLos = r1(mean(recent("avg_los")));
  const escRate = mean(recent("escalation_rate"));

  // Live ICU occupancy from critical_care beds (real, not forecast).
  const icuBeds = beds.filter(b => b.bed_type === "critical_care");
  const icuOcc = icuBeds.length ? pct(icuBeds.filter(b => b.status === "occupied").length, icuBeds.length) : null;
  const staffCoverage = cur.safe_staffing_score ?? (cur.required_fte && cur.available_fte ? pct(Number(cur.available_fte), Number(cur.required_fte)) : null);
  const escalationRisk = escRate >= 5 ? "High" : escRate >= 3 ? "Medium" : "Low";

  const kpis = {
    predAdmissions, predDischarges, predLos,
    bedOccupancy: predOccupancy, icuOccupancy: icuOcc,
    staffingCoverage: staffCoverage != null ? Math.round(Number(staffCoverage)) : null,
    escalationRisk,
  };

  // Volume forecast series (history + naive projected tail).
  const volume = hist.map((s: any) => ({ label: String(s.period).slice(5), admissions: Number(s.admissions) || 0, discharges: Number(s.discharges) || 0, net: (Number(s.admissions) || 0) - (Number(s.discharges) || 0), forecast: false }));
  for (let i = 1; i <= 3; i++) volume.push({ label: `+${i}d`, admissions: predAdmissions, discharges: predDischarges, net: predAdmissions - predDischarges, forecast: true });
  const occupancySeries = num("occupancy_pct");

  // Staffing forecast from snapshot required/available FTE.
  const staffing = hist.slice(-7).map((s: any) => { const req = Number(s.required_fte) || 0, avail = Number(s.available_fte) || 0; return { label: String(s.period).slice(5), required: Math.round(req), available: Math.round(avail), gap: Math.round(avail - req) }; });

  // Composite operational risk score.
  const riskScore = Math.min(100, Math.round((predOccupancy >= 95 ? 45 : predOccupancy >= 88 ? 30 : 12) + escRate * 4 + (icuOcc && icuOcc >= 90 ? 20 : 0) + blockers.length * 1.5));

  // Flow bottlenecks from live blockers.
  const blkGroup = blockers.reduce((acc: Record<string, number>, b) => { acc[b.category] = (acc[b.category] ?? 0) + 1; return acc; }, {});
  const bottlenecks = Object.entries(blkGroup).map(([k, n]) => ({ label: String(k).replace(/_/g, " "), n, impact: (n as number) >= 5 ? "High" : (n as number) >= 2 ? "Medium" : "Low" })).sort((a, b) => (b.n as number) - (a.n as number)).slice(0, 6);

  // Data-derived drivers.
  const drivers: string[] = [];
  const admTrend = mean(recent("admissions", 3)) - mean(num("admissions").slice(0, 3));
  if (admTrend > 0) drivers.push(`Admissions trending up (+${r1(admTrend)}/day vs early period).`);
  if (icuOcc != null && icuOcc >= 85) drivers.push(`ICU occupancy high at ${icuOcc}% — step-down capacity constrained.`);
  if (escRate >= 3) drivers.push(`Escalation rate elevated (${r1(escRate)}) — monitor deterioration.`);
  if (!drivers.length) drivers.push("No dominant demand drivers in the recent window.");

  // Scenario planner — template multipliers over the data-derived baseline.
  const baseCensus = predOccupancy;
  const scenarios = [
    { name: "Baseline", admissions: predAdmissions, occ: predOccupancy, gap: staffing.at(-1)?.gap ?? 0, risk: riskScore },
    { name: "High Demand", admissions: Math.round(predAdmissions * 1.25), occ: Math.min(120, Math.round(baseCensus * 1.14)), gap: (staffing.at(-1)?.gap ?? 0) - 6, risk: Math.min(100, riskScore + 20) },
    { name: "Low Demand", admissions: Math.round(predAdmissions * 0.85), occ: Math.round(baseCensus * 0.9), gap: (staffing.at(-1)?.gap ?? 0) + 3, risk: Math.max(0, riskScore - 15) },
    { name: "Flu / Surge", admissions: Math.round(predAdmissions * 1.4), occ: Math.min(130, Math.round(baseCensus * 1.3)), gap: (staffing.at(-1)?.gap ?? 0) - 12, risk: Math.min(100, riskScore + 30) },
  ];

  // Predictive alerts + recommendations.
  const alerts: { tone: string; title: string; sub: string }[] = [];
  if (predOccupancy >= 92) alerts.push({ tone: "rose", title: "High Bed Occupancy Risk", sub: `~${predOccupancy}% occupancy projected next period` });
  if (icuOcc != null && icuOcc >= 90) alerts.push({ tone: "rose", title: "ICU Capacity Risk", sub: `ICU at ${icuOcc}% — step-down transfers advised` });
  if (staffing.at(-1)?.gap != null && (staffing.at(-1)!.gap) < 0) alerts.push({ tone: "amber", title: "Staffing Shortfall Predicted", sub: `${Math.abs(staffing.at(-1)!.gap)} FTE gap on recent trend` });
  if (escalationRisk !== "Low") alerts.push({ tone: "amber", title: "Escalation Trend", sub: `Escalation risk ${escalationRisk.toLowerCase()}` });
  if (!alerts.length) alerts.push({ tone: "emerald", title: "No forecast risks", sub: "Projected demand within capacity" });

  const recs: string[] = [];
  if (predOccupancy >= 92) recs.push("Expedite discharges to open capacity ahead of predicted peak.");
  if (icuOcc != null && icuOcc >= 90) recs.push("Prioritise ICU step-down transfers to free critical-care beds.");
  if ((staffing.at(-1)?.gap ?? 0) < 0) recs.push("Book float/agency cover for the predicted staffing gap.");
  if (predDischarges > predAdmissions) recs.push("Net discharges positive — plan bed reallocation.");
  if (!recs.length) recs.push("No pre-emptive action required on current forecast.");

  return { provisioned: true as const, hasData: hist.length > 0, historyDays: daily.length, kpis, volume, occupancySeries, staffing, riskScore, bottlenecks, drivers, scenarios, alerts, recs, asOf: cur.period ?? null };
}
