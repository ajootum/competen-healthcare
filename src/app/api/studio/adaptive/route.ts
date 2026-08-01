import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-036 — Adaptive Examination write API. POST creates an adaptive exam blueprint; PATCH updates its
// status or configuration; DELETE removes it. Competency-office tier (educator/admin/super), tenant-
// scoped, audited. The adaptive delivery engine consumes published blueprints at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DIFF = ["easy", "medium", "hard"];
const STATUSES = ["draft", "active", "archived"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 136 to enable the Adaptive designer" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const intIn = (v: any, lo: number, hi: number, d: number) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Creating an adaptive exam requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("a name is required");
  const minItems = intIn(b.min_items, 1, 500, 20);
  const maxItems = intIn(b.max_items, minItems, 500, Math.max(minItems, 60));
  const se = Number(b.se_stop);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("cst_adaptive_exams").insert({
    hospital_id: c.hospitalId ?? null, name, description: clean(b.description), bank_id: clean(b.bank_id),
    min_items: minItems, max_items: maxItems,
    start_difficulty: DIFF.includes(b.start_difficulty) ? b.start_difficulty : "medium",
    pass_threshold: intIn(b.pass_threshold, 1, 100, 70), se_stop: Number.isFinite(se) && se > 0 && se <= 1 ? se : 0.30, status: "draft",
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_adaptive_exam", entity_type: "cst_adaptive_exam", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { name } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const b = await req.json().catch(() => ({}));
  const patch: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return badRequest("invalid status"); patch.status = b.status; }
  if (b.pass_threshold !== undefined) patch.pass_threshold = intIn(b.pass_threshold, 1, 100, 70);
  if (Object.keys(patch).length === 1) return badRequest("nothing to update");

  const { data: row } = await c.admin.from("cst_adaptive_exams").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_adaptive_exams").update(patch).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "update_adaptive_exam", entity_type: "cst_adaptive_exam", entity_id: id, hospital_id: row.hospital_id ?? null, new_value: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("cst_adaptive_exams").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_adaptive_exams").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "delete_adaptive_exam", entity_type: "cst_adaptive_exam", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
