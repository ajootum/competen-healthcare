import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Clinical Shifts (COE Shift domain). Operational staff open/activate/close shifts.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["day", "evening", "night", "long_day", "on_call"];

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
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
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!TYPES.includes(b.shift_type)) return badRequest("valid shift_type required");
  const admin = c.admin as any;
  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;

  if (b.department_id) {
    const { data: d } = await admin.from("departments").select("hospital_id").eq("id", b.department_id).maybeSingle();
    if (!d) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (!isSuper(c) && d.hospital_id !== c.hospitalId) return forbidden("Department out of scope");
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
  if (!isStaff(c)) return forbidden();
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
  const { data, error } = await admin.from("op_shifts").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
