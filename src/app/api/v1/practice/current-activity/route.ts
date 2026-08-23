import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  todaysPlan, planActivity, startActivity, endActivity, pauseActivity, setActivityLocation, resumeActivity, sessionSummary,
} from "@/lib/practice/activity";

// GET  /api/v1/practice/current-activity  -- today's plan and what is running in it.
// GET  /api/v1/practice/current-activity?summary=<activityId>  -- CPR-V5-004's "Generate Summary".
// POST /api/v1/practice/current-activity
//      -- { action: "plan" | "start" | "pause" | "resume" | "end" | "set_location", ... }
//
// PAUSE AND RESUME LIVE HERE, NOT ON A ROUTE OF THEIR OWN. CPR-V5-004's lifecycle is one thing with six
// rungs, and the screen that draws Start also draws Pause -- splitting them across endpoints would give
// a page two places to hold a session id and two chances to disagree about which session it is in.
//
// THE SUMMARY IS A GET, because it is a read: it computes nothing that is not already in the rows, so a
// POST would imply the act of asking changed something. "Generate" in the spec is the practitioner's
// word for it, not a state transition.
//
// NOT /api/v1/practice/activities. That route belongs to practice_clinical_activity, the retrospective
// portfolio record. Two different things called "activity" is already one too many; giving them the same
// endpoint would make it impossible to tell which one a caller meant.
//
// ONE CAPABILITY TO READ, ANOTHER TO CHANGE. Seeing the day and reshaping it are different jobs -- the
// engine checks both, and this route asks only for the lower one so a viewer gets the page rather than a
// 403 on a screen they are allowed to see.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const summaryId = req.nextUrl.searchParams.get("summary");
  if (summaryId) {
    const summary = await sessionSummary(auth.caller.admin, auth.ctx, summaryId);
    if (!summary.ok)
      return NextResponse.json({ error: summary.message, code: summary.code, correlationId: auth.caller.traceId },
        { status: summary.status });
    return NextResponse.json({ summary: summary.value, correlationId: auth.caller.traceId });
  }

  const plan = await todaysPlan(auth.caller.admin, auth.ctx);
  return NextResponse.json({ plan, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== "string")
    return NextResponse.json({ error: "an action is required" }, { status: 400 });

  const admin = auth.caller.admin;
  const result =
    body.action === "plan"
      ? await planActivity(admin, auth.ctx, {
        activityType: body.activityType, title: body.title, planDate: body.planDate,
        plannedStartMinute: Number(body.plannedStartMinute), plannedEndMinute: Number(body.plannedEndMinute),
        facilityId: body.facilityId ?? null, locationId: body.locationId ?? null, room: body.room ?? null,
        // The trail's correlation id is the request's own trace id, so an audit entry and the response the
        // practitioner saw can be put beside each other afterwards.
      }, { correlationId: auth.caller.traceId })
      : body.action === "start" ? await startActivity(admin, auth.ctx, String(body.id ?? ""), { correlationId: auth.caller.traceId })
        : body.action === "pause" ? await pauseActivity(admin, auth.ctx, String(body.id ?? ""),
          // The reason is passed through as the practitioner typed it and normalised in the engine, so a
          // blank box and an absent field mean the same thing in one place rather than two.
          { reason: typeof body.reason === "string" ? body.reason : undefined, correlationId: auth.caller.traceId })
          : body.action === "resume" ? await resumeActivity(admin, auth.ctx, String(body.id ?? ""), { correlationId: auth.caller.traceId })
            : body.action === "end" ? await endActivity(admin, auth.ctx, String(body.id ?? ""), { correlationId: auth.caller.traceId })
              // Correcting where a session happened. A separate action rather than a field on `plan`,
              // because it applies to an activity that ALREADY EXISTS and often to one that is already
              // over -- and because a correction deserves its own audit event and its own refusals.
              : body.action === "set_location"
                ? await setActivityLocation(admin, auth.ctx, String(body.id ?? ""), {
                  locationId: String(body.locationId ?? ""),
                  reason: typeof body.reason === "string" ? body.reason : null,
                }, { correlationId: auth.caller.traceId })
              : { ok: false as const, status: 400, code: "UNKNOWN_ACTION", message: `no such action: ${body.action}` };

  if (!result.ok)
    return NextResponse.json({ error: result.message, code: result.code, correlationId: auth.caller.traceId },
      { status: result.status });

  // The refreshed plan comes back with the write, so the screen never has to guess what changed -- and
  // cannot draw a stale "current activity" for the moment between the write and the next read.
  const plan = await todaysPlan(admin, auth.ctx);
  return NextResponse.json({ ...result.value, plan, correlationId: auth.caller.traceId });
}
