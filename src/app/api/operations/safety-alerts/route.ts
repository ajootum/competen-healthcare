import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";

// Safety Alerts (COE Patient Safety domain).
/* eslint-disable @typescript-eslint/no-explicit-any */

const CATS = ["fall_risk", "medication", "pressure_injury", "infection", "patient_id", "deterioration", "device", "environmental"];
const SEV = ["low", "medium", "high"];

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_safety_alerts")
    .select("*, op_patients!patient_id(label)")
    .eq("active", true).order("severity", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  // Any authenticated clinician may RAISE a safety alert; resolving stays coordinator-only.
  const b = await req.json().catch(() => ({}));
  if (!CATS.includes(b.category)) return badRequest("valid category required");
  const admin = c.admin as any;
  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (b.patient_id) {
    const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  }
  // A named owner must be in the caller's hospital; otherwise default to the caller.
  if (b.owner_id && b.owner_id !== c.userId) {
    const scope = await assertProfileScope(c, b.owner_id);
    if (scope) return scope;
  }
  const { data, error } = await admin.from("op_safety_alerts").insert({
    hospital_id: hospitalId, unit_id: b.unit_id ?? null, patient_id: b.patient_id ?? null,
    category: b.category, severity: SEV.includes(b.severity) ? b.severity : "medium",
    note: b.note?.trim() || null, active: true, owner_id: b.owner_id ?? c.userId, created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "raise_safety_alert", entity_type: "op_safety_alert", entity_id: data.id, hospital_id: hospitalId, new_value: { category: b.category, severity: b.severity } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_safety_alerts").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const b = await req.json().catch(() => ({}));
  const { data, error } = await admin.from("op_safety_alerts").update({ active: false, resolution: b.resolution?.trim() || null, resolved_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
