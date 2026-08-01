import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-041 — 360° respondent-group API. POST adds a weighted respondent group to an assessment; DELETE
// removes one. The parent assessment is scope-checked. Competency-office tier, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const GROUPS = ["self", "peer", "supervisor", "subordinate", "team", "patient", "family", "external"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 133 to enable the 360° Designer" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Editing a 360° assessment requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const assessmentId = clean(b.assessment_id);
  if (!assessmentId) return badRequest("assessment_id required");
  const group = GROUPS.includes(b.group_type) ? b.group_type : null;
  if (!group) return badRequest("invalid respondent group");
  const weight = parseInt(b.weight, 10);
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) return badRequest("weight must be 0–100");

  const { data: a } = await c.admin.from("cst_360_assessments").select("id, hospital_id").eq("id", assessmentId).maybeSingle();
  if (!a) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  if (!isSuper(c) && a.hospital_id && a.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await c.admin.from("cst_360_respondent_groups").insert({ assessment_id: assessmentId, group_type: group, weight, is_required: b.is_required === true }).select("id").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return badRequest("that respondent group is already added");
    return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }

  await c.admin.from("cst_360_assessments").update({ updated_at: new Date().toISOString() }).eq("id", assessmentId);
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "add_360_group", entity_type: "cst_360_assessment", entity_id: assessmentId, hospital_id: a.hospital_id ?? null, new_value: { group_type: group, weight } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: g } = await c.admin.from("cst_360_respondent_groups").select("id, assessment_id").eq("id", id).maybeSingle();
  if (!g) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: a } = await c.admin.from("cst_360_assessments").select("hospital_id").eq("id", g.assessment_id).maybeSingle();
  if (a && !isSuper(c) && a.hospital_id && a.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_360_respondent_groups").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "remove_360_group", entity_type: "cst_360_assessment", entity_id: g.assessment_id, hospital_id: a?.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
