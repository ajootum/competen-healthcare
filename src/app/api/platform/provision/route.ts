import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan } from "@/lib/platform/landlord";
import { provisionTenant, type ProvisionInput } from "@/lib/platform/provisioning";

// POST /api/platform/provision — Tenant Provisioning Engine (LCP-001 §2).
// Landlord-only (platform_operations / owner, or transitional super_admin).
export async function POST(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Partial<ProvisionInput>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!body?.name || !body?.templateCode) return NextResponse.json({ error: "name and templateCode are required" }, { status: 400 });

  const result = await provisionTenant(caller.admin, { userId: caller.userId, fullName: caller.fullName }, {
    name: String(body.name), templateCode: String(body.templateCode),
    country: body.country ? String(body.country) : null,
    status: body.status === "active" ? "active" : "trial",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
