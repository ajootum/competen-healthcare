/**
 * Harness fixtures that appoint into Competen HQ or grant a clinical reviewer scope.
 *
 * ⚠ SINCE HQ-SOD-CROSSCUT-01 THE DATABASE REFUSES A FIXTURE THAT SKIPS THE INDEPENDENCE STAMP, and that is the
 * point, not an inconvenience. Migration 640 refuses a reviewer scope with no granter, or granted by the
 * appointee. Migration 641 refuses an HQ appointment write that does not record a platform owner who is not the
 * appointee, stamped on that write. A fixture therefore names a real owner, exactly as the product does.
 *
 * These harnesses run against staging, which holds 640 and 641 before anyone runs them. With no owner profile
 * the stamp is empty and the database refuses the fixture, which is the honest failure.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A platform owner's profile id (estate super_admin or platform_owner), or null when none exists. */
export async function fixtureOwnerId(admin: any): Promise<string | null> {
  const { data } = await admin.from("profiles").select("id, roles, role, platform_roles, platform_role").limit(2000);
  const owner = ((data ?? []) as any[]).find(p =>
    (Array.isArray(p.roles) && p.roles.includes("super_admin")) || p.role === "super_admin"
    || (Array.isArray(p.platform_roles) && p.platform_roles.includes("platform_owner")) || p.platform_role === "platform_owner");
  return owner?.id ?? null;
}

/** The 641 stamp for one write. A fresh timestamp each call, so a change never rides on an old stamp. */
export const appointmentAuthority = (ownerId: string | null) =>
  ownerId ? { authorised_by: ownerId, authorised_at: new Date().toISOString() } : {};
