import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";

// Staff availability (UMW-WFM-005 §13-14/§19) — records a declared/inferred availability window
// into op_staff_availability (migration 083), with source + confidence (§13.3). isSupervisor
// gate (manager-confirmed source); audited (record_availability).
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["normal", "additional", "on_call", "standby", "redeployment", "overtime", "remote", "partial", "temporarily_unavailable", "unavailable", "unknown"];

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.staff_id || !TYPES.includes(b.availability_type)) return badRequest("staff_id and valid availability_type required");
  const staffScope = await assertProfileScope(c, b.staff_id);
  if (staffScope) return staffScope;
  const { data: staff } = await admin.from("profiles").select("hospital_id, full_name").eq("id", b.staff_id).maybeSingle();
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  const hospitalId = staff.hospital_id ?? c.hospitalId;
  if (!isSuper(c) && hospitalId !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await admin.from("op_staff_availability").insert({
    hospital_id: hospitalId, staff_id: b.staff_id, staff_name: staff.full_name ?? null,
    availability_type: b.availability_type, period_start: b.period_start || null, period_end: b.period_end || null,
    preferred_shift: b.preferred_shift || null, restricted_shift: b.restricted_shift || null, reason: b.reason || null,
    source: "manager_confirmed", confidence: "manager_confirmed", expires_at: b.expires_at || null, updated_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_availability", entity_type: "op_staff_availability", entity_id: data.id, hospital_id: hospitalId, new_value: { staff_id: b.staff_id, availability_type: b.availability_type } });
  return NextResponse.json(data, { status: 201 });
}
