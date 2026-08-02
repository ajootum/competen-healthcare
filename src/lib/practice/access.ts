import { cookies } from "next/headers";

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
  roleCodes: string[];
  capabilities: string[];
  entitled: boolean;
  entitlementStatus: string | null;
  onboardingComplete: boolean;
  onboardingStep: string | null;
};

/** Every ACTIVE membership the user holds, grouped by workspace. */
export async function resolvePracticeAccess(admin: any, userId: string): Promise<PracticeAccess> {
  const { data } = await admin.from("practice_membership")
    .select("id, role_code, workspace_id, practice_workspace!workspace_id(id, name, type, status)")
    .eq("user_id", userId).eq("status", "active");

  const memberships = ((data ?? []) as any[]).map(m => ({
    membershipId: m.id as string,
    workspaceId: m.workspace_id as string,
    workspaceName: (m.practice_workspace?.name ?? "") as string,
    workspaceType: (m.practice_workspace?.type ?? "") as string,
    workspaceStatus: (m.practice_workspace?.status ?? "") as string,
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
  const nowIso = new Date().toISOString();
  const { data: ents } = await admin.from("practice_entitlement")
    .select("status, starts_at, ends_at").eq("workspace_id", workspaceId).in("status", ["active", "trial"]);
  const entitled = ((ents ?? []) as any[]).some(e => e.starts_at <= nowIso && (!e.ends_at || e.ends_at >= nowIso));
  if (!entitled) return { ok: false, reason: "NOT_ENTITLED" };

  const { data: caps } = await admin.from("practice_role_assignment")
    .select("capability_code, membership_id")
    .in("membership_id", mine.map(m => m.membershipId))
    .is("effective_to", null);

  const { data: ob } = await admin.from("practice_onboarding")
    .select("state, current_step").eq("workspace_id", workspaceId).eq("user_id", userId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  return {
    ok: true,
    ctx: {
      userId, workspaceId,
      workspaceName: mine[0].workspaceName,
      workspaceType: mine[0].workspaceType,
      workspaceStatus: wsStatus,
      roleCodes: mine.map(m => m.roleCode),
      capabilities: [...new Set(((caps ?? []) as any[]).map(c => c.capability_code as string))],
      entitled: true,
      entitlementStatus: ((ents ?? []) as any[])[0]?.status ?? null,
      onboardingComplete: wsStatus === "ACTIVE" && (!ob || ob.state === "completed"),
      onboardingStep: ob?.state === "in_progress" ? (ob.current_step as string) : null,
    },
  };
}

export const hasCapability = (ctx: WorkspaceContext, cap: string) => ctx.capabilities.includes(cap);

/** The cookie is a PREFERENCE, not an authority: always pass its value through resolveWorkspaceContext. */
export async function readActiveWorkspaceId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACTIVE_WS_COOKIE)?.value ?? null;
}
