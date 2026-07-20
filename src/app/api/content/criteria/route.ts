import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertCompetencyScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { criterion, description, competency_id } = await req.json();
  if (!criterion || !competency_id) return NextResponse.json({ error: "criterion and competency_id required" }, { status: 400 });

  // The parent competency (via its framework) must be writable by the caller.
  const scopeErr = await assertCompetencyScope(c, competency_id, { write: true });
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: last } = await admin.from("performance_criteria").select("sort_order").eq("competency_id", competency_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await admin.from("performance_criteria").insert({ criterion, description, competency_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
