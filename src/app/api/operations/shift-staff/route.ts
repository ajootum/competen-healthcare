import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { checkDeploymentReadiness } from "@/lib/operations/deployment-readiness";

// Shift Staff (COE Workforce Deployment) — deploy a worker onto a shift. COMP-027 readiness gate: an
// unresolved critical competency failure blocks deployment (governed override via `override:true`); expired
// competencies raise an advisory warning returned with the deployment.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.shift_id || !b.staff_id) return badRequest("shift_id and staff_id required");
  const admin = c.admin as any;

  const { data: shift } = await admin.from("op_shifts").select("hospital_id").eq("id", b.shift_id).maybeSingle();
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  if (!isSuper(c) && shift.hospital_id !== c.hospitalId) return forbidden("Shift out of scope");
  const staffScope = await assertProfileScope(c, b.staff_id);
  if (staffScope) return staffScope;

  // COMP-027 readiness gate — block an unresolved critical competency failure unless a governed override is given.
  const readiness = await checkDeploymentReadiness(admin, b.staff_id);
  if (readiness.blocked && !b.override) {
    return NextResponse.json({ error: readiness.reason, readiness, requiresOverride: true }, { status: 409 });
  }

  const { data, error } = await admin.from("op_shift_staff").upsert(
    { shift_id: b.shift_id, staff_id: b.staff_id, role: b.role || "nurse", status: b.status || "assigned" },
    { onConflict: "shift_id,staff_id" },
  ).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: readiness.blocked ? "deploy_staff_override" : "deploy_staff", entity_type: "op_shift", entity_id: b.shift_id, hospital_id: shift.hospital_id, new_value: { staff_id: b.staff_id, role: b.role, readiness_override: readiness.blocked || undefined, critical_failures: readiness.criticalFailures || undefined, expired: readiness.expiredCount || undefined } });
  return NextResponse.json({ ...data, readiness: (readiness.warning || readiness.blocked) ? readiness : undefined }, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!["assigned", "confirmed", "on_duty", "off_duty", "absent"].includes(b.status)) return badRequest("valid status required");
  // Scope via the parent shift.
  const { data: row } = await admin.from("op_shift_staff").select("shift_id, op_shifts!shift_id(hospital_id)").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.op_shifts?.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data, error } = await admin.from("op_shift_staff").update({ status: b.status }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_shift_staff").select("op_shifts!shift_id(hospital_id)").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.op_shifts?.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { error } = await admin.from("op_shift_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
