import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  listBookingRules, saveBookingRule, setRuleStatus, ruleVersionHistory,
  evaluateBooking, bookUnderRules, explainAppointment,
} from "@/lib/practice/booking-rules";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 Phase 3 -- the door for Layer 3's booking rules. s13.1's third, sixth and eighth endpoint
// families: "GET/POST/PATCH booking rules; validate and simulate", "POST practitioner/staff booking with
// RBAC AND OVERRIDE REASON", "GET scenario preview and RULE-EXPLANATION PAYLOAD".
//
// ---- NOTHING ABOUT A DECISION ARRIVES IN A BODY -----------------------------------------------------
//
// ⚠ THIS ROUTE READS NO ruleId, NO ruleVersion AND NO VERDICT FROM A REQUEST, and the omission is the
// feature. s13.1 says the rule is EVALUATED SERVER-SIDE, and the reason is the same one Phase 2's commit
// recalculates for: a decision that arrives in a request body is a decision somebody can edit. The body
// describes the booking -- who, when, where, what, which channel -- and the engine decides.
//
// The `evaluate` action exists so a screen can SHOW the decision before anybody presses anything. It is
// not a token: `book` runs the whole evaluation again, from the same function, at the moment of the
// write.
//
// ---- CAPABILITY IS CHECKED PER ACTION, NOT AT THE DOOR ----------------------------------------------
//
// The route takes no capability of its own, because the two this area needs belong to different people:
// s14 gives WRITING A RULE to the account owner and to staff only by explicit permission
// (practice.settings.manage), and MAKING A BOOKING to anybody permitted (appointment.manage). A practice
// owner who is not the clinician holds the first and not the second, and a front-desk delegate the
// reverse. A single door capability would lock one of them out of their own half.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  if (!ctx.capabilities.includes("appointment.manage") && !ctx.capabilities.includes("practice.settings.manage"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  const appointmentId = url.searchParams.get("appointmentId");

  if (ruleId) {
    const history = await ruleVersionHistory(caller.admin, ctx, ruleId);
    if (history.state !== "ok")
      return NextResponse.json({ error: { code: "HISTORY_UNREADABLE", message: history.reason } }, { status: 503 });
    return NextResponse.json({ history: history.value, correlationId: caller.traceId });
  }

  // AC-13's readback. A booking with no rule is a 200 saying so, never a blank.
  if (appointmentId) {
    const explained = await explainAppointment(caller.admin, ctx, appointmentId);
    if (explained.state !== "ok")
      return NextResponse.json({ error: { code: "EXPLANATION_UNREADABLE", message: explained.reason } }, { status: 503 });
    return NextResponse.json({ applied: explained.value, correlationId: caller.traceId });
  }

  const rules = await listBookingRules(caller.admin, ctx);
  // ⚠ 503 RATHER THAN AN EMPTY ARRAY. A screen handed [] for an outage would tell a practitioner that
  // nothing is refusing a booking today, which is the opposite of what it knows.
  if (rules.state !== "ok")
    return NextResponse.json({ error: { code: "RULES_UNREADABLE", message: rules.reason } }, { status: 503 });
  return NextResponse.json({ rules: rules.value, correlationId: caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const admin = auth.caller.admin;
  const ctx = auth.ctx;
  const actorId = auth.caller.userId;
  const correlationId = auth.caller.traceId;

  switch (body.action) {
    // ══ s7.2's BUILDER, AND s11's CONFLICT VALIDATION ═══════════════════════════════════════════════
    case "save_rule": {
      const r = await saveBookingRule(admin, ctx, {
        ruleId: str(body.ruleId),
        name: body.name === undefined ? undefined : str(body.name),
        description: body.description === undefined ? undefined : str(body.description),
        status: str(body.status),
        priority: num(body.priority),
        effectiveFrom: body.effectiveFrom === undefined ? undefined : str(body.effectiveFrom),
        effectiveTo: body.effectiveTo === undefined ? undefined : str(body.effectiveTo),
        locationId: body.locationId === undefined ? undefined : str(body.locationId),
        sessionTemplateId: body.sessionTemplateId === undefined ? undefined : str(body.sessionTemplateId),
        appointmentType: body.appointmentType === undefined ? undefined : str(body.appointmentType),
        channel: body.channel === undefined ? undefined : str(body.channel),
        capacityTotal: body.capacityTotal === undefined ? undefined : num(body.capacityTotal),
        capacityNew: body.capacityNew === undefined ? undefined : num(body.capacityNew),
        capacityFollowUp: body.capacityFollowUp === undefined ? undefined : num(body.capacityFollowUp),
        capacityUrgentReserve: body.capacityUrgentReserve === undefined ? undefined : num(body.capacityUrgentReserve),
        overbookingAllowed: num(body.overbookingAllowed),
        patientEligibility: str(body.patientEligibility),
        minAgeYears: body.minAgeYears === undefined ? undefined : num(body.minAgeYears),
        maxAgeYears: body.maxAgeYears === undefined ? undefined : num(body.maxAgeYears),
        confirmationMode: str(body.confirmationMode),
        followUpEarlyDays: body.followUpEarlyDays === undefined ? undefined : num(body.followUpEarlyDays),
        followUpLateDays: body.followUpLateDays === undefined ? undefined : num(body.followUpLateDays),
        leadTimeMinutes: num(body.leadTimeMinutes),
        bookingHorizonDays: body.bookingHorizonDays === undefined ? undefined : num(body.bookingHorizonDays),
        cancellationNoticeMinutes: num(body.cancellationNoticeMinutes),
        walkInDailyLimit: body.walkInDailyLimit === undefined ? undefined : num(body.walkInDailyLimit),
        reason: str(body.reason),
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ rule: r.data, correlationId }, { status: r.data.created ? 201 : 200 });
    }

    // ══ s7.1's CARD ACTIONS: pause, resume, archive. Activation runs the conflict test. ═════════════
    case "set_status": {
      const r = await setRuleStatus(admin, ctx, {
        ruleId: String(body.ruleId ?? ""), status: String(body.status ?? ""),
        reason: str(body.reason), actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ rule: r.data, correlationId });
    }

    // ══ s13.1's "rule-explanation payload". WHICH RULE WOULD DECIDE THIS, AND WHY (s11). ═══════════
    case "evaluate": {
      if (!ctx.capabilities.includes("appointment.manage") && !ctx.capabilities.includes("practice.settings.manage"))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const r = await evaluateBooking(admin, ctx, {
        channel: String(body.channel ?? ""),
        appointmentType: String(body.appointmentType ?? ""),
        scheduledAt: String(body.scheduledAt ?? ""),
        durationMinutes: num(body.durationMinutes),
        locationId: str(body.locationId),
        patientId: str(body.patientId),
        followUpId: str(body.followUpId),
        referred: body.referred === true,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ decision: r.data, correlationId });
    }

    // ══ s19's PHASE 3 EXIT CONDITION, AND s13.1's "with RBAC and override reason" ═══════════════════
    case "book": {
      const r = await bookUnderRules(admin, ctx, {
        channel: String(body.channel ?? ""),
        patientId: str(body.patientId),
        patientName: str(body.patientName),
        patientPhone: str(body.patientPhone),
        appointmentType: String(body.appointmentType ?? ""),
        scheduledAt: String(body.scheduledAt ?? ""),
        durationMinutes: num(body.durationMinutes),
        locationId: str(body.locationId),
        reason: str(body.reason),
        followUpId: str(body.followUpId),
        referred: body.referred === true,
        allowOverlap: body.allowOverlap === true,
        // ⚠ ONLY THE REASON IS READ. Nothing here lets a request say WHICH refusal it is lifting, or
        // that it is lifting one at all -- the engine decides what was refused and whether an override
        // may touch it.
        override: body.overrideReason ? { reason: String(body.overrideReason) } : null,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ booking: r.data, correlationId }, { status: 201 });
    }

    default:
      return NextResponse.json({
        error: "action must be one of: save_rule, set_status, evaluate, book",
      }, { status: 400 });
  }
}
