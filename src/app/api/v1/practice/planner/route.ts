import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  moveActivity, duplicateActivity, splitActivity, extendActivity, shortenActivity,
  cancelActivity, changeActivityLocation, addActivityNotes,
} from "@/lib/practice/planner";
import { planActivity } from "@/lib/practice/activity";

/* eslint-disable @typescript-eslint/no-explicit-any -- one untyped JSON body, validated by the engines. */

// POST /api/v1/practice/planner -- CPR-V5-005 s5's actions on a planned block, and s9's quick add.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS ROUTE DECIDES NOTHING. Every rule -- may this block move, is that a conflict, is 300 characters
// too long for a cancellation reason -- lives in planner.ts, and the answer is returned to the caller
// WORD FOR WORD. A route that re-phrases "only 20 minutes between Aga Khan and Mulago, which needs 40"
// as "Bad request" throws away the only thing the practitioner needed to know, and a route that invents
// its own validation ends up refusing things the engine allows.
//
// ONE CAPABILITY: appointment.manage (migration 192), which is what activity.ts and planner.ts already
// gate this same lifecycle on. ⚠ NOT AN INVENTED CODE. A capability code is a string compared against
// practice_role_capabilities; `practice.planner.manage` would compile perfectly and 403 every user
// including the practice owner, and five invented codes have shipped in this product already.
//
// THE ENGINE IS GATED TOO. requirePracticeContext refuses first, and then every function below checks
// ctx.capabilities itself -- API enforcement must not rely on a route having remembered to ask.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The eight actions this route exposes, each bound to an exported engine function and nothing else. */
const ACTIONS = [
  "move", "duplicate", "split", "extend", "shorten", "cancel", "change_location", "add_notes", "plan",
] as const;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN);
const optNum = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : num(v));

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "invalid JSON" } }, { status: 400 }); }

  const action = str(body.action);
  if (!(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: `${action || "that"} is not a planner action` } },
      { status: 400 });

  const admin = auth.caller.admin;
  const ctx = auth.ctx;
  const opts = { correlationId: auth.caller.traceId } as const;
  const id = str(body.id);
  if (action !== "plan" && !id)
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "which activity?" } }, { status: 400 });

  const result = await (async () => {
    switch (action) {
      case "move":
        return moveActivity(admin, ctx, id, {
          planDate: body.planDate === undefined ? undefined : str(body.planDate),
          plannedStartMinute: optNum(body.plannedStartMinute),
          plannedEndMinute: optNum(body.plannedEndMinute),
        }, opts);
      case "duplicate":
        return duplicateActivity(admin, ctx, id, {
          toDates: Array.isArray(body.toDates) ? body.toDates.map(str) : [],
          plannedStartMinute: optNum(body.plannedStartMinute),
          plannedEndMinute: optNum(body.plannedEndMinute),
        }, opts);
      case "split":
        return splitActivity(admin, ctx, id, {
          atMinute: num(body.atMinute),
          secondTitle: body.secondTitle === undefined ? undefined : str(body.secondTitle),
        }, opts);
      case "extend":
        return extendActivity(admin, ctx, id, { byMinutes: num(body.byMinutes) }, opts);
      case "shorten":
        return shortenActivity(admin, ctx, id, { byMinutes: num(body.byMinutes) }, opts);
      case "cancel":
        return cancelActivity(admin, ctx, id, { reason: body.reason === undefined ? undefined : str(body.reason) }, opts);
      case "change_location":
        return changeActivityLocation(admin, ctx, id, {
          // null is meaningful and different from absent: it CLEARS the location, which a telephone
          // review legitimately has none of. `undefined` leaves it alone.
          locationId: body.locationId === undefined ? undefined : (body.locationId === null || body.locationId === "" ? null : str(body.locationId)),
          facilityId: body.facilityId === undefined ? undefined : (body.facilityId === null || body.facilityId === "" ? null : str(body.facilityId)),
          room: body.room === undefined ? undefined : (body.room === null ? null : str(body.room)),
        }, opts);
      case "add_notes":
        return addActivityNotes(admin, ctx, id, { notes: body.notes === null ? null : str(body.notes) }, opts);
      // s9's quick add. planActivity() is activity.ts's, not planner.ts's -- creating a block is the
      // LIFECYCLE's job and planner.ts deliberately owns only the seven-day read and the rewrites.
      case "plan":
      default:
        return planActivity(admin, ctx, {
          activityType: str(body.activityType),
          title: str(body.title),
          planDate: str(body.planDate),
          plannedStartMinute: num(body.plannedStartMinute),
          plannedEndMinute: num(body.plannedEndMinute),
          locationId: body.locationId ? str(body.locationId) : null,
          facilityId: body.facilityId ? str(body.facilityId) : null,
          room: body.room ? str(body.room) : null,
        }, opts);
    }
  })();

  if (!result.ok)
    return NextResponse.json(
      // VERBATIM. The engine wrote a sentence for a practitioner; it is not summarised here.
      { error: { code: result.code, message: result.message }, correlationId: auth.caller.traceId },
      { status: result.status });

  return NextResponse.json({ ok: true, value: result.value, correlationId: auth.caller.traceId });
}
