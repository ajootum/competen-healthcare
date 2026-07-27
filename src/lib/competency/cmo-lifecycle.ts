// CMO-004 Competency Lifecycle Engine — the complete competency lifecycle from creation through
// governance, publishing, assignment, assessment, competent, monitoring, improvement and retirement.
// Composes the real cmo_* suite (fetchCmoSuite → cmo_publications/cmo_assignments/competency_decisions
// /cmo_forecasts) + the framework_competencies catalogue. Tenant-scoped where the column exists.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchCmoSuite } from "@/lib/competency/cmo-suite";

const isCompetent = (o: any) => /competent|proficient/i.test(String(o)) && !/not_yet/i.test(String(o));
const daysLeft = (dt: any) => { if (!dt) return null; const n = Math.round((Date.parse(String(dt)) - Date.now()) / 86400000); return Number.isFinite(n) ? n : null; };

export async function loadCmoLifecycle(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchCmoSuite(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };

  const pubs = (d.publications ?? []) as any[];
  const assigns = (d.assignments ?? []) as any[];
  const decisions = (d.decisions ?? []) as any[];
  const forecasts = (d.forecasts ?? []) as any[];

  // Competency definitions catalogue (enterprise assets).
  let defined = 0;
  try { const { count } = await admin.from("framework_competencies").select("id", { count: "exact", head: true }); defined = count ?? 0; } catch { /* optional */ }

  const pubBy = (s: string) => pubs.filter(p => p.status === s).length;
  const asgBy = (re: RegExp) => assigns.filter(a => re.test(String(a.status))).length;
  const draft = pubBy("draft"), inGov = pubBy("in_review") + pubBy("approved"), publishedActive = pubBy("published"), retired = pubBy("rolled_back");
  const assigned = asgBy(/^assigned|scheduled/), inProgress = asgBy(/in_progress|progress/), completed = asgBy(/completed|complete/), overdue = asgBy(/overdue|expired/);
  const competent = decisions.filter(x => isCompetent(x.outcome)).length;
  const remediation = decisions.filter(x => /remediation|not_yet/i.test(String(x.outcome))).length;
  const expiringSoon = decisions.filter(x => { const n = daysLeft(x.expiry_date); return isCompetent(x.outcome) && n != null && n >= 0 && n <= 30; }).length;
  const expired = decisions.filter(x => { const n = daysLeft(x.expiry_date); return n != null && n < 0; }).length;
  const monitoring = Math.max(0, competent - expiringSoon);

  // The 9-stage lifecycle with live counts.
  const stages = [
    { key: "creation", label: "Creation", sub: "Designed in Studio", n: draft, tone: "#3b82f6" },
    { key: "governance", label: "Governance", sub: "Review & approval", n: inGov, tone: "#8b5cf6" },
    { key: "publishing", label: "Publishing", sub: "Published & active", n: publishedActive, tone: "#14b8a6" },
    { key: "assignment", label: "Assignment", sub: "Assigned to people", n: assigned, tone: "#06b6d4" },
    { key: "assessment", label: "Assessment", sub: "Evidence & evaluation", n: inProgress, tone: "#22c55e" },
    { key: "competent", label: "Competent", sub: "Achieved", n: competent, tone: "#16a34a" },
    { key: "monitoring", label: "Monitoring", sub: "Monitor & assure", n: monitoring, tone: "#f59e0b" },
    { key: "improvement", label: "Improvement", sub: "Gaps & remediation", n: remediation + overdue, tone: "#a855f7" },
    { key: "retirement", label: "Retirement", sub: "Retired & archived", n: retired, tone: "#ef4444" },
  ];

  // Lifecycle-at-a-glance donut.
  const glance = stages.filter(s => s.n > 0).map(s => ({ label: s.label, n: s.n, color: s.tone }));
  const glanceTotal = glance.reduce((a, s) => a + s.n, 0);

  // Priority actions — real counts.
  const priorityActions = [
    { label: "Competencies awaiting review", n: inGov, href: "/competency-office/review-board", tone: "amber" },
    { label: "Assessments requiring validation", n: decisions.filter(x => /returned|deferred|pending/i.test(String(x.validation_outcome))).length, href: "/competency-office/validation", tone: "blue" },
    { label: "Expiring competencies (30 days)", n: expiringSoon, href: "/competency-office/credentialing", tone: "amber" },
    { label: "Overdue reassessments", n: expired, href: "/competency-office/readiness", tone: "rose" },
    { label: "Improvement plans needing attention", n: remediation, href: "/competency-office/gaps", tone: "violet" },
  ].filter(a => a.n > 0);

  // Recent competencies (publication lifecycle rows).
  const stageOfStatus: Record<string, string> = { draft: "Creation", in_review: "Governance", approved: "Governance", scheduled: "Publishing", published: "Publishing", rolled_back: "Retirement" };
  const recent = [...pubs].sort((a, b) => String(b.published_at ?? b.created_at ?? "").localeCompare(String(a.published_at ?? a.created_at ?? ""))).slice(0, 6)
    .map(p => ({ name: p.name, type: p.artifact_type, stage: stageOfStatus[p.status] ?? "—", status: p.status, version: p.version }));

  // Gap overview — from cmo_forecasts (competency risk), honest by-competency (not by-department).
  const gaps = [...forecasts].sort((a, b) => (Number(b.gap ?? 0)) - (Number(a.gap ?? 0))).slice(0, 6)
    .map(f => ({ competency: f.competency ?? f.name ?? "—", gap: f.gap != null ? Number(f.gap) : null, risk: f.risk ?? f.risk_level }));

  // Assessment progress donut (cmo_assignments by status).
  const assessmentProgress = [
    { label: "Assigned / not started", n: assigned, color: "#94a3b8" },
    { label: "In progress", n: inProgress, color: "#3b82f6" },
    { label: "Completed", n: completed, color: "#22c55e" },
    { label: "Overdue", n: overdue, color: "#ef4444" },
  ].filter(s => s.n > 0);
  const assignTotal = assigns.length;

  // AI lifecycle copilot — rule-based, explainable (reuse real aiRecs where present).
  const copilot: { title: string; detail: string; tone: string }[] = [];
  if (forecasts.some(f => /high|critical/i.test(String(f.risk ?? f.risk_level)))) copilot.push({ title: "High gap alert", detail: `${forecasts.filter(f => /high|critical/i.test(String(f.risk ?? f.risk_level))).length} competencies show a high capability gap`, tone: "rose" });
  if (expiringSoon) copilot.push({ title: "Reassessment due", detail: `${expiringSoon} competencies expire within 30 days`, tone: "amber" });
  if (inGov) copilot.push({ title: "Publish backlog", detail: `${inGov} competencies are in governance review/approval`, tone: "blue" });
  if (remediation) copilot.push({ title: "Improvement opportunity", detail: `${remediation} decisions need remediation or are not-yet-competent`, tone: "violet" });
  (d.aiRecs ?? []).slice(0, 2).forEach((r: any) => copilot.push({ title: r.title, detail: r.detail ?? "", tone: r.impact === "high" ? "rose" : "teal" }));
  if (!copilot.length) copilot.push({ title: "Lifecycle healthy", detail: "No elevated lifecycle signals in the current data", tone: "emerald" });

  return {
    provisioned: true as const,
    kpis: { defined, active: publishedActive, inDevelopment: draft, assigned, inProgress, competent, expiringSoon },
    stages, currentStage: "assessment",
    glance, glanceTotal,
    avgTimeToCompetency: null as number | null, // no clean assigned→competent timing source yet (honest)
    priorityActions, recent, gaps, assessmentProgress, assignTotal,
    copilot: copilot.slice(0, 5),
  };
}
