import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { grantIndividualAccess, isGrantRefusal, validateGrant } from "@/lib/individual/grants";

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
    },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json(outcome, { status: outcome.granted.length ? 201 : 200 });
}
