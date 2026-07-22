import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { NOTE_TYPES } from "@/lib/operations/workforce-breaks-notes";

// Supervisor notes (SSW-WFO-001 §5) — the structured shift journal. POST records
// a note (staffing decision, operational event, coaching, risk, action item…);
// PATCH closes an action item. Supervisor tier, tenant-scoped, audit-logged;
// 409 migration hint until 069 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const PRIORITIES = ["low", "medium", "high"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 069 to enable supervisor notes" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.body ?? "").trim()) return badRequest("body required");
  const type = NOTE_TYPES.includes(b.note_type) ? b.note_type : "general";
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "medium";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_supervisor_notes").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), shift_id: b.shift_id ?? null,
    note_type: type, title: b.title?.trim() || null, body: String(b.body).trim(),
    priority, status: type === "action_item" ? "open" : "closed",
    author_id: c.userId, author_name: me?.full_name ?? null,
  }).select("id, note_type").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `note_${type}`, entity_type: "supervisor_note", entity_id: data.id, entity_name: b.title?.trim()?.slice(0, 80) ?? type, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  if (!["open", "closed"].includes(b.status)) return badRequest("status must be open or closed");

  const { data: row } = await c.admin.from("op_supervisor_notes").select("hospital_id, title").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await c.admin.from("op_supervisor_notes").update({ status: b.status, updated_at: new Date().toISOString() }).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `note_${data.status}`, entity_type: "supervisor_note", entity_id: data.id, entity_name: row.title?.slice(0, 80), hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
