import { NextResponse } from "next/server";
import { getCaller, isResponse, type Caller } from "@/lib/api-auth";
import { resolveWorkspaceContext, readActiveWorkspaceId, resolvePracticeAccess, hasCapability, type WorkspaceContext } from "@/lib/practice/access";

// The one way a /api/v1/practice route obtains its workspace context (SHELL-001 s9: context is
// established server-side; the client's cookie is a preference that is re-validated here on every
// request). Mirrors resolvePracticeShell's guard order for APIs: authentication, workspace, membership,
// status, entitlement -- and then the CAPABILITY the route declares, because API enforcement must not
// rely on the sidebar having hidden a button (SHELL-001 s15 "route protection must exist on the
// server/API, not only in the client").

export type PracticeApiContext = { caller: Caller; ctx: WorkspaceContext };

export async function requirePracticeContext(capability: string | null): Promise<PracticeApiContext | NextResponse> {
  const c = await getCaller();
  if (isResponse(c)) return c;

  const preferred = await readActiveWorkspaceId();
  let workspaceId = preferred;
  if (!workspaceId) {
    const access = await resolvePracticeAccess(c.admin, c.userId);
    if (access.workspaces.length === 1) workspaceId = access.workspaces[0].id;
    else if (access.workspaces.length === 0) return NextResponse.json({ error: "No Practice workspace" }, { status: 403 });
    else return NextResponse.json({ error: "Select a workspace first", code: "WORKSPACE_CHOICE_REQUIRED" }, { status: 409 });
  }

  const res = await resolveWorkspaceContext(c.admin, c.userId, workspaceId);
  if (!res.ok) {
    if (res.reason === "NO_MEMBERSHIP") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: res.reason }, { status: 403 });
  }
  if (capability && !hasCapability(res.ctx, capability)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { caller: c, ctx: res.ctx };
}

export const isDenied = (x: unknown): x is NextResponse => x instanceof NextResponse;
