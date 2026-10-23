import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { grantIndividualAccess, isGrantRefusal, validateGrant, lookupIndividualPerson, normaliseLookupEmail } from "@/lib/individual/grants";
import { invitationsForEmail } from "@/lib/individual/invitations";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/hq/individual/grants -- COMPETEN-IND-003 owner rulings D8 and D9.
//
// Grants Competen Individual pilot access: the gate-3 membership if the person has none, and one live
// entitlement per requested experience. Body: { targetUserId, experiences: ("scholar"|"professional")[],
// adultConfirmed: boolean, note? }.
//
// ⚠ D9: GATED BY THE EXISTING HQ CAPABILITY MACHINERY, hqApiGate(["hq.individual.pilot.grant"]) -- the
// right the Individual Product Administrator appointment holds. No new authority, no landlord bypass
// beyond the one hqApiGate already gives the platform owners.
//
// ⚠ D8: Scholar is refused unless the administrator confirms the person is 18 or over, and the schema
// refuses a Scholar row without that recorded confirmation.
//
// ⚠ NOT YOURSELF. An administrator does not grant their own access -- the same rule /api/hq/appointments
// applies to appointing yourself. Another holder of the right, or the owner, grants it.

// GET /api/hq/individual/grants?email= -- COMPETEN-IND-ACCESS-001 s4. The lookup behind the HQ grant screen
// (/super-admin/individual): an existing Competen account by email, and the Individual access it holds.
// Same capability, same release gate, as the grant itself.
export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.individual.pilot.grant"]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await individualAppEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const email = normaliseLookupEmail(new URL(req.url).searchParams.get("email"));
  if (!email) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Enter the person's email address." } }, { status: 400 });
  const res = await lookupIndividualPerson(ctx.admin, email);
  if (!res.ok) return NextResponse.json({ error: { code: "UNAVAILABLE", message: res.message } }, { status: 503 });
  // Invitations for the same address (migration 378): an invitation-created identity, and an address with
  // no account at all, both show what was offered. Absent table = not set up here, never an error.
  const inv = await invitationsForEmail(ctx.admin, email);
  if (!inv.ok) return NextResponse.json({ error: { code: "UNAVAILABLE", message: inv.message } }, { status: 503 });
  return NextResponse.json({ ...res.value, isSelf: res.value.found && res.value.person.id === ctx.userId, invitations: inv.value, invitationsProvisioned: inv.provisioned });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.pilot.grant"]);
  if (isHqRefusal(ctx)) return ctx;
  // The release gate (src/lib/individual/gate.ts): with Individual off, the grant right opens nothing.
  if (!(await individualAppEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  const parsed = validateGrant(await req.json().catch(() => ({})));
  if (isGrantRefusal(parsed)) return NextResponse.json({ error: { code: parsed.code, message: parsed.message } }, { status: parsed.status });
  if (parsed.targetUserId === ctx.userId)
    return NextResponse.json({ error: { code: "SELF_GRANT", message: "You cannot grant Competen Individual access to yourself." } }, { status: 403 });

  const outcome = await grantIndividualAccess(ctx.admin, parsed, ctx.userId);
  if (!outcome.ok) return NextResponse.json({ error: { code: outcome.code, message: outcome.message } }, { status: outcome.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: "individual_pilot_grant", entity_type: "individual_membership", entity_id: null,
    new_value: {
      target_user_id: parsed.targetUserId, requested: parsed.experiences, granted: outcome.granted,
      already_live: outcome.alreadyLive, membership: outcome.membership,
      adult_confirmed: parsed.experiences.includes("scholar") ? parsed.adultConfirmed : null,
      ends_at: parsed.endsAt ?? null, note: parsed.note ?? null,
    },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json(outcome, { status: outcome.granted.length ? 201 : 200 });
}
