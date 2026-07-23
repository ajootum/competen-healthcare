import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Roster amendments (UMW-WFM-004 §16) — controlled post-publication changes in op_roster_
// amendments (migration 082). Every change creates an amendment record and preserves the
// originally published roster (BR-EXA-006/010). Manager gate; audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["swap", "reassignment", "sickness_replacement", "leave_replacement", "emergency_cover", "supervisor_replacement", "cross_unit", "agency", "overtime", "service_change", "correction", "cancelled", "time_change", "role_change"];
const ACTIONS: Record<string, string> = { validate: "validated", approve: "approved", apply: "applied", reject: "rejected", cancel: "cancelled" };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.roster_id || !TYPES.includes(b.amendment_type)) return badRequest("roster_id and valid amendment_type required");
  const { data: roster } = await admin.from("op_rosters").select("hospital_id").eq("id", b.roster_id).maybeSingle();
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 });
  if (!isSuper(c) && roster.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const { data, error } = await admin.from("op_roster_amendments").insert({
    hospital_id: roster.hospital_id, roster_id: b.roster_id, amendment_type: b.amendment_type, reason: b.reason || null,
    affected_unit: b.affected_unit || null, affected_shift_date: b.affected_shift_date || null,
    from_staff_name: b.from_staff_name || null, to_staff_name: b.to_staff_name || null, impact_summary: b.impact_summary || null,
    requested_by: c.userId, requested_by_name: me?.full_name ?? null, approval_status: "requested", emergency: !!b.emergency,
    retrospective_review_required: !!b.emergency,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_roster_amendment", entity_type: "op_roster_amendment", entity_id: data.id, hospital_id: roster.hospital_id, new_value: { amendment_type: b.amendment_type } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const status = ACTIONS[b.action];
  if (!status) return badRequest("valid action required");
  const { data: row } = await admin.from("op_roster_amendments").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const patch: any = { approval_status: status };
  if (["approved", "applied"].includes(status)) { patch.approved_by = c.userId; patch.approved_by_name = me?.full_name ?? null; patch.approved_at = new Date().toISOString(); }
  const { data, error } = await admin.from("op_roster_amendments").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_roster_amendment", entity_type: "op_roster_amendment", entity_id: id, hospital_id: row.hospital_id, new_value: { action: b.action } });
  return NextResponse.json(data);
}
