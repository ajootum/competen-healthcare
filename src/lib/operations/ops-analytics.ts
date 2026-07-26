// UMW-OPC-011 Audit, Reporting & Operational Analytics loader. Rolls the operational stores into period KPI rollups,
// day + month trend series (op_ops_snapshots), four performance scorecards, a unified operational audit activity feed
// (escalations raised/resolved + safety alerts + task completions + movement events), a report catalogue (cross-links
// to the authoritative analytics surfaces) and real data-quality indicators (bed↔patient linkage, competency-validated
// assignments, snapshot freshness). Read-only manager lens over the same real data every OPC module shares.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, pct, sev, nowMs, NONE } from "./ops-shared";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function loadAuditAnalytics(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { daily, snaps, beds, patients, escalations, safety, tasks, movements } = c;
  const monthly = snaps.filter((s: any) => s.period_type === "month");

  const num = (k: string, arr = daily) => arr.map((s: any) => Number(s[k]) || 0);

  // Period KPI rollups (over the daily history window).
  const rollups = {
    days: daily.length,
    avgOccupancy: Math.round(mean(num("occupancy_pct"))),
    totalAdmissions: num("admissions").reduce((a, b) => a + b, 0),
    totalDischarges: num("discharges").reduce((a, b) => a + b, 0),
    avgLos: r1(mean(num("avg_los"))),
    avgEscalationRate: r1(mean(num("escalation_rate"))),
    avgReadmission: r1(mean(num("readmission_rate"))),
    avgSafeStaffing: Math.round(mean(num("safe_staffing_score"))),
  };

  // Trend series.
  const trends = {
    occupancy: num("occupancy_pct").slice(-14),
    admissions: num("admissions").slice(-14),
    los: num("avg_los").slice(-14),
    staffing: num("safe_staffing_score").slice(-14),
  };
  const monthlyTrend = monthly.map((m: any) => ({ period: String(m.period).slice(0, 7), occupancy: Number(m.occupancy_pct) || 0, admissions: Number(m.admissions) || 0, discharges: Number(m.discharges) || 0, los: Number(m.avg_los) || 0, escalation: Number(m.escalation_rate) || 0, readmission: Number(m.readmission_rate) || 0 }));

  // Four performance scorecards.
  const scorecards = [
    { label: "Capacity & Flow", value: `${rollups.avgOccupancy}%`, sub: "avg occupancy", tone: rollups.avgOccupancy >= 92 ? "amber" : "emerald" },
    { label: "Safety & Quality", value: r1(rollups.avgEscalationRate), sub: "avg escalation rate", tone: rollups.avgEscalationRate >= 5 ? "rose" : "emerald" },
    { label: "Workforce", value: rollups.avgSafeStaffing || "—", sub: "safe-staffing score", tone: rollups.avgSafeStaffing >= 85 ? "emerald" : "amber" },
    { label: "Length of Stay", value: `${rollups.avgLos}d`, sub: "avg LOS", tone: "blue" },
  ];

  // Unified operational audit activity feed.
  const feed: { icon: string; text: string; kind: string; at: string }[] = [];
  escalations.forEach(e => { feed.push({ icon: "🚨", text: `Escalation raised — ${e.summary ?? "clinical"} (${sev(e.severity)})`, kind: "Escalation", at: e.created_at }); if (e.resolved_at) feed.push({ icon: "✅", text: `Escalation resolved — ${e.summary ?? "clinical"}`, kind: "Escalation", at: e.resolved_at }); });
  safety.forEach(s => feed.push({ icon: "🛡️", text: `Safety alert — ${String(s.category).replace(/_/g, " ")}${s.note ? `: ${s.note}` : ""}`, kind: "Safety", at: s.created_at }));
  tasks.filter(t => t.completed_at).forEach(t => feed.push({ icon: "☑️", text: `Task completed — ${t.description}`, kind: "Action", at: t.completed_at }));
  movements.forEach(m => feed.push({ icon: "🔄", text: `${String(m.event_type).replace(/_/g, " ")}${m.detail ? ` — ${m.detail}` : ""}`, kind: "Movement", at: m.created_at }));
  const auditFeed = feed.filter(f => f.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 14);

  // Report catalogue — cross-links to the authoritative analytics surfaces.
  const reports = [
    { name: "Executive Reports", desc: "Unit performance & board pack", href: "/unit-manager/reports" },
    { name: "History & Audit", desc: "Operational change history", href: "/unit-manager/history-audit" },
    { name: "Quality Analytics", desc: "Safety & quality command centre", href: "/unit-manager/quality/analytics" },
    { name: "Workforce Analytics", desc: "Staffing & roster analytics", href: "/unit-manager/workforce-management/analytics" },
    { name: "Patient Ops Analytics", desc: "Flow & capacity analytics", href: "/unit-manager/patient-operations/analytics" },
    { name: "Learning Analytics", desc: "Competency & CPD", href: "/unit-manager/learning/analytics" },
  ];

  // Real data-quality indicators.
  const occ = beds.filter(b => b.status === "occupied").length;
  const linked = patients.filter(p => p.bed_id).length;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const asgRes = await scope(admin.from("op_patient_assignments").select("competency_validated, status")).eq("status", "active").then((r: any) => r, () => ({ data: [] }));
  const asg = (asgRes.data ?? []) as any[];
  const lastDaily = daily.at(-1);
  const snapAgeDays = lastDaily?.period ? Math.round((nowMs() - new Date(lastDaily.period).getTime()) / 86400000) : null;
  const dataQuality = [
    { label: "Bed ↔ patient linkage", pct: occ ? pct(linked, occ) : 100, sub: `${linked}/${occ} occupied beds linked` },
    { label: "Competency-validated assignments", pct: asg.length ? pct(asg.filter(a => a.competency_validated).length, asg.length) : 100, sub: `${asg.filter(a => a.competency_validated).length}/${asg.length} active` },
    { label: "Snapshot freshness", pct: snapAgeDays == null ? 0 : snapAgeDays <= 1 ? 100 : snapAgeDays <= 3 ? 70 : 40, sub: snapAgeDays == null ? "no snapshots" : `${snapAgeDays}d since last` },
    { label: "Movement-log coverage", pct: movements.length ? 100 : 30, sub: `${movements.length} events today` },
  ];

  return { provisioned: true as const, hasData: c.hasData, rollups, trends, monthlyTrend, scorecards, auditFeed, reports, dataQuality, asOf: lastDaily?.period ?? null };
}
