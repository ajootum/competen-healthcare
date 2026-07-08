import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await createAdminClient()
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // Try selecting sub_role — ignore error if column doesn't exist yet
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, email, role, roles, hospital_id, specialization, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch sub_role separately to be safe
  const { data: subRoles } = await admin
    .from("profiles")
    .select("id, sub_role");

  const subRoleMap = Object.fromEntries((subRoles ?? []).map(r => [r.id, r.sub_role]));

  const merged = (profiles ?? []).map(p => ({
    ...p,
    sub_role: subRoleMap[p.id] ?? null,
  }));

  return NextResponse.json({ profiles: merged });
}
