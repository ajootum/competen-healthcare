import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { notify } from "@/lib/notify";

// Clinical Tasks (COE Task domain). Supervisors assign; the assigned worker
// works the task through its lifecycle. A worker may also log a task for
// themselves. 'verified' is supervisor-only (separation of duties).
/* eslint-disable @typescript-eslint/no-explicit-any */

const LIFECYCLE = ["accepted", "in_progress", "completed", "verified", "cancelled"];

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin as any;
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  let q = admin.from("op_tasks").select("*, op_patients!patient_id(label), profiles!assigned_to(full_name)").order("created_at", { ascending: false }).limit(200);
  if (mine || !isStaff(c)) q = q.eq("assigned_to", c.userId);
  else if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  if (!b.description?.trim()) return badRequest("description required");
  const admin = c.admin as any;

  // Non-staff may only create a task assigned to themselves; and any assignee
  // other than the caller must be a real profile inside the caller's hospital.
  const assignedTo = b.assigned_to || c.userId;
  if (assignedTo !== c.userId) {
    if (!isStaff(c)) return forbidden("Only coordinators can assign tasks to others");
    const scope = await assertProfileScope(c, assignedTo);
    if (scope) return scope;
  }

  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (b.patient_id) {
    const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  }

  const { data, error } = await admin.from("op_tasks").insert({
    hospital_id: hospitalId, patient_id: b.patient_id ?? null, shift_id: b.shift_id ?? null,
    task_type: b.task_type || "general", description: b.description.trim(),
    assigned_to: assignedTo, assigned_by: c.userId,
    priority: ["low", "normal", "high", "urgent"].includes(b.priority) ? b.priority : "normal",
    due_at: b.due_at ?? null, status: "assigned",
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_task", entity_type: "op_task", entity_id: data.id, hospital_id: hospitalId, new_value: { assigned_to: assignedTo, priority: data.priority } });
  if (assignedTo && assignedTo !== c.userId) await notify([assignedTo], { type: "op_task", title: "New task assigned", body: b.description.trim(), href: "/dashboard/shift" });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!LIFECYCLE.includes(b.status)) return badRequest(`status must be one of: ${LIFECYCLE.join(", ")}`);

  const { data: task } = await admin.from("op_tasks").select("id, hospital_id, assigned_to, assigned_by, status, completed_by").eq("id", id).maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && task.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  // The assigned worker or any coordinator may advance the task.
  if (task.assigned_to !== c.userId && !isStaff(c)) return forbidden("Not your task");

  // Enforce a legal state transition — no skipping straight to verified.
  const TRANSITIONS: Record<string, string[]> = {
    created: ["assigned", "accepted", "in_progress", "completed", "cancelled"],
    assigned: ["accepted", "in_progress", "completed", "cancelled"],
    accepted: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: ["verified", "cancelled"],
  };
  if (!(TRANSITIONS[task.status] ?? []).includes(b.status)) {
    return badRequest(`Cannot move a '${task.status}' task to '${b.status}'`);
  }
  // Verification is separation-of-duties: a coordinator, and not the person who
  // was assigned it or completed it.
  if (b.status === "verified") {
    if (!isStaff(c)) return forbidden("Only a coordinator can verify a task");
    if (task.assigned_to === c.userId || task.completed_by === c.userId) return badRequest("You cannot verify a task you performed");
  }

  const update: any = { status: b.status };
  if (b.status === "completed") { update.completed_at = new Date().toISOString(); update.completed_by = c.userId; }
  const { data, error } = await admin.from("op_tasks").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
