import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, description, trigger_type, steps, hospital_id } = await req.json();
  if (!name || !trigger_type) return NextResponse.json({ error: "name and trigger_type required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("workflow_templates").insert({
    name, description, trigger_type,
    steps: steps ?? [],
    hospital_id: hospital_id ?? (profile?.role === "hospital_admin" ? profile.hospital_id : null),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("workflow_templates").select("id, name, trigger_type, steps, is_active").order("trigger_type");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
