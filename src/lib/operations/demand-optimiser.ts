// Demand Optimiser (WSE-001A) — the AI Scheduling Engine's first module. Converts live
// clinical/operational demand (patient census + acuity + dependency + isolation +
// occupancy) into validated staffing requirements (required FTE by unit/role) that feed
// the Scheduling Engine. Reuses the Establishment engine for the FTE/relief maths, then
// adds the demand-driver breakdown, acuity profile and per-unit demand intensity from
// real op_patients / op_beds data. Acuity time-series (trend history) and forecast
// horizons need historical census (honest next-phase). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const ACUITY_SCORE: Record<string, number> = { critical: 4, high: 3, moderate: 2, stable: 1 };
const ACUITY_LABEL = (v: number) => (v >= 3.5 ? "Critical" : v >= 2.5 ? "High" : v >= 1.5 ? "Moderate" : "Stable");
const DEP_HIGH = new Set(["level_2", "level_3"]);

export async function loadDemandOptimiser(admin: any, hid: string | null, isSuper: boolean) {
  const [est, ops] = await Promise.all([loadEstablishment(admin, hid, isSuper) as Promise<any>, loadOpsConsoleData(admin, hid, isSuper)]);
  if (!est.ready || !ops.ready) return { ready: false as const };
  const { patients, beds } = ops.data;

  const active = patients;
  const totalPatients = active.length;
  const occupied = beds.filter((b: any) => b.status === "occupied").length || totalPatients;
  const highAcuity = active.filter((p: any) => ["critical", "high"].includes(p.acuity_level)).length;
  const isolation = active.filter((p: any) => p.isolation_status && p.isolation_status !== "none").length;
  const highDep = active.filter((p: any) => DEP_HIGH.has(p.dependency_level)).length;

  // Average acuity (1–4)
  const acuitySum = active.reduce((n: number, p: any) => n + (ACUITY_SCORE[p.acuity_level] ?? 1), 0);
  const avgAcuity = totalPatients ? +(acuitySum / totalPatients).toFixed(2) : null;
  const acuityDist = ["critical", "high", "moderate", "stable"].map(a => ({ label: a[0].toUpperCase() + a.slice(1), key: a, n: active.filter((p: any) => p.acuity_level === a).length })).filter(x => x.n > 0);

  // Demand drivers — weighted contribution to total staffing demand
  const contribs = [
    { label: "Base occupancy", value: occupied, contribution: occupied, note: "1 demand unit / occupied bed" },
    { label: "High-acuity uplift", value: highAcuity, contribution: highAcuity, note: "+1 / critical or high patient" },
    { label: "Isolation precautions", value: isolation, contribution: +(isolation * 0.5).toFixed(1), note: "+0.5 / isolated patient" },
    { label: "High dependency", value: highDep, contribution: +(highDep * 0.5).toFixed(1), note: "+0.5 / level 2–3 patient" },
  ].filter(c => c.value > 0);
  const totalDemand = +contribs.reduce((n, c) => n + c.contribution, 0).toFixed(1);
  const drivers = contribs.map(c => ({ ...c, pct: totalDemand ? Math.round((c.contribution / totalDemand) * 100) : 0 })).sort((a, b) => b.contribution - a.contribution);

  // Demand by unit (required per shift + acuity intensity)
  const demandByUnit = est.units.map((u: any) => {
    const up = active.filter((p: any) => (p.departments?.name ?? "Unit") === u.unit);
    const uHigh = up.filter((p: any) => ["critical", "high"].includes(p.acuity_level)).length;
    const uAvg = up.length ? +(up.reduce((n: number, p: any) => n + (ACUITY_SCORE[p.acuity_level] ?? 1), 0) / up.length).toFixed(1) : null;
    const requiredPerShift = u.roleReq.reduce((n: number, r: any) => n + r.perShift, 0);
    const intensity = up.length ? Math.min(100, Math.round((uAvg! / 4) * 60 + (u.occupancyPct ?? 0) * 0.4)) : 0;
    return { unit: u.unit, demandModel: u.demandModel, occupancyPct: u.occupancyPct, patients: up.length, highAcuity: uHigh, avgAcuity: uAvg, requiredPerShift, requiredFte: u.totalFte, intensity };
  }).sort((a: any, b: any) => b.intensity - a.intensity);

  // Role requirements roll-up (from establishment)
  const roleReq = est.requiredVsAvailable.map((r: any) => ({ label: r.label, required: r.required, available: r.available, gap: r.gap }));

  const kpis = {
    totalPatients, totalDemand, avgAcuity, avgAcuityLabel: avgAcuity != null ? ACUITY_LABEL(avgAcuity) : "—",
    requiredFte: est.kpis.totalRequired, availableFte: est.kpis.totalAvailable,
    coverageScore: est.kpis.coverageCompliance, vacancyFte: est.kpis.vacancyFte,
    highAcuity, occupied,
  };

  const insights: { icon: string; text: string; tone: string }[] = [];
  if (drivers[0]) insights.push({ icon: "📊", text: `Top demand driver: ${drivers[0].label} (${drivers[0].pct}% of demand)`, tone: "gray" });
  if (highAcuity) insights.push({ icon: "❤️", text: `${highAcuity} high-acuity patient(s) add ${Math.round((highAcuity / (totalDemand || 1)) * 100)}% to base demand`, tone: "amber" });
  if (est.kpis.vacancyFte > 0) insights.push({ icon: "⚠", text: `Demand exceeds available staff by ${est.kpis.vacancyFte} FTE — gap flagged before roster generation`, tone: "red" });
  if (demandByUnit[0]) insights.push({ icon: "🔥", text: `Highest demand intensity: ${demandByUnit[0].unit} (${demandByUnit[0].intensity}/100)`, tone: "gray" });

  return { ready: true as const, kpis, drivers, demandByUnit, roleReq, acuityDist, insights, totalDemand };
}
