import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { FACILITY_TYPES, FACILITY_STATUSES } from "@/lib/enterprise/facilities";

// Facilities module (ENT-001 §3) — create / edit / lifecycle. Super_admin only.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TIERS = ["free", "professional", "enterprise"];
const clean = (v: any, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function assertExists(admin: any, table: string, id: any, label: string) {
  if (id === undefined) return undefined as any;
  if (id === null || id === "") return null;
  const { data } = await admin.from(table).select("id").eq("id", id).maybeSingle();
  if (!data) return badRequest(`${label} not found`);
  return id;
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!clean(b.name)) return badRequest("name required");

  const org = await assertExists(admin, "organisations", b.organisation_id, "Organisation");
  if (isResponse(org)) return org;
  const director = await assertExists(admin, "profiles", b.director_id, "Director");
  if (isResponse(director)) return director;

  const insert: any = {
    name: clean(b.name), facility_code: clean(b.facility_code, 40),
    type: FACILITY_TYPES.includes(b.type) ? b.type : "hospital",
    country: clean(b.country, 80) ?? "Kenya", city: clean(b.city, 80),
    tier: TIERS.includes(b.tier) ? b.tier : "free",
    status: FACILITY_STATUSES.includes(b.status) ? b.status : "onboarding",
  };
  if (org !== undefined) insert.organisation_id = org;
  if (director !== undefined) insert.director_id = director;

  const { data, error } = await admin.from("hospitals").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_facility", entity_type: "facility", entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("hospitals").select("id, name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.facility_code !== undefined) update.facility_code = clean(b.facility_code, 40);
  if (b.type !== undefined && FACILITY_TYPES.includes(b.type)) update.type = b.type;
  if (b.country !== undefined) update.country = clean(b.country, 80);
  if (b.city !== undefined) update.city = clean(b.city, 80);
  if (b.tier !== undefined && TIERS.includes(b.tier)) update.tier = b.tier;
  if (b.status !== undefined) { if (!FACILITY_STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  for (const [field, table, label] of [["organisation_id", "organisations", "Organisation"], ["director_id", "profiles", "Director"], ["admin_id", "profiles", "Administrator"]] as const) {
    if (b[field] !== undefined) { const v = await assertExists(admin, table, b[field], label); if (isResponse(v)) return v; update[field] = v; }
  }
  if (!Object.keys(update).length) return badRequest("no valid fields");

  const { data, error } = await admin.from("hospitals").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const act = update.status ? `facility_${update.status}` : "update_facility";
  await admin.from("audit_log").insert({ actor_id: c.userId, action: act, entity_type: "facility", entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
