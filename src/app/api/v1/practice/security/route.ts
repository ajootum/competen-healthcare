import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { hasCapability } from "@/lib/practice/access";
import {
  securityPosture, updateSecurityPolicy, listSessions, revokeSession, setDeviceTrusted,
  recordConsent, withdrawConsent, patientConsents,
  breakGlass, endBreakGlass, reviewBreakGlass, breakGlassLog,
} from "@/lib/practice/security";

// GET   /api/v1/practice/security                  -- the posture: counts, guarantees, and what is not
//                                                     knowable from here
// GET   /api/v1/practice/security?view=sessions    -- devices signed in to this practice
// GET   /api/v1/practice/security?view=breakglass  -- every emergency-access episode
// GET   /api/v1/practice/security?patientId=       -- one patient's consents
// POST  /api/v1/practice/security                  -- take emergency access, or record a consent
// PATCH /api/v1/practice/security                  -- policy, revoke, trust, withdraw, end, review
//
// BREAK-GLASS NEEDS NO CAPABILITY, BY DESIGN. The person invoking it is by definition somebody who
// lacks the access they need; requiring a capability to declare an emergency would make the feature
// useless exactly when it matters. Membership is the check, and it is done in the engine.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const patientId = url.searchParams.get("patientId");

  if (patientId) {
    if (!hasCapability(auth.ctx, "patient.view"))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await patientConsents(auth.caller.admin, auth.ctx.workspaceId, patientId);
    // ⚠ `readable` TRAVELS TO THE CLIENT. An empty consent array is the answer somebody checks before
    // sharing a record, so a caller must be able to tell "this patient has consented to nothing" from
    // "the consents could not be read".
    return NextResponse.json({
      consents: result.consents, readable: result.readable, correlationId: auth.caller.traceId,
    }, { status: result.readable ? 200 : 503 });
  }

  switch (url.searchParams.get("view")) {
    case "sessions": {
      // Everybody may see THEIR OWN devices; seeing the whole practice's is administration.
      const all = hasCapability(auth.ctx, "practice.settings.manage");
      const list = await listSessions(auth.caller.admin, auth.ctx.workspaceId,
        all ? {} : { userId: auth.caller.userId });
      // THE LIMIT TRAVELS WITH THE LIST. A client cannot render "revoke" as "sign out everywhere".
      // AND SO DOES THE READ STATE, with a 503 behind it: an empty device list served as 200 tells a
      // client there are no devices, which is exactly what a failed read used to look like from here.
      return NextResponse.json({
        sessions: list.sessions, readable: list.readable, namesReadable: list.namesReadable,
        truncated: list.truncated, scope: all ? "practice" : "mine",
        revocationEndsPlatformSession: false,
        correlationId: auth.caller.traceId,
      }, { status: list.readable ? 200 : 503 });
    }
    case "breakglass": {
      if (!hasCapability(auth.ctx, "access.review"))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const log = await breakGlassLog(auth.caller.admin, auth.ctx.workspaceId);
      return NextResponse.json({ ...log, correlationId: auth.caller.traceId },
        { status: log.readable ? 200 : 503 });
    }
    default: {
      if (!hasCapability(auth.ctx, "practice.settings.manage"))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const posture = await securityPosture(auth.caller.admin, auth.ctx.workspaceId);
      return NextResponse.json({ ...posture, correlationId: auth.caller.traceId });
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const ctx = { workspaceId: auth.ctx.workspaceId, correlationId: auth.caller.traceId };
  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.breakGlass) {
    // No capability check: see the header.
    const result = await breakGlass(auth.caller.admin, {
      ...ctx, userId: auth.caller.userId, reason: String(body.breakGlass.reason ?? ""),
      patientId: body.breakGlass.patientId ?? null,
    });
    if (!result.ok) return fail(result);
    // What it granted and when it dies, both in the response -- somebody taking emergency access should
    // see its shape immediately, not discover it when access stops.
    return NextResponse.json({ breakGlass: result.data, reviewRequired: true, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (!hasCapability(auth.ctx, "patient.edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await recordConsent(auth.caller.admin, {
    ...ctx, patientId: String(body.patientId ?? ""), consentType: String(body.consentType ?? ""),
    scope: body.scope, grantedOn: body.grantedOn, expiresOn: body.expiresOn ?? null,
    evidence: body.evidence, actorId: auth.caller.userId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ consent: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const ctx = { workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId, correlationId: auth.caller.traceId };
  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
  const needs = (c: string) => hasCapability(auth.ctx, c);

  // Trusting a device is the one action here that is nobody's business but the user's own -- checked
  // first so the administrative guards below never stand in front of it.
  if (body.trustSessionId !== undefined) {
    const result = await setDeviceTrusted(auth.caller.admin, {
      ...ctx, sessionId: String(body.trustSessionId), trusted: body.trusted === true, label: body.label,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  if (body.reviewBreakGlassId) {
    if (!needs("access.review")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await reviewBreakGlass(auth.caller.admin, {
      ...ctx, breakGlassId: String(body.reviewBreakGlassId), note: String(body.note ?? ""),
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  if (body.endBreakGlassId) {
    // Ending your own early needs nothing; ending somebody else's is administration.
    const result = await endBreakGlass(auth.caller.admin, { ...ctx, breakGlassId: String(body.endBreakGlassId) });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  if (body.withdrawConsentId) {
    if (!needs("patient.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await withdrawConsent(auth.caller.admin, {
      ...ctx, consentId: String(body.withdrawConsentId), reason: String(body.reason ?? ""),
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  if (!needs("practice.settings.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (body.revokeSessionId) {
    const result = await revokeSession(auth.caller.admin, {
      ...ctx, sessionId: String(body.revokeSessionId), reason: body.reason,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  const result = await updateSecurityPolicy(auth.caller.admin, {
    ...ctx,
    mfaRequired: body.mfaRequired === undefined ? undefined : body.mfaRequired === true,
    breakGlassEnabled: body.breakGlassEnabled === undefined ? undefined : body.breakGlassEnabled === true,
    breakGlassMinutes: body.breakGlassMinutes === undefined ? undefined : Number(body.breakGlassMinutes),
    sessionIdleMinutes: body.sessionIdleMinutes === undefined ? undefined
      : (body.sessionIdleMinutes === null ? null : Number(body.sessionIdleMinutes)),
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
