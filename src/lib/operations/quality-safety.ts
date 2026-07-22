// Quality, Safety & Escalation Centre (SSW-QSE-001) loader — the operational safety
// engine. Composes live patient-risk, observation, escalation and safety-alert data
// (op_* / loadOpsConsoleData) with the new incident register (op_incidents) and
// quality-improvement/CAPA store (op_quality_actions). Fail-soft: incidents & CAPA
// report not-provisioned before migration 073; everything else stays live. Trends
// with no per-hour history are honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export const INCIDENT_TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "sentinel", "other"];
export const INCIDENT_STATUSES = ["reported", "investigating", "awaiting_action", "closed"];
export const QUALITY_TYPES = ["capa", "audit_action", "pdsa", "improvement_project", "rca", "policy_review"];
export const QUALITY_TYPE_LABEL: Record<string, string> = { capa: "CAPA", audit_action: "Audit Action", pdsa: "PDSA Cycle", improvement_project: "Improvement Project", rca: "Root Cause Analysis", policy_review: "Policy Review" };
export const QUALITY_STATUSES = ["open", "in_progress", "overdue", "completed"];

export async function loadQualitySafety(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const nowIso = new Date().toISOString();

  const [{ ready, data }, incRes, qaRes] = await Promise.all([
    loadOpsConsoleData(admin, hid, isSuper),
    scope(admin.from("op_incidents").select("id, incident_type, severity, near_miss, status, description, corrective_action, reported_by_name, created_at, op_patients!patient_id(label)")).order("created_at", { ascending: false }).limit(200),
    scope(admin.from("op_quality_actions").select("id, action_type, title, priority, status, owner_name, due_at, created_at")).order("created_at", { ascending: false }).limit(200),
  ]);
  if (!ready) return { ready: false as const };
  const { beds, patients, observations, alerts, escalations, tasks } = data;

  // ── Patient risk ────────────────────────────────────────────────────────────
  const latestObs = new Map<string, any>();
  observations.forEach((o: any) => { const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime(); const c = latestObs.get(o.patient_id); if (!c || t > c._t) latestObs.set(o.patient_id, { ...o, _t: t }); });
  const pews = (pid: string) => latestObs.get(pid)?.ews_score ?? null;
  const deteriorating = [...latestObs.values()].filter((o: any) => o.ews_score != null && o.ews_score >= 5).length;
  const highRisk = patients.filter((p: any) => ["critical", "high"].includes(p.acuity_level) || p.risk_level === "high");
  const isolation = patients.filter((p: any) => p.isolation_status && p.isolation_status !== "none").length;
  const alertCat = (c: string) => alerts.filter((a: any) => a.category === c).length;

  // ── Observations ──────────────────────────────────────────────────────────
  const overdueObs = observations.filter((o: any) => o.status === "overdue").length;
  const recorded = observations.filter((o: any) => o.status === "recorded").length;
  const pending = observations.filter((o: any) => ["due", "overdue"].includes(o.status)).length;
  const obsCompliance = (recorded + pending) ? Math.round((recorded / (recorded + pending)) * 100) : null;

  // ── Escalations ───────────────────────────────────────────────────────────
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const escByStatus = (s: string[]) => escalations.filter((e: any) => s.includes(e.status)).length;
  const escList = openEsc.slice(0, 6).map((e: any) => ({ summary: e.summary || `Escalation L${e.level}`, patient: e.op_patients?.label ?? null, status: e.status, level: e.level, at: e.created_at }));

  // ── Tasks (safety) ────────────────────────────────────────────────────────
  const openTasks = tasks.filter((t: any) => !["completed", "verified", "cancelled"].includes(t.status));
  const overdueSafetyTasks = openTasks.filter((t: any) => t.due_at && t.due_at < nowIso).length;
  const criticalSafetyTasks = openTasks.filter((t: any) => t.priority === "urgent" && t.due_at && t.due_at < nowIso).length;

  // ── Incidents (op_incidents) ──────────────────────────────────────────────
  const incidentsProvisioned = !(incRes.error && missing(incRes.error));
  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];
  const openIncidents = incidents.filter(i => i.status !== "closed");
  const incidentMgmt = {
    open: openIncidents.length, nearMisses: incidents.filter(i => i.near_miss && i.status !== "closed").length,
    investigating: incidents.filter(i => i.status === "investigating").length,
    awaitingAction: incidents.filter(i => i.status === "awaiting_action").length,
    closed: incidents.filter(i => i.status === "closed").length,
    critical: openIncidents.filter(i => i.severity === "critical").length, high: openIncidents.filter(i => i.severity === "high").length,
    recent: incidents.slice(0, 6).map(i => ({ id: i.id, type: i.incident_type, severity: i.severity, status: i.status, desc: i.description, patient: i.op_patients?.label ?? null, at: i.created_at, nearMiss: i.near_miss })),
  };

  // ── Quality actions / CAPA (op_quality_actions) ───────────────────────────
  const qaProvisioned = !(qaRes.error && missing(qaRes.error));
  const qa = (qaRes.error ? [] : qaRes.data ?? []) as any[];
  const qaOpen = qa.filter(a => a.status !== "completed");
  const quality = {
    openCapa: qa.filter(a => a.action_type === "capa" && a.status !== "completed").length,
    overdueActions: qaOpen.filter(a => a.status === "overdue" || (a.due_at && a.due_at < nowIso)).length,
    improvementProjects: qa.filter(a => a.action_type === "improvement_project" && a.status !== "completed").length,
    pdsaCycles: qa.filter(a => a.action_type === "pdsa" && a.status !== "completed").length,
    actionsCompleted: qa.filter(a => a.status === "completed").length,
    recent: qaOpen.slice(0, 6).map(a => ({ id: a.id, type: a.action_type, title: a.title, priority: a.priority, status: a.status, owner: a.owner_name, due: a.due_at })),
  };

  // ── Risk Overview ─────────────────────────────────────────────────────────
  const riskOverview = [
    { label: "Deteriorating Patients", n: deteriorating, tone: "rose" },
    { label: "Overdue Observations", n: overdueObs, tone: "amber" },
    { label: "High Falls Risk", n: alertCat("fall_risk"), tone: "orange" },
    { label: "High Pressure Injury Risk", n: alertCat("pressure_injury"), tone: "orange" },
    { label: "Isolation Precautions", n: isolation, tone: "purple" },
    { label: "Medication Safety Alerts", n: alertCat("medication"), tone: "rose" },
    { label: "Equipment Safety Alerts", n: alertCat("device"), tone: "amber" },
    { label: "Infection Prevention Alerts", n: alertCat("infection"), tone: "orange" },
  ];

  // ── Patient risk heat map (beds → risk band) ──────────────────────────────
  const patientByBed = new Map<string, any>();
  patients.forEach((p: any) => { if (p.bed_id) patientByBed.set(p.bed_id, p); });
  const heatMap = beds.slice(0, 24).map((b: any) => {
    const p = patientByBed.get(b.id);
    let risk = "normal";
    if (p) { const ews = pews(p.id); if (p.acuity_level === "critical" || (ews != null && ews >= 5) || p.risk_level === "high") risk = "high"; else if (p.acuity_level === "high" || p.acuity_level === "moderate" || (ews != null && ews >= 3)) risk = "medium"; else risk = "low"; }
    return { label: b.label, risk };
  });

  // ── Top safety concerns / critical alerts ─────────────────────────────────
  const topConcerns = [
    { label: "Observation compliance", n: overdueObs + pending },
    { label: "Medication errors", n: alertCat("medication") },
    { label: "PEWS escalations", n: escalations.filter((e: any) => e.level >= 4).length },
    { label: "Falls risk", n: alertCat("fall_risk") },
    { label: "Pressure injury risk", n: alertCat("pressure_injury") },
  ].filter(c => c.n > 0).sort((a, b) => b.n - a.n);
  const criticalAlerts = [
    ...escalations.filter((e: any) => e.level >= 4).map((e: any) => ({ title: `PEWS Alert — ${e.op_patients?.label ?? "patient"}`, sub: e.summary ?? "", tone: "high", at: e.created_at })),
    ...alerts.filter((a: any) => ["high", "medium"].includes(a.severity)).map((a: any) => ({ title: `${(a.category ?? "alert").replace(/_/g, " ")} — ${a.op_patients?.label ?? "patient"}`, sub: a.note ?? "", tone: a.severity, at: a.created_at })),
  ].slice(0, 4);

  // ── Overall safety score (composite, derived) ─────────────────────────────
  const factors: number[] = [];
  if (obsCompliance != null) factors.push(obsCompliance);
  factors.push(Math.max(0, 100 - highRisk.length * 4 - deteriorating * 6));
  factors.push(openIncidents.length === 0 ? 100 : Math.max(0, 100 - openIncidents.length * 5));
  factors.push(openEsc.length === 0 ? 100 : Math.max(0, 100 - openEsc.length * 8));
  const safetyScore = mean(factors);

  // ── Clinical governance (derived compliance) ──────────────────────────────
  const govTotal = qa.length || 1;
  const govCompliant = qa.filter(a => a.status === "completed").length;
  const govPartial = qaOpen.filter(a => a.status === "in_progress").length;
  const govNon = qaOpen.filter(a => a.status === "overdue" || (a.due_at && a.due_at < nowIso)).length;
  const governance = { compliancePct: qa.length ? Math.round((govCompliant / govTotal) * 100) : null, compliant: govCompliant, partial: govPartial, non: govNon };

  // ── AI safety insight (rule-based) ─────────────────────────────────────────
  const aiInsights: string[] = [];
  if (deteriorating > 0) aiInsights.push(`${deteriorating} patient${deteriorating > 1 ? "s" : ""} showing early signs of deterioration.`);
  if (obsCompliance != null && obsCompliance < 95) aiInsights.push(`Observation compliance below target (${obsCompliance}%).`);
  if (highRisk.length > 0) aiInsights.push(`Increase monitoring for ${highRisk.length} high-risk patient${highRisk.length > 1 ? "s" : ""}.`);
  if (openEsc.length >= 2) aiInsights.push("Review staffing levels — multiple active escalations.");

  return {
    ready: true as const,
    kpis: {
      safetyScore, highRiskPatients: highRisk.length,
      openIncidents: incidentMgmt.open, incidentsCritical: incidentMgmt.critical, incidentsHigh: incidentMgmt.high,
      escalationsActive: openEsc.length, escNew: escByStatus(["open"]), escInProgress: escByStatus(["acknowledged"]),
      obsCompliance, overdueSafetyTasks, criticalSafetyTasks,
    },
    riskOverview, heatMap, topConcerns, aiInsights, criticalAlerts,
    observation: { compliance: obsCompliance, overdue: overdueObs, patients: patients.length },
    incidentMgmt, incidentsProvisioned,
    escalation: { active: openEsc.length, newThisShift: escByStatus(["open"]), responseOverdue: escalations.filter((e: any) => e.level >= 4 && e.status === "open").length, resolved: escByStatus(["resolved"]), list: escList },
    quality, qaProvisioned, governance,
    safetyScoreTrend: null, // no per-day history — honest
    generatedAt: new Date().toISOString(),
  };
}
