import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { meetingMigrationGate } from "@/lib/ogs/meeting-api";

// OGS-004 write-workflow — schedule a meeting. POST creates an ogs_meetings row for an office, snapshots the
// office quorum, and auto-invites the office's active appointees as attendance (invited) so quorum tracks live.
// Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const MEETING_TYPES = ["regular", "extraordinary", "emergency"];
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Scheduling a meeting requires admin authority");

  const b = await req.json().catch(() => ({}));
  const officeId = typeof b.office_id === "string" ? b.office_id : "";
  const title = clean(b.title);
  if (!officeId) return badRequest("office_id required");
  if (!title) return badRequest("Meeting title required");
  const meetingType = MEETING_TYPES.includes(b.meeting_type) ? b.meeting_type : "regular";

  const { data: office, error: oErr } = await c.admin.from("ogs_offices").select("id, hospital_id, quorum, chair_id, chair_name").eq("id", officeId).maybeSingle();
  if (oErr) return meetingMigrationGate(oErr) ?? NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!office) return NextResponse.json({ error: "Office not found" }, { status: 404 });
  if (!isSuper(c) && office.hospital_id && office.hospital_id !== c.hospitalId) return forbidden("Office out of scope");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data: meeting, error } = await c.admin.from("ogs_meetings").insert({
    office_id: officeId, hospital_id: office.hospital_id ?? null, title, meeting_type: meetingType,
    scheduled_at: clean(b.scheduled_at), location: clean(b.location), status: "scheduled",
    required_quorum: office.quorum ?? 3, chaired_by: office.chair_id ?? null, chaired_by_name: office.chair_name ?? null, created_by: c.userId,
  }).select("id, title").single();
  if (error) return meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-invite the office's active appointees (so quorum tracks against real membership).
  const { data: appts } = await c.admin.from("ogs_office_appointments").select("person_id, person_name, role").eq("office_id", officeId).eq("status", "active").limit(500);
  const invites = ((appts ?? []) as any[]).filter(a => a.person_id).map(a => ({ meeting_id: meeting.id, person_id: a.person_id, person_name: a.person_name, role: a.role, status: "invited" }));
  if (invites.length) await c.admin.from("ogs_meeting_attendance").insert(invites);

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "schedule_meeting", entity_type: "ogs_meeting", entity_id: meeting.id, hospital_id: office.hospital_id ?? null, new_value: { title, office_id: officeId, invited: invites.length } });
  return NextResponse.json(meeting, { status: 201 });
}
