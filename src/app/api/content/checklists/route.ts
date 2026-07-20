import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertCompetencyScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { name, description, skill_id } = await req.json();
  if (!name || !skill_id) return NextResponse.json({ error: "name and skill_id required" }, { status: 400 });

  const admin = c.admin;
  // Resolve skill → competency → framework and assert write scope.
  const { data: skill } = await admin.from("competency_skills").select("competency_id").eq("id", skill_id).maybeSingle();
  if (!skill?.competency_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const scopeErr = await assertCompetencyScope(c, skill.competency_id as string, { write: true });
  if (scopeErr) return scopeErr;

  const { data, error } = await admin.from("skill_checklists").insert({ name, description, skill_id }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
