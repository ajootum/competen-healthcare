import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { resolveWorkspaceContext } from "@/lib/practice/access";

// GET /api/v1/practice/workspaces/{workspaceId}/access (IAM-001 s12 getAccessStatus/resolve).
//
// DENIALS ARE ENUMERATION-SAFE: a workspace the caller has no membership in answers exactly like one
// that does not exist (404, no detail). Whether an id is real is itself protected information
// (IAM-001 s11, SHELL-001 s6.2).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { workspaceId } = await params;

  const res = await resolveWorkspaceContext(c.admin, c.userId, workspaceId);
  if (!res.ok) {
    if (res.reason === "NO_MEMBERSHIP") return NextResponse.json({ error: "Not found" }, { status: 404 });
    // A member of a restricted workspace may know its state -- that is what /practice/access-status shows.
    return NextResponse.json({
      access: "restricted", reason: res.reason, correlationId: c.traceId,
    }, { status: 200 });
  }
  return NextResponse.json({ access: "granted", context: res.ctx, correlationId: c.traceId });
}
