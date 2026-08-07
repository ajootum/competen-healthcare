import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  publishReadiness, saveBookingAccess, setPublishState,
} from "@/lib/practice/patient-access";
import { returnStrandedFollowUp } from "@/lib/practice/follow-ups";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /api/v1/practice/booking-access -- CPR-V5-007 s13.1's "GET publish-readiness report", plus the two
// writes Phases 5 and 6 actually have a store for.
//
// ⚠ THE CAPABILITY IS s14's PUBLISHING ONE, NOT A BOOKING ONE. "Publish booking page -- account owner:
// yes; authorised staff: explicit permission only" is practice.settings.manage: the same capability that
// governs everything else deciding what this practice exposes to strangers. A front-desk delegate who
// may book patients in may not decide whether the outside world can.
//
// ⚠ EXCEPT FOR ONE ACTION. Returning a stranded follow-up to the queue is follow-up management, not
// publishing, so it is checked against followup.manage on the context rather than riding in on the
// route's capability. Two different acts behind one permission is how a delegate ends up with a
// permission nobody meant to give them.
//
// ⚠ PUBLISHING IS A PATCH AND CONFIGURING IS A POST, and they are different endpoints on purpose.
// migration 254 keeps `mode` and `publish_state` apart so that choosing "link only" is not itself an act
// of publishing; collapsing the two writes here would put the collapse back in the only place it still
// mattered.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const bool = (v: unknown) => (v === undefined ? undefined : v === true || v === "true");
const nullableText = (v: unknown) =>
  v === undefined ? undefined : (v === null || v === "" ? null : String(v));
const stringList = (v: unknown) =>
  v === undefined ? undefined : (Array.isArray(v) ? v.map(String) : []);

export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  const readiness = await publishReadiness(caller.admin, ctx);

  // 200 EVEN WHEN THE VERDICT IS not_ready OR cannot_say. A checklist that failed to be a checklist
  // would be a 4xx; a checklist reporting that the page is not ready is this endpoint working.
  return NextResponse.json({ readiness, correlationId: caller.traceId });
}

/** s8.1's access configuration. Never touches the handle and never touches the publish state. */
export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const { ctx, caller } = auth;

  if (body.action === "return_stranded_follow_up") {
    // ⚠ ITS OWN CAPABILITY, CHECKED HERE. See the header.
    if (!ctx.capabilities.includes("followup.manage"))
      return NextResponse.json({ error: "followup.manage is required" }, { status: 403 });
    const r = await returnStrandedFollowUp(caller.admin, {
      workspaceId: ctx.workspaceId,
      followUpId: String(body.followUpId ?? ""),
      note: body.note ? String(body.note) : undefined,
      actorId: caller.userId, correlationId: caller.traceId,
    });
    return r.ok
      ? NextResponse.json({ ...r.data, correlationId: caller.traceId })
      : NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  }

  const r = await saveBookingAccess(caller.admin, ctx, {
    mode: body.mode === undefined ? undefined : String(body.mode),
    otpRequired: bool(body.otpRequired),
    otpChannel: body.otpChannel === undefined ? undefined : String(body.otpChannel),
    guestBookingAllowed: bool(body.guestBookingAllowed),
    existingPatientMatching: bool(body.existingPatientMatching),
    visibleLocationIds: stringList(body.visibleLocationIds),
    visibleAppointmentTypes: stringList(body.visibleAppointmentTypes),
    brandDisplayName: nullableText(body.brandDisplayName),
    instructions: nullableText(body.instructions),
    privacyNotice: nullableText(body.privacyNotice),
    consentText: nullableText(body.consentText),
    consentRequired: bool(body.consentRequired),
    actorId: caller.userId, correlationId: caller.traceId,
  });
  return r.ok
    ? NextResponse.json({ ...r.data, correlationId: caller.traceId })
    : NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
}

/** s8.1's Draft / Ready / Published / Published-with-warnings / Paused. */
export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const { ctx, caller } = auth;
  const r = await setPublishState(caller.admin, ctx, {
    to: String(body.to ?? ""),
    acceptWarnings: body.acceptWarnings === true,
    actorId: caller.userId, correlationId: caller.traceId,
  });
  return r.ok
    ? NextResponse.json({ ...r.data, correlationId: caller.traceId })
    : NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
}
