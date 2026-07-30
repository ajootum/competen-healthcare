import { orgRolesOf, workspacesFor, WORKSPACE_CATALOGUE, type AppRole, type WorkspaceLink } from "@/lib/roles";

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
  const links = workspacesFor(orgRolesOf(data ?? null), userRoles);
  // Frontline special-case (HWW-001): a plain `nurse` portal role IS the
  // Healthcare Worker Workspace audience even when no org role has been
  // activated (orgRolesOf → [null] matches nothing in the catalogue). Every
  // nurse gets the bedside workspace without needing a data migration.
  if (userRoles.includes("nurse") && !links.some(l => l.href === "/healthcare-worker")) {
    const hww = WORKSPACE_CATALOGUE.find(w => w.href === "/healthcare-worker");
    if (hww) links.unshift({ label: hww.label, icon: hww.icon, href: hww.href });
  }
  return links;
}
