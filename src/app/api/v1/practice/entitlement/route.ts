import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { grantAccessPeriod, endAccess } from "@/lib/hq/entitlement";

// PATCH /api/v1/practice/entitlement -- CPR-PD-PROV-001 §7/§9: set a practice's access period.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE MOST CONSEQUENTIAL WRITE ON THE LANDLORD PLANE, and worth saying rather than leaving to the
// capability's name. This decides whether a clinician can open their own diary tomorrow morning. A
// wrongly-flipped feature flag is corrected; a wrongly-ended period turns a working practice into a
// locked one with patients already booked into it.
//
// So: its own capability (migration 367, hq.practice.commercial.manage -- NOT commercial.view, which is
// a reporting right, and NOT configuration.manage), a required reason, and an audit row on the
// PRACTICE's own trail carrying both sides (§13, §14).
//
// ⚠ TWO VERBS, NOT ONE FIELD. §9 requires extension and reactivation to APPEND a period and preserve
// history, while ending access is a transition on the current one. A single "set the dates" endpoint
// is what produced the first version of this, which quietly overwrote the trial it replaced.
//
// ⚠ hqApiGate RATHER THAN requireHqCapability: this is a fetch, and a redirect is not a status a caller
// can act on -- the reason the flags route records.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  const gate = await hqApiGate(["hq.practice.commercial.manage"]);
  if (isHqRefusal(gate)) return gate;

  let body: {
    action?: string; workspaceId?: string; status?: string;
    startsAt?: string; endsAt?: string | null; planCode?: string; reason?: string;
    // ⚠ ADR-015 rung 3: an explicit acknowledgement that this act overrides a live paid subscription.
    // Absent, an act that would REDUCE paid-for access is refused rather than performed quietly. It is
    // a separate field from `reason` on purpose -- a reason explains why, an acknowledgement admits what.
    overrideBilling?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const workspaceId = String(body.workspaceId ?? "").trim();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  const action = String(body.action ?? "");

  if (action === "grant") {
    // ⚠ `null` AND ABSENT ARE DIFFERENT ANSWERS, AND ONLY ONE IS VALID. Null is a deliberate open-ended
    // period; an absent field is a caller that did not say. §5: "Do not treat a missing end date as
    // unlimited access." The owner's decision was that the Director determines the period, so this
    // endpoint refuses rather than filling one in.
    if (!("endsAt" in body))
      return NextResponse.json({
        error: "endsAt is required: an instant for a period that ends, or null for open-ended access. "
          + "This endpoint does not choose a duration on your behalf.",
      }, { status: 400 });

    const r = await grantAccessPeriod(c.admin, {
      workspaceId,
      status: (body.status === "active" ? "active" : "trial"),
      planCode: String(body.planCode ?? "practice_trial"),
      // §5: "Starts now or an explicitly selected future start date/time."
      startsAt: body.startsAt ? String(body.startsAt) : new Date().toISOString(),
      endsAt: body.endsAt === null ? null : String(body.endsAt),
      reason: String(body.reason ?? ""),
      actorId: c.userId,
      correlationId: c.traceId,
      overrideBilling: body.overrideBilling === true,
    });
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    return NextResponse.json({
      ok: true, action: r.action, periodId: r.periodId, before: r.before, after: r.after,
      // The thing the Director actually wanted to know.
      grantsAccessNow: r.grantsAccessNow,
    });
  }

  if (action === "end") {
    const status = String(body.status ?? "");
    const r = await endAccess(c.admin, {
      workspaceId,
      status: (status === "suspended" ? "suspended" : status === "cancelled" ? "cancelled" : "expired"),
      reason: String(body.reason ?? ""),
      actorId: c.userId,
      correlationId: c.traceId,
      overrideBilling: body.overrideBilling === true,
    });
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    return NextResponse.json({
      ok: true, action: r.action, periodId: r.periodId, before: r.before, after: r.after,
      grantsAccessNow: r.grantsAccessNow,
    });
  }

  return NextResponse.json({ error: "action must be grant or end" }, { status: 400 });
}
