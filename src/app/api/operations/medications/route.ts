import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, isAssignedToPatient } from "@/lib/api-auth";
import { validateScheduleEntry, recordAdministration, loadMyMedications, effectiveStatus } from "@/lib/hww/medications";

// Medication Coordination API (HWW-MED-001, migration 154). Operational only —
// no prescribing, no dose calculation; dose is a display string from source.
//   GET → the caller's medication lens (queue + timeline + timeliness)
//   GET ?patient=<id> → one patient's schedule + events (assigned or staff)
//   POST {action:'schedule'} → add an operational schedule entry
//   POST {action:'record'} → administer / delay / omit with five-rights capture
//   PATCH {action:'status'} → in_progress (start) or cancelled (staff only)
// Access: the assigned bedside nurse or staff tier. Delay breaches auto-raise
// REAL op_escalations (engine-owned). Every mutation is audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function activeShiftOf(admin: any, userId: string) {
  const { data: dep } = await admin.from("op_shift_staff")
    .select("op_shifts!shift_id(id, status, supervisor_id)").eq("staff_id", userId).limit(20);
  return (dep ?? []).map((d: any) => d.op_shifts).find((s: any) => s?.status === "active") ?? null;
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
    if (!isStaff(c) && !(await isAssignedToPatient(c, patientId))) return forbidden("Not your patient");
    const [s, e] = await Promise.all([
      admin.from("op_med_schedule").select("*").eq("patient_id", patientId).order("scheduled_at", { ascending: true }).limit(200),
      admin.from("op_med_administrations").select("*").eq("patient_id", patientId).order("administered_at", { ascending: false }).limit(100),
    ]);
    const now = Date.now();
    return NextResponse.json({
      schedule: (s.data ?? []).map((r: any) => ({ ...r, effective_status: effectiveStatus(r, now) })),
      events: e.data ?? [],
    });
  }
  return NextResponse.json(await loadMyMedications(admin, c.userId));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");
  const admin = c.admin as any;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();

  if (action === "schedule") {
    const errs = validateScheduleEntry(b);
    if (errs.length) return badRequest(errs.join("; "));
    const { data: p } = await admin.from("op_patients").select("id, label, hospital_id, department_id, unit_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
    if (!isStaff(c) && !(await isAssignedToPatient(c, b.patient_id))) return forbidden("Not your patient");

    const { data, error } = await admin.from("op_med_schedule").insert({
      hospital_id: p.hospital_id, department_id: p.department_id ?? null, unit_id: p.unit_id ?? null,
      patient_id: p.id, drug_name: String(b.drug_name).trim(), dose_display: String(b.dose_display ?? "").trim() || null,
      route: b.route, scheduled_at: new Date(b.scheduled_at).toISOString(),
      high_risk: !!b.high_risk, requires_double_check: !!b.requires_double_check,
      allergy_note: String(b.allergy_note ?? "").trim() || null, status: "scheduled", source: "manual", created_by: c.userId,
    }).select().single();
    if (error) return /does not exist|schema cache/i.test(error.message) ? NextResponse.json({ error: "Run migration 154 to enable medications" }, { status: 409 }) : NextResponse.json({ error: error.message }, { status: 500 });

    await admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null, action: "med_schedule_created",
      entity_type: "op_med_schedule", entity_id: data.id, entity_name: `${data.drug_name} — ${p.label}`,
      hospital_id: p.hospital_id, new_value: { route: data.route, scheduled_at: data.scheduled_at, high_risk: data.high_risk },
    }).then((x: any) => x, () => {});
    return NextResponse.json({ ok: true, entry: data }, { status: 201 });
  }

  if (action === "record") {
    if (!b.schedule_id) return badRequest("schedule_id required");
    // Resolve the subject via the schedule row for the access check.
    const { data: sched } = await admin.from("op_med_schedule").select("id, patient_id, hospital_id").eq("id", b.schedule_id).maybeSingle();
    if (!sched) return NextResponse.json({ error: "Schedule entry not found" }, { status: 404 });
    if (!isSuper(c) && sched.hospital_id && sched.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (!isStaff(c) && !(await isAssignedToPatient(c, sched.patient_id))) return forbidden("Not your patient");

    const shift = await activeShiftOf(admin, c.userId);
    const r = await recordAdministration(admin, {
      scheduleId: b.schedule_id, outcome: b.outcome, reason: b.reason,
      safetyChecks: b.safety_checks, witnessId: b.witness_id ?? null,
      shiftId: shift?.id ?? null, actorId: c.userId, actorName: me?.full_name ?? null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

    await admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null, action: `med_${b.outcome}`,
      entity_type: "op_med_administration", entity_id: r.event.id,
      hospital_id: r.event.hospital_id,
      new_value: { schedule_id: b.schedule_id, delay_minutes: r.delayMinutes, escalated: r.escalated, witnessed: !!b.witness_id },
    }).then((x: any) => x, () => {});
    return NextResponse.json({ ok: true, event: r.event, schedule: r.schedule, escalated: r.escalated, delay_minutes: r.delayMinutes }, { status: 201 });
  }

  return badRequest("unknown action");
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  if (String(b.action ?? "") !== "status") return badRequest("unknown action");
  if (!b.id || !["in_progress", "cancelled"].includes(b.status)) return badRequest("id and status in_progress|cancelled required");
  const admin = c.admin as any;

  const { data: sched } = await admin.from("op_med_schedule").select("id, patient_id, hospital_id, status, drug_name").eq("id", b.id).maybeSingle();
  if (!sched) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && sched.hospital_id && sched.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  // Cancelling stops the order — a coordination act, staff tier. Starting
  // (in_progress) is the bedside nurse's own act on her patient.
  if (b.status === "cancelled" && !isStaff(c)) return forbidden("Cancelling a scheduled medication is a coordinator action");
  if (b.status === "in_progress" && !isStaff(c) && !(await isAssignedToPatient(c, sched.patient_id))) return forbidden("Not your patient");
  if (["administered", "cancelled", "escalated"].includes(sched.status)) return badRequest(`Already ${sched.status}`);

  const { data, error } = await admin.from("op_med_schedule").update({ status: b.status }).eq("id", b.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: `med_schedule_${b.status}`,
    entity_type: "op_med_schedule", entity_id: b.id, entity_name: sched.drug_name, hospital_id: sched.hospital_id,
  }).then((x: any) => x, () => {});
  return NextResponse.json({ ok: true, entry: data });
}
