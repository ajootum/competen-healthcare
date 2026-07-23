import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSupervisor, forbidden, badRequest } from "@/lib/api-auth";

// Approvals Workspace (UMW-EA-001) API. POST creates an approval request (with a
// rule-based AI recommendation + SLA due date); PATCH records a decision
// (approve / approve-with-conditions / reject / return / delegate / escalate /
// request-info / comment). Every decision is audit-logged. Decisions require the
// supervisor/manager gate; submitting a request only requires staff.
/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();
const CATS = ["personnel", "staffing", "clinical", "competency", "education", "equipment", "policy", "finance", "operations", "it", "governance"];

function aiRec(category: string, priority: string, impact: string) {
  if (priority === "low" && impact === "low") return { rec: "approve", conf: 95, reason: "Low priority and low operational impact — routine approval within delegated authority." };
  if (category === "staffing" || category === "personnel") return { rec: "review", conf: 80, reason: "Staffing decision — review coverage and skill-mix impact before approving." };
  if (category === "finance") return { rec: "review", conf: 75, reason: "Financial impact — verify budget threshold and procurement policy." };
  if (priority === "critical") return { rec: "escalate", conf: 72, reason: "Critical priority — consider escalation to executive review." };
  return { rec: "approve", conf: 85, reason: "Within delegated authority; no policy or budget breach detected." };
}

const ACTION_STATUS: Record<string, string> = {
  approve: "approved", approve_conditions: "approved", reject: "rejected", return: "returned",
  delegate: "delegated", escalate: "escalated", request_info: "pending_info",
};

async function migrationGate(admin: any) {
  const probe = await admin.from("approval_requests").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) {
    return NextResponse.json({ error: "Approvals store not provisioned. Run migration 077." }, { status: 409 });
  }
  return null;
}
async function name(admin: any, id: string) { const { data } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle(); return data?.full_name ?? null; }

export async function POST(req: Request) {
  const c = await getCaller() as any;
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const gate = await migrationGate(c.admin); if (gate) return gate;

  const b = await req.json().catch(() => ({}));
  if (!b.title || typeof b.title !== "string") return badRequest("title required");
  const category = CATS.includes(b.category) ? b.category : "operations";
  const priority = ["critical", "high", "medium", "low"].includes(b.priority) ? b.priority : "medium";
  const impact = ["high", "medium", "low"].includes(b.impact) ? b.impact : "medium";
  const slaHours = Number.isFinite(b.sla_hours) ? b.sla_hours : 24;
  const ai = aiRec(category, priority, impact);
  const nm = await name(c.admin, c.userId);

  const { data, error } = await c.admin.from("approval_requests").insert({
    hospital_id: c.hospitalId ?? null, department_id: b.department_id ?? null,
    category, title: b.title.trim(), details: b.details ?? null, reason: b.reason ?? null,
    requester_id: c.userId, requester_name: nm, requester_role: (c.roles ?? [])[0] ?? null,
    priority, impact, status: "waiting",
    ai_recommendation: ai.rec, ai_confidence: ai.conf, ai_reasoning: ai.reason,
    sla_hours: slaHours, submitted_at: nowIso(), due_at: new Date(Date.now() + slaHours * 3600000).toISOString(),
  }).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: nm, action: "create_approval_request", entity_type: "approval_request", entity_id: data?.id, entity_name: b.title, hospital_id: c.hospitalId ?? null, new_value: { category, priority } });
  return NextResponse.json({ ok: true, id: data?.id });
}

export async function PATCH(req: Request) {
  const c = await getCaller() as any;
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden("Manager/supervisor decision required");
  const gate = await migrationGate(c.admin); if (gate) return gate;

  const b = await req.json().catch(() => ({}));
  const id = b.id as string; const action = b.action as string;
  if (!id || !action) return badRequest("id and action required");
  if (!ACTION_STATUS[action] && action !== "comment") return badRequest("unknown action");

  const { data: prev } = await c.admin.from("approval_requests").select("status, title").eq("id", id).maybeSingle();
  if (!prev) return badRequest("request not found");
  const nm = await name(c.admin, c.userId);

  if (action === "comment") {
    await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: nm, action: "comment_approval", entity_type: "approval_request", entity_id: id, entity_name: prev.title, hospital_id: c.hospitalId ?? null, new_value: { note: b.note ?? null } });
    return NextResponse.json({ ok: true });
  }

  const status = ACTION_STATUS[action];
  const terminal = ["approved", "rejected"].includes(status);
  const patch: any = { status, updated_at: nowIso(), decision_note: b.note ?? null };
  if (terminal || action === "delegate" || action === "escalate") { patch.decided_by = c.userId; patch.decided_by_name = nm; patch.decided_at = nowIso(); }
  if (action === "delegate") { patch.delegated_to = b.delegate_to ?? null; patch.delegated_to_name = b.delegate_to_name ?? null; }

  const { error } = await c.admin.from("approval_requests").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: nm, action: `approval_${action}`, entity_type: "approval_request", entity_id: id, entity_name: prev.title, hospital_id: c.hospitalId ?? null, old_value: { status: prev.status }, new_value: { status, note: b.note ?? null } });
  return NextResponse.json({ ok: true, status });
}
