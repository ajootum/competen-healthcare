import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

// POST — award a recognition
export async function POST(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { nurse_id, recognition_type, title, description, awarded_at } = await req.json();
  if (!nurse_id || !title) return NextResponse.json({ error: "nurse_id and title required" }, { status: 400 });

  const { data: nurse } = await auth.admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();
  const { data, error } = await auth.admin.from("professional_recognitions").insert({
    nurse_id,
    hospital_id: nurse?.hospital_id ?? auth.profile?.hospital_id ?? null,
    recognition_type: recognition_type ?? "excellence_award",
    title,
    description: description ?? null,
    awarded_at: awarded_at ?? undefined,
    awarded_by: auth.user.id,
    awarded_by_name: auth.profile?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "award_recognition", entity_type: "recognition", entity_id: data.id,
    new_value: { nurse_id, recognition_type, title },
  });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("professional_recognitions").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
