import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { MEMBERSHIP_DONE, setIndividualMembershipStatus, validateMembershipAction } from "@/lib/individual/grants";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/hq/individual/grants/membership -- suspend, reinstate or revoke a person's Competen Individual
// membership during the pilot (COMPETEN-LEGAL-001 s13 step 7). Body: { targetUserId, action, reason? }.
// A reason is required to revoke. Same right as the grant, same release gate, same not-yourself rule. It
// changes the membership's status and nothing else, and every change is audited with its reason.

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.pilot.grant"]);
  if (isHqRefusal(ctx)) return ctx;
  // The release gate (src/lib/individual/gate.ts): with Individual off, the grant right opens nothing.
  if (!(await individualAppEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  const parsed = validateMembershipAction(await req.json().catch(() => ({})));
  if ("ok" in parsed) return NextResponse.json({ error: { code: parsed.code, message: parsed.message } }, { status: parsed.status });
  const { targetUserId, action, reason } = parsed;
  if (targetUserId === ctx.userId)
    return NextResponse.json({ error: { code: "SELF_GRANT", message: "You cannot change your own Competen Individual access." } }, { status: 403 });

  const out = await setIndividualMembershipStatus(ctx.admin, targetUserId, action, ctx.userId);
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `individual_membership_${MEMBERSHIP_DONE[action]}`, entity_type: "individual_membership", entity_id: null,
    old_value: { status: out.from }, new_value: { target_user_id: targetUserId, status: out.to, reason },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ ok: true, from: out.from, to: out.to });
}
