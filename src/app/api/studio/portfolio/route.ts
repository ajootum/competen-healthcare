import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-042 — Portfolio Assessment write API. POST creates a portfolio template; PATCH updates status /
// type; DELETE removes it (sections cascade). Sections via ./sections. Competency-office tier
// (educator/admin/super), tenant-scoped, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["learning", "competency", "epa", "clinical", "leadership", "research", "custom"];
const STATUSES = ["draft", "active", "archived"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 135 to enable the Portfolio designer" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Creating a portfolio template requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("a name is required");
  const type = TYPES.includes(b.portfolio_type) ? b.portfolio_type : "competency";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("cst_portfolio_templates").insert({
    hospital_id: c.hospitalId ?? null, name, description: clean(b.description), portfolio_type: type, status: "draft",
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_portfolio", entity_type: "cst_portfolio_template", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { name, portfolio_type: type } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const b = await req.json().catch(() => ({}));
  const patch: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return badRequest("invalid status"); patch.status = b.status; }
  if (Object.keys(patch).length === 1) return badRequest("nothing to update");

  const { data: row } = await c.admin.from("cst_portfolio_templates").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_portfolio_templates").update(patch).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "update_portfolio", entity_type: "cst_portfolio_template", entity_id: id, hospital_id: row.hospital_id ?? null, new_value: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("cst_portfolio_templates").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_portfolio_templates").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "delete_portfolio", entity_type: "cst_portfolio_template", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
