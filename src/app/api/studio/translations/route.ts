import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CAP-012 — Translation & Localisation write API. POST registers an asset translation into a locale;
// PATCH updates its status; DELETE removes it. Competency-office tier (educator/admin/super), tenant-
// scoped, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["framework", "competency", "skill", "blueprint", "question_bank", "osce", "simulation", "learning_resource", "policy", "guideline", "other"];
const LOCALES = ["fr", "es", "ar", "sw", "pt", "zh", "hi", "de", "other"];
const STATUSES = ["not_started", "in_progress", "review", "published"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 137 to enable the Translation engine" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Registering a translation requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const label = clean(b.asset_label);
  if (!label) return badRequest("an asset is required");
  const assetType = TYPES.includes(b.asset_type) ? b.asset_type : "competency";
  const locale = LOCALES.includes(b.locale) ? b.locale : "fr";
  const status = STATUSES.includes(b.status) ? b.status : "not_started";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("cap_asset_translations").insert({
    hospital_id: c.hospitalId ?? null, asset_type: assetType, asset_id: clean(b.asset_id), asset_label: label,
    locale, status, translator_name: clean(b.translator_name), notes: clean(b.notes),
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_translation", entity_type: "cap_asset_translation", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { asset_label: label, locale } });
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
  if (b.translator_name !== undefined) patch.translator_name = clean(b.translator_name);
  if (Object.keys(patch).length === 1) return badRequest("nothing to update");

  const { data: row } = await c.admin.from("cap_asset_translations").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cap_asset_translations").update(patch).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "update_translation", entity_type: "cap_asset_translation", entity_id: id, hospital_id: row.hospital_id ?? null, new_value: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("cap_asset_translations").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cap_asset_translations").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_translation", entity_type: "cap_asset_translation", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
