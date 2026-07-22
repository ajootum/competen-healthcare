import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { RECURRENCES, TRIGGERS, PRIORITIES } from "@/lib/operations/task-templates";

// Task templates (SSW-TSK-001 §Workflow & Automation). GET lists; POST creates a
// reusable task template with recurrence/trigger config; DELETE deactivates one.
// Instantiation (generating a real task) is done by the client through the
// audited /api/operations/tasks route. Supervisor tier, tenant-scoped,
// audit-logged; 409 migration hint until 070 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 070 to enable task templates" }, { status: 409 }) : null;

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  let q = c.admin.from("op_task_templates").select("*").eq("active", true).order("created_at", { ascending: false }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.name ?? "").trim()) return badRequest("name required");
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "normal";
  const recurrence = RECURRENCES.includes(b.recurrence) ? b.recurrence : "none";
  const trigger = TRIGGERS.includes(b.trigger_event) ? b.trigger_event : "manual";
  const off = Number(b.due_offset_min); const dueOffset = Number.isFinite(off) && off >= 0 ? Math.round(off) : 60;
  const pt = Number(b.pews_threshold); const pews = Number.isFinite(pt) && pt >= 0 ? Math.round(pt) : 5;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const row: any = {
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE),
    name: String(b.name).trim(), task_type: b.task_type?.trim() || null, priority,
    description: b.description?.trim() || null, due_offset_min: dueOffset,
    recurrence, trigger_event: trigger, requires_review: !!b.requires_review,
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  };
  if (trigger === "pews_high") row.pews_threshold = pews;
  const { data, error } = await c.admin.from("op_task_templates").insert(row).select("id, name").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_task_template", entity_type: "task_template", entity_id: data.id, entity_name: data.name, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await c.admin.from("op_task_templates").select("hospital_id, name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("op_task_templates").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_task_template", entity_type: "task_template", entity_id: id, entity_name: row.name, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
