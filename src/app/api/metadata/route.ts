import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { admin };
}

// GET — full metadata: taxonomies + terms + tags
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const [{ data: taxonomies }, { data: terms }, { data: tags }] = await Promise.all([
    admin.from("taxonomies").select("id, kind, label").order("label"),
    admin.from("taxonomy_terms").select("id, taxonomy_id, value, code, sort_order").order("sort_order"),
    admin.from("tags").select("id, name, category").order("category").order("name"),
  ]);
  return NextResponse.json({ taxonomies: taxonomies ?? [], terms: terms ?? [], tags: tags ?? [] });
}

// POST — add a taxonomy term or a tag
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  if (body.type === "term") {
    const { taxonomy_id, value, code } = body;
    if (!taxonomy_id || !value) return NextResponse.json({ error: "taxonomy_id and value required" }, { status: 400 });
    const { error } = await auth.admin.from("taxonomy_terms").insert({ taxonomy_id, value, code: code ?? null });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (body.type === "tag") {
    const { name, category } = body;
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const { error } = await auth.admin.from("tags").insert({ name, category: category ?? "general" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

// DELETE — remove a term (?kind=term) or tag (?kind=tag)
export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (kind === "term") await auth.admin.from("taxonomy_terms").delete().eq("id", id);
  else if (kind === "tag") await auth.admin.from("tags").delete().eq("id", id);
  else return NextResponse.json({ error: "kind required" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
