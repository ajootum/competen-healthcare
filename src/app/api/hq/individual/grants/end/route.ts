import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { isExperienceKey } from "@/lib/individual/experiences";
import { endIndividualExperience } from "@/lib/individual/grants";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/hq/individual/grants/end -- end one experience for a person during the pilot (D9).
// Body: { targetUserId, experience }. Every live row for that experience is cancelled. The rows stay, so
// the person's history keeps the period. The other experience is untouched (D4: entitlements are
// independent). Same capability as the grant, same not-yourself rule.

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.pilot.grant"]);
  if (isHqRefusal(ctx)) return ctx;
  // The release gate (src/lib/individual/gate.ts): with Individual off, the grant right opens nothing.
  if (!(await individualAppEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || !isExperienceKey(body?.experience))
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "targetUserId and experience are required" } }, { status: 400 });
  if (targetUserId === ctx.userId)
    return NextResponse.json({ error: { code: "SELF_GRANT", message: "You cannot change your own Competen Individual access." } }, { status: 403 });

  const result = await endIndividualExperience(ctx.admin, targetUserId, body.experience);
  if (!result.ok) return NextResponse.json({ error: { code: "UNAVAILABLE", message: result.message } }, { status: result.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: "individual_experience_ended", entity_type: "individual_entitlement", entity_id: null,
    new_value: { target_user_id: targetUserId, experience: body.experience, ended_rows: result.ended },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json(result);
}
