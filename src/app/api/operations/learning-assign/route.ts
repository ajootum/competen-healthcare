import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Lightweight learning assignment API (LDS-001 / UMG-005). A manager assigns a course to an audience
// (a role, or all unit staff); the assignment auto-creates one enrolment per matching staff member so
// the Learning Dashboard's assignment/completion widgets populate. Also creates courses inline and
// updates enrolment progress/completion. Manager-gated; tenant-scoped; audited.
//   POST action=create_course  { title, course_type?, mandatory?, validity_months?, competency_id? }
//   POST action=assign         { course_id, name?, assignment_type?, mandatory?, due_date?, role?|all }
//   PATCH ?id=<enrolment_id>    { action: "complete" | "in_progress" | "not_started", progress_pct? }
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const hid = c.hospitalId ?? b.hospital_id ?? null;

  if (b.action === "create_course") {
    if (!b.title) return badRequest("title required");
    const { data, error } = await admin.from("learning_courses").insert({
      hospital_id: hid, title: b.title, course_type: b.course_type || null,
      mandatory: !!b.mandatory, validity_months: b.validity_months || null,
      competency_id: b.competency_id || null, status: "active", active: true, created_by: c.userId,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_learning_course", entity_type: "learning_course", entity_id: data.id, hospital_id: hid, new_value: { title: b.title } });
    return NextResponse.json(data, { status: 201 });
  }

  if (b.action === "assign") {
    if (!b.course_id) return badRequest("course_id required");
    if (!hid) return badRequest("a hospital context is required to assign learning");
    const { data: course } = await admin.from("learning_courses").select("id, title, hospital_id, mandatory").eq("id", b.course_id).maybeSingle();
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!isSuper(c) && course.hospital_id && course.hospital_id !== c.hospitalId) return forbidden("Out of scope");

    // Resolve the target audience: a role, or all staff in the hospital.
    let staffQ = admin.from("profiles").select("id, role").eq("hospital_id", hid);
    if (b.role && b.role !== "all") staffQ = staffQ.eq("role", b.role);
    const { data: staff } = await staffQ.limit(5000);
    const targets = (staff ?? []) as any[];
    if (!targets.length) return badRequest("No staff match the selected audience");

    const mandatory = b.mandatory != null ? !!b.mandatory : !!course.mandatory;
    const { data: assignment, error: aErr } = await admin.from("learning_assignments").insert({
      hospital_id: hid, course_id: b.course_id, name: b.name || course.title,
      assignment_type: b.assignment_type || (mandatory ? "mandatory" : "recommended"),
      audience: { role: b.role || "all" }, mandatory, due_date: b.due_date || null, priority: b.priority || null, active: true, created_by: c.userId,
    }).select().single();
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

    const rows = targets.map(s => ({ hospital_id: hid, user_id: s.id, course_id: b.course_id, assignment_id: assignment.id, status: "not_started", mandatory, due_date: b.due_date || null }));
    const { error: eErr } = await admin.from("learning_enrolments").insert(rows);
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "assign_learning", entity_type: "learning_assignment", entity_id: assignment.id, hospital_id: hid, new_value: { course: course.title, enrolled: rows.length, audience: b.role || "all" } });
    return NextResponse.json({ assignment, enrolled: rows.length }, { status: 201 });
  }

  return badRequest("valid action required (create_course|assign)");
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const action = b.action;
  if (!["complete", "in_progress", "not_started"].includes(action)) return badRequest("valid action required");

  const { data: enr } = await admin.from("learning_enrolments").select("hospital_id, status").eq("id", id).maybeSingle();
  if (!enr) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && enr.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const now = new Date().toISOString();
  const patch = action === "complete"
    ? { status: "completed", progress_pct: 100, completed_at: now, updated_at: now }
    : action === "in_progress"
      ? { status: "in_progress", progress_pct: b.progress_pct != null ? Math.max(0, Math.min(100, b.progress_pct)) : 50, updated_at: now }
      : { status: "not_started", progress_pct: 0, completed_at: null, updated_at: now };
  const { data, error } = await admin.from("learning_enrolments").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "update_learning_enrolment", entity_type: "learning_enrolment", entity_id: id, hospital_id: enr.hospital_id, new_value: { status: patch.status } });
  return NextResponse.json(data);
}
