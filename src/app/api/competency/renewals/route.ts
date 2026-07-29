import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// COMP-020 — competency recertification & renewal management. POST opens a renewal against an expiring competency
// or certification with a chosen renewal path; PATCH advances its status (or switches the path). Competency-office
// tier (educator/admin/super), tenant-scoped, audit-logged. The expiring worklist and renewal KPIs are DERIVED in
// the recertification loader over the real expiry sources — this route only records the renewals opened against them.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PATHS = ["evidence", "assessment", "simulation", "continuing_education", "practice_observation", "portfolio", "mixed"];
const STATUSES = ["pending", "in_progress", "reassessment", "completed", "lapsed"];
const SUBJECTS = ["competency", "certification"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 124 to enable renewal management" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Opening a renewal requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const subjectType = SUBJECTS.includes(b.subject_type) ? b.subject_type : "competency";
  const subjectName = clean(b.subject_name);
  const subjectId = clean(b.subject_id);
  if (!subjectName && !subjectId) return badRequest("a subject (competency or certification) is required");
  const path = PATHS.includes(b.renewal_path) ? b.renewal_path : "assessment";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("cmo_renewals").insert({
    hospital_id: c.hospitalId ?? null,
    subject_type: subjectType, subject_id: subjectId, subject_name: subjectName,
    nurse_id: clean(b.nurse_id), nurse_name: clean(b.nurse_name),
    expiry_date: clean(b.expiry_date), renewal_path: path, status: "pending",
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "open_renewal", entity_type: "cmo_renewal", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { subject_type: subjectType, renewal_path: path } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const b = await req.json().catch(() => ({}));
  const patch: any = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return badRequest("invalid status");
    patch.status = b.status;
    if (b.status === "completed") patch.completed_at = new Date().toISOString();
  }
  if (b.renewal_path !== undefined) {
    if (!PATHS.includes(b.renewal_path)) return badRequest("invalid renewal path");
    patch.renewal_path = b.renewal_path;
  }
  if (!Object.keys(patch).length) return badRequest("nothing to update");

  // Scope-check the target row (super = unscoped; otherwise it must belong to the caller's hospital).
  const { data: row } = await c.admin.from("cmo_renewals").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await c.admin.from("cmo_renewals").update(patch).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "update_renewal", entity_type: "cmo_renewal", entity_id: id, hospital_id: row.hospital_id ?? null, new_value: patch });
  return NextResponse.json(data);
}
