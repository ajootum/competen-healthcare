import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan } from "@/lib/platform/landlord";
import { setFlagAssignment } from "@/lib/platform/commercial";

// POST /api/platform/flags/assign — set a feature-flag assignment (LCP-001 §9).
export async function POST(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "product_manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { flagKey?: string; scopeType?: string; scopeRef?: string; enabled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!body?.flagKey || !body?.scopeType) return NextResponse.json({ error: "flagKey and scopeType are required" }, { status: 400 });

  const r = await setFlagAssignment(caller.admin, { userId: caller.userId, fullName: caller.fullName }, {
    flagKey: String(body.flagKey), scopeType: String(body.scopeType), scopeRef: body.scopeRef ?? null, enabled: body.enabled !== false,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
