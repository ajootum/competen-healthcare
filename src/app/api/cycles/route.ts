import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, isEducator, isSuper, assertProfileScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { nurse_id, cycle_type, start_date, end_date, notes, framework_ids, min_assessors, consensus_rule } = await req.json();
  if (!nurse_id || !cycle_type) return NextResponse.json({ error: "nurse_id and cycle_type required" }, { status: 400 });

  const admin = c.admin;
  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();
  if (!nurse?.hospital_id) return NextResponse.json({ error: "Nurse has no hospital assigned" }, { status: 400 });
  // The learner must be in the caller's hospital.
  const scopeErr = await assertProfileScope(c, nurse_id);
  if (scopeErr) return scopeErr;

  const { data: cycle, error } = await admin.from("competency_cycles").insert({
    nurse_id,
    hospital_id: nurse.hospital_id,
    cycle_type,
    start_date: start_date ?? new Date().toISOString().split("T")[0],
    end_date: end_date ?? null,
    notes: notes ?? null,
    created_by: c.userId,
    min_assessors: min_assessors ?? 1,
    consensus_rule: consensus_rule ?? "any",
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(framework_ids) && framework_ids.length > 0) {
    await admin.from("cycle_frameworks").insert(
      framework_ids.map((fid: string) => ({ cycle_id: cycle.id, framework_id: fid }))
    );
  }

  return NextResponse.json(cycle, { status: 201 });
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden(); // competency cycles are staff-only

  const { searchParams } = new URL(req.url);
  const nurseId = searchParams.get("nurse_id");
  const status = searchParams.get("status");

  const admin = c.admin;
  let q = admin.from("competency_cycles").select(`
    id, cycle_type, status, start_date, end_date, created_at, notes,
    profiles!nurse_id(id, full_name, role),
    cycle_frameworks(id, framework_id, status, framework_score, frameworks(id, name, library))
  `).order("created_at", { ascending: false });

  if (nurseId) q = q.eq("nurse_id", nurseId);
  if (status) q = q.eq("status", status);
  // Tenant scope: the caller's hospital only (super = all). Any client-supplied
  // hospital_id is ignored in favour of the caller's own scope.
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "__none__");

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
