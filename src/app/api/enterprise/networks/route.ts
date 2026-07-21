import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Networks & Enterprise Groups module (ENT-001 §2) — create / edit networks
// (the `enterprises` table) and manage member organisations. Super_admin only.
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!clean(b.name)) return badRequest("name required");

  // enterprises.tenant_id is NOT NULL; default to the caller's tenant, else the
  // first tenant. Without one we cannot create a network — say so honestly.
  const { data: me } = await admin.from("profiles").select("tenant_id").eq("id", c.userId).maybeSingle();
  let tenantId: string | null = me?.tenant_id ?? null;
  if (!tenantId) { const { data: t } = await admin.from("tenants").select("id").limit(1).maybeSingle(); tenantId = t?.id ?? null; }
  if (!tenantId) return badRequest("No tenant available to own this network");

  const insert = { tenant_id: tenantId, name: clean(b.name), health_system_type: clean(b.type, 60), hq_country: clean(b.hq_country, 80), is_active: true };
  const { data, error } = await admin.from("enterprises").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_network", entity_type: "enterprise", entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("enterprises").select("id, name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  // Member management: attach / detach an organisation to this network.
  if (b.action === "add_member" || b.action === "remove_member") {
    if (!b.org_id) return badRequest("org_id required");
    const { data: org } = await admin.from("organisations").select("id").eq("id", b.org_id).maybeSingle();
    if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    const { error } = await admin.from("organisations").update({ enterprise_id: b.action === "add_member" ? id : null }).eq("id", b.org_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: b.action, entity_type: "enterprise", entity_id: id, entity_name: row.name });
    return NextResponse.json({ ok: true });
  }

  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.type !== undefined) update.health_system_type = clean(b.type, 60);
  if (b.hq_country !== undefined) update.hq_country = clean(b.hq_country, 80);
  if (b.is_active !== undefined) update.is_active = !!b.is_active;
  if (!Object.keys(update).length) return badRequest("no valid fields");

  const { data, error } = await admin.from("enterprises").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "update_network", entity_type: "enterprise", entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
