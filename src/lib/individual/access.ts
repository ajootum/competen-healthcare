/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPERIENCE_KEYS, isExperienceKey, type ExperienceKey } from "./experiences";

// ── GATE 3: WHO MAY ENTER COMPETEN INDIVIDUAL, AND WHICH EXPERIENCES ARE LIVE ── ADR-016 ──────────────
//
// One read answers both questions, for the shell layout, the experience layout, the landing, the
// welcome and every Individual API route. Two places asking "is this person in" is two places for the
// answer to differ -- the defect product-resolution.ts recorded on 2026-08-26.
//
// ⚠ THREE STATES, AND THE THIRD FAILS CLOSED. `member` and `none` are answers. `unavailable` is the
// store failing to answer, and it admits nobody: ADR-015's "unreadable is not permission". That is the
// opposite of admitToEstate's deliberate fail-OPEN, and the difference is argued, not accidental --
// the estate fails open because 47 existing members would be locked out of a live product by a blip.
// Individual has no population a blip could strand, and a fail-open gate on a product that holds
// personal learning data is the worse error.
//
// ⚠ "NOT PROVISIONED" IS A KIND OF `none`, NOT OF `unavailable`. Before migration 370 is applied the
// tables do not exist. Nobody can hold a membership in a table that does not exist, so the truthful
// answer is "no access", with the reason carried so the access page can say the product is not set up
// here rather than implying the person was refused.
//
// ⚠ LIVENESS IS THE DATABASE'S CLOCK. Live experiences come from the view individual_live_entitlement,
// which compares periods with now() inside Postgres. Nothing here compares Date.now() with a stored
// period -- the app-clock/DB-clock comparison this estate has been bitten by before.

/** PostgREST and Postgres codes for "that relation or column is not there" -- the migration-not-applied
 *  family, the same set src/lib/practice/booking-rules.ts treats as not applied. */
export const NOT_PROVISIONED_CODES = new Set(["PGRST204", "PGRST205", "PGRST202", "42703", "42P01"]);
export const isNotProvisioned = (error: any): boolean => !!error && NOT_PROVISIONED_CODES.has(String(error.code ?? ""));

export type MembershipStatus = "active" | "suspended" | "revoked";

export type IndividualMembership = {
  id: string;
  status: MembershipStatus;
  primaryExperience: ExperienceKey | null;
  onboardedAt: string | null;
  grantedAt: string | null;
};

export type IndividualAccess =
  | { state: "member"; membership: IndividualMembership; live: ExperienceKey[] }
  | { state: "none"; reason: "no_membership" | "suspended" | "revoked" | "not_provisioned" }
  | { state: "unavailable" };

/** Pure: fold the two reads into an access answer. Exported for the unit tests. */
export function foldAccess(
  membershipRead: { data: any; error: any },
  liveRead: { data: any; error: any } | null,
): IndividualAccess {
  if (membershipRead.error) {
    return isNotProvisioned(membershipRead.error) ? { state: "none", reason: "not_provisioned" } : { state: "unavailable" };
  }
  const row = membershipRead.data;
  if (!row) return { state: "none", reason: "no_membership" };
  if (row.status === "suspended") return { state: "none", reason: "suspended" };
  if (row.status !== "active") return { state: "none", reason: "revoked" };

  // A member whose entitlements cannot be read is NOT a member with no experiences -- that would render
  // "nothing is active on your account", a false statement. Fail closed instead.
  if (!liveRead || liveRead.error) return { state: "unavailable" };

  const codes = new Set(((liveRead.data ?? []) as any[]).map(r => r.experience_code).filter(isExperienceKey));
  // Registry order, so both experiences always list Scholar then Professional whatever order rows came in.
  const live = EXPERIENCE_KEYS.filter(k => codes.has(k));
  return {
    state: "member",
    live,
    membership: {
      id: row.id,
      status: "active",
      primaryExperience: isExperienceKey(row.primary_experience) ? row.primary_experience : null,
      onboardedAt: row.onboarded_at ?? null,
      grantedAt: row.granted_at ?? null,
    },
  };
}

export async function readIndividualAccess(admin: any, userId: string): Promise<IndividualAccess> {
  let membershipRead: { data: any; error: any };
  try {
    membershipRead = await admin.from("individual_membership")
      .select("id, status, primary_experience, onboarded_at, granted_at")
      .eq("user_id", userId).maybeSingle();
  } catch {
    return { state: "unavailable" };
  }
  if (membershipRead.error || !membershipRead.data || membershipRead.data.status !== "active") {
    return foldAccess(membershipRead, null);
  }
  let liveRead: { data: any; error: any };
  try {
    liveRead = await admin.from("individual_live_entitlement")
      .select("experience_code").eq("user_id", userId).limit(20);
  } catch {
    return { state: "unavailable" };
  }
  return foldAccess(membershipRead, liveRead);
}

// ── THE LANDING ── where /individual/home sends a member ─────────────────────────────────────────────

export type Landing =
  | { kind: "welcome" }
  | { kind: "experience"; experience: ExperienceKey }
  | { kind: "no_experience" };

/** The primary experience, honoured only while it is live (ADR-016 decision 4). */
export function effectivePrimary(primary: ExperienceKey | null, live: readonly ExperienceKey[]): ExperienceKey | null {
  if (primary && live.includes(primary)) return primary;
  return live[0] ?? null;
}

export function decideLanding(membership: IndividualMembership, live: readonly ExperienceKey[]): Landing {
  if (live.length === 0) return { kind: "no_experience" };
  if (!membership.onboardedAt) return { kind: "welcome" };
  const experience = effectivePrimary(membership.primaryExperience, live);
  return experience ? { kind: "experience", experience } : { kind: "no_experience" };
}

/**
 * Validate a primary-experience choice. A person may make primary only an experience that is live for
 * them -- choosing one they do not hold would be a preference the landing then silently ignores.
 */
export function validatePrimaryChoice(choice: unknown, live: readonly ExperienceKey[]): ExperienceKey | null {
  return isExperienceKey(choice) && live.includes(choice) ? choice : null;
}
