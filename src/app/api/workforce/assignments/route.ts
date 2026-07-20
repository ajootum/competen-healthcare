import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { provisionAssignment, terminateAssignment } from "@/lib/workforce/engine";

// Workforce Assignments — the assignment engine's entry point.
// POST assigns an employee to a position and runs the full provisioning pipeline.
// PATCH terminates (offboard/transfer). GET lists assignments in scope.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const admin = c.admin as any;
  const employeeId = new URL(req.url).searchParams.get("employee");
  let q = admin.from("workforce_assignments")
    .select("*, positions!position_id(title, hospital_id, department_id), profiles!employee_id(full_name)")
    .order("created_at", { ascending: false });
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Scope to the caller's hospital (via the joined position) unless super.
  const rows = (data ?? []).filter((r: any) => isSuper(c) || r.positions?.hospital_id === c.hospitalId);
  return NextResponse.json({ assignments: rows });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.employee_id || !b.position_id) return badRequest("employee_id and position_id are required");
  const admin = c.admin as any;

  // The employee must be in the caller's tenant.
  const empScope = await assertProfileScope(c, b.employee_id);
  if (empScope) return empScope;

  // The position must be in the caller's hospital.
  const { data: pos } = await admin.from("positions").select("hospital_id").eq("id", b.position_id).maybeSingle();
  if (!pos) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (!isSuper(c) && pos.hospital_id !== c.hospitalId) return forbidden("Position out of scope");

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const result = await provisionAssignment(admin, {
    employeeId: b.employee_id, positionId: b.position_id,
    assignmentType: b.assignment_type, isPrimary: b.is_primary,
    effectiveFrom: b.effective_from, effectiveTo: b.effective_to,
    actorId: c.userId, actorName: me?.full_name ?? null,
  });
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;

  const { data: a } = await admin.from("workforce_assignments").select("id, employee_id, position_id").eq("id", id).maybeSingle();
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: pos } = await admin.from("positions").select("hospital_id").eq("id", a.position_id).maybeSingle();
  if (!isSuper(c) && pos?.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const body = await req.json().catch(() => ({}));
  if (body.action !== "terminate") return badRequest("Only { action: 'terminate' } is supported");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const result = await terminateAssignment(admin, id, c.userId, me?.full_name ?? null, body.reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
