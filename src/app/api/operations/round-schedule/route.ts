import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isAdmin, isSuper, forbidden, badRequest, type Caller } from "@/lib/api-auth";

// Round schedule (Ward configuration, SSW-001) — planned clinical rounds per unit
// / shift-type, owned by the Director of Nursing. Reads: any operational staff.
// Writes: Director of Nursing or admin. Service-role client → scope enforced here.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SHIFTS = ["day", "evening", "night", "long_day", "on_call", "any"];
const NONE = "00000000-0000-0000-0000-000000000000";

async function canWrite(c: Caller): Promise<boolean> {
  if (isAdmin(c)) return true;
  const { data } = await (c.admin as any).from("profiles").select("org_role, org_roles").eq("id", c.userId).maybeSingle();
  const org = ((data?.org_roles?.length ? data.org_roles : [data?.org_role]) as (string | null)[]).filter(Boolean) as string[];
  return org.includes("director_of_nursing");
}

export async function GET() {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_round_schedule").select("*, departments!department_id(name)").order("at_time");
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rounds: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!(await canWrite(c))) return forbidden("Ward configuration is managed by the Director of Nursing");
  const b = await req.json().catch(() => ({}));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at_time ?? "")) return badRequest("at_time must be HH:MM (24h)");
  if (!b.label?.trim()) return badRequest("label required");
  const shift_type = SHIFTS.includes(b.shift_type) ? b.shift_type : "any";
  const admin = c.admin as any;
  const hospital_id = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (!hospital_id) return badRequest("no hospital in scope");
  const dept = b.department_id || null;
  if (dept) {
    const { data: d } = await admin.from("departments").select("hospital_id").eq("id", dept).maybeSingle();
    if (!d) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (!isSuper(c) && d.hospital_id !== c.hospitalId) return forbidden("Department out of scope");
  }
  const { data, error } = await admin.from("op_round_schedule").insert({
    hospital_id, department_id: dept, shift_type, at_time: b.at_time, label: b.label.trim(),
    sort: parseInt(b.at_time.replace(":", ""), 10) || 0, created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!(await canWrite(c))) return forbidden("Ward configuration is managed by the Director of Nursing");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_round_schedule").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { error } = await admin.from("op_round_schedule").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
