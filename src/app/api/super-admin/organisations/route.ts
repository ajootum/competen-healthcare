import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function authCheck() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return null;
  return user;
}

export async function POST(request: Request) {
  if (!await authCheck()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { name, group_name, type, country, hq_country, region, description, website, email, phone } = body;
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data, error } = await createAdminClient().from("organisations").insert({
    name, group_name, type, hq_country: hq_country ?? country, region, description, website, email, phone,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, org: data });
}

export async function PATCH(request: Request) {
  if (!await authCheck()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, ...fields } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await createAdminClient().from("organisations").update(fields).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!await authCheck()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await createAdminClient().from("organisations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
