import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, forbidden, badRequest } from "@/lib/api-auth";
import { loadMeetingInScope, meetingMigrationGate } from "@/lib/ogs/meeting-api";

// OGS-004 write-workflow — advance a meeting (start / hold / cancel) and record minutes.
// Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NEXT: Record<string, string[]> = { scheduled: ["in_progress", "cancelled"], in_progress: ["held", "cancelled"], held: [], cancelled: [] };

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Updating a meeting requires admin authority");
  const id = (await params).id;
  const { meeting, resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const b = await req.json().catch(() => ({}));
  const update: any = {};
  if (typeof b.status === "string") {
    if (!(NEXT[meeting.status] ?? []).includes(b.status)) return badRequest(`Cannot move a ${meeting.status} meeting to ${b.status}`);
    update.status = b.status;
    if (b.status === "held") update.held_at = new Date().toISOString();
  }
  if (typeof b.minutes === "string") update.minutes = b.minutes.trim() || null;
  if (!Object.keys(update).length) return badRequest("no valid fields");

  const { data, error } = await c.admin.from("ogs_meetings").update(update).eq("id", id).select("id, status").single();
  if (error) return meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: update.status ? `meeting_${update.status}` : "meeting_minutes", entity_type: "ogs_meeting", entity_id: id, hospital_id: meeting.hospital_id ?? null });
  return NextResponse.json(data);
}
