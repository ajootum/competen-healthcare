import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { scale_id, score, label, description, color, is_passing } = await req.json();
  if (!scale_id || score == null || !label) return NextResponse.json({ error: "scale_id, score, and label required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("scoring_levels").insert({ scale_id, score, label, description, color: color ?? "#6b7280", is_passing: Boolean(is_passing) }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
