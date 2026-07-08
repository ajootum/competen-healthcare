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

// POST — grant a clinical authorization to a nurse
export async function POST(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { nurse_id, authorization_type, authorization_level, scope, conditions, expiry_date, based_on_decision, activities } = await req.json();
  if (!nurse_id) return NextResponse.json({ error: "nurse_id required" }, { status: 400 });

  const { data: nurse } = await auth.admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();

  const { data: cao, error } = await auth.admin.from("clinical_authorizations").insert({
    nurse_id,
    hospital_id: nurse?.hospital_id ?? auth.profile?.hospital_id ?? null,
    authorization_type: authorization_type ?? "clinical_privilege",
    authorization_level: authorization_level ?? "independent",
    status: "active",
    scope: scope ?? null,
    conditions: conditions ?? null,
    expiry_date: expiry_date ?? null,
    based_on_decision: based_on_decision ?? null,
    granted_by: auth.user.id,
    granted_by_name: auth.profile?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(activities) && activities.length) {
    await auth.admin.from("authorization_activities").insert(
      activities.map((a: { cpu_id?: string; competency_id?: string; label: string }) => ({
        authorization_id: cao.id, cpu_id: a.cpu_id ?? null, competency_id: a.competency_id ?? null, label: a.label,
      }))
    );
  }

  await auth.admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "grant_authorization", entity_type: "authorization", entity_id: cao.id,
    new_value: { nurse_id, authorization_type, authorization_level },
  });

  return NextResponse.json(cao, { status: 201 });
}

// PATCH — change status (suspend / revoke / reactivate)
export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, status } = await req.json();
  if (!id || !["pending", "active", "suspended", "revoked", "expired"].includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }
  await auth.admin.from("clinical_authorizations").update({ status }).eq("id", id);
  await auth.admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "update_authorization", entity_type: "authorization", entity_id: id,
    new_value: { status },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await auth.admin.from("clinical_authorizations").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
