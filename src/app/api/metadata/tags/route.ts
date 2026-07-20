import { NextResponse } from "next/server";
import {
  getCaller, isResponse, forbidden, isStaff, isEducator,
  assertFrameworkScope, assertCompetencyScope, assertCycleScope,
  type Caller,
} from "@/lib/api-auth";

// Verify the caller may act on the tagged object when its hospital is resolvable.
// Unknown object types fall through (role gate is the only guard).
async function scopeObject(c: Caller, objectType: string, objectId: string): Promise<NextResponse | null> {
  if (objectType === "framework") return assertFrameworkScope(c, objectId, { write: true });
  if (objectType === "competency") return assertCompetencyScope(c, objectId, { write: true });
  if (objectType === "cycle") return assertCycleScope(c, objectId);
  return null;
}

// GET ?object_type=&object_id= — tags on an object
export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const { searchParams } = new URL(req.url);
  const objectType = searchParams.get("object_type");
  const objectId = searchParams.get("object_id");
  if (!objectType || !objectId) return NextResponse.json({ error: "object_type and object_id required" }, { status: 400 });

  const { data } = await c.admin
    .from("object_tags")
    .select("id, tag_id, tags(id, name, category)")
    .eq("object_type", objectType).eq("object_id", objectId);
  return NextResponse.json(data ?? []);
}

// POST — assign a tag to an object
export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { tag_id, object_type, object_id } = await req.json();
  if (!tag_id || !object_type || !object_id) return NextResponse.json({ error: "tag_id, object_type, object_id required" }, { status: 400 });

  const scopeErr = await scopeObject(c, object_type, object_id);
  if (scopeErr) return scopeErr;

  await c.admin.from("object_tags").upsert({ tag_id, object_type, object_id }, { onConflict: "tag_id,object_type,object_id" });
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE ?id= — remove a tag assignment
export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Resolve the target object and verify tenant scope before removing the tag.
  const { data: row } = await c.admin.from("object_tags").select("object_type, object_id").eq("id", id).maybeSingle();
  if (row) {
    const scopeErr = await scopeObject(c, row.object_type as string, row.object_id as string);
    if (scopeErr) return scopeErr;
  }

  await c.admin.from("object_tags").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
