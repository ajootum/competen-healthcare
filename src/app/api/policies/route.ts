import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { title, policy_type, version, content, effective_date, review_date, framework_id, hospital_id, department_id } = body;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("policies").insert({
    title, policy_type: policy_type ?? "clinical", version: version ?? "1.0",
    content, created_by: user.id,
    effective_date: effective_date || null,
    review_date: review_date || null,
    framework_id: framework_id ?? null,
    hospital_id: hospital_id ?? (profile?.role === "hospital_admin" ? profile.hospital_id : null),
    department_id: department_id ?? null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const hospitalId = searchParams.get("hospital_id");

  const admin = createAdminClient();
  let q = admin.from("policies").select("id, title, policy_type, version, effective_date, review_date, is_active, created_at");
  if (hospitalId) q = q.eq("hospital_id", hospitalId);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
