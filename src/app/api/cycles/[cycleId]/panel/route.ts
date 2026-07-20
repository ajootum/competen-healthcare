import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, isEducator, isAdmin, assertCycleScope } from "@/lib/api-auth";

export async function GET(_req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden(); // exposes assessor names/emails — staff-only
  // The cycle must be in the caller's hospital.
  const scopeErr = await assertCycleScope(c, cycleId);
  if (scopeErr) return scopeErr;

  const { data } = await c.admin
    .from("cycle_assessors")
    .select("id, assessor_id, assigned_at, profiles!assessor_id(full_name, email)")
    .eq("cycle_id", cycleId);

  return NextResponse.json(data ?? []);
}

export async function POST(req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  // The cycle must be in the caller's hospital.
  const scopeErr = await assertCycleScope(c, cycleId);
  if (scopeErr) return scopeErr;

  const { assessor_id } = await req.json();
  if (!assessor_id) return NextResponse.json({ error: "assessor_id required" }, { status: 400 });

  const { data, error } = await c.admin.from("cycle_assessors").insert({
    cycle_id: cycleId,
    assessor_id,
    assigned_by: c.userId,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  // The cycle must be in the caller's hospital.
  const scopeErr = await assertCycleScope(c, cycleId);
  if (scopeErr) return scopeErr;

  const { assessor_id } = await req.json();
  await c.admin.from("cycle_assessors").delete()
    .eq("cycle_id", cycleId)
    .eq("assessor_id", assessor_id);

  return NextResponse.json({ ok: true });
}
