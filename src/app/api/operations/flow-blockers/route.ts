import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Operational flow blockers (SSW-005 Patient Flow) — supervisor-logged blockers on
// patient movement. Reads + writes for any operational staff; tenant-scoped in code
// (service-role client bypasses RLS). Degrades gracefully before migration 048.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const CATS = ["no_bed", "bed_cleaning", "discharge_meds", "family_education", "transport", "medical_review", "documentation", "receiving_unit", "isolation_room", "equipment", "other"];

export async function GET() {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_flow_blockers").select("*, op_patients!patient_id(label), op_beds!bed_id(label)").eq("status", "open").order("created_at", { ascending: false }).limit(100);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ blockers: [] }); // pre-migration: fail soft
  return NextResponse.json({ blockers: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!CATS.includes(b.category)) return badRequest("valid category required");
  const admin = c.admin as any;
  const hospital_id = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (!hospital_id) return badRequest("no hospital in scope");
  if (b.patient_id) {
    const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  }
  const { data, error } = await admin.from("op_flow_blockers").insert({
    hospital_id, patient_id: b.patient_id || null, bed_id: b.bed_id || null,
    category: b.category, detail: b.detail?.trim()?.slice(0, 300) || null, created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_flow_blockers").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data, error } = await admin.from("op_flow_blockers").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
