import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { notify } from "@/lib/notify";

// Patient Assignment (COE Assignment domain). A patient must always have an
// active responsible clinician; assignment is competency-validated unless an
// explicit override reason is given (spec §5.7 business rules).
/* eslint-disable @typescript-eslint/no-explicit-any */

import { assessCompetencyCurrency, DECISION_COLUMNS } from "@/lib/operations/competency-currency";

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

  // Competency validation: does the clinician hold at least one CURRENT passing competency decision? If
  // not, an override_reason is mandatory.
  //
  // This used to ask the database only for PASSING rows, which cannot see a revocation. Decisions are
  // versioned, so a nurse found competent in v1 and suspended in v2 still has the v1 row, and the gate
  // validated them on it -- storing competency_validated: true for a clinician whose competency had been
  // withdrawn, and never asking for the override. The reduction to latest-per-competency now happens in
  // assessCompetencyCurrency, which every gate can share.
  const { data: decs } = await admin.from("competency_decisions")
    .select(DECISION_COLUMNS).eq("nurse_id", b.staff_id).limit(3000);
  const currency = assessCompetencyCurrency(decs ?? []);
  const competencyValidated = currency.validated;
  if (!competencyValidated && !b.override_reason?.trim()) {
    return NextResponse.json({ error: "Clinician has no current validated competency — provide override_reason to proceed (emergency override).", requires_override: true }, { status: 422 });
  }

  // WARD-003 acceptance flow: the assignment enters PENDING_ACCEPTANCE — the
  // current nurse keeps responsibility until the receiving nurse accepts (the
  // existing primary is ended at ACCEPTANCE, in the state engine, not here).
  // Pre-migration-156 fallback: the old check constraint rejects the new
  // status — degrade to the legacy immediate-active behaviour.
  const base = {
    hospital_id: patient.hospital_id, patient_id: b.patient_id, staff_id: b.staff_id, shift_id: b.shift_id ?? null,
    assignment_type: assignmentType, competency_validated: competencyValidated,
    override_reason: competencyValidated ? null : (b.override_reason?.trim() || null),
    created_by: c.userId,
  };
  let data: any = null;
  let pendingFlow = true;
  {
    const r = await admin.from("op_patient_assignments").insert({ ...base, status: "pending_acceptance", acceptance_status: "pending" }).select().single();
    if (r.error && /check constraint|acceptance_status|column/i.test(r.error.message)) {
      pendingFlow = false;
      if (assignmentType === "primary") {
        await admin.from("op_patient_assignments").update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("patient_id", b.patient_id).eq("assignment_type", "primary").eq("status", "active");
      }
      const legacy = await admin.from("op_patient_assignments").insert({ ...base, status: "active" }).select().single();
      if (legacy.error) return NextResponse.json({ error: legacy.error.message }, { status: 500 });
      data = legacy.data;
    } else if (r.error) {
      return NextResponse.json({ error: r.error.message }, { status: 500 });
    } else data = r.data;
  }
  await admin.from("audit_log").insert({
    actor_id: c.userId, action: "assign_patient", entity_type: "op_patient_assignment", entity_id: data.id,
    entity_name: patient.label, hospital_id: patient.hospital_id,
    new_value: { staff_id: b.staff_id, type: assignmentType, competency_validated: competencyValidated, override: !competencyValidated, awaiting_acceptance: pendingFlow },
  });
  if (pendingFlow && b.staff_id !== c.userId) {
    await notify([b.staff_id], {
      type: "op_assignment", title: `New patient assignment — ${patient.label}`,
      body: "Accept in your Assignment Inbox to take responsibility. Until then the current nurse remains accountable.",
      href: "/healthcare-worker/inbox",
    });
  }
  return NextResponse.json({ ...data, competency_validated: competencyValidated, awaiting_acceptance: pendingFlow }, { status: 201 });
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
