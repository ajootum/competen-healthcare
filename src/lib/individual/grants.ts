/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPERIENCES, isExperienceKey, type ExperienceKey } from "./experiences";

// ── THE PILOT GRANT ── owner rulings D8 and D9, COMPETEN-IND-003 ─────────────────────────────────────────
//
// The one writer of individual_membership and individual_entitlement rows during the pilot, called only
// from /api/hq/individual/grants behind hqApiGate(["hq.individual.pilot.grant"]) -- the right the
// Individual Product Administrator appointment holds (D9). It is not a second grant engine: it writes the
// gate-3 rows ADR-016 defines and nothing else.
//
// ⚠ IT TOUCHES NO OTHER PRODUCT. No platform_membership, no practice or enterprise membership, no
// profiles write (COMP-ARCH-PSA-001 s40, ADR-001). scripts/individual-foundation-harness.ts pins that.
//
// ⚠ D8 IS ENFORCED TWICE, ON PURPOSE. Here, so the HQ caller gets a clear refusal. In the schema
// (individual_entitlement_scholar_adult), so a writer that never heard of D8 still cannot store a
// Scholar grant without a recorded adult-eligibility confirmation.
//
// ⚠ IDEMPOTENT PER EXPERIENCE. An experience that is already live is reported, not duplicated. Liveness
// is the DB-clock view, as everywhere in Individual.

export type GrantRequest = {
  targetUserId: string;
  experiences: ExperienceKey[];
  /** D8: the HQ administrator confirms the person is 18 or over. Required when Scholar is granted. */
  adultConfirmed: boolean;
  note?: string | null;
  /**
   * COMPETEN-IND-ACCESS-001 s4 "validity": the last day of access, or null for open-ended. Stored as the end
   * of that day in UTC on individual_entitlement.ends_at. The SCHEMA decides whether it is in the future
   * (ends_at > starts_at, starts_at = the database's now()) -- this file never compares it with an
   * application clock.
   */
  endsAt?: string | null;
  /**
   * When the 18+ confirmation was actually made, if earlier than this grant -- an invitation's
   * (src/lib/individual/invitations.ts). Absent: the confirmation is made now, with the grant.
   */
  adultConfirmedAt?: string | null;
};

export type GrantOutcome =
  | { ok: true; membership: "created" | "existing"; granted: ExperienceKey[]; alreadyLive: ExperienceKey[] }
  | { ok: false; status: number; code: string; message: string };

/** Pure: validate a request body. Returns the request or a refusal. */
export function validateGrant(body: any): GrantRequest | { ok: false; status: number; code: string; message: string } {
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "targetUserId must be a user id" };
  const raw: unknown[] = Array.isArray(body?.experiences) ? body.experiences : [];
  const experiences = [...new Set(raw.filter(isExperienceKey))] as ExperienceKey[];
  if (!experiences.length || experiences.length !== raw.length)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "experiences must list scholar and/or professional" };
  const adultConfirmed = body?.adultConfirmed === true;
  if (experiences.includes("scholar") && !adultConfirmed)
    return { ok: false, status: 422, code: "AGE_ELIGIBILITY_REQUIRED", message: "The Competen Scholar pilot is for people aged 18 or over. Confirm eligibility to grant Scholar." };
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  const endsAt = parseEndDate(body?.endsOn);
  if (endsAt === false) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "The access end date must be a date (YYYY-MM-DD)." };
  return { targetUserId, experiences, adultConfirmed, note, endsAt };
}

/** "YYYY-MM-DD" -> the end of that day in UTC; absent or empty -> null (open-ended); anything else -> false. */
export function parseEndDate(v: unknown): string | null | false {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? false : d.toISOString();
}

export const isGrantRefusal = (x: GrantRequest | { ok: false }): x is { ok: false; status: number; code: string; message: string } =>
  (x as any).ok === false;

export async function grantIndividualAccess(admin: any, req: GrantRequest, grantedBy: string): Promise<GrantOutcome> {
  const { data: profile, error: pErr } = await admin.from("profiles").select("id").eq("id", req.targetUserId).maybeSingle();
  if (pErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "The person could not be looked up." };
  if (!profile) return { ok: false, status: 404, code: "NO_SUCH_PERSON", message: "No Competen account has that id." };

  const { data: existing, error: mErr } = await admin.from("individual_membership")
    .select("id, status").eq("user_id", req.targetUserId).maybeSingle();
  if (mErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Individual membership could not be read." };
  // Reinstating a suspended or revoked person is a different act from a pilot grant, and is not this one.
  if (existing && existing.status !== "active")
    return { ok: false, status: 409, code: "MEMBERSHIP_NOT_ACTIVE", message: `This person's Competen Individual membership is ${existing.status}.` };

  let membership: "created" | "existing" = "existing";
  if (!existing) {
    const ins = await admin.from("individual_membership")
      .insert({ user_id: req.targetUserId, status: "active", source: "hq_pilot_grant", granted_by: grantedBy, note: req.note });
    if (ins.error) return { ok: false, status: 503, code: "WRITE_FAILED", message: "The membership could not be written." };
    membership = "created";
  }

  const { data: liveRows, error: lErr } = await admin.from("individual_live_entitlement")
    .select("experience_code").eq("user_id", req.targetUserId).limit(20);
  if (lErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Live entitlements could not be read." };
  const live = new Set(((liveRows ?? []) as any[]).map(r => r.experience_code));

  const granted: ExperienceKey[] = [];
  const alreadyLive: ExperienceKey[] = [];
  const now = new Date().toISOString();
  for (const x of req.experiences) {
    if (live.has(x)) { alreadyLive.push(x); continue; }
    const ins = await admin.from("individual_entitlement").insert({
      user_id: req.targetUserId, experience_code: x, status: "active", source: "pilot",
      operating_entity: EXPERIENCES[x].operatingEntity, granted_by: grantedBy, note: req.note,
      ...(x === "scholar" ? { adult_confirmed_at: req.adultConfirmedAt ?? now, adult_confirmed_by: grantedBy } : {}),
      ...(req.endsAt ? { ends_at: req.endsAt } : {}),
    });
    if (ins.error) {
      // ⚠ NO STRANDED MEMBERSHIP. A membership this call created, with no entitlement written beside it,
      // would be a member with nothing live -- so it is removed again before the refusal is returned.
      if (membership === "created" && granted.length === 0)
        await admin.from("individual_membership").delete().eq("user_id", req.targetUserId).eq("source", "hq_pilot_grant").is("onboarded_at", null);
      // 23514: a CHECK refused the row -- with an end date, that is ends_at > starts_at (the DB's now()).
      if (req.endsAt && String(ins.error.code) === "23514")
        return { ok: false, status: 422, code: "END_DATE_NOT_FUTURE", message: "The access end date must be in the future." };
      return { ok: false, status: 503, code: "WRITE_FAILED", message: `The ${EXPERIENCES[x].name} entitlement could not be written.` };
    }
    granted.push(x);
  }
  return { ok: true, membership, granted, alreadyLive };
}

// ── MEMBERSHIP STATUS: SUSPEND, REINSTATE, REVOKE ── COMPETEN-LEGAL-001 s13 step 7 (the route gap) ───────────
//
// The gate-3 membership's own lifecycle, during the pilot, behind the same right as the grant. It changes ONE
// row's status and its time columns, and nothing else: the entitlement ledger is untouched (its history stays),
// no other product is touched, and no data is deleted. readIndividualAccess already refuses a suspended or
// revoked membership, and /individual/access already says which.
//
//   suspend    active -> suspended     reversible: access closes now, everything is kept
//   reinstate  suspended -> active     only from suspended
//   revoke     active|suspended -> revoked   TERMINAL here, and a reason is required. Bringing a revoked
//              person back is not a pilot act and is not offered.
//
// The reason is recorded in audit_log by the route, beside the actor -- 370 has no reason column, and the
// grant's own note is not overwritten.

export type MembershipAction = "suspend" | "reinstate" | "revoke";
export const MEMBERSHIP_ACTIONS: readonly MembershipAction[] = ["suspend", "reinstate", "revoke"];
const FROM: Record<MembershipAction, string[]> = { suspend: ["active"], reinstate: ["suspended"], revoke: ["active", "suspended"] };
const TO: Record<MembershipAction, string> = { suspend: "suspended", reinstate: "active", revoke: "revoked" };
/** The past tense, for audit actions and messages: individual_membership_suspended / _reinstated / _revoked. */
export const MEMBERSHIP_DONE: Record<MembershipAction, string> = { suspend: "suspended", reinstate: "reinstated", revoke: "revoked" };

/** Pure: validate a membership-status request. */
export function validateMembershipAction(body: any): { targetUserId: string; action: MembershipAction; reason: string | null } | { ok: false; status: number; code: string; message: string } {
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "targetUserId must be a user id" };
  const action = body?.action;
  if (!MEMBERSHIP_ACTIONS.includes(action)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "action must be suspend, reinstate or revoke" };
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) || null : null;
  if (action === "revoke" && (reason ?? "").length < 8)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "Say why the membership is revoked (at least 8 characters)." };
  return { targetUserId, action, reason };
}

export async function setIndividualMembershipStatus(
  admin: any, targetUserId: string, action: MembershipAction, actorId: string,
): Promise<{ ok: true; from: string; to: string } | { ok: false; status: number; code: string; message: string }> {
  const { data: m, error } = await admin.from("individual_membership").select("id, status").eq("user_id", targetUserId).maybeSingle();
  if (error) return { ok: false, status: 503, code: "UNAVAILABLE", message: "The membership could not be read." };
  if (!m) return { ok: false, status: 404, code: "NO_MEMBERSHIP", message: "This person has no Competen Individual membership." };
  if (!FROM[action].includes(m.status))
    return { ok: false, status: 409, code: "INVALID_TRANSITION", message: `A ${m.status} membership cannot be ${MEMBERSHIP_DONE[action]}.` };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: TO[action], updated_at: now };
  if (action === "suspend") patch.suspended_at = now;
  if (action === "reinstate") patch.suspended_at = null;
  if (action === "revoke") { patch.revoked_at = now; patch.revoked_by = actorId; }
  // Optimistic: only from the status just read, so two administrators cannot both act on a stale view.
  const upd = await admin.from("individual_membership").update(patch).eq("id", m.id).eq("status", m.status).select("id");
  if (upd.error) return { ok: false, status: 503, code: "WRITE_FAILED", message: "The membership could not be changed." };
  if (!(upd.data ?? []).length) return { ok: false, status: 409, code: "CHANGED", message: "The membership changed meanwhile. Look it up again." };
  return { ok: true, from: m.status, to: TO[action] };
}

/** End one experience for a person: every live row for it is cancelled. History keeps the rows. */
export async function endIndividualExperience(admin: any, targetUserId: string, experience: ExperienceKey): Promise<{ ok: true; ended: number } | { ok: false; status: number; message: string }> {
  const { data: liveRows, error } = await admin.from("individual_live_entitlement")
    .select("id").eq("user_id", targetUserId).eq("experience_code", experience).limit(20);
  if (error) return { ok: false, status: 503, message: "Live entitlements could not be read." };
  const ids = ((liveRows ?? []) as any[]).map(r => r.id);
  if (!ids.length) return { ok: true, ended: 0 };
  const upd = await admin.from("individual_entitlement")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).in("id", ids).eq("user_id", targetUserId);
  if (upd.error) return { ok: false, status: 503, message: "The entitlement could not be ended." };
  return { ok: true, ended: ids.length };
}

// ── THE LOOKUP BEHIND THE HQ GRANT SCREEN ── COMPETEN-IND-ACCESS-001 s4 ────────────────────────────────
//
// An administrator finds an EXISTING Competen account by its email address and sees what Competen
// Individual it holds: the membership, and every entitlement period with whether the database says it is
// live now. It reads the identity record (name, email) and the gate-3 rows, nothing else -- no other
// product's membership, no Passport content, no learning records.

export type PersonLookup =
  | { found: false }
  | {
    found: true;
    person: { id: string; name: string | null; email: string | null };
    membership: { status: string; primaryExperience: string | null; onboarded: boolean; source: string } | null;
    entitlements: {
      id: string; experience: ExperienceKey; status: string; live: boolean; startsAt: string; endsAt: string | null;
      source: string; operatingEntity: string; adultConfirmed: boolean; createdAt: string;
    }[];
  };

/** Pure: a lookup email, trimmed and lower-cased, or null when it is not an email address. */
export function normaliseLookupEmail(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : null;
}

export async function lookupIndividualPerson(admin: any, email: string): Promise<{ ok: true; value: PersonLookup } | { ok: false; message: string }> {
  // ilike with the LIKE wildcards escaped: a case-insensitive EXACT match, never a pattern search.
  const pattern = email.replace(/[\\%_]/g, c => "\\" + c);
  const { data: people, error } = await admin.from("profiles").select("id, full_name, email").ilike("email", pattern).limit(2);
  if (error) return { ok: false, message: "The account could not be looked up." };
  const rows = (people ?? []) as any[];
  if (rows.length === 0) return { ok: true, value: { found: false } };
  if (rows.length > 1) return { ok: false, message: "More than one account carries that email address. Resolve that in Users first." };
  const p = rows[0];

  const [m, e, l] = await Promise.all([
    admin.from("individual_membership").select("status, primary_experience, onboarded_at, source").eq("user_id", p.id).maybeSingle(),
    admin.from("individual_entitlement")
      .select("id, experience_code, status, starts_at, ends_at, source, operating_entity, adult_confirmed_at, created_at")
      .eq("user_id", p.id).order("created_at", { ascending: false }).limit(50),
    admin.from("individual_live_entitlement").select("id").eq("user_id", p.id).limit(20),
  ]);
  // A failed read is not "no access": refuse to draw the person rather than draw them wrong.
  if (m.error || e.error || l.error) return { ok: false, message: "Competen Individual access could not be read for this account." };
  const liveIds = new Set(((l.data ?? []) as any[]).map(r => r.id));
  return {
    ok: true,
    value: {
      found: true,
      person: { id: p.id, name: p.full_name ?? null, email: p.email ?? null },
      membership: m.data ? {
        status: m.data.status, primaryExperience: m.data.primary_experience ?? null,
        onboarded: !!m.data.onboarded_at, source: m.data.source,
      } : null,
      entitlements: ((e.data ?? []) as any[]).filter(r => isExperienceKey(r.experience_code)).map(r => ({
        id: r.id, experience: r.experience_code, status: r.status, live: liveIds.has(r.id),
        startsAt: r.starts_at, endsAt: r.ends_at ?? null, source: r.source, operatingEntity: r.operating_entity,
        adultConfirmed: !!r.adult_confirmed_at, createdAt: r.created_at,
      })),
    },
  };
}
