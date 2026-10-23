import { NextResponse } from "next/server";
import { requireIndividualSession, isSessionRefusal } from "@/lib/individual/guard";
import { currentTraceId } from "@/lib/trace";
import { acceptIndividualInvitation } from "@/lib/individual/invitations";
import { forQuery } from "@/lib/individual/entry";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/invitation/accept -- COMPETEN-IND-ACCESS-001 (invitations), migration 378.
//
// ⚠ THE ONE PERSON-FACING INDIVIDUAL ROUTE BEHIND requireIndividualSession, NOT requireIndividualContext.
// That guard refuses anyone without a membership, and an invited person has none until this route runs.
// requireIndividualSession is the pre-membership boundary: the release gate FIRST (404 while Individual is
// off), then the signed-in session (401). scripts/individual-foundation-harness.ts 12l pins it, and
// scripts/auth-boundary-harness.ts registers it as a boundary.
//
// ⚠ IT TAKES NOTHING FROM THE BODY. The invitation is found by the session's own user id, through the
// database-clock view, and only that identity -- with its email confirmed and matching -- can accept it.
// The grant itself is grants.ts, unchanged: the inviter as grantor, the inviter's 18+ confirmation (D8).
// The terms gate (D2) then stands between the entitlement and any use of an experience.

export async function POST() {
  const s = await requireIndividualSession();
  if (isSessionRefusal(s)) return s;

  const out = await acceptIndividualInvitation(s.admin, { id: s.userId, email: s.email, emailConfirmedAt: s.emailConfirmedAt });
  if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status });

  await s.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: s.userId, actor_name: null,
    action: "individual_invitation_accepted", entity_type: "individual_invitation", entity_id: out.invitationId,
    new_value: { experiences: out.experiences, granted: out.grant.granted, membership: out.grant.membership },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ ok: true, next: `/individual/welcome${forQuery(out.experiences[0])}` });
}
