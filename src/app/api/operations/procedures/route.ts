import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, isAssignedToPatient } from "@/lib/api-auth";

// Clinical Procedures API (HWW-UI-005 s1, migration 184).
//   GET  → the caller's assigned patients' procedures.
//   POST → record a procedure performed on an assigned patient.
//
// Tenancy: a procedure belongs to the PATIENT's hospital, never the caller's. Using the caller's would file
// a super_admin's entry unscoped and a cross-hospital admin's under the wrong tenant -- the subject decides.
//
// Access mirrors the concerns route: staff tier anywhere in their hospital, bedside clinicians only on
// patients actually assigned to them.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CATEGORIES = ["clinical", "non_clinical"];
const STATUSES = ["planned", "due", "in_progress", "completed", "abandoned"];
const LATERALITY = ["left", "right", "bilateral", "not_applicable"];

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? ""))
    ? NextResponse.json({ error: "Run migration 184 to enable Procedures" }, { status: 409 })
    : null;

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin as any;
  const { data: asg } = await admin.from("op_patient_assignments").select("patient_id")
    .eq("staff_id", c.userId).eq("status", "active").limit(100);
  const ids = ((asg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);
  if (!ids.length) return NextResponse.json({ procedures: [] });
  const { data, error } = await admin.from("op_procedures")
    .select("id, procedure_name, category, status, scheduled_for, completed_at, site, laterality, consent_obtained, outcome, complications, patient_id")
    .in("patient_id", ids).order("scheduled_for", { ascending: false }).limit(200);
  const gate = error && migrationGate(error);
  if (gate) return gate;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ procedures: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const admin = c.admin as any;

  const name = typeof b.procedure_name === "string" ? b.procedure_name.trim().slice(0, 200) : "";
  if (!b.patient_id || !name) return badRequest("patient_id and procedure_name are required");
  if (b.category && !CATEGORIES.includes(b.category)) return badRequest("Unknown category");
  if (b.status && !STATUSES.includes(b.status)) return badRequest("Unknown status");
  if (b.laterality && !LATERALITY.includes(b.laterality)) return badRequest("Unknown laterality");

  const { data: p } = await admin.from("op_patients").select("id, label, hospital_id, department_id").eq("id", b.patient_id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  if (!isStaff(c) && !(await isAssignedToPatient(c, b.patient_id))) return forbidden("Not your patient");

  const { data: dep } = await admin.from("op_shift_staff")
    .select("shift_id, op_shifts!shift_id(id, status)")
    .eq("staff_id", c.userId).limit(20);
  const activeShift = ((dep ?? []) as any[]).map(d => d.op_shifts).find((s: any) => s?.status === "active") ?? null;

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const status = b.status ?? "completed";
  const now = new Date().toISOString();

  const { data, error } = await admin.from("op_procedures").insert({
    hospital_id: p.hospital_id,          // the SUBJECT's tenant, not the caller's
    patient_id: p.id,
    department_id: p.department_id ?? null,
    shift_id: activeShift?.id ?? null,
    procedure_name: name,
    procedure_code: typeof b.procedure_code === "string" ? b.procedure_code.trim().slice(0, 40) : null,
    category: b.category ?? "clinical",
    status,
    // Timestamps follow the status rather than being set unconditionally: a planned procedure that carries
    // a completed_at is a record that says it happened when it has not.
    started_at: status === "in_progress" || status === "completed" || status === "abandoned" ? now : null,
    completed_at: status === "completed" ? now : null,
    performed_by: c.userId,
    performed_by_name: me?.full_name ?? null,
    site: typeof b.site === "string" && b.site.trim() ? b.site.trim().slice(0, 120) : null,
    laterality: b.laterality ?? null,
    // Three-state on purpose: null means NOT RECORDED, which is different from "no consent" and must not
    // be flattened into false by a checkbox that was simply never ticked.
    consent_obtained: typeof b.consent_obtained === "boolean" ? b.consent_obtained : null,
    outcome: typeof b.outcome === "string" && b.outcome.trim() ? b.outcome.trim().slice(0, 500) : null,
    complications: typeof b.complications === "string" && b.complications.trim() ? b.complications.trim().slice(0, 500) : null,
    notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim().slice(0, 1000) : null,
    created_by: c.userId,
  }).select("id, procedure_name, status").single();

  const gate = error && migrationGate(error);
  if (gate) return gate;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "procedure_recorded", entity_type: "op_procedure", entity_id: data.id, entity_name: name,
    hospital_id: p.hospital_id,
    new_value: { patient: p.label, status, complications: !!b.complications, consent: b.consent_obtained ?? null },
  }).then((r: any) => r, () => {});

  return NextResponse.json({ ok: true, procedure: data }, { status: 201 });
}
