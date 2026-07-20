import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan } from "@/lib/platform/landlord";
import { changeSubscription } from "@/lib/platform/commercial";

// POST /api/platform/tenants/[id]/subscription — assign/change a tenant's plan (LCP-001 §4).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "finance")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { planCode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!body?.planCode) return NextResponse.json({ error: "planCode is required" }, { status: 400 });

  const r = await changeSubscription(caller.admin, { userId: caller.userId, fullName: caller.fullName }, id, String(body.planCode));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
