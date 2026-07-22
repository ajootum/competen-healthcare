import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { QUALITY_TYPES, QUALITY_STATUSES } from "@/lib/operations/quality-safety";

// Quality Improvement (SSW-QSE-001 §5). POST creates a CAPA / audit action / PDSA /
// improvement project / RCA / policy review; PATCH advances its status. Supervisor
// tier, tenant-scoped, audit-logged; 409 hint until 073 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const PRIO = ["low", "medium", "high"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 073 to enable quality actions" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.title ?? "").trim()) return badRequest("title required");
  const type = QUALITY_TYPES.includes(b.action_type) ? b.action_type : "capa";
  const priority = PRIO.includes(b.priority) ? b.priority : "medium";
  const due = b.due_hours ? new Date(Date.now() + Number(b.due_hours) * 3600e3).toISOString() : null;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_quality_actions").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), shift_id: b.shift_id ?? null,
    action_type: type, title: String(b.title).trim(), description: b.description?.trim() || null,
    priority, status: "open", owner_name: b.owner_name?.trim() || me?.full_name || null, due_at: due,
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id, action_type, title").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `create_${type}`, entity_type: "op_quality_action", entity_id: data.id, entity_name: data.title, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  if (!QUALITY_STATUSES.includes(b.status)) return badRequest("valid status required");
  const { data: row } = await c.admin.from("op_quality_actions").select("hospital_id, title").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Action not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const update: any = { status: b.status, updated_at: new Date().toISOString() };
  if (b.status === "completed") update.completed_at = new Date().toISOString();
  const { data, error } = await c.admin.from("op_quality_actions").update(update).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `quality_action_${data.status}`, entity_type: "op_quality_action", entity_id: data.id, entity_name: row.title, hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
