import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden } from "@/lib/api-auth";

// COMP-018 — MATERIALISE an assignment rule: expand ONE rule into a single target-based cmo_assignments row
// (method='rule') covering its population. Idempotent — an active identical assignment (same competency +
// population label, in this scope) is not duplicated. Competency-office tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 125 to enable the assignment rules engine" }, { status: 409 }) : null;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Applying assignment rules requires competency-office authority");
  const id = (await params).id;

  const { data: rule, error: rErr } = await c.admin.from("cmo_assignment_rules").select("id, hospital_id, competency_name, target_role, target_label, due_days").eq("id", id).maybeSingle();
  if (rErr) return migrationGate(rErr) ?? NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  if (!isSuper(c) && rule.hospital_id && rule.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const competency = rule.competency_name;
  const targetLabel = rule.target_label ?? rule.target_role ?? "All staff";
  const dueDays = Number.isFinite(rule.due_days) ? rule.due_days : 30;
  const due = new Date(); due.setDate(due.getDate() + dueDays);
  const dueDate = due.toISOString().slice(0, 10);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  // DEDUP: an active rule-materialised assignment for the same competency + population (in this scope) is not re-created.
  let dq = c.admin.from("cmo_assignments").select("id").eq("method", "rule").eq("competency", competency).eq("target_label", targetLabel).in("status", ["assigned", "in_progress"]);
  dq = rule.hospital_id ? dq.eq("hospital_id", rule.hospital_id) : dq.is("hospital_id", null);
  const { data: existing } = await dq.limit(1).maybeSingle();
  if (existing) {
    await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "apply_assignment_rule", entity_type: "cmo_assignment_rule", entity_id: id, hospital_id: rule.hospital_id ?? null, new_value: { competency, target: targetLabel, already: true } });
    return NextResponse.json({ ok: true, already: true, created: false, id: existing.id });
  }

  const { data: ins, error } = await c.admin.from("cmo_assignments").insert({
    hospital_id: rule.hospital_id ?? null, competency, target_type: "role", target_label: targetLabel,
    method: "rule", due_date: dueDate, status: "assigned",
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "apply_assignment_rule", entity_type: "cmo_assignment_rule", entity_id: id, hospital_id: rule.hospital_id ?? null, new_value: { competency, target: targetLabel, assignment_id: ins.id } });
  return NextResponse.json({ ok: true, already: false, created: true, id: ins.id });
}
