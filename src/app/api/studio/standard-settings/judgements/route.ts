import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-044 — standard-setting judgements API. POST records a judge's per-item rating; DELETE removes one.
// The parent study is scope-checked. Competency-office tier, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 132 to enable Standard Setting" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Recording a judgement requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const studyId = clean(b.study_id);
  const judge = clean(b.judge_name);
  const item = clean(b.item_label);
  const rating = Number(b.rating);
  if (!studyId || !judge || !item) return badRequest("study, judge and item are required");
  if (!Number.isFinite(rating) || rating < 0 || rating > 1) return badRequest("rating must be a probability between 0 and 1");
  const round = Number.isFinite(Number(b.round)) && Number(b.round) > 0 ? Math.floor(Number(b.round)) : 1;

  const { data: study } = await c.admin.from("cst_standard_settings").select("id, hospital_id").eq("id", studyId).maybeSingle();
  if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });
  if (!isSuper(c) && study.hospital_id && study.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await c.admin.from("cst_standard_judgements").insert({ study_id: studyId, judge_name: judge, item_label: item, rating, round }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("cst_standard_settings").update({ updated_at: new Date().toISOString() }).eq("id", studyId);
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "add_standard_judgement", entity_type: "cst_standard_setting", entity_id: studyId, hospital_id: study.hospital_id ?? null, new_value: { judge, item, rating } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: j } = await c.admin.from("cst_standard_judgements").select("id, study_id").eq("id", id).maybeSingle();
  if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: study } = await c.admin.from("cst_standard_settings").select("hospital_id").eq("id", j.study_id).maybeSingle();
  if (study && !isSuper(c) && study.hospital_id && study.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_standard_judgements").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "remove_standard_judgement", entity_type: "cst_standard_setting", entity_id: j.study_id, hospital_id: study?.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
