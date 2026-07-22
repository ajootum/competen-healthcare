import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { TENANT_TYPES, TENANT_STATUSES } from "@/lib/platform/tenants";

// Tenant Operations (POP-001 §2) — create / lifecycle / plan assignment / seats /
// per-tenant feature toggles. Platform-level surface: super_admin only.
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const rand = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("name required");

  const insert: any = {
    name, slug: `${slugify(name) || "tenant"}-${rand()}`,
    tenant_type: TENANT_TYPES.includes(b.tenant_type) ? b.tenant_type : "hospital",
    status: TENANT_STATUSES.includes(b.status) ? b.status : "trial",
    primary_country: clean(b.primary_country, 80), currency: (clean(b.currency, 3) ?? "USD").toUpperCase().slice(0, 3),
  };
  const { data, error } = await admin.from("tenants").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optionally attach an initial plan (subscription).
  if (b.plan_id) {
    const { data: plan } = await admin.from("plat_plans").select("id").eq("id", b.plan_id).maybeSingle();
    if (plan) await admin.from("plat_subscriptions").insert({ tenant_id: data.id, plan_id: b.plan_id, status: insert.status === "trial" ? "trialing" : "active", seats_purchased: b.seats ?? null });
  }
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_tenant", entity_type: "tenant", entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("tenants").select("id, name, status").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  // Per-tenant feature flag override.
  if (b.action === "toggle_feature") {
    if (!clean(b.flag_key)) return badRequest("flag_key required");
    const { data: flag } = await admin.from("plat_feature_flags").select("key").eq("key", b.flag_key).maybeSingle();
    if (!flag) return badRequest("Feature flag not found");
    const enabled = !!b.enabled;
    const { data: existing } = await admin.from("plat_feature_flag_assignments").select("id").eq("flag_key", b.flag_key).eq("scope_type", "tenant").eq("scope_ref", id).maybeSingle();
    if (existing) await admin.from("plat_feature_flag_assignments").update({ enabled }).eq("id", existing.id);
    else await admin.from("plat_feature_flag_assignments").insert({ flag_key: b.flag_key, scope_type: "tenant", scope_ref: id, enabled, created_by: c.userId });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: `feature_${enabled ? "enabled" : "disabled"}`, entity_type: "tenant", entity_id: id, entity_name: row.name });
    return NextResponse.json({ ok: true, flag_key: b.flag_key, enabled });
  }

  // Assign / change plan (upsert the tenant's live subscription).
  if (b.action === "assign_plan") {
    if (!b.plan_id) return badRequest("plan_id required");
    const { data: plan } = await admin.from("plat_plans").select("id").eq("id", b.plan_id).maybeSingle();
    if (!plan) return badRequest("Plan not found");
    const { data: sub } = await admin.from("plat_subscriptions").select("id").eq("tenant_id", id).in("status", ["active", "trialing"]).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (sub) await admin.from("plat_subscriptions").update({ plan_id: b.plan_id, ...(b.seats !== undefined ? { seats_purchased: b.seats } : {}) }).eq("id", sub.id);
    else await admin.from("plat_subscriptions").insert({ tenant_id: id, plan_id: b.plan_id, status: "active", seats_purchased: b.seats ?? null });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "assign_plan", entity_type: "tenant", entity_id: id, entity_name: row.name });
    return NextResponse.json({ ok: true });
  }

  // Lifecycle / attribute update.
  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.status !== undefined) { if (!TENANT_STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  if (b.primary_country !== undefined) update.primary_country = clean(b.primary_country, 80);
  if (!Object.keys(update).length) return badRequest("no valid fields");
  const { data, error } = await admin.from("tenants").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const act = update.status ? `tenant_${update.status}` : "update_tenant";
  await admin.from("audit_log").insert({ actor_id: c.userId, action: act, entity_type: "tenant", entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
