import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Roster actuals (UMW-WFM-004 §17) — planned-vs-actual attendance confirmation into
// op_roster_actuals (migration 082). A SEPARATE record; actual attendance never overwrites the
// planned roster (BR-EXA-013 / §17). Manager gate; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUSES = ["attended", "approved_replacement", "unapproved_replacement", "sickness", "no_show", "late", "early_departure", "redeployed", "overtime_extension", "supervisor_change", "role_change", "cancelled"];

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.roster_id || !STATUSES.includes(b.attendance_status)) return badRequest("roster_id and valid attendance_status required");
  const { data: roster } = await admin.from("op_rosters").select("hospital_id").eq("id", b.roster_id).maybeSingle();
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 });
  if (!isSuper(c) && roster.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const { data, error } = await admin.from("op_roster_actuals").insert({
    hospital_id: roster.hospital_id, roster_id: b.roster_id, roster_assignment_id: b.roster_assignment_id || null,
    unit_name: b.unit_name || null, shift_date: b.shift_date || null, shift_type: b.shift_type || null,
    staff_name: b.staff_name || null, attendance_status: b.attendance_status, variance_reason: b.variance_reason || null,
    confirmed_by: c.userId, confirmed_by_name: me?.full_name ?? null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_roster_actual", entity_type: "op_roster_actual", entity_id: data.id, hospital_id: roster.hospital_id, new_value: { attendance_status: b.attendance_status } });
  return NextResponse.json(data, { status: 201 });
}
