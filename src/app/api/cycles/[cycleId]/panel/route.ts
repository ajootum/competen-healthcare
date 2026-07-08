import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("cycle_assessors")
    .select("id, assessor_id, assigned_at, profiles!assessor_id(full_name, email)")
    .eq("cycle_id", cycleId);

  return NextResponse.json(data ?? []);
}

export async function POST(req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!["hospital_admin", "super_admin", "educator"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { assessor_id } = await req.json();
  if (!assessor_id) return NextResponse.json({ error: "assessor_id required" }, { status: 400 });

  const { data, error } = await admin.from("cycle_assessors").insert({
    cycle_id: cycleId,
    assessor_id,
    assigned_by: user.id,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!["hospital_admin", "super_admin"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { assessor_id } = await req.json();
  await admin.from("cycle_assessors").delete()
    .eq("cycle_id", cycleId)
    .eq("assessor_id", assessor_id);

  return NextResponse.json({ ok: true });
}
