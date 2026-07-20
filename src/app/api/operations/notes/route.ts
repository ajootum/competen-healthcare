import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Operational notes (SSW-PO-001 Patient Card) — short coordination notes for a
// patient (NOT clinical progress notes). Reads/writes for operational staff,
// tenant-scoped. Adding a note also drops a 'note' event on the movement timeline.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";

export async function GET(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const pid = new URL(req.url).searchParams.get("patient_id");
  if (!pid) return badRequest("patient_id required");
  const admin = c.admin as any;
  let q = admin.from("op_operational_notes").select("id, note, created_at, profiles!created_by(full_name)").eq("patient_id", pid).order("created_at", { ascending: false }).limit(50);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ notes: [] }); // pre-migration: fail soft
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.patient_id) return badRequest("patient_id required");
  if (!b.note?.trim()) return badRequest("note required");
  const admin = c.admin as any;
  const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  const note = b.note.trim().slice(0, 500);
  const { data, error } = await admin.from("op_operational_notes").insert({ hospital_id: p.hospital_id, patient_id: b.patient_id, note, created_by: c.userId }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("op_movement_events").insert({ hospital_id: p.hospital_id, patient_id: b.patient_id, event_type: "note", detail: note.slice(0, 120), created_by: c.userId });
  return NextResponse.json(data, { status: 201 });
}
