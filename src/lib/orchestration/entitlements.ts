// PW-014 P0 / §10, §12 — the single Entitlement Service. Consolidates the scattered primitives
// (scopeHospitalIds in api-auth.ts, orgRolesOf/workspacesFor in roles.ts, ROLE_CONFIG portals) into ONE resolver:
// what workspaces may this user ENTER, and at what SCOPE. Enforces PW-014's authorization rule — *visibility is
// not authorization*: canEnterWorkspace() is the server-side re-auth primitive every landing/launch/deep-link
// must call. Reads only identity/role columns; fail-soft. Acting roles (context_assignment) are stubbed for WS1+.
import { orgRolesOf, highestRole, type AppRole, type OrgRole } from "@/lib/roles";
import { WORKSPACE_REGISTRY, loadWorkspaceRegistry, type RegisteredWorkspace } from "@/lib/orchestration/registry";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type EntitledWorkspace = RegisteredWorkspace & { reason: "personal" | "portal" | "org_role" };
export type Entitlements = {
  userId: string;
  tenantId: string | null;
  hospitalId: string | null;
  organisationId: string | null;
  roles: AppRole[];
  orgRoles: (OrgRole | null)[];
  activeRole: AppRole;
  scopes: { hospitalIds: string[] | null }; // null = unrestricted (super_admin)
  workspaces: EntitledWorkspace[];
  actingRoles: never[]; // placeholder — context_assignment (temporary/acting) resolves here in a later slice
};

// Decide whether a registry entry is entitled for these roles, and why.
function admit(w: RegisteredWorkspace, roles: AppRole[], userOrgRoles: (OrgRole | null)[]): EntitledWorkspace["reason"] | null {
  if (w.kind === "personal") return "personal";
  const roleOk = w.appRoles.some(r => roles.includes(r));
  if (!roleOk) return null;
  if (w.kind === "portal") return "portal";
  // workspace kind: needs an unlocking org role AND an admitting app role (mirrors roles.ts workspacesFor)
  return w.orgRoles.some(r => userOrgRoles.includes(r)) ? "org_role" : null;
}

export async function resolveEntitlements(admin: any, userId: string, activeRoleHint?: string | null): Promise<Entitlements> {
  const empty: Entitlements = { userId, tenantId: null, hospitalId: null, organisationId: null, roles: ["nurse"], orgRoles: [null], activeRole: "nurse", scopes: { hospitalIds: [] }, workspaces: [], actingRoles: [] };
  let profile: any = null;
  try {
    const { data } = await admin.from("profiles").select("role, roles, org_role, org_roles, hospital_id, tenant_id, organisation_id").eq("id", userId).maybeSingle();
    profile = data;
  } catch { /* fail-soft */ }
  if (!profile) return empty;

  const roles: AppRole[] = (profile.roles?.length ? profile.roles : [profile.role]).filter(Boolean) as AppRole[];
  const orgRoles = orgRolesOf({ org_role: profile.org_role, org_roles: profile.org_roles });
  const isSuper = roles.includes("super_admin");
  const activeRole = (activeRoleHint && roles.includes(activeRoleHint as AppRole) ? activeRoleHint : highestRole(roles)) as AppRole;

  const registry = await loadWorkspaceRegistry(admin);
  const workspaces: EntitledWorkspace[] = registry
    .filter(w => w.enabled)
    .map(w => { const reason = admit(w, roles, orgRoles); return reason ? { ...w, reason } : null; })
    .filter(Boolean) as EntitledWorkspace[];

  return {
    userId,
    tenantId: profile.tenant_id ?? null,
    hospitalId: profile.hospital_id ?? null,
    organisationId: profile.organisation_id ?? null,
    roles: roles.length ? roles : ["nurse"],
    orgRoles,
    activeRole,
    scopes: { hospitalIds: isSuper ? null : (profile.hospital_id ? [profile.hospital_id] : []) },
    workspaces,
    actingRoles: [],
  };
}

// Server-side re-authorization primitive — *visibility is not authorization* (§10). Every action/deep-link
// handler must gate on this against the CURRENT entitlements, never on what a widget happened to render.
export function canEnterWorkspace(ent: Entitlements, workspaceKeyOrHref: string): boolean {
  return ent.workspaces.some(w => w.key === workspaceKeyOrHref || w.href === workspaceKeyOrHref);
}

// Convenience: the user's primary functional workspace (for the universal-landing jump), or null for a
// personal-only user. Mirrors the layout banner logic against the resolved set.
export function primaryFunctionalWorkspace(ent: Entitlements): EntitledWorkspace | null {
  return ent.workspaces.find(w => w.kind === "portal") ?? ent.workspaces.find(w => w.kind === "workspace") ?? null;
}

// The catalogue of every workspace (for launcher display) is WORKSPACE_REGISTRY; entitlement decides which the
// user may enter. Re-exported for callers that need the full list alongside the entitled subset.
export { WORKSPACE_REGISTRY };
