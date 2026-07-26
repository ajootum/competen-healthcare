// HEX-007 Quality & Clinical Governance (executive lens) — composes loadQualityDashboard + loadStandards
// (accreditation by framework) + loadIndicators (domain performance) + the daily quality_score_snapshots
// (safety index, harm/serious events) + op_incidents (this-month harm). All real, tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";
import { loadStandards } from "@/lib/qaw/standards";
import { loadIndicators } from "@/lib/qaw/indicators";

const NONE = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: any) => (v == null ? null : Number(v));

export async function loadExecQuality(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [core, standards, indicators] = await Promise.all([
    loadQualityDashboard(admin, hid, isSuper),
    loadStandards(admin, hid, isSuper),
    loadIndicators(admin, hid, isSuper),
  ]);

  // Latest snapshot for safety index + patient-safety events.
  let snap: any = {};
  try { const { data } = await scope(admin.from("quality_score_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(1)); snap = (data ?? [])[0] ?? {}; } catch { /* optional */ }

  // This-month harm events / serious incidents from op_incidents.
  let harm = 0, serious = 0;
  try {
    const monthStart = new Date(); monthStart.setDate(1);
    const { data } = await scope(admin.from("op_incidents").select("severity, near_miss, created_at").gte("created_at", monthStart.toISOString().slice(0, 10)).limit(5000));
    const rows = (data ?? []) as any[];
    harm = rows.filter(i => !i.near_miss).length;
    serious = rows.filter(i => i.severity === "critical").length;
  } catch { /* optional */ }

  // Quality trend (6 months) from snapshots.
  let trend: { label: string; value: number }[] = [];
  try {
    const { data } = await scope(admin.from("quality_score_snapshots").select("snapshot_date, quality_score").order("snapshot_date", { ascending: false }).limit(180));
    const m = new Map<string, number>();
    (data ?? []).forEach((s: any) => { const k = String(s.snapshot_date).slice(0, 7); if (!m.has(k) && s.quality_score != null) m.set(k, Math.round(Number(s.quality_score))); });
    trend = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));
  } catch { /* optional */ }

  const overallQuality = num(snap.quality_score) ?? core.complianceScore;
  const safetyScore = num(snap.safety_index);

  // Alerts — derived from real signals.
  const alerts: { title: string; detail: string; tone: string }[] = [];
  if (core.findings.critical) alerts.push({ title: "Critical audit findings open", detail: `${core.findings.critical} require immediate action`, tone: "rose" });
  if (core.capa.overdue) alerts.push({ title: "Overdue corrective actions", detail: `${core.capa.overdue} CAPAs past due date`, tone: "amber" });
  if (serious) alerts.push({ title: "Serious incidents this month", detail: `${serious} critical-severity incidents reported`, tone: "rose" });
  if (indicators.provisioned && !indicators.empty && indicators.kpis.below) alerts.push({ title: "Indicators below target", detail: `${indicators.kpis.below} quality indicators below target`, tone: "amber" });
  if (!alerts.length) alerts.push({ title: "No critical quality alerts", detail: "All tracked signals within tolerance", tone: "emerald" });

  return {
    provisioned: true as const,
    kpis: {
      overallQuality, safetyScore, harm, serious,
      openCapa: core.capa.open, auditCompliance: core.complianceScore, accreditation: standards.provisioned ? standards.kpis.overall : core.accreditationReadiness,
    },
    domains: (indicators.provisioned && !indicators.empty) ? indicators.byDomain.slice(0, 8).map((x: any) => ({ label: x.label, pct: x.pct })) : [],
    accreditation: standards.provisioned ? standards.byFramework : [],
    trend,
    alerts,
    improvement: {
      total: core.improvements.total, active: core.improvements.active, completed: core.improvements.completed,
      donut: [
        { label: "Active", value: core.improvements.active, tone: "blue" },
        { label: "Completed", value: core.improvements.completed, tone: "emerald" },
      ],
    },
    indicators: (indicators.provisioned && !indicators.empty) ? { met: indicators.kpis.met, near: indicators.kpis.near, below: indicators.kpis.below, total: indicators.kpis.total } : null,
  };
}
