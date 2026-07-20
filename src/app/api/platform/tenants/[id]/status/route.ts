import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan } from "@/lib/platform/landlord";
import { changeTenantStatus } from "@/lib/platform/commercial";

// POST /api/platform/tenants/[id]/status — tenant lifecycle transition (LCP-001 §3).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { status?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!body?.status) return NextResponse.json({ error: "status is required" }, { status: 400 });

  const r = await changeTenantStatus(caller.admin, { userId: caller.userId, fullName: caller.fullName }, id, String(body.status), body.reason ?? null);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
