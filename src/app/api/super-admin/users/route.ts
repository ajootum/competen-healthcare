import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { ORG_ROLE_CONFIG, type OrgRole } from "@/lib/roles";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await createAdminClient()
    .from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, isSuperAdmin, org_roles, extra_portal_roles, hospital_id, organisation_id, platform_role, department_id } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  let update: Record<string, unknown>;

  if (isSuperAdmin) {
    update = { role: "super_admin", roles: ["super_admin"], org_role: null, org_roles: [] };
    if (platform_role !== undefined) update.platform_role = platform_role || null;
  } else {
    const validRoles = (org_roles as string[] ?? []).filter(r => ORG_ROLE_CONFIG[r as OrgRole]) as OrgRole[];
    if (validRoles.length === 0) {
      return NextResponse.json({ error: "At least one org role is required" }, { status: 400 });
    }

    // Primary org_role = highest seniority (lowest tier number)
    const sorted = [...validRoles].sort((a, b) => ORG_ROLE_CONFIG[a].tier - ORG_ROLE_CONFIG[b].tier);
    const primaryOrgRole = sorted[0];
    const primaryPortalRole = ORG_ROLE_CONFIG[primaryOrgRole].portalRole;

    // All unique portal roles: from org_roles + any direct grants (e.g. assessor for any user)
    const validExtras = (extra_portal_roles as string[] ?? []).filter(r => r in { super_admin:1, hospital_admin:1, educator:1, assessor:1, nurse:1 });
    const allPortalRoles = [...new Set([...validRoles.map(r => ORG_ROLE_CONFIG[r].portalRole), ...validExtras])];

    update = {
      org_roles: validRoles,
      org_role: primaryOrgRole,           // primary for backward compat & scoping
      role: primaryPortalRole,            // active portal
      roles: allPortalRoles,              // all portals user can switch to
    };
  }

  if (hospital_id !== undefined) update.hospital_id = hospital_id ?? null;
  if (organisation_id !== undefined) update.organisation_id = organisation_id ?? null;
  if (department_id !== undefined) update.department_id = department_id ?? null;

  const { error } = await createAdminClient().from("profiles").update(update).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (me?.role !== "super_admin") return null;
  return { admin, actorId: user.id, actorName: me.full_name as string | null };
}

const PORTALS = new Set(["super_admin", "hospital_admin", "educator", "assessor", "nurse"]);

// Create a user account: either invite-by-email (user sets their own password)
// or with a server-generated temporary password returned once in the response.
export async function POST(req: Request) {
  const ctx = await requireSuperAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { admin, actorId, actorName } = ctx;

  const { email, full_name, role, mode, organisation_id, hospital_id } = await req.json();
  if (!email || !full_name || !PORTALS.has(role) || !["invite", "password"].includes(mode)) {
    return NextResponse.json({ error: "email, full_name, a valid role and mode are required" }, { status: 400 });
  }

  let userId: string;
  let tempPassword: string | null = null;

  if (mode === "invite") {
    const origin = new URL(req.url).origin;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/reset-password`,
      data: { full_name },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    userId = data.user.id;
  } else {
    tempPassword = "Temp-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const { data, error } = await admin.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true, user_metadata: { full_name },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    userId = data.user.id;
  }

  const { error: perr } = await admin.from("profiles").upsert({
    id: userId, email, full_name, role, roles: [role],
    organisation_id: organisation_id || null, hospital_id: hospital_id || null,
  });
  if (perr) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: `Profile creation failed (rolled back): ${perr.message}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: actorId, actor_name: actorName,
    action: mode === "invite" ? "invite_user" : "create_user",
    entity_type: "user", entity_id: userId, entity_name: full_name,
  });

  return NextResponse.json({ ok: true, userId, tempPassword }, { status: 201 });
}

// Permanently delete an account (auth login + profile; competency records
// cascade via their FKs). Guards: not yourself, and never the last super admin.
export async function DELETE(req: Request) {
  const ctx = await requireSuperAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { admin, actorId, actorName } = ctx;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === actorId) return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });

  const { data: target } = await admin.from("profiles").select("full_name, role").eq("id", id).single();
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (target.role === "super_admin") {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin");
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "Cannot delete the last super admin" }, { status: 400 });
  }

  const { error: perr } = await admin.from("profiles").delete().eq("id", id);
  if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
  const { error: aerr } = await admin.auth.admin.deleteUser(id);
  if (aerr) return NextResponse.json({ error: `Profile removed but auth deletion failed: ${aerr.message}` }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: actorId, actor_name: actorName, action: "delete_user",
    entity_type: "user", entity_id: id, entity_name: target.full_name,
  });

  return NextResponse.json({ ok: true });
}
