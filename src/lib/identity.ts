import {
  estateRolesOf, orgRolesOf, platformRolesOf, highestRole,
  type AppRole, type OrgRole, type PlatformRole,
} from "@/lib/roles";

// ── resolveIdentity ── COMP-IDENTITY-001 Phase 3 item 13 (COMP-SECURITY-SURVEY-001 s6.2) ────────────
//
// ONE read of the six role columns, folded by the three folds in roles.ts, so a screen that needs to
// know who somebody is makes ONE call instead of re-spelling a fold that exists at ~350 call sites.
//
// ⚠⚠ READ-SIDE UNIFICATION ONLY. This module drops nothing, renames nothing, migrates nothing. The
// six columns stay exactly as they are; what is consolidated is the READING of them, because s6.2
// names the alternative as the biggest lockout risk in the survey: a drop or rename signs everybody
// out of every workspace at once, behind gates that render walls rather than redirects. Column
// removal is a separate, much later change, behind a verified-empty check on each column.
//
// ⚠ CALL SITES ARE REPOINTED ONE AT A TIME, and only after scripts/identity-resolver-harness.ts has
// proved, for EVERY live profile, that the folds here answer exactly what the inline expressions
// answer. A repoint that changed one person's identity answer would not fail a type check -- it
// would lock a person out, silently, at whichever gate was repointed that day.
//
// ⚠ THE TWO-GATE BOUNDARY (COMP-ARCH-PSA-001) HOLDS HERE TOO: profiles.role is NULLABLE and
// Competen Practice never reads it. This resolver serves the PLATFORM plane -- the estate layouts,
// the org-role workspaces, HQ -- and nothing under /practice may import it for authorization.
// Practice authorization is practice_membership + practice_role_capabilities, full stop.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The raw fragment, exactly as stored -- surfaced so a caller can see what the folds saw. */
export type IdentityRow = {
  role: string | null;
  roles: string[] | null;
  org_role: string | null;
  org_roles: string[] | null;
  platform_role: string | null;
  platform_roles: string[] | null;
  full_name: string | null;
  hospital_id: string | null;
  organisation_id: string | null;
  tenant_id: string | null;
};

export type ResolvedIdentity = {
  userId: string;
  /** The profile row was actually read. False means NOTHING below may be treated as an answer. */
  readable: boolean;
  /** Present when readable and the profile exists. A missing profile is a real, distinct fact. */
  exists: boolean;
  row: IdentityRow | null;
  /** The estate fold: unvalidated strings, exactly what the ~350 inline sites compute today. */
  estateRoles: string[];
  /** The most senior estate role, or null -- the CP-SPLIT-001 practice_only case. */
  highestEstateRole: AppRole | null;
  /** The org fold, vocabulary-validated (orgRolesOf's own long-standing behaviour). */
  orgRoles: (OrgRole | null)[];
  /** The platform (landlord) fold, vocabulary-validated (platformRolesOf's own behaviour). */
  platformRoles: PlatformRole[];
};

const IDENTITY_COLUMNS =
  "role, roles, org_role, org_roles, platform_role, platform_roles, full_name, hospital_id, organisation_id, tenant_id";

/**
 * Resolve one person's platform-plane identity. Never throws; never invents.
 *
 * ⚠ `readable: false` IS NOT "no roles". A gate that treated a failed read as an empty identity
 * would sign the whole platform out on a database blip -- the exact failure class Phase 0 spent a
 * week digging out of the MFA and rate-limit paths. Callers branch on `readable` FIRST.
 */
export async function resolveIdentity(admin: any, userId: string): Promise<ResolvedIdentity> {
  const none: ResolvedIdentity = {
    userId, readable: false, exists: false, row: null,
    estateRoles: [], highestEstateRole: null, orgRoles: [null], platformRoles: [],
  };
  if (!userId) return { ...none, readable: true };

  const { data, error } = await admin.from("profiles")
    .select(IDENTITY_COLUMNS).eq("id", userId).maybeSingle();
  if (error) return none;

  const row = (data ?? null) as IdentityRow | null;
  const estateRoles = estateRolesOf(row);
  return {
    userId,
    readable: true,
    exists: row !== null,
    row,
    estateRoles,
    highestEstateRole: highestRole(estateRoles),
    orgRoles: orgRolesOf(row),
    platformRoles: platformRolesOf(row),
  };
}
