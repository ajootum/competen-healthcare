/* eslint-disable @typescript-eslint/no-explicit-any */
import { judgeTarget } from "../../../scripts/production-guard";
import { isExperienceKey, type ExperienceKey } from "./experiences";
import { isNotProvisioned } from "./access";
import { grantIndividualAccess, parseEndDate, normaliseLookupEmail, type GrantOutcome } from "./grants";
import { INDIVIDUAL_HOME } from "./entry";
import { individualIdentityProfile } from "../platform-membership";
import { identityHoldsNoStanding } from "../identity/standing";

// ── INVITATIONS FOR PEOPLE WITHOUT A COMPETEN ACCOUNT ── COMPETEN-IND-ACCESS-001, migration 378 ────────────
//
// An HQ administrator (hq.individual.pilot.grant) invites an email address that has no Competen account into
// Competen Scholar, Competen Professional or both. The person accepts after signing in, and only then does
// Competen Individual exist for them -- through the one grant engine (grants.ts), unchanged.
//
// ⚠ ONE IDENTITY, THROUGH SHARED IAM. The identity is created by Supabase auth's own invite
// (inviteUserByEmail), exactly as /super-admin/users creates one -- the auth user, and its profiles row by
// the existing on_auth_user_created trigger. What this file does NOT do is the separate step that route
// takes next: it never grants platform_membership, nor any estate, enterprise or practice membership or
// role. An Individual-only person holds nothing else (COMP-ARCH-PSA-001 s40).
//
// ⚠ THE INVITATION IS NOT THE GRANT. Nothing is granted until the invited person, signed in as the identity
// the invitation created, accepts it. Then grantIndividualAccess writes the membership and entitlements, with
// the inviter as grantor and the inviter's 18+ confirmation (D8). The terms gate (D2) still stands between
// the entitlement and any use of the experience.
//
// ⚠ THE LINK GOES TO THE MAILBOX, NEVER TO THE ADMINISTRATOR. The invite link signs its holder in as the
// new identity, so returning it to the inviter would let the inviter become the invitee. The one exception
// is the test delivery mode below, which cannot run on a deployed build or against production.
//
// ⚠ EXPIRY IS THE DATABASE'S CLOCK. Whether an invitation can still be accepted is read from
// individual_live_invitation, never by comparing an application clock with expires_at (ADR-016).

export const INVITE_DEFAULT_DAYS = 14;
export const INVITE_MAX_DAYS = 30;

export type InvitationRequest = {
  email: string;
  name: string | null;
  experiences: ExperienceKey[];
  adultConfirmed: boolean;
  /** The last day of access the eventual entitlement carries (grants.ts parseEndDate), or null. */
  endsAt: string | null;
  /** How long the invitation may be accepted, in days (1-30). Stored as expires_at by the database clock. */
  expiresInDays: number;
  note: string | null;
};

export type Refusal = { ok: false; status: number; code: string; message: string; personId?: string };
export const isRefusal = (x: unknown): x is Refusal => !!x && typeof x === "object" && (x as any).ok === false;

/** Pure: validate an invitation request body. */
export function validateInvitation(body: any): InvitationRequest | Refusal {
  const email = normaliseLookupEmail(body?.email);
  if (!email) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Enter the email address to invite." };
  const raw: unknown[] = Array.isArray(body?.experiences) ? body.experiences : [];
  const experiences = [...new Set(raw.filter(isExperienceKey))] as ExperienceKey[];
  if (!experiences.length || experiences.length !== raw.length)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Choose Competen Scholar, Competen Professional or both." };
  const adultConfirmed = body?.adultConfirmed === true;
  if (experiences.includes("scholar") && !adultConfirmed)
    return { ok: false, status: 422, code: "AGE_ELIGIBILITY_REQUIRED", message: "The Competen Scholar pilot is for people aged 18 or over. Confirm eligibility to invite to Scholar." };
  const endsAt = parseEndDate(body?.endsOn);
  if (endsAt === false) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "The access end date must be a date (YYYY-MM-DD)." };
  const days = body?.expiresInDays === undefined || body?.expiresInDays === null || body?.expiresInDays === "" ? INVITE_DEFAULT_DAYS : Number(body.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > INVITE_MAX_DAYS)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `An invitation can be open for 1 to ${INVITE_MAX_DAYS} days.` };
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) || null : null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  return { email, name, experiences, adultConfirmed, endsAt, expiresInDays: days, note };
}

/**
 * How the invite reaches the person. "email" -- Supabase sends it to the mailbox -- everywhere that matters.
 * "link" -- the link is generated and returned to the CALLER instead of sent -- exists only so the staging
 * acceptance harness can complete an invitation without a mailbox, and ONLY when all three hold:
 *   1. INDIVIDUAL_INVITE_TEST_DELIVERY=link was set deliberately,
 *   2. this is not a production build (NODE_ENV !== "production": a local `next dev`, never Vercel),
 *   3. the Supabase project is identifiably NOT production (judgeTarget, scripts/production-guard.ts -- the
 *      one production predicate, not a copy of it).
 * Any one false, and it is "email". scripts/individual-foundation-harness.ts 12m pins all three.
 */
export function inviteDeliveryMode(env: Record<string, string | undefined> = process.env): "email" | "link" {
  if (env.INDIVIDUAL_INVITE_TEST_DELIVERY !== "link") return "email";
  if (env.NODE_ENV === "production") return "email";
  if (!judgeTarget(env.NEXT_PUBLIC_SUPABASE_URL).ok) return "email";
  return "link";
}

/** Where the invite link lands: the shared password page, then the one sign-in, then Individual. */
export const inviteRedirect = (origin: string) => `${origin}/reset-password?next=${encodeURIComponent(INDIVIDUAL_HOME)}`;

export type InvitationView = {
  id: string; email: string; name: string | null; experiences: ExperienceKey[]; status: "PENDING" | "ACCEPTED" | "REVOKED";
  live: boolean; expiresAt: string; endsAt: string | null; createdAt: string; acceptedAt: string | null;
  revokedAt: string | null; revokedReason: string | null;
};

const experiencesOf = (r: any): ExperienceKey[] =>
  [r.invite_scholar ? "scholar" : null, r.invite_professional ? "professional" : null].filter(Boolean) as ExperienceKey[];

/** Every invitation for an email, newest first, with "live" from the database-clock view. */
export async function invitationsForEmail(admin: any, email: string): Promise<{ ok: true; value: InvitationView[]; provisioned: boolean } | { ok: false; message: string }> {
  const [all, live] = await Promise.all([
    admin.from("individual_invitation")
      .select("id, invited_email, invited_name, invite_scholar, invite_professional, status, expires_at, entitlement_ends_at, created_at, accepted_at, revoked_at, revoked_reason")
      .eq("invited_email", email).order("created_at", { ascending: false }).limit(20),
    admin.from("individual_live_invitation").select("id").eq("invited_email", email).limit(5),
  ]);
  if (isNotProvisioned(all.error) || isNotProvisioned(live.error)) return { ok: true, value: [], provisioned: false };
  if (all.error || live.error) return { ok: false, message: "Invitations could not be read." };
  const liveIds = new Set(((live.data ?? []) as any[]).map(r => r.id));
  return {
    ok: true, provisioned: true,
    value: ((all.data ?? []) as any[]).map(r => ({
      id: r.id, email: r.invited_email, name: r.invited_name ?? null, experiences: experiencesOf(r), status: r.status,
      live: liveIds.has(r.id), expiresAt: r.expires_at, endsAt: r.entitlement_ends_at ?? null, createdAt: r.created_at,
      acceptedAt: r.accepted_at ?? null, revokedAt: r.revoked_at ?? null, revokedReason: r.revoked_reason ?? null,
    })),
  };
}

export type InviteOutcome =
  | { ok: true; invitationId: string; authUserId: string; expiresAt: string; delivery: "email" | "link"; reusedIdentity: boolean; testLink?: string }
  | Refusal;

const NOT_SET_UP: Refusal = { ok: false, status: 503, code: "NOT_SET_UP", message: "Invitations are not set up in this environment yet." };

/**
 * Create an invitation. Order matters: every refusal that can be decided without creating anything is
 * decided first, so a refused invitation leaves no identity behind.
 */
export async function createIndividualInvitation(
  admin: any, req: InvitationRequest, inviter: { id: string },
  opts: { origin: string; delivery: "email" | "link" },
): Promise<InviteOutcome> {
  // 1. One live invitation per email -- any PENDING row, expired or not, holds the address (378's index).
  const pending = await admin.from("individual_invitation").select("id, status").eq("pending_email", req.email).limit(1);
  if (isNotProvisioned(pending.error)) return NOT_SET_UP;
  if (pending.error) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Existing invitations could not be checked." };
  if ((pending.data ?? []).length) {
    const live = await admin.from("individual_live_invitation").select("id").eq("id", pending.data[0].id).limit(1);
    if (live.error) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Existing invitations could not be checked." };
    return (live.data ?? []).length
      ? { ok: false, status: 409, code: "INVITATION_PENDING", message: "This email already has an invitation waiting to be accepted." }
      : { ok: false, status: 409, code: "INVITATION_EXPIRED_PENDING", message: "This email has an expired invitation. Revoke it, with a reason, before inviting again." };
  }

  // 2. An existing Competen account goes to the existing-account grant path -- never a second identity.
  //    The one exception is an identity a previous Individual invitation created that has never been
  //    signed into: inviting again re-sends to that same identity rather than refusing a person who simply
  //    missed the first email.
  const pattern = req.email.replace(/[\\%_]/g, c => "\\" + c);
  const { data: people, error: pErr } = await admin.from("profiles").select("id").ilike("email", pattern).limit(2);
  if (pErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Existing accounts could not be checked." };
  let reuse: string | null = null;
  if ((people ?? []).length > 1) return { ok: false, status: 409, code: "AMBIGUOUS_ACCOUNT", message: "More than one account carries that email address. Resolve that in Users first." };
  if ((people ?? []).length === 1) {
    const id = people[0].id as string;
    const [{ data: prior }, au] = await Promise.all([
      admin.from("individual_invitation").select("id").eq("auth_user_id", id).limit(1),
      admin.auth.admin.getUserById(id),
    ]);
    const neverSignedIn = !au?.error && au?.data?.user && !au.data.user.last_sign_in_at;
    // Owner review item 5: and it must still hold NOTHING. If anybody has since given that identity any
    // standing -- a membership of any product, an HQ appointment, a role -- a fresh sign-in link would hand
    // the inbox authority this invitation never offered. Then it is an existing account, and the
    // administrator grants Individual to it explicitly.
    if (!(prior ?? []).length || !neverSignedIn || !(await identityHoldsNoStanding(admin, id)))
      return { ok: false, status: 409, code: "ACCOUNT_EXISTS", message: "This email already has a Competen account. Grant access to that account instead.", personId: id };
    reuse = id;
  }

  // 3. The identity, through Supabase auth. Never a platform membership.
  const redirectTo = inviteRedirect(opts.origin);
  let authUserId: string;
  let testLink: string | undefined;
  if (opts.delivery === "link") {
    const { data, error } = await admin.auth.admin.generateLink({
      type: reuse ? "recovery" : "invite", email: req.email,
      options: { redirectTo, ...(reuse ? {} : { data: { full_name: req.name } }) },
    });
    if (error || !data?.user) return { ok: false, status: 502, code: "IDENTITY_FAILED", message: "The invitation could not be created." };
    authUserId = data.user.id; testLink = data.properties?.action_link;
  } else if (reuse) {
    const { error } = await admin.auth.resetPasswordForEmail(req.email, { redirectTo });
    if (error) return { ok: false, status: 502, code: "DELIVERY_FAILED", message: "The invitation email could not be sent." };
    authUserId = reuse;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(req.email, { redirectTo, data: { full_name: req.name } });
    if (error || !data?.user) {
      // GoTrue refuses an address it already holds -- an identity profiles did not show (a race, or a
      // half-created account). That is an existing account, not a new one.
      if (/already been registered|already exists/i.test(error?.message ?? ""))
        return { ok: false, status: 409, code: "ACCOUNT_EXISTS", message: "This email already has a Competen account. Grant access to that account instead." };
      return { ok: false, status: 502, code: "DELIVERY_FAILED", message: "The invitation email could not be sent." };
    }
    authUserId = data.user.id;
  }

  // 3b. No estate standing. handle_new_user() wrote its default role ('nurse') into the new profiles row;
  //     an Individual-only identity holds no estate role, the same rule Competen Practice registration keeps
  //     (practiceIdentityProfile). Written only to an identity THIS call created -- never to a reused one,
  //     and never to any existing account.
  if (!reuse) {
    const clear = await admin.from("profiles").update(individualIdentityProfile()).eq("id", authUserId);
    if (clear.error) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => {});
      return { ok: false, status: 503, code: "WRITE_FAILED", message: "The invitation could not be created." };
    }
  }

  // 4. The record. expires_at is SET from the request -- a deadline, written once -- and a minute short of
  //    the full window so a slightly fast application clock cannot trip 378's thirty-day CHECK against the
  //    database's created_at. Whether the deadline has PASSED is never decided here: only
  //    individual_live_invitation (the database clock) answers that.
  const expires = new Date(Date.now() + req.expiresInDays * 86_400_000 - 60_000).toISOString();
  const row = await admin.from("individual_invitation").insert({
    invited_email: req.email, invited_name: req.name,
    invite_scholar: req.experiences.includes("scholar"), invite_professional: req.experiences.includes("professional"),
    ...(req.experiences.includes("scholar") ? { adult_confirmed_at: new Date().toISOString(), adult_confirmed_by: inviter.id } : {}),
    entitlement_ends_at: req.endsAt, note: req.note, expires_at: expires, auth_user_id: authUserId, created_by: inviter.id,
  }).select("id, expires_at").single();
  if (row.error || !row.data) {
    // ⚠ NO ORPHANED IDENTITY. An identity THIS call created, for an invitation that was then not recorded,
    // is removed again -- the same rollback /super-admin/users makes when its profile write fails. A reused
    // identity is never touched.
    if (!reuse) await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    if (String(row.error?.code) === "23505")
      return { ok: false, status: 409, code: "INVITATION_PENDING", message: "This email already has an invitation waiting to be accepted." };
    return { ok: false, status: 503, code: "WRITE_FAILED", message: "The invitation could not be recorded." };
  }
  return {
    ok: true, invitationId: row.data.id, authUserId, expiresAt: row.data.expires_at, delivery: opts.delivery,
    reusedIdentity: !!reuse, ...(opts.delivery === "link" && testLink ? { testLink } : {}),
  };
}

/** Revoke a PENDING invitation, with a reason. The row stays; the identity it created is not deleted. */
export async function revokeIndividualInvitation(admin: any, invitationId: string, actorId: string, reason: string): Promise<{ ok: true } | Refusal> {
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "invitationId is required." };
  if (reason.trim().length < 8) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "Say why the invitation is revoked (at least 8 characters)." };
  const upd = await admin.from("individual_invitation")
    .update({ status: "REVOKED", revoked_at: new Date().toISOString(), revoked_by: actorId, revoked_reason: reason.trim().slice(0, 500) })
    .eq("id", invitationId).eq("status", "PENDING").select("id");
  if (isNotProvisioned(upd.error)) return NOT_SET_UP;
  if (upd.error) return { ok: false, status: 503, code: "WRITE_FAILED", message: "The invitation could not be revoked." };
  if (!(upd.data ?? []).length) return { ok: false, status: 409, code: "NOT_PENDING", message: "Only an invitation that is still waiting can be revoked." };
  return { ok: true };
}

export type LiveInvitation = { id: string; experiences: ExperienceKey[]; expiresAt: string; endsAt: string | null };

/** The invitation the signed-in person can accept now, or null. A failed read is reported, not hidden. */
export async function liveInvitationFor(admin: any, userId: string): Promise<{ ok: true; value: LiveInvitation | null } | { ok: false }> {
  const { data, error } = await admin.from("individual_live_invitation")
    .select("id, invite_scholar, invite_professional, expires_at, entitlement_ends_at")
    .eq("auth_user_id", userId).order("created_at", { ascending: false }).limit(1);
  if (isNotProvisioned(error)) return { ok: true, value: null };
  if (error) return { ok: false };
  const r = (data ?? [])[0];
  return { ok: true, value: r ? { id: r.id, experiences: experiencesOf(r), expiresAt: r.expires_at, endsAt: r.entitlement_ends_at ?? null } : null };
}

/**
 * Accept: only the identity the invitation was made for, only while the database says it is live, only
 * with that identity's email confirmed and matching. Then the one grant engine, with the inviter as grantor.
 */
export async function acceptIndividualInvitation(
  admin: any, user: { id: string; email: string | null; emailConfirmedAt: string | null },
): Promise<{ ok: true; invitationId: string; experiences: ExperienceKey[]; grant: Extract<GrantOutcome, { ok: true }> } | Refusal> {
  const { data, error } = await admin.from("individual_live_invitation")
    .select("id, invited_email, invite_scholar, invite_professional, adult_confirmed_at, entitlement_ends_at, note, created_by")
    .eq("auth_user_id", user.id).order("created_at", { ascending: false }).limit(1);
  if (isNotProvisioned(error)) return { ok: false, status: 404, code: "NO_INVITATION", message: "There is no invitation waiting for this account." };
  if (error) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Your invitation could not be read. Try again shortly." };
  const inv = (data ?? [])[0];
  if (!inv) return { ok: false, status: 404, code: "NO_INVITATION", message: "There is no invitation waiting for this account. It may have expired or been withdrawn." };
  if (!user.emailConfirmedAt || (user.email ?? "").trim().toLowerCase() !== inv.invited_email)
    return { ok: false, status: 403, code: "EMAIL_NOT_CONFIRMED", message: "Open the invitation email and set your password first, then accept here." };
  if (!inv.created_by) return { ok: false, status: 409, code: "INVITER_GONE", message: "The person who invited you no longer has an account here. Ask Competen to invite you again." };

  const experiences = experiencesOf(inv);
  const grant = await grantIndividualAccess(admin, {
    targetUserId: user.id, experiences, adultConfirmed: inv.invite_scholar, endsAt: inv.entitlement_ends_at ?? null,
    adultConfirmedAt: inv.adult_confirmed_at ?? null, note: inv.note ?? `Invitation ${inv.id}`,
  }, inv.created_by);
  if (!grant.ok) return { ok: false, status: grant.status, code: grant.code, message: grant.code === "END_DATE_NOT_FUTURE" ? "The access period this invitation offered has already ended. Ask Competen to invite you again." : grant.message };

  const upd = await admin.from("individual_invitation").update({ status: "ACCEPTED", accepted_at: new Date().toISOString() })
    .eq("id", inv.id).eq("status", "PENDING").select("id");
  // The grant is idempotent per experience, so a failed status write is repaired by accepting again.
  if (upd.error) return { ok: false, status: 503, code: "WRITE_FAILED", message: "Your access is in place, but the invitation could not be closed. Accept again to finish." };
  return { ok: true, invitationId: inv.id, experiences, grant };
}
