import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, isSupervisor, forbidden, badRequest } from "@/lib/api-auth";
import { templateByKey } from "@/lib/operations/pos-form-templates";

// Patient Operations governance API (POS-106A §13). The Unit Manager Governance Mode operating on
// the SAME shared POS-106 objects — never a second record.
//   POST  action=create_exception    → record a policy/rule exception (op_exceptions, requested)
//   PATCH action=decide_exception ?id → approve / reject / revoke (segregation of duties: not self)
//   POST  action=request_amendment    → request correction of a COMPLETED form (op_amendment_requests)
//   PATCH action=decide_amendment ?id → approve (creates a NEW linked version of the form instance,
//                                       original preserved and marked 'amended') / reject
// Operational users may request; only governance roles decide. Tenant-scoped; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();          // operational + governance users may request
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const hid = c.hospitalId ?? b.hospital_id ?? null;
  if (!hid) return badRequest("hospital scope required");

  if (b.action === "create_exception") {
    if (!b.exception_type || !b.reason || !b.reason_category) return badRequest("exception_type, reason_category and reason required");
    const { data, error } = await admin.from("op_exceptions").insert({
      hospital_id: hid, patient_id: b.patient_id || null, form_instance_id: b.form_instance_id || null,
      exception_type: b.exception_type, rule_ref: b.rule_ref || null, reason_category: b.reason_category, reason: b.reason,
      risk_level: b.risk_level || null, temporary_controls: b.temporary_controls || null,
      requester_id: c.userId, requester_role: c.role ?? null, effective_from: b.effective_from || null, expiry: b.expiry || null, status: "requested",
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_pos_exception", entity_type: "op_exception", entity_id: data.id, hospital_id: hid, new_value: { type: b.exception_type } });
    return NextResponse.json(data, { status: 201 });
  }

  if (b.action === "request_amendment") {
    if (!b.form_instance_id || !b.reason) return badRequest("form_instance_id and reason required");
    const { data: inst } = await admin.from("op_form_instances").select("hospital_id, patient_id, state").eq("id", b.form_instance_id).maybeSingle();
    if (!inst) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    if (!isSuper(c) && inst.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (!["submitted", "awaiting_verification", "verified", "finalised"].includes(inst.state)) return badRequest("Only completed/submitted forms can be amended");
    const { data, error } = await admin.from("op_amendment_requests").insert({
      hospital_id: inst.hospital_id, form_instance_id: b.form_instance_id, patient_id: inst.patient_id,
      requested_by: c.userId, requester_role: c.role ?? null, reason: b.reason, proposed_payload: b.proposed_payload || null, status: "requested",
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "request_pos_amendment", entity_type: "op_amendment_request", entity_id: data.id, hospital_id: inst.hospital_id, new_value: { form: b.form_instance_id } });
    return NextResponse.json(data, { status: 201 });
  }

  return badRequest("valid action required (create_exception|request_amendment)");
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();   // governance decision only
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (b.action === "decide_exception") {
    const decision = b.decision;
    if (!["approve", "reject", "revoke"].includes(decision)) return badRequest("decision must be approve|reject|revoke");
    if ((decision === "reject" || decision === "revoke") && !b.decision_reason) return badRequest("decision_reason required");
    const { data: ex } = await admin.from("op_exceptions").select("*").eq("id", id).maybeSingle();
    if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuper(c) && ex.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (!isSuper(c) && ex.requester_id === c.userId) return forbidden("Segregation of duties: cannot decide your own exception");
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revoked";
    const { data, error } = await admin.from("op_exceptions").update({ status, approver_id: c.userId, decision_reason: b.decision_reason || null, decided_at: now }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "decide_pos_exception", entity_type: "op_exception", entity_id: id, hospital_id: ex.hospital_id, new_value: { decision } });
    return NextResponse.json(data);
  }

  if (b.action === "decide_amendment") {
    const decision = b.decision;
    if (!["approve", "reject"].includes(decision)) return badRequest("decision must be approve|reject");
    if (decision === "reject" && !b.decision_reason) return badRequest("decision_reason required to reject");
    const { data: ar } = await admin.from("op_amendment_requests").select("*").eq("id", id).maybeSingle();
    if (!ar) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuper(c) && ar.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (ar.status !== "requested") return badRequest("Amendment already decided");
    if (!isSuper(c) && ar.requested_by === c.userId) return forbidden("Segregation of duties: cannot approve your own amendment");

    if (decision === "reject") {
      const { data, error } = await admin.from("op_amendment_requests").update({ status: "rejected", approver_id: c.userId, decision_reason: b.decision_reason, decided_at: now }).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await admin.from("audit_log").insert({ actor_id: c.userId, action: "reject_pos_amendment", entity_type: "op_amendment_request", entity_id: id, hospital_id: ar.hospital_id, new_value: { reason: b.decision_reason } });
      return NextResponse.json(data);
    }

    // approve — create a NEW linked version of the form instance; original preserved (§13.2 / BR-008).
    const { data: orig } = await admin.from("op_form_instances").select("*").eq("id", ar.form_instance_id).maybeSingle();
    if (!orig) return NextResponse.json({ error: "Original form not found" }, { status: 404 });
    const { data: amended, error: aErr } = await admin.from("op_form_instances").insert({
      hospital_id: orig.hospital_id, department_id: orig.department_id, patient_id: orig.patient_id, shift_id: orig.shift_id,
      template_key: orig.template_key, template_version: orig.template_version, title: orig.title, state: "draft",
      priority: orig.priority, payload: ar.proposed_payload && typeof ar.proposed_payload === "object" ? ar.proposed_payload : orig.payload,
      amends_id: orig.id, reason: ar.reason, created_by: c.userId,
    }).select().single();
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    await admin.from("op_form_instances").update({ state: "amended", updated_at: now }).eq("id", orig.id);
    const tpl = templateByKey(orig.template_key);
    await admin.from("op_form_events").insert({ hospital_id: orig.hospital_id, form_instance_id: orig.id, event_type: `${tpl?.eventType ?? "patient.form"}.amended`, schema_version: 1, department_id: orig.department_id, patient_id: orig.patient_id, actor_id: c.userId, actor_role: c.role ?? null, prev_state: orig.state, new_state: "amended", reason: ar.reason, correlation_id: orig.id, payload: { amendment_id: amended.id, request_id: id } });
    const { data: reqRow, error: rErr } = await admin.from("op_amendment_requests").update({ status: "approved", approver_id: c.userId, decided_at: now, amendment_instance_id: amended.id }).eq("id", id).select().single();
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "approve_pos_amendment", entity_type: "op_amendment_request", entity_id: id, hospital_id: ar.hospital_id, new_value: { amendment_id: amended.id } });
    return NextResponse.json(reqRow);
  }

  return badRequest("valid action required (decide_exception|decide_amendment)");
}
