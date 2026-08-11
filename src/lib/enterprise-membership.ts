/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * COMPETEN ENTERPRISE MEMBERSHIP -- GATE 3.
 *
 * ENT-DEC-001 D4. Schema: migration 286. Siblings: platform-membership.ts (gate 1) and
 * practice_membership (gate 2).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IS FOR.
 *
 * Today a hospital administrator reaches the tenant administration surfaces through the ESTATE role
 * gate, which means every hospital administrator is a Competen PLATFORM member. ENT-GOV-001 s7 says a
 * customer administrator "cannot access Competen HQ governance", and ENT-ADM-001 s1 that the customer
 * workspace "does not create a customer superadmin equivalent to Competen HQ". A customer admitted
 * through gate 1 inherits the estate plane, which is the collapse COMP-ARCH-PSA-001 exists to prevent.
 *
 * This module is the reader of the table that fixes that.
 *
 * ⚠ MEMBERSHIP IS PER TENANT, NOT PER IDENTITY. That is the shape difference from gate 1: Platform
 * membership answers "are you on the estate", one row per person. This answers "do you belong to THIS
 * hospital tenant", one row per person per tenant, because ENT-NAV-001 s12 requires multi-tenant
 * identity and a consultant working across two groups is the ordinary case.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THREE STATES, AND HERE THE THIRD ONE REFUSES. THIS IS THE OPPOSITE CALL FROM GATE 1, DELIBERATELY.
 *
 *   "member"      an active row exists for this person and this tenant.
 *   "not_member"  the read completed and there is no active row.
 *   "unreadable"  the read did not complete -- table missing, PostgREST down, RLS changed, network gone.
 *
 * platform-membership.ts argues at length that `unreadable` must ADMIT, and it is right for gate 1 for
 * two reasons that BOTH FAIL HERE:
 *
 *   1. THERE, THE GATE IS AN ADDITIONAL LAYER. Eleven estate layouts already apply a role gate, so
 *      admitting on unreadable "degrades to yesterday" -- the caller still has to satisfy the role
 *      check. HERE THERE IS NO LAYER UNDERNEATH. ENT-DEC-001 D11 removes the hard-coded
 *      `["hospital_admin","super_admin"]` role gate precisely because ENT-GOV-001 s23 forbids it by
 *      name. So admitting on unreadable would open a tenant surface to anybody authenticated, with
 *      nothing behind it. That is not degrading to yesterday, it is opening a door.
 *
 *   2. THERE, A FALSE REFUSAL COSTS 47 PEOPLE THEIR ENTIRE PRODUCT. Here it costs nothing today: the
 *      Enterprise product has no users, so there is no crowd to blank. The asymmetry that decided gate 1
 *      points the other way at gate 3.
 *
 * This is also the recommendation recorded against ENT-DEC-001 D10 (which is otherwise still open): new
 * Enterprise surfaces are fail-closed from the start, and the existing estate behaviour changes only as
 * a separate, announced decision. ENT-OPS-001 OP-08 asks for exactly this.
 *
 * The state is REPORTED, never swallowed. A caller that wants to distinguish "you do not belong here"
 * from "we could not tell" gets both.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ super_admin DOES NOT SHORT-CIRCUIT INTO A TENANT, AND THAT IS THE HARDEST CALL IN THIS FILE.
 *
 * platform-membership.ts makes owner short-circuit RULE ZERO, because refusing a super_admin could lock
 * the only two owners out of the console they would use to fix it. That reasoning is about COMPETEN's
 * OWN console, and it does not transfer:
 *
 *   - This gate does not guard /super-admin. Competen's console is reached through gate 1 and is
 *     untouched by this file, so no owner can be locked out of anything of Competen's by it.
 *   - What it guards is A CUSTOMER'S DATA. A role check that silently admits Competen staff into every
 *     hospital tenant is exactly the unbounded platform access ENT-OPS-001 s20 asks to be TIME-BOXED
 *     and auditable, and docs/PLAT-OVERSIGHT-SURVEY-001 already settled that what platform staff may
 *     see of a tenant is a governed question rather than a role.
 *
 * ⚠ So Competen support access to a tenant is a GRANT, not a role: an `enterprise_membership` row with
 * `source = 'admin_grant'`, which is visible, revocable and expires when somebody revokes it. Until
 * ENT-OPS-001 s20's time-boxed support access is built, that grant is the mechanism, and its absence is
 * a refusal like anybody else's.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ A HEAD+COUNT PROBE CANNOT DETECT A MISSING TABLE ON THIS STACK.
 *
 *   admin.from("enterprise_membership").select("id", { count: "exact", head: true })
 *
 * returns `count: null` and NO ERROR when the table does not exist -- verified live against this
 * database. So the read below is a real row select, whose error is PGRST205 when the table is absent.
 * Getting this wrong would make "migration 286 not applied" indistinguishable from "nobody is a member",
 * which is the exact collapse the three-state model exists to prevent.
 */

export const ENTERPRISE_MEMBERSHIP_TABLE = "enterprise_membership";

export type EnterpriseMembershipState = "member" | "not_member" | "unreadable";

export type EnterpriseMembershipRead = {
  state: EnterpriseMembershipState;
  /** The stored status when a row was read, else null. active | suspended | revoked. */
  status: string | null;
  /** Why, in words a log reader can act on. Null when a row was read cleanly. */
  detail: string | null;
};

/**
 * Does this person belong to this tenant?
 *
 * ⚠ BOTH ARGUMENTS ARE REQUIRED AND NEITHER MAY BE NULL. A null tenant is not "any tenant" -- it is a
 * caller whose tenant could not be resolved, and answering "member" for it would admit somebody to a
 * tenant nobody named. `profiles.tenant_id` is null for 15 of 47 people on this database today, so this
 * is a live case rather than a defensive one.
 */
export async function readEnterpriseMembership(
  admin: any, userId: string | null | undefined, tenantId: string | null | undefined,
): Promise<EnterpriseMembershipRead> {
  if (!userId)
    return { state: "not_member", status: null, detail: "No signed-in identity, so no tenant membership can be read." };
  if (!tenantId)
    return {
      state: "not_member", status: null,
      detail: "This account is not attached to a tenant, so there is nothing to belong to. A null tenant is not a wildcard.",
    };

  // ⚠ A REAL ROW SELECT. See the header: head+count cannot tell a missing table from an empty one.
  const { data, error } = await admin
    .from(ENTERPRISE_MEMBERSHIP_TABLE)
    .select("status")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error)
    return {
      state: "unreadable", status: null,
      detail: `The tenant membership store could not be read (${error.code ?? "unknown"}). Access is refused rather than assumed, because nothing else gates this surface.`,
    };

  if (!data)
    return { state: "not_member", status: null, detail: "No membership of this tenant is recorded for this account." };

  const status = (data as { status?: string }).status ?? null;
  if (status !== "active")
    return {
      state: "not_member", status,
      detail: `This account's membership of the tenant is ${status ?? "not active"}, so it does not admit.`,
    };

  return { state: "member", status, detail: null };
}

/**
 * The one-line question most callers want. ⚠ `unreadable` is FALSE here -- see the header for why this
 * is the opposite of `admitToEstate`, which admits.
 */
export async function admitToEnterprise(
  admin: any, userId: string | null | undefined, tenantId: string | null | undefined,
): Promise<{ admitted: boolean; read: EnterpriseMembershipRead }> {
  const read = await readEnterpriseMembership(admin, userId, tenantId);
  if (read.state === "unreadable")
    // Reported rather than silent: a refusal caused by an outage must be visible in the log, or it
    // presents to a practitioner as "you do not belong here" with no way to tell the difference.
    console.warn(`[enterprise] membership unreadable for user=${userId} tenant=${tenantId}: ${read.detail}`);
  return { admitted: read.state === "member", read };
}

/**
 * ⚠ WHAT A REFUSED PERSON IS TOLD, AND IT DISTINGUISHES THE TWO CASES.
 *
 * "You do not have access" is the same sentence for somebody who genuinely does not belong and for
 * somebody refused by an outage, and the second person needs to know it is worth trying again. This is
 * the only sentence an Enterprise surface may print about a refusal.
 */
export function enterpriseRefusalSentence(read: EnterpriseMembershipRead): string {
  if (read.state === "unreadable")
    return "This could not be checked just now, so access has been refused rather than assumed. It is worth trying again in a moment. If it keeps happening, the practice's support contact can look into it.";
  if (read.status === "suspended")
    return "Your access to this organisation is suspended. An administrator at the organisation can restore it.";
  if (read.status === "revoked")
    return "Your access to this organisation has been withdrawn. An administrator at the organisation can grant it again.";
  return "You do not have access to this organisation on Competen Enterprise. An administrator at the organisation can give you access.";
}
