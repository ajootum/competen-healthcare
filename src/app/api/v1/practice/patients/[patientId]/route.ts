import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getPatient } from "@/lib/practice/patients";
import { audit } from "@/lib/practice/provisioning";

// GET   /api/v1/practice/patients/{id} -- the patient with identifiers, contacts and diary history.
// PATCH /api/v1/practice/patients/{id} -- demographic edit, optimistic-concurrency guarded, audited
//        (CPR-V2-005 "identity changes fully audited"; DM-001 s16 update rule).
// Object-level denial is enumeration-safe: a patient in another workspace answers exactly like a
// patient that does not exist (SHELL-001 s6.2).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("patient.view");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  const detail = await getPatient(auth.caller.admin, auth.ctx.workspaceId, patientId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

const EDITABLE = ["displayName", "sex", "birthDate", "ageEstimateYears"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("patient.edit");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (typeof body.recordVersion !== "number")
    return NextResponse.json({ error: "recordVersion is required (optimistic concurrency)" }, { status: 400 });

  const { data: existing } = await auth.caller.admin.from("practice_patient")
    .select("id, status, record_version").eq("id", patientId).eq("workspace_id", auth.ctx.workspaceId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "active") return NextResponse.json({ error: { code: "NOT_EDITABLE", message: "only active patients can be edited" } }, { status: 422 });

  const patch: Record<string, unknown> = {};
  if (typeof body.displayName === "string" && body.displayName.trim()) patch.display_name = body.displayName.trim();
  if (typeof body.sex === "string" && ["female", "male", "other", "unknown", "unspecified"].includes(body.sex)) patch.sex = body.sex;
  if (typeof body.birthDate === "string") patch.birth_date = body.birthDate || null;
  if (body.ageEstimateYears !== undefined) patch.age_estimate_years = body.ageEstimateYears === null ? null : Number(body.ageEstimateYears);
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: `nothing to update; editable fields: ${EDITABLE.join(", ")}` }, { status: 400 });

  const { data: updated } = await auth.caller.admin.from("practice_patient")
    .update({ ...patch, record_version: existing.record_version + 1, updated_at: new Date().toISOString(), updated_by: auth.caller.userId })
    .eq("id", patientId).eq("record_version", body.recordVersion).select("id, record_version").maybeSingle();
  if (!updated) return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "the record changed underneath you; reload and retry" } }, { status: 409 });

  await audit(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId,
    eventType: "practice.patient_updated", payload: { patientId, fields: Object.keys(patch) },
    correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ patient: updated, correlationId: auth.caller.traceId });
}
