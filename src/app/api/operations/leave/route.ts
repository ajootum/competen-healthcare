import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";

// Leave / absence classification (UMW-WFM-005 §15) — records the OPERATIONAL classification of
// an absence into op_leave_records (migration 083). Operational fields only — no free-text
// medical detail (§15.4). HR leave administration remains in HR. Approved leave overrides a
// roster expectation (BR-ATT-002). isSupervisor gate; audited (record_leave).
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["sick", "annual", "maternity_parental", "compassionate", "study", "official_duty", "training", "emergency", "unpaid", "suspension", "occupational_restriction", "administrative", "unauthorised", "no_show", "unknown"];
const todayStr = () => new Date().toISOString().slice(0, 10);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!b.staff_id || !TYPES.includes(b.absence_type)) return badRequest("staff_id and valid absence_type required");
  const staffScope = await assertProfileScope(c, b.staff_id);
  if (staffScope) return staffScope;

  const { data: staff } = await admin.from("profiles").select("hospital_id, full_name").eq("id", b.staff_id).maybeSingle();
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  const hospitalId = staff.hospital_id ?? c.hospitalId;
  if (!isSuper(c) && hospitalId !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const row = {
    hospital_id: hospitalId, staff_id: b.staff_id, staff_name: staff.full_name ?? null, shift_id: b.shift_id ?? null,
    absence_date: b.absence_date || todayStr(), absence_type: b.absence_type,
    notification_at: new Date().toISOString(), notified_by: me?.full_name ?? null, notification_channel: b.channel || "manager_entry",
    expected_return: b.expected_return || null, leave_approval_status: ["annual", "maternity_parental", "study", "official_duty", "training"].includes(b.absence_type) ? "approved" : "pending",
    replacement_required: !!b.replacement_required, operational_impact: b.operational_impact || null, notes: b.notes || null, created_by: c.userId,
  };
  const { data, error } = await admin.from("op_leave_records").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_leave", entity_type: "op_leave_record", entity_id: data.id, hospital_id: hospitalId, new_value: { staff_id: b.staff_id, absence_type: b.absence_type } });
  return NextResponse.json(data, { status: 201 });
}
