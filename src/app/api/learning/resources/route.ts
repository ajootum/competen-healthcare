import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertRowScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { title, resource_type, url, description, competency_ids } = await req.json();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const { data: resource, error } = await c.admin.from("learning_resources").insert({
    title, resource_type: resource_type ?? "course", url: url ?? null, description: description ?? null,
    hospital_id: c.hospitalId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(competency_ids) && competency_ids.length) {
    await c.admin.from("resource_competencies").insert(
      competency_ids.map((cid: string) => ({ resource_id: resource.id, competency_id: cid }))
    );
  }
  return NextResponse.json(resource, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { id, action, competency_id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target resource must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "learning_resources", id);
  if (scopeErr) return scopeErr;

  if (action === "link") {
    if (!competency_id) return NextResponse.json({ error: "competency_id required" }, { status: 400 });
    await c.admin.from("resource_competencies").upsert({ resource_id: id, competency_id }, { onConflict: "resource_id,competency_id" });
    return NextResponse.json({ ok: true });
  }
  if (action === "unlink") {
    await c.admin.from("resource_competencies").delete().eq("resource_id", id).eq("competency_id", competency_id);
    return NextResponse.json({ ok: true });
  }

  const allowed = ["title", "resource_type", "url", "description", "is_active"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await c.admin.from("learning_resources").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // The target resource must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "learning_resources", id);
  if (scopeErr) return scopeErr;
  await c.admin.from("learning_resources").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
