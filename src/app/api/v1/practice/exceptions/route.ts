import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateSlots } from "@/lib/practice/availability-config";
import {
  calculateImpact, commitScheduleChange, resolveAffectedBooking, affectedBookingQueue,
  recalculateImpact,
} from "@/lib/practice/schedule-exceptions";
import { workspaceClock, dueDateFrom } from "@/lib/practice/practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 Phase 2 -- the write door for Layer 2. s13.1's second endpoint family, verbatim:
// "GET/POST/PATCH schedule exceptions; PREVIEW IMPACT BEFORE COMMIT."
//
// ---- THE PREVIEW IS A SEPARATE ACTION AND THE COMMIT DOES NOT TRUST IT ------------------------------
//
// `preview_impact` exists so a screen can show s5.3's count and patient-safe summary before anybody
// presses anything. `commit_change` RECALCULATES the same impact server-side rather than accepting the
// number the client just saw -- a count that arrived in a request body is a count somebody can edit, and
// the whole of AC-04 turns on the number being true at the moment of the write.
//
// ---- EVERY WRITE REGENERATES ITS OWN WINDOW BEFORE RETURNING ---------------------------------------
//
// s5.3 step 5: "Rebuild bookable availability and notify relevant operational workspaces." The only
// honest reading of that is that the response cannot come back before the diary agrees with the change.
// Generation is idempotent, so this costs a re-read rather than a duplicate.
//
// The regeneration is REPORTED, not assumed: if it fails, the change is still made -- it is committed and
// audited by then -- and the response says the diary has not caught up, rather than showing a tick.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const REGENERATE_DAYS = 90;
/**
 * ⚠ THE REGENERATION WINDOW IS THE PRACTICE'S, NOT THE SERVER'S.
 *
 * These were `today()` and `plusDays()` built from the server's UTC clock. The window they produce is
 * written into availability rows a patient then books against, so a window that opens on the wrong day
 * offers or withholds a day of appointments that the practice did not decide about.
 *
 * plusDays also added milliseconds to an instant rather than days to a calendar date; across a DST
 * change those are different answers.
 */
const regenerationWindow = async (admin: any, workspaceId: string) => {
  const { today } = await workspaceClock(admin, workspaceId);
  return { fromDate: today, toDate: dueDateFrom(today, REGENERATE_DAYS) };
};

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

/** s5.3's action queue. Everything unresolved, by name, newest change first. */
export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const queue = await affectedBookingQueue(auth.caller.admin, auth.ctx, {
    includeResolved: url.searchParams.get("includeResolved") === "1",
  });
  // ⚠ 503 RATHER THAN AN EMPTY ARRAY. An empty queue and an unreadable queue look identical to a screen
  // that is handed [] for both, and only one of them means nobody is waiting on a decision.
  if (queue.state !== "ok")
    return NextResponse.json({ error: { code: "QUEUE_UNREADABLE", message: queue.reason } }, { status: 503 });
  return NextResponse.json({ queue: queue.value, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const admin = auth.caller.admin;
  const ctx = auth.ctx;
  const actorId = auth.caller.userId;
  const correlationId = auth.caller.traceId;

  const regenerate = async () => generateSlots(admin, ctx, {
    ...(await regenerationWindow(auth.caller.admin, ctx.workspaceId)), actorId, correlationId,
  });

  switch (body.action) {
    // ══ s5.3 STEPS 1 AND 2: CALCULATE, AND PRESENT, BEFORE THE CHANGE IS COMMITTED ══════════════════
    case "preview_impact": {
      const r = await calculateImpact(admin, ctx, {
        kind: String(body.kind ?? ""),
        fromDate: String(body.fromDate ?? ""), toDate: String(body.toDate ?? ""),
        locationId: str(body.locationId),
        startsMinute: num(body.startsMinute), endsMinute: num(body.endsMinute),
        exceptionId: str(body.exceptionId),
      });
      // ⚠ A FAILED READ IS NEVER A ZERO, AND IT IS NEVER A 200 EITHER. A screen handed
      // `{ count: 0 }` for an outage would offer a Commit button under the words "nobody is affected".
      if (r.state !== "ok")
        return NextResponse.json({ error: { code: "IMPACT_UNREADABLE", message: r.reason } }, { status: 503 });
      return NextResponse.json({ impact: r.value, correlationId });
    }

    // ══ s5.3 STEPS 3, 4: REQUIRE A RESOLUTION, APPLY, CREATE ACTIONS, LOG ═══════════════════════════
    case "commit_change": {
      const r = await commitScheduleChange(admin, ctx, {
        kind: String(body.kind ?? ""),
        fromDate: String(body.fromDate ?? ""), toDate: String(body.toDate ?? ""),
        locationId: str(body.locationId), clinicId: str(body.clinicId),
        startsMinute: num(body.startsMinute), endsMinute: num(body.endsMinute),
        slotKind: body.slotKind ? String(body.slotKind) : undefined,
        appointmentMinutes: num(body.appointmentMinutes),
        reason: str(body.reason),
        replacementLocationId: str(body.replacementLocationId),
        replacementActivityType: str(body.replacementActivityType),
        resolution: str(body.resolution),
        note: str(body.note),
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      // ══ s5.3 STEP 5 ══
      const gen = await regenerate();
      return NextResponse.json({
        change: r.data,
        generation: gen.ok ? gen.data : null,
        generationFailed: gen.ok ? null : gen.message,
        correlationId,
      }, { status: 201 });
    }

    // ══ THE ACTION QUEUE: ONE PATIENT AT A TIME (s5.3's "patient-by-patient") ════════════════════════
    case "resolve_booking": {
      const r = await resolveAffectedBooking(admin, ctx, {
        actionId: String(body.actionId ?? ""),
        resolution: String(body.resolution ?? ""),
        note: str(body.note),
        rescheduledAppointmentId: str(body.rescheduledAppointmentId),
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      // Cancelling frees the time; the diary has to agree before the response comes back.
      const gen = r.data.cancelled ? await regenerate() : null;
      return NextResponse.json({ resolved: r.data, generation: gen && gen.ok ? gen.data : null, correlationId });
    }

    // ══ CATCH UP A CHANGE THAT WAS RECORDED BEFORE THE BOOKING EXISTED ══════════════════════════════
    //
    // s17: "Exception processing and notifications are RETRYABLE AND IDEMPOTENT." Running this twice
    // creates nothing the second time -- migration 242's unique index is the backstop, and the engine
    // reads the existing rows first so a re-run is a no-op rather than a 500.
    case "recalculate_impact": {
      const r = await recalculateImpact(admin, ctx, {
        exceptionId: String(body.exceptionId ?? ""), actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ recalculated: r.data, correlationId });
    }

    default:
      return NextResponse.json({
        error: "action must be one of: preview_impact, commit_change, resolve_booking, recalculate_impact",
      }, { status: 400 });
  }
}
