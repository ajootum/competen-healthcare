import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Replacement & Redeployment (UMW-WFM-005 §17) — create and progress a replacement/redeployment
// request in op_replacement_requests (migration 083). A no-show triggers a staffing impact
// assessment + replacement workflow (BR-ATT-007); a candidate must meet competency/credential/
// working-hour rules before being recommended (BR-ATT-005 — enforced when the candidate pool is
// built). isSupervisor gate; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTIONS: Record<string, string> = { offer: "offered", accept: "accepted", decline: "declined", fill: "filled", redeploy: "redeployed", cancel: "cancelled", escalate: "escalated" };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.shift_id || !b.role) return badRequest("shift_id and role required");
  const { data: shift } = await admin.from("op_shifts").select("hospital_id, department_id").eq("id", b.shift_id).maybeSingle();
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  if (!isSuper(c) && shift.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const { data, error } = await admin.from("op_replacement_requests").insert({
    hospital_id: shift.hospital_id, shift_id: b.shift_id, absent_staff_id: b.absent_staff_id || null,
    role: b.role, quantity: b.quantity || 1, reason: b.reason || null, priority: b.priority || "normal",
    origin_department_id: b.origin_department_id || null, destination_department_id: shift.department_id || null,
    is_redeployment: !!b.is_redeployment, status: "identified", requested_by: c.userId, requested_by_name: me?.full_name ?? null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_replacement", entity_type: "op_replacement_request", entity_id: data.id, hospital_id: shift.hospital_id, new_value: { shift_id: b.shift_id, role: b.role } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const status = ACTIONS[b.action];
  if (!status) return badRequest("valid action required");
  const { data: row } = await admin.from("op_replacement_requests").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const patch: any = { status };
  if (b.selected_staff_id) patch.selected_staff_id = b.selected_staff_id;
  if (b.selected_staff_name) patch.selected_staff_name = b.selected_staff_name;
  if (["filled", "redeployed", "cancelled", "declined"].includes(status)) patch.resolved_at = new Date().toISOString();
  const { data, error } = await admin.from("op_replacement_requests").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_replacement", entity_type: "op_replacement_request", entity_id: id, hospital_id: row.hospital_id, new_value: { action: b.action } });
  return NextResponse.json(data);
}
