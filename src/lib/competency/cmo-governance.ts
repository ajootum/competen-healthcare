// COMP-011 Competency Governance & Publication — the Competency Office GOVERNS (reviews, approves,
// publishes, versions, monitors, retires, audits) competencies authored in Competency Studio; it does
// not author. Composes the real cmo_* suite (fetchCmoSuite → cmo_publications/assignments/config) and
// wires the previously-unused governance substrate: plat_approval_requests/_decisions (multi-stage
// review), change_requests (change centre), frameworks/CPU version fields, audit_log. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchCmoSuite } from "@/lib/competency/cmo-suite";

const NONE = "00000000-0000-0000-0000-000000000000";
// cmo_publications.status → pipeline stage + tone.
const STATUS_TONE: Record<string, string> = { draft: "slate", in_review: "amber", approved: "blue", scheduled: "violet", published: "emerald", rolled_back: "rose" };
const GOV_RE = /competency|framework|cpu|standard|publication|blueprint|pathway/i;

export async function loadCmoGovernance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);
  const d = await fetchCmoSuite(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };

  const pubs = (d.publications ?? []) as any[];
  const by = (s: string) => pubs.filter(p => p.status === s).length;
  const submitted = by("draft"), inReview = by("in_review"), approved = by("approved"), scheduled = by("scheduled"), published = by("published"), rolledBack = by("rolled_back");

  // Publication status donut + pipeline (from the real cmo_publications spine).
  const statusDonut = [
    { label: "Draft / submitted", value: submitted, tone: "slate" },
    { label: "In review", value: inReview, tone: "amber" },
    { label: "Approved", value: approved, tone: "blue" },
    { label: "Scheduled", value: scheduled, tone: "violet" },
    { label: "Published", value: published, tone: "emerald" },
    { label: "Rolled back", value: rolledBack, tone: "rose" },
  ];
  const pipeline = [
    { stage: "Submitted", n: submitted, tone: "slate" },
    { stage: "In Review", n: inReview, tone: "amber" },
    { stage: "Approved", n: approved, tone: "blue" },
    { stage: "Scheduled", n: scheduled, tone: "violet" },
    { stage: "Published", n: published, tone: "emerald" },
  ];

  const recentlyPublished = pubs.filter(p => p.status === "published")
    .sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? ""))).slice(0, 6)
    .map(p => ({ name: p.name, type: p.artifact_type, version: p.version, target: p.target, when: p.published_at }));

  // Approval pipeline — plat_approval_requests (multi-stage review), filtered to governance workflows.
  let approvalQueue: any[] = [], approvalPending = 0, overdueApprovals = 0;
  try {
    const { data } = await admin.from("plat_approval_requests").select("workflow_key, entity_type, entity_name, status, current_step, total_steps, requested_by, created_at").order("created_at", { ascending: false }).limit(500);
    const rows = ((data ?? []) as any[]).filter(r => GOV_RE.test(`${r.workflow_key} ${r.entity_type}`));
    const pending = rows.filter(r => r.status === "pending");
    approvalPending = pending.length;
    approvalQueue = pending.slice(0, 6).map(r => {
      const ageDays = r.created_at ? Math.round((Date.parse(today) - Date.parse(String(r.created_at).slice(0, 10))) / 86400000) : 0;
      return { entity: r.entity_name ?? r.entity_type, workflow: String(r.workflow_key ?? "").replace(/_/g, " "), step: r.current_step, total: r.total_steps, age: ageDays, overdue: ageDays > 14 };
    });
    overdueApprovals = pending.filter(r => r.created_at && (Date.parse(today) - Date.parse(String(r.created_at).slice(0, 10))) / 86400000 > 14).length;
  } catch { /* approval engine optional */ }

  // Change Request Centre — change_requests (global governance change register).
  let changeRequests: any[] = [], openChanges = 0;
  try {
    const { data } = await admin.from("change_requests").select("entity_type, entity_name, change_kind, status, requested_by_name, effective_date, created_at").order("created_at", { ascending: false }).limit(300);
    const rows = ((data ?? []) as any[]).filter(r => GOV_RE.test(String(r.entity_type)));
    openChanges = rows.filter(r => r.status === "open").length;
    changeRequests = rows.slice(0, 6).map(r => ({ entity: r.entity_name ?? r.entity_type, kind: r.change_kind, status: r.status, by: r.requested_by_name, when: r.effective_date ?? r.created_at }));
  } catch { /* optional */ }

  // Version management + periodic-review — frameworks (version fields) + CPUs.
  let versionMgmt = { activeFrameworks: 0, libraries: 0, reviewDue: 0, byLibrary: [] as any[] }, reviewDueList: any[] = [];
  try {
    const { data } = await admin.from("frameworks").select("name, version_major, version_minor, version_revision, review_date, is_active, library").limit(3000);
    const fw = (data ?? []) as any[];
    const active = fw.filter(f => f.is_active);
    const libMap = new Map<string, number>();
    fw.forEach(f => libMap.set(f.library ?? "general", (libMap.get(f.library ?? "general") ?? 0) + 1));
    const dueSoon = fw.filter(f => f.review_date && f.review_date <= new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
    versionMgmt = { activeFrameworks: active.length, libraries: libMap.size, reviewDue: dueSoon.length, byLibrary: [...libMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5) };
    reviewDueList = dueSoon.sort((a, b) => String(a.review_date).localeCompare(String(b.review_date))).slice(0, 6).map(f => ({ name: f.name, version: `v${f.version_major ?? 1}.${f.version_minor ?? 0}`, due: f.review_date, overdue: f.review_date < today }));
  } catch { /* optional */ }

  // Deployment status — cmo_assignments (competency deployment records).
  const assigns = (d.assignments ?? []) as any[];
  const deployment = ["assigned", "in_progress", "completed", "overdue", "expired"].map(s => ({ label: s.replace(/_/g, " "), value: assigns.filter(a => a.status === s).length })).filter(x => x.value > 0);
  const deployTotal = assigns.length;

  // Audit feed — recent governance actions.
  let audit: any[] = [];
  try {
    const { data } = await scope(admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(400));
    audit = ((data ?? []) as any[]).filter(r => GOV_RE.test(`${r.entity_type} ${r.action}`)).slice(0, 8).map(r => ({ actor: r.actor_name, action: String(r.action ?? "").replace(/_/g, " "), entity: r.entity_name ?? r.entity_type, when: r.created_at }));
  } catch { /* optional */ }

  // Alerts & escalations — derived from real signals.
  const alerts: { title: string; detail: string; tone: string }[] = [];
  if (overdueApprovals) alerts.push({ title: "Governance SLA breach", detail: `${overdueApprovals} review${overdueApprovals > 1 ? "s" : ""} pending > 14 days`, tone: "rose" });
  if (versionMgmt.reviewDue) alerts.push({ title: "Periodic reviews due", detail: `${versionMgmt.reviewDue} framework${versionMgmt.reviewDue > 1 ? "s" : ""} due for review within 90 days`, tone: "amber" });
  if (rolledBack) alerts.push({ title: "Rolled-back publications", detail: `${rolledBack} publication${rolledBack > 1 ? "s were" : " was"} rolled back — investigate`, tone: "rose" });
  if (openChanges) alerts.push({ title: "Open change requests", detail: `${openChanges} awaiting governance decision`, tone: "blue" });
  if (!alerts.length) alerts.push({ title: "Governance healthy", detail: "No SLA breaches or overdue reviews", tone: "emerald" });

  return {
    provisioned: true as const,
    kpis: { submitted, inReview, approvalPending, approved, published, retiringSoon: versionMgmt.reviewDue, total: pubs.length },
    pipeline, statusDonut, statusTone: STATUS_TONE,
    recentlyPublished, approvalQueue, approvalPendingCount: approvalPending, overdueApprovals,
    changeRequests, openChanges, versionMgmt, reviewDueList,
    deployment, deployTotal, audit, alerts,
    aiRecs: (d.aiRecs ?? []).slice(0, 5),
  };
}

// COMP-011 Review & Approval Centre — the submission/review queue + approval detail, over the real
// multi-stage approval engine (plat_approval_requests/_decisions) + change_requests (revision requests).
// Actions (approve/reject/request-revision) require the write workflow → flagged next-phase.
const stageLabel = (step: number, total: number) => (step >= total ? "Approval" : (["Technical review", "Clinical review", "Governance review"][step - 1] ?? `Review step ${step}`));

export async function loadCmoReview(admin: any, hid: string | null, isSuper: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  const d = await fetchCmoSuite(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };

  let requests: any[] = [];
  try {
    const { data } = await admin.from("plat_approval_requests").select("id, workflow_key, entity_type, entity_name, status, current_step, total_steps, requested_by, created_at").order("created_at", { ascending: false }).limit(600);
    requests = ((data ?? []) as any[]).filter(r => GOV_RE.test(`${r.workflow_key} ${r.entity_type}`));
  } catch { /* engine optional */ }
  const pending = requests.filter(r => r.status === "pending");
  const ageOf = (r: any) => (r.created_at ? Math.round((Date.parse(today) - Date.parse(String(r.created_at).slice(0, 10))) / 86400000) : 0);

  const queue = pending.slice(0, 10).map(r => ({ entity: r.entity_name ?? r.entity_type, workflow: String(r.workflow_key ?? "").replace(/_/g, " "), stage: stageLabel(r.current_step ?? 1, r.total_steps ?? 1), step: r.current_step, total: r.total_steps, requester: r.requested_by, age: ageOf(r), overdue: ageOf(r) > 14 }));
  // Stage breakdown of the pending queue.
  const stageMap = new Map<string, number>();
  pending.forEach(r => { const s = stageLabel(r.current_step ?? 1, r.total_steps ?? 1); stageMap.set(s, (stageMap.get(s) ?? 0) + 1); });
  const stageBreak = ["Technical review", "Clinical review", "Governance review", "Approval"].map(s => ({ label: s, value: stageMap.get(s) ?? 0 }));

  let decisions: any[] = [];
  try {
    const { data } = await admin.from("plat_approval_decisions").select("step, decision, actor_name, note, created_at").order("created_at", { ascending: false }).limit(200);
    decisions = (data ?? []) as any[];
  } catch { /* optional */ }
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const recentDecisions = decisions.filter(x => String(x.created_at ?? "").slice(0, 10) >= cutoff);

  let changeReviews: any[] = [];
  try {
    const { data } = await admin.from("change_requests").select("entity_type, entity_name, change_kind, status, requested_by_name, reviewed_by, effective_date, created_at").order("created_at", { ascending: false }).limit(300);
    changeReviews = ((data ?? []) as any[]).filter(r => GOV_RE.test(String(r.entity_type)));
  } catch { /* optional */ }

  const avgAge = pending.length ? Math.round(pending.reduce((s, r) => s + ageOf(r), 0) / pending.length) : null;
  const overdue = pending.filter(r => ageOf(r) > 14).length;

  return {
    provisioned: true as const,
    kpis: {
      pending: pending.length,
      technical: stageMap.get("Technical review") ?? 0,
      clinical: stageMap.get("Clinical review") ?? 0,
      governance: stageMap.get("Governance review") ?? 0,
      approval: stageMap.get("Approval") ?? 0,
      overdue, avgAge,
      decided30: recentDecisions.length,
    },
    queue, stageBreak,
    recentDecisions: recentDecisions.slice(0, 8).map(x => ({ step: x.step, decision: x.decision, actor: x.actor_name, note: x.note, when: x.created_at })),
    changeReviews: changeReviews.slice(0, 8).map(r => ({ entity: r.entity_name ?? r.entity_type, kind: r.change_kind, status: r.status, by: r.requested_by_name, when: r.effective_date ?? r.created_at })),
    openChanges: changeReviews.filter(r => r.status === "open").length,
    hasEngine: requests.length > 0,
  };
}
