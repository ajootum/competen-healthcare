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

  // `profiles` has no sub_role column on this schema. The second query fetched it "separately to be safe",
  // errored, and the resulting map was always empty — so every sub_role was null anyway, at the cost of a
  // full extra scan of profiles on every request. The field is kept in the response so consumers' shape is
  // unchanged, but it is now honestly and cheaply null. Found by scripts/schema-drift-audit.ts.
  const merged = (profiles ?? []).map(p => ({ ...p, sub_role: null as string | null }));

  return NextResponse.json({ profiles: merged });
}
