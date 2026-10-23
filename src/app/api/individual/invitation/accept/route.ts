import { NextResponse, connection } from "next/server";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { acceptIndividualInvitation } from "@/lib/individual/invitations";
import { forQuery } from "@/lib/individual/entry";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/invitation/accept -- COMPETEN-IND-ACCESS-001 (invitations), migration 378.
//
// ⚠ THE ONE PERSON-FACING INDIVIDUAL ROUTE THAT DOES NOT CALL requireIndividualContext, AND WHY. That guard
// refuses anyone without a membership, and an invited person has none until this route runs. In its place,
// the same order: the release gate FIRST (404 while Individual is off, before any session or table is read),
// then the signed-in session. scripts/individual-foundation-harness.ts 12l pins the order.
//
// ⚠ IT TAKES NOTHING FROM THE BODY. The invitation is found by the session's own user id, through the
// database-clock view, and only that identity -- with its email confirmed and matching -- can accept it.
// The grant itself is grants.ts, unchanged: the inviter as grantor, the inviter's 18+ confirmation (D8).
// The terms gate (D2) then stands between the entitlement and any use of an experience.

export async function POST() {
  await connection();
  const admin = createAdminClientOrNull();
  if (!admin || !(await individualAppEnabled(admin))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const out = await acceptIndividualInvitation(admin, { id: user.id, email: user.email ?? null, emailConfirmedAt: user.email_confirmed_at ?? null });
  if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status });

  await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: user.id, actor_name: null,
    action: "individual_invitation_accepted", entity_type: "individual_invitation", entity_id: out.invitationId,
    new_value: { experiences: out.experiences, granted: out.grant.granted, membership: out.grant.membership },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ ok: true, next: `/individual/welcome${forQuery(out.experiences[0])}` });
}
