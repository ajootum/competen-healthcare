import { NextResponse } from "next/server";
import { isSuper, forbidden } from "@/lib/api-auth";

// Shared helper for the OGS meetings write routes — loads a meeting and asserts the caller may act on it
// (super = any; others = own hospital). Returns { meeting } or { resp } (a NextResponse to return).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const meetingMigrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migrations 118/119 to enable meetings" }, { status: 409 }) : null;

export async function loadMeetingInScope(c: any, id: string): Promise<{ meeting?: any; resp?: NextResponse }> {
  const { data: meeting, error } = await c.admin.from("ogs_meetings").select("id, office_id, hospital_id, status, required_quorum").eq("id", id).maybeSingle();
  if (error) return { resp: meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!meeting) return { resp: NextResponse.json({ error: "Meeting not found" }, { status: 404 }) };
  if (!isSuper(c) && meeting.hospital_id && meeting.hospital_id !== c.hospitalId) return { resp: forbidden("Meeting out of scope") };
  return { meeting };
}
