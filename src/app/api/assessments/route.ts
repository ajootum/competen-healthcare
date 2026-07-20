import { NextResponse } from "next/server";
import { recomputeAll } from "@/lib/engines/scoring";
import { getCaller, isResponse, forbidden, isStaff, isSuper, assertCycleScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const { cycle_id, competency_id, method, score, notes } = await req.json();
  if (!cycle_id || !competency_id || !method) {
    return NextResponse.json({ error: "cycle_id, competency_id, and method required" }, { status: 400 });
  }
  // The cycle (and thus the learner) must be in the caller's hospital.
  const scopeErr = await assertCycleScope(c, cycle_id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data, error } = await admin.from("assessments").insert({
    cycle_id,
    competency_id,
    assessor_id: c.userId,
    method,
    score: score ?? null,
    notes: notes ?? null,
    status: score != null ? "complete" : "in_progress",
    assessed_at: score != null ? new Date().toISOString() : null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (score != null) {
    await recomputeAll(admin, cycle_id, competency_id);
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden(); // assessment scores/notes are staff-only

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");
  const assessorId = searchParams.get("assessor_id");

  const admin = c.admin;
  let q = admin.from("assessments").select(`
    id, cycle_id, competency_id, method, status, score, notes, assessed_at,
    profiles!assessor_id(id, full_name),
    framework_competencies!competency_id(id, name,
      framework_domains!domain_id(id, name, frameworks!framework_id(id, name))
    )
  `).order("created_at", { ascending: false });

  if (cycleId) q = q.eq("cycle_id", cycleId);
  if (assessorId) q = q.eq("assessor_id", assessorId);

  // Tenant scope: restrict to cycles in the caller's hospital (super = all).
  if (!isSuper(c)) {
    const { data: cyc } = await admin.from("competency_cycles").select("id").eq("hospital_id", c.hospitalId ?? "__none__");
    const ids = (cyc ?? []).map(x => x.id as string);
    q = q.in("cycle_id", ids.length ? ids : ["__none__"]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
