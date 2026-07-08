import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, description, framework_id } = await req.json();
  if (!name || !framework_id) return NextResponse.json({ error: "name and framework_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: last } = await admin.from("framework_domains").select("sort_order").eq("framework_id", framework_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await admin.from("framework_domains").insert({ name, framework_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

async function authAdmin(req: Request) {
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await (await import("@/lib/supabase/server")).createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return null;
  return (await import("@/lib/supabase/server")).createAdminClient();
}

export async function PATCH(req: Request) {
  const admin = await authAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const { data, error } = await admin.from("framework_domains").update({ name }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const admin = await authAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await admin.from("framework_domains").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
