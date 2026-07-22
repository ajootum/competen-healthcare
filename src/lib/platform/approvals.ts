// Generic workflow / approval engine (PCS-000 §10 / POS-001D). Workflow
// definitions (types + ordered steps) live in code; plat_approval_requests holds
// instances and plat_approval_decisions the per-step audit. decide() advances a
// request through its steps and finalises it. The queue unifies these with the
// existing content change_requests so one console approves everything. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { emitPlatformEvent } from "./events";

export type WorkflowDef = { key: string; name: string; entityType: string; icon: string; steps: { label: string }[]; description: string };

// Configurable approval types — the POS-001D catalogue. Multi-step where a real
// process needs more than one sign-off (e.g. tenant provisioning).
export const WORKFLOW_CATALOGUE: WorkflowDef[] = [
  { key: "tenant_provision", name: "Tenant Provisioning", entityType: "tenant", icon: "🏢", steps: [{ label: "Commercial approval" }, { label: "Technical approval" }], description: "Approve a new tenant before activation." },
  { key: "org_onboarding", name: "Organisation Onboarding", entityType: "organisation", icon: "🏛️", steps: [{ label: "Platform review" }], description: "Approve a new organisation." },
  { key: "framework_publication", name: "Framework Publication", entityType: "framework", icon: "📐", steps: [{ label: "Content review" }], description: "Publish a competency framework." },
  { key: "competency_publication", name: "Competency Publication", entityType: "competency", icon: "🎯", steps: [{ label: "Content review" }], description: "Publish a competency." },
  { key: "assessment_publication", name: "Assessment Publication", entityType: "assessment", icon: "📝", steps: [{ label: "Quality review" }], description: "Publish an assessment." },
  { key: "ai_content_review", name: "AI Content Review", entityType: "ai_content", icon: "🧠", steps: [{ label: "Human review" }], description: "Review AI-generated content before use." },
  { key: "user_invitation", name: "User Invitation", entityType: "invitation", icon: "✉️", steps: [{ label: "Admin approval" }], description: "Approve a platform user invitation." },
  { key: "knowledge_publication", name: "Knowledge Publication", entityType: "knowledge", icon: "📚", steps: [{ label: "Editorial review" }], description: "Publish a knowledge object." },
  { key: "policy_publication", name: "Policy Publication", entityType: "policy", icon: "📄", steps: [{ label: "Technical review" }, { label: "Governance approval" }], description: "Approve and publish an enterprise policy." },
];
export const workflowDef = (key: string) => WORKFLOW_CATALOGUE.find(w => w.key === key);

// Open a new approval request at step 0.
export async function submitApproval(admin: any, i: { workflowKey: string; entityId?: string | null; entityName?: string | null; payload?: any; requestedBy?: string | null; requestedByName?: string | null }) {
  const def = workflowDef(i.workflowKey);
  if (!def) return { ok: false, error: "Unknown workflow" };
  const ins = await admin.from("plat_approval_requests").insert({
    workflow_key: def.key, entity_type: def.entityType, entity_id: i.entityId ?? null, entity_name: i.entityName ?? def.name,
    payload: i.payload ?? null, status: "pending", current_step: 0, total_steps: def.steps.length,
    requested_by: i.requestedBy ?? null, requested_by_name: i.requestedByName ?? null,
  }).select().single();
  if (ins.error) return { ok: false, error: /does not exist|schema cache/i.test(ins.error.message) ? "migration_required" : ins.error.message };
  await emitPlatformEvent(admin, { event_type: "approval.submitted", severity: "info", payload: { workflow: def.key, entity: ins.data.entity_name } });
  // Audit the submission too (decide() already audits decisions), so the full
  // request lifecycle is traceable in audit_log.
  await admin.from("audit_log").insert({ actor_id: i.requestedBy ?? null, actor_name: i.requestedByName ?? null, action: "approval_submitted", entity_type: "approval", entity_id: ins.data.id, entity_name: ins.data.entity_name });
  return { ok: true, request: ins.data };
}

// Approve/reject a request. `approval` source drives the engine (advance step →
// finalise); `change_request` source acts on the existing content-approval table.
export async function decide(admin: any, i: { source?: "approval" | "change_request"; requestId: string; decision: "approved" | "rejected"; actorId?: string | null; actorName?: string | null; note?: string | null }) {
  if (i.decision !== "approved" && i.decision !== "rejected") return { ok: false, error: "Invalid decision" };

  if (i.source === "change_request") {
    const { data: row } = await admin.from("change_requests").select("id, status, entity_name").eq("id", i.requestId).maybeSingle();
    if (!row) return { ok: false, error: "Not found" };
    if (row.status !== "open") return { ok: false, error: "Already decided" };
    const { error } = await admin.from("change_requests").update({ status: i.decision, reviewed_by: i.actorId ?? null }).eq("id", i.requestId);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor_id: i.actorId ?? null, action: `change_request_${i.decision}`, entity_type: "change_request", entity_id: i.requestId, entity_name: row.entity_name });
    return { ok: true, status: i.decision };
  }

  const { data: req } = await admin.from("plat_approval_requests").select("*").eq("id", i.requestId).maybeSingle();
  if (!req) return { ok: false, error: "Not found" };
  if (req.status !== "pending") return { ok: false, error: "Already decided" };
  await admin.from("plat_approval_decisions").insert({ request_id: req.id, step: req.current_step, decision: i.decision, actor_id: i.actorId ?? null, actor_name: i.actorName ?? null, note: i.note ?? null });

  let update: any;
  if (i.decision === "rejected") update = { status: "rejected", decided_at: new Date().toISOString() };
  else if (req.current_step + 1 >= req.total_steps) update = { status: "approved", decided_at: new Date().toISOString() };
  else update = { current_step: req.current_step + 1 };
  const { data } = await admin.from("plat_approval_requests").update(update).eq("id", req.id).select().single();

  await emitPlatformEvent(admin, { event_type: `approval.${data.status === "pending" ? "advanced" : data.status}`, severity: "info", payload: { workflow: req.workflow_key } });
  await admin.from("audit_log").insert({ actor_id: i.actorId ?? null, action: `approval_${i.decision}`, entity_type: "approval", entity_id: req.id, entity_name: req.entity_name });
  return { ok: true, status: data.status, step: `${data.current_step + 1}/${data.total_steps}` };
}

const DAY = 86400000;

// Pending queue (both sources) + per-workflow counts + recent decisions.
export async function loadApprovalOps(admin: any) {
  const [reqRes, crRes] = await Promise.all([
    admin.from("plat_approval_requests").select("id, workflow_key, entity_type, entity_name, status, current_step, total_steps, requested_by_name, created_at, decided_at").order("created_at", { ascending: false }).limit(500),
    admin.from("change_requests").select("id, entity_type, entity_name, change_kind, status, requested_by_name, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(200),
  ]);
  const ready = !reqRes.error;
  const reqs = (ready ? reqRes.data ?? [] : []) as any[];
  const crs = (crRes.error ? [] : crRes.data ?? []) as any[];

  const queue = [
    ...reqs.filter(r => r.status === "pending").map(r => { const def = workflowDef(r.workflow_key); return { source: "approval", id: r.id, workflow: def?.name ?? r.workflow_key, icon: def?.icon ?? "📋", entityType: r.entity_type, entityName: r.entity_name, requestedBy: r.requested_by_name, step: `step ${r.current_step + 1}/${r.total_steps}`, at: r.created_at }; }),
    ...crs.map(r => ({ source: "change_request", id: r.id, workflow: "Content Change", icon: "✏️", entityType: r.entity_type, entityName: r.entity_name, requestedBy: r.requested_by_name, step: r.change_kind ?? "revision", at: r.created_at })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const decided = reqs.filter(r => r.status !== "pending" && r.status !== "cancelled");
  const d24 = decided.filter(r => r.decided_at && new Date(r.decided_at).getTime() >= Date.now() - DAY);
  const byWorkflow = WORKFLOW_CATALOGUE.map(w => ({ key: w.key, name: w.name, icon: w.icon, steps: w.steps.length, pending: reqs.filter(r => r.workflow_key === w.key && r.status === "pending").length }));

  return {
    queue,
    byWorkflow,
    recentDecisions: decided.slice(0, 10).map(r => ({ workflow: workflowDef(r.workflow_key)?.name ?? r.workflow_key, entityName: r.entity_name, status: r.status, at: r.decided_at })),
    summary: {
      ready,
      pending: queue.length,
      approvals: reqs.filter(r => r.status === "pending").length,
      contentChanges: crs.length,
      approved24h: d24.filter(r => r.status === "approved").length,
      rejected24h: d24.filter(r => r.status === "rejected").length,
      workflows: WORKFLOW_CATALOGUE.length,
    },
  };
}
