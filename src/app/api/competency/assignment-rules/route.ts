import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// COMP-018 — the competency assignment RULES engine. POST defines a rule (a population × a competency × a
// cadence); DELETE removes one. MATERIALISING a rule into cmo_assignments is the sibling [id]/apply route.
// Competency-office tier (educator/admin/super), tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PRIORITIES = ["low", "medium", "high"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 125 to enable the assignment rules engine" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clampInt = (v: any, def: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const optInt = (v: any, lo: number, hi: number) => { if (v == null || v === "") return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Defining assignment rules requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  const competencyId = clean(b.competency_id);
  const competencyName = clean(b.competency_name);
  if (!name) return badRequest("name required");
  if (!competencyId) return badRequest("competency_id required");
  if (!competencyName) return badRequest("competency_name required");
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "medium";
  const dueDays = clampInt(b.due_days, 30, 1, 3650);
  const recurrence = optInt(b.recurrence_months, 1, 120);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("cmo_assignment_rules").insert({
    hospital_id: c.hospitalId ?? null, name, target_role: clean(b.target_role), target_label: clean(b.target_label),
    competency_id: competencyId, competency_name: competencyName, priority, due_days: dueDays,
    recurrence_months: recurrence, trigger: clean(b.trigger), is_active: true,
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_assignment_rule", entity_type: "cmo_assignment_rule", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { name, competency: competencyName, target: clean(b.target_label) ?? clean(b.target_role) ?? "all staff", priority } });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await c.admin.from("cmo_assignment_rules").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { error } = await c.admin.from("cmo_assignment_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_assignment_rule", entity_type: "cmo_assignment_rule", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
