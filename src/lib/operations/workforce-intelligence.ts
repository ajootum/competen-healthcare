// Workforce Intelligence Engine (UMW Platform Engine) — a rule-based, explainable workforce-intelligence
// surface over the live workforce state. Composes loadWorkforceOps (staffing, skill-mix, coverage, gaps,
// absence, float, open shifts) and loadWorkforceReadiness (competency readiness, deployability, dependency
// risks) and derives: a staffing-risk score, predictive alerts, a competency-gap forecast and deployment
// recommendations. Every signal is transparent (shows the rule + data), never a trained model and never
// fabricated — where nothing is stored, it degrades to an honest state. NOT the shift-open readiness
// checklist (readiness.ts) nor the SSW shift-readiness — this is the unit workforce intelligence layer.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export async function loadWorkforceIntelligence(admin: any, hid: string | null, isSuper: boolean) {
  const [w, r] = await Promise.all([
    loadWorkforceOps(admin, hid, isSuper) as Promise<any>,
    loadWorkforceReadiness(admin, hid, isSuper) as Promise<any>,
  ]);
  if (!w.ready) return { ready: false as const };

  const ov = w.overviewTotal ?? { present: 0, planned: 0, required: 0, coverage: null, variance: null };
  const skill = w.skillMix ?? { pct: null, compliant: 0, minor: 0, major: 0, total: 0 };
  const coverage = ov.coverage ?? 100;
  const readinessScore = r.ready ? r.score : null;
  const criticalGaps = r.ready ? (r.kpis?.criticalGaps ?? 0) : (w.kpis?.criticalGaps ?? 0);
  const absence = w.absence?.total ?? 0;
  const openShifts = w.openShifts ?? [];
  const floatAvail = (w.floatPool ?? []).filter((f: any) => f.status === "Available").length;

  // ── Staffing-risk composite (0-100; transparent driver breakdown) ────────────────────────────
  const drivers: { label: string; pts: number }[] = [];
  drivers.push({ label: `Coverage ${coverage}%`, pts: clamp(Math.round((100 - coverage) * 0.4), 0, 35) });
  drivers.push({ label: `${criticalGaps} critical gap(s)`, pts: clamp(criticalGaps * 12, 0, 30) });
  drivers.push({ label: `${absence} absent / on leave`, pts: clamp(absence * 5, 0, 15) });
  if (skill.pct != null) drivers.push({ label: `Skill-mix ${skill.pct}%`, pts: clamp(Math.round((100 - skill.pct) * 0.2), 0, 12) });
  const credExpired = r.ready ? (r.kpis?.credentialsExpired ?? 0) : 0;
  if (credExpired) drivers.push({ label: `${credExpired} expired credential(s)`, pts: clamp(credExpired * 5, 0, 10) });
  const riskScore = clamp(drivers.reduce((n, d) => n + d.pts, 0));
  const riskBand = riskScore >= 60 ? "High" : riskScore >= 30 ? "Elevated" : "Low";

  // ── Predictive alerts (rule-based, from live state) ──────────────────────────────────────────
  const alerts: { title: string; detail: string; severity: "high" | "medium" }[] = [];
  const worstRole = [...(w.staffingOverview ?? [])].filter((x: any) => x.coverage != null).sort((a: any, b: any) => (a.coverage ?? 999) - (b.coverage ?? 999))[0];
  if (worstRole && worstRole.coverage != null && worstRole.coverage < 100) alerts.push({ title: `${worstRole.label} coverage ${worstRole.coverage}%`, detail: `${worstRole.present}/${worstRole.required ?? "—"} on shift — shortfall likely to drive overtime`, severity: worstRole.coverage < 75 ? "high" : "medium" });
  if (w.kpis?.criticalGaps) alerts.push({ title: `${w.kpis.criticalGaps} critical staffing gap(s)`, detail: "Immediate reallocation needed to maintain safe cover", severity: "high" });
  const breaksDue = w.breaks?.provisioned && !("error" in (w.breaks ?? {})) ? (w.breaks.due ?? 0) : null;
  if (breaksDue) alerts.push({ title: `${breaksDue} break(s) due soon`, detail: "Relief cover needed to avoid uncovered periods", severity: "medium" });
  if (absence) alerts.push({ title: `${absence} staff absent / on leave`, detail: "Reduced deployable pool today", severity: "medium" });
  if (openShifts.length) alerts.push({ title: `${openShifts.length} role(s) under-staffed`, detail: openShifts.map((u: any) => `${u.role} (-${u.positions})`).slice(0, 3).join(", "), severity: "high" });

  // ── Competency-gap forecast (from readiness dependency risks) ─────────────────────────────────
  const forecast = r.ready ? (r.risks ?? []).slice(0, 6) : [];

  // ── Deployment recommendations (rule-based, explainable) ─────────────────────────────────────
  const recs: { text: string; why: string; priority: "high" | "medium" | "low" }[] = [];
  if (worstRole && worstRole.coverage != null && worstRole.coverage < 100 && floatAvail) recs.push({ text: `Deploy ${Math.min(floatAvail, Math.max(1, -(worstRole.variance ?? 1)))} of ${floatAvail} available float staff to ${worstRole.label}`, why: `${worstRole.label} is the lowest-covered role (${worstRole.coverage}%)`, priority: "high" });
  if (r.ready && (r.singleDep ?? []).length) recs.push({ text: `Cross-train a second competent staff member for ${r.singleDep[0].label}`, why: "Single-person dependency concentrates operational risk", priority: "high" });
  if (skill.pct != null && skill.pct < 85) recs.push({ text: `Prioritise competency development — skill-mix is ${skill.pct}%`, why: "Below the 85% optimal skill-mix threshold", priority: "medium" });
  if (r.ready && (r.kpis?.renewalDue ?? 0)) recs.push({ text: `Schedule renewal for ${r.kpis.renewalDue} staff with expiring competency`, why: "Prevents deployability dropping as validations lapse", priority: "medium" });
  if (!recs.length) recs.push({ text: "Workforce is balanced — no reallocation required this shift.", why: "Coverage, skill-mix and dependency are within thresholds", priority: "low" });

  // ── Intelligence KPIs ────────────────────────────────────────────────────────────────────────
  const kpis = {
    intelligenceScore: clamp(Math.round(((readinessScore ?? coverage) + coverage + (skill.pct ?? coverage)) / 3)),
    readiness: readinessScore,
    coverage,
    skillMix: skill.pct,
    deployable: r.ready ? (r.kpis?.fullyDeployable ?? null) : null,
    criticalGaps,
    riskScore, riskBand,
  };

  return {
    ready: true as const,
    provisioned: r.ready ? r.provisioned !== false : false,
    kpis, drivers: drivers.filter(d => d.pts > 0).sort((a, b) => b.pts - a.pts),
    alerts, forecast, recs,
    staffingOverview: w.staffingOverview ?? [],
    floatAvail, openShifts,
  };
}
