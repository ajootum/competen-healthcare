/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-003 — Competency Approval & Governance Workflow Engine.
// The governance-scoped intelligence/workspace over the real approval stores (the write path — submit/decide —
// lives in the platform approvals console + the Office review board, cross-linked). It reads:
//   • plat_approval_requests (mig 057) — multi-step approval instances (status, current/total step, decided_at)
//   • plat_approval_decisions (mig 057) — the per-step decision AUDIT (actor, decision, note) → governance timeline
//   • change_requests (mig 012)         — competency/framework change control (open/approved/rejected/implemented)
// Filtered to the CONTENT-GOVERNANCE workflows (framework/competency/assessment/knowledge/policy/cpu), NOT the
// platform-admin ones (tenant/org/invitation). Computes the CGR-003 KPIs the spec names (§16): approval
// turnaround, % within SLA, reviewer workload, returned/rejected count, escalation (overdue pending). Real data
// only; fail-soft if the approval-engine tables are absent. No migration.

import { WORKFLOW_CATALOGUE, workflowDef } from "@/lib/platform/approvals";

type Admin = any;
const DAY = 86400000;
const SLA_DAYS = 14;
const GOV_TYPES = new Set(["framework", "competency", "assessment", "knowledge", "policy", "cpu", "framework_competency"]);

const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / DAY));
const daysBetween = (aIso: string, bIso: string) => Math.max(0, Math.round((new Date(aIso).getTime() - new Date(bIso).getTime()) / DAY));

export async function loadGovernanceApprovals(admin: Admin) {
  const [reqRes, crRes, decRes] = await Promise.all([
    admin.from("plat_approval_requests").select("id, workflow_key, entity_type, entity_name, status, current_step, total_steps, requested_by_name, created_at, decided_at").order("created_at", { ascending: false }).limit(500),
    admin.from("change_requests").select("id, entity_type, entity_name, change_kind, status, requested_by_name, effective_date, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("plat_approval_decisions").select("id, request_id, step, decision, actor_name, note, created_at").order("created_at", { ascending: false }).limit(400),
  ]);

  const ready = !reqRes.error;
  const reqsAll = (ready ? reqRes.data ?? [] : []) as any[];
  const reqs = reqsAll.filter((r) => GOV_TYPES.has(r.entity_type)); // governance-scoped
  const crs = (crRes.error ? [] : crRes.data ?? []) as any[];
  const decs = (decRes.error ? [] : decRes.data ?? []) as any[];

  const provisioned = ready || crs.length > 0;

  // Pending queue (both sources), oldest-first (most escalation-worthy).
  const pendingReq = reqs.filter((r) => r.status === "pending");
  const openCr = crs.filter((r) => r.status === "open");
  const queue = [
    ...pendingReq.map((r) => {
      const def = workflowDef(r.workflow_key);
      return { source: "approval" as const, id: r.id, workflow: def?.name ?? r.workflow_key, icon: def?.icon ?? "📋", entityType: r.entity_type, entityName: r.entity_name ?? "—", requestedBy: r.requested_by_name ?? "—", step: `step ${r.current_step + 1}/${r.total_steps}`, ageDays: daysSince(r.created_at) };
    }),
    ...openCr.map((r) => ({ source: "change_request" as const, id: r.id, workflow: "Content Change", icon: "✏️", entityType: r.entity_type, entityName: r.entity_name ?? "—", requestedBy: r.requested_by_name ?? "—", step: r.change_kind ?? "revision", ageDays: daysSince(r.created_at) })),
  ].sort((a, b) => b.ageDays - a.ageDays);

  // Turnaround over decided approval requests (they carry decided_at).
  const decidedReqs = reqs.filter((r) => r.status !== "pending" && r.status !== "cancelled" && r.decided_at);
  const turnarounds = decidedReqs.map((r) => daysBetween(r.decided_at, r.created_at));
  const avgTurnaround = turnarounds.length ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : null;
  const slaPct = turnarounds.length ? Math.round((turnarounds.filter((t) => t <= SLA_DAYS).length / turnarounds.length) * 100) : null;

  const approved = reqs.filter((r) => r.status === "approved").length + crs.filter((c) => c.status === "approved" || c.status === "implemented").length;
  const rejected = reqs.filter((r) => r.status === "rejected").length + crs.filter((c) => c.status === "rejected").length;
  const overdue = queue.filter((q) => q.ageDays > SLA_DAYS).length;

  // Reviewer workload — from the per-step decision audit.
  const workloadMap = new Map<string, { approved: number; rejected: number; total: number }>();
  for (const d of decs) {
    const name = d.actor_name || "Unattributed";
    const e = workloadMap.get(name) ?? { approved: 0, rejected: 0, total: 0 };
    e.total++;
    if (d.decision === "approved") e.approved++;
    else e.rejected++;
    workloadMap.set(name, e);
  }
  const reviewers = [...workloadMap.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.total - a.total).slice(0, 8);

  // Governance timeline — recent per-step decisions (real audit).
  const reqById = new Map(reqsAll.map((r) => [r.id, r]));
  const timeline = decs.slice(0, 12).map((d) => {
    const r = reqById.get(d.request_id);
    const def = r ? workflowDef(r.workflow_key) : null;
    return { decision: d.decision as string, actor: d.actor_name ?? "—", note: d.note as string | null, step: (d.step ?? 0) + 1, at: d.created_at as string, entityName: r?.entity_name ?? "—", workflow: def?.name ?? r?.workflow_key ?? "Approval" };
  });

  const byWorkflow = WORKFLOW_CATALOGUE.filter((w) => GOV_TYPES.has(w.entityType)).map((w) => ({ key: w.key, name: w.name, icon: w.icon, steps: w.steps.length, pending: reqs.filter((r) => r.workflow_key === w.key && r.status === "pending").length }));

  return {
    provisioned,
    ready,
    queue: queue.slice(0, 20),
    queueTotal: queue.length,
    reviewers,
    timeline,
    byWorkflow,
    pipeline: { pending: pendingReq.length + openCr.length, approved, rejected },
    kpis: {
      pending: pendingReq.length + openCr.length,
      approved,
      rejected,
      avgTurnaround,
      slaPct,
      sla: SLA_DAYS,
      overdue,
      oldestPending: queue.length ? queue[0].ageDays : 0,
      reviewers: reviewers.length,
      decisions: decs.length,
    },
  };
}
