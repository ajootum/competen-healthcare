/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AppRole } from "@/lib/roles";

/**
 * COMPETEN PLATFORM MEMBERSHIP -- GATE 1, MADE EXPLICIT.
 *
 * Governing document: docs/COMP-ARCH-PSA-001-product-separation.md, sections 7, 14, 40 and 44.
 * Survey: docs/CP-SPLIT-002-separation-survey.md, stages 1 and 3. Schema: migration 279.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IS FOR.
 *
 * "Shared identity may establish who a person is. Product membership establishes where that person
 * belongs. Product authorization establishes what that person may do." (s3.)
 *
 * Until migration 279 the middle sentence had nowhere to live on this database: profiles.role was NOT
 * NULL, so every identity was a Platform member by construction and Competen Practice signup had to
 * write `role: "nurse"` because there was no other value it could write. This module is the reader of
 * the table that fixed that, and it is the ONE place the estate asks "does this person belong to
 * Competen Platform at all".
 *
 * It is deliberately NOT in src/lib/platform/ (the platform-operator/landlord modules) and NOT in
 * src/lib/practice/. It sits between the two products because it is the boundary between them.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * !! THE TWO OWNER ACCOUNTS CAN NEVER BE LOCKED OUT BY THIS FILE. THAT IS RULE ZERO.
 *
 * There are two super_admin accounts on this database and nobody above them. If this module could
 * refuse them, a bad row, a dropped table, a mid-migration state or a transient PostgREST failure would
 * shut the owners out of the console they would use to fix it, and there is no way back in.
 *
 * So `admitToEstate` answers `super_admin` BEFORE it reads anything. Not "reads and then prefers the
 * role" -- it does not perform the read at all. That is the same shape src/app/super-admin/layout.tsx
 * already uses for HQ, where the comment reads "no read of ogs_offices -- succeeding, failing, or
 * against a table somebody has just altered -- can lock them out". Copied here on purpose, because the
 * property being protected is identical and a reader comparing the two files should see the same shape.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * !! THREE STATES, AND THE THIRD ONE ADMITS. THIS IS THE OPPOSITE CALL FROM THE HQ GATE, DELIBERATELY.
 *
 * A read of platform_membership has three outcomes, never two:
 *
 *   "member"      an active row exists.
 *   "not_member"  the read completed and there is no active row.
 *   "unreadable"  the read did not complete -- the table is missing (migration 279 not applied yet),
 *                 PostgREST is down, RLS was changed under us, the network failed.
 *
 * `unreadable` ADMITS. It is never folded into `not_member`. The reasoning, because it deserves to be
 * argued rather than asserted:
 *
 *   1. THE COST OF THE TWO MISTAKES IS NOT SYMMETRIC HERE. Reading "unreadable" as "not a member"
 *      would blank every estate surface for all 47 people the moment this table hiccuped. Reading it as
 *      "member" admits, at worst, the people this gate was built to exclude -- which today is ONE
 *      person, Mullen E., and only for as long as the outage lasts.
 *
 *   2. ADMITTING ON UNREADABLE DEGRADES TO YESTERDAY, IT DOES NOT OPEN A NEW DOOR. This gate is an
 *      ADDITIONAL condition layered on top of the estate role gate that each of the eleven layouts
 *      already applies. If this read fails, the caller still has to satisfy that role gate, exactly as
 *      it did before migration 279 existed. The failure mode is "the product behaves as it did last
 *      week", not "the product is open".
 *
 *   3. THE HQ GATE FACES THE OTHER WAY, AND SO IT DECIDES THE OTHER WAY. resolveHqPositions returns an
 *      empty capability list both when a person holds no position and when the read failed, and
 *      /super-admin/layout.tsx treats empty as REFUSED. It can afford to, because a false refusal there
 *      costs an owner letting somebody back in, while a false admission puts a stranger inside the
 *      estate console. Here the numbers are reversed: a false refusal costs 47 people their entire
 *      product, and a false admission costs one person's exclusion being delayed. Same principle --
 *      weigh the two errors -- opposite answer, and the difference is which side the crowd is on.
 *
 * The state is REPORTED, never swallowed: `admitToEstate` returns it, and the unreadable case is
 * logged, so a silent degradation is visible in the server log rather than inferred from behaviour.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * !! A HEAD+COUNT PROBE CANNOT DETECT A MISSING TABLE ON THIS STACK.
 *
 *   await admin.from("platform_membership").select("id", { count: "exact", head: true })
 *
 * returns `count: null` and NO ERROR when the table does not exist. Verified live against this database
 * while writing this file. So the read below is a real row select, whose error is PGRST205 when the
 * table is absent. Getting this wrong would have made "migration 279 not applied" indistinguishable
 * from "nobody is a member" -- the exact collapse the three-state model exists to prevent.
 */

export const PLATFORM_MEMBERSHIP_TABLE = "platform_membership";

/**
 * Where a person with no Platform membership is sent.
 *
 * NOT a 404 and not an "Access restricted" dead end. They are a Competen Practice practitioner and the
 * product they belong to is one redirect away. /practice/home resolves further from there on its own:
 * the practice shell sends somebody with no workspace to /practice, and somebody signed out to
 * /practice/sign-in, so this is never a loop and never a blank wall.
 */
export const NO_MEMBERSHIP_DESTINATION = "/practice/home";

export type PlatformMembershipState = "member" | "not_member" | "unreadable";

export type PlatformMembershipRead = {
  state: PlatformMembershipState;
  /** The stored status when a row was read, else null. active | suspended | revoked. */
  status: string | null;
  /** The PostgREST error code when the read did not complete, else null. */
  errorCode: string | null;
};

export type EstateAdmission = {
  admitted: boolean;
  membership: PlatformMembershipState;
  reason:
    | "owner_break_glass"      // super_admin / platform owner. No read was performed.
    | "member"                 // an active platform_membership row.
    | "store_unreadable"       // admitted, and the estate role gate below is still the operative check.
    | "no_platform_membership"; // the read completed and said no.
};

/**
 * The break-glass predicate, in one place so the eleven layouts cannot drift from each other.
 *
 * super_admin only. Both owner accounts on this database hold role `super_admin` (verified live:
 * competenhealthcare@gmail.com and mullenokaisu@gmail.com), so this is the set that must never be
 * refused. `platform_owner` is a LANDLORD role on a different axis and is passed in separately by
 * /super-admin/layout.tsx, which is the only surface that resolves it.
 */
export function holdsEstateBreakGlass(roles: AppRole[]): boolean {
  return roles.includes("super_admin");
}

/**
 * Read one identity's Platform membership. Three states, always. Never throws.
 *
 * `status` is checked in TypeScript rather than with `.eq("status", "active")` so that a suspended or
 * revoked row is distinguishable from an absent one by a caller that wants to say something different
 * about them later. Today both refuse.
 */
export async function readPlatformMembership(admin: any, userId: string): Promise<PlatformMembershipRead> {
  try {
    const { data, error } = await admin
      .from(PLATFORM_MEMBERSHIP_TABLE)
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    // maybeSingle() gives error === null and data === null for "no such row", which is the ONLY way
    // this function is allowed to conclude not_member.
    if (error) return { state: "unreadable", status: null, errorCode: error.code ?? "UNKNOWN" };
    if (!data) return { state: "not_member", status: null, errorCode: null };
    return {
      state: data.status === "active" ? "member" : "not_member",
      status: (data.status as string) ?? null,
      errorCode: null,
    };
  } catch (e: any) {
    // A thrown error (fetch failure, TLS, aborted request) is exactly as unreadable as a returned one.
    return { state: "unreadable", status: null, errorCode: e?.code ?? "THROWN" };
  }
}

/**
 * THE SHARED ESTATE GUARD. Every one of the eleven estate layouts calls this and nothing else.
 *
 * Order is the safety property and must not be rearranged:
 *   1. break-glass, with NO read
 *   2. read
 *   3. unreadable admits (and says so)
 *   4. membership decides
 *
 * @param breakGlass extra owner predicate for the one surface that has another axis of ownership
 *                   (/super-admin passes hasPlatformRole(profile, "platform_owner")). Evaluated
 *                   BEFORE the read, like the role check, for the same reason.
 */
export async function admitToEstate(
  admin: any,
  userId: string,
  roles: AppRole[],
  opts?: { breakGlass?: boolean },
): Promise<EstateAdmission> {
  if (holdsEstateBreakGlass(roles) || opts?.breakGlass === true) {
    return { admitted: true, membership: "member", reason: "owner_break_glass" };
  }

  const read = await readPlatformMembership(admin, userId);

  if (read.state === "unreadable") {
    // Visible, not silent. If this appears in a log, the estate is running on its role gate alone and
    // somebody needs to know that before they conclude the membership gate is working.
    console.warn(
      `[platform-membership] UNREADABLE (${read.errorCode}) for ${userId} -- admitting to the estate and ` +
      `falling back to the role gate. This is the deliberate posture, see src/lib/platform-membership.ts.`,
    );
    return { admitted: true, membership: "unreadable", reason: "store_unreadable" };
  }

  if (read.state === "member") return { admitted: true, membership: "member", reason: "member" };
  return { admitted: false, membership: "not_member", reason: "no_platform_membership" };
}

/**
 * THE PROFILE ROW A COMPETEN PRACTICE REGISTRATION WRITES. Section 11's "MUST NOT occur" list, as data.
 *
 * An identity, and no estate standing: `role: null`. It is stated here, in the boundary module, rather
 * than inline in the Practice signup route, for two reasons. It is a PRODUCT BOUNDARY rule and not a
 * Practice detail -- the same shape would be right for any future gate-2 product. And it gives the
 * harness something to IMPORT: a test that restated `{ role: null }` itself would pass even if the
 * route were changed back to 'nurse' tomorrow.
 *
 * !! `role` IS PRESENT AND null, NOT OMITTED. public.handle_new_user() has already written 'nurse' into
 * this row by the time the caller upserts (migration 249 s1, where that default is deliberate and must
 * stay for the estate's own signup). An omitted key leaves the 'nurse' standing.
 */
export function practiceIdentityProfile(
  userId: string, fullName: string, email: string,
): { id: string; full_name: string; email: string; role: null } {
  return { id: userId, full_name: fullName, email, role: null };
}

/**
 * Provision Platform membership. The "separate, explicitly initiated Competen Platform workflow"
 * section 11 requires before any identity gets gate 1.
 *
 * !! THIS GRANTS NO ROLE, AND NOTHING THAT GRANTS A ROLE MAY CALL IT IMPLICITLY. Section 5: no product
 * may create or infer membership in another. The mirror of that rule inside one product is that
 * membership and role are two writes, made by two decisions. This function touches exactly one table.
 *
 * The upsert targets ux_platform_membership_user, a FULL unique index on one NOT NULL column. A partial
 * index here would be an upsert that silently writes nothing.
 *
 * The error is RETURNED, never discarded. A caller that ignores it has created an account that cannot
 * sign in to the product it was created for.
 */
export async function grantPlatformMembership(
  admin: any,
  userId: string,
  opts: { grantedBy?: string | null; source?: "platform_signup" | "admin_grant" | "explicit_grant"; note?: string | null } = {},
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await admin.from(PLATFORM_MEMBERSHIP_TABLE).upsert({
    user_id: userId,
    status: "active",
    granted_by: opts.grantedBy ?? null,
    source: opts.source ?? "explicit_grant",
    note: opts.note ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  return { ok: !error, error: error?.message ?? null };
}
