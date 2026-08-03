import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  listTeam, listInvitations, membershipHistory,
  createInvitation, revokeInvitation, setMembershipStatus, reinstateMembership,
  delegateCapability, endDelegation,
} from "@/lib/practice/team";

// GET   /api/v1/practice/team   -- members, invitations and the trail behind them.
// POST  /api/v1/practice/team   -- { invite: {...} } | { delegate: {...} }
// PATCH /api/v1/practice/team   -- { membershipId, status } | { revokeInvitation } | { endDelegation }
//
// EVERYTHING HERE NEEDS practice.members.manage, which migration 191 gives the owner alone. Reading the
// team is the exception a caller might expect to be looser -- and it is not: this list carries who has
// been revoked and who holds what, which is administrative detail rather than "who are my colleagues".
// The colleague list that task assignment needs is listMembers, and it has always been ungated.

export async function GET() {
  const auth = await requirePracticeContext("practice.members.manage");
  if (isDenied(auth)) return auth;

  const [team, invitations, history] = await Promise.all([
    listTeam(auth.caller.admin, auth.ctx.workspaceId),
    listInvitations(auth.caller.admin, auth.ctx.workspaceId),
    membershipHistory(auth.caller.admin, auth.ctx.workspaceId),
  ]);
  return NextResponse.json({ team, invitations, history, me: auth.caller.userId, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.members.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.invite) {
    const result = await createInvitation(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, roleCode: String(body.invite.roleCode ?? ""),
      invitedName: body.invite.invitedName ? String(body.invite.invitedName) : undefined,
      invitedEmail: body.invite.invitedEmail ? String(body.invite.invitedEmail) : undefined,
      note: body.invite.note ? String(body.invite.note) : undefined,
      expiresInDays: typeof body.invite.expiresInDays === "number" ? body.invite.expiresInDays : undefined,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    // THE CODE IS RETURNED EXACTLY ONCE, here, to the person who created it. It is never listed again.
    return NextResponse.json({ invitation: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.delegate) {
    const result = await delegateCapability(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, membershipId: String(body.delegate.membershipId ?? ""),
      capability: String(body.delegate.capability ?? ""),
      effectiveFrom: body.delegate.effectiveFrom ? String(body.delegate.effectiveFrom) : undefined,
      effectiveTo: String(body.delegate.effectiveTo ?? ""),
      note: body.delegate.note ? String(body.delegate.note) : undefined,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ delegation: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  return NextResponse.json({ error: "send { invite } or { delegate }" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("practice.members.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.revokeInvitation) {
    const result = await revokeInvitation(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, invitationId: String(body.revokeInvitation),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ invitation: result.data, correlationId: auth.caller.traceId });
  }

  if (body.endDelegation) {
    const result = await endDelegation(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, grantId: String(body.endDelegation),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ delegation: result.data, correlationId: auth.caller.traceId });
  }

  if (body.membershipId && body.status) {
    const status = String(body.status);
    if (!["active", "suspended", "revoked"].includes(status))
      return NextResponse.json({ error: "status must be active, suspended or revoked" }, { status: 400 });

    // Reinstating restores the ROLE's capabilities, so it is its own call rather than a status flip --
    // see the engine for why the previously-held set is deliberately not resurrected.
    const result = status === "active"
      ? await reinstateMembership(auth.caller.admin, {
        workspaceId: auth.ctx.workspaceId, membershipId: String(body.membershipId),
        actorId: auth.caller.userId, correlationId: auth.caller.traceId,
      })
      : await setMembershipStatus(auth.caller.admin, {
        workspaceId: auth.ctx.workspaceId, membershipId: String(body.membershipId),
        status: status as "suspended" | "revoked", note: body.note ? String(body.note) : undefined,
        actorId: auth.caller.userId, correlationId: auth.caller.traceId,
      });
    if (!result.ok) return fail(result);
    return NextResponse.json({ membership: result.data, correlationId: auth.caller.traceId });
  }

  return NextResponse.json({ error: "send { membershipId, status }, { revokeInvitation } or { endDelegation }" }, { status: 400 });
}
