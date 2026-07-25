import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// PCS-PORT-001 admin CRUD — no-code management of the product-portfolio hierarchy + licensing (migration 105).
// Super-admin only (platform config). POST create / PATCH update / DELETE remove, discriminated by `type`:
// portfolio | suite | product | mapping (product↔workspace) | license (tenant↔product). Each write is audited.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABLE: Record<string, string> = { portfolio: "product_portfolios", suite: "product_suites", product: "products" };
const str = (v: any, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : null);

async function audit(c: any, action: string, type: string, id: string | null, val: any) {
  try { const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle(); await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action, entity_type: `pcs_${type}`, entity_id: id, new_value: val }); } catch { /* fail-soft */ }
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const type = b.type;

  try {
    if (type === "portfolio") {
      if (!str(b.name)) return badRequest("name required");
      const { data, error } = await admin.from("product_portfolios").insert({ name: str(b.name), description: str(b.description, 500) }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_create", "portfolio", data.id, { name: b.name }); return NextResponse.json(data, { status: 201 });
    }
    if (type === "suite") {
      if (!str(b.name) || !b.portfolio_id) return badRequest("name + portfolio_id required");
      const { data, error } = await admin.from("product_suites").insert({ portfolio_id: b.portfolio_id, name: str(b.name), code: str(b.code, 40), icon: str(b.icon, 8), color: str(b.color, 16), visibility: ["public", "internal", "hidden"].includes(b.visibility) ? b.visibility : "internal", sort_order: Number(b.sort_order) || 0 }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_create", "suite", data.id, { name: b.name }); return NextResponse.json(data, { status: 201 });
    }
    if (type === "product") {
      if (!str(b.name)) return badRequest("name required");
      const { data, error } = await admin.from("products").insert({ suite_id: b.suite_id ?? null, name: str(b.name), code: str(b.code, 40), version: str(b.version, 20) ?? "1.0", license_type: ["included", "licensed", "trial", "addon"].includes(b.license_type) ? b.license_type : "licensed" }).select("id").single();
      if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? "A product with that code already exists" : error.message }, { status: 400 });
      await audit(c, "pcs_create", "product", data.id, { name: b.name, code: b.code }); return NextResponse.json(data, { status: 201 });
    }
    if (type === "mapping") {
      if (!b.product_id || !str(b.workspace_key, 80)) return badRequest("product_id + workspace_key required");
      const { error } = await admin.from("product_workspaces").insert({ product_id: b.product_id, workspace_key: str(b.workspace_key, 80) });
      if (error && !/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_map", "mapping", b.product_id, { workspace_key: b.workspace_key }); return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (type === "license") {
      if (!b.tenant_id || !b.product_id) return badRequest("tenant_id + product_id required");
      const { error } = await admin.from("tenant_product_licenses").upsert({ tenant_id: b.tenant_id, product_id: b.product_id, status: "active" }, { onConflict: "tenant_id,product_id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_license_grant", "license", b.product_id, { tenant_id: b.tenant_id }); return NextResponse.json({ ok: true }, { status: 201 });
    }
    return badRequest("unknown type");
  } catch (e: any) { return NextResponse.json({ error: String(e?.message ?? "error") }, { status: 500 }); }
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const table = TABLE[b.type];
  if (!table || !b.id) return badRequest("type + id required");
  const patch: any = {};
  for (const k of ["name", "description", "code", "icon", "color", "visibility", "status", "version", "license_type", "suite_id", "sort_order"]) if (k in b) patch[k] = b[k];
  if (!Object.keys(patch).length) return badRequest("no fields");
  const { error } = await admin.from(table).update(patch).eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(c, "pcs_update", b.type, b.id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const u = new URL(req.url);
  const type = u.searchParams.get("type"), id = u.searchParams.get("id");

  if (type === "mapping") {
    const pid = u.searchParams.get("product_id"), wk = u.searchParams.get("workspace_key");
    if (!pid || !wk) return badRequest("product_id + workspace_key required");
    await admin.from("product_workspaces").delete().eq("product_id", pid).eq("workspace_key", wk);
    await audit(c, "pcs_unmap", "mapping", pid, { workspace_key: wk }); return NextResponse.json({ ok: true });
  }
  if (type === "license") {
    const tid = u.searchParams.get("tenant_id"), pid = u.searchParams.get("product_id");
    if (!tid || !pid) return badRequest("tenant_id + product_id required");
    await admin.from("tenant_product_licenses").delete().eq("tenant_id", tid).eq("product_id", pid);
    await audit(c, "pcs_license_revoke", "license", pid, { tenant_id: tid }); return NextResponse.json({ ok: true });
  }
  // Archive (soft) for portfolio/suite/product.
  const table = TABLE[type ?? ""];
  if (!table || !id) return badRequest("type + id required");
  const { error } = await admin.from(table).update({ status: "archived" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(c, "pcs_archive", type!, id, null);
  return NextResponse.json({ ok: true });
}
