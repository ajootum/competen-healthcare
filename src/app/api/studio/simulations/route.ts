import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-006 — Simulation Studio write API. POST creates a scenario; PATCH updates status/version; DELETE
// removes one. Competency-office tier (educator/admin/super), tenant-scoped, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["mock_code", "emergency", "virtual_patient", "skills", "team", "procedure", "communication", "disaster", "orientation", "reassessment", "clinical"];
const DIFF = ["beginner", "intermediate", "advanced"];
const STATUSES = ["draft", "published", "archived"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 131 to enable the Simulation Studio" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const posInt = (v: any) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Authoring a scenario requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("a scenario name is required");
  const type = TYPES.includes(b.scenario_type) ? b.scenario_type : "clinical";
  const difficulty = DIFF.includes(b.difficulty) ? b.difficulty : "intermediate";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("simulation_scenarios").insert({
    hospital_id: c.hospitalId ?? null, name, description: clean(b.description),
    scenario_type: type, competency_id: clean(b.competency_id), competency_name: clean(b.competency_name),
    difficulty, participants: posInt(b.participants) ?? 1, duration_min: posInt(b.duration_min),
    status: "draft", version: clean(b.version) ?? "1.0.0",
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_scenario", entity_type: "simulation_scenario", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { name, scenario_type: type } });
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
  if (b.version !== undefined) { const v = clean(b.version); if (v) patch.version = v; }
  if (Object.keys(patch).length === 1) return badRequest("nothing to update");

  const { data: row } = await c.admin.from("simulation_scenarios").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("simulation_scenarios").update(patch).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "update_scenario", entity_type: "simulation_scenario", entity_id: id, hospital_id: row.hospital_id ?? null, new_value: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("simulation_scenarios").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("simulation_scenarios").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "delete_scenario", entity_type: "simulation_scenario", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
