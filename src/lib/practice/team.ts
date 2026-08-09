import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { INVITABLE_ROLES, INVITE_EXPIRY_BOUNDS } from "@/lib/practice/team-constants";

// CPR-310 TEAM AND DELEGATED ACCESS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ESCALATION RULE, STATED ONCE: YOU CANNOT DELEGATE A CAPABILITY YOU DO NOT HOLD.
//
// Migration 191 deliberately gives the owner administration and NO clinical access -- owning a practice
// is a business role, and a business role does not read consultations. The owner is also the only person
// who can manage the team. Without this rule those two facts combine into a one-click privilege
// escalation: grant yourself encounter.list, read everything, revoke it again.
//
// So delegation LENDS WHAT YOU HAVE. It never mints what you lack. A practice that needs a capability
// nobody holds gets it the way it always did -- from a role, at the point somebody is given that role.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// AN INVITATION CODE IS A BEARER CREDENTIAL. This product has no email and no SMS (CPR-320/340), and
// inventing delivery for invitations alone would make every other honest statement about sending false.
// The code is handed over however that practice already trusts. Single-use, short-lived, revocable.
//
// EXPIRY IS DERIVED. `status` holds PENDING / ACCEPTED / REVOKED -- what a human did -- and expired is
// the clock against expires_at at read time, so nothing has to run for an old code to stop working.
//
// A WORKSPACE MAY NEVER LOSE ITS LAST OWNER. Refused here with a reason, and refused again by migration
// 201's trigger for anything that reaches the table another way.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

// The invitable roles live in team-constants (no server imports) so the console offers exactly what
// the engine accepts. Re-exported here because callers reach for it by this name.
export { INVITABLE_ROLES } from "@/lib/practice/team-constants";

/**
 * An unambiguous code. Same alphabet as the practice identifiers in migration 193 -- no 0/O/1/I --
 * because this one gets read down a phone line, which is precisely where those characters cost a
 * repeated call.
 */
function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  const body = Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
  return `${body.slice(0, 5)}-${body.slice(5)}`;
}

async function recordEvent(admin: any, workspaceId: string, args: {
  subjectUserId: string; eventType: string; from?: string | null; to?: string | null;
  note?: string; actorId: string;
}) {
  await admin.from("practice_membership_event").insert({
    workspace_id: workspaceId, subject_user_id: args.subjectUserId, event_type: args.eventType,
    from_value: args.from ?? null, to_value: args.to ?? null, note: args.note ?? null, actor_id: args.actorId,
  });
}

/** Every capability live for this user in this workspace, right now. The basis of the escalation rule. */
async function liveCapabilities(admin: any, workspaceId: string, userId: string): Promise<Set<string>> {
  const { data: memberships } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active");
  const ids = ((memberships ?? []) as any[]).map(m => m.id);
  if (ids.length === 0) return new Set();

  const { data: grants } = await admin.from("practice_role_assignment")
    .select("capability_code, effective_from, effective_to").in("membership_id", ids);
  const now = nowIso();
  return new Set(((grants ?? []) as any[])
    .filter(g => (!g.effective_from || g.effective_from <= now) && (g.effective_to === null || g.effective_to > now))
    .map(g => g.capability_code as string));
}

// ── THE TEAM ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Everyone with a membership, live or ended, with their capabilities and any delegation behind them.
 *
 * REVOKED PEOPLE ARE LISTED, not filtered out. "Who used to have access" is the question an audit asks,
 * and a team page that shows only current members answers it with silence.
 */
export async function listTeam(admin: any, workspaceId: string) {
  const { data: memberships } = await admin.from("practice_membership")
    .select("id, user_id, role_code, status, joined_at, created_at")
    .eq("workspace_id", workspaceId).order("created_at");
  const rows = (memberships ?? []) as any[];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map(m => m.user_id))];
  const [{ data: profiles }, { data: grants }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", userIds),
    admin.from("practice_role_assignment")
      .select("membership_id, capability_code, source, effective_from, effective_to, created_by")
      .in("membership_id", rows.map(m => m.id)),
  ]);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
  const now = nowIso();

  // One entry per PERSON. Provisioning gives the owner two memberships, and a team page listing them
  // twice invites somebody to revoke one and wonder why access persists.
  const byUser = new Map<string, any>();
  for (const m of rows) {
    const mine = ((grants ?? []) as any[]).filter(g => g.membership_id === m.id);
    const live = mine.filter(g =>
      (!g.effective_from || g.effective_from <= now) && (g.effective_to === null || g.effective_to > now));

    const entry = byUser.get(m.user_id) ?? {
      userId: m.user_id, name: nameOf.get(m.user_id) ?? null,
      memberships: [] as any[], capabilities: new Set<string>(), delegations: [] as any[],
      active: false, joinedAt: m.joined_at ?? m.created_at,
    };
    entry.memberships.push({ id: m.id, roleCode: m.role_code, status: m.status });
    if (m.status === "active") {
      entry.active = true;
      for (const g of live) entry.capabilities.add(g.capability_code);
      for (const g of live.filter(x => x.source === "delegation")) {
        entry.delegations.push({
          capability: g.capability_code, from: g.effective_from, to: g.effective_to, grantedBy: g.created_by,
        });
      }
    }
    byUser.set(m.user_id, entry);
  }

  return [...byUser.values()].map(e => ({
    ...e,
    roles: e.memberships.filter((m: any) => m.status === "active").map((m: any) => m.roleCode),
    endedRoles: e.memberships.filter((m: any) => m.status !== "active").map((m: any) => `${m.roleCode} (${m.status})`),
    capabilities: [...e.capabilities].sort(),
  }));
}

// ── INVITATIONS ──────────────────────────────────────────────────────────────────────────────────────

export async function createInvitation(admin: any, args: {
  workspaceId: string; roleCode: string; invitedName?: string; invitedEmail?: string; note?: string;
  expiresInDays?: number; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; code: string; expiresAt: string }>> {
  if (!INVITABLE_ROLES.some(([r]) => r === args.roleCode))
    return {
      ok: false, status: 400, code: "ROLE_NOT_INVITABLE",
      message: `role must be one of: ${INVITABLE_ROLES.map(([r]) => r).join(", ")}`,
    };

  const days = Math.min(Math.max(args.expiresInDays ?? INVITE_EXPIRY_BOUNDS.default, INVITE_EXPIRY_BOUNDS.min), INVITE_EXPIRY_BOUNDS.max);
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  // The unique index is the backstop; the retry is for the birthday-problem collision, which at this
  // alphabet and length is vanishingly unlikely and still worth not turning into a 500.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data: invite, error } = await admin.from("practice_invitation").insert({
      workspace_id: args.workspaceId, role_code: args.roleCode, code,
      invited_email: args.invitedEmail?.trim() || null, invited_name: args.invitedName?.trim() || null,
      note: args.note?.trim() || null, status: "PENDING", expires_at: expiresAt, created_by: args.actorId,
    }).select("id, code, expires_at").single();

    if (error) {
      if (/duplicate|unique/i.test(error.message)) continue;
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
    }

    await audit(admin, {
      workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.invitation_created",
      // THE CODE IS NEVER AUDITED. It is a live credential until it is redeemed, and an audit trail is
      // read by more people than the person who was meant to receive it.
      payload: { invitationId: invite.id, roleCode: args.roleCode, expiresAt },
      correlationId: args.correlationId,
    });
    return { ok: true, data: { id: invite.id as string, code: invite.code as string, expiresAt: invite.expires_at as string } };
  }
  return { ok: false, status: 503, code: "CODE_GENERATION_FAILED", message: "could not mint a unique code; try again" };
}

export async function revokeInvitation(admin: any, args: {
  workspaceId: string; invitationId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: invite } = await admin.from("practice_invitation")
    .select("id, status").eq("id", args.invitationId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!invite) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (invite.status !== "PENDING")
    return { ok: false, status: 422, code: "NOT_PENDING", message: `this invitation is already ${invite.status.toLowerCase()}` };

  await admin.from("practice_invitation")
    .update({ status: "REVOKED", revoked_at: nowIso() }).eq("id", invite.id);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.invitation_revoked",
    payload: { invitationId: invite.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "REVOKED" } };
}

/** Pending, accepted and revoked, each carrying whether it has expired -- derived, never stored. */
export async function listInvitations(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_invitation")
    .select("id, role_code, invited_name, invited_email, note, status, expires_at, accepted_by, accepted_at, created_at")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
  const now = nowIso();
  return ((data ?? []) as any[]).map(i => ({
    ...i,
    expired: i.status === "PENDING" && i.expires_at <= now,
    // THE CODE IS NOT RETURNED. It is shown once, at creation, to the person who made it. A team page
    // that lists live codes turns one careless screen-share into an open door.
    usable: i.status === "PENDING" && i.expires_at > now,
  }));
}

/**
 * Redeem a code. The ONE function here that runs for somebody who is not yet a member of anything, so
 * it takes the workspace from the invitation rather than from a caller context.
 */
export async function acceptInvitation(admin: any, args: {
  code: string; userId: string; correlationId: string;
}): Promise<EngineResult<{ workspaceId: string; workspaceName: string; roleCode: string }>> {
  const code = args.code.trim().toUpperCase();
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };

  const { data: invite } = await admin.from("practice_invitation")
    .select("id, workspace_id, role_code, status, expires_at").eq("code", code).maybeSingle();
  // ONE MESSAGE FOR EVERY BAD CODE. Distinguishing "no such code" from "already used" from "expired"
  // tells somebody guessing which of their guesses was nearly right.
  const refuse: EngineResult<never> = {
    ok: false, status: 404, code: "INVALID_CODE", message: "that code is not valid, or is no longer usable",
  };
  if (!invite || invite.status !== "PENDING" || invite.expires_at <= nowIso()) return refuse;

  const { data: workspace } = await admin.from("practice_workspace")
    .select("id, name, status").eq("id", invite.workspace_id).maybeSingle();
  if (!workspace) return refuse;
  if (!["ACTIVE", "ONBOARDING", "PROVISIONING"].includes(workspace.status))
    return { ok: false, status: 422, code: "WORKSPACE_INACTIVE", message: "that practice is not currently active" };

  const { data: existing } = await admin.from("practice_membership")
    .select("id, status").eq("workspace_id", invite.workspace_id).eq("user_id", args.userId)
    .eq("role_code", invite.role_code).eq("status", "active").maybeSingle();
  if (existing)
    return { ok: false, status: 409, code: "ALREADY_A_MEMBER", message: "you already hold that role in this practice" };

  const { data: membership, error } = await admin.from("practice_membership").insert({
    workspace_id: invite.workspace_id, user_id: args.userId, role_code: invite.role_code,
    status: "active", joined_at: nowIso(), created_by: args.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // THE ROLE'S CAPABILITIES, granted at join. The same insert..select the migrations use -- the standing
  // rule since the Phase-1 bug: a membership without its capability rows is an empty sidebar and 403
  // everywhere, and it fails silently.
  const { data: roleCaps } = await admin.from("practice_role_capabilities")
    .select("capability_code").eq("role_code", invite.role_code);
  const wanted = ((roleCaps ?? []) as any[]).map(c => c.capability_code);
  if (wanted.length > 0) {
    const { error: grantError } = await admin.from("practice_role_assignment").insert(
      wanted.map(capability_code => ({
        membership_id: membership.id, capability_code, source: "role_default", created_by: args.userId,
      })),
    );
    if (grantError) {
      // A member who can sign in and do nothing is worse than a failed join, and it is invisible.
      await admin.from("practice_membership").delete().eq("id", membership.id);
      return { ok: false, status: 500, code: "CAPABILITY_GRANT_FAILED", message: grantError.message };
    }
  }

  await admin.from("practice_invitation")
    .update({ status: "ACCEPTED", accepted_by: args.userId, accepted_at: nowIso() }).eq("id", invite.id);
  await recordEvent(admin, invite.workspace_id, {
    subjectUserId: args.userId, eventType: "joined", to: invite.role_code, actorId: args.userId,
  });
  await audit(admin, {
    workspaceId: invite.workspace_id, actorId: args.userId, eventType: "practice.member_joined",
    payload: { invitationId: invite.id, roleCode: invite.role_code, capabilities: wanted.length },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: { workspaceId: invite.workspace_id as string, workspaceName: workspace.name as string, roleCode: invite.role_code as string },
  };
}

// ── MEMBERSHIP LIFECYCLE ─────────────────────────────────────────────────────────────────────────────

/**
 * Suspend, reinstate or revoke somebody's membership.
 *
 * REVOKED WORK DOES NOT VANISH. CPR-340 derives "assigned to somebody who can no longer see it" at read
 * time, so the moment this lands, their open tasks appear on the board as orphaned. That is the design:
 * removing access is one decision, and rehoming the work is another that a person should make.
 */
export async function setMembershipStatus(admin: any, args: {
  workspaceId: string; membershipId: string; status: "active" | "suspended" | "revoked";
  note?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: membership } = await admin.from("practice_membership")
    .select("id, user_id, role_code, status").eq("id", args.membershipId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!membership) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (membership.status === args.status)
    return { ok: false, status: 422, code: "NO_CHANGE", message: `that membership is already ${args.status}` };

  // Refused here with a sentence somebody can act on; refused again by migration 201's trigger for
  // anything that reaches the table another way.
  if (membership.role_code === "practice_owner" && membership.status === "active" && args.status !== "active") {
    const { count } = await admin.from("practice_membership")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", args.workspaceId).eq("role_code", "practice_owner").eq("status", "active")
      .neq("id", membership.id);
    if ((count ?? 0) === 0)
      return {
        ok: false, status: 422, code: "LAST_OWNER",
        message: "this is the last active owner; a practice with no owner cannot be administered at all",
      };
  }

  const { error } = await admin.from("practice_membership")
    .update({ status: args.status, updated_at: nowIso() }).eq("id", membership.id);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  // ENDING A MEMBERSHIP ENDS EVERY LIVE GRANT, not merely the open-ended ones.
  //
  // This first read `.is("effective_to", null)`, which closed role defaults and quietly left DELEGATIONS
  // alone -- a lent capability with a future end date survived the suspension and was live again the
  // moment the person was reinstated, which is the exact thing the comment claimed to prevent. The
  // harness caught it. A grant is live if it has not ended yet, whether or not it was ever going to.
  if (args.status !== "active") {
    const endedAt = nowIso();
    const { data: grants } = await admin.from("practice_role_assignment")
      .select("id, effective_to").eq("membership_id", membership.id);
    const live = ((grants ?? []) as any[]).filter(g => g.effective_to === null || g.effective_to > endedAt);
    if (live.length > 0) {
      await admin.from("practice_role_assignment")
        .update({ effective_to: endedAt }).in("id", live.map(g => g.id));
    }
  }

  const eventType = args.status === "revoked" ? "revoked" : args.status === "suspended" ? "suspended" : "reinstated";
  await recordEvent(admin, args.workspaceId, {
    subjectUserId: membership.user_id, eventType, from: membership.status, to: args.status,
    note: args.note, actorId: args.actorId,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.member_${eventType}`,
    payload: { membershipId: membership.id, subject: membership.user_id, roleCode: membership.role_code },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.status } };
}

/**
 * Reinstating somebody restores their ROLE's capabilities, not the ones they happened to have.
 *
 * Deliberate: a delegation that ended while they were away should stay ended, and re-granting whatever
 * was live at the moment of suspension would resurrect exactly the temporary access somebody chose to
 * bound.
 */
export async function reinstateMembership(admin: any, args: {
  workspaceId: string; membershipId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; restored: number }>> {
  const result = await setMembershipStatus(admin, { ...args, status: "active" });
  if (!result.ok) return result;

  const { data: membership } = await admin.from("practice_membership")
    .select("id, role_code").eq("id", args.membershipId).single();
  const { data: roleCaps } = await admin.from("practice_role_capabilities")
    .select("capability_code").eq("role_code", membership.role_code);

  const wanted = ((roleCaps ?? []) as any[]).map(c => c.capability_code);
  let restored = 0;
  for (const capability_code of wanted) {
    const { data: live } = await admin.from("practice_role_assignment")
      .select("id").eq("membership_id", membership.id).eq("capability_code", capability_code)
      .is("effective_to", null).maybeSingle();
    if (live) continue;
    const { error } = await admin.from("practice_role_assignment").insert({
      membership_id: membership.id, capability_code, source: "role_default", created_by: args.actorId,
    });
    if (!error) restored++;
  }
  return { ok: true, data: { status: "active", restored } };
}

// ── DELEGATION ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Lend a capability to somebody for a bounded window.
 *
 * THE ESCALATION RULE LIVES HERE. See the file header: you cannot delegate what you do not hold.
 */
export async function delegateCapability(admin: any, args: {
  workspaceId: string; membershipId: string; capability: string;
  effectiveFrom?: string; effectiveTo: string; note?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; capability: string; effectiveTo: string }>> {
  const { data: membership } = await admin.from("practice_membership")
    .select("id, user_id, role_code, status").eq("id", args.membershipId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!membership) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (membership.status !== "active")
    return { ok: false, status: 422, code: "MEMBERSHIP_NOT_ACTIVE", message: "that membership is not active" };
  if (membership.user_id === args.actorId)
    return { ok: false, status: 422, code: "SELF_DELEGATION", message: "you cannot delegate to yourself" };

  // A DELEGATION MUST END. An open-ended one is a role change wearing a temporary label, and the whole
  // value of the mechanism is that somebody wrote down when it stops.
  if (!args.effectiveTo) return { ok: false, status: 400, code: "END_REQUIRED", message: "a delegation must say when it ends" };
  const from = args.effectiveFrom ?? nowIso();
  if (args.effectiveTo <= from)
    return { ok: false, status: 400, code: "ENDS_BEFORE_IT_STARTS", message: "the end is not after the start" };

  const held = await liveCapabilities(admin, args.workspaceId, args.actorId);
  if (!held.has(args.capability))
    return {
      ok: false, status: 403, code: "CANNOT_DELEGATE_WHAT_YOU_LACK",
      message: `you do not hold ${args.capability}, so you cannot grant it`,
    };

  const { data: grant, error } = await admin.from("practice_role_assignment").insert({
    membership_id: membership.id, capability_code: args.capability, source: "delegation",
    effective_from: from, effective_to: args.effectiveTo, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await recordEvent(admin, args.workspaceId, {
    subjectUserId: membership.user_id, eventType: "capability_delegated",
    to: args.capability, note: `until ${args.effectiveTo}${args.note ? ` — ${args.note}` : ""}`, actorId: args.actorId,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.capability_delegated",
    payload: { membershipId: membership.id, capability: args.capability, from, to: args.effectiveTo },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: grant.id as string, capability: args.capability, effectiveTo: args.effectiveTo } };
}

/** End a delegation early. Only a delegation: a role default is ended by changing the role. */
export async function endDelegation(admin: any, args: {
  workspaceId: string; grantId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ endedAt: string }>> {
  const { data: grant } = await admin.from("practice_role_assignment")
    .select("id, membership_id, capability_code, source, effective_to").eq("id", args.grantId).maybeSingle();
  if (!grant) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data: membership } = await admin.from("practice_membership")
    .select("id, user_id").eq("id", grant.membership_id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!membership) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (grant.source !== "delegation")
    return {
      ok: false, status: 422, code: "NOT_A_DELEGATION",
      message: "that is a role capability; change the role instead of ending the grant",
    };

  const endedAt = nowIso();
  if (grant.effective_to !== null && grant.effective_to <= endedAt)
    return { ok: false, status: 422, code: "ALREADY_ENDED", message: "that delegation has already ended" };

  await admin.from("practice_role_assignment").update({ effective_to: endedAt }).eq("id", grant.id);
  await recordEvent(admin, args.workspaceId, {
    subjectUserId: membership.user_id, eventType: "delegation_ended", from: grant.capability_code, actorId: args.actorId,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.delegation_ended",
    payload: { grantId: grant.id, capability: grant.capability_code }, correlationId: args.correlationId,
  });
  return { ok: true, data: { endedAt } };
}

/** The trail behind the team: who joined, who changed whose role, who lent what to whom. */
export async function membershipHistory(admin: any, workspaceId: string, limit = 50) {
  const { data } = await admin.from("practice_membership_event")
    .select("id, subject_user_id, event_type, from_value, to_value, note, actor_id, occurred_at")
    .eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const ids = [...new Set([...rows.map(r => r.subject_user_id), ...rows.map(r => r.actor_id)].filter(Boolean))];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
  return rows.map(r => ({
    ...r,
    subject_name: nameOf.get(r.subject_user_id) ?? null,
    actor_name: r.actor_id ? (nameOf.get(r.actor_id) ?? null) : null,
  }));
}
