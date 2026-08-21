import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { locationForDay } from "@/lib/practice/session-location";


// GET /api/v1/practice/follow-ups/place-for-day?date=YYYY-MM-DD
//
// Walkthrough 2026-08-16 #6: "choose the follow-up place based on our calendar and have that
// automatically filled." The regular week (the calendar's own template) already knows where the
// practitioner is on a given weekday; this door answers it for one date so the Add-follow-up form
// can suggest the place the moment a target date resolves.
//
// ⚠ TWO ID SPACES, BRIDGED BY NAME AND SAID OUT LOUD. The regular week names a practice_location;
// a follow-up stores a practice_facility (migration 299's FK). They are different tables with
// different ids, so the ONLY honest bridge today is the normalised name -- when exactly one active
// facility carries the same name as the derived location, facilityId is returned and the form may
// preselect it. When none (or several) match, facilityId is null and the SENTENCE still tells the
// practitioner where the calendar puts them, which is the part they asked for. Unifying the two
// tables is a data-model decision for the owner, not something a suggestion endpoint smuggles in.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("followup.manage");
  if (isDenied(auth)) return auth;

  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const timezone = auth.ctx.workspaceTimezone;
  const place = await locationForDay(auth.caller.admin, auth.ctx.workspaceId, date, timezone);

  let facilityId: string | null = null;
  if (place.derived && place.locationName) {
    const normalised = place.locationName.trim().toLowerCase().replace(/\s+/g, " ");
    const { data: matches } = await auth.caller.admin.from("practice_facility")
      .select("id").eq("workspace_id", auth.ctx.workspaceId)
      .eq("name_normalised", normalised).limit(2);
    if ((matches ?? []).length === 1) facilityId = matches![0].id;
  }

  return NextResponse.json({
    date, sentence: place.sentence, locationName: place.locationName,
    derived: place.derived, facilityId, correlationId: auth.caller.traceId,
  });
}
