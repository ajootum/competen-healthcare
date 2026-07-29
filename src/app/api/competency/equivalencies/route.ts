import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// COMP-024 — competency equivalency rules (the recognition primitive). POST creates a source→target mapping
// with a recognition type; DELETE removes one. Competency-office tier (educator/admin/super), tenant-scoped,
// audit-logged. Applying the rules to a professional's competencies happens in the recognition loader.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["exact", "equivalent", "conditional", "bridging", "denied"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 123 to enable recognition rules" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Defining recognition rules requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const targetId = clean(b.target_competency_id);
  const sourceId = clean(b.source_competency_id);
  const sourceLabel = clean(b.source_label);
  if (!targetId) return badRequest("target_competency_id required");
  if (!sourceId && !sourceLabel) return badRequest("a source competency or source label is required");
  const type = TYPES.includes(b.equivalence_type) ? b.equivalence_type : "equivalent";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("competency_equivalencies").insert({
    hospital_id: c.hospitalId ?? null, source_competency_id: sourceId, source_label: sourceLabel,
    target_competency_id: targetId, equivalence_type: type, bridging_note: clean(b.bridging_note),
    rationale: clean(b.rationale), created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id, equivalence_type").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_equivalency", entity_type: "competency_equivalency", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { type } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await c.admin.from("competency_equivalencies").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { error } = await c.admin.from("competency_equivalencies").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_equivalency", entity_type: "competency_equivalency", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
