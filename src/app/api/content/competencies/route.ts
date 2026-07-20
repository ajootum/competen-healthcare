import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isEducator, assertFrameworkScope, assertCompetencyScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { name, description, domain_id } = await req.json();
  if (!name || !domain_id) return NextResponse.json({ error: "name and domain_id required" }, { status: 400 });

  const admin = c.admin;
  // Resolve the domain's framework and verify it is writable by the caller.
  const { data: dom } = await admin.from("framework_domains").select("framework_id").eq("id", domain_id).maybeSingle();
  if (!dom?.framework_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const scopeErr = await assertFrameworkScope(c, dom.framework_id as string, { write: true });
  if (scopeErr) return scopeErr;

  const { data: last } = await admin.from("framework_competencies").select("sort_order").eq("domain_id", domain_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await admin.from("framework_competencies").insert({ name, description, domain_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  // The competency (via its framework) must be writable by the caller.
  const scopeErr = await assertCompetencyScope(c, id, { write: true });
  if (scopeErr) return scopeErr;

  const body = await req.json();
  // Partial update — supports renaming (name/description) and CKCM structural
  // assignment (practice_id / cpu_id / code / risk_category).
  const allowed = ["name", "description", "practice_id", "cpu_id", "code", "risk_category", "sort_order"];
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "no valid fields" }, { status: 400 });

  const { data, error } = await c.admin.from("framework_competencies").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertCompetencyScope(c, id, { write: true });
  if (scopeErr) return scopeErr;
  const { error } = await c.admin.from("framework_competencies").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
