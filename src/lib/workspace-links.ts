import { orgRolesOf, workspacesFor, type AppRole, type WorkspaceLink } from "@/lib/roles";

// Server helper: the dedicated org-role workspaces a user can switch into, given
// the AppRole portals they already hold. Reads org_role/org_roles off the profile
// (columns added by migration 040) with an explicit `.returns<>()` cast, since the
// generated Supabase types don't carry them. Fail-soft: on any error → no links.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function workspaceLinksForUser(
  admin: any,
  userId: string,
  userRoles: AppRole[],
): Promise<WorkspaceLink[]> {
  const { data } = await admin
    .from("profiles")
    .select("org_role, org_roles")
    .eq("id", userId)
    .maybeSingle();
  // `admin` is loosely typed (service-role client), so `data` is `any` — orgRolesOf
  // accepts the { org_role?, org_roles? } shape and reads only those two fields.
  return workspacesFor(orgRolesOf(data ?? null), userRoles);
}
