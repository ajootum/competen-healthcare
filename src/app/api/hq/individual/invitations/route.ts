import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { createIndividualInvitation, inviteDeliveryMode, isRefusal, validateInvitation } from "@/lib/individual/invitations";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/hq/individual/invitations -- COMPETEN-IND-ACCESS-001 (invitations), migration 378.
//
// Invite an email address that has NO Competen account into Competen Scholar, Professional or both. Body:
// { email, name?, experiences, adultConfirmed, endsOn?, expiresInDays?, note? }.
//
// ⚠ THE SAME DOOR AS THE GRANT: hqApiGate(["hq.individual.pilot.grant"]), then the release gate. Holding the
// right opens nothing while Individual is switched off. An address that already has an account is refused
// with ACCOUNT_EXISTS and goes through the existing grant -- one identity per person, never a second.
//
// ⚠ IT CREATES AN IDENTITY AND NOTHING ELSE. Supabase auth's invite makes the auth user and its profiles row.
// No platform, enterprise or practice membership, no estate role, and no Individual membership or
// entitlement -- those wait for the person to accept (src/lib/individual/invitations.ts).
//
// ⚠ THE LINK IS NEVER IN THE RESPONSE, except under the test delivery mode, which cannot run on a deployed
// build or against production (inviteDeliveryMode).

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.pilot.grant"]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await individualAppEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  const parsed = validateInvitation(await req.json().catch(() => ({})));
  if (isRefusal(parsed)) return NextResponse.json({ error: { code: parsed.code, message: parsed.message } }, { status: parsed.status });

  const delivery = inviteDeliveryMode();
  const outcome = await createIndividualInvitation(ctx.admin, parsed, { id: ctx.userId }, { origin: new URL(req.url).origin, delivery });
  if (!outcome.ok)
    return NextResponse.json({ error: { code: outcome.code, message: outcome.message, ...(outcome.personId ? { personId: outcome.personId } : {}) } }, { status: outcome.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: "individual_invitation_created", entity_type: "individual_invitation", entity_id: outcome.invitationId,
    new_value: {
      email: parsed.email, experiences: parsed.experiences, auth_user_id: outcome.authUserId, reused_identity: outcome.reusedIdentity,
      adult_confirmed: parsed.experiences.includes("scholar") ? parsed.adultConfirmed : null,
      ends_at: parsed.endsAt, expires_at: outcome.expiresAt, delivery: outcome.delivery, note: parsed.note,
    },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json(outcome, { status: 201 });
}
