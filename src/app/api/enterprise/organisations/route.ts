import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { ORG_STATUSES, ORG_TYPES } from "@/lib/enterprise/organisations";

// Organisations module (ENT-001 §1) — create / edit / lifecycle. Enterprise
// Administration is a platform-level surface, so writes require super_admin
// (matches the page gate). Fields are whitelisted; status is validated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function assertNetwork(admin: any, enterpriseId: any): Promise<string | null | NextResponse> {
  if (enterpriseId === undefined) return undefined as any;
  if (enterpriseId === null || enterpriseId === "") return null;
  const { data } = await admin.from("enterprises").select("id").eq("id", enterpriseId).maybeSingle();
  if (!data) return badRequest("Network not found");
  return enterpriseId;
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!clean(b.name)) return badRequest("name required");

  const network = await assertNetwork(admin, b.enterprise_id);
  if (isResponse(network)) return network;

  const insert: any = {
    name: clean(b.name), legal_name: clean(b.legal_name), org_code: clean(b.org_code, 40),
    type: ORG_TYPES.includes(b.type) ? b.type : "private",
    hq_country: clean(b.hq_country, 80) ?? "Kenya", region: clean(b.region, 80),
    website: clean(b.website), email: clean(b.email), phone: clean(b.phone, 40), description: clean(b.description, 500),
    status: ORG_STATUSES.includes(b.status) ? b.status : "onboarding",
  };
  if (network !== undefined) insert.enterprise_id = network;

  const { data, error } = await admin.from("organisations").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_organisation", entity_type: "organisation", entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("organisations").select("id, name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.legal_name !== undefined) update.legal_name = clean(b.legal_name);
  if (b.org_code !== undefined) update.org_code = clean(b.org_code, 40);
  if (b.type !== undefined && ORG_TYPES.includes(b.type)) update.type = b.type;
  if (b.hq_country !== undefined) update.hq_country = clean(b.hq_country, 80);
  if (b.region !== undefined) update.region = clean(b.region, 80);
  if (b.website !== undefined) update.website = clean(b.website);
  if (b.email !== undefined) update.email = clean(b.email);
  if (b.phone !== undefined) update.phone = clean(b.phone, 40);
  if (b.description !== undefined) update.description = clean(b.description, 500);
  if (b.status !== undefined) { if (!ORG_STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  if (b.enterprise_id !== undefined) {
    const network = await assertNetwork(admin, b.enterprise_id);
    if (isResponse(network)) return network;
    update.enterprise_id = network;
  }
  if (!Object.keys(update).length) return badRequest("no valid fields");

  const { data, error } = await admin.from("organisations").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const act = update.status ? `organisation_${update.status}` : "update_organisation";
  await admin.from("audit_log").insert({ actor_id: c.userId, action: act, entity_type: "organisation", entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
