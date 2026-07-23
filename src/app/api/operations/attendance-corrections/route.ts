import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Attendance correction (UMW-WFM-005 §12.1 / BR-ATT-003) — a manual correction is a SEPARATE
// auditable record that NEVER overwrites the original. Writes an op_attendance_corrections row
// (previous → corrected value + reason), updates op_shift_staff to the corrected value, and logs
// an op_attendance_events status_change (so the original check-in event is preserved). Supervisor
// -entered corrections are recorded as approved. isSupervisor gate; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUSES = ["assigned", "confirmed", "on_duty", "off_duty", "absent"];

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.shift_staff_id || !STATUSES.includes(b.corrected_status) || !b.reason) return badRequest("shift_staff_id, valid corrected_status and reason required");

  const { data: row } = await admin.from("op_shift_staff").select("id, shift_id, staff_id, status, profiles!staff_id(full_name), op_shifts!shift_id(hospital_id)").eq("id", b.shift_staff_id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hospitalId = row.op_shifts?.hospital_id ?? null;
  if (!isSuper(c) && hospitalId !== c.hospitalId) return forbidden("Out of scope");
  if (row.status === b.corrected_status) return badRequest("corrected_status equals current status");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const now = new Date().toISOString();

  const { data: corr, error: cErr } = await admin.from("op_attendance_corrections").insert({
    hospital_id: hospitalId, shift_staff_id: row.id, staff_id: row.staff_id, field_corrected: "status",
    previous_value: row.status, corrected_value: b.corrected_status, effective_time: now, reason: b.reason,
    entered_by: c.userId, entered_by_name: me?.full_name ?? null, approver_id: c.userId, approved_at: now, status: "approved",
  }).select().single();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // Preserve original: log a status_change event, then update live state.
  await admin.from("op_attendance_events").insert({
    hospital_id: hospitalId, shift_id: row.shift_id, shift_staff_id: row.id, staff_id: row.staff_id, staff_name: row.profiles?.full_name ?? null,
    event_type: "status_change", event_at: now, previous_status: row.status, new_status: b.corrected_status,
    actor_id: c.userId, actor_name: me?.full_name ?? null, actor_role: c.role, reason: `correction: ${b.reason}`,
  });
  const { error: upErr } = await admin.from("op_shift_staff").update({ status: b.corrected_status }).eq("id", row.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_correction", entity_type: "op_shift_staff", entity_id: row.id, hospital_id: hospitalId, old_value: { status: row.status }, new_value: { status: b.corrected_status, reason: b.reason } });
  return NextResponse.json({ correction: corr }, { status: 201 });
}
