import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Clinical Observations (COE §5.9). Coordinators SCHEDULE observations (due);
// the assigned clinician RECORDS findings. A recorded observation whose EWS
// score or "cause for concern" flag breaches threshold AUTO-CREATES an
// op_escalation (spec: EscalationTriggered).
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["vital_signs", "neuro", "respiratory", "cardiovascular", "fluid_balance", "pain", "sedation", "pews", "gcs", "specialty"];
const SEV_BY_LEVEL = ["routine", "routine", "urgent", "high", "emergency", "critical"];

async function assignedToPatient(admin: any, patientId: string, staffId: string) {
  const { data } = await admin.from("op_patient_assignments").select("id").eq("patient_id", patientId).eq("staff_id", staffId).eq("status", "active").limit(1).maybeSingle();
  return !!data;
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin as any;
  const patientId = new URL(req.url).searchParams.get("patient");
  if (patientId) {
    const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", patientId).maybeSingle();
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (!isStaff(c) && !(await assignedToPatient(admin, patientId, c.userId))) return forbidden("Not your patient");
    const { data } = await admin.from("op_observations").select("*, profiles!observer_id(full_name)").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100);
    return NextResponse.json({ observations: data ?? [] });
  }
  if (!isStaff(c)) return forbidden();
  let q = admin.from("op_observations").select("*, op_patients!patient_id(label)").in("status", ["due", "overdue"]).order("due_at", { ascending: true }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ observations: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const mode = b.mode === "schedule" ? "schedule" : "record";
  if (!b.patient_id) return badRequest("patient_id required");
  if (!TYPES.includes(b.observation_type)) return badRequest(`observation_type must be one of: ${TYPES.join(", ")}`);
  const admin = c.admin as any;

  const { data: patient } = await admin.from("op_patients").select("hospital_id, department_id, label").eq("id", b.patient_id).maybeSingle();
  if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && patient.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");

  // ── Schedule a due observation (coordinators only)
  if (mode === "schedule") {
    if (!isStaff(c)) return forbidden("Only coordinators can schedule observations");
    const { data, error } = await admin.from("op_observations").insert({
      hospital_id: patient.hospital_id, patient_id: b.patient_id, department_id: patient.department_id ?? null,
      observation_type: b.observation_type, status: "due", scheduled_for: b.due_at ?? null, due_at: b.due_at ?? null, created_by: c.userId,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Record findings (the assigned clinician, or a coordinator)
  if (!isStaff(c) && !(await assignedToPatient(admin, b.patient_id, c.userId))) return forbidden("Not your patient");
  let ews: number | null = null;
  if (b.ews_score !== undefined && b.ews_score !== null && b.ews_score !== "") {
    const n = Number(b.ews_score);
    if (!Number.isFinite(n) || n < 0 || n > 20) return badRequest("ews_score must be a number between 0 and 20");
    ews = Math.round(n);
  }
  const concern = !!b.concern;
  const findings = b.findings && typeof b.findings === "object" ? b.findings : {};

  const base = {
    hospital_id: patient.hospital_id, patient_id: b.patient_id, department_id: patient.department_id ?? null,
    observation_type: b.observation_type, status: "recorded", recorded_at: new Date().toISOString(),
    observer_id: c.userId, findings, ews_score: ews, concern,
    escalation_triggered: false, escalation_id: null,   // reset any stale escalation when re-recording
  };
  let obs: any;
  if (b.observation_id) {
    const { data: existing } = await admin.from("op_observations").select("id, hospital_id, patient_id").eq("id", b.observation_id).maybeSingle();
    if (!existing || (!isSuper(c) && existing.hospital_id !== c.hospitalId)) return NextResponse.json({ error: "Observation not found" }, { status: 404 });
    if (existing.patient_id !== b.patient_id) return badRequest("observation_id does not belong to the given patient");
    const { data, error } = await admin.from("op_observations").update(base).eq("id", b.observation_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    obs = data;
  } else {
    const { data, error } = await admin.from("op_observations").insert({ ...base, created_by: c.userId }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    obs = data;
  }

  // ── Auto-escalation on breach (EWS ≥ 5 or a cause-for-concern flag)
  let escalationId: string | null = null;
  const shouldEscalate = (ews != null && ews >= 5) || concern;
  if (shouldEscalate) {
    const level = ews != null && ews >= 7 ? 4 : ews != null && ews >= 5 ? 3 : 2;
    const deadline = new Date(); deadline.setMinutes(deadline.getMinutes() + (level >= 4 ? 15 : level === 3 ? 60 : 240));
    const { data: esc, error: escErr } = await admin.from("op_escalations").insert({
      hospital_id: patient.hospital_id, patient_id: b.patient_id,
      escalation_type: "clinical_deterioration", level, severity: SEV_BY_LEVEL[level],
      summary: `${ews != null ? `EWS ${ews}` : "Cause for concern"} — ${b.observation_type.replace(/_/g, " ")} on ${patient.label}`,
      raised_by: c.userId, response_deadline: deadline.toISOString(), status: "open",
    }).select("id").single();
    // Never report a breaching observation as safely recorded if its mandatory
    // auto-escalation could not be raised — surface it so the clinician escalates.
    if (escErr || !esc?.id) {
      return NextResponse.json({ error: "Observation recorded, but the automatic escalation could not be raised — please raise it manually now.", detail: escErr?.message, escalation_failed: true }, { status: 500 });
    }
    escalationId = esc.id;
    await admin.from("op_observations").update({ escalation_triggered: true, escalation_id: escalationId }).eq("id", obs.id);
  }

  await admin.from("audit_log").insert({ actor_id: c.userId, action: "record_observation", entity_type: "op_observation", entity_id: obs.id, entity_name: patient.label, hospital_id: patient.hospital_id, new_value: { type: b.observation_type, ews, concern, escalated: !!escalationId } });
  return NextResponse.json({ ...obs, escalation_triggered: !!escalationId, escalation_id: escalationId }, { status: 201 });
}
