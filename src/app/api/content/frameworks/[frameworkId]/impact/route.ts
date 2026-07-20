import { NextResponse } from "next/server";
import { frameworkImpact } from "@/lib/engines/impact";
import { getCaller, isResponse, forbidden, isEducator, assertFrameworkScope } from "@/lib/api-auth";

export async function GET(_req: Request, { params }: { params: Promise<{ frameworkId: string }> }) {
  const { frameworkId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  // Tenant scope: the framework must be in the caller's hospital (or the shared
  // master library, which is readable). super_admin is unrestricted.
  const scopeErr = await assertFrameworkScope(c, frameworkId);
  if (scopeErr) return scopeErr;

  const report = await frameworkImpact(c.admin, frameworkId);
  return NextResponse.json(report);
}
