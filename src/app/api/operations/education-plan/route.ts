import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Education Planning API (LDS-005). Create education plans, milestones, study-leave and sponsorship
// requests, and decide/update them. Manager-gated; tenant-scoped; audited. Sponsorship approval is
// separate from disbursement (§9). Server timestamps.
//   POST  action=create_plan | add_milestone | study_leave | sponsorship
//   PATCH ?id=&kind=milestone|leave|sponsorship|plan  { action|decision|... }
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const hid = c.hospitalId ?? b.hospital_id ?? null;
  if (!hid) return badRequest("hospital context required");
  const audit = (action: string, entity_type: string, entity_id: string, new_value: any) => admin.from("audit_log").insert({ actor_id: c.userId, action, entity_type, entity_id, hospital_id: hid, new_value });

  if (b.action === "create_plan") {
    if (!b.user_id || !b.programme_title) return badRequest("user_id and programme_title required");
    const { data, error } = await admin.from("education_plans").insert({
      hospital_id: hid, user_id: b.user_id, programme_title: b.programme_title, institution: b.institution || null,
      study_mode: b.study_mode || null, start_date: b.start_date || null, expected_completion: b.expected_completion || null,
      objective: b.objective || null, adviser: b.adviser || null, status: "active", progress_pct: 0, created_by: c.userId,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("create_education_plan", "education_plan", data.id, { programme: b.programme_title });
    return NextResponse.json(data, { status: 201 });
  }
  if (b.action === "add_milestone") {
    if (!b.plan_id || !b.name) return badRequest("plan_id and name required");
    const { data, error } = await admin.from("education_milestones").insert({ hospital_id: hid, plan_id: b.plan_id, name: b.name, planned_date: b.planned_date || null, sort_order: b.sort_order || 0, status: "pending" }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("add_education_milestone", "education_milestone", data.id, { name: b.name });
    return NextResponse.json(data, { status: 201 });
  }
  if (b.action === "study_leave") {
    if (!b.user_id || !b.days) return badRequest("user_id and days required");
    const { data, error } = await admin.from("study_leave_requests").insert({ hospital_id: hid, plan_id: b.plan_id || null, user_id: b.user_id, leave_type: b.leave_type || "study", days: b.days, start_date: b.start_date || null, end_date: b.end_date || null, reason: b.reason || null, status: "requested", created_by: c.userId }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("request_study_leave", "study_leave_request", data.id, { days: b.days });
    return NextResponse.json(data, { status: 201 });
  }
  if (b.action === "sponsorship") {
    if (!b.user_id || b.amount == null) return badRequest("user_id and amount required");
    const { data, error } = await admin.from("sponsorship_requests").insert({ hospital_id: hid, plan_id: b.plan_id || null, user_id: b.user_id, source: b.source || "employer", amount: b.amount, currency: b.currency || "UGX", notes: b.notes || null, status: "requested", created_by: c.userId }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("request_sponsorship", "sponsorship_request", data.id, { amount: b.amount });
    return NextResponse.json(data, { status: 201 });
  }
  return badRequest("valid action required");
}

const TABLE: Record<string, string> = { milestone: "education_milestones", leave: "study_leave_requests", sponsorship: "sponsorship_requests", plan: "education_plans" };

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const url = new URL(req.url);
  const id = url.searchParams.get("id"); const kind = url.searchParams.get("kind");
  if (!id || !kind || !TABLE[kind]) return badRequest("id and valid kind required");
  const b = await req.json().catch(() => ({}));
  const table = TABLE[kind];
  const { data: row } = await admin.from(table).select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const now = new Date().toISOString();
  let patch: any = {};
  if (kind === "milestone") patch = b.action === "complete" ? { status: "completed", completed_at: now } : { status: "pending", completed_at: null };
  else if (kind === "leave") { if (!["approve", "reject"].includes(b.decision)) return badRequest("decision required"); patch = { status: b.decision === "approve" ? "approved" : "rejected", decided_by: c.userId, decided_at: now }; }
  else if (kind === "sponsorship") { if (!["approve", "reject", "disburse"].includes(b.decision)) return badRequest("decision required"); patch = b.decision === "disburse" ? { status: "disbursed", amount_disbursed: b.amount_disbursed ?? undefined, decided_by: c.userId, decided_at: now } : { status: b.decision === "approve" ? "approved" : "rejected", decided_by: c.userId, decided_at: now }; }
  else if (kind === "plan") { patch = { updated_at: now }; if (b.progress_pct != null) patch.progress_pct = Math.max(0, Math.min(100, b.progress_pct)); if (b.status) patch.status = b.status; }
  const { data, error } = await admin.from(table).update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: `update_education_${kind}`, entity_type: table, entity_id: id, hospital_id: row.hospital_id, new_value: patch });
  return NextResponse.json(data);
}
