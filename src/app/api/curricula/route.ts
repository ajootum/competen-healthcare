import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertRowScope } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const body = await req.json();

  if (body.type === "curriculum") {
    const { title, programme_type, target_role, duration_weeks, description } = body;
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const { data, error } = await c.admin.from("curricula").insert({
      title, programme_type: programme_type ?? "orientation", target_role: target_role ?? null,
      duration_weeks: duration_weeks ?? null, description: description ?? null,
      hospital_id: c.hospitalId,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }
  if (body.type === "module") {
    const { curriculum_id, title } = body;
    if (!curriculum_id || !title) return NextResponse.json({ error: "curriculum_id and title required" }, { status: 400 });
    // The parent curriculum must belong to the caller's hospital.
    const scopeErr = await assertRowScope(c, "curricula", curriculum_id);
    if (scopeErr) return scopeErr;
    const { data: last } = await c.admin.from("curriculum_modules").select("sort_order").eq("curriculum_id", curriculum_id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    await c.admin.from("curriculum_modules").insert({ curriculum_id, title, sort_order: (last?.sort_order ?? 0) + 1 });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (body.type === "competency") {
    const { curriculum_id, competency_id, relation } = body;
    if (!curriculum_id || !competency_id) return NextResponse.json({ error: "curriculum_id and competency_id required" }, { status: 400 });
    // The parent curriculum must belong to the caller's hospital.
    const scopeErr = await assertRowScope(c, "curricula", curriculum_id);
    if (scopeErr) return scopeErr;
    await c.admin.from("curriculum_competencies").upsert(
      { curriculum_id, competency_id, relation: relation ?? "outcome" },
      { onConflict: "curriculum_id,competency_id,relation" }
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (kind === "curriculum") {
    const scopeErr = await assertRowScope(c, "curricula", id);
    if (scopeErr) return scopeErr;
    await c.admin.from("curricula").delete().eq("id", id);
  } else if (kind === "module") {
    // Resolve the module's parent curriculum, then scope-check it.
    const { data: mod } = await c.admin.from("curriculum_modules").select("curriculum_id").eq("id", id).maybeSingle();
    if (!mod) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const scopeErr = await assertRowScope(c, "curricula", mod.curriculum_id as string);
    if (scopeErr) return scopeErr;
    await c.admin.from("curriculum_modules").delete().eq("id", id);
  } else if (kind === "competency") {
    // Resolve the link's parent curriculum, then scope-check it.
    const { data: link } = await c.admin.from("curriculum_competencies").select("curriculum_id").eq("id", id).maybeSingle();
    if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const scopeErr = await assertRowScope(c, "curricula", link.curriculum_id as string);
    if (scopeErr) return scopeErr;
    await c.admin.from("curriculum_competencies").delete().eq("id", id);
  } else return NextResponse.json({ error: "kind required" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
