import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { resolvePracticeAccess } from "@/lib/practice/access";

// GET /api/v1/practice/workspaces -- the caller's own authorised Practice workspaces (PROV-001 s10).
// Membership-derived, never role-derived (IAM-ADR-04), and never a list of all workspaces: there is no
// "browse practices" surface, and enumeration resistance (IAM-001 s11) starts with this endpoint.
export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const access = await resolvePracticeAccess(c.admin, c.userId);
  return NextResponse.json({ workspaces: access.workspaces, correlationId: c.traceId });
}
