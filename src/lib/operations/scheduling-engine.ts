// AI Workforce Scheduling Engine (WSE-001) loader — the platform scheduling service's
// tenant-facing dashboard. Consumes the Establishment engine's demand (required FTE /
// per-shift posts by unit) and live operational data (op_patient_assignments,
// op_shift_staff, competency_decisions) to score coverage, competency match, cost,
// fairness and constraint risk, and to produce rule-based AI recommendations. Every
// number is derived from real inputs + transparent assumptions. The optimising roster
// GENERATOR (assigning named staff to future shift slots) and roster persistence/publish
// need a roster store + solver → honest next-phase; this dashboard is the review surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const AVG_HOURLY_RATE = 25; // configurable planning assumption (£/hr, blended) — surfaced in UI
const AGENCY_MULTIPLIER = 1.8;

export async function loadSchedulingEngine(admin: any, hid: string | null, isSuper: boolean) {
  const [est, ops] = await Promise.all([
    loadEstablishment(admin, hid, isSuper) as Promise<any>,
    loadOpsConsoleData(admin, hid, isSuper),
  ]);
  if (!est.ready || !ops.ready) return { ready: false as const };
  const { patients, assignments } = ops.data;

  // Assigned staff per unit (distinct staff with active assignments to that unit's patients)
  const patientDept = new Map<string, string>();
  for (const p of patients) patientDept.set(p.id, p.departments?.name ?? "Unit");
  const activeAssign = assignments.filter((a: any) => a.status === "active");
  const assignedByUnit = new Map<string, Set<string>>();
  for (const a of activeAssign) { const dn = patientDept.get(a.patient_id) ?? "Unit"; if (!assignedByUnit.has(dn)) assignedByUnit.set(dn, new Set()); assignedByUnit.get(dn)!.add(a.staff_id); }

  // Per-unit demand vs assigned (required = per-shift direct + supervisor posts, real)
  const demandByUnit = est.units.map((u: any) => {
    const requiredPerShift = u.roleReq.reduce((n: number, r: any) => n + r.perShift, 0);
    const assigned = assignedByUnit.get(u.unit)?.size ?? 0;
    const variance = assigned - requiredPerShift;
    const coverage = requiredPerShift ? Math.round((assigned / requiredPerShift) * 100) : null;
    const state = coverage == null ? "—" : coverage >= 100 ? "Fully Covered" : coverage >= 80 ? "At Risk" : "Uncovered";
    return { unit: u.unit, requiredPerShift, assigned, variance, coverage, state, occupancyPct: u.occupancyPct };
  });

  const totalRequired = demandByUnit.reduce((n: number, u: any) => n + u.requiredPerShift, 0);
  const totalAssigned = demandByUnit.reduce((n: number, u: any) => n + u.assigned, 0);
  const fullyCovered = demandByUnit.filter((u: any) => u.state === "Fully Covered").length;
  const atRisk = demandByUnit.filter((u: any) => u.state === "At Risk").length;
  const uncovered = demandByUnit.filter((u: any) => u.state === "Uncovered").length;
  const coverageScore = totalRequired ? Math.round((Math.min(totalAssigned, totalRequired) / totalRequired) * 100) : null;

  // Competency match (real — % active assignments validated)
  const validated = activeAssign.filter((a: any) => a.competency_validated === true).length;
  const partial = activeAssign.filter((a: any) => a.competency_validated === false && a.override_reason).length;
  const noMatch = activeAssign.filter((a: any) => a.competency_validated === false && !a.override_reason).length;
  const competencyScore = activeAssign.length ? Math.round((validated / activeAssign.length) * 100) : null;

  // Cost & efficiency (derived from FTE × transparent rate)
  const availableFte = est.kpis.totalAvailable;
  const weeklyCost = Math.round(availableFte * 37.5 * AVG_HOURLY_RATE);
  const overtimeHrsWk = est.kpis.vacancyFte > 0 ? Math.round(est.kpis.vacancyFte * 37.5) : 0;
  const agencyShifts = est.kpis.vacancyFte > 0 ? Math.ceil(est.kpis.vacancyFte) : 0;
  const agencyCostWk = Math.round(agencyShifts * 12 * AVG_HOURLY_RATE * AGENCY_MULTIPLIER);
  const estCost = weeklyCost + Math.round(overtimeHrsWk * AVG_HOURLY_RATE * 1.5) + agencyCostWk;

  // Fairness (derived from per-unit load balance)
  const loads = demandByUnit.map((u: any) => u.coverage ?? 100);
  const mean = loads.length ? loads.reduce((a: number, b: number) => a + b, 0) / loads.length : 100;
  const spread = loads.length ? Math.round(Math.sqrt(loads.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / loads.length)) : 0;
  const fairnessScore = Math.max(0, 100 - spread);
  const balanced = demandByUnit.filter((u: any) => (u.coverage ?? 100) >= 90 && (u.coverage ?? 100) <= 115).length;
  const highLoad = demandByUnit.filter((u: any) => (u.coverage ?? 100) < 90).length;
  const overLimit = demandByUnit.filter((u: any) => (u.coverage ?? 100) > 130).length;

  // Constraint & risk alerts (derived from real data)
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  let expiringComp = 0;
  try { const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000")); const { data } = await scope(admin.from("competency_decisions").select("expiry_date").gte("expiry_date", today).lte("expiry_date", in14)); expiringComp = (data ?? []).length; } catch { /* fail-soft */ }

  const alerts: { title: string; sub: string; sev: string }[] = [];
  demandByUnit.filter((u: any) => u.state === "Uncovered").forEach((u: any) => alerts.push({ title: `${u.unit} below required coverage`, sub: `${u.coverage}% — action needed`, sev: "High" }));
  if (est.kpis.supervisorAvailable < est.kpis.supervisorRequired) alerts.push({ title: "Shift Supervisor coverage below establishment", sub: `${est.kpis.supervisorAvailable}/${est.kpis.supervisorRequired} charge FTE`, sev: "High" });
  if (expiringComp) alerts.push({ title: `${expiringComp} competenc${expiringComp === 1 ? "y" : "ies"} expiring within 14 days`, sub: "Review affected staff", sev: "Medium" });
  if (noMatch) alerts.push({ title: `${noMatch} assignment(s) without validated competency`, sub: "No override recorded", sev: "Medium" });
  if (spread > 15) alerts.push({ title: "Workload imbalance across units", sub: "Review assignment fairness", sev: "Low" });

  // AI recommendations (rule-based)
  const worst = [...demandByUnit].filter((u: any) => u.coverage != null).sort((a: any, b: any) => (a.coverage ?? 999) - (b.coverage ?? 999))[0];
  const best = [...demandByUnit].filter((u: any) => u.coverage != null).sort((a: any, b: any) => (b.coverage ?? 0) - (a.coverage ?? 0))[0];
  const recs: { title: string; sub: string; tag: string }[] = [];
  if (worst && best && worst.unit !== best.unit && (best.coverage ?? 0) - (worst.coverage ?? 0) > 20) recs.push({ title: `Rebalance staff from ${best.unit} to ${worst.unit}`, sub: `Improves ${worst.unit} coverage (${worst.coverage}%)`, tag: "High Impact" });
  if (overtimeHrsWk) recs.push({ title: `Reduce projected overtime (${overtimeHrsWk} hrs/wk)`, sub: `~£${Math.round(overtimeHrsWk * AVG_HOURLY_RATE * 1.5).toLocaleString()} potential saving`, tag: "Cost" });
  if (est.kpis.supervisorAvailable < est.kpis.supervisorRequired) recs.push({ title: "Assign additional shift supervisor cover", sub: "Meets mandatory leadership requirement", tag: "Supervisor" });
  if (uncovered) recs.push({ title: `Request agency cover for ${uncovered} uncovered unit(s)`, sub: "Coverage risk predicted", tag: "Risk" });
  if (!recs.length) recs.push({ title: "Schedule is balanced", sub: "No optimisation actions required this cycle", tag: "OK" });

  return {
    ready: true as const,
    coverage: { score: coverageScore, fullyCovered, atRisk, uncovered, total: demandByUnit.length },
    demand: { required: totalRequired, assigned: totalAssigned, variance: totalAssigned - totalRequired },
    competency: { score: competencyScore, full: validated, partial, none: noMatch },
    cost: { estCost, weeklyCost, overtimeHrsWk, agencyShifts, rate: AVG_HOURLY_RATE },
    fairness: { score: fairnessScore, balanced, highLoad, overLimit },
    demandByUnit, alerts, recs,
    keyMetrics: { staffAvailableFte: availableFte, assignedFte: totalAssigned, coverageScore, competencyScore, overtimeHrsWk, agencyShifts, estCost, fairnessScore },
    est,
  };
}
