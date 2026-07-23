import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Attendance Exceptions (UMW-WFM-005 §18) — persist a derived attendance exception and progress
// its lifecycle in op_attendance_exceptions (migration 083). Disputes remain visible until
// resolved and retain evidence/decisions (BR-ATT-011). isSupervisor gate; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTIONS: Record<string, string> = { review: "under_review", assign_hr: "awaiting_hr", resolve: "corrected", approve: "approved_exception", reject: "rejected", escalate: "escalated", close: "closed" };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.shift_id || !b.category) return badRequest("shift_id and category required");
  const { data: shift } = await admin.from("op_shifts").select("hospital_id, department_id").eq("id", b.shift_id).maybeSingle();
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  if (!isSuper(c) && shift.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await admin.from("op_attendance_exceptions").insert({
    hospital_id: shift.hospital_id, shift_id: b.shift_id, shift_staff_id: b.shift_staff_id || null, staff_id: b.staff_id || null,
    staff_name: b.staff_name || null, department_id: shift.department_id || null, category: b.category,
    severity: b.severity || "moderate", status: "new", operational_impact: b.operational_impact || null, rule_breached: b.rule_breached || null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_attendance_exception", entity_type: "op_attendance_exception", entity_id: data.id, hospital_id: shift.hospital_id, new_value: { category: b.category, severity: b.severity } });
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
  const { data: row } = await admin.from("op_attendance_exceptions").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const patch: any = { status };
  if (b.resolution_action) patch.resolution_action = b.resolution_action;
  if (["corrected", "approved_exception", "rejected", "closed"].includes(status)) { patch.resolved_by = c.userId; patch.resolved_at = new Date().toISOString(); }
  const { data, error } = await admin.from("op_attendance_exceptions").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_attendance_exception", entity_type: "op_attendance_exception", entity_id: id, hospital_id: row.hospital_id, new_value: { action: b.action } });
  return NextResponse.json(data);
}
