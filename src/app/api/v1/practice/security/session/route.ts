import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { createClient } from "@/lib/supabase/server";
import { touchSession, type TouchOutcome } from "@/lib/practice/security";
import { DEVICE_COOKIE } from "@/lib/practice/device-register";
import { AUTH_EVENT, recordAuthEvent, signInOccasion } from "@/lib/practice/auth-audit";
import {
  LOCK_CAUSE, SESSION_ACTIONS, touchesSession, type LockCause, type SessionAction,
} from "@/lib/practice/session-engine";

// POST /api/v1/practice/security/session -- the four things the browser's session engine says.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ NOTHING THIS ROUTE DOES CAN LOCK ANYBODY OUT, AND ONE THING IT DOES PREVENTS A LOCKOUT.
//
//   heartbeat     this session is in ACTIVE USE. Refreshes `practice_session.last_seen_at`.
//   locked        a screen was covered -- idle, or somebody pressed pause. Audit only.
//   unlocked      a covered screen was reopened by re-entering a password. Audit, AND a touch.
//   idle_observed this session sat unused past the observation window while no limit was set. Audit only.
//
// THE HEARTBEAT IS THE SAFETY MECHANISM, NOT THE FEATURE. Before it, `last_seen_at` moved only when a
// whole page loaded. A clinician writing a note for twenty-five minutes under a twenty-minute idle limit
// was working the entire time and was revoked by `touchSession` the moment they navigated -- the control
// could not tell "sitting unused" from "in continuous use on one page". A beat sent on real activity is
// what tells the two apart, so switching an idle limit on is a far smaller act than it was yesterday.
//
// ⚠ AND `unlocked` DOES SOMETHING THAT MATTERS MORE THAN THE AUDIT ROW. The lock screen resumes by
// calling `signInWithPassword`, so by the time this request arrives GoTrue has stamped a NEW
// `last_sign_in_at`. Handing that to `touchSession` is what lifts an idle lock-out applied while the
// screen was covered (commit 083a5770's resume path, discriminated on `revoked_by IS NULL`). Without it,
// unlocking would be cosmetic: the cover would lift and the very next navigation would bounce the person
// to /practice/access-status. A device a PERSON revoked is still refused, which is the point of that
// discriminator, and the client is told so and sent to the screen that explains it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO CAPABILITY IS REQUIRED. Everything here is a statement about the caller's own browser and their own
// session. Requiring a capability would mean a member without it could never keep their own session
// alive, which would turn a permission into an idle lockout.

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "") as SessionAction;
  if (!SESSION_ACTIONS.includes(action))
    return NextResponse.json({ error: `action must be one of: ${SESSION_ACTIONS.join(", ")}` }, { status: 400 });

  // GoTrue's own record of when this person last authenticated. It is the identity of a sign-in -- both
  // the deduplication key for every row below and, for `unlocked`, the proof that they authenticated
  // AFTER an idle lock-out was applied.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const lastSignInAt = (user as { last_sign_in_at?: string | null } | null)?.last_sign_in_at ?? null;
  const occasion = signInOccasion(lastSignInAt);

  const admin = auth.caller.admin;
  const workspaceId = auth.ctx.workspaceId;
  const correlationId = auth.caller.traceId;

  // ⚠ THE CAUSE IS THE ONLY THING THE CLIENT DECIDES, AND IT IS CLAMPED TO THE TWO THAT EXIST. Anything
  // else would let a browser write an event type of its own choosing into the authentication trail.
  const cause: LockCause = body.cause === LOCK_CAUSE.PAUSED ? LOCK_CAUSE.PAUSED : LOCK_CAUSE.IDLE;

  if (action === "locked" || action === "unlocked" || action === "idle_observed") {
    // ⚠ THE DEDUPLICATION DISCRIMINATOR IS THE SERVER'S CLOCK, NEVER THE CLIENT'S.
    //
    // Each lock, unlock and idle stretch is its own occasion and must produce its own row -- but two
    // posts of the same one (a retry, a double-fired effect) must not. A second's resolution separates
    // genuine events and collapses accidental repeats. Taking the moment from the request body would
    // hand a browser the ability to overwrite -- or to endlessly multiply -- rows in an audit trail.
    const second = new Date().toISOString().slice(0, 19);
    const type = action === "unlocked" ? AUTH_EVENT.WORKSPACE_UNLOCKED
      : action === "locked" ? AUTH_EVENT.WORKSPACE_LOCKED
        : AUTH_EVENT.IDLE_OBSERVED;

    const idleMinutes = Number(body.idleMinutes);
    const outcome = await recordAuthEvent(admin, {
      workspaceId, actorId: auth.caller.userId, eventType: type,
      dedupeKey: `${occasion.key}:${action}:${cause}:${second}`,
      payload: {
        authSignInAt: occasion.authSignInAt,
        ...(type === AUTH_EVENT.IDLE_OBSERVED
          // Reported by the browser, so it is labelled as such: the server did not measure this and
          // cannot check it. A number nobody can check must not be presented as if the server produced it.
          ? {
            idleMinutes: Number.isFinite(idleMinutes) && idleMinutes >= 0 ? Math.round(idleMinutes) : null,
            measuredBy: "browser", enforced: false, refused: false,
          }
          : { cause }),
      },
      correlationId,
    });

    // ⚠ UNLOCKING TOUCHES THE SESSION; THE OTHER TWO DO NOT, AND `touchesSession` IS WHERE THAT IS
    // DECIDED -- not by an `if` written out here, where nothing could prove it. `locked` and
    // `idle_observed` must never refresh `last_seen_at`: a covered or abandoned screen reporting itself
    // as in use would defeat the very rule it is reporting on.
    if (touchesSession(action)) {
      const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
      // The same shape either way, so the response below cannot accidentally report a device check that
      // did not happen as one that passed: no cookie means `checked: false`, never `allowed` on its own.
      const session: TouchOutcome = deviceId
        ? await touchSession(admin, {
          workspaceId, userId: auth.caller.userId, deviceId,
          userAgent: req.headers.get("user-agent"), authSignInAt: lastSignInAt, correlationId,
        })
        : { allowed: true, checked: false };

      return NextResponse.json({
        recorded: outcome.recorded,
        // ⚠ THREE STATES, NOT TWO. `checked: false` means the register did not run, so `allowed: true`
        // beside it is "not refused" rather than "checked and cleared", and the client must not render
        // it as a clean bill of health.
        allowed: session.allowed, checked: session.checked, reason: session.reason ?? null,
        resumed: session.resumed === true,
        correlationId,
      }, { status: session.allowed ? 200 : 423 });
    }

    return NextResponse.json({ recorded: outcome.recorded, correlationId });
  }

  // ── heartbeat ──────────────────────────────────────────────────────────────────────────────────────
  //
  // No audit row. A beat is not an event: one per two minutes per open tab would bury every real row in
  // the trail, and the fact it carries -- "this session was in use at this moment" -- is already written
  // to `practice_session.last_seen_at`, which is where the idle rule reads it from.
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  if (!deviceId) {
    // The register cannot run without the cookie the proxy plants. Said rather than passed over: a
    // browser that never gets a device row is a browser the idle rule can never see, and the client
    // shows nothing rather than a countdown that means nothing.
    return NextResponse.json({
      allowed: true, checked: false, reason: null, deviceCookiePresent: false, correlationId,
    });
  }

  const session = await touchSession(admin, {
    workspaceId, userId: auth.caller.userId, deviceId,
    userAgent: req.headers.get("user-agent"), authSignInAt: lastSignInAt, correlationId,
  });

  return NextResponse.json({
    allowed: session.allowed, checked: session.checked, reason: session.reason ?? null,
    deviceCookiePresent: true, correlationId,
  }, { status: session.allowed ? 200 : 423 });
}
