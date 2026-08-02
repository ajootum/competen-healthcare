import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { resolveWorkspaceContext, ACTIVE_WS_COOKIE } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";

// POST /api/v1/practice/workspaces/{workspaceId}/activate (IAM-001 s12 switchWorkspace, SHELL-001 s11).
//
// The cookie set here is a PREFERENCE only -- every subsequent request re-validates it through
// resolveWorkspaceContext, so activating a workspace the caller is later removed from decays safely
// (SHELL-001 s9.1). A failed switch changes nothing: the cookie is written only after validation.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { workspaceId } = await params;

  const res = await resolveWorkspaceContext(c.admin, c.userId, workspaceId);
  if (!res.ok) {
    if (res.reason === "NO_MEMBERSHIP") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: { code: res.reason, correlationId: c.traceId } }, { status: 403 });
  }

  await audit(c.admin, { workspaceId, actorId: c.userId, eventType: "practice.workspace_activated", correlationId: c.traceId });

  const out = NextResponse.json({ activated: workspaceId, context: res.ctx, correlationId: c.traceId });
  out.cookies.set(ACTIVE_WS_COOKIE, workspaceId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return out;
}
