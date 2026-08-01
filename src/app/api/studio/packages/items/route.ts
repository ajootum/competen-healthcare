import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-109 — package contents API. POST adds an item to a package; DELETE removes one. The parent
// package is scope-checked. Competency-office tier, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ITEM_TYPES = ["competency", "framework", "assessment", "cpu", "learning_pathway", "checklist", "skill"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 130 to enable the Package Manager" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Editing a package requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const packageId = clean(b.package_id);
  if (!packageId) return badRequest("package_id required");
  const itemType = ITEM_TYPES.includes(b.item_type) ? b.item_type : "competency";
  const itemLabel = clean(b.item_label);
  if (!itemLabel && !clean(b.item_id)) return badRequest("an item is required");

  const { data: pkg } = await c.admin.from("competency_packages").select("id, hospital_id").eq("id", packageId).maybeSingle();
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });
  if (!isSuper(c) && pkg.hospital_id && pkg.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await c.admin.from("competency_package_items").insert({
    package_id: packageId, item_type: itemType, item_id: clean(b.item_id), item_label: itemLabel, is_required: b.is_required !== false,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("competency_packages").update({ updated_at: new Date().toISOString() }).eq("id", packageId);
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "add_package_item", entity_type: "competency_package", entity_id: packageId, hospital_id: pkg.hospital_id ?? null, new_value: { item_type: itemType, item_label: itemLabel } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: item } = await c.admin.from("competency_package_items").select("id, package_id").eq("id", id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: pkg } = await c.admin.from("competency_packages").select("hospital_id").eq("id", item.package_id).maybeSingle();
  if (pkg && !isSuper(c) && pkg.hospital_id && pkg.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("competency_package_items").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "remove_package_item", entity_type: "competency_package", entity_id: item.package_id, hospital_id: pkg?.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
