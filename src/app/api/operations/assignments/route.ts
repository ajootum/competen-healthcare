import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";

// Patient Assignment (COE Assignment domain). A patient must always have an
// active responsible clinician; assignment is competency-validated unless an
// explicit override reason is given (spec §5.7 business rules).
/* eslint-disable @typescript-eslint/no-explicit-any */

const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.patient_id || !b.staff_id) return badRequest("patient_id and staff_id required");
  const admin = c.admin as any;
  const assignmentType = b.assignment_type === "supporting" ? "supporting" : "primary";

  const { data: patient } = await admin.from("op_patients").select("hospital_id, label").eq("id", b.patient_id).maybeSingle();
  if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && patient.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  const staffScope = await assertProfileScope(c, b.staff_id);
  if (staffScope) return staffScope;

  // Competency validation: does the clinician hold at least one current (non-expired)
  // passing competency decision? If not, an override_reason is mandatory.
  const today = new Date().toISOString().slice(0, 10);
  const { data: decs } = await admin.from("competency_decisions")
    .select("outcome, expiry_date").eq("nurse_id", b.staff_id).in("outcome", PASSING);
  const competencyValidated = (decs ?? []).some((d: any) => !d.expiry_date || d.expiry_date >= today);
  if (!competencyValidated && !b.override_reason?.trim()) {
    return NextResponse.json({ error: "Clinician has no current validated competency — provide override_reason to proceed (emergency override).", requires_override: true }, { status: 422 });
  }

  // A patient has one active primary clinician — end any existing primary on reassignment.
  if (assignmentType === "primary") {
    await admin.from("op_patient_assignments").update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("patient_id", b.patient_id).eq("assignment_type", "primary").eq("status", "active");
  }

  const { data, error } = await admin.from("op_patient_assignments").insert({
    hospital_id: patient.hospital_id, patient_id: b.patient_id, staff_id: b.staff_id, shift_id: b.shift_id ?? null,
    assignment_type: assignmentType, competency_validated: competencyValidated,
    override_reason: competencyValidated ? null : (b.override_reason?.trim() || null),
    status: "active", created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({
    actor_id: c.userId, action: "assign_patient", entity_type: "op_patient_assignment", entity_id: data.id,
    entity_name: patient.label, hospital_id: patient.hospital_id,
    new_value: { staff_id: b.staff_id, type: assignmentType, competency_validated: competencyValidated, override: !competencyValidated },
  });
  return NextResponse.json({ ...data, competency_validated: competencyValidated }, { status: 201 });
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const patientId = new URL(req.url).searchParams.get("patient");
  let q = admin.from("op_patient_assignments")
    .select("*, profiles!staff_id(full_name), op_patients!patient_id(label)")
    .eq("status", "active").order("started_at", { ascending: false }).limit(500);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  if (patientId) q = q.eq("patient_id", patientId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_patient_assignments").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { error } = await admin.from("op_patient_assignments").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
