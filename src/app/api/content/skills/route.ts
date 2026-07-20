import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isEducator, assertCompetencyScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { name, description, competency_id } = await req.json();
  if (!name || !competency_id) return NextResponse.json({ error: "name and competency_id required" }, { status: 400 });

  // The parent competency (via its framework) must be writable by the caller.
  const scopeErr = await assertCompetencyScope(c, competency_id, { write: true });
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: last } = await admin.from("competency_skills").select("sort_order").eq("competency_id", competency_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await admin.from("competency_skills").insert({ name, description, competency_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// Resolve the competency that owns a skill and assert the caller may write it.
async function assertSkillWritable(c: Awaited<ReturnType<typeof getCaller>>, id: string) {
  if (isResponse(c)) return c;
  const { data: skill } = await c.admin.from("competency_skills").select("competency_id").eq("id", id).maybeSingle();
  if (!skill?.competency_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return assertCompetencyScope(c, skill.competency_id as string, { write: true });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertSkillWritable(c, id);
  if (scopeErr) return scopeErr;
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const { data, error } = await c.admin.from("competency_skills").update({ name }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertSkillWritable(c, id);
  if (scopeErr) return scopeErr;
  const { error } = await c.admin.from("competency_skills").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
