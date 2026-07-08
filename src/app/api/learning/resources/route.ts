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

  const { title, resource_type, url, description, competency_ids } = await req.json();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const { data: resource, error } = await auth.admin.from("learning_resources").insert({
    title, resource_type: resource_type ?? "course", url: url ?? null, description: description ?? null,
    hospital_id: auth.profile?.hospital_id ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(competency_ids) && competency_ids.length) {
    await auth.admin.from("resource_competencies").insert(
      competency_ids.map((cid: string) => ({ resource_id: resource.id, competency_id: cid }))
    );
  }
  return NextResponse.json(resource, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, action, competency_id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (action === "link") {
    if (!competency_id) return NextResponse.json({ error: "competency_id required" }, { status: 400 });
    await auth.admin.from("resource_competencies").upsert({ resource_id: id, competency_id }, { onConflict: "resource_id,competency_id" });
    return NextResponse.json({ ok: true });
  }
  if (action === "unlink") {
    await auth.admin.from("resource_competencies").delete().eq("resource_id", id).eq("competency_id", competency_id);
    return NextResponse.json({ ok: true });
  }

  const allowed = ["title", "resource_type", "url", "description", "is_active"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (Object.keys(update).length) await auth.admin.from("learning_resources").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("learning_resources").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
