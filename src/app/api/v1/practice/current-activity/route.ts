import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { todaysPlan, planActivity, startActivity, endActivity } from "@/lib/practice/activity";

// GET  /api/v1/practice/current-activity  -- today's plan and what is running in it.
// POST /api/v1/practice/current-activity  -- { action: "plan" | "start" | "end", ... }
//
// NOT /api/v1/practice/activities. That route belongs to practice_clinical_activity, the retrospective
// portfolio record. Two different things called "activity" is already one too many; giving them the same
// endpoint would make it impossible to tell which one a caller meant.
//
// ONE CAPABILITY TO READ, ANOTHER TO CHANGE. Seeing the day and reshaping it are different jobs -- the
// engine checks both, and this route asks only for the lower one so a viewer gets the page rather than a
// 403 on a screen they are allowed to see.

export async function GET() {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

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
        : body.action === "end" ? await endActivity(admin, auth.ctx, String(body.id ?? ""), { correlationId: auth.caller.traceId })
          : { ok: false as const, status: 400, code: "UNKNOWN_ACTION", message: `no such action: ${body.action}` };

  if (!result.ok)
    return NextResponse.json({ error: result.message, code: result.code, correlationId: auth.caller.traceId },
      { status: result.status });

  // The refreshed plan comes back with the write, so the screen never has to guess what changed -- and
  // cannot draw a stale "current activity" for the moment between the write and the next read.
  const plan = await todaysPlan(admin, auth.ctx);
  return NextResponse.json({ ...result.value, plan, correlationId: auth.caller.traceId });
}
