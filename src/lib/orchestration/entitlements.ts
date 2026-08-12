// PW-014 P0 / §10, §12 — the single Entitlement Service. Consolidates the scattered primitives
// (scopeHospitalIds in api-auth.ts, orgRolesOf/workspacesFor in roles.ts, ROLE_CONFIG portals) into ONE resolver:
// what workspaces may this user ENTER, and at what SCOPE. Enforces PW-014's authorization rule — *visibility is
// not authorization*: canEnterWorkspace() is the server-side re-auth primitive every landing/launch/deep-link
// must call. Reads only identity/role columns; fail-soft. Acting roles (context_assignment) are stubbed for WS1+.
import { orgRolesOf, highestRole, type AppRole, type OrgRole } from "@/lib/roles";
import { WORKSPACE_REGISTRY, loadWorkspaceRegistry, type RegisteredWorkspace } from "@/lib/orchestration/registry";
import { loadTenantLicensing, isWorkspaceLicensed } from "@/lib/orchestration/licensing";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type EntitledWorkspace = RegisteredWorkspace & { reason: "personal" | "portal" | "org_role" };
export type Entitlements = {
  userId: string;
  tenantId: string | null;
  hospitalId: string | null;
  organisationId: string | null;
  roles: AppRole[];
  orgRoles: (OrgRole | null)[];
  // null = this identity holds no estate role at all (a Competen Practice practitioner, CP-SPLIT-002).
  activeRole: AppRole | null;
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
  // !! THIS USED TO SAY roles: ["nurse"], activeRole: "nurse". It is the same defect as highestRole's
  // old `?? "nurse"` fallback, arriving through a different door: an identity with NO PROFILE AT ALL was
  // handed a nurse badge by the entitlement service. Nothing downstream needs it -- `workspaces` is
  // empty here either way -- so it is now honest. CP-SPLIT-002.
  const empty: Entitlements = { userId, tenantId: null, hospitalId: null, organisationId: null, roles: [], orgRoles: [null], activeRole: null, scopes: { hospitalIds: [] }, workspaces: [], actingRoles: [] };
  let profile: any = null;
  try {
    const { data } = await admin.from("profiles").select("role, roles, org_role, org_roles, hospital_id, tenant_id, organisation_id").eq("id", userId).maybeSingle();
    profile = data;
  } catch { /* fail-soft */ }
  if (!profile) return empty;

  const roles: AppRole[] = (profile.roles?.length ? profile.roles : [profile.role]).filter(Boolean) as AppRole[];
  const orgRoles = orgRolesOf({ org_role: profile.org_role, org_roles: profile.org_roles });
  const isSuper = roles.includes("super_admin");
  // !! CP-SPLIT-002. highestRole returns AppRole | null, and the old `as AppRole` cast swallowed that
  // null -- this was one of the four sites the changed signature was supposed to force, and did not.
  //
  // The null is NOT replaced with a role here. `activeRole` on Entitlements is nullable now, because
  // this resolver is the answer to "what may this person enter" and inventing a role for somebody who
  // holds none would make the answer wrong in the one direction that matters. Note the `workspaces`
  // list below is already correct for such a person without any help: admit() matches on roles the user
  // actually holds, so an empty roles array entitles them to the personal workspace and nothing else.
  const activeRole: AppRole | null =
    (activeRoleHint && roles.includes(activeRoleHint as AppRole) ? (activeRoleHint as AppRole) : highestRole(roles));

  const [registry, licensing] = await Promise.all([
    loadWorkspaceRegistry(admin),
    loadTenantLicensing(admin, profile.tenant_id ?? null),
  ]);
  const workspaces: EntitledWorkspace[] = registry
    .filter(w => w.enabled)
    // Compose licensing with entitlement (PCS-PORT-001): available iff LICENSED and ENTITLED. Fail-open — an
    // unmapped workspace / unknown tenant / unprovisioned store all pass, so nothing changes until configured.
    .filter(w => isWorkspaceLicensed(licensing, w.key))
    .map(w => { const reason = admit(w, roles, orgRoles); return reason ? { ...w, reason } : null; })
    .filter(Boolean) as EntitledWorkspace[];

  return {
    userId,
    tenantId: profile.tenant_id ?? null,
    hospitalId: profile.hospital_id ?? null,
    organisationId: profile.organisation_id ?? null,
    // Reported as held, not as padded. `["nurse"]` here was the third copy of the same fabrication.
    roles,
    orgRoles,
    activeRole,
    scopes: { hospitalIds: isSuper ? null : (profile.hospital_id ? [profile.hospital_id] : []) },
    workspaces,
    actingRoles: [],
  };
}

// Server-side re-authorization primitive — *visibility is not authorization* (§10). Every action/deep-link
// handler must gate on this against the CURRENT entitlements, never on what a widget happened to render.
//
// ⚠⚠ IT HAS NO CALL SITES OUTSIDE THIS FILE, AND IT IS FAIL-OPEN BY INHERITANCE. DO NOT ADOPT IT FOR AN
// ENTERPRISE SURFACE. It answers from `ent.workspaces`, which resolveEntitlements() builds through the
// estate's deliberately fail-open path — an unmapped workspace, an unknown tenant or an unprovisioned
// store all resolve to available. That is the ESTATE's recorded posture and ENT-DEC-001 D10 leaves it
// unchanged for now (the owner, 2026-08-12: "new enterprise surfaces fail closed, estate unchanged").
//
// So a new Enterprise gate written on top of this would inherit fail-OPEN while believing it had a
// gate, which is the one outcome D10 exists to prevent. Gate 3 is requireEnterpriseContext() over
// enterprise-membership.ts, where `unreadable` REFUSES and a harness asserts it beside a control.
//
// Kept rather than deleted because it is the estate's stated re-auth contract and deleting it would
// quietly drop a §10 obligation; it is named here so nobody wires it up mistaking it for a boundary.
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
