/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan, landlordAudit } from "@/lib/platform/landlord";

// POST /api/platform/identity — upsert a tenant's IdP config (LCP-001 §19).
const PROTOCOLS = ["saml", "oidc", "oauth"];
export async function POST(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "security_operator")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!b?.tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  const protocol = PROTOCOLS.includes(b.protocol) ? b.protocol : "saml";

  const { data: t } = await caller.admin.from("tenants").select("id, name").eq("id", b.tenantId).maybeSingle();
  if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 400 });

  const { error } = await caller.admin.from("plat_idp_configs").upsert({
    tenant_id: b.tenantId, protocol, provider: b.provider ? String(b.provider) : null,
    mfa_required: b.mfaRequired === true, scim_enabled: b.scimEnabled === true,
    is_active: b.isActive === true, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await landlordAudit(caller.admin, caller, { action: "idp_config_set", entity_type: "idp_config", entity_id: b.tenantId, entity_name: t.name, tenant_id: b.tenantId, new_value: { protocol, provider: b.provider ?? null, mfa: b.mfaRequired === true } });
  return NextResponse.json({ ok: true });
}
