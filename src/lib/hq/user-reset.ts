/* eslint-disable @typescript-eslint/no-explicit-any */
import { estateRolesOf, hasPlatformRole } from "@/lib/roles";
import { SITE_URL } from "@/lib/marketing/site";
import { dispatch } from "@/lib/notifications/dispatch";
import { currentTraceId } from "@/lib/trace";

// ── ADMINISTRATOR-INITIATED PASSWORD RESET ── HQ-USERS-B, owner GO 2026-10-23, migration 379 ───────────
//
// One governed path: POST /api/super-admin/users/reset, behind hqApiGate(["hq.platform.users.reset"]).
// The decision is pure (decideReset) and its order is the rule:
//
//   1. yourself          refused, by name: your own password goes through Forgot password, which stays.
//   2. actor rate limit  20 REQUESTS per administrator per hour -> 429.
//   3. target rate limit 3 REQUESTS per person per hour     } every one of these answers the SAME neutral
//   4. no such account                                       }  sentence, so the administrator cannot use
//   5. owner account (owners only)                           }  this route to learn whether an address
//   6. suspended                                             }  exists, is an owner, is suspended or is
//   7. unverified email                                      }  unverified. The audit row keeps the reason.
//   8. send.
//
// ⚠ THE LINK NEVER PASSES THROUGH COMPETEN. The email is Supabase Auth recovery (resetPasswordForEmail)
// to the account's VERIFIED Auth address -- not profiles.email, which can drift. The route returns no
// link and no token, and the audit rows record who, whom, when and the outcome, never an address or a token.
//
// ⚠ THE RETURN URL IS CONFIGURED, NEVER THE REQUEST'S. SITE_URL (NEXT_PUBLIC_SITE_URL) plus
// /reset-password?initiated=admin. A spoofed Host header cannot steer where the link lands, and
// `initiated=admin` is how the reset page tells the person an administrator sent it.
//
// ⚠ THE RATE LIMIT IS ATOMIC AND ON THE DATABASE CLOCK. hq_reserve_password_reset (migration NNN) takes one
// advisory lock, counts this hour's reservations by now(), and inserts this request's reservation row, all
// in one transaction, so two simultaneous requests cannot both take the last slot. Its limits (3 and 20)
// are fixed inside the function: the application cannot widen them. Unavailable means refused, never
// unmetered.

export const RESET_CAPABILITY = "hq.platform.users.reset";
export const TARGET_LIMIT = 3;
export const ACTOR_LIMIT = 20;
/** The audit actions. RESET_SENT is the name the owner-only route always used, so its history counts too. */
/** Written by hq_reserve_password_reset for every request it lets through: the row the limits count. */
export const RESET_RESERVED = "admin_password_reset_reserved";
export const RESERVE_FUNCTION = "hq_reserve_password_reset";
export const RESET_SENT = "send_password_reset";
export const RESET_REFUSED = "admin_password_reset_refused";

export const NEUTRAL_MESSAGE = "If that account can receive a password reset, an email is on its way to its verified address.";
export const SELF_MESSAGE = "You cannot send yourself an administrator reset. Use Forgot password on the sign-in page.";
export const ACTOR_LIMIT_MESSAGE = `You have made ${ACTOR_LIMIT} password-reset requests in the last hour. Try again later.`;

/** A user id as Supabase Auth issues it. Local on purpose: HQ code does not import a product's validators. */
export const isUserId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const resetReturnUrl = () => `${SITE_URL}/reset-password?initiated=admin`;

export type RefusalReason = "unknown_target" | "owner_target" | "suspended" | "unverified_email" | "target_rate_limited" | "send_failed";
export type TargetFacts = { email: string | null; emailVerified: boolean; isOwnerAccount: boolean; suspended: boolean };
export type Decision = { kind: "self" } | { kind: "actor_limited" } | { kind: "refuse"; reason: RefusalReason } | { kind: "send" };
/** What the reservation function answered. */
export type Reservation = "reserved" | "actor_limited" | "target_limited";

/** Pure: the decision, in the order the rule states. */
export function decideReset(i: {
  actorId: string; actorIsOwner: boolean; targetId: string; target: TargetFacts | null; reservation: Reservation;
}): Decision {
  if (i.targetId === i.actorId) return { kind: "self" };
  if (i.reservation === "actor_limited") return { kind: "actor_limited" };
  if (i.reservation === "target_limited") return { kind: "refuse", reason: "target_rate_limited" };
  if (!i.target) return { kind: "refuse", reason: "unknown_target" };
  if (i.target.isOwnerAccount && !i.actorIsOwner) return { kind: "refuse", reason: "owner_target" };
  if (i.target.suspended) return { kind: "refuse", reason: "suspended" };
  if (!i.target.email || !i.target.emailVerified) return { kind: "refuse", reason: "unverified_email" };
  return { kind: "send" };
}

/** Pure: the HTTP answer for a decision. Every refusal of a TARGET reads the same. */
export function responseFor(d: Decision | { kind: "sent" }): { status: number; body: Record<string, unknown> } {
  if (d.kind === "self") return { status: 403, body: { error: SELF_MESSAGE } };
  if (d.kind === "actor_limited") return { status: 429, body: { error: ACTOR_LIMIT_MESSAGE } };
  return { status: 202, body: { ok: true, message: NEUTRAL_MESSAGE } };
}

/** Pure: whether a stored suspension is in force at database time `at`. */
export function isSuspended(bannedUntil: string | null | undefined, accountStatus: string | null | undefined, at: string): boolean {
  if ((accountStatus ?? "").toLowerCase() === "suspended") return true;
  return !!bannedUntil && Date.parse(bannedUntil) > Date.parse(at);
}

/** Pure: a provider message with any email address replaced, so it can be logged. */
export const redactAddresses = (s: string) => s.replace(/[^\s"'<>@]+@[^\s"'<>@]+/g, "[address]");

type Actor = { userId: string; fullName: string | null; isOwner: boolean };
const audit = async (admin: any, actor: Actor, action: string, targetId: string, value: Record<string, unknown>) =>
  admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: actor.userId, actor_name: actor.fullName,
    action, entity_type: "user", entity_id: targetId, new_value: value,
  }).select("created_at").single();

const isReservation = (v: unknown): v is Reservation => v === "reserved" || v === "actor_limited" || v === "target_limited";

/** The whole request: atomic reservation, facts, decision, send, outcome row, in-app notice. */
export async function requestAdminReset(admin: any, actor: Actor, targetId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (targetId === actor.userId) {
    await audit(admin, actor, RESET_REFUSED, targetId, { reason: "self" });
    return responseFor({ kind: "self" });
  }
  const { data: res, error: resErr } = await admin.rpc(RESERVE_FUNCTION, {
    p_actor: actor.userId, p_target: targetId, p_actor_name: actor.fullName, p_trace: await currentTraceId(),
  });
  const row = Array.isArray(res) ? res[0] : res;
  // A limit that cannot be applied is not a limit that was met: refuse rather than send unmetered.
  if (resErr || !isReservation(row?.outcome) || !row?.reserved_at) return { status: 503, body: { error: "The reset could not be checked, so it was not sent. Try again shortly." } };
  const reservation: Reservation = row.outcome;
  const at: string = row.reserved_at;

  let target: TargetFacts | null = null;
  const { data: au } = await admin.auth.admin.getUserById(targetId).catch(() => ({ data: null }));
  if (au?.user) {
    const { data: p } = await admin.from("profiles").select("role, roles, platform_role, platform_roles, account_status").eq("id", targetId).maybeSingle();
    target = {
      email: au.user.email ?? null,
      emailVerified: !!au.user.email_confirmed_at,
      isOwnerAccount: estateRolesOf(p).includes("super_admin") || hasPlatformRole(p, "platform_owner"),
      suspended: isSuspended(au.user.banned_until, p?.account_status, at),
    };
  }

  const d = decideReset({ actorId: actor.userId, actorIsOwner: actor.isOwner, targetId, target, reservation });
  if (d.kind === "actor_limited") {
    await audit(admin, actor, RESET_REFUSED, targetId, { reason: "actor_rate_limited" });
    return responseFor(d);
  }
  if (d.kind === "refuse") {
    await audit(admin, actor, RESET_REFUSED, targetId, { reason: d.reason });
    return responseFor(d);
  }
  if (d.kind !== "send" || !target?.email) return responseFor({ kind: "refuse", reason: "unknown_target" });

  const { error } = await admin.auth.resetPasswordForEmail(target.email, { redirectTo: resetReturnUrl() });
  if (error) {
    // The provider's reason, for whoever runs the platform -- never the address, never a link. The
    // provider's own message can quote the address ("Email address "x@y" is invalid"), so it is redacted.
    console.warn(`[admin-password-reset] Supabase recovery refused the send for user ${targetId}: ${redactAddresses(error.message)}`);
    await audit(admin, actor, RESET_REFUSED, targetId, { reason: "send_failed" });
    return responseFor({ kind: "refuse", reason: "send_failed" });
  }
  await audit(admin, actor, RESET_SENT, targetId, { initiated_by: "administrator", channel: "supabase_recovery" });
  // In-app only, and no link: it tells the person the email came from an administrator, so an
  // unexpected one is recognisable. Best effort -- the reset is already on its way.
  await dispatch(admin, [targetId], {
    type: "security",
    title: "An administrator sent you a password-reset email",
    body: "A Competen administrator asked for a password-reset link to be emailed to you. If you did not expect it, ignore the email and contact your administrator.",
    href: null,
  }, ["in_app"]).catch(() => {});
  return responseFor({ kind: "sent" });
}
