import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Bed turnaround (SSW-005 Bed Management) — tracks a bed cycle through
// vacated -> cleaning_requested -> cleaning -> inspection -> ready, freeing the
// bed on completion. Reads/writes for operational staff, tenant-scoped in code.
// Degrades gracefully before migration 049.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const STAGES = ["vacated", "cleaning_requested", "cleaning", "inspection", "ready"];

export async function GET() {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_bed_turnaround").select("*, op_beds!bed_id(label)").neq("stage", "ready").order("created_at", { ascending: true }).limit(100);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ turnaround: [] }); // pre-migration: fail soft
  return NextResponse.json({ turnaround: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.bed_id) return badRequest("bed_id required");
  const admin = c.admin as any;
  const { data: bed } = await admin.from("op_beds").select("hospital_id").eq("id", b.bed_id).maybeSingle();
  if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
  if (!isSuper(c) && bed.hospital_id !== c.hospitalId) return forbidden("Bed out of scope");
  const stage = STAGES.includes(b.stage) && b.stage !== "ready" ? b.stage : "vacated";
  const { data, error } = await admin.from("op_bed_turnaround").insert({
    hospital_id: bed.hospital_id, bed_id: b.bed_id, patient_label: b.patient_label?.trim()?.slice(0, 80) || null, stage, created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? "This bed already has an active turnaround" : error.message }, { status: 400 });
  await admin.from("op_beds").update({ status: "cleaning" }).eq("id", b.bed_id);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller(); if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_bed_turnaround").select("hospital_id, bed_id, stage").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const idx = STAGES.indexOf(row.stage);
  const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  const done = next === "ready";
  const { data, error } = await admin.from("op_bed_turnaround").update({ stage: next, updated_at: new Date().toISOString(), ...(done ? { completed_at: new Date().toISOString() } : {}) }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // On completion the bed returns to the available pool.
  if (done && row.bed_id) await admin.from("op_beds").update({ status: "available" }).eq("id", row.bed_id);
  return NextResponse.json(data);
}
