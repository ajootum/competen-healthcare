import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertCompetencyScope, assertFrameworkScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { method, competency_id, framework_id, is_required, min_assessors, weight } = await req.json();
  if (!method || (!competency_id && !framework_id)) return NextResponse.json({ error: "method and competency_id or framework_id required" }, { status: 400 });

  // The target competency/framework must be writable by the caller.
  if (competency_id) {
    const scopeErr = await assertCompetencyScope(c, competency_id, { write: true });
    if (scopeErr) return scopeErr;
  }
  if (framework_id) {
    const scopeErr = await assertFrameworkScope(c, framework_id, { write: true });
    if (scopeErr) return scopeErr;
  }

  const admin = c.admin;
  const { data, error } = await admin.from("assessment_method_configs").insert({
    method,
    competency_id: competency_id ?? null,
    framework_id: framework_id ?? null,
    is_required: Boolean(is_required),
    min_assessors: parseInt(min_assessors ?? 1),
    weight: parseFloat(weight ?? 1),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
