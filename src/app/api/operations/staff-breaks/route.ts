import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { BREAK_TYPES } from "@/lib/operations/workforce-breaks-notes";

// Break management (SSW-WFO-001 §4). POST schedules a break; PATCH advances it
// (start → on_break, end → completed, or mark overdue/missed). Supervisor tier,
// tenant-scoped, audit-logged; 409 migration hint until 069 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const TRANSITIONS = ["on_break", "completed", "overdue", "missed", "cancelled", "scheduled"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 069 to enable break management" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.staff_id) return badRequest("staff_id required");
  const type = BREAK_TYPES.includes(b.break_type) ? b.break_type : "rest";

  const { data: staff } = await c.admin.from("profiles").select("id, full_name, hospital_id").eq("id", b.staff_id).maybeSingle();
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  if (!isSuper(c) && staff.hospital_id && c.hospitalId && staff.hospital_id !== c.hospitalId) return forbidden("Staff out of scope");
  const dur = Number(b.duration_min); const duration = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 30;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_staff_breaks").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? staff.hospital_id : NONE), shift_id: b.shift_id ?? null,
    staff_id: staff.id, staff_name: staff.full_name ?? null, role: b.role ?? null,
    break_type: type, status: "scheduled", scheduled_at: b.scheduled_at ?? new Date().toISOString(),
    duration_min: duration, notes: b.notes?.trim() || null, created_by: c.userId,
  }).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "schedule_break", entity_type: "staff_break", entity_id: data.id, entity_name: staff.full_name, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  if (!TRANSITIONS.includes(b.status)) return badRequest("valid status required");

  const { data: row } = await c.admin.from("op_staff_breaks").select("hospital_id, staff_name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Break not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const update: any = { status: b.status, updated_at: new Date().toISOString() };
  if (b.status === "on_break") update.started_at = new Date().toISOString();
  if (b.status === "completed") update.ended_at = new Date().toISOString();
  if (typeof b.relief_name === "string") update.relief_name = b.relief_name.trim() || null;

  const { data, error } = await c.admin.from("op_staff_breaks").update(update).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `break_${data.status}`, entity_type: "staff_break", entity_id: data.id, entity_name: row.staff_name, hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
