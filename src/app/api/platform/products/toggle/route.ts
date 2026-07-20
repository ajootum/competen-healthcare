/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan, landlordAudit } from "@/lib/platform/landlord";

// POST /api/platform/products/toggle — flip a product's default_on (LCP-001 §22).
export async function POST(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "product_manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!b?.code || typeof b.defaultOn !== "boolean") return NextResponse.json({ error: "code and defaultOn required" }, { status: 400 });

  const { data: p } = await caller.admin.from("plat_products").select("code, name, is_core").eq("code", b.code).maybeSingle();
  if (!p) return NextResponse.json({ error: "Unknown product" }, { status: 400 });
  const { error } = await caller.admin.from("plat_products").update({ default_on: b.defaultOn }).eq("code", b.code);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await landlordAudit(caller.admin, caller, { action: "product_default_set", entity_type: "product", entity_name: p.name, new_value: { code: b.code, default_on: b.defaultOn } });
  return NextResponse.json({ ok: true });
}
