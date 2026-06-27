import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, description, min_score, max_score } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("scoring_scales").insert({ name, description, min_score: min_score ?? 0, max_score: max_score ?? 6 }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
