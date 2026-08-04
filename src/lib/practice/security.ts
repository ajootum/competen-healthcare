import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { logAccess } from "@/lib/practice/privacy";

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

export async function getSecurityPolicy(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_security_policy")
    .select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (data) return data;

  const { data: created } = await admin.from("practice_security_policy")
    .insert({ workspace_id: workspaceId }).select("*").single();
  // Defaults, if even the insert raced: MFA off, break-glass on. Off for MFA because a migration must
  // never lock a practice out of itself.
  return created ?? {
    workspace_id: workspaceId, mfa_required: false,
    break_glass_enabled: true, break_glass_minutes: 60, session_idle_minutes: null,
  };
}

export async function updateSecurityPolicy(admin: any, args: {
  workspaceId: string; mfaRequired?: boolean; breakGlassEnabled?: boolean;
  breakGlassMinutes?: number; sessionIdleMinutes?: number | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ changed: string[] }>> {
  const current = await getSecurityPolicy(admin, args.workspaceId);
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

// ── SESSIONS AND DEVICES ─────────────────────────────────────────────────────────────────────────────

/**
 * Record that this device is in use, and say whether it is still allowed.
 *
 * CALLED BY THE SHELL ON EVERY REQUEST, so it must be cheap and must never throw: a failure here would
 * lock somebody out of a clinical record because a bookkeeping write failed. It returns `allowed` and
 * the shell decides; on any error it returns allowed, deliberately.
 */
export async function touchSession(admin: any, args: {
  workspaceId: string; userId: string; deviceId: string; userAgent?: string | null;
}): Promise<{ allowed: boolean; reason?: "revoked" | "idle"; sessionId?: string }> {
  try {
    const { data: existing } = await admin.from("practice_session")
      .select("id, revoked_at, last_seen_at").eq("workspace_id", args.workspaceId)
      .eq("user_id", args.userId).eq("device_id", args.deviceId).maybeSingle();

    if (existing?.revoked_at) return { allowed: false, reason: "revoked", sessionId: existing.id };

    const policy = await getSecurityPolicy(admin, args.workspaceId);
    if (existing && policy.session_idle_minutes) {
      const idleMs = Date.now() - Date.parse(existing.last_seen_at);
      if (idleMs > policy.session_idle_minutes * 60_000) {
        // Idle-out REVOKES the row rather than merely refusing, so the person sees it on their device
        // list afterwards as something that happened rather than a silent nothing.
        await admin.from("practice_session").update({
          revoked_at: nowIso(), revoked_reason: "Idle for longer than this practice allows",
        }).eq("id", existing.id);
        return { allowed: false, reason: "idle", sessionId: existing.id };
      }
    }

    if (existing) {
      await admin.from("practice_session")
        .update({ last_seen_at: nowIso(), user_agent: args.userAgent ?? null }).eq("id", existing.id);
      return { allowed: true, sessionId: existing.id };
    }

    // Upsert on the full unique index (213 s1) -- three columns, complete, not partial.
    const { data: created } = await admin.from("practice_session").upsert({
      workspace_id: args.workspaceId, user_id: args.userId, device_id: args.deviceId,
      user_agent: args.userAgent ?? null, last_seen_at: nowIso(),
    }, { onConflict: "workspace_id,user_id,device_id" }).select("id").maybeSingle();
    return { allowed: true, sessionId: created?.id };
  } catch {
    // See the note above: bookkeeping must not lock anybody out of a clinical record.
    return { allowed: true };
  }
}

export async function listSessions(admin: any, workspaceId: string, opts: { userId?: string } = {}) {
  let q = admin.from("practice_session")
    .select("id, user_id, device_id, device_label, user_agent, trusted, first_seen_at, last_seen_at, revoked_at, revoked_reason")
    .eq("workspace_id", workspaceId);
  if (opts.userId) q = q.eq("user_id", opts.userId);

  const { data } = await q.order("last_seen_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: profiles } = await admin.from("profiles")
    .select("id, full_name").in("id", [...new Set(rows.map(r => r.user_id))]);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return rows.map(r => ({
    ...r,
    name: nameOf.get(r.user_id) ?? null,
    // The device id is never returned: it is the cookie value, and a list that showed it would be a
    // list of credentials.
    device_id: undefined,
    live: !r.revoked_at,
  }));
}

export async function revokeSession(admin: any, args: {
  workspaceId: string; sessionId: string; reason?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ revoked: true; endsPlatformSession: false }>> {
  const { data: s } = await admin.from("practice_session")
    .select("id, user_id, revoked_at").eq("id", args.sessionId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!s) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (s.revoked_at) return { ok: false, status: 422, code: "ALREADY_REVOKED", message: "that device is already locked out" };

  await admin.from("practice_session").update({
    revoked_at: nowIso(), revoked_by: args.actorId, revoked_reason: args.reason?.trim() || null,
  }).eq("id", s.id);

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
  const { data: s } = await admin.from("practice_session")
    .select("id, user_id, revoked_at").eq("id", args.sessionId).eq("workspace_id", args.workspaceId).maybeSingle();
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
    .update({ trusted: args.trusted, ...(args.label ? { device_label: args.label.trim().slice(0, 80) } : {}) })
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

  const { data: c } = await admin.from("practice_consent")
    .select("id, patient_id, consent_type, withdrawn_at").eq("id", args.consentId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!c) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (c.withdrawn_at) return { ok: false, status: 422, code: "ALREADY_WITHDRAWN", message: "that consent was already withdrawn" };

  await admin.from("practice_consent").update({
    withdrawn_at: nowIso(), withdrawn_by: args.actorId, withdrawal_reason: reason,
  }).eq("id", c.id);

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
 */
export async function patientConsents(admin: any, workspaceId: string, patientId: string, today?: string) {
  const on = today ?? new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("practice_consent")
    .select("id, consent_type, scope, granted_on, expires_on, withdrawn_at, withdrawal_reason, evidence, created_at")
    .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("granted_on", { ascending: false });

  const labelOf = Object.fromEntries(CONSENT_TYPES.map(([t, l]) => [t, l])) as Record<string, string>;
  return ((data ?? []) as any[]).map(c => {
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
}

/** The practice's consent position: counts, never a percentage. */
export async function consentSummary(admin: any, workspaceId: string, today?: string) {
  const on = today ?? new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("practice_consent")
    .select("id, consent_type, expires_on, withdrawn_at").eq("workspace_id", workspaceId).limit(1000);
  const rows = (data ?? []) as any[];

  const active = rows.filter(c => !c.withdrawn_at && (!c.expires_on || c.expires_on >= on));
  return {
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
  const { data: held } = await admin.from("practice_role_assignment")
    .select("capability_code, effective_to").eq("membership_id", membership.id);
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
      await admin.from("practice_break_glass").delete().eq("id", bg.id);
      return { ok: false, status: 500, code: "GRANT_FAILED", message: `emergency access could not be granted: ${grantError.message}` };
    }
  }

  // LOUD, THREE WAYS: the audit trail, the access log, and a standing unreviewed item. Never silent.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.userId, eventType: "practice.break_glass_taken",
    payload: { breakGlassId: bg.id, reason, patientId: args.patientId ?? null, expiresAt, granted: toGrant },
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
  const { data: bg } = await admin.from("practice_break_glass")
    .select("id, user_id, ended_at").eq("id", args.breakGlassId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!bg) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (bg.ended_at) return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that emergency access has already ended" };

  const now = nowIso();
  const { data: ended } = await admin.from("practice_role_assignment")
    .update({ effective_to: now }).eq("break_glass_id", bg.id).gt("effective_to", now).select("id");
  await admin.from("practice_break_glass").update({ ended_at: now }).eq("id", bg.id);

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

  const { data: bg } = await admin.from("practice_break_glass")
    .select("id, user_id, reviewed_at").eq("id", args.breakGlassId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!bg) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (bg.reviewed_at) return { ok: false, status: 422, code: "ALREADY_REVIEWED", message: "that has already been reviewed" };
  // NOBODY REVIEWS THEIR OWN EMERGENCY ACCESS. A self-reviewed break-glass is a form somebody fills in
  // twice, and the whole control is that a second person looked.
  if (bg.user_id === args.actorId)
    return { ok: false, status: 422, code: "SELF_REVIEW", message: "somebody else has to review your emergency access" };

  await admin.from("practice_break_glass").update({
    reviewed_at: nowIso(), reviewed_by: args.actorId, review_note: note,
  }).eq("id", bg.id);

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
 */
export async function breakGlassLog(admin: any, workspaceId: string, opts: { limit?: number } = {}) {
  const { data } = await admin.from("practice_break_glass")
    .select("id, user_id, patient_id, reason, capabilities, started_at, expires_at, ended_at, reviewed_at, reviewed_by, review_note")
    .eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(opts.limit ?? 100);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { episodes: [], awaitingReview: 0, live: 0 };

  const ids = [...new Set(rows.flatMap(r => [r.user_id, r.reviewed_by]).filter(Boolean))];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
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
    episodes,
    awaitingReview: episodes.filter(e => e.awaitingReview).length,
    live: episodes.filter(e => e.live).length,
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
  const [policy, sessions, glass, consents] = await Promise.all([
    getSecurityPolicy(admin, workspaceId),
    listSessions(admin, workspaceId),
    breakGlassLog(admin, workspaceId, { limit: 50 }),
    consentSummary(admin, workspaceId),
  ]);

  const { count: accessEvents } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId)
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());

  return {
    policy,
    // Counts, never a score and never a percentage.
    liveSessions: sessions.filter((s: any) => s.live).length,
    revokedSessions: sessions.filter((s: any) => !s.live).length,
    trustedDevices: sessions.filter((s: any) => s.live && s.trusted).length,
    accessEventsLast7Days: accessEvents ?? 0,
    breakGlass: { live: glass.live, awaitingReview: glass.awaitingReview, total: glass.episodes.length },
    consents,
    // What this product can and cannot say about itself, in the payload rather than as page furniture.
    guarantees: [
      "Every read of a patient record is logged, including your own.",
      "Emergency access cannot be taken silently, and cannot be reviewed by the person who took it.",
      "A revoked device is refused by this practice on its next request.",
      "A withdrawn consent is kept, never deleted.",
    ],
    notKnowableFromHere: [
      "Encryption algorithm and key management — a property of the deployment, not of this application.",
      "Where the data physically resides.",
      "Whether the organisation holds any certification. This product asserts none.",
      "How long data must be kept — a legal question per jurisdiction, still unanswered.",
    ],
    // The two places this product's reach ends, stated as fields so no client can imply otherwise.
    revocationEndsPlatformSession: false,
    mfaEnrolmentIsPlatformLevel: true,
  };
}
