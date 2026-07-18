import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Senior-assessor assignment (Evidence Validation Centre escalation model).
// Educators and admins grant/revoke the flag; every change is audit-logged
// and the assessor is notified. Escalated evidence can only be decided by
// seniors (enforced in /api/logbook).

const MANAGER_ROLES = ["educator", "hospital_admin", "super_admin"];

async function requireManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user.id).single();
  if (!me) return null;
  const roles: string[] = me.roles?.length ? me.roles : [me.role].filter(Boolean);
  return { admin, me, allowed: roles.some(r => MANAGER_ROLES.includes(r)), isSuper: roles.includes("super_admin") };
}

export async function GET() {
  const auth = await requireManager();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.allowed) return NextResponse.json({ error: "Only educators or admins can manage senior assessors" }, { status: 403 });

  const { data } = await auth.admin.from("profiles")
    .select("id, full_name, role, roles, is_senior_assessor, avatar_url")
    .eq("hospital_id", auth.me.hospital_id ?? "")
    .limit(200);
  const assessors = (data ?? []).filter(p => {
    const roles: string[] = p.roles?.length ? p.roles : [p.role].filter(Boolean);
    return roles.some(r => ["assessor", "educator"].includes(r));
  }).map(p => ({
    id: p.id, full_name: p.full_name, avatar_url: p.avatar_url,
    is_senior_assessor: !!p.is_senior_assessor,
  }));
  return NextResponse.json({ assessors });
}

export async function PATCH(req: Request) {
  const auth = await requireManager();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.allowed) return NextResponse.json({ error: "Only educators or admins can manage senior assessors" }, { status: 403 });
  const { admin, me, isSuper } = auth;

  const { user_id, senior } = await req.json().catch(() => ({}));
  if (!user_id || typeof senior !== "boolean") {
    return NextResponse.json({ error: "user_id and senior (boolean) are required" }, { status: 400 });
  }
  const { data: target } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user_id).single();
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!isSuper && target.hospital_id !== me.hospital_id) {
    return NextResponse.json({ error: "You can only manage assessors in your hospital" }, { status: 403 });
  }
  const targetRoles: string[] = target.roles?.length ? target.roles : [target.role].filter(Boolean);
  if (!targetRoles.some(r => ["assessor", "educator"].includes(r))) {
    return NextResponse.json({ error: "Only assessors can be made senior assessors" }, { status: 400 });
  }

  const { error } = await admin.from("profiles").update({ is_senior_assessor: senior }).eq("id", user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: senior ? "grant_senior_assessor" : "revoke_senior_assessor",
    entity_type: "profile", entity_id: user_id, entity_name: target.full_name,
  });
  await notify([user_id], {
    type: senior ? "senior_assessor_granted" : "senior_assessor_revoked",
    title: senior ? "You are now a Senior Assessor" : "Senior Assessor role removed",
    body: `${me.full_name ?? "An educator"} ${senior ? "granted you" : "removed"} senior assessor status${senior ? " — escalated evidence now routes to you" : ""}`,
    href: "/assessor/logbook",
  });
  return NextResponse.json({ ok: true });
}
