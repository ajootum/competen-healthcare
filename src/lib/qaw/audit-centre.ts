// QAW-002 Clinical Audit Centre — plan/execute/monitor clinical & operational audits.
// Grounded entirely in real stores: audits + audit_findings (migration 034) and the
// open corrective actions (capa_actions) that audits generate. Tenant-scoped by hospital_id.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: any) => (v == null ? null : Number(v));

export async function loadAuditCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const { data: auditRows, error } = await scope(
    admin.from("audits").select("id, title, audit_type, area, status, compliance_pct, items_met, items_not_met, items_na, conducted_at, conducted_by_name").order("conducted_at", { ascending: false }).limit(4000)
  );
  if (error) return { provisioned: false as const };
  const audits = (auditRows ?? []) as any[];
  const ids = audits.map(a => a.id);

  let findings: any[] = [];
  if (ids.length) {
    // batch in chunks to stay under URL limits
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("audit_findings").select("audit_id, result, is_critical, item_text, created_at").in("audit_id", ids.slice(i, i + 200)).limit(20000);
      findings = findings.concat(data ?? []);
    }
  }
  const notMet = findings.filter(f => f.result === "not_met");
  const critical = notMet.filter(f => f.is_critical);

  // Open corrective actions (follow-ups) from these audits / this tenant.
  const { data: capaRows } = await scope(admin.from("capa_actions").select("title, status, priority, due_date, owner_name, audit_id").limit(4000));
  const capa = (capaRows ?? []) as any[];
  const openCapa = capa.filter(c => !["completed", "verified", "closed"].includes(c.status));
  const overdueFollowUps = openCapa.filter(c => c.due_date && c.due_date < today)
    .map(c => ({ ...c, daysOver: Math.round((Date.parse(today) - Date.parse(c.due_date)) / 86400000) }))
    .sort((a, b) => b.daysOver - a.daysOver);

  const completed = audits.filter(a => a.status === "completed");
  const inProgress = audits.filter(a => a.status === "in_progress");
  const planned = audits.filter(a => a.status === "planned");
  const withPct = completed.filter(a => a.compliance_pct != null);
  const avgCompliance = withPct.length ? Math.round(withPct.reduce((s, a) => s + Number(a.compliance_pct), 0) / withPct.length) : null;

  // Findings tiering — the store records is_critical only (not a full 4-tier priority),
  // so we report Critical vs. Other not-met honestly rather than inventing High/Medium/Low.
  const findingsTier = [
    { label: "Critical", value: critical.length, tone: "rose" },
    { label: "Other not-met", value: notMet.length - critical.length, tone: "amber" },
    { label: "Met", value: findings.filter(f => f.result === "met").length, tone: "emerald" },
  ];

  // 6-month audit trend (completed / in-progress by conducted month).
  const now = new Date();
  const buckets: { key: string; label: string; completed: number; inProgress: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], completed: 0, inProgress: 0 });
  }
  const bkByKey = new Map(buckets.map(b => [b.key, b]));
  audits.forEach(a => {
    const k = String(a.conducted_at).slice(0, 7);
    const b = bkByKey.get(k); if (!b) return;
    if (a.status === "completed") b.completed++; else if (a.status === "in_progress") b.inProgress++;
  });

  // Coverage by area (department proxy).
  const byArea = new Map<string, { area: string; total: number; completed: number; pctSum: number; pctN: number }>();
  audits.forEach(a => {
    const area = a.area || "Unspecified";
    const r = byArea.get(area) ?? { area, total: 0, completed: 0, pctSum: 0, pctN: 0 };
    r.total++; if (a.status === "completed") r.completed++;
    if (a.compliance_pct != null) { r.pctSum += Number(a.compliance_pct); r.pctN++; }
    byArea.set(area, r);
  });
  const coverage = [...byArea.values()].map(r => ({ area: r.area, total: r.total, completed: r.completed, compliance: r.pctN ? Math.round(r.pctSum / r.pctN) : null })).sort((a, b) => b.total - a.total).slice(0, 6);

  return {
    provisioned: true as const,
    kpis: {
      total: audits.length, completed: completed.length, inProgress: inProgress.length, planned: planned.length,
      completionRate: audits.length ? Math.round((completed.length / audits.length) * 100) : 0,
      findings: notMet.length, critical: critical.length, avgCompliance,
    },
    statusBreak: [
      { label: "Completed", value: completed.length, tone: "emerald" },
      { label: "In progress", value: inProgress.length, tone: "amber" },
      { label: "Planned", value: planned.length, tone: "slate" },
    ],
    findingsTier,
    recent: audits.slice(0, 8).map(a => ({ title: a.title, type: a.audit_type, area: a.area, status: a.status, compliance: num(a.compliance_pct), when: a.conducted_at, by: a.conducted_by_name })),
    trend: buckets,
    coverage,
    overdueFollowUps: overdueFollowUps.slice(0, 6),
    openFollowUps: openCapa.length,
  };
}
