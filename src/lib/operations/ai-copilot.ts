// AI Operational Copilot (SSW-AI-001) loader — the decision-support intelligence
// layer. Reuses loadOperationalIntelligence (one derivation pass) and reframes it
// as eight AI modules with risk labels, prioritised recommendations, an explainable
// "why", derived confidence and the AI-agent roster. All heuristic/rule-based and
// consumed live from the operational engines — recommendations are proposals for a
// human to accept, and acting on them routes through the audited surfaces.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOperationalIntelligence } from "@/lib/operations/operational-intelligence";

const risk = (n: number, hi: number, mid: number) => (n >= hi ? "High" : n >= mid ? "Medium" : "Low");

export async function loadAiCopilot(admin: any, hid: string | null, isSuper: boolean) {
  const oi: any = await loadOperationalIntelligence(admin, hid, isSuper);
  if (!oi.ready) return { ready: false as const };
  const { kpis, workforce, patient, safety, scorecard, forecast, raw } = oi;

  const coverage = workforce.coverage;
  const staffingGapWte = Math.max(0, (workforce.planned ?? 0) - (workforce.onDuty ?? 0));
  const competencyGap = workforce.skillMix.filter((r: any) => r.coverage != null && r.coverage < 100).length;
  const skillMixAvg = (() => { const cs = workforce.skillMix.map((r: any) => r.coverage).filter((v: any) => v != null); return cs.length ? Math.round(cs.reduce((a: number, b: number) => a + b, 0) / cs.length) : null; })();
  const opScore = scorecard.find((c: any) => c.label === "Operational Efficiency")?.pct ?? null;
  const patientSafety = raw.patientSafety;

  // ── Command Centre / risks ──────────────────────────────────────────────────
  const staffingRisk = coverage == null ? "—" : coverage < 80 ? "High" : coverage < 100 ? "Medium" : "Low";
  const capacityRisk = (kpis.capacity ?? 0) >= 90 ? "High" : (kpis.capacity ?? 0) >= 80 ? "Medium" : "Low";
  // Confidence scales with how much live data backs the picture.
  const aiConfidence = Math.min(95, 78 + Math.min(12, Math.round((patient.census + workforce.onDuty) / 6)));

  const topPriorities: { text: string; href: string }[] = [];
  if (patient.highRisk > 0) topPriorities.push({ text: `Review ${patient.highRisk} high-risk patient${patient.highRisk > 1 ? "s" : ""}`, href: "/supervisor/quality-safety" });
  if (coverage != null && coverage < 100) topPriorities.push({ text: "Address staffing gap", href: "/supervisor/workforce-operations" });
  if (raw.openEsc > 0) topPriorities.push({ text: `Follow up ${raw.openEsc} escalation${raw.openEsc > 1 ? "s" : ""}`, href: "/supervisor/operations?section=safety" });

  // ── Prioritised recommendations (right rail) ────────────────────────────────
  const recs: { title: string; sub: string; priority: string; href: string }[] = [];
  if (patient.pewsEscalations > 0) recs.push({ title: `Review ${patient.pewsEscalations} high-risk patient${patient.pewsEscalations > 1 ? "s" : ""}`, sub: "Early signs of deterioration detected", priority: "Immediate", href: "/supervisor/quality-safety" });
  if (coverage != null && coverage < 80) recs.push({ title: "Staffing support needed", sub: "A ward is below safe staffing level", priority: "High", href: "/supervisor/workforce-operations" });
  if (raw.openEsc >= 2) recs.push({ title: "Follow up escalations", sub: `${raw.openEsc} escalations require attention`, priority: "Medium", href: "/supervisor/operations?section=safety" });
  if (safety.medicationErrors > 0 || (oi.observation?.overdue ?? raw.overdueTasks) > 0) recs.push({ title: "Observation compliance", sub: "Overdue observations need review", priority: "Medium", href: "/supervisor/quality-safety" });
  if ((kpis.capacity ?? 0) >= 85) recs.push({ title: "Bed capacity pressure", sub: "Consider discharge planning", priority: "Medium", href: "/supervisor/patient-ops-center" });

  // ── Explainable AI — the single highest-impact recommendation ───────────────
  const belowRole = workforce.skillMix.find((r: any) => r.coverage != null && r.coverage < 100);
  let explain: any = null;
  if (belowRole && workforce.available > 0) {
    explain = {
      recommendation: `Redeploy a staff member to cover ${belowRole.role}`, impact: "High",
      why: [`${belowRole.role} coverage at ${belowRole.coverage}%`, `${workforce.available} staff available in the pool`, `Ward capacity ${kpis.capacity ?? "—"}%`],
      confidence: Math.min(93, aiConfidence + 2), alternative: "Request a bank/agency shift", outcome: "Restore safe skill-mix for the shift",
    };
  } else if (patient.pewsEscalations > 0) {
    explain = {
      recommendation: `Prioritise clinical review of ${patient.pewsEscalations} deteriorating patient(s)`, impact: "High",
      why: [`PEWS ≥ 5 for ${patient.pewsEscalations} patient(s)`, `${patient.highRisk} high-risk patients on the unit`, `${raw.openEsc} active escalation(s)`],
      confidence: aiConfidence, alternative: "Increase observation frequency", outcome: "Earlier intervention, reduced deterioration risk",
    };
  }

  // ── AI insights feed ────────────────────────────────────────────────────────
  const feed = [
    ...(patient.pewsEscalations > 0 ? [{ tone: "high", text: `High risk: ${patient.pewsEscalations} patients showing early signs`, sub: "Review PEWS and observations" }] : []),
    ...(coverage != null && coverage < 100 ? [{ tone: "amber", text: "Staffing gap in this shift", sub: `Coverage ${coverage}% against required` }] : []),
    ...((kpis.capacity ?? 0) >= 85 ? [{ tone: "blue", text: "Capacity pressure expected", sub: `Occupancy ${kpis.capacity}%` }] : []),
    ...(kpis.taskCompletion != null ? [{ tone: "green", text: `Task completion ${kpis.taskCompletion}%`, sub: `${kpis.completedTasks}/${kpis.totalTasks} tasks` }] : []),
  ].slice(0, 4);

  // ── AI agents (service roster) ──────────────────────────────────────────────
  const agents = ["Workforce AI Agent", "Patient Risk AI Agent", "Safety AI Agent", "Capacity AI Agent", "Escalation AI Agent", "Task Intelligence Agent", "Predictive Analytics Engine", "Recommendation Engine"];

  // ── AI shift summary ────────────────────────────────────────────────────────
  const summaryBits = [
    kpis.pressureLabel === "High" ? "Shift under pressure" : "Shift is stable with some pressure points.",
    patient.highRisk > 0 ? `${patient.highRisk} high-risk patients require review.` : null,
    coverage != null && coverage < 100 ? `Staffing gap may increase workload.` : null,
    raw.openEsc > 0 ? `${raw.openEsc} escalations in progress.` : null,
  ].filter(Boolean);

  return {
    ready: true as const, shift: oi.shift,
    command: { healthScore: kpis.healthScore, pressure: kpis.pressure, pressureLabel: kpis.pressureLabel, topPriorities, criticalPatients: kpis.criticalAlerts, staffingRisk, capacityRisk, aiConfidence },
    workforceAi: { safeStaffingScore: coverage, staffingGapWte, competencyGap, fatigueRisk: risk(workforce.breakOverdue, 3, 1), skillMixCoverage: skillMixAvg, redeployment: workforce.available },
    patientAi: { highRisk: patient.highRisk, deterioration: patient.pewsEscalations, pewsLikely: patient.pewsEscalations, icuTransfer: patient.critical, delayedDischarge: patient.delayedDischarges, wardCongestion: (kpis.capacity ?? 0) >= 85 ? "High" : (kpis.capacity ?? 0) >= 70 ? "Medium" : "Low" },
    safetyAi: { safetyScore: patientSafety, obsComplianceRisk: risk(raw.overdueTasks, 5, 1), medicationRisk: risk(safety.medicationErrors, 2, 1), fallsRisk: risk(safety.falls, 3, 1), pressureInjuryRisk: risk(safety.pressureInjuries, 3, 1), openAlerts: safety.escalations + (kpis.criticalAlerts ?? 0) },
    operationalAi: { operationalScore: opScore, workflowBottlenecks: Math.min(9, Math.round(raw.overdueTasks / 3)), taskDelays: raw.overdueTasks, escalations: raw.openEsc, commsLoad: risk(kpis.commsResponse == null ? 0 : 100 - kpis.commsResponse, 40, 20), bedUtilisation: kpis.capacity },
    predictive: forecast,
    recs, explain, feed, agents,
    summary: summaryBits.join(" "),
    generatedAt: new Date().toISOString(),
  };
}
