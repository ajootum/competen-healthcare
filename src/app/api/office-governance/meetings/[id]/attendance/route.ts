import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, forbidden, badRequest } from "@/lib/api-auth";
import { loadMeetingInScope } from "@/lib/ogs/meeting-api";

// OGS-004 — mark meeting attendance (drives live quorum). Admin-tier, tenant-scoped.

const ATT_STATUS = ["invited", "present", "apologies", "absent"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = (await params).id;
  const { resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const attId = new URL(req.url).searchParams.get("attendance");
  if (!attId) return badRequest("attendance id required");
  const b = await req.json().catch(() => ({}));
  if (!ATT_STATUS.includes(b.status)) return badRequest("invalid attendance status");

  const { data: att } = await c.admin.from("ogs_meeting_attendance").select("id, meeting_id").eq("id", attId).maybeSingle();
  if (!att || att.meeting_id !== id) return NextResponse.json({ error: "Attendee not found" }, { status: 404 });
  const { data, error } = await c.admin.from("ogs_meeting_attendance").update({ status: b.status }).eq("id", attId).select("id, status").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
