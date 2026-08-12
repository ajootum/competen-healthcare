import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { logAccess } from "@/lib/practice/privacy";
import { AUTH_EVENT, authTrailSummary, recordAuthEvent } from "@/lib/practice/auth-audit";
import {
  resolveSessionLimits, ABSOLUTE_LIFETIME_NOT_ENFORCED, RESUME_METHODS_NOT_BUILT,
  LOCK_SCREEN_TRUTHS, CLINICAL_PAUSE,
} from "@/lib/practice/session-engine";

// CPR-370's five unbuilt capabilities: sessions, devices, consent, break-glass and the MFA policy.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NOTHING IN THIS FILE MAY OVERSTATE WHAT IT DOES.
//
// A security control that claims more than it enforces is worse than an absent one, because somebody
// stops worrying on the strength of it. Every function here returns what it actually did, and the two
// places where this product's reach ends -- the auth token and the platform's MFA enrolment -- are named
// in the payload, not only in a comment.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// REVOKING A SESSION LOCKS THE PRACTICE, NOT THE PLATFORM. resolvePracticeShell checks this register on
// every request and refuses a revoked device, so the lockout is immediate and real -- but the person is
// still signed in to Competen. A "sign out this device" button that quietly did nothing would be the
// most dangerous thing this module could ship: somebody would press it after losing a laptop and believe
// the problem was solved.
//
// BREAK-GLASS IS SELF-GRANTED, AND THAT IS DELIBERATE. CPR-310 forbids granting yourself a capability;
// this is the one place in the product where the opposite is right, because the situation it exists for
// is precisely the one where nobody is available to approve it. What makes it safe is not approval but
// the other three properties: a reason, an expiry, and being impossible to do quietly.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const CONSENT_TYPES = [
  ["treatment", "Treatment"],
  ["data_holding", "Holding their record"],
  ["data_sharing", "Sharing with a named party"],
  ["contact", "Being contacted"],
  ["photography", "Clinical photography"],
  ["research", "Research"],
  ["other", "Other"],
] as const;

/**
 * What break-glass may grant.
 *
 * DELIBERATELY THE READ CAPABILITIES ONLY. An emergency is a reason to SEE a record, not a reason to
 * sign one: a clinician who needs to write can start their own encounter, which is an ordinary act with
 * their own name on it. Granting document.sign in an emergency would let somebody issue a certificate
 * under cover of a reason nobody has reviewed yet.
 */
export const BREAK_GLASS_CAPABILITIES = [
  "patient.list", "patient.view", "encounter.list", "document.view", "followup.view",
] as const;

// ── THE POLICY ───────────────────────────────────────────────────────────────────────────────────────

export type SecurityPolicy = {
  workspace_id: string;
  mfa_required: boolean;
  break_glass_enabled: boolean;
  break_glass_minutes: number;
  session_idle_minutes: number | null;
  /**
   * DID THESE VALUES COME OUT OF THE DATABASE ON THIS CALL? When false, everything beside it is a
   * placeholder holding the shape -- not an answer, and never a permission.
   */
  readable: boolean;
  [key: string]: any;
};

/**
 * This practice's security policy, in THREE STATES rather than two: read, created, or UNREADABLE.
 *
 * ⚠ THIS USED TO DISCARD BOTH ERRORS. An unreadable table fell through to a hardcoded default of
 * `mfa_required: false, break_glass_enabled: true` -- so a transient database fault turned the second
 * factor OFF and emergency access ON for that request, with nothing anywhere saying so. The comment
 * that justified those defaults ("a migration must never lock a practice out of itself") is right about
 * a MISSING row and wrong about a FAILED READ, and the two shared one branch.
 *
 * They are separate now. A missing row is still created permissively, because a practice that has never
 * set a policy genuinely has none. A failed read returns the same shape with `readable: false`, and
 * every caller that makes a decision on it CHECKS THAT FIELD -- see resolvePracticeShell, breakGlass
 * and updateSecurityPolicy, each of which refuses rather than guessing.
 */
export async function getSecurityPolicy(admin: any, workspaceId: string): Promise<SecurityPolicy> {
  const unreadable = (): SecurityPolicy => ({
    workspace_id: workspaceId, mfa_required: false, break_glass_enabled: true,
    break_glass_minutes: 60, session_idle_minutes: null, readable: false,
  });

  const { data, error } = await admin.from("practice_security_policy")
    .select("*").eq("workspace_id", workspaceId).maybeSingle();
  // A FAILED READ IS NOT AN ABSENT ROW. Falling through to the insert below would, on a read fault,
  // either fabricate a permissive default or write over a policy this practice actually set.
  if (error) return unreadable();
  if (data) return { ...data, readable: true };

  // No error and no row: nobody has ever set a policy here. MFA off, break-glass on -- off for MFA
  // because a migration must never lock a practice out of itself.
  const { data: created } = await admin.from("practice_security_policy")
    .insert({ workspace_id: workspaceId }).select("*").single();
  if (created) return { ...created, readable: true };

  // The insert produced no row. The likeliest cause is two requests creating it at once, in which case
  // the row now EXISTS and can be read -- so read it rather than guessing at its contents. Only a
  // second failure is genuinely unreadable.
  const { data: raced } = await admin.from("practice_security_policy")
    .select("*").eq("workspace_id", workspaceId).maybeSingle();
  return raced ? { ...raced, readable: true } : unreadable();
}

export async function updateSecurityPolicy(admin: any, args: {
  workspaceId: string; mfaRequired?: boolean; breakGlassEnabled?: boolean;
  breakGlassMinutes?: number; sessionIdleMinutes?: number | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ changed: string[] }>> {
  const current = await getSecurityPolicy(admin, args.workspaceId);
  // AN UNREADABLE POLICY CANNOT BE DIFFED. Every branch below compares against `current`, so proceeding
  // on placeholder values would decide "nothing was different" against numbers nobody set, and audit a
  // `from` that was never true -- in the one record an incident is reconstructed from.
  if (!current.readable)
    return {
      ok: false, status: 503, code: "POLICY_UNREADABLE",
      message: "this practice's security policy could not be read just now, so nothing was changed. Try again.",
    };
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];

  if (args.mfaRequired !== undefined && args.mfaRequired !== current.mfa_required) {
    patch.mfa_required = args.mfaRequired; changed.push("mfaRequired");
  }
  if (args.breakGlassEnabled !== undefined && args.breakGlassEnabled !== current.break_glass_enabled) {
    patch.break_glass_enabled = args.breakGlassEnabled; changed.push("breakGlassEnabled");
  }
  if (args.breakGlassMinutes !== undefined && args.breakGlassMinutes !== current.break_glass_minutes) {
    if (!Number.isInteger(args.breakGlassMinutes) || args.breakGlassMinutes < 5 || args.breakGlassMinutes > 1440)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "emergency access must last between 5 minutes and 24 hours" };
    patch.break_glass_minutes = args.breakGlassMinutes; changed.push("breakGlassMinutes");
  }
  if (args.sessionIdleMinutes !== undefined && args.sessionIdleMinutes !== current.session_idle_minutes) {
    if (args.sessionIdleMinutes !== null && (!Number.isInteger(args.sessionIdleMinutes) || args.sessionIdleMinutes < 5 || args.sessionIdleMinutes > 43200))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an idle limit must be between 5 minutes and 30 days, or none at all" };
    patch.session_idle_minutes = args.sessionIdleMinutes; changed.push("sessionIdleMinutes");
  }

  if (changed.length === 0)
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const { error } = await admin.from("practice_security_policy")
    .update({ ...patch, updated_at: nowIso(), updated_by: args.actorId }).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  // A SECURITY POLICY CHANGE IS ALWAYS AUDITED, with both values. "MFA is required" does not answer
  // "when did that start" -- which is the question after an incident.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.security_policy_changed",
    payload: { changed, from: { mfaRequired: current.mfa_required }, to: patch },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { changed } };
}

// ── THE MFA GATE ─────────────────────────────────────────────────────────────────────────────────────

/** What `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` answers with, or null when it was not asked. */
export type AalReading = {
  data: { currentLevel: string | null; nextLevel: string | null } | null;
  error: unknown;
} | null;

export type MfaGateDecision =
  | { decision: "OPEN" }
  | { decision: "REFUSE"; enrolled: boolean }
  | { decision: "UNAVAILABLE"; check: "mfa_policy" | "mfa_status" };

/**
 * THE DECISION BEHIND GUARD 8, SEPARATED FROM THE REQUEST SO IT CAN BE PROVED.
 *
 * ⚠ THREE ANSWERS, NEVER TWO: open, refuse, or could-not-tell. The version this replaces had two, and
 * collapsed the third into the first -- `const { data: aal } = await …getAuthenticatorAssuranceLevel()`
 * discarded the error, and since `data` is null on failure the guard's `aal &&` short-circuited and the
 * practice OPENED. A failed check read as a passed one, in the one place the whole control lives.
 *
 * Refuse and could-not-tell are kept apart just as carefully, because they need different screens: a
 * refusal means go and enrol a factor, and could-not-tell means try again in a moment. Telling somebody
 * to enrol because a database read timed out would be an instruction they cannot act on -- and this
 * product has no enrolment screen to send them to in the first place.
 */
export function mfaGate(input: {
  policyReadable: boolean;
  mfaRequired: boolean;
  aal: AalReading;
}): MfaGateDecision {
  // An unreadable policy cannot say MFA is off. It cannot say anything.
  if (!input.policyReadable) return { decision: "UNAVAILABLE", check: "mfa_policy" };
  if (!input.mfaRequired) return { decision: "OPEN" };

  // `data` present with `currentLevel: null` is a REAL answer -- it is what a session-less caller gets --
  // and it refuses. Only `data: null`, or an error beside it, means the question went unanswered.
  if (!input.aal || input.aal.error || !input.aal.data) return { decision: "UNAVAILABLE", check: "mfa_status" };
  if (input.aal.data.currentLevel !== "aal2")
    return { decision: "REFUSE", enrolled: input.aal.data.nextLevel === "aal2" };
  return { decision: "OPEN" };
}

// ── SESSIONS AND DEVICES ─────────────────────────────────────────────────────────────────────────────

/**
 * The reason string an idle lock-out writes, and the only one this module will ever undo.
 *
 * ⚠ IT IS HALF OF A DISCRIMINATOR, NOT A LABEL. A device locked out BY A PERSON must never be reinstated
 * by anything other than a person; a device locked out by the clock may be, because re-authenticating is
 * the correct answer to "you were away too long". The two are told apart by this reason AND by
 * `revoked_by` being null -- two independent signals, because getting this wrong in one direction undoes
 * the strongest device control in the product.
 */
export const IDLE_REVOKED_REASON = "Idle for longer than this practice allows";

export type TouchOutcome = {
  allowed: boolean;
  reason?: "revoked" | "idle";
  sessionId?: string;
  /**
   * ⚠ DID THE REGISTER ACTUALLY RUN? False means the read that would have found a lock-out did not
   * happen, so `allowed: true` beside it is "not refused", never "checked and cleared".
   */
  checked: boolean;
  /** A device seen here for the first time. */
  created?: boolean;
  /** An idle lock-out lifted because the person authenticated again since it was applied. */
  resumed?: boolean;
};

/**
 * Record that this device is in use, and say whether it is still allowed.
 *
 * CALLED BY THE SHELL ON EVERY REQUEST, so it must be cheap and must never throw: a failure here would
 * lock somebody out of a clinical record because a bookkeeping write failed. It returns `allowed` and
 * the shell decides; on any error it returns allowed, deliberately -- but it now also returns `checked`,
 * so a caller can tell "this device is fine" from "nothing could be established about this device".
 *
 * ⚠ THIS FUNCTION HAS BEEN DEAD IN PRACTICE UNTIL NOW. Until `src/proxy.ts` began planting the device
 * cookie, `deviceId` was a fresh UUID on every request, so `existing` was never found: no lock-out was
 * ever enforced and the idle rule below could never fire. Both start working with the cookie fix, which
 * is why the idle branch gained a way back.
 */
export async function touchSession(admin: any, args: {
  workspaceId: string; userId: string; deviceId: string; userAgent?: string | null;
  /** GoTrue's `last_sign_in_at`. Without it an idle lock-out cannot be told from a stale one. */
  authSignInAt?: string | null;
  correlationId?: string | null;
}): Promise<TouchOutcome> {
  try {
    const { data: existing, error: readError } = await admin.from("practice_session")
      .select("id, revoked_at, revoked_by, revoked_reason, last_seen_at").eq("workspace_id", args.workspaceId)
      .eq("user_id", args.userId).eq("device_id", args.deviceId).maybeSingle();

    // ⚠ A FAILED READ IS NOT AN UNKNOWN DEVICE. Falling through would insert a second row for a device
    // that already has one, and -- far worse -- would step straight past a `revoked_at` it never saw.
    // The request is still allowed, for the reason in the header, but it is allowed UNCHECKED and says so.
    if (readError) return { allowed: true, checked: false };

    if (existing?.revoked_at) {
      const lockedOutByTheClock =
        existing.revoked_by === null && existing.revoked_reason === IDLE_REVOKED_REASON;
      const authenticatedSince =
        !!args.authSignInAt && Date.parse(args.authSignInAt) > Date.parse(existing.revoked_at);

      // ⚠ THE WAY BACK FROM AN IDLE LOCK-OUT, AND WHY IT HAS TO EXIST.
      //
      // With a stable device cookie, an idle lock-out marks the browser for ever: the same device id is
      // presented on every later visit, the row is still revoked, and the person is refused permanently
      // with no control anywhere in this product that reverses it. That is a hard lockout produced by a
      // timer, which is not what an idle policy means. Signing in again is the answer to having been
      // away, so a sign-in that happened AFTER the lock-out lifts it -- and only for a lock-out the
      // clock applied, never one a person applied.
      if (lockedOutByTheClock && authenticatedSince) {
        const { data: resumed, error: resumeError } = await admin.from("practice_session").update({
          revoked_at: null, revoked_by: null, revoked_reason: null, last_seen_at: nowIso(),
          user_agent: args.userAgent ?? null,
        }).eq("workspace_id", args.workspaceId).eq("id", existing.id).eq("revoked_reason", IDLE_REVOKED_REASON).is("revoked_by", null).select("id");

        // A resume whose write did not land leaves the row revoked, so the honest answer is still
        // "refused" -- reporting entry on a write that failed is the exact error this arc is closing.
        if (resumeError || ((resumed ?? []) as any[]).length !== 1)
          return { allowed: false, reason: "idle", sessionId: existing.id, checked: true };

        await recordAuthEvent(admin, {
          workspaceId: args.workspaceId, actorId: args.userId, eventType: AUTH_EVENT.IDLE_SESSION_RESUMED,
          dedupeKey: `${existing.id}:${args.authSignInAt}`,
          payload: { sessionId: existing.id, lockedOutAt: existing.revoked_at, authSignInAt: args.authSignInAt },
          correlationId: args.correlationId ?? null,
        });
        return { allowed: true, sessionId: existing.id, checked: true, resumed: true };
      }

      // ⚠ THE REASON HAS TO SURVIVE THE SECOND VISIT. A device still locked out by the clock must keep
      // saying "idle", because that is the screen carrying the way back; reporting it as "revoked" on
      // every visit after the first would tell somebody a colleague had locked them out and leave them
      // asking the wrong person to undo something nobody did.
      return {
        allowed: false, reason: lockedOutByTheClock ? "idle" : "revoked",
        sessionId: existing.id, checked: true,
      };
    }

    const policy = await getSecurityPolicy(admin, args.workspaceId);
    // An unreadable policy carries `session_idle_minutes: null`, so no idle rule is applied from a read
    // that failed. Nothing is fabricated here and nothing is waved through either: the shell calls
    // getSecurityPolicy again immediately after this and refuses the request outright on the same fault.
    if (existing && policy.readable && policy.session_idle_minutes) {
      const idleMs = Date.now() - Date.parse(existing.last_seen_at);
      if (idleMs > policy.session_idle_minutes * 60_000) {
        // Idle-out REVOKES the row rather than merely refusing, so the person sees it on their device
        // list afterwards as something that happened rather than a silent nothing. `revoked_by` is left
        // null on purpose: that null is what marks this as the clock's doing and makes it reversible.
        const { error: idleError } = await admin.from("practice_session").update({
          revoked_at: nowIso(), revoked_by: null, revoked_reason: IDLE_REVOKED_REASON,
        }).eq("workspace_id", args.workspaceId).eq("id", existing.id).is("revoked_at", null);
        // The refusal stands either way -- the device WAS idle, and that is a fact about the clock rather
        // than about the write. What a failed write changes is whether the person can see why on their
        // device list, so it is recorded as an event even when the row could not be marked.
        await recordAuthEvent(admin, {
          workspaceId: args.workspaceId, actorId: args.userId, eventType: AUTH_EVENT.IDLE_TIMEOUT,
          dedupeKey: `${existing.id}:${existing.last_seen_at}`,
          payload: {
            sessionId: existing.id, idleMinutes: Math.round(idleMs / 60_000),
            allowedMinutes: policy.session_idle_minutes, lastSeenAt: existing.last_seen_at,
            deviceMarked: !idleError,
          },
          correlationId: args.correlationId ?? null,
        });
        return { allowed: false, reason: "idle", sessionId: existing.id, checked: true };
      }
    }

    if (existing) {
      await admin.from("practice_session")
        .update({ last_seen_at: nowIso(), user_agent: args.userAgent ?? null }).eq("workspace_id", args.workspaceId).eq("id", existing.id);
      return { allowed: true, sessionId: existing.id, checked: true };
    }

    // Upsert on the full unique index (213 s1) -- three columns, complete, not partial.
    const { data: created, error: createError } = await admin.from("practice_session").upsert({
      workspace_id: args.workspaceId, user_id: args.userId, device_id: args.deviceId,
      user_agent: args.userAgent ?? null, last_seen_at: nowIso(),
    }, { onConflict: "workspace_id,user_id,device_id" }).select("id").maybeSingle();

    // ⚠ NEVER DISCARD AN UPSERT'S ERROR (this repo has lost two writes that way). A device that could not
    // be registered is a device that is not in the register, and the caller is told so rather than being
    // handed a `sessionId: undefined` that reads like a success with a missing field.
    if (createError || !created?.id) return { allowed: true, checked: false };

    await recordAuthEvent(admin, {
      workspaceId: args.workspaceId, actorId: args.userId, eventType: AUTH_EVENT.DEVICE_REGISTERED,
      dedupeKey: created.id,
      payload: { sessionId: created.id, userAgent: args.userAgent ?? null },
      correlationId: args.correlationId ?? null,
    });
    return { allowed: true, sessionId: created.id, checked: true, created: true };
  } catch {
    // See the note above: bookkeeping must not lock anybody out of a clinical record. `checked: false`
    // is the whole difference between that decision and a silent pass.
    return { allowed: true, checked: false };
  }
}

export type SessionList = {
  /** ⚠ WAS THE DEVICE TABLE READ? False means `sessions` is empty because nothing could be read. */
  readable: boolean;
  sessions: any[];
  /** Whether the names beside the devices came back. False renders as unknown, never as "unnamed". */
  namesReadable: boolean;
  truncated: boolean;
};

/**
 * The devices signed in to this practice.
 *
 * ⚠ THIS USED TO RETURN A BARE ARRAY AND `data ?? []` WITH IT, so a failed read rendered as "no devices"
 * -- on the panel whose job is to show every device that can reach patient records, and from which
 * `securityPosture` derived "0 devices signed in". A practice looking at that would conclude nothing was
 * connected. The read state now travels with the list.
 */
export async function listSessions(admin: any, workspaceId: string, opts: { userId?: string } = {}): Promise<SessionList> {
  const limit = 100;
  let q = admin.from("practice_session")
    .select("id, user_id, device_id, device_label, user_agent, trusted, first_seen_at, last_seen_at, revoked_at, revoked_reason")
    .eq("workspace_id", workspaceId);
  if (opts.userId) q = q.eq("user_id", opts.userId);

  const { data, error } = await q.order("last_seen_at", { ascending: false }).limit(limit);
  if (error) return { readable: false, sessions: [], namesReadable: false, truncated: false };

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { readable: true, sessions: [], namesReadable: true, truncated: false };

  const { data: profiles, error: profileError } = await admin.from("profiles")
    .select("id, full_name").in("id", [...new Set(rows.map(r => r.user_id))]);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return {
    readable: true,
    namesReadable: !profileError,
    truncated: rows.length === limit,
    sessions: rows.map(r => ({
      ...r,
      name: nameOf.get(r.user_id) ?? null,
      // The device id is never returned: it is the cookie value, and a list that showed it would be a
      // list of credentials.
      device_id: undefined,
      live: !r.revoked_at,
    })),
  };
}

export async function revokeSession(admin: any, args: {
  workspaceId: string; sessionId: string; reason?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ revoked: true; endsPlatformSession: false }>> {
  const { data: s, error: lookupError } = await admin.from("practice_session")
    .select("id, user_id, revoked_at").eq("id", args.sessionId).eq("workspace_id", args.workspaceId).maybeSingle();
  // A FAILED LOOKUP IS NOT A MISSING DEVICE. "Not found" would tell somebody hunting a lost laptop that
  // the device they can see on the list above does not exist, and they would stop looking for it.
  if (lookupError)
    return {
      ok: false, status: 503, code: "LOOKUP_FAILED",
      message: `that device could not be looked up just now (${lookupError.message}), so nothing was changed. It is still allowed in -- try again.`,
    };
  if (!s) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (s.revoked_at) return { ok: false, status: 422, code: "ALREADY_REVOKED", message: "that device is already locked out" };

  // ⚠ THE WRITE IS CHECKED, AND CONDITIONAL ON THE ROW STILL BEING LIVE.
  //
  // This used to discard the error, then audit the revocation and return `{ revoked: true }` regardless.
  // A failed write was reported to the person who pressed the button as a completed lockout -- which is
  // precisely the failure the header of this file calls the most dangerous thing it could ship: somebody
  // presses it after losing a laptop, stops worrying, and the device is still allowed in.
  //
  // `.is("revoked_at", null)` makes it a compare-and-set, so a row that was revoked between the read
  // above and this write cannot be silently overwritten with a second revoker and a second reason.
  const { data: updated, error: revokeError } = await admin.from("practice_session").update({
    revoked_at: nowIso(), revoked_by: args.actorId, revoked_reason: args.reason?.trim() || null,
  }).eq("workspace_id", args.workspaceId).eq("id", s.id).is("revoked_at", null).select("id");

  if (revokeError)
    return {
      ok: false, status: 500, code: "REVOKE_FAILED",
      message: `that device could not be locked out (${revokeError.message}). It is still allowed in -- try again.`,
    };

  if (((updated ?? []) as any[]).length !== 1) {
    // Nought rows changed, and there are two reasons that happens. Somebody else revoked it in the
    // meantime -- in which case the device IS locked out and reporting a failure would be its own lie --
    // or the write did not land. Read the row and report whichever it actually was.
    const { data: after } = await admin.from("practice_session")
      .select("revoked_at").eq("workspace_id", args.workspaceId).eq("id", s.id).maybeSingle();
    if (after?.revoked_at)
      return { ok: false, status: 422, code: "ALREADY_REVOKED", message: "that device is already locked out" };
    return {
      ok: false, status: 500, code: "REVOKE_FAILED",
      message: "that device could not be locked out; nothing changed. It is still allowed in -- try again.",
    };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.session_revoked",
    payload: { sessionId: s.id, subject: s.user_id, reason: args.reason ?? null },
    correlationId: args.correlationId,
  });
  // THE LIMIT TRAVELS WITH THE RESULT. A client cannot render this as "signed out everywhere".
  return { ok: true, data: { revoked: true, endsPlatformSession: false } };
}

export async function setDeviceTrusted(admin: any, args: {
  workspaceId: string; sessionId: string; trusted: boolean; label?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ trusted: boolean }>> {
  const { data: s, error: lookupError } = await admin.from("practice_session")
    .select("id, user_id, revoked_at").eq("id", args.sessionId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (lookupError)
    return {
      ok: false, status: 503, code: "LOOKUP_FAILED",
      message: `that device could not be looked up just now (${lookupError.message}), so nothing was changed. Try again.`,
    };
  if (!s) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // Trusting a device somebody has already locked out is a contradiction, and allowing it would leave a
  // revoked-but-trusted row that reads two ways.
  if (s.revoked_at)
    return { ok: false, status: 422, code: "REVOKED", message: "that device is locked out; it cannot be trusted" };
  // A PERSON TRUSTS THEIR OWN DEVICES. An administrator marking somebody else's laptop trusted is a
  // statement about a machine they have never seen.
  if (s.user_id !== args.actorId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "only the person using a device can mark it trusted" };

  const { error } = await admin.from("practice_session")
    .update({ trusted: args.trusted, ...(args.label ? { device_label: args.label.trim().slice(0, 80) } : {}) }).eq("workspace_id", args.workspaceId)
    .eq("id", s.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { trusted: args.trusted } };
}

// ── CONSENT ──────────────────────────────────────────────────────────────────────────────────────────

export async function recordConsent(admin: any, args: {
  workspaceId: string; patientId: string; consentType: string; scope?: string;
  grantedOn?: string; expiresOn?: string | null; evidence?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!CONSENT_TYPES.some(([t]) => t === args.consentType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `consent type must be one of: ${CONSENT_TYPES.map(([t]) => t).join(", ")}` };

  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  for (const [v, label] of [[args.grantedOn, "the date granted"], [args.expiresOn, "the expiry date"]] as const) {
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a date (YYYY-MM-DD)` };
  }
  const grantedOn = args.grantedOn ?? new Date().toISOString().slice(0, 10);
  // A consent that expired before it was given is a transcription error, and storing it would put a
  // permission in the record that was never live for a moment.
  if (args.expiresOn && args.expiresOn <= grantedOn)
    return { ok: false, status: 422, code: "EXPIRES_BEFORE_GRANTED", message: "that consent expires on or before the day it was given" };

  // NO EVIDENCE MEANS NO EVIDENCE, and the field says so rather than being quietly optional: a consent
  // with nothing behind it is a claim, and the difference matters when somebody asks how it was obtained.
  const { data, error } = await admin.from("practice_consent").insert({
    workspace_id: args.workspaceId, patient_id: args.patientId, consent_type: args.consentType,
    scope: args.scope?.trim() || null, granted_on: grantedOn, expires_on: args.expiresOn ?? null,
    evidence: args.evidence?.trim() || null, recorded_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.consent_recorded",
    payload: { consentId: data.id, patientId: args.patientId, consentType: args.consentType },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Withdraw a consent.
 *
 * NEVER A DELETE. A withdrawn consent is the most important row in the table: it is the one saying a
 * practice may no longer do something it previously could, and erasing it would erase the instruction
 * along with the permission.
 */
export async function withdrawConsent(admin: any, args: {
  workspaceId: string; consentId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ withdrawn: true }>> {
  const reason = args.reason.trim();
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this consent is being withdrawn" };

  const { data: c, error: lookupError } = await admin.from("practice_consent")
    .select("id, patient_id, consent_type, withdrawn_at").eq("id", args.consentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (lookupError)
    return {
      ok: false, status: 503, code: "LOOKUP_FAILED",
      message: `that consent could not be looked up just now (${lookupError.message}), so nothing was changed. It still stands -- try again.`,
    };
  if (!c) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (c.withdrawn_at) return { ok: false, status: 422, code: "ALREADY_WITHDRAWN", message: "that consent was already withdrawn" };

  // ⚠ THE WRITE IS CHECKED, AND CONDITIONAL ON THE CONSENT STILL STANDING.
  //
  // This used to discard the error and then audit the withdrawal and return `{ withdrawn: true }`
  // regardless. A patient asks a practice to stop sharing their record, somebody records it, the write
  // fails, and the screen says it is done -- while the consent is still live and the practice carries on
  // doing the thing it was told to stop. `.is("withdrawn_at", null)` makes it a compare-and-set, so a
  // consent withdrawn between the read and the write cannot have a second reason written over the first.
  const { data: updated, error: withdrawError } = await admin.from("practice_consent").update({
    withdrawn_at: nowIso(), withdrawn_by: args.actorId, withdrawal_reason: reason,
  }).eq("workspace_id", args.workspaceId).eq("id", c.id).is("withdrawn_at", null).select("id");

  if (withdrawError)
    return {
      ok: false, status: 500, code: "WITHDRAW_FAILED",
      message: `that consent could not be withdrawn (${withdrawError.message}). It still stands -- try again.`,
    };

  if (((updated ?? []) as any[]).length !== 1) {
    // Nought rows changed. Either somebody else withdrew it in the meantime -- in which case it IS
    // withdrawn and reporting a failure would be its own lie -- or the write did not land. Read it back
    // and report whichever it actually was.
    const { data: after } = await admin.from("practice_consent")
      .select("withdrawn_at").eq("workspace_id", args.workspaceId).eq("id", c.id).maybeSingle();
    if (after?.withdrawn_at)
      return { ok: false, status: 422, code: "ALREADY_WITHDRAWN", message: "that consent was already withdrawn" };
    return {
      ok: false, status: 500, code: "WITHDRAW_FAILED",
      message: "that consent could not be withdrawn; nothing changed. It still stands -- try again.",
    };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.consent_withdrawn",
    payload: { consentId: c.id, patientId: c.patient_id, consentType: c.consent_type, reason },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { withdrawn: true } };
}

/**
 * A patient's consents, with expiry DERIVED.
 *
 * There is no `expired` column and no job that sets one -- expiry is a fact about the calendar, so it is
 * computed at read time. The same rule CPR-140 applies to overdue, for the same reason.
 *
 * ⚠ `readable` TRAVELS WITH THE LIST. An empty consent list means "this patient has consented to
 * nothing", which is a clinically loaded statement: it is the answer somebody checks before sharing a
 * record. Returning it for a read that failed would be the worst kind of false negative here.
 */
export async function patientConsents(admin: any, workspaceId: string, patientId: string, today?: string): Promise<{
  readable: boolean; consents: any[];
}> {
  const on = today ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.from("practice_consent")
    .select("id, consent_type, scope, granted_on, expires_on, withdrawn_at, withdrawal_reason, evidence, created_at")
    .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("granted_on", { ascending: false });
  if (error) return { readable: false, consents: [] };

  const labelOf = Object.fromEntries(CONSENT_TYPES.map(([t, l]) => [t, l])) as Record<string, string>;
  const consents = ((data ?? []) as any[]).map(c => {
    const expired = !c.withdrawn_at && !!c.expires_on && c.expires_on < on;
    const daysToExpiry = c.expires_on
      ? Math.round((Date.parse(`${c.expires_on}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86400000)
      : null;
    return {
      ...c,
      label: labelOf[c.consent_type] ?? c.consent_type,
      // Three distinct states, never collapsed: withdrawn is a decision, expired is the calendar, and
      // active is neither.
      state: c.withdrawn_at ? "withdrawn" : expired ? "expired" : "active",
      daysToExpiry,
      expiringSoon: !c.withdrawn_at && !expired && daysToExpiry !== null && daysToExpiry <= 30,
    };
  });
  return { readable: true, consents };
}

export type ConsentSummary = {
  /** ⚠ WERE THE CONSENTS READ? Every count beside this is null when it is false. */
  readable: boolean;
  active: number | null;
  expiringSoon: number | null;
  expired: number | null;
  withdrawn: number | null;
  truncated: boolean;
};

/**
 * The practice's consent position: counts, never a percentage.
 *
 * ⚠ NULL, NOT NOUGHT, WHEN THE READ FAILED. "0 active consents" is a statement about a practice, and it
 * is the statement a failed read used to produce: `data ?? []` turned a database fault into four
 * confident zeroes on the security page. A practice that had recorded a hundred consents would have been
 * shown none, with nothing anywhere saying why.
 */
export async function consentSummary(admin: any, workspaceId: string, today?: string): Promise<ConsentSummary> {
  const on = today ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.from("practice_consent")
    .select("id, consent_type, expires_on, withdrawn_at").eq("workspace_id", workspaceId).limit(1000);
  if (error)
    return { readable: false, active: null, expiringSoon: null, expired: null, withdrawn: null, truncated: false };
  const rows = (data ?? []) as any[];

  const active = rows.filter(c => !c.withdrawn_at && (!c.expires_on || c.expires_on >= on));
  return {
    readable: true,
    active: active.length,
    expiringSoon: active.filter(c => c.expires_on && Date.parse(`${c.expires_on}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`) <= 30 * 86400000).length,
    expired: rows.filter(c => !c.withdrawn_at && c.expires_on && c.expires_on < on).length,
    withdrawn: rows.filter(c => c.withdrawn_at).length,
    truncated: rows.length === 1000,
  };
}

// ── BREAK-GLASS ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Take emergency access.
 *
 * SELF-GRANTED, ON PURPOSE. CPR-310 forbids granting yourself a capability, and this is the one place
 * where the opposite is right: the situation it exists for is precisely the one where nobody is
 * available to approve it. What makes it safe is not approval — it is the reason, the expiry, and being
 * impossible to do quietly.
 */
export async function breakGlass(admin: any, args: {
  workspaceId: string; userId: string; reason: string; patientId?: string | null;
  correlationId: string;
}): Promise<EngineResult<{ id: string; expiresAt: string; capabilities: string[] }>> {
  const reason = args.reason.trim();
  // TEN CHARACTERS, ENFORCED IN THE DATABASE TOO. "emergency" is not a reason; a reason is a sentence
  // somebody can be asked about afterwards.
  if (reason.length < 10)
    return {
      ok: false, status: 400, code: "REASON_REQUIRED",
      message: "say what the emergency is; this will be read by somebody afterwards",
    };

  const { data: membership } = await admin.from("practice_membership")
    .select("id, status").eq("workspace_id", args.workspaceId).eq("user_id", args.userId)
    .eq("status", "active").limit(1).maybeSingle();
  // Break-glass is for a MEMBER who lacks a capability, not a stranger. Somebody with no membership has
  // no emergency claim on this practice's records at all.
  if (!membership)
    return { ok: false, status: 403, code: "NOT_A_MEMBER", message: "you are not an active member of this practice" };

  const policy = await getSecurityPolicy(admin, args.workspaceId);
  // A FAILED READ IS NOT A PERMISSION. The placeholder has break-glass ON, so proceeding here would
  // grant emergency access inside a practice that had deliberately switched it off, on a database blip.
  // Refused rather than judged -- and retriably, which an emergency needs it to be.
  if (!policy.readable)
    return {
      ok: false, status: 503, code: "POLICY_UNREADABLE",
      message: "this practice's emergency-access setting could not be read just now, so nothing was granted. Try again.",
    };
  if (!policy.break_glass_enabled)
    return { ok: false, status: 422, code: "BREAK_GLASS_DISABLED", message: "this practice has turned emergency access off" };

  const { data: live } = await admin.from("practice_break_glass")
    .select("id, expires_at").eq("workspace_id", args.workspaceId).eq("user_id", args.userId)
    .is("ended_at", null).gt("expires_at", nowIso()).limit(1).maybeSingle();
  if (live)
    return { ok: false, status: 422, code: "ALREADY_OPEN", message: "you already have emergency access open" };

  if (args.patientId) {
    const { data: p } = await admin.from("practice_patient")
      .select("id").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!p) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const expiresAt = new Date(Date.now() + policy.break_glass_minutes * 60_000).toISOString();
  const capabilities = [...BREAK_GLASS_CAPABILITIES];

  const { data: bg, error } = await admin.from("practice_break_glass").insert({
    workspace_id: args.workspaceId, user_id: args.userId, patient_id: args.patientId ?? null,
    reason, capabilities, expires_at: expiresAt,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // The grants themselves, time-boxed and marked `break_glass` so the team page can never show them as
  // a delegation. Only what the person does not already hold.
  const { data: held, error: heldError } = await admin.from("practice_role_assignment")
    .select("capability_code, effective_to").eq("membership_id", membership.id);
  // A failed read here cannot refuse the emergency -- somebody is standing over a patient. What it must
  // not do is pass silently: with no answer the code grants the whole read set, which is correct but is a
  // different act from granting only the gap, and the audit payload below says which of the two happened.
  const now = nowIso();
  const alreadyHas = new Set(((held ?? []) as any[])
    .filter(g => g.effective_to === null || g.effective_to > now).map(g => g.capability_code));
  const toGrant = capabilities.filter(c => !alreadyHas.has(c));

  if (toGrant.length > 0) {
    const { error: grantError } = await admin.from("practice_role_assignment").insert(
      toGrant.map(c => ({
        membership_id: membership.id, capability_code: c, source: "break_glass",
        effective_from: now, effective_to: expiresAt, break_glass_id: bg.id, created_by: args.userId,
      })),
    );
    // A break-glass that granted nothing is worse than a refusal: somebody would believe they had access
    // in an emergency and find out they did not.
    if (grantError) {
      await admin.from("practice_break_glass").delete().eq("workspace_id", args.workspaceId).eq("id", bg.id);
      return { ok: false, status: 500, code: "GRANT_FAILED", message: `emergency access could not be granted: ${grantError.message}` };
    }
  }

  // LOUD, THREE WAYS: the audit trail, the access log, and a standing unreviewed item. Never silent.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.userId, eventType: "practice.break_glass_taken",
    payload: {
      breakGlassId: bg.id, reason, patientId: args.patientId ?? null, expiresAt, granted: toGrant,
      existingGrantsReadable: !heldError,
    },
    correlationId: args.correlationId,
  });
  await logAccess(admin, {
    workspaceId: args.workspaceId, actorId: args.userId, subjectKind: "access_review",
    subjectId: bg.id, patientId: args.patientId ?? null, action: "view",
    detail: `Emergency access taken: ${reason}`, correlationId: args.correlationId,
  });

  return { ok: true, data: { id: bg.id as string, expiresAt, capabilities: toGrant } };
}

/** End it early. The grants go with it. */
export async function endBreakGlass(admin: any, args: {
  workspaceId: string; breakGlassId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ ended: number }>> {
  const { data: bg, error: lookupError } = await admin.from("practice_break_glass")
    .select("id, user_id, ended_at").eq("id", args.breakGlassId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (lookupError)
    return {
      ok: false, status: 503, code: "LOOKUP_FAILED",
      message: `that emergency access could not be looked up just now (${lookupError.message}), so nothing was changed. It is still open -- try again.`,
    };
  if (!bg) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (bg.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that emergency access has already ended" };

  const now = nowIso();

  // ⚠ BOTH WRITES ARE CHECKED, AND THE GRANTS GO FIRST.
  //
  // This used to discard the error from both, then report `{ ended: n }` whatever happened. The dangerous
  // half is the second one: marking the episode ended while the time-boxed capability grants were still
  // live would take a live emergency access off the "live now" list and leave the access itself running,
  // which is the one state the whole control exists to make impossible.
  //
  // The grants are withdrawn BEFORE the episode is marked ended, so a failure between the two leaves the
  // episode open with its access already gone -- visible and harmless -- rather than closed with its
  // access still granted.
  const { data: ended, error: grantError } = await admin.from("practice_role_assignment")
    .update({ effective_to: now }).eq("break_glass_id", bg.id).gt("effective_to", now).select("id");
  if (grantError)
    return {
      ok: false, status: 500, code: "END_FAILED",
      message: `the emergency grants could not be withdrawn (${grantError.message}). That access is still open -- try again.`,
    };

  const { data: closed, error: closeError } = await admin.from("practice_break_glass")
    .update({ ended_at: now }).eq("workspace_id", args.workspaceId).eq("id", bg.id).is("ended_at", null).select("id");
  if (closeError || ((closed ?? []) as any[]).length !== 1) {
    const { data: after } = await admin.from("practice_break_glass")
      .select("ended_at").eq("workspace_id", args.workspaceId).eq("id", bg.id).maybeSingle();
    if (after?.ended_at)
      return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that emergency access has already ended" };
    return {
      ok: false, status: 500, code: "END_FAILED",
      message: closeError
        ? `the emergency access could not be marked ended (${closeError.message}). Its grants have been withdrawn, but it still shows as open -- try again.`
        : "the emergency access could not be marked ended; nothing changed on the episode. Its grants have been withdrawn, but it still shows as open -- try again.",
    };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.break_glass_ended",
    payload: { breakGlassId: bg.id, ended: ((ended ?? []) as any[]).length }, correlationId: args.correlationId,
  });
  // ENDING IS NOT REVIEWING. The item stays on the review list until a person says they looked at it.
  return { ok: true, data: { ended: ((ended ?? []) as any[]).length } };
}

export async function reviewBreakGlass(admin: any, args: {
  workspaceId: string; breakGlassId: string; note: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ reviewed: true }>> {
  const note = args.note.trim();
  if (!note)
    return { ok: false, status: 400, code: "NOTE_REQUIRED", message: "say what you found; a review with no words is a tick" };

  const { data: bg, error: lookupError } = await admin.from("practice_break_glass")
    .select("id, user_id, reviewed_at").eq("id", args.breakGlassId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (lookupError)
    return {
      ok: false, status: 503, code: "LOOKUP_FAILED",
      message: `that emergency access could not be looked up just now (${lookupError.message}), so no review was recorded. It is still awaiting one -- try again.`,
    };
  if (!bg) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (bg.reviewed_at) return { ok: false, status: 422, code: "ALREADY_REVIEWED", message: "that has already been reviewed" };
  // NOBODY REVIEWS THEIR OWN EMERGENCY ACCESS. A self-reviewed break-glass is a form somebody fills in
  // twice, and the whole control is that a second person looked.
  if (bg.user_id === args.actorId)
    return { ok: false, status: 422, code: "SELF_REVIEW", message: "somebody else has to review your emergency access" };

  // ⚠ THE WRITE IS CHECKED, AND CONDITIONAL ON THE EPISODE STILL BEING UNREVIEWED.
  //
  // This used to discard the error and return `{ reviewed: true }`. The header of this file says an
  // unreviewed episode never ages out because the list IS the control -- and a review that silently
  // failed took the episode off that list in the reviewer's mind while leaving it on it in the database.
  // The reviewer stops looking; nobody else knows they should start.
  const { data: updated, error: reviewError } = await admin.from("practice_break_glass").update({
    reviewed_at: nowIso(), reviewed_by: args.actorId, review_note: note,
  }).eq("workspace_id", args.workspaceId).eq("id", bg.id).is("reviewed_at", null).select("id");

  if (reviewError)
    return {
      ok: false, status: 500, code: "REVIEW_FAILED",
      message: `that review could not be recorded (${reviewError.message}). The episode is still awaiting review -- try again.`,
    };

  if (((updated ?? []) as any[]).length !== 1) {
    const { data: after } = await admin.from("practice_break_glass")
      .select("reviewed_at").eq("workspace_id", args.workspaceId).eq("id", bg.id).maybeSingle();
    if (after?.reviewed_at)
      return { ok: false, status: 422, code: "ALREADY_REVIEWED", message: "that has already been reviewed" };
    return {
      ok: false, status: 500, code: "REVIEW_FAILED",
      message: "that review could not be recorded; nothing changed. The episode is still awaiting review -- try again.",
    };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.break_glass_reviewed",
    payload: { breakGlassId: bg.id, note }, correlationId: args.correlationId,
  });
  return { ok: true, data: { reviewed: true } };
}

/**
 * Every episode, with `live` and `awaitingReview` derived.
 *
 * AN UNREVIEWED EPISODE NEVER AGES OUT. It is not archived, hidden after a fortnight or rolled into a
 * count -- the list is the control, and a control that quietly stops showing things is not one.
 *
 * ⚠ AND A FAILED READ IS NOT AN EMPTY LIST. `data ?? []` used to render a database fault as "None. That
 * is the usual state." beside "0 awaiting review" -- on the panel whose entire subject is that somebody
 * took access to a record they would not normally see. That is a control quietly stopping showing things,
 * which the paragraph above says is not a control at all.
 */
export type BreakGlassLog = {
  readable: boolean;
  episodes: any[];
  awaitingReview: number | null;
  live: number | null;
  namesReadable: boolean;
  truncated: boolean;
};

export async function breakGlassLog(admin: any, workspaceId: string, opts: { limit?: number } = {}): Promise<BreakGlassLog> {
  const limit = opts.limit ?? 100;
  const { data, error } = await admin.from("practice_break_glass")
    .select("id, user_id, patient_id, reason, capabilities, started_at, expires_at, ended_at, reviewed_at, reviewed_by, review_note")
    .eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(limit);

  if (error)
    return { readable: false, episodes: [], awaitingReview: null, live: null, namesReadable: false, truncated: false };

  const rows = (data ?? []) as any[];
  if (rows.length === 0)
    return { readable: true, episodes: [], awaitingReview: 0, live: 0, namesReadable: true, truncated: false };

  const ids = [...new Set(rows.flatMap(r => [r.user_id, r.reviewed_by]).filter(Boolean))];
  const { data: profiles, error: profileError } = await admin.from("profiles").select("id, full_name").in("id", ids);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  const now = nowIso();
  const episodes = rows.map(r => ({
    ...r,
    name: nameOf.get(r.user_id) ?? null,
    reviewedByName: r.reviewed_by ? (nameOf.get(r.reviewed_by) ?? null) : null,
    live: !r.ended_at && r.expires_at > now,
    awaitingReview: !r.reviewed_at,
  }));

  return {
    readable: true,
    episodes,
    awaitingReview: episodes.filter(e => e.awaitingReview).length,
    live: episodes.filter(e => e.live).length,
    // A name that could not be looked up must not render as "Unnamed member": that is a statement about
    // a person, and it would be made about a named clinician on a failed join.
    namesReadable: !profileError,
    truncated: rows.length === limit,
  };
}

/**
 * The security page's figures.
 *
 * NO SECURITY SCORE. The comp prints "94% — Excellent" with "+12% vs last 30 days" under it. There is no
 * formula behind that and there could not be one: security is not a quantity, and a number that moves
 * without anybody being able to say why is worse than no number, because it invites people to chase it.
 *
 * NO COMPLIANCE BADGES either. "HIPAA Compliant", "GDPR Compliant", "Local Data Protection Act
 * Compliant" are certifications about an organisation, not properties of code, and this product cannot
 * assert any of them. Same position CPR-370 took the first time.
 *
 * NO ENCRYPTION OR RESIDENCY CLAIM. "AES-256" and "Kenya (EU)" describe a deployment this application
 * does not inspect. What is knowable is stated; the rest is named as not knowable from here.
 */
export async function securityPosture(admin: any, workspaceId: string) {
  const [policy, sessions, glass, consents, authEvents] = await Promise.all([
    getSecurityPolicy(admin, workspaceId),
    listSessions(admin, workspaceId),
    breakGlassLog(admin, workspaceId, { limit: 50 }),
    consentSummary(admin, workspaceId),
    authTrailSummary(admin, workspaceId),
  ]);

  // ⚠ THE COUNT'S ERROR IS NOT DISCARDED, AND THIS ONE MATTERED MOST OF ALL.
  //
  // It used to read `const { count: accessEvents } = …` and then `accessEventsLast7Days: accessEvents ?? 0`,
  // which the console renders as a large "0" above the words "record reads logged — in the last 7 days".
  // On a failed count that sentence said, in the plainest terms available, that not one patient record had
  // been read in a week -- on the page whose first guarantee is "Every read of a patient record is logged,
  // including your own". A practice checking that its access log was working would have been shown proof
  // that it was not, by a query that never ran.
  //
  // Note also that a null count is NOT by itself an error (this repo has been caught by that before), so
  // the error is what is tested, and the count is passed through as null when it is absent.
  //
  // ⚠⚠ AND THE DISCARD WAS NOT HYPOTHETICAL. This query filtered on `created_at`, and
  // `practice_access_log` HAS NO SUCH COLUMN -- its timestamp is `occurred_at` (migration 213). So the
  // count errored on every single call, `?? 0` swallowed it, and the security page has been printing
  // "0 — record reads logged — in the last 7 days" for every practice since the page shipped, over an
  // access log that was filling up normally the whole time. The column is corrected here; the harness
  // asserts a non-zero count against a working client, which is what would have caught this at the time.
  const { count: accessEvents, error: accessError } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId)
    .gte("occurred_at", new Date(Date.now() - 7 * 86400000).toISOString());

  const live = sessions.sessions.filter((s: any) => s.live);
  return {
    policy,
    // ⚠ WHETHER THE POLICY ABOVE WAS READ AT ALL, as a field. Every number on this page is a fact about
    // the practice; the policy is the one block that has a placeholder shape when it cannot be read, and
    // a switch rendered from a placeholder would show "two-factor: off" for a practice that requires it.
    policyReadable: policy.readable === true,
    // Counts, never a score and never a percentage -- and null rather than nought wherever the read that
    // would have produced the number did not happen.
    sessionsReadable: sessions.readable,
    liveSessions: sessions.readable ? live.length : null,
    revokedSessions: sessions.readable ? sessions.sessions.length - live.length : null,
    trustedDevices: sessions.readable ? live.filter((s: any) => s.trusted).length : null,
    accessLogReadable: !accessError,
    accessEventsLast7Days: accessError ? null : (accessEvents ?? 0),
    breakGlassReadable: glass.readable,
    breakGlass: {
      live: glass.live, awaitingReview: glass.awaitingReview,
      total: glass.readable ? glass.episodes.length : null,
    },
    consents,
    // THE AUTHENTICATION TRAIL, INCLUDING WHAT IT DOES NOT COVER. Both lists travel in the payload so no
    // screen and no marketing page can describe this control as wider than it is.
    authEvents,
    // What this product can and cannot say about itself, in the payload rather than as page furniture.
    guarantees: [
      "Every read of a patient record is logged, including your own.",
      "Emergency access cannot be taken silently, and cannot be reviewed by the person who took it.",
      // Both halves are now enforced. The second half used to be untrue: a lock-out whose write failed
      // was reported as a completed one, so this sentence promised something the code did not check.
      "A revoked device is refused by this practice on its next request, and a lock-out whose write did not land is reported as a failure rather than as success.",
      "A withdrawn consent is kept, never deleted.",
      // Newly true, and stated because the opposite was the shipped behaviour: an error reading the
      // second-factor level fell through to opening the practice.
      "Where this practice requires a second factor, a check that could not be completed refuses entry. A failed check is never counted as a passed one.",
      "This practice's security policy is either read or reported as unreadable. It is never assumed to be off.",
      // Newly true. Until this release nothing in the product recorded that anybody had ever signed in.
      "Every sign-in that opens this practice is recorded, once, in the audit trail — and a figure that could not be read is shown as unavailable rather than as nought.",
      // Newly true, and the reason the device register works at all: see src/proxy.ts.
      "Every device that reaches this practice is recorded, and the same browser is the same device on its next visit rather than a new one.",
      // ⚠ NEWLY TRUE, AND THE CLAIM IS DELIBERATELY THE NARROW ONE. This says a warning comes first and
      // that the way back works -- not that the screen locks, which is only true where a practice set a
      // limit. The unqualified version would describe nothing at all for every practice alive today.
      "Where this practice sets an idle limit, a warning and a countdown come first, and a session in active use tells this practice so rather than being locked out mid-note.",
      "A covered screen is reopened with a password, and that same password re-authenticates the session behind it -- which is what clears an idle lock-out rather than leaving somebody unlocked on a screen the next click would refuse.",
    ],
    notKnowableFromHere: [
      "Encryption algorithm and key management — a property of the deployment, not of this application.",
      "Where the data physically resides.",
      "Whether the organisation holds any certification. This product asserts none.",
      "How long data must be kept — a legal question per jurisdiction, still unanswered.",
      // ⚠ Named here rather than left to be assumed. A practice reading "every sign-in is recorded" would
      // otherwise reasonably conclude that failures were counted somewhere, and they are not counted
      // anywhere -- which is also why this product has no account lockout.
      "How many times somebody tried and failed to sign in. Passwords are checked by the platform's authentication server, which this product does not sit in front of, so a failed attempt never reaches any code here.",
      // ⚠ Named here so a practice reading "the screen locks when idle" does not conclude the workspace
      // is covered everywhere. It is not: this is a Practice control, and it stops at the Practice URLs.
      "Whether a screen was left open in another Competen workspace. The idle warning, the lock screen and the pause are built into the Practice shell only; a hospital or supervisor workspace open in another tab is untouched by any of them.",
      // ⚠ And the cap COMP-AUTH-001 asks for, named rather than quietly missing.
      `Nothing caps how long a session may run. ${ABSOLUTE_LIFETIME_NOT_ENFORCED.notEnforced}`,
    ],
    // The places this product's reach ends, stated as fields so no client can imply otherwise.
    revocationEndsPlatformSession: false,
    mfaEnrolmentIsPlatformLevel: true,
    // ⚠ THE IDLE RULE IS REAL FROM THIS RELEASE, AND WAS NOT BEFORE.
    //
    // It was written in migration 213 and enforced in touchSession, and it could never fire: the device
    // cookie was re-minted on every request, so no device was ever seen twice and no idle interval could
    // be measured. With the cookie planted by the proxy, a practice that sets a limit gets one. Stated as
    // a field so the console can say it beside the setting rather than leaving somebody to discover it.
    idleLimitMinutes: policy.readable ? (policy.session_idle_minutes ?? null) : null,
    idleLimitEnforced: policy.readable && !!policy.session_idle_minutes,
    // And the way back, because an idle lock-out with no way back is a permanent ban applied by a timer.
    idleLockOutClearedBySigningInAgain: true,
    // ⚠ COMP-AUTH-001'S SESSION LIFECYCLE, IN THE PAYLOAD RATHER THAN AS PAGE FURNITURE.
    //
    // The mode is the honest headline: on the day this ships every practice in existence is in OBSERVE,
    // because the one live policy row carries `session_idle_minutes: null`. Nothing warns, nothing is
    // covered and nothing is refused there -- the block exists so a practice can SEE that, and see what
    // a limit would have done to it, before deciding.
    sessionLifetime: {
      ...resolveSessionLimits(policy),
      // Every figure here is the length of a list in the audit trail, and null when the trail could not
      // be read. `screensCoveredLast7Days` is a FLOOR -- a tab closed before it could report writes
      // nothing, and the not-recorded list says so.
      observed: authEvents.sessionLifetime,
      observedReadable: authEvents.readable,
      // What the lock screen and the pause actually are, so no screen and no marketing page can widen
      // them. Read verbatim from the engine, which is the only place they are written down.
      lockScreen: [...LOCK_SCREEN_TRUTHS],
      resumeMethodsNotBuilt: [...RESUME_METHODS_NOT_BUILT],
      clinicalPauseBuilt: [...CLINICAL_PAUSE.built],
      clinicalPauseNotBuilt: [...CLINICAL_PAUSE.notBuilt],
      absoluteLifetime: { ...ABSOLUTE_LIFETIME_NOT_ENFORCED },
    },
    // Failed sign-ins are not counted anywhere, so there is nothing to lock an account on.
    accountLockoutBuiltHere: false,
    failedSignInAttemptsVisibleHere: false,
    // ⚠ AND THERE IS NO ENROLMENT PAGE IN THIS PRODUCT AT ALL. Requiring a second factor is a switch on
    // this page; enrolling in one is not, anywhere. A member who does not already hold a verified factor
    // on their Competen account cannot obtain one from here, and turning the requirement on shuts them
    // out until somebody who can still get in turns it off again.
    mfaEnrolmentBuiltHere: false,
  };
}
