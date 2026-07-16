import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Assessor scope matrix (User Account Architecture §17) — grants and revokes
// who may assess which CPU, at which independence level, until when.

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name, hospital_id").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { user_id, cpu_id, independence, valid_until, restrictions } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const { data, error } = await auth.admin.from("assessor_authorizations").insert({
    user_id,
    hospital_id: auth.profile?.hospital_id ?? null,
    cpu_id: cpu_id || null,
    independence: independence ?? "independent",
    valid_until: valid_until || null,
    restrictions: restrictions?.trim() || null,
    authorized_by: auth.user.id,
    authorized_by_name: auth.profile?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "grant_assessor_authorization", entity_type: "assessor_authorization", entity_id: data.id,
    new_value: { user_id, cpu_id: cpu_id ?? "all", independence },
  });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await auth.admin.from("assessor_authorizations").update({ status: "revoked" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await auth.admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "revoke_assessor_authorization", entity_type: "assessor_authorization", entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
