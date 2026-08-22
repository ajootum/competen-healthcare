import { cookies } from "next/headers";
import { createHash } from "node:crypto";

// Practice access resolution (CPR-IAM-001 s12 resolvePracticeAccess, CPR-SHELL-001 s9 context contract).
//
// THE CONTEXT IS ESTABLISHED SERVER-SIDE ON EVERY REQUEST. The active-workspace cookie holds nothing but
// a workspace id preference; it is re-validated against live membership, workspace status and entitlement
// every time (SHELL-001 s9.1: "the frontend must not infer permissions", and a membership revoked
// mid-session must bite on the next request, not the next sign-in). Capabilities are computed from
// practice_role_assignment via the caller's ACTIVE memberships only.
//
// Guard evaluation order follows SHELL-001 s6.1 exactly -- authentication, workspace, membership,
// workspace status, entitlement, onboarding -- because evaluating capability before membership leaks
// which routes exist to non-members.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ACTIVE_WS_COOKIE = "practice_active_ws";

export type PracticeAccess = {
  memberships: {
    membershipId: string;
    workspaceId: string;
    workspaceName: string;
    workspaceType: string;
    workspaceStatus: string;
    /** The practice's zone, carried through so resolveWorkspaceContext can hand it to the ctx. */
    workspaceTimezone: string;
    roleCode: string;
  }[];
  /** Distinct workspaces the user can see, derived from active memberships. */
  workspaces: { id: string; name: string; type: string; status: string; roles: string[] }[];
};

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: string;
  workspaceStatus: string;
  /**
   * ⚠ THE PRACTICE'S TIMEZONE, AND IT IS REQUIRED RATHER THAN OPTIONAL.
   *
   * Every timestamptz in the schema is UTC; every date a practitioner reads is a day in THEIR calendar,
   * and the two disagree for three hours a day in Kampala. Making this optional would mean every reader
   * writing `ctx.workspaceTimezone ?? "UTC"`, which is the exact defaulting that hid this bug in eleven
   * places -- an argument nothing passes, silently standing in for the server's clock. Required, the
   * compiler names every site that has to supply it.
   *
   * ⚠ IT IS A SNAPSHOT, TAKEN WHEN THIS CONTEXT WAS RESOLVED. That is right for a request -- the value
   * cannot shift underneath a half-rendered page -- but it means a caller that CHANGES a practice's zone
   * must re-resolve before reading a date, rather than reusing the context it was handed. The only
   * writer is updateConfiguration, whose route returns without reading. A harness that skews a
   * workspace's zone mid-test has the same obligation, and practice-medication-harness 10h does it.
   */
  workspaceTimezone: string;
  roleCodes: string[];
  capabilities: string[];
  entitled: boolean;
  entitlementStatus: string | null;
  onboardingComplete: boolean;
  onboardingStep: string | null;
  /**
   * CPR-SHELL-001 s9 -- "Detect stale or changed membership context".
   *
   * A short digest of the AUTHORISATION-BEARING facts in this context, and nothing else. s9.1 requires
   * that "membership or entitlement changes invalidate or version the active context" and that
   * "background tabs receiving an invalidation event must re-authorise before further writes". Without
   * a single comparable token there is nothing for such a tab to compare: a revoked membership in an
   * open tab was not detectable from the context alone.
   *
   * ⚠ AUTHORISATION FACTS ONLY. The practice's NAME and TIMEZONE are deliberately excluded. Renaming a
   * clinic must not force every open tab to re-authorise -- a version that changed on cosmetic edits
   * would be ignored within a week, which is worse than not having one.
   *
   * ⚠ INPUTS ARE SORTED. PostgREST returns grant rows in no guaranteed order without an ORDER BY, so an
   * unsorted digest would change between two identical reads and every tab would re-authorise on every
   * poll. Sorting is what makes this a fact about the GRANTS rather than about the query plan.
   *
   * ⚠ IT IS OPAQUE ON PURPOSE. Callers COMPARE it; they never parse it. A version whose parts could be
   * read out would become a second, undocumented copy of the capability list -- and the first thing
   * anybody would do with that copy is trust it without re-resolving.
   */
  contextVersion: string;
};

/**
 * The digest itself, exported so a caller can recompute and compare without reaching into the resolver.
 * Not reversible and not meant to be: 16 hex characters is ample to notice a change, and far too little
 * to reconstruct what changed -- which is the point, because "what changed" is a question for a fresh
 * resolve, not for a token held by a client.
 */
/**
 * The version carried by a context that was NEVER RESOLVED FROM A MEMBERSHIP -- the synthetic ones
 * built for an unverified booking request or a patient-facing evaluation, which hold no capability
 * and answer to nobody's grants.
 *
 * ⚠ IT IS A WORD, NOT A DIGEST, AND THAT IS THE SAFEGUARD. Hashing the empty fact set would produce a
 * perfectly stable-looking version, and the first person to compare it against a resolved one would
 * be told "unchanged" about a context that never had anything to change. A value that cannot be
 * mistaken for a digest cannot be compared to one by accident.
 */
export const SYNTHETIC_CONTEXT_VERSION = "synthetic-no-membership";
export function computeContextVersion(facts: {
  workspaceStatus: string;
  membershipIds: string[];
  roleCodes: string[];
  capabilities: string[];
  entitlementStatus: string | null;
  onboardingComplete: boolean;
  onboardingStep: string | null;
}): string {
  const canonical = JSON.stringify({
    workspaceStatus: facts.workspaceStatus,
    membershipIds: [...facts.membershipIds].sort(),
    roleCodes: [...facts.roleCodes].sort(),
    capabilities: [...facts.capabilities].sort(),
    entitlementStatus: facts.entitlementStatus,
    onboardingComplete: facts.onboardingComplete,
    onboardingStep: facts.onboardingStep,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Every ACTIVE membership the user holds, grouped by workspace. */
export async function resolvePracticeAccess(admin: any, userId: string): Promise<PracticeAccess> {
  const { data } = await admin.from("practice_membership")
    // ⚠ timezone RIDES ALONG ON A JOIN THAT WAS ALREADY HAPPENING. It is not an extra query: this
    // select already pulls the workspace row for name/type/status. Before it was here, every screen and
    // engine that needed the practice's day paid its own workspaceClock() read to fetch this one column.
    .select("id, role_code, workspace_id, practice_workspace!workspace_id(id, name, type, status, timezone)")
    .eq("user_id", userId).eq("status", "active");

  const memberships = ((data ?? []) as any[]).map(m => ({
    membershipId: m.id as string,
    workspaceId: m.workspace_id as string,
    workspaceName: (m.practice_workspace?.name ?? "") as string,
    workspaceType: (m.practice_workspace?.type ?? "") as string,
    workspaceStatus: (m.practice_workspace?.status ?? "") as string,
    // "UTC" only when the JOIN failed -- practice_workspace.timezone is `not null` (migration 191), so
    // this is the missing-workspace case, not a missing value. Matches workspaceClock's own fallback.
    workspaceTimezone: (m.practice_workspace?.timezone || "UTC") as string,
    roleCode: m.role_code as string,
  }));

  const byWs = new Map<string, { id: string; name: string; type: string; status: string; roles: string[] }>();
  for (const m of memberships) {
    const w = byWs.get(m.workspaceId) ?? { id: m.workspaceId, name: m.workspaceName, type: m.workspaceType, status: m.workspaceStatus, roles: [] };
    w.roles.push(m.roleCode);
    byWs.set(m.workspaceId, w);
  }
  return { memberships, workspaces: [...byWs.values()] };
}

/**
 * Build the full workspace context for a user + workspace, or say precisely why not.
 * The denial reasons map one-to-one onto SHELL-001 s5.1 loading states so the shell can route.
 */
export async function resolveWorkspaceContext(admin: any, userId: string, workspaceId: string): Promise<
  | { ok: true; ctx: WorkspaceContext }
  | { ok: false; reason: "NO_MEMBERSHIP" | "WORKSPACE_INACTIVE" | "NOT_ENTITLED" }
> {
  const access = await resolvePracticeAccess(admin, userId);
  const mine = access.memberships.filter(m => m.workspaceId === workspaceId);
  if (mine.length === 0) return { ok: false, reason: "NO_MEMBERSHIP" };

  const wsStatus = mine[0].workspaceStatus;
  // ONBOARDING is permitted through (the OnboardingGuard routes it); SUSPENDED/CLOSING/CLOSED are not.
  if (!["ACTIVE", "ONBOARDING", "PROVISIONING"].includes(wsStatus)) return { ok: false, reason: "WORKSPACE_INACTIVE" };

  // Entitlement: an effective active/trial entitlement whose window covers now (PROV-001 s5 access rule).
  //
  // ON THE DATABASE'S CLOCK, for the reason set out against the capability query below. starts_at
  // defaults to the database's now() and provisioning never overrides it, so comparing it against this
  // process's clock made a BRAND NEW PRACTICE read as NOT_ENTITLED for as long as the database ran
  // ahead -- locking somebody out of the workspace they had just created, on their first page load.
  const [{ data: openEnts }, { data: endingEnts }] = await Promise.all([
    admin.from("practice_entitlement").select("status")
      .eq("workspace_id", workspaceId).in("status", ["active", "trial"])
      .lte("starts_at", "now").is("ends_at", null),
    admin.from("practice_entitlement").select("status")
      .eq("workspace_id", workspaceId).in("status", ["active", "trial"])
      .lte("starts_at", "now").gte("ends_at", "now"),
  ]);
  const ents = [...((openEnts ?? []) as any[]), ...((endingEnts ?? []) as any[])];
  if (ents.length === 0) return { ok: false, reason: "NOT_ENTITLED" };

  // CAPABILITY GRANTS ARE TIME-BOUNDED, AND THIS IS WHERE THAT IS ENFORCED (CPR-310).
  //
  // This used to read `.is("effective_to", null)`, which had two consequences nobody had noticed since
  // Phase 0: a grant with an END DATE was invisible even while live -- so every delegation migration
  // 191's schema was designed for would have granted nothing -- and `effective_from` was ignored
  // entirely, so a grant dated to begin next Monday was live the moment it was written. The second is
  // the security-relevant one.
  //
  // COMPARED ON THE DATABASE'S CLOCK, NOT THIS PROCESS'S.
  //
  // This filtering used to run in TypeScript against `new Date()`. `effective_from` defaults to the
  // DATABASE's now(), so on any deployment where the database clock leads the application clock -- ~800ms
  // on the machine this was found on -- a grant made a moment ago read as "starts in the future" and was
  // INVISIBLE. Grant a colleague a capability, watch them reload, watch it not be there. It is the trap
  // this codebase already had written down: never compare an app-clock timestamp against a DB-clock one.
  //
  // TWO QUERIES RATHER THAN AN OR ACROSS A NULL TEST. The predicate wanted is
  // `effective_from <= now and (effective_to is null or effective_to > now)`, and PostgREST's or-filter
  // with a null test is the exact shape this codebase has twice written in a way that quietly matched
  // every row. Two unambiguous queries beat one clever one. The string 'now' is a Postgres timestamp
  // literal, so both comparisons are evaluated server-side on the database's own clock.
  const membershipIds = mine.map(m => m.membershipId);
  const [{ data: openGrants }, { data: endingGrants }] = await Promise.all([
    admin.from("practice_role_assignment").select("capability_code")
      .in("membership_id", membershipIds).lte("effective_from", "now").is("effective_to", null),
    admin.from("practice_role_assignment").select("capability_code")
      .in("membership_id", membershipIds).lte("effective_from", "now").gt("effective_to", "now"),
  ]);
  const caps = [...((openGrants ?? []) as any[]), ...((endingGrants ?? []) as any[])];

  const { data: ob } = await admin.from("practice_onboarding")
    .select("state, current_step").eq("workspace_id", workspaceId).eq("user_id", userId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  // ⚠ BUILT ONCE, THEN HASHED. The version is computed from THESE values, not from a second read --
  // a re-query could return a different state and produce a version describing a context nobody holds.
  const roleCodes = mine.map(m => m.roleCode);
  const capabilities = [...new Set(((caps ?? []) as any[]).map(c => c.capability_code as string))];
  const entitlementStatus = ((ents ?? []) as any[])[0]?.status ?? null;
  const onboardingComplete = wsStatus === "ACTIVE" && (!ob || ob.state === "completed");
  const onboardingStep = ob?.state === "in_progress" ? (ob.current_step as string) : null;

  return {
    ok: true,
    ctx: {
      userId, workspaceId,
      workspaceName: mine[0].workspaceName,
      workspaceType: mine[0].workspaceType,
      workspaceStatus: wsStatus,
      workspaceTimezone: mine[0].workspaceTimezone,
      roleCodes,
      capabilities,
      entitled: true,
      entitlementStatus,
      onboardingComplete,
      onboardingStep,
      contextVersion: computeContextVersion({
        workspaceStatus: wsStatus, membershipIds, roleCodes, capabilities,
        entitlementStatus, onboardingComplete, onboardingStep,
      }),
    },
  };
}

export const hasCapability = (ctx: WorkspaceContext, cap: string) => ctx.capabilities.includes(cap);

/** The cookie is a PREFERENCE, not an authority: always pass its value through resolveWorkspaceContext. */
export async function readActiveWorkspaceId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACTIVE_WS_COOKIE)?.value ?? null;
}
