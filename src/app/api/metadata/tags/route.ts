import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { admin };
}

// GET ?object_type=&object_id= — tags on an object
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const objectType = searchParams.get("object_type");
  const objectId = searchParams.get("object_id");
  if (!objectType || !objectId) return NextResponse.json({ error: "object_type and object_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("object_tags")
    .select("id, tag_id, tags(id, name, category)")
    .eq("object_type", objectType).eq("object_id", objectId);
  return NextResponse.json(data ?? []);
}

// POST — assign a tag to an object
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { tag_id, object_type, object_id } = await req.json();
  if (!tag_id || !object_type || !object_id) return NextResponse.json({ error: "tag_id, object_type, object_id required" }, { status: 400 });
  await auth.admin.from("object_tags").upsert({ tag_id, object_type, object_id }, { onConflict: "tag_id,object_type,object_id" });
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE ?id= — remove a tag assignment
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("object_tags").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
