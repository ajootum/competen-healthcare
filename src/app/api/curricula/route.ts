import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { admin, profile };
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json();

  if (body.type === "curriculum") {
    const { title, programme_type, target_role, duration_weeks, description } = body;
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const { data, error } = await auth.admin.from("curricula").insert({
      title, programme_type: programme_type ?? "orientation", target_role: target_role ?? null,
      duration_weeks: duration_weeks ?? null, description: description ?? null,
      hospital_id: auth.profile?.hospital_id ?? null,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }
  if (body.type === "module") {
    const { curriculum_id, title } = body;
    if (!curriculum_id || !title) return NextResponse.json({ error: "curriculum_id and title required" }, { status: 400 });
    const { data: last } = await auth.admin.from("curriculum_modules").select("sort_order").eq("curriculum_id", curriculum_id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    await auth.admin.from("curriculum_modules").insert({ curriculum_id, title, sort_order: (last?.sort_order ?? 0) + 1 });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (body.type === "competency") {
    const { curriculum_id, competency_id, relation } = body;
    if (!curriculum_id || !competency_id) return NextResponse.json({ error: "curriculum_id and competency_id required" }, { status: 400 });
    await auth.admin.from("curriculum_competencies").upsert(
      { curriculum_id, competency_id, relation: relation ?? "outcome" },
      { onConflict: "curriculum_id,competency_id,relation" }
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (kind === "curriculum") await auth.admin.from("curricula").delete().eq("id", id);
  else if (kind === "module") await auth.admin.from("curriculum_modules").delete().eq("id", id);
  else if (kind === "competency") await auth.admin.from("curriculum_competencies").delete().eq("id", id);
  else return NextResponse.json({ error: "kind required" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
