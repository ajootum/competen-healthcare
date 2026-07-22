import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Licensing & Subscription (POP-001 §5) — plan CRUD. Super_admin only.
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: any) => { if (v === "" || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const slugCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function entitlements(b: any): any {
  return {
    max_users: num(b.max_users), ai_credits: num(b.ai_credits), storage_gb: num(b.storage_gb),
    max_hospitals: num(b.max_hospitals), api_access: !!b.api_access,
  };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("name required");
  const code = clean(b.code, 40) ? slugCode(b.code) : slugCode(name);

  const insert = {
    code, name, price_monthly: num(b.price_monthly) ?? 0, currency: (clean(b.currency, 3) ?? "USD").toUpperCase().slice(0, 3),
    entitlements: entitlements(b), is_active: b.is_active === undefined ? true : !!b.is_active,
    sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 100,
  };
  const { data, error } = await admin.from("plat_plans").insert(insert).select().single();
  if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? "A plan with this code already exists" : error.message }, { status: 400 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_plan", entity_type: "plan", entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("plat_plans").select("id, name, entitlements").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.price_monthly !== undefined) update.price_monthly = num(b.price_monthly) ?? 0;
  if (b.currency !== undefined) update.currency = (clean(b.currency, 3) ?? "USD").toUpperCase().slice(0, 3);
  if (b.is_active !== undefined) update.is_active = !!b.is_active;
  // Entitlements are merged so a partial edit doesn't wipe unset limits.
  if (["max_users", "ai_credits", "storage_gb", "max_hospitals", "api_access"].some(k => b[k] !== undefined)) {
    update.entitlements = { ...(row.entitlements ?? {}), ...entitlements(b) };
  }
  if (!Object.keys(update).length) return badRequest("no valid fields");
  const { data, error } = await admin.from("plat_plans").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "update_plan", entity_type: "plan", entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
