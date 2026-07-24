// Workforce Analytics & Reports (UMW-WFM-008) loader — the analytics/reporting READ layer over
// the WFM suite. It does NOT create source-of-truth transactions; it composes governed data
// from Attendance (WFM-005), Readiness (WFM-007), Exceptions & Approvals (WFM-006) and the Cost
// engine into the Live Overview metrics (§5) with visible status. Trend snapshots, forecasts,
// report definitions and metric-config stores are next-phase. Fail-soft per source.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadAttendance } from "@/lib/operations/attendance";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadWorkforceExceptions } from "@/lib/operations/workforce-exceptions";
import { loadCostEngine } from "@/lib/operations/cost-engine";

export async function loadWorkforceAnalytics(admin: any, hid: string | null, isSuper: boolean) {
  const [att, rdy, exc, cost] = await Promise.all([
    loadAttendance(admin, hid, isSuper) as Promise<any>,
    loadWorkforceReadiness(admin, hid, isSuper) as Promise<any>,
    loadWorkforceExceptions(admin, hid, isSuper) as Promise<any>,
    loadCostEngine(admin, hid, isSuper) as Promise<any>,
  ]);

  const attReady = att.ready;
  const ak = attReady ? att.kpis : null;
  const rk = rdy.ready ? rdy.kpis : null;
  const ek = exc.ready ? exc.kpis : null;
  const ck = (cost.hasRoster) ? cost.kpis : null;

  // WA-OV-001 Workforce position funnel — planned → rostered → attended → deployed → gap
  const expected = ak?.expected ?? 0;
  const present = ak?.present ?? 0;
  const funnel = attReady ? [
    { label: "Planned / rostered", n: expected, tone: "bg-gray-300" },
    { label: "Confirmed", n: (ak?.confirmed ?? 0) + present, tone: "bg-sky-400" },
    { label: "Attended (present)", n: present, tone: "bg-emerald-500" },
    { label: "Deployable", n: present, tone: "bg-emerald-600" },
  ] : [];
  const gap = Math.max(0, expected - present);

  // KPI cards (§5 row 1)
  const kpis = {
    // WA-OV-001/002 coverage
    coveragePct: ak?.coveragePct ?? null, coverageState: ak?.coverageState ?? "—",
    // WA-OV-003 attendance health
    present, expected, absent: ak?.absent ?? 0, late: ak?.late ?? 0, notReported: ak?.notReported ?? 0, presentRate: ak?.presentRate ?? null,
    // WA-OV-004 readiness risk
    fullyDeployable: rk?.fullyDeployable ?? null, requiringSupervision: rk?.requiringSupervision ?? null, readinessScore: rdy.ready ? rdy.score : null, readinessBand: rdy.ready ? rdy.band : "—",
    // WA-OV-005 overtime & premium
    overtimeHours: ck?.overtimeHours ?? null, overtimePremium: ck?.overtimePremium ?? null, totalLabour: ck?.totalLabour ?? null, budgetVariance: ck?.variance ?? null,
    // WA-OV-006 exceptions
    openExceptions: ek?.openExceptions ?? 0, criticalExceptions: ek?.critical ?? 0, overdueExceptions: ek?.overdue ?? 0, escalatedExceptions: ek?.escalated ?? 0,
    gap,
  };

  // WA-OV-009 Top drivers — ranked explainable contributors to the current gap
  const drivers: { label: string; value: number; note: string }[] = [];
  if (ak?.absent) drivers.push({ label: "Absence", value: ak.absent, note: "Confirmed absent this shift" });
  if (gap) drivers.push({ label: "Coverage gap", value: gap, note: "Present below expected" });
  if (rk?.criticalGaps) drivers.push({ label: "Competency gaps", value: rk.criticalGaps, note: "No-coverage / single-person roles" });
  if (ak?.notReported) drivers.push({ label: "Unverified attendance", value: ak.notReported, note: "Not yet reported" });
  if (ek?.critical) drivers.push({ label: "Critical exceptions", value: ek.critical, note: "Open safety/staffing risks" });
  drivers.sort((a, b) => b.value - a.value);

  // WA-OV-011 Data quality — completeness of attendance status
  const dqBasis = expected || 1;
  const verified = present + (ak?.absent ?? 0) + (ak?.confirmed ?? 0);
  const completeness = attReady ? Math.round((verified / dqBasis) * 100) : null;

  // WA-OV-012 Manager narrative — rules-based summary (no invented explanation, §11)
  const narrative: string[] = [];
  if (attReady) narrative.push(`${present}/${expected} present (${ak?.presentRate ?? 0}%), coverage ${kpis.coverageState.toLowerCase()}.`);
  if (rk) narrative.push(`Readiness ${kpis.readinessBand.toLowerCase()} — ${rk.fullyDeployable} fully deployable, ${rk.requiringSupervision} needing supervision.`);
  if (ek?.openExceptions) narrative.push(`${ek.openExceptions} open workforce exceptions (${ek.critical} critical, ${ek.overdue} overdue).`);
  if (ck?.overtimeHours) narrative.push(`${ck.overtimeHours}h overtime this cycle.`);
  if (!narrative.length) narrative.push("No operational workforce data for the current scope.");

  return {
    ready: attReady || rdy.ready || exc.ready, kpis, funnel, drivers, completeness, narrative,
    sources: { attendance: attReady, readiness: rdy.ready, exceptions: exc.ready && exc.apprProvisioned, cost: !!ck },
    roleBreakdown: attReady ? att.roleBreakdown : [], exceptions: exc.ready ? exc.exceptions.slice(0, 8) : [],
  };
}
