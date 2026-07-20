import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Operational Patients (COE Patient Operations). Operational objects only —
// location/acuity/isolation/status — NEVER clinical documentation (not an EMR).
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACUITY = ["stable", "moderate", "high", "critical"];
const DEP = ["level_0", "level_1", "level_2", "level_3"];
const ISO = ["none", "contact", "droplet", "airborne", "protective"];
const RISK = ["low", "medium", "high"];
const OPSTATUS = ["expected", "admitted", "transfer_pending", "discharge_pending", "discharged"];
const STAGES = ["expected_admission", "awaiting_bed", "admitted", "in_care", "assessment", "treatment", "theatre", "recovery", "transfer_pending", "discharge_ready", "discharged"];

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_patients").select("*, op_beds!bed_id(label), departments!department_id(name)").neq("operational_status", "discharged").order("created_at", { ascending: false }).limit(500);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ patients: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.label?.trim()) return badRequest("label required (operational identifier — not full PHI)");
  const admin = c.admin as any;
  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (b.department_id) {
    const { data: d } = await admin.from("departments").select("hospital_id").eq("id", b.department_id).maybeSingle();
    if (!d) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (!isSuper(c) && d.hospital_id !== c.hospitalId) return forbidden("Department out of scope");
  }
  // Verify a client-supplied bed belongs to the caller's hospital — else a foreign
  // bed_id leaks its label back on read and lets discharge flip its status (below).
  if (b.bed_id) {
    const { data: bd } = await admin.from("op_beds").select("hospital_id").eq("id", b.bed_id).maybeSingle();
    if (!bd) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
    if (!isSuper(c) && bd.hospital_id !== c.hospitalId) return forbidden("Bed out of scope");
  }
  // Verify a client-supplied unit belongs to the caller's hospital (unit → department).
  if (b.unit_id) {
    const { data: u } = await admin.from("units").select("departments!department_id(hospital_id)").eq("id", b.unit_id).maybeSingle();
    if (!u) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    if (!isSuper(c) && (u as any).departments?.hospital_id !== c.hospitalId) return forbidden("Unit out of scope");
  }
  const insertObj: any = {
    hospital_id: hospitalId, department_id: b.department_id ?? null, unit_id: b.unit_id ?? null, bed_id: b.bed_id ?? null,
    label: b.label.trim(), patient_ref: b.patient_ref?.trim() || null,
    acuity_level: ACUITY.includes(b.acuity_level) ? b.acuity_level : "stable",
    dependency_level: DEP.includes(b.dependency_level) ? b.dependency_level : "level_1",
    isolation_status: ISO.includes(b.isolation_status) ? b.isolation_status : "none",
    risk_level: RISK.includes(b.risk_level) ? b.risk_level : "low",
    operational_status: "admitted", created_by: c.userId,
  };
  // Operational-lite age + working diagnosis (migration 047). Only sent when
  // provided, so pre-migration inserts (empty values) still succeed.
  const age = parseInt(b.age_years, 10);
  if (Number.isFinite(age) && age >= 0 && age <= 130) insertObj.age_years = age;
  if (b.diagnosis?.trim()) insertObj.diagnosis = b.diagnosis.trim().slice(0, 200);
  if (b.consultant?.trim()) insertObj.consultant = b.consultant.trim().slice(0, 120);
  if (STAGES.includes(b.current_stage)) insertObj.current_stage = b.current_stage;
  const { data, error } = await admin.from("op_patients").insert(insertObj).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Occupy the bed if one was given.
  if (b.bed_id) await admin.from("op_beds").update({ status: "occupied" }).eq("id", b.bed_id).eq("hospital_id", hospitalId);
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "register_op_patient", entity_type: "op_patient", entity_id: data.id, hospital_id: hospitalId });
  await admin.from("op_movement_events").insert({ hospital_id: hospitalId, patient_id: data.id, event_type: "admission", detail: b.bed_id ? "Admitted to bed" : "Admission registered", created_by: c.userId }); // fail-soft pre-migration 050
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_patients").select("hospital_id, bed_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const b = await req.json().catch(() => ({}));
  const update: any = {};
  if (ACUITY.includes(b.acuity_level)) update.acuity_level = b.acuity_level;
  if (RISK.includes(b.risk_level)) update.risk_level = b.risk_level;
  if (ISO.includes(b.isolation_status)) update.isolation_status = b.isolation_status;
  if (OPSTATUS.includes(b.operational_status)) update.operational_status = b.operational_status;
  if (b.age_years !== undefined) { const age = parseInt(b.age_years, 10); update.age_years = (Number.isFinite(age) && age >= 0 && age <= 130) ? age : null; }
  if (b.diagnosis !== undefined) update.diagnosis = b.diagnosis?.trim() ? b.diagnosis.trim().slice(0, 200) : null;
  if (b.consultant !== undefined) update.consultant = b.consultant?.trim() ? b.consultant.trim().slice(0, 120) : null;
  if (STAGES.includes(b.current_stage)) update.current_stage = b.current_stage;
  if (!Object.keys(update).length) return badRequest("no valid fields");
  const { data, error } = await admin.from("op_patients").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Free the bed on discharge — scoped to the patient's hospital so a stored
  // foreign bed_id can never flip another tenant's bed.
  if (update.operational_status === "discharged" && row.bed_id) await admin.from("op_beds").update({ status: "cleaning" }).eq("id", row.bed_id).eq("hospital_id", row.hospital_id);
  // Movement timeline (fail-soft pre-migration 050). A move to transfer_pending
  // logs a distinct 'transfer' event so the dashboard's "Transfers today" counts.
  const events: any[] = [];
  if (update.operational_status) {
    const st = update.operational_status;
    const et = st === "discharged" ? "discharge" : st === "transfer_pending" ? "transfer" : "status_change";
    events.push({ event_type: et, detail: `Status: ${st.replace(/_/g, " ")}` });
  }
  if (update.current_stage) events.push({ event_type: "stage_change", detail: `Stage: ${update.current_stage.replace(/_/g, " ")}` });
  if (events.length) await admin.from("op_movement_events").insert(events.map(e => ({ hospital_id: row.hospital_id, patient_id: id, created_by: c.userId, ...e })));
  return NextResponse.json(data);
}
