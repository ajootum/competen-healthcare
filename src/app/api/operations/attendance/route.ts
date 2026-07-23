import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Attendance (UMW-WFM-005) — record a timestamped attendance event and update shift-staff
// state in one audited transaction. Writes an append-only op_attendance_events row (never
// deleted — BR-ATT-010) and computes minutes-late from the shift start (op_shifts.starts_at)
// on check-in. A correction is a separate record and never overwrites the original (BR-ATT-003;
// corrections API is next-phase). isSupervisor gate (assessor / hospital_admin / super_admin).
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTIONS: Record<string, { event_type: string; status: string }> = {
  check_in: { event_type: "check_in", status: "on_duty" },
  acknowledge: { event_type: "status_change", status: "confirmed" },
  mark_absent: { event_type: "absence_reported", status: "absent" },
  check_out: { event_type: "check_out", status: "off_duty" },
  reset: { event_type: "status_change", status: "assigned" },
};

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const id = b.shift_staff_id;
  const act = ACTIONS[b.action];
  if (!id || !act) return badRequest("shift_staff_id and valid action required");

  const { data: row } = await admin.from("op_shift_staff").select("id, shift_id, staff_id, status, role, profiles!staff_id(full_name), op_shifts!shift_id(hospital_id, starts_at, department_id)").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hospitalId = row.op_shifts?.hospital_id ?? null;
  if (!isSuper(c) && hospitalId !== c.hospitalId) return forbidden("Out of scope");

  const now = new Date();
  let minutesLate: number | null = null;
  if (act.event_type === "check_in" && row.op_shifts?.starts_at) {
    minutesLate = Math.max(0, Math.round((now.getTime() - new Date(row.op_shifts.starts_at).getTime()) / 60000));
  }
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const { data: evt, error: evErr } = await admin.from("op_attendance_events").insert({
    hospital_id: hospitalId, shift_id: row.shift_id, shift_staff_id: row.id, staff_id: row.staff_id,
    staff_name: row.profiles?.full_name ?? null, department_id: row.op_shifts?.department_id ?? null,
    event_type: act.event_type, event_at: now.toISOString(), previous_status: row.status, new_status: act.status,
    check_in_method: act.event_type === "check_in" ? (b.method || "supervisor") : null,
    minutes_late: minutesLate, actor_id: c.userId, actor_name: me?.full_name ?? null, actor_role: c.role, reason: b.reason ?? null,
  }).select().single();
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  const { data: updated, error: upErr } = await admin.from("op_shift_staff").update({ status: act.status }).eq("id", id).select().single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_attendance", entity_type: "op_shift_staff", entity_id: id, hospital_id: hospitalId, new_value: { action: b.action, status: act.status, minutes_late: minutesLate } });
  return NextResponse.json({ event: evt, staff: updated, minutesLate }, { status: 201 });
}
