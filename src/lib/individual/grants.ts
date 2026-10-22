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
  return { targetUserId, experiences, adultConfirmed, note };
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
      ...(x === "scholar" ? { adult_confirmed_at: now, adult_confirmed_by: grantedBy } : {}),
    });
    if (ins.error) return { ok: false, status: 503, code: "WRITE_FAILED", message: `The ${EXPERIENCES[x].name} entitlement could not be written.` };
    granted.push(x);
  }
  return { ok: true, membership, granted, alreadyLive };
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
