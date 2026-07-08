import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { user };
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { domain_id, name, description, code, sort_order } = await req.json();
  if (!domain_id || !name) return NextResponse.json({ error: "domain_id and name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("practices")
    .insert({ domain_id, name, description: description ?? null, code: code ?? null, sort_order: sort_order ?? 0 })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const allowed = ["name", "description", "code", "sort_order"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));

  const admin = createAdminClient();
  const { error } = await admin.from("practices").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from("practices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
