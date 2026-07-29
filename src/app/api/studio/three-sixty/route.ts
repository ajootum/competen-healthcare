import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-041 — 360° Assessment write API. POST creates a multisource-feedback template; PATCH updates status
// / scale / confidentiality; DELETE removes it (respondent groups cascade). Groups are managed via
// ./groups. Competency-office tier (educator/admin/super), tenant-scoped, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCALES = ["likert5", "likert3", "bars", "global", "binary"];
const STATUSES = ["draft", "active", "archived"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 133 to enable the 360° Designer" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const posInt = (v: any) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Creating a 360° assessment requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("a name is required");
  const scale = SCALES.includes(b.rating_scale) ? b.rating_scale : "likert5";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("cst_360_assessments").insert({
    hospital_id: c.hospitalId ?? null, name, description: clean(b.description),
    rating_scale: scale, min_raters: posInt(b.min_raters) ?? 3, anonymous: b.anonymous !== false, status: "draft",
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_360", entity_type: "cst_360_assessment", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { name } });
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
  if (b.min_raters !== undefined) { const n = posInt(b.min_raters); if (n != null) patch.min_raters = n; }
  if (b.anonymous !== undefined) patch.anonymous = b.anonymous !== false;
  if (Object.keys(patch).length === 1) return badRequest("nothing to update");

  const { data: row } = await c.admin.from("cst_360_assessments").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_360_assessments").update(patch).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "update_360", entity_type: "cst_360_assessment", entity_id: id, hospital_id: row.hospital_id ?? null, new_value: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("cst_360_assessments").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_360_assessments").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_360", entity_type: "cst_360_assessment", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
