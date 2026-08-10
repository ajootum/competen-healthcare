import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";

// Checklist items — append an item to a checklist.
//
// ⚠ NARROWED FROM A ROLE LIST TO A CAPABILITY (CP-HQ-NAV-001 follow-up), and ⚠ THIS ONE HAS NO CALLER AT
// ALL. A repo-wide search for "content/checklist-items" outside src/app/api returns nothing: no screen, no
// component, no dynamically built URL. It was reachable by every super_admin and hospital_admin and used by
// nobody.
//
// It is GATED rather than DELETED deliberately. Removing an endpoint is the larger change and an unreferenced
// route may still have a consumer this repo cannot see; narrowing it costs nothing either way. If it is still
// unreferenced next time somebody passes through here, delete it.
const CAPABILITIES = ["hq.learning.content.view"];

export async function POST(req: Request) {
  const ctx = await hqApiGate(CAPABILITIES);
  if (isHqRefusal(ctx)) return ctx;

  const { item, description, is_critical, checklist_id } = await req.json();
  if (!item || !checklist_id) return NextResponse.json({ error: "item and checklist_id required" }, { status: 400 });

  const { data: last } = await ctx.admin.from("checklist_items").select("sort_order").eq("checklist_id", checklist_id).order("sort_order", { ascending: false }).limit(1).single();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { data, error } = await ctx.admin.from("checklist_items").insert({ item, description, is_critical: Boolean(is_critical), checklist_id, sort_order }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
