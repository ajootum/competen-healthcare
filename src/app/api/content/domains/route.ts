import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isEducator, assertFrameworkScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { name, framework_id } = await req.json();
  if (!name || !framework_id) return NextResponse.json({ error: "name and framework_id required" }, { status: 400 });

  // The target framework must be writable by the caller.
  const scopeErr = await assertFrameworkScope(c, framework_id, { write: true });
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: last } = await admin.from("framework_domains").select("sort_order").eq("framework_id", framework_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await admin.from("framework_domains").insert({ name, framework_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// Resolve the framework that owns a domain and assert the caller may write it.
async function assertDomainWritable(c: Awaited<ReturnType<typeof getCaller>>, id: string) {
  if (isResponse(c)) return c;
  const { data: dom } = await c.admin.from("framework_domains").select("framework_id").eq("id", id).maybeSingle();
  if (!dom?.framework_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return assertFrameworkScope(c, dom.framework_id as string, { write: true });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertDomainWritable(c, id);
  if (scopeErr) return scopeErr;
  const body = await req.json();
  // Partial update — supports renaming and reordering.
  const allowed = ["name", "sort_order"];
  const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  const { data, error } = await c.admin.from("framework_domains").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertDomainWritable(c, id);
  if (scopeErr) return scopeErr;
  const { error } = await c.admin.from("framework_domains").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
