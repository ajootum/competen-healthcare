/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-001 + CDP-015 — Delivery Orchestrator. Closes the event→schedule→deliver loop the CDP triage flagged:
// evaluates active assignment RULES and materialises the ones never yet delivered into target-based
// cmo_assignments (method='rule'), emitting a competency.assigned domain event per delivery. Reuses the
// COMP-018 rule model (cmo_assignment_rules 125), cmo_assignments (114) and the domain_events outbox (102).
// Read side = a delivery QUEUE (pending / delivered / overdue); write side is idempotent (a rule already
// delivered is skipped). A cron job (platform/jobs.ts → delivery_orchestration) runs it automatically per tenant.

import { emitDomainEvent, EVENT } from "@/lib/orchestration/events";

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const scoped = (q: any, hid: string | null, isSuper: boolean) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

type RuleRow = { id: string; hospital_id: string | null; competency_name: string | null; competency_id: string | null; target_role: string | null; target_label: string | null; due_days: number; priority: string };
type AsgRow = { id: string; competency: string; target_label: string | null; status: string; due_date: string | null };

const compOf = (r: RuleRow) => r.competency_name ?? "—";
const labelOf = (r: RuleRow) => r.target_label ?? r.target_role ?? "All staff";

async function loadRules(admin: Admin, hid: string | null, isSuper: boolean): Promise<RuleRow[] | null> {
  const res = await scoped(
    admin.from("cmo_assignment_rules").select("id, hospital_id, competency_name, competency_id, target_role, target_label, due_days, priority").eq("is_active", true).limit(5000),
    hid, isSuper,
  );
  if (res.error) return null;
  return (res.data ?? []) as RuleRow[];
}

async function ruleAssignments(admin: Admin, hid: string | null, isSuper: boolean): Promise<AsgRow[]> {
  const res = await scoped(admin.from("cmo_assignments").select("id, competency, target_label, status, due_date").eq("method", "rule").limit(20000), hid, isSuper);
  return (res.data ?? []) as AsgRow[];
}

// A rule is "delivered" once a matching rule-method assignment exists (competency + effective target label).
const isDelivered = (r: RuleRow, asg: AsgRow[]) => asg.some(a => a.competency === compOf(r) && a.target_label === labelOf(r));

export async function loadDeliveryQueue(admin: Admin, hid: string | null, isSuper: boolean) {
  const rules = await loadRules(admin, hid, isSuper);
  if (rules === null) return { provisioned: false as const };
  const asg = await ruleAssignments(admin, hid, isSuper);

  const profRes = await scoped(admin.from("profiles").select("id, role, roles").limit(8000), hid, isSuper);
  const profs = (profRes.data ?? []) as any[];
  const matches = (p: any, role: string) => p.role === role || (Array.isArray(p.roles) && p.roles.includes(role));
  const popIds = (role: string | null) => (role ? profs.filter(p => matches(p, role)).map(p => p.id as string) : profs.map(p => p.id as string));

  const rows = rules.map(r => ({ id: r.id, competency: compOf(r), target: labelOf(r), population: popIds(r.target_role).length, priority: r.priority as string, dueDays: r.due_days, delivered: isDelivered(r, asg) }));
  const pending = rows.filter(r => !r.delivered);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = asg.filter(a => a.due_date && a.due_date < today && !["completed", "exempt"].includes(a.status)).length;
  const reach = new Set(rules.flatMap(r => popIds(r.target_role))).size;

  return {
    provisioned: true as const,
    kpis: { activeRules: rows.length, pending: pending.length, delivered: rows.length - pending.length, overdue, reach },
    pending,
    rows: rows.sort((a, b) => Number(a.delivered) - Number(b.delivered)),
  };
}

export async function runOrchestration(admin: Admin, hid: string | null, isSuper: boolean, actor: { id: string | null; name: string | null }) {
  const rules = await loadRules(admin, hid, isSuper);
  if (rules === null) return { ok: false as const, error: "Assignment rules not provisioned (migration 125)", created: 0, skipped: 0, events: 0 };
  const asg = await ruleAssignments(admin, hid, isSuper);
  const pending = rules.filter(r => !isDelivered(r, asg));

  let created = 0, events = 0;
  const now = Date.now();
  for (const r of pending) {
    const dueDate = new Date(now + (r.due_days || 30) * 864e5).toISOString().slice(0, 10);
    const { data, error } = await admin.from("cmo_assignments").insert({
      hospital_id: r.hospital_id, competency: compOf(r), target_type: "role", target_label: labelOf(r), method: "rule", due_date: dueDate, status: "assigned",
    }).select("id").single();
    if (error || !data) continue;
    created++;
    const em = await emitDomainEvent(admin, {
      event_type: EVENT.COMPETENCY_ASSIGNED, subject_type: "cmo_assignment", subject_id: data.id,
      hospital_id: r.hospital_id, actor_id: actor.id, actor_name: actor.name,
      payload: { competency: compOf(r), target: labelOf(r), rule_id: r.id, due: dueDate },
    });
    if (em.ok) events++;
  }
  await admin.from("audit_log").insert({ actor_id: actor.id, actor_name: actor.name, action: "delivery_orchestration_run", entity_type: "cmo_assignments", new_value: { pending: pending.length, created, events } });
  return { ok: true as const, created, skipped: pending.length - created, events };
}
