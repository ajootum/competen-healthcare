import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isAdmin, isStaff, assertRowScope } from "@/lib/api-auth";

// Survey & inspection management (GOV-001.6). POST schedules a survey; PATCH
// advances it (recording an outcome forces status 'completed'); GET lists
// tenant-scoped. Audit-logged; 409 migration hint until 062 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["external", "mock", "self_assessment", "inspection", "surveillance"];
const STATUSES = ["planned", "preparing", "in_progress", "completed", "cancelled"];
const OUTCOMES = ["pending", "passed", "passed_with_conditions", "failed"];

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 062 to enable survey management" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const b = await req.json();
  if (!String(b.title ?? "").trim()) return badRequest("title required");

  const { data, error } = await c.admin.from("gov_surveys").insert({
    title: String(b.title).trim(),
    framework_id: b.framework_id || null,
    survey_type: TYPES.includes(b.survey_type) ? b.survey_type : "external",
    surveyor: b.surveyor || null,
    hospital_id: c.hospitalId, // server-bound; null for platform super admins
    scheduled_date: b.scheduled_date || null,
    end_date: b.end_date || null,
    prep_note: b.prep_note || null,
    created_by: c.userId,
  }).select().single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "survey_scheduled", entity_type: "survey", entity_id: data.id, entity_name: data.title });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertRowScope(c, "gov_surveys", id);
  if (scopeErr) return scopeErr;

  const b = await req.json();
  const update: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  if (b.outcome !== undefined) {
    if (!OUTCOMES.includes(b.outcome)) return badRequest("invalid outcome");
    update.outcome = b.outcome;
    // Recording a real outcome means the survey happened — force completion.
    if (b.outcome !== "pending") update.status = "completed";
  }
  for (const k of ["prep_note", "result_note", "scheduled_date", "end_date", "surveyor"]) if (b[k] !== undefined) update[k] = b[k] || null;
  if (Object.keys(update).length <= 1) return badRequest("no valid fields");

  const { data, error } = await c.admin.from("gov_surveys").update(update).eq("id", id).select("id, title, status, outcome").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `survey_${data.status}`, entity_type: "survey", entity_id: data.id, entity_name: data.title, new_value: { status: data.status, outcome: data.outcome } });
  return NextResponse.json(data);
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  let q = c.admin.from("gov_surveys").select("*").order("scheduled_date", { ascending: true, nullsFirst: false }).limit(500);
  if (c.hospitalId) q = q.or(`hospital_id.eq.${c.hospitalId},hospital_id.is.null`);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
