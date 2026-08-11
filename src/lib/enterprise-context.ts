import { NextResponse } from "next/server";
import { getCaller, isResponse, type Caller } from "@/lib/api-auth";
import { admitToEnterprise, enterpriseRefusalSentence, type EnterpriseMembershipRead } from "@/lib/enterprise-membership";

// The one way an Enterprise route obtains its tenant context. ENT-DEC-001 D4, mirror of
// src/lib/practice/api-context.ts one plane over.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHY THIS FILE IS NOT IN src/lib/enterprise/ -- THE DIRECTORY NAME IS ALREADY TAKEN BY THE LANDLORD.
//
// src/lib/enterprise/*.ts is the org-hierarchy administration module -- its spec was renumbered
// ENT-ORG-001 to end the collision (ENT-DEC-001 D8) -- gated hq.executive.enterprise.view, reading globally with no tenant
// predicate. It is Competen looking at the estate from above. This module is the opposite plane -- a
// hospital tenant looking at its own data -- and putting the tenant gate inside the landlord's directory
// would blur exactly the boundary it exists to draw. It sits at src/lib/ top level beside
// enterprise-membership.ts and platform-membership.ts, because gates are boundaries between products,
// not modules inside one.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ D12 APPLIES TO THIS FILE: src/lib/access/scan.ts LEARNED requireEnterpriseContext IN THE SAME
// COMMIT THAT CREATED IT, and scripts/enterprise-membership-harness.ts asserts the scanner classifies
// it -- BEHAVIOURALLY, by feeding classifyGate a synthetic route, not by grepping this file's name into
// a list. Four prior guard helpers shipped without their scanner entry, and each time the generated
// matrix published gated pages as "reachable without signing in".
//
// ── THE GUARD ORDER, AND WHAT EACH STEP REFUSES ─────────────────────────────────────────────────────
//
//   1. getCaller({ plane: "enterprise" })  authentication. The estate gate is SKIPPED -- a hospital
//                                          tenant is not a Platform member, and asking gate 1 of them
//                                          is the 115-route regression one plane over.
//   2. caller.tenantId                     a caller with no tenant has nothing to belong to. Null is
//                                          NOT a wildcard: 15 of 47 profiles carry none today.
//   3. admitToEnterprise                   gate 3. Fail-closed on an unreadable store, no super_admin
//                                          short-circuit -- both argued in enterprise-membership.ts.
//   4. the capability the route declares   see the warning below.

export type EnterpriseApiContext = {
  caller: Caller;
  /** The tenant this request is FOR. Non-null by construction: step 2 refused the null case. */
  tenantId: string;
  membership: EnterpriseMembershipRead;
};

/**
 * ⚠⚠ EVERY NON-NULL CAPABILITY REFUSES TODAY, AND THAT IS FAIL-CLOSED, NOT A STUB.
 *
 * There is no Enterprise capability store yet -- the `enterprise.*` namespace arrives with ENT-DEC-001
 * D3's registry work. Until it exists, a route that declares a capability is declaring a requirement
 * NOBODY CAN MEET, and the honest translations are:
 *
 *   admitting the call        the capability was decoration -- the exact "hidden button, live API"
 *                             failure SHELL-001 s15 forbids, and the fail-open posture D10 records
 *                             Enterprise must not start with
 *   refusing the call         the requirement is enforced before it is grantable
 *
 * So it refuses, with its own code, and the first slice's read-only screen passes `null` -- which is a
 * real gate too: membership of the tenant, which is exactly what a read-only member surface needs.
 * When the capability store lands, this constant's handling is replaced by a real lookup and the
 * refusal below becomes unreachable -- and the harness asserts the current behaviour so that change is
 * a deliberate edit, not a drift.
 */
export const ENTERPRISE_CAPABILITIES_NOT_BUILT =
  "This part of Competen Enterprise is not switched on yet, so nothing has been changed.";

export async function requireEnterpriseContext(
  capability: string | null,
): Promise<EnterpriseApiContext | NextResponse> {
  const c = await getCaller({ plane: "enterprise" });
  if (isResponse(c)) return c;

  // ⚠ 403 WITH A SENTENCE, NOT 404. A person with no tenant is signed in and real; pretending the
  // surface does not exist would send them hunting for a URL problem that is an access fact.
  if (!c.tenantId)
    return NextResponse.json({
      error: "This account is not attached to an organisation on Competen Enterprise.",
    }, { status: 403 });

  const { admitted, read } = await admitToEnterprise(c.admin, c.userId, c.tenantId);
  if (!admitted)
    // ⚠ The sentence distinguishes an outage from a genuine refusal -- the person refused by a hiccup
    // needs to know it is worth trying again, and 503 vs 403 lets a client tell the same two apart.
    return NextResponse.json(
      { error: enterpriseRefusalSentence(read) },
      { status: read.state === "unreadable" ? 503 : 403 },
    );

  if (capability !== null)
    return NextResponse.json({ error: ENTERPRISE_CAPABILITIES_NOT_BUILT }, { status: 403 });

  return { caller: c, tenantId: c.tenantId, membership: read };
}

export const isEnterpriseDenied = (x: unknown): x is NextResponse => x instanceof NextResponse;
