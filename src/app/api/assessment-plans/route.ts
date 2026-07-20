import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, assertProfileScope, assertRowScope } from "@/lib/api-auth";

// POST — create an assessment plan (+ optional items/assessors)
export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const { name, programme_type, scheduling_rule, nurse_id, is_template, due_date, cpu_ids, assessor_ids } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  // A named learner must be in the caller's hospital.
  if (nurse_id) {
    const scopeErr = await assertProfileScope(c, nurse_id);
    if (scopeErr) return scopeErr;
  }

  const { data: plan, error } = await c.admin.from("assessment_plans").insert({
    name,
    hospital_id: c.hospitalId ?? null, // tenant is the caller's, never client-supplied
    programme_type: programme_type ?? "annual",
    scheduling_rule: scheduling_rule ?? "fixed",
    nurse_id: nurse_id ?? null,
    is_template: !!is_template,
    due_date: due_date ?? null,
    status: "draft",
    created_by: c.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(cpu_ids) && cpu_ids.length) {
    await c.admin.from("plan_items").insert(cpu_ids.map((cid: string) => ({ plan_id: plan.id, cpu_id: cid })));
  }
  if (Array.isArray(assessor_ids) && assessor_ids.length) {
    await c.admin.from("plan_assessors").insert(
      assessor_ids.map((aid: string, i: number) => ({ plan_id: plan.id, assessor_id: aid, role: i === 0 ? "primary" : "secondary" }))
    );
  }
  return NextResponse.json(plan, { status: 201 });
}

// PATCH — update status/fields
export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target plan must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "assessment_plans", id);
  if (scopeErr) return scopeErr;

  const allowed = ["name", "programme_type", "scheduling_rule", "status", "due_date", "nurse_id"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  // A reassigned learner must also be in the caller's hospital.
  if (typeof update.nurse_id === "string") {
    const nurseErr = await assertProfileScope(c, update.nurse_id);
    if (nurseErr) return nurseErr;
  }
  if (Object.keys(update).length) await c.admin.from("assessment_plans").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target plan must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "assessment_plans", id);
  if (scopeErr) return scopeErr;

  await c.admin.from("assessment_plans").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
