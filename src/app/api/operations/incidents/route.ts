import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { INCIDENT_TYPES, INCIDENT_STATUSES } from "@/lib/operations/quality-safety";

// Incident & Event Management (SSW-QSE-001 §3). POST reports an incident/near-miss;
// PATCH advances the investigation lifecycle (reported → investigating →
// awaiting_action → closed) and records corrective actions. Supervisor tier,
// tenant-scoped, audit-logged; 409 hint until 073 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const SEV = ["low", "medium", "high", "critical"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 073 to enable incident management" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.description ?? "").trim()) return badRequest("description required");
  const type = INCIDENT_TYPES.includes(b.incident_type) ? b.incident_type : "other";
  const severity = SEV.includes(b.severity) ? b.severity : "medium";

  if (b.patient_id) {
    const { data: p } = await c.admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_incidents").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), shift_id: b.shift_id ?? null,
    incident_type: type, severity, near_miss: !!b.near_miss, patient_id: b.patient_id ?? null,
    description: String(b.description).trim(), status: "reported",
    reported_by: c.userId, reported_by_name: me?.full_name ?? null,
  }).select("id, incident_type, severity").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `report_incident_${type}`, entity_type: "op_incident", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { severity, near_miss: !!b.near_miss } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const { data: row } = await c.admin.from("op_incidents").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const update: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!INCIDENT_STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; if (b.status === "closed") update.closed_at = new Date().toISOString(); }
  if (typeof b.corrective_action === "string") update.corrective_action = b.corrective_action.trim() || null;
  if (Object.keys(update).length <= 1) return badRequest("no valid fields");

  const { data, error } = await c.admin.from("op_incidents").update(update).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `incident_${data.status}`, entity_type: "op_incident", entity_id: data.id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
