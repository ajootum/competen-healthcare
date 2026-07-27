import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, forbidden, badRequest } from "@/lib/api-auth";
import { loadMeetingInScope, meetingMigrationGate } from "@/lib/ogs/meeting-api";

// OGS-004 — meeting agenda items. POST appends an item; DELETE removes one. Admin-tier, tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ITEM_TYPES = ["discussion", "decision", "information"];
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = (await params).id;
  const { resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const b = await req.json().catch(() => ({}));
  const title = clean(b.title);
  if (!title) return badRequest("Agenda item title required");
  const itemType = ITEM_TYPES.includes(b.item_type) ? b.item_type : "discussion";
  const { count } = await c.admin.from("ogs_agenda_items").select("id", { count: "exact", head: true }).eq("meeting_id", id);

  const { data, error } = await c.admin.from("ogs_agenda_items").insert({ meeting_id: id, seq: (count ?? 0) + 1, title, description: clean(b.description), item_type: itemType, status: "pending" }).select("id").single();
  if (error) return meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = (await params).id;
  const { resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const itemId = new URL(req.url).searchParams.get("item");
  if (!itemId) return badRequest("item id required");
  const { data: item } = await c.admin.from("ogs_agenda_items").select("id, meeting_id").eq("id", itemId).maybeSingle();
  if (!item || item.meeting_id !== id) return NextResponse.json({ error: "Agenda item not found" }, { status: 404 });
  await c.admin.from("ogs_agenda_items").delete().eq("id", itemId);
  return NextResponse.json({ ok: true });
}
