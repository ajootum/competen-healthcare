import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-040 — behaviour-indicator API. POST adds an observable behaviour indicator to an assessment; DELETE
// removes one. The parent assessment is scope-checked. Competency-office tier, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOMAINS = ["professionalism", "communication", "teamwork", "leadership", "ethics", "patient_centred", "cultural", "accountability"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 134 to enable the Behaviour designer" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Editing a behaviour assessment requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const assessmentId = clean(b.assessment_id);
  const statement = clean(b.statement);
  if (!assessmentId || !statement) return badRequest("assessment and statement are required");
  const domain = DOMAINS.includes(b.domain) ? b.domain : "professionalism";

  const { data: a } = await c.admin.from("cst_behaviour_assessments").select("id, hospital_id").eq("id", assessmentId).maybeSingle();
  if (!a) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  if (!isSuper(c) && a.hospital_id && a.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { count } = await c.admin.from("cst_behaviour_indicators").select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  const { data, error } = await c.admin.from("cst_behaviour_indicators").insert({
    assessment_id: assessmentId, domain, statement,
    positive_anchor: clean(b.positive_anchor), negative_anchor: clean(b.negative_anchor),
    is_critical: b.is_critical === true, sort_order: count ?? 0,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("cst_behaviour_assessments").update({ updated_at: new Date().toISOString() }).eq("id", assessmentId);
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "add_behaviour_indicator", entity_type: "cst_behaviour_assessment", entity_id: assessmentId, hospital_id: a.hospital_id ?? null, new_value: { domain, statement } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: ind } = await c.admin.from("cst_behaviour_indicators").select("id, assessment_id").eq("id", id).maybeSingle();
  if (!ind) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: a } = await c.admin.from("cst_behaviour_assessments").select("hospital_id").eq("id", ind.assessment_id).maybeSingle();
  if (a && !isSuper(c) && a.hospital_id && a.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_behaviour_indicators").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "remove_behaviour_indicator", entity_type: "cst_behaviour_assessment", entity_id: ind.assessment_id, hospital_id: a?.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
