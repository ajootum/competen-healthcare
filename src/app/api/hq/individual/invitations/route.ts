import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { createIndividualInvitation, inviteDeliveryMode, isRefusal, validateInvitation } from "@/lib/individual/invitations";
import { SITE_URL } from "@/lib/marketing/site";
import { classifyAtOnboarding, onboardingType } from "@/lib/hq/account-classification";

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

  const body = await req.json().catch(() => ({}));
  const parsed = validateInvitation(body);
  if (isRefusal(parsed)) return NextResponse.json({ error: { code: parsed.code, message: parsed.message } }, { status: parsed.status });
  // Owner 29 Oct 2026: the account type is chosen at onboarding (Human by default), checked before anything is created.
  const kind = onboardingType(body?.accountType);
  if (!kind.ok) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: kind.error } }, { status: 400 });

  const delivery = inviteDeliveryMode();
  // ⚠ THE TRUSTED ORIGIN, NEVER THE REQUEST'S. The invite link's return URL is SITE_URL (the HQ-USERS-B rule,
  // scripts/hq-users-reset-harness.ts R3): a Host or Origin header must not decide where a sign-in link lands.
  const outcome = await createIndividualInvitation(ctx.admin, parsed, { id: ctx.userId }, { origin: SITE_URL, delivery });
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

  // The account type, through the owner-only audited function (650). Not the owner, or 650 absent: said, never undone.
  const classification = await classifyAtOnboarding(ctx.admin, { id: ctx.userId, name: ctx.fullName ?? null, isOwner: ctx.isOwner }, outcome.authUserId, kind.type, "Individual invitation", await currentTraceId());

  return NextResponse.json({ ...outcome, accountType: classification.ok ? classification.type : "unclassified", ...(classification.ok ? {} : { classificationWarning: classification.error }) }, { status: 201 });
}
