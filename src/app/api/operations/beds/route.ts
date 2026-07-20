import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Beds (COE Capacity domain).
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["standard", "critical_care", "isolation", "paediatric", "theatre", "recovery", "overflow"];
const STATUSES = ["available", "occupied", "reserved", "out_of_service", "cleaning"];

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_beds").select("*, departments!department_id(name)").order("label").limit(500);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ beds: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.label?.trim()) return badRequest("label required");
  const admin = c.admin as any;
  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (b.department_id) {
    const { data: d } = await admin.from("departments").select("hospital_id").eq("id", b.department_id).maybeSingle();
    if (!d) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (!isSuper(c) && d.hospital_id !== c.hospitalId) return forbidden("Department out of scope");
  }
  const { data, error } = await admin.from("op_beds").insert({
    hospital_id: hospitalId, department_id: b.department_id ?? null, unit_id: b.unit_id ?? null,
    label: b.label.trim(), bed_type: TYPES.includes(b.bed_type) ? b.bed_type : "standard", status: "available",
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_beds").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const b = await req.json().catch(() => ({}));
  if (!STATUSES.includes(b.status)) return badRequest("valid status required");
  const { data, error } = await admin.from("op_beds").update({ status: b.status }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
