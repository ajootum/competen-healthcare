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
