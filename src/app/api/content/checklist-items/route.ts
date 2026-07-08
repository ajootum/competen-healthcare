import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { item, description, is_critical, checklist_id } = await req.json();
  if (!item || !checklist_id) return NextResponse.json({ error: "item and checklist_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: last } = await admin.from("checklist_items").select("sort_order").eq("checklist_id", checklist_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await admin.from("checklist_items").insert({ item, description, is_critical: Boolean(is_critical), checklist_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
