import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeAccess, resolveWorkspaceContext, readActiveWorkspaceId, type WorkspaceContext } from "@/lib/practice/access";

// Server-side shell resolution (CPR-SHELL-001 sections 5, 5.1 and 6.1).
//
// One function answers, for any authenticated Practice page, the question the guards ask IN ORDER --
// authentication, workspace, membership, workspace status, entitlement, onboarding -- and returns a
// discriminated union that maps one-to-one onto SHELL-001 s5.1 loading states. Pages switch on the state
// and redirect; they never re-derive access themselves, which is how guard order stays uniform across
// every route instead of being re-implemented slightly differently per page.
//
// The active-workspace COOKIE IS A PREFERENCE. It picks which workspace to try first; the resolution
// below re-validates it and falls back to the user's real memberships, so a stale cookie (workspace
// closed, membership revoked) degrades to the chooser rather than granting anything.

export type ShellState =
  | { state: "AUTH_REQUIRED" }
  | { state: "WORKSPACE_REQUIRED"; userId: string }
  | { state: "CHOOSER_REQUIRED"; userId: string; workspaces: { id: string; name: string; status: string }[] }
  | { state: "ONBOARDING_REQUIRED"; userId: string; ctx: WorkspaceContext }
  | { state: "ACCESS_RESTRICTED"; userId: string; reason: "WORKSPACE_INACTIVE" | "NOT_ENTITLED"; workspaceId: string }
  | { state: "READY"; userId: string; ctx: WorkspaceContext };

export async function resolvePracticeShell(): Promise<ShellState> {
  // Guard 1: authentication (central Competen identity -- IAM-ADR-01, no separate Practice auth).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "AUTH_REQUIRED" };

  const admin = createAdminClient();

  // Guards 2-3: workspace resolution and membership.
  const access = await resolvePracticeAccess(admin, user.id);
  if (access.workspaces.length === 0) return { state: "WORKSPACE_REQUIRED", userId: user.id };

  // Pick the workspace: validated cookie preference, else the only one, else the chooser (SHELL-001 s8).
  const preferred = await readActiveWorkspaceId();
  let workspaceId: string | null = null;
  if (preferred && access.workspaces.some(w => w.id === preferred)) workspaceId = preferred;
  else if (access.workspaces.length === 1) workspaceId = access.workspaces[0].id;
  if (!workspaceId) {
    return {
      state: "CHOOSER_REQUIRED", userId: user.id,
      workspaces: access.workspaces.map(w => ({ id: w.id, name: w.name, status: w.status })),
    };
  }

  // Guards 4-5: workspace status and entitlement.
  const res = await resolveWorkspaceContext(admin, user.id, workspaceId);
  if (!res.ok) {
    if (res.reason === "NO_MEMBERSHIP") return { state: "WORKSPACE_REQUIRED", userId: user.id };
    return { state: "ACCESS_RESTRICTED", userId: user.id, reason: res.reason, workspaceId };
  }

  // Guard 6: onboarding completion.
  if (res.ctx.workspaceStatus !== "ACTIVE") return { state: "ONBOARDING_REQUIRED", userId: user.id, ctx: res.ctx };

  return { state: "READY", userId: user.id, ctx: res.ctx };
}

/** Is any active Practice membership present at all? Used by the auth-aware public /practice index. */
export async function hasPracticeMembership(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const admin = createAdminClient();
  const access = await resolvePracticeAccess(admin, user.id);
  return access.workspaces.length > 0;
}
