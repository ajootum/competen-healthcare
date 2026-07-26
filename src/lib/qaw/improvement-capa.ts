// QAW-003 Improvement Plans & CAPA Centre — corrective/preventive actions + improvement projects.
// Grounded in capa_actions (034) + improvement_objects/improvement_actions (019). Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const done = (s: string) => ["completed", "verified", "closed"].includes(s);
// status → % complete model for improvement projects (PDSA/QI lifecycle).
const IMP_PROGRESS: Record<string, number> = { proposed: 10, planning: 30, active: 55, measuring: 80, sustained: 100, closed: 100, abandoned: 0 };

export async function loadImprovementCapa(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const { data: capaRows, error } = await scope(admin.from("capa_actions").select("id, title, priority, status, due_date, owner_name, audit_id, created_at, closed_at").order("due_date").limit(5000));
  if (error) return { provisioned: false as const };
  const capa = (capaRows ?? []) as any[];

  const { data: impRows } = await scope(admin.from("improvement_objects").select("id, title, methodology, status, start_date, target_date, completed_date").limit(3000));
  const improvements = (impRows ?? []) as any[];
  let impActions: any[] = [];
  if (improvements.length) {
    const ids = improvements.map(i => i.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("improvement_actions").select("improvement_id, status").in("improvement_id", ids.slice(i, i + 200)).limit(20000);
      impActions = impActions.concat(data ?? []);
    }
  }

  // CAPA status — mutually exclusive buckets so the donut + KPIs reconcile.
  const completed = capa.filter(c => ["verified", "closed"].includes(c.status));
  const effDue = capa.filter(c => c.status === "completed");                 // finished, awaiting effectiveness verification
  const overdue = capa.filter(c => !done(c.status) && c.due_date && c.due_date < today);
  const overdueIds = new Set(overdue.map(c => c.id));
  const inProgress = capa.filter(c => !done(c.status) && c.status !== "completed" && !overdueIds.has(c.id));
  const openish = capa.filter(c => !done(c.status));

  const byPriority = ["high", "medium", "low"].map(p => ({ label: p === "high" ? "High / Critical" : p[0].toUpperCase() + p.slice(1), pct: capa.length ? Math.round((capa.filter(c => c.priority === p).length / capa.length) * 100) : 0, value: capa.filter(c => c.priority === p).length, tone: p === "high" ? "rose" : p === "medium" ? "amber" : "emerald" }));

  const fromAudit = capa.filter(c => c.audit_id).length;
  const bySource = [
    { label: "Clinical audit finding", value: fromAudit, tone: "blue" },
    { label: "Other / manual", value: capa.length - fromAudit, tone: "slate" },
  ];

  const topOverdue = overdue.map(c => ({ title: c.title, priority: c.priority, due: c.due_date, owner: c.owner_name, source: c.audit_id ? "Audit finding" : "Manual", daysOver: Math.round((Date.parse(today) - Date.parse(c.due_date)) / 86400000) }))
    .sort((a, b) => b.daysOver - a.daysOver).slice(0, 6);

  // Effectiveness = of the actions that reached a terminal state, how many were verified/closed effective.
  const finishedTotal = completed.length + effDue.length;
  const effectiveness = finishedTotal ? Math.round((completed.length / finishedTotal) * 100) : null;

  // Improvement projects.
  const activePlans = improvements.filter(i => ["proposed", "planning", "active", "measuring"].includes(i.status));
  const completedPlans = improvements.filter(i => ["sustained", "closed"].includes(i.status));
  const overallProgress = improvements.length ? Math.round(improvements.reduce((s, i) => s + (IMP_PROGRESS[i.status] ?? 0), 0) / improvements.length) : 0;
  const durations = completedPlans.filter(i => i.start_date && i.completed_date).map(i => (Date.parse(i.completed_date) - Date.parse(i.start_date)) / 86400000);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return {
    provisioned: true as const,
    kpis: {
      total: capa.length,
      completed: completed.length + effDue.length,
      completionRate: capa.length ? Math.round(((completed.length + effDue.length) / capa.length) * 100) : 0,
      inProgress: inProgress.length + openish.filter(c => c.status === "open" && !overdueIds.has(c.id)).length,
      overdue: overdue.length,
      effDue: effDue.length,
    },
    statusDonut: [
      { label: "Completed", value: completed.length, tone: "emerald" },
      { label: "In progress", value: openish.length - overdue.length, tone: "amber" },
      { label: "Overdue", value: overdue.length, tone: "rose" },
      { label: "Effectiveness due", value: effDue.length, tone: "violet" },
    ],
    byPriority, bySource, topOverdue,
    effectiveness,
    effectiveBreak: [
      { label: "Effective (verified/closed)", value: completed.length, tone: "emerald" },
      { label: "Awaiting verification", value: effDue.length, tone: "amber" },
    ],
    improvements: {
      total: improvements.length, active: activePlans.length, completed: completedPlans.length,
      overallProgress, avgDuration, actionCount: impActions.length,
      byMethod: Object.entries(improvements.reduce((m: Record<string, number>, i) => { m[i.methodology] = (m[i.methodology] ?? 0) + 1; return m; }, {})).map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v as number })).sort((a, b) => b.value - a.value).slice(0, 6),
    },
  };
}
