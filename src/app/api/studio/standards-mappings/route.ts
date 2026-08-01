import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-108 — Standards Mapping write API. POST maps a competency to an external standard clause; DELETE
// removes a mapping. Competency-office tier (educator/admin/super), tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BODIES = ["who", "jci", "safecare", "moh", "nursing_council", "medical_council", "iso", "professional_society", "hospital_policy", "other"];
const COVERAGE = ["full", "partial", "reference"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 129 to enable Standards Mapping" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Mapping to a standard requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const competency = clean(b.competency_id);
  const ref = clean(b.standard_ref);
  const body = BODIES.includes(b.standard_body) ? b.standard_body : "other";
  const coverage = COVERAGE.includes(b.coverage) ? b.coverage : "full";
  if (!competency) return badRequest("a competency is required");
  if (!ref) return badRequest("a standard reference is required");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("competency_standard_mappings").insert({
    hospital_id: c.hospitalId ?? null,
    competency_id: competency, standard_body: body, standard_ref: ref,
    standard_title: clean(b.standard_title), coverage, notes: clean(b.notes),
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return badRequest("that standard is already mapped to this competency");
    return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "map_competency_standard", entity_type: "competency_standard_mapping", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { competency, standard_body: body, standard_ref: ref, coverage } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("competency_standard_mappings").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("competency_standard_mappings").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "unmap_competency_standard", entity_type: "competency_standard_mapping", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
