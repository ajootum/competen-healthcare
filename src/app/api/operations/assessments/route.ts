import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, isAssignedToPatient } from "@/lib/api-auth";
import { notify } from "@/lib/notify";
import { recordAcuity, recordWorkload, loadMyAssessments, validateToolForPatient, OVERLOAD_THRESHOLD } from "@/lib/hww/assessments";
import { maybeAutoRebalance } from "@/lib/hww/assignment-engine";

// Acuity & Workload assessments API (HWW-WARD/ICU, migration 153).
//   GET → the caller's assessment lens (patients + history + workload aggregate)
//   GET ?patient=<id> → full history for one patient (assigned or staff)
//   POST {kind:'acuity'|'workload', ...} → record a (re)assessment.
// Access: the assigned bedside nurse or staff tier. Scores are computed by the
// shipped engine, never trusted from the client. Significant acuity changes and
// workload overloads notify the active-shift supervisor (assignment review,
// per WARD-001 §10 / ICU-001 §7). Every record is audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

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
    const [a, w] = await Promise.all([
      admin.from("op_acuity_assessments").select("*").eq("patient_id", patientId).order("assessed_at", { ascending: false }).limit(100),
      admin.from("op_workload_assessments").select("*").eq("patient_id", patientId).order("assessed_at", { ascending: false }).limit(100),
    ]);
    return NextResponse.json({ acuity: a.data ?? [], workload: w.data ?? [] });
  }
  const data = await loadMyAssessments(admin, c.userId);
  // Maps do not survive JSON — flatten for API consumers.
  return NextResponse.json({
    ...data,
    acuityByPatient: Object.fromEntries(data.acuityByPatient),
    workloadByPatient: Object.fromEntries(data.workloadByPatient),
  });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const kind = String(b.kind ?? "");
  if (!["acuity", "workload"].includes(kind)) return badRequest("kind must be acuity | workload");
  if (!b.patient_id) return badRequest("patient_id required");
  const admin = c.admin as any;

  // Subject scope + the frontline assignment rule.
  const { data: p } = await admin.from("op_patients").select("id, label, hospital_id").eq("id", b.patient_id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  if (!isStaff(c) && !(await isAssignedToPatient(c, b.patient_id))) return forbidden("Not your patient");

  // Shift context: the caller's current active shift (also the notify target).
  const { data: dep } = await admin.from("op_shift_staff")
    .select("op_shifts!shift_id(id, status, supervisor_id)").eq("staff_id", c.userId).limit(20);
  const activeShift = (dep ?? []).map((d: any) => d.op_shifts).find((s: any) => s?.status === "active") ?? null;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();

  const ctx = {
    patientId: b.patient_id as string, framework: String(b.framework ?? (kind === "workload" ? "nas" : "ward")),
    notes: b.notes, shiftId: b.shift_id ?? activeShift?.id ?? null,
    assessedBy: c.userId, assessedByName: me?.full_name ?? null,
  };

  // UNIT-ASM-001: the tool must be the one resolved from the patient's care
  // location — wrong-tool submissions are rejected (409) with the right tool
  // named. Users never pick tools manually.
  const tool = await validateToolForPatient(admin, ctx.patientId, kind as "acuity" | "workload", ctx.framework);
  if (!tool.ok) return NextResponse.json({ error: tool.error }, { status: tool.status });

  const r = kind === "acuity"
    ? await recordAcuity(admin, { ...ctx, payload: b.payload ?? b.domains })
    : await recordWorkload(admin, { ...ctx, payload: b.payload ?? b.items, overrideLevel: b.override_level, overrideReason: b.override_reason });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  await admin.from("audit_log").insert({ trace_id: c.traceId,
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: kind === "acuity" ? "record_acuity_assessment" : "record_workload_assessment",
    entity_type: kind === "acuity" ? "op_acuity_assessment" : "op_workload_assessment",
    entity_id: r.assessment.id, entity_name: p.label, hospital_id: p.hospital_id,
    new_value: kind === "acuity"
      ? { framework: ctx.framework, score: r.assessment.score, level: r.assessment.level, significant: r.significant }
      : { framework: ctx.framework, percentage: r.assessment.percentage, aggregate: r.aggregate },
  }).then((x: any) => x, () => {});

  // Assignment-review signals to the active-shift supervisor.
  const supervisorId = activeShift?.supervisor_id ?? null;
  if (supervisorId && supervisorId !== c.userId) {
    if (kind === "acuity" && r.significant) {
      await notify([supervisorId], {
        type: "op_assessment",
        title: `Acuity change — ${p.label}: ${r.assessment.level} (${r.assessment.previous_score ?? "—"} → ${r.assessment.score})`,
        body: "Significant acuity change recorded — review the patient assignment.",
        href: "/supervisor/team-assignments",
      });
    }
    if (kind === "workload" && r.overloaded) {
      await notify([supervisorId], {
        type: "op_assessment",
        title: `Workload overload — ${me?.full_name ?? "a nurse"} at ${r.aggregate}%`,
        body: `Cumulative assigned workload exceeds ${OVERLOAD_THRESHOLD}% of one nurse's capacity — consider rebalancing.`,
        href: "/supervisor/team-assignments",
      });
    }
  }

  // AE-001 S7 continuous rebalancing: significant acuity changes and workload
  // overloads regenerate the assignment recommendation (throttled, fail-soft).
  if ((kind === "acuity" && r.significant) || (kind === "workload" && r.overloaded)) {
    await maybeAutoRebalance(admin, p.hospital_id ?? c.hospitalId, kind === "acuity" ? `significant acuity change — ${p.label}` : `workload overload — ${me?.full_name ?? "nurse"}`,
      (supId, body) => notify([supId], { type: "op_assignment", title: "Rebalancing recommendation regenerated", body, href: "/supervisor/assignment-engine" }).then(() => {}));
  }

  return NextResponse.json({ ok: true, assessment: r.assessment, significant: r.significant ?? false, aggregate: r.aggregate ?? null, overloaded: r.overloaded ?? false }, { status: 201 });
}
