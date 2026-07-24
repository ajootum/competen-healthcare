import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { templateByKey, type PosField } from "@/lib/operations/pos-form-templates";

// Patient Operations Centre form engine API (POS-106 §8/§11). One entry, distributed everywhere:
//   POST  action=save    → create / update a draft op_form_instance (no events)
//   POST  action=submit  → validate, persist, transition state, write an immutable op_form_event
//                          envelope, append an op_movement_events timeline entry and turn "actions"
//                          rows into op_tasks (+ op_escalations / op_operational_notes where the
//                          template maps to those stores).
//   PATCH action=verify|return|amend|cancel (?id=) → governed lifecycle transitions (§8.2).
// Submitted records are amended, never overwritten (BR-008): amend creates a NEW instance linked
// via amends_id and marks the original 'amended'. Manager gate; tenant-scoped; audited. All
// timestamps server-generated (BR-015).
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV_MAP: Record<string, string> = { low: "routine", moderate: "urgent", medium: "urgent", high: "high", critical: "critical", emergency: "emergency" };
const TASK_PRIORITY: Record<string, string> = { low: "low", medium: "normal", normal: "normal", routine: "normal", high: "high", urgent: "urgent", emergency: "urgent" };
// op_movement_events.event_type is CHECK-constrained — map each template to an allowed value.
const MOVE_TYPE: Record<string, string> = { admission: "admission", transfer: "transfer", procedure: "theatre", escalation: "escalation" };

const actionFields = (tpl: any): PosField[] => tpl.fields.filter((f: PosField) => f.type === "actions");

async function resolveHospital(admin: any, c: any, patientId: string | null, bodyHid: string | null) {
  if (patientId) {
    const { data } = await admin.from("op_patients").select("hospital_id").eq("id", patientId).maybeSingle();
    if (data?.hospital_id) return data.hospital_id as string;
  }
  return (c.hospitalId ?? bodyHid ?? null) as string | null;
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const action = b.action === "submit" ? "submit" : "save";
  const tpl = templateByKey(b.template_key);
  if (!tpl) return badRequest("valid template_key required");
  const payload = (b.payload && typeof b.payload === "object") ? b.payload : {};
  const patientId = b.patient_id || null;

  // Required-field validation on submit (§9 structured validation).
  if (action === "submit") {
    const missing = tpl.fields.filter(f => (f as any).required && f.type !== "actions" && f.type !== "checklist")
      .filter(f => { const v = payload[f.key]; return v == null || v === "" || (typeof v === "boolean" ? false : String(v).trim() === ""); })
      .map(f => f.label);
    if (missing.length) return badRequest(`Missing required: ${missing.join(", ")}`);
  }

  const hid = await resolveHospital(admin, c, patientId, b.hospital_id ?? null);
  if (!hid) return badRequest("hospital scope could not be resolved");
  if (!isSuper(c) && c.hospitalId && hid !== c.hospitalId) return forbidden("Out of scope");

  const now = new Date().toISOString();

  // Upsert the instance.
  let instanceId = b.id || null;
  const baseRow: any = {
    hospital_id: hid, department_id: b.department_id || null, patient_id: patientId,
    template_key: tpl.key, title: b.title || tpl.name, priority: b.priority || null,
    payload, due_at: payload.due_at || b.due_at || null, updated_at: now,
  };
  if (instanceId) {
    const { data: existing } = await admin.from("op_form_instances").select("hospital_id, state").eq("id", instanceId).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    if (!isSuper(c) && existing.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (["submitted", "awaiting_verification", "verified", "finalised", "amended", "cancelled"].includes(existing.state) && action === "save") return badRequest("Submitted forms are amended, not edited");
  }

  if (action === "save") {
    if (instanceId) {
      const { data, error } = await admin.from("op_form_instances").update({ ...baseRow, state: "in_progress" }).eq("id", instanceId).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
    const { data, error } = await admin.from("op_form_instances").insert({ ...baseRow, state: "draft", created_by: c.userId }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── submit ──────────────────────────────────────────────────────────────────────────────────
  const newState = tpl.verify ? "awaiting_verification" : "submitted";
  let inst: any;
  if (instanceId) {
    const { data, error } = await admin.from("op_form_instances").update({ ...baseRow, state: newState, submitted_by: c.userId, submitted_at: now }).eq("id", instanceId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inst = data;
  } else {
    const { data, error } = await admin.from("op_form_instances").insert({ ...baseRow, state: newState, created_by: c.userId, submitted_by: c.userId, submitted_at: now }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inst = data;
  }
  instanceId = inst.id;

  // Immutable event envelope (§11.1).
  const correlationId = inst.id;
  await admin.from("op_form_events").insert({
    hospital_id: hid, form_instance_id: instanceId, event_type: tpl.eventType, schema_version: 1,
    department_id: b.department_id || null, patient_id: patientId, actor_id: c.userId, actor_role: c.role ?? null,
    prev_state: "draft", new_state: newState, reason: null, correlation_id: correlationId, payload,
  });

  // Side-effects — best-effort, each isolated so a downstream store never blocks the submission.
  if (patientId) {
    try {
      await admin.from("op_movement_events").insert({
        hospital_id: hid, patient_id: patientId, event_type: MOVE_TYPE[tpl.key] ?? "note",
        detail: `${tpl.name} submitted${inst.title && inst.title !== tpl.name ? ` — ${inst.title}` : ""}`, created_by: c.userId,
      });
    } catch { /* timeline is best-effort */ }
  }
  // Action rows → op_tasks.
  for (const f of actionFields(tpl)) {
    const rows = Array.isArray(payload[f.key]) ? payload[f.key] : [];
    for (const r of rows) {
      const text = (r?.text ?? "").trim(); if (!text) continue;
      try {
        await admin.from("op_tasks").insert({
          hospital_id: hid, patient_id: patientId, task_type: "follow_up",
          description: `${text}${r.owner ? ` (owner: ${r.owner})` : ""}`,
          assigned_by: c.userId, priority: TASK_PRIORITY[(r.priority ?? "").toLowerCase()] ?? "normal",
          due_at: r.due || null, status: "created",
        });
      } catch { /* task creation best-effort */ }
    }
  }
  // Escalation template → op_escalations.
  if (tpl.key === "escalation") {
    try {
      await admin.from("op_escalations").insert({
        hospital_id: hid, patient_id: patientId, escalation_type: "clinical",
        level: Math.min(5, Math.max(1, parseInt(payload.level ?? "1", 10) || 1)),
        severity: SEV_MAP[(payload.severity ?? "").toLowerCase()] ?? "urgent",
        summary: (payload.requested_action || payload.category || "Escalation raised").slice(0, 500),
        raised_by: c.userId, status: "open",
      });
    } catch { /* escalation mirror best-effort */ }
  }
  // Operational note template → op_operational_notes.
  if (tpl.key === "operational_note" && patientId && payload.note) {
    try { await admin.from("op_operational_notes").insert({ hospital_id: hid, patient_id: patientId, note: String(payload.note).slice(0, 4000), created_by: c.userId }); } catch { /* note mirror best-effort */ }
  }

  await admin.from("audit_log").insert({ actor_id: c.userId, action: "submit_pos_form", entity_type: "op_form_instance", entity_id: instanceId, hospital_id: hid, new_value: { template: tpl.key, state: newState } });
  return NextResponse.json(inst, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const act = b.action;
  if (!["verify", "return", "amend", "cancel"].includes(act)) return badRequest("valid action required (verify|return|amend|cancel)");
  if ((act === "return" || act === "cancel" || act === "amend") && !b.reason) return badRequest("reason required");

  const { data: inst } = await admin.from("op_form_instances").select("*").eq("id", id).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && inst.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const tpl = templateByKey(inst.template_key);
  const now = new Date().toISOString();

  const evt = (event_type: string, prev: string, next: string, reason: string | null, payload: any = null) =>
    admin.from("op_form_events").insert({ hospital_id: inst.hospital_id, form_instance_id: inst.id, event_type, schema_version: 1, department_id: inst.department_id, patient_id: inst.patient_id, actor_id: c.userId, actor_role: c.role ?? null, prev_state: prev, new_state: next, reason, correlation_id: inst.id, payload });

  if (act === "verify") {
    if (inst.state !== "awaiting_verification") return badRequest("Only forms awaiting verification can be verified");
    const { data, error } = await admin.from("op_form_instances").update({ state: "verified", verified_by: c.userId, verified_at: now, updated_at: now }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await evt(`${tpl?.eventType ?? "patient.form"}.verified`, inst.state, "verified", null);
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "verify_pos_form", entity_type: "op_form_instance", entity_id: id, hospital_id: inst.hospital_id, new_value: { template: inst.template_key } });
    return NextResponse.json(data);
  }
  if (act === "return") {
    const { data, error } = await admin.from("op_form_instances").update({ state: "returned", reason: b.reason, updated_at: now }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await evt(`${tpl?.eventType ?? "patient.form"}.returned`, inst.state, "returned", b.reason);
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "return_pos_form", entity_type: "op_form_instance", entity_id: id, hospital_id: inst.hospital_id, new_value: { reason: b.reason } });
    return NextResponse.json(data);
  }
  if (act === "cancel") {
    const { data, error } = await admin.from("op_form_instances").update({ state: "cancelled", reason: b.reason, updated_at: now }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await evt(`${tpl?.eventType ?? "patient.form"}.cancelled`, inst.state, "cancelled", b.reason);
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "cancel_pos_form", entity_type: "op_form_instance", entity_id: id, hospital_id: inst.hospital_id, new_value: { reason: b.reason } });
    return NextResponse.json(data);
  }
  // amend — create a NEW instance linked to the original; original marked 'amended' (BR-008).
  const { data: amended, error: aErr } = await admin.from("op_form_instances").insert({
    hospital_id: inst.hospital_id, department_id: inst.department_id, patient_id: inst.patient_id, shift_id: inst.shift_id,
    template_key: inst.template_key, template_version: inst.template_version, title: inst.title, state: "draft",
    priority: inst.priority, payload: b.payload && typeof b.payload === "object" ? b.payload : inst.payload,
    amends_id: inst.id, reason: b.reason, created_by: c.userId,
  }).select().single();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  await admin.from("op_form_instances").update({ state: "amended", updated_at: now }).eq("id", id);
  await evt(`${tpl?.eventType ?? "patient.form"}.amended`, inst.state, "amended", b.reason, { amendment_id: amended.id });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "amend_pos_form", entity_type: "op_form_instance", entity_id: id, hospital_id: inst.hospital_id, new_value: { amendment_id: amended.id, reason: b.reason } });
  return NextResponse.json(amended, { status: 201 });
}
