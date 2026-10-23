import { NextResponse } from "next/server";
import { hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { estateRolesOf, profileUpdateForOrgRoles } from "@/lib/roles";
import { grantPlatformMembership } from "@/lib/platform-membership";

import { currentTraceId } from "@/lib/trace";

// HQ-USERS-A: every handler here is OWNER-ONLY, as before, but the owner is now decided by the HQ gate
// (super_admin in roles[], or platform_owner) instead of the single legacy profiles.role column. Role and
// tenancy changes, account creation and deletion stay with the platform's owners.
async function requireOwner() {
  const ctx = await hqOwnerApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;
  return { admin: ctx.admin, actorId: ctx.userId, actorName: ctx.fullName };
}

export async function PATCH(req: Request) {
  const ctx = await requireOwner();
  if (ctx instanceof NextResponse) return ctx;

  const { userId, isSuperAdmin, org_roles, extra_portal_roles, hospital_id, organisation_id, platform_role, department_id } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  let update: Record<string, unknown>;

  if (isSuperAdmin) {
    update = { role: "super_admin", roles: ["super_admin"], org_role: null, org_roles: [] };
    if (platform_role !== undefined) update.platform_role = platform_role || null;
  } else {
    // ONE derivation, shared with join-request approval (roles.ts) -- see profileUpdateForOrgRoles.
    const derived = profileUpdateForOrgRoles(org_roles as string[] ?? [], extra_portal_roles as string[] ?? []);
    if (!derived) {
      return NextResponse.json({ error: "At least one org role is required" }, { status: 400 });
    }
    update = { ...derived };
  }

  if (hospital_id !== undefined) update.hospital_id = hospital_id ?? null;
  if (organisation_id !== undefined) update.organisation_id = organisation_id ?? null;
  if (department_id !== undefined) update.department_id = department_id ?? null;

  const { error } = await ctx.admin.from("profiles").update(update).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const PORTALS = new Set(["super_admin", "hospital_admin", "educator", "assessor", "nurse"]);

// Create a user account: either invite-by-email (user sets their own password)
// or with a server-generated temporary password returned once in the response.
export async function POST(req: Request) {
  const ctx = await requireOwner();
  if (ctx instanceof NextResponse) return ctx;
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

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // !! GATE 1, EXPLICITLY OPENED BY THE ADMINISTRATOR WHO CREATED THE ACCOUNT. CP-SPLIT-002 stage 3.
  //
  // An estate role no longer implies estate access -- src/lib/platform-membership.ts gates all eleven
  // layouts on a platform_membership row. Migration 279 backfilled everybody who already existed, so
  // this line is what keeps accounts created AFTERWARDS from being born locked out.
  //
  // TWO INDEPENDENT WRITES. The role above is what they may do, this is that they belong at all, and
  // neither is derived from the other (COMP-ARCH-PSA-001 s5). granted_by names the administrator, which
  // is the question a null in that column could never answer and the reason s7 asked for a table.
  //
  // NOT ROLLED BACK ON FAILURE, unlike the profile write above, and deliberately: migration 279 is
  // applied by hand and may not be applied yet, and deleting a freshly created colleague's account
  // because a table does not exist yet is a worse outcome than an account that needs one more click.
  // The failure is RETURNED so the administrator sees it rather than discovering it from the colleague.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  const membership = await grantPlatformMembership(admin, userId, {
    grantedBy: actorId, source: "admin_grant",
    note: mode === "invite" ? "Invited by a platform administrator" : "Created by a platform administrator",
  });
  if (!membership.ok) console.error(`[platform-membership] GRANT FAILED for ${userId} at admin create: ${membership.error}`);

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: actorId, actor_name: actorName,
    action: mode === "invite" ? "invite_user" : "create_user",
    entity_type: "user", entity_id: userId, entity_name: full_name,
  });

  return NextResponse.json({
    ok: true, userId, tempPassword,
    platformMembershipWarning: membership.ok ? undefined : membership.error,
  }, { status: 201 });
}

// Permanently delete an account (auth login + profile; competency records
// cascade via their FKs). Guards: not yourself, and never the last super admin.
export async function DELETE(req: Request) {
  const ctx = await requireOwner();
  if (ctx instanceof NextResponse) return ctx;
  const { admin, actorId, actorName } = ctx;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === actorId) return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });

  const { data: target } = await admin.from("profiles").select("full_name, role, roles").eq("id", id).single();
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // A super admin is one whose role OR roles[] says so (estateRolesOf), and the count includes both, so a
  // multi-role owner is neither missed as a target nor left out of "the last one".
  if (estateRolesOf(target).includes("super_admin")) {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).or("role.eq.super_admin,roles.cs.{super_admin}");
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "Cannot delete the last super admin" }, { status: 400 });
  }

  const { error: perr } = await admin.from("profiles").delete().eq("id", id);
  if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
  const { error: aerr } = await admin.auth.admin.deleteUser(id);
  if (aerr) return NextResponse.json({ error: `Profile removed but auth deletion failed: ${aerr.message}` }, { status: 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: actorId, actor_name: actorName, action: "delete_user",
    entity_type: "user", entity_id: id, entity_name: target.full_name,
  });

  return NextResponse.json({ ok: true });
}
