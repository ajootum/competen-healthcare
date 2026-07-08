import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const hospitalId = searchParams.get("hospital_id");

  const admin = createAdminClient();
  const { data } = await admin.from("departments").select("id, name").eq("hospital_id", hospitalId ?? "").order("name");
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin","super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, specialty, hospital_id } = await request.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("departments").insert({ name, specialty, hospital_id }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, department: data });
}
