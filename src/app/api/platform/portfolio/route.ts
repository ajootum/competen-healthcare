import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

import { currentTraceId } from "@/lib/trace";
// PCS-PORT-001 admin CRUD — no-code management of the packaging hierarchy + licensing. RECONCILED (migration 106):
// "product" IS the canonical POP-001 `plat_products` (keyed by `code`); PCS organizes it via suites and gates
// workspaces/tenants. Super-admin only. POST create / PATCH update / DELETE remove, discriminated by `type`:
// portfolio | suite | product | mapping (product↔workspace) | license (tenant↔product). Each write audited.
/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: any, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : null);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function audit(c: any, action: string, type: string, id: string | null, val: any) {
  try { const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle(); await c.admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: c.userId, actor_name: me?.full_name ?? null, action, entity_type: `pcs_${type}`, entity_id: id, new_value: val }); } catch { /* fail-soft */ }
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));

  try {
    if (b.type === "portfolio") {
      if (!str(b.name)) return badRequest("name required");
      const { data, error } = await admin.from("product_portfolios").insert({ name: str(b.name), description: str(b.description, 500) }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_create", "portfolio", data.id, { name: b.name }); return NextResponse.json(data, { status: 201 });
    }
    if (b.type === "suite") {
      if (!str(b.name) || !b.portfolio_id) return badRequest("name + portfolio_id required");
      const { data, error } = await admin.from("product_suites").insert({ portfolio_id: b.portfolio_id, name: str(b.name), code: str(b.code, 40), icon: str(b.icon, 8), color: str(b.color, 16), visibility: ["public", "internal", "hidden"].includes(b.visibility) ? b.visibility : "internal", sort_order: Number(b.sort_order) || 0 }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_create", "suite", data.id, { name: b.name }); return NextResponse.json(data, { status: 201 });
    }
    if (b.type === "product") {
      // Product = a plat_products catalogue entry (code PK), organized into a suite.
      const name = str(b.name); if (!name) return badRequest("name required");
      const code = (str(b.code, 40) || slug(name)); if (!code) return badRequest("code required");
      const { data, error } = await admin.from("plat_products").insert({ code, name, description: str(b.description, 500), suite_id: b.suite_id ?? null }).select("code").single();
      if (error) return NextResponse.json({ error: /duplicate|unique|primary key/i.test(error.message) ? `Product code "${code}" already exists` : error.message }, { status: 400 });
      await audit(c, "pcs_create", "product", code, { name, suite_id: b.suite_id ?? null }); return NextResponse.json(data, { status: 201 });
    }
    if (b.type === "mapping") {
      if (!b.product_code || !str(b.workspace_key, 80)) return badRequest("product_code + workspace_key required");
      const { error } = await admin.from("product_workspaces").insert({ product_code: b.product_code, workspace_key: str(b.workspace_key, 80) });
      if (error && !/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_map", "mapping", b.product_code, { workspace_key: b.workspace_key }); return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (b.type === "license") {
      if (!b.tenant_id || !b.product_code) return badRequest("tenant_id + product_code required");
      const { error } = await admin.from("tenant_product_licenses").upsert({ tenant_id: b.tenant_id, product_code: b.product_code, status: "active" }, { onConflict: "tenant_id,product_code" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "pcs_license_grant", "license", b.product_code, { tenant_id: b.tenant_id }); return NextResponse.json({ ok: true }, { status: 201 });
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

  if (b.type === "product") {
    if (!b.code) return badRequest("code required");
    const patch: any = {};
    for (const k of ["name", "description", "suite_id", "sort", "is_core"]) if (k in b) patch[k] = b[k];
    if (!Object.keys(patch).length) return badRequest("no fields");
    const { error } = await admin.from("plat_products").update(patch).eq("code", b.code);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(c, "pcs_update", "product", b.code, patch); return NextResponse.json({ ok: true });
  }
  const table = b.type === "portfolio" ? "product_portfolios" : b.type === "suite" ? "product_suites" : null;
  if (!table || !b.id) return badRequest("type + id required");
  const patch: any = {};
  for (const k of ["name", "description", "code", "icon", "color", "visibility", "status", "sort_order"]) if (k in b) patch[k] = b[k];
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
  const type = u.searchParams.get("type");

  if (type === "mapping") {
    const pc = u.searchParams.get("product_code"), wk = u.searchParams.get("workspace_key");
    if (!pc || !wk) return badRequest("product_code + workspace_key required");
    await admin.from("product_workspaces").delete().eq("product_code", pc).eq("workspace_key", wk);
    await audit(c, "pcs_unmap", "mapping", pc, { workspace_key: wk }); return NextResponse.json({ ok: true });
  }
  if (type === "license") {
    const tid = u.searchParams.get("tenant_id"), pc = u.searchParams.get("product_code");
    if (!tid || !pc) return badRequest("tenant_id + product_code required");
    await admin.from("tenant_product_licenses").delete().eq("tenant_id", tid).eq("product_code", pc);
    await audit(c, "pcs_license_revoke", "license", pc, { tenant_id: tid }); return NextResponse.json({ ok: true });
  }
  if (type === "product") {
    // Products are the shared catalogue — "remove" = unassign from the suite (keep the plat_products entry).
    const code = u.searchParams.get("code");
    if (!code) return badRequest("code required");
    await admin.from("plat_products").update({ suite_id: null }).eq("code", code);
    await audit(c, "pcs_unassign", "product", code, null); return NextResponse.json({ ok: true });
  }
  // Archive portfolio/suite.
  const id = u.searchParams.get("id");
  const table = type === "portfolio" ? "product_portfolios" : type === "suite" ? "product_suites" : null;
  if (!table || !id) return badRequest("type + id required");
  const { error } = await admin.from(table).update({ status: "archived" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(c, "pcs_archive", type!, id, null);
  return NextResponse.json({ ok: true });
}
