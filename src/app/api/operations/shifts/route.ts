import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { outstandingForShift, CLOSING_STATUSES } from "@/lib/operations/shift-closeout";

// Clinical Shifts (COE Shift domain). Operational staff open/activate/close shifts.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["day", "evening", "night", "long_day", "on_call"];

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  let q = admin.from("op_shifts")
    .select("*, departments!department_id(name), profiles!supervisor_id(full_name)")
    .order("shift_date", { ascending: false }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  if (date) q = q.eq("shift_date", date);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shifts: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!TYPES.includes(b.shift_type)) return badRequest("valid shift_type required");
  const admin = c.admin as any;
  let hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;

  if (b.department_id) {
    const { data: d } = await admin.from("departments").select("hospital_id").eq("id", b.department_id).maybeSingle();
    if (!d) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (!isSuper(c) && d.hospital_id !== c.hospitalId) return forbidden("Department out of scope");
    // The department is authoritative — a shift must not be created in a tenant other than its department's.
    hospitalId = d.hospital_id ?? hospitalId;
  }

  const { data, error } = await admin.from("op_shifts").insert({
    hospital_id: hospitalId, department_id: b.department_id ?? null, unit_id: b.unit_id ?? null,
    shift_type: b.shift_type, shift_date: b.shift_date || new Date().toISOString().slice(0, 10),
    starts_at: b.starts_at ?? null, ends_at: b.ends_at ?? null,
    supervisor_id: b.supervisor_id ?? null, status: "planned", notes: b.notes?.trim() || null, created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "open_shift", entity_type: "op_shift", entity_id: data.id, hospital_id: hospitalId, new_value: { shift_type: b.shift_type } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_shifts").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const b = await req.json().catch(() => ({}));
  const update: any = {};
  if (["planned", "active", "completed", "cancelled"].includes(b.status)) update.status = b.status;
  if (typeof b.notes === "string") update.notes = b.notes.trim() || null;
  if (typeof b.supervisor_id === "string") update.supervisor_id = b.supervisor_id;
  if (!Object.keys(update).length) return badRequest("no valid fields");

  // XWI P2-14 close-out gate. Ending a shift used to write `status` and nothing else, leaving tasks
  // in_progress, patients assigned to nobody on duty, and escalations open -- rows that keep feeding every
  // count above them, indistinguishable from live work. The orphans are NOT cascaded away: cancelling
  // tasks destroys the record of what was left undone, ending assignments drops clinical responsibility
  // with no receiving clinician, and resolving escalations asserts something that did not happen. What is
  // fixed is that closing over them was SILENT.
  let outstanding: Awaited<ReturnType<typeof outstandingForShift>> | null = null;
  if (CLOSING_STATUSES.includes(update.status)) {
    outstanding = await outstandingForShift(admin, id);
    if (outstanding.total > 0 && !b.acknowledge) {
      return NextResponse.json({
        error: `This shift still has ${outstanding.summary}. Hand them over or resolve them, or acknowledge to close over them.`,
        outstanding, requiresAcknowledgement: true,
      }, { status: 409 });
    }
  }

  const { data, error } = await admin.from("op_shifts").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // An acknowledged close-out is a governed act, so it leaves a record of exactly what was outstanding.
  if (outstanding && outstanding.total > 0) {
    await admin.from("audit_log").insert({
      trace_id: c.traceId, actor_id: c.userId, action: "shift_closed_with_outstanding_work",
      entity_type: "op_shifts", entity_id: id, entity_name: outstanding.summary,
      new_value: outstanding, hospital_id: row.hospital_id,
      notes: b.acknowledge_reason?.trim() || null,
    });
  }
  return NextResponse.json({ ...data, outstanding });
}
