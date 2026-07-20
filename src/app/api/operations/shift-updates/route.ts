import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Patient shift updates (SSW-PO-001 §3) — per-patient operational record for the
// CURRENT shift: review, update status, handover + snapshot. Reads/writes for
// operational staff, tenant-scoped. Fail-soft before migration 051.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const USTATUS = ["due", "updated", "overdue"];
const HSTATUS = ["pending", "completed"];

async function activeShiftId(admin: any, isSuperCaller: boolean, hid: string | null) {
  let q = admin.from("op_shifts").select("id, status, shift_date").order("shift_date", { ascending: false }).limit(20);
  if (!isSuperCaller) q = q.eq("hospital_id", hid ?? NONE);
  const { data } = await q;
  const s = (data ?? []).find((x: any) => x.status === "active") ?? (data ?? []).find((x: any) => x.status === "planned");
  return s?.id ?? null;
}

export async function GET() {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  const shiftId = await activeShiftId(admin, isSuper(c), c.hospitalId);
  let q = admin.from("op_patient_shift_updates").select("patient_id, reviewed, update_status, handover_status, snapshot").order("updated_at", { ascending: false }).limit(500);
  if (shiftId) q = q.eq("shift_id", shiftId); else q = q.eq("shift_id", NONE);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ updates: [], shiftId }); // pre-migration: fail soft
  return NextResponse.json({ updates: data ?? [], shiftId });
}

export async function POST(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.patient_id) return badRequest("patient_id required");
  const admin = c.admin as any;
  const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  const shiftId = await activeShiftId(admin, isSuper(c), c.hospitalId);
  if (!shiftId) return badRequest("No active shift to record against");

  const patch: any = { updated_by: c.userId, updated_at: new Date().toISOString() };
  if (typeof b.reviewed === "boolean") patch.reviewed = b.reviewed;
  if (USTATUS.includes(b.update_status)) patch.update_status = b.update_status;
  if (HSTATUS.includes(b.handover_status)) patch.handover_status = b.handover_status;
  if (b.snapshot !== undefined) patch.snapshot = b.snapshot?.trim()?.slice(0, 1000) || null;

  // Manual upsert on (patient_id, shift_id).
  const { data: existing } = await admin.from("op_patient_shift_updates").select("id").eq("patient_id", b.patient_id).eq("shift_id", shiftId).maybeSingle();
  if (existing) {
    const { data, error } = await admin.from("op_patient_shift_updates").update(patch).eq("id", existing.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  const { data, error } = await admin.from("op_patient_shift_updates").insert({ hospital_id: p.hospital_id, patient_id: b.patient_id, shift_id: shiftId, ...patch }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
