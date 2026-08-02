import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { audit } from "@/lib/practice/provisioning";

// POST /api/v1/practice/availability -- block or open time (PEN-001 availability; CPR-003 "clinician
// availability, leave and blocked time"). Blocking is the practitioner statement "I am not seeing
// patients then"; the booking engine treats it as information for the diary view rather than a hard
// constraint, because walk-ins and emergencies do not respect calendars and the product must not
// pretend otherwise (ARCH s3 "speed before completeness").

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const startsAt = Date.parse(String(body.startsAt ?? ""));
  const endsAt = Date.parse(String(body.endsAt ?? ""));
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt)
    return NextResponse.json({ error: "startsAt and endsAt must be valid timestamps with endsAt after startsAt" }, { status: 400 });
  const status = ["OPEN", "BLOCKED", "CLOSED"].includes(String(body.status)) ? String(body.status) : "BLOCKED";

  const { data, error } = await auth.caller.admin.from("practice_availability_slot").insert({
    workspace_id: auth.ctx.workspaceId,
    location_id: body.locationId ? String(body.locationId) : null,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    status, note: body.note ? String(body.note).slice(0, 400) : null,
    created_by: auth.caller.userId,
  }).select("id, status").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await audit(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId,
    eventType: "practice.availability_recorded", payload: { slotId: data.id, status },
    correlationId: auth.caller.traceId,
  });
  return NextResponse.json({ slot: data, correlationId: auth.caller.traceId }, { status: 201 });
}
