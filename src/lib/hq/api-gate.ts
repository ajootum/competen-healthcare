import { NextResponse } from "next/server";
import { resolveHqContext, type HqContext } from "./context";

/**
 * The HQ capability gate for an API ROUTE.
 *
 * ⚠ WHY THIS IS NOT requireHqCapability. That guard calls redirect(), which is right for a page and wrong
 * for a fetch: the caller gets an opaque redirect instead of a status it can act on. This returns a
 * NextResponse (401 or 403) and the route returns it, matching /api/hq/appointments' local `gate()` — this
 * file just stops the fourth copy of it being written.
 *
 * ⚠ IT ENFORCES, IT DOES NOT OBSERVE. Same argument as CP-HQ-NAV-001 step 3: every route reaching for this
 * ALREADY refuses non-owners today, so honouring hq_config.mode -- which is `observe`, and observe admits a
 * would_deny -- would WIDEN the route rather than narrow it. Refusals are still recorded by resolveHqContext.
 *
 * ⚠ ANY-OF, BECAUSE ONE ENDPOINT CAN BACK TWO CONSOLES. /api/knowledge-objects is called from
 * /super-admin/ckp/* (hq.learning.knowledge.view) and /super-admin/studio/* (hq.learning.studio.view).
 * Requiring one would refuse somebody standing on the other console. No seeded position currently holds one
 * without the other, but a position is DATA -- writing the gate to depend on today's grant table would be a
 * coincidence, not a rule.
 *
 * The loop costs one extra resolution per capability only on the REFUSAL path; a caller holding the first
 * capability pays for exactly one.
 */
export async function hqApiGate(capabilities: string[]): Promise<HqContext | NextResponse> {
  // ⚠ AN EMPTY LIST REFUSES. "Nobody said what this needs" is not "anybody may" -- the same default as
  // capabilityForRoute returning null, and the same one landlordCan had set the wrong way round.
  if (!capabilities.length)
    return NextResponse.json({ error: "This endpoint declares no capability" }, { status: 403 });

  let unauthenticated = false;
  for (const capability of capabilities) {
    const res = await resolveHqContext(capability, { enforce: true });
    if (res.ok) return res.ctx;
    if (res.redirectTo === "/login") unauthenticated = true;
  }

  return unauthenticated
    ? NextResponse.json({ error: "Not signed in" }, { status: 401 })
    // Names no capability, position or office. What a refused caller is MISSING is not something to tell
    // them -- the same rule the /super-admin refusal panel follows.
    : NextResponse.json({ error: "You do not hold a position that opens this part of Competen HQ" }, { status: 403 });
}

/** `if (isHqRefusal(gate)) return gate;` — mirrors api-auth's isResponse. */
export const isHqRefusal = (x: HqContext | NextResponse): x is NextResponse => x instanceof NextResponse;
