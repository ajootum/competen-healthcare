import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { method, competency_id, framework_id, is_required, min_assessors, weight } = await req.json();
  if (!method || (!competency_id && !framework_id)) return NextResponse.json({ error: "method and competency_id or framework_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("assessment_method_configs").insert({
    method,
    competency_id: competency_id ?? null,
    framework_id: framework_id ?? null,
    is_required: Boolean(is_required),
    min_assessors: parseInt(min_assessors ?? 1),
    weight: parseFloat(weight ?? 1),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
