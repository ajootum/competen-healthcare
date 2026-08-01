import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, forbidden, badRequest } from "@/lib/api-auth";
import { loadMeetingInScope, meetingMigrationGate } from "@/lib/ogs/meeting-api";

// OGS-004 write-workflow — action items arising from a meeting. POST adds one; PATCH advances its status.
// Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTION_STATUS = ["open", "in_progress", "completed", "cancelled"];
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = (await params).id;
  const { meeting, resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const b = await req.json().catch(() => ({}));
  const title = clean(b.title);
  if (!title) return badRequest("Action title required");
  let ownerName: string | null = null;
  const ownerId = typeof b.owner_id === "string" && b.owner_id ? b.owner_id : null;
  if (ownerId) { const { data: o } = await c.admin.from("profiles").select("full_name").eq("id", ownerId).maybeSingle(); ownerName = o?.full_name ?? null; }

  const { data, error } = await c.admin.from("ogs_office_actions").insert({ office_id: meeting.office_id, meeting_id: id, hospital_id: meeting.hospital_id ?? null, title, description: clean(b.description), owner_id: ownerId, owner_name: ownerName, due_date: clean(b.due_date), status: "open" }).select("id").single();
  if (error) return meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "add_office_action", entity_type: "ogs_office_action", entity_id: data.id, hospital_id: meeting.hospital_id ?? null, new_value: { title } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = (await params).id;
  const { meeting, resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const actionId = new URL(req.url).searchParams.get("action");
  if (!actionId) return badRequest("action id required");
  const b = await req.json().catch(() => ({}));
  if (!ACTION_STATUS.includes(b.status)) return badRequest("invalid status");
  const { data: action } = await c.admin.from("ogs_office_actions").select("id, meeting_id").eq("id", actionId).maybeSingle();
  if (!action || action.meeting_id !== id) return NextResponse.json({ error: "Action not found" }, { status: 404 });

  const update: any = { status: b.status };
  if (b.status === "completed") update.completed_at = new Date().toISOString();
  const { data, error } = await c.admin.from("ogs_office_actions").update(update).eq("id", actionId).select("id, status").single();
  if (error) return meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: `action_${b.status}`, entity_type: "ogs_office_action", entity_id: actionId, hospital_id: meeting.hospital_id ?? null });
  return NextResponse.json(data);
}
