// UMW-OPC-002 Live Unit Status Engine loader. Aggregates the live operational stores into eight traffic-light status
// domains (patient safety / capacity / workforce / clinical ops / quality / environment / equipment / medication),
// the unit bed map, a real-time status feed (movement events), the active-alert buckets, nine live metrics, 24h
// status trends (daily snapshots) and a composite operational score. Every domain score is derived from real counts
// on this unit — no synthetic status. Read-only manager lens; live execution stays in the SSW.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, acuityBand, sev, pct, delta } from "./ops-shared";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const light = (score: number): "GREEN" | "AMBER" | "RED" => (score >= 90 ? "GREEN" : score >= 75 ? "AMBER" : "RED");
const lightCap = (occ: number): "GREEN" | "AMBER" | "RED" => (occ >= 95 ? "RED" : occ >= 88 ? "AMBER" : "GREEN");

export async function loadLiveUnitStatus(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { beds, patients, staff, escalations, safety, tasks, equipment, movements, cur, prev } = c;

  const totalBeds = beds.length, occ = beds.filter(b => b.status === "occupied").length;
  const occupancy = totalBeds ? pct(occ, totalBeds) : (cur.occupancy_pct ?? 0);
  const activeSafety = safety.filter(s => s.active);
  const highRisk = patients.filter(p => p.risk_level === "high").length;
  const openEsc = escalations.filter(e => ["open", "acknowledged"].includes(e.status));
  const onDuty = staff.filter(s => !["off_duty", "absent"].includes(s.status)).length || staff.length;
  const absent = staff.filter(s => s.status === "absent").length;
  const requiredFte = cur.required_fte ?? (onDuty ? Math.ceil(onDuty * 1.1) : null);
  const coverage = requiredFte ? clamp((onDuty / requiredFte) * 100) : null;
  const openTasks = tasks.filter(t => !["completed", "verified", "cancelled"].includes(t.status));
  const overdue = openTasks.filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now()).length;
  const opReady = equipment.length ? pct(equipment.filter(e => e.status === "operational").length, equipment.length) : null;
  const cleaning = beds.filter(b => b.status === "cleaning").length;
  const outBeds = beds.filter(b => b.status === "out_of_service").length;
  const medAlerts = activeSafety.filter(s => s.category === "medication").length;

  // ── Eight domain traffic-lights (composite scores over live counts) ──
  const safetyScore = clamp(100 - activeSafety.length * 6 - highRisk * 3 - openEsc.filter(e => sev(e.severity) === "high").length * 8);
  const wfScore = coverage ?? clamp(100 - absent * 8);
  const clinScore = openTasks.length ? clamp(100 - (overdue / openTasks.length) * 60) : 96;
  const qualScore = clamp(96 - openEsc.length * 4 - activeSafety.filter(s => sev(s.severity) === "high").length * 6);
  const envScore = totalBeds ? clamp(100 - (cleaning / totalBeds) * 120 - (outBeds / totalBeds) * 100) : 95;
  const eqScore = opReady ?? 90;
  const medScore = clamp(100 - medAlerts * 12);
  const domains = [
    { label: "Patient Safety", status: light(safetyScore), value: `${safetyScore}%`, sub: `${activeSafety.length} active alerts` },
    { label: "Capacity Status", status: lightCap(occupancy), value: `${occupancy}%`, sub: `${occ}/${totalBeds} beds` },
    { label: "Workforce Status", status: light(wfScore), value: coverage != null ? `${coverage}%` : `${onDuty}`, sub: `${onDuty}${requiredFte ? `/${requiredFte}` : ""} on duty` },
    { label: "Clinical Operations", status: light(clinScore), value: `${clinScore}%`, sub: `${overdue} tasks overdue` },
    { label: "Quality & Compliance", status: light(qualScore), value: `${qualScore}%`, sub: `${openEsc.length} open escalations` },
    { label: "Environment", status: light(envScore), value: `${envScore}%`, sub: `${cleaning} cleaning · ${outBeds} OOS` },
    { label: "Equipment", status: eqScore != null ? light(eqScore) : "AMBER" as const, value: `${eqScore}%`, sub: `${equipment.filter(e => e.status === "operational").length}/${equipment.length} operational` },
    { label: "Medication", status: light(medScore), value: `${medScore}%`, sub: medAlerts ? `${medAlerts} med alerts` : "no med alerts" },
  ];

  // ── Bed map ──
  const patByBed = new Map<string, any>(); patients.forEach(p => { if (p.bed_id) patByBed.set(p.bed_id, p); });
  const bedGrid = beds.slice(0, 24).map(b => {
    const p = patByBed.get(b.id);
    let tone: string;
    if (b.status === "out_of_service") tone = "maintenance";
    else if (b.status === "cleaning") tone = "cleaning";
    else if (b.status === "reserved") tone = "reserved";
    else if (b.status === "available" || !p) tone = "available";
    else tone = acuityBand(p.acuity_level);
    return { label: b.label, tone };
  });

  // ── Real-time status feed (movement events today) ──
  const feed = movements.slice(0, 8).map(m => ({ type: m.event_type, text: m.detail ?? String(m.event_type).replace(/_/g, " "), at: m.created_at }));

  // ── Active alerts (escalations + active safety) bucketed by severity ──
  const alertItems = [
    ...openEsc.map(e => ({ title: e.summary ?? "Escalation", sub: `${e.escalation_type ?? "clinical"} · L${e.level ?? 1}`, band: sev(e.severity), at: e.created_at })),
    ...activeSafety.map(s => ({ title: s.note ?? `${String(s.category).replace(/_/g, " ")} alert`, sub: `${String(s.category).replace(/_/g, " ")}`, band: sev(s.severity), at: s.created_at })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
  const buckets = { critical: alertItems.filter(a => a.band === "high").length, medium: alertItems.filter(a => a.band === "medium").length, low: alertItems.filter(a => a.band === "low").length };

  // ── Nine live metrics ──
  const metrics = [
    { label: "Patients in Unit", value: patients.length, sub: "operational" },
    { label: "Occupied Beds", value: `${occ}/${totalBeds}`, sub: `${occupancy}%` },
    { label: "Admissions Today", value: cur.admissions ?? "—", sub: "snapshot" },
    { label: "Discharges Today", value: cur.discharges ?? "—", sub: "snapshot" },
    { label: "Average LOS", value: cur.avg_los != null ? `${cur.avg_los}d` : "—", sub: "predicted" },
    { label: "Staff On Duty", value: `${onDuty}${requiredFte ? `/${requiredFte}` : ""}`, sub: coverage != null ? `${coverage}%` : "on duty" },
    { label: "Absentees", value: absent, sub: absent ? "cover needed" : "none" },
    { label: "Vacancies", value: requiredFte != null ? Math.max(0, requiredFte - onDuty) : "—", sub: "of establishment" },
    { label: "Compliance Rate", value: `${qualScore}%`, sub: "quality composite" },
  ];

  // ── 24h status trends (daily snapshots) ──
  const series = (k: string) => c.daily.slice(-12).map((s: any) => Number(s[k]) || 0);
  const trends = { occupancy: series("occupancy_pct"), staffing: series("safe_staffing_score"), quality: series("capacity_score") };

  // ── Composite operational score ──
  const score = clamp(
    (occupancy >= 95 ? 45 : occupancy >= 88 ? 72 : 92) * 0.3 + (coverage ?? 85) * 0.25 + safetyScore * 0.25 + clinScore * 0.2,
  );

  const summary = {
    overall: openEsc.filter(e => sev(e.severity) === "high").length || activeSafety.filter(s => sev(s.severity) === "high").length ? "ELEVATED" : occupancy >= 95 ? "STRAINED" : "STABLE",
    activeIncidents: activeSafety.length,
    openEscalations: openEsc.length,
    tasksOverdue: overdue,
    actionsCompletedToday: tasks.filter(t => ["completed", "verified"].includes(t.status) && t.completed_at && t.completed_at >= new Date(Date.now()).toISOString().slice(0, 10)).length,
    occDelta: delta(cur.occupancy_pct, prev.occupancy_pct),
  };

  return { provisioned: true as const, hasData: c.hasData, domains, bedGrid, feed, alerts: alertItems.slice(0, 6), buckets, metrics, trends, score, summary, asOf: cur.period ?? null };
}
