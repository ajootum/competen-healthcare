// UMW-OPC-006 Safety & Escalation Oversight loader. The live safety picture over op_safety_alerts (categories /
// severity / active) + op_escalations (levels / status / timing) + op_patients (risk level, isolation) + op_beds (for
// the risk hotspot map). Computes the KPI ribbon, risk-level donut, patient-safety highlights by category, the
// escalation summary with real resolution timing, a live alert feed, incidents-by-type, a 7-day incident trend,
// escalations-in-progress with elapsed time, a workflow-stage rollup and a bed-level risk hotspot. Read-only lens.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, sev, nowMs } from "./ops-shared";

const CAT_LABEL: Record<string, string> = { fall_risk: "Falls Risk", deterioration: "Deteriorating", pressure_injury: "Pressure Injury", infection: "Infection Control", medication: "Medication Risk", device: "Device / Equipment", environmental: "Environmental", patient_id: "Patient ID" };

export async function loadSafetyCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { safety, escalations, patients, beds } = c;
  const startToday = new Date(new Date(nowMs()).toISOString().slice(0, 10) + "T00:00:00Z").toISOString();

  const active = safety.filter(s => s.active);
  const todaySafety = safety.filter(s => s.created_at >= startToday);
  const openEsc = escalations.filter(e => ["open", "acknowledged"].includes(e.status));
  const resolvedToday = escalations.filter(e => e.status === "resolved" && e.resolved_at && e.resolved_at >= startToday);

  // Resolution timing (real, from resolved escalations in the window).
  const resolvedAll = escalations.filter(e => e.resolved_at && e.created_at);
  const avgResolveMin = resolvedAll.length ? Math.round(resolvedAll.reduce((a, e) => a + (new Date(e.resolved_at).getTime() - new Date(e.created_at).getTime()) / 60000, 0) / resolvedAll.length) : null;

  // Risk-level donut (operational patients).
  const risk = (l: string) => patients.filter(p => p.risk_level === l).length;
  const riskOverview = [
    { label: "High", n: risk("high"), color: "#f43f5e" },
    { label: "Medium", n: risk("medium"), color: "#f59e0b" },
    { label: "Low", n: risk("low"), color: "#22c55e" },
  ];
  const totalRisk = patients.length;

  // Patient-safety highlights by active alert category (+ isolation patients).
  const catCount = (cat: string) => active.filter(s => s.category === cat).length;
  const highlights = [
    { label: "Falls Risk", n: catCount("fall_risk") },
    { label: "Deteriorating", n: catCount("deterioration") },
    { label: "Pressure Injury", n: catCount("pressure_injury") },
    { label: "Infection Control", n: catCount("infection") },
    { label: "Medication Risk", n: catCount("medication") },
    { label: "Isolation", n: patients.filter(p => p.isolation_status && p.isolation_status !== "none").length },
    { label: "Device / Equipment", n: catCount("device") },
    { label: "Environmental", n: catCount("environmental") },
  ];

  const kpis = {
    criticalAlerts: active.filter(s => sev(s.severity) === "high").length,
    highRiskPatients: risk("high"),
    safetyIncidentsToday: todaySafety.length,
    deteriorating: active.filter(s => s.category === "deterioration").length,
    escalationsOpen: openEsc.length,
    resolvedToday: resolvedToday.length,
    safetyCompliance: Math.max(0, Math.min(100, 100 - active.length * 3 - openEsc.length * 4)),
    avgResolveMin,
  };

  // Live alert feed.
  const alertFeed = [
    ...openEsc.map(e => ({ title: e.summary ?? "Escalation", sub: `L${e.level ?? 1} · ${e.escalation_type ?? "clinical"}`, band: sev(e.severity), at: e.created_at, kind: "escalation" })),
    ...active.map(s => ({ title: s.note ?? `${CAT_LABEL[s.category] ?? s.category} alert`, sub: CAT_LABEL[s.category] ?? s.category, band: sev(s.severity), at: s.created_at, kind: "safety" })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()).slice(0, 7);

  // Incidents by type (today).
  const incidentsByType = Object.entries(todaySafety.reduce((acc: Record<string, number>, s) => { acc[s.category] = (acc[s.category] ?? 0) + 1; return acc; }, {})).map(([cat, n]) => ({ label: CAT_LABEL[cat] ?? cat, n })).sort((a, b) => b.n - a.n);

  // 7-day incident trend.
  const days: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) days[new Date(nowMs() - i * 86400000).toISOString().slice(0, 10)] = 0;
  safety.forEach(s => { const d = String(s.created_at).slice(0, 10); if (d in days) days[d]++; });
  const trend = Object.entries(days).map(([d, n]) => ({ d: d.slice(5), n }));

  // Escalations in progress (with elapsed).
  const inProgress = openEsc.slice(0, 5).map(e => ({ title: e.summary ?? "Escalation", severity: sev(e.severity), level: e.level ?? 1, type: e.escalation_type ?? "clinical", elapsedMin: Math.round((nowMs() - new Date(e.created_at).getTime()) / 60000), status: e.status }));

  // Workflow-stage rollup (escalation lifecycle over the window).
  const workflow = [
    { stage: "Detected", n: escalations.length },
    { stage: "Acknowledged", n: escalations.filter(e => e.status === "acknowledged").length },
    { stage: "Open", n: escalations.filter(e => e.status === "open").length },
    { stage: "Resolved", n: escalations.filter(e => e.status === "resolved").length },
    { stage: "Cancelled", n: escalations.filter(e => e.status === "cancelled").length },
  ];

  // Risk hotspot map — beds colour-coded by their patient's risk level.
  const patByBed = new Map<string, any>(); patients.forEach(p => { if (p.bed_id) patByBed.set(p.bed_id, p); });
  const hotspot = beds.slice(0, 30).map(b => { const p = patByBed.get(b.id); return { label: b.label, risk: b.status === "occupied" && p ? (p.risk_level ?? "low") : "empty" }; });

  return { provisioned: true as const, hasData: c.hasData, kpis, riskOverview, totalRisk, highlights, alertFeed, incidentsByType, trend, inProgress, workflow, hotspot, asOf: c.cur.period ?? null };
}
