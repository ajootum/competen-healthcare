import { cookies, headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeAccess, resolveWorkspaceContext, readActiveWorkspaceId, type WorkspaceContext } from "@/lib/practice/access";
import { touchSession, getSecurityPolicy } from "@/lib/practice/security";

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
  // CPR-370 (migration 213). Two more refusals, both AFTER entitlement and onboarding so they can never
  // mask a more basic problem: a revoked device, and a practice that requires a second factor.
  | { state: "SESSION_REVOKED"; userId: string; reason: "revoked" | "idle"; workspaceId: string }
  | { state: "MFA_REQUIRED"; userId: string; workspaceId: string; enrolled: boolean }
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

  // ── Guards 7-8: the device register and the practice's MFA policy (CPR-370, migration 213) ────────
  //
  // THIS IS WHAT MAKES "SIGN OUT THIS DEVICE" REAL. Revoking a session row does not end the platform
  // auth token -- nothing in this product can -- but it is checked HERE, on every request, so a revoked
  // device is refused by the practice on its very next page load. A revocation that were merely
  // cosmetic would be the most dangerous thing CPR-370 could ship: somebody would press it after losing
  // a laptop and stop worrying.
  //
  // touchSession never throws and returns `allowed` on any internal error, deliberately: a bookkeeping
  // failure must not lock a clinician out of a clinical record.
  const deviceId = await readOrIssueDeviceId();
  const session = await touchSession(admin, {
    workspaceId: res.ctx.workspaceId, userId: user.id, deviceId,
    userAgent: (await headers()).get("user-agent"),
  });
  if (!session.allowed) {
    return { state: "SESSION_REVOKED", userId: user.id, reason: session.reason ?? "revoked", workspaceId: res.ctx.workspaceId };
  }

  // MFA IS THE PLATFORM'S TO ENFORCE; what this product can do is refuse to OPEN the practice without
  // it. Checked only when the practice has asked for it, so no existing workspace is locked out by a
  // migration -- and it routes to enrolment rather than to a dead end.
  const policy = await getSecurityPolicy(admin, res.ctx.workspaceId);
  if (policy.mfa_required) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel !== "aal2") {
      return { state: "MFA_REQUIRED", userId: user.id, workspaceId: res.ctx.workspaceId, enrolled: aal.nextLevel === "aal2" };
    }
  }

  return { state: "READY", userId: user.id, ctx: res.ctx };
}

/**
 * The device identifier: a random value THIS PRODUCT SET, not a fingerprint.
 *
 * A fingerprint would identify a person across contexts they did not consent to; a cookie identifies a
 * browser that chose to sign in here, and clearing it honestly produces a new device.
 *
 * Read-only in a Server Component: `cookies().set` throws outside a route handler or action, so a first
 * visit gets a per-request identifier and the cookie is planted by the API the client calls. The device
 * list is therefore best-effort until then, which is stated on the page rather than papered over.
 */
async function readOrIssueDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get("practice_device")?.value;
  if (existing) return existing;
  try {
    jar.set("practice_device", crypto.randomUUID(), {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 365,
    });
    return jar.get("practice_device")?.value ?? crypto.randomUUID();
  } catch {
    return crypto.randomUUID();
  }
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
