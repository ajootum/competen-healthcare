import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { audit } from "@/lib/practice/audit";
import { FLAG_CONSEQUENCE } from "@/lib/practice/operations";

// PATCH /api/v1/practice/flags -- move Competen Practice along IAM-001 s14.1's launch ladder.
//
// SUPER-ADMIN ONLY, AND EVERY FLIP IS AUDITED. These three flags decide whether a public page offers a
// credential field and whether strangers can create workspaces; a silent toggle would make the launch
// posture unattributable. The audit row is written with a null workspace, because this is a platform
// act, not something that happened inside somebody's practice.
//
// TURNING practice_sign_in ON IS A PUBLIC-FACING CHANGE. It replaces the transparent "not open yet"
// panel with a real password field, which retires disclosure assertion 7e -- that assertion exists to
// prevent a FAKE form, not a real one, so it is retired deliberately alongside this flip rather than
// discovered later as a red harness. The response says so, so nobody has to remember.

const FLAGS: Record<string, string> = {
  practice_pilot_provisioning: "Platform-operator pilot provisioning of test workspaces.",
  practice_sign_in: "Practice sign-in page accepts credentials.",
  practice_public_signup: "Self-service individual signup.",
};

// The consequence copy lives in src/lib/practice/operations.ts, imported by the operator page too, so
// the warning at the moment of the flip and the standing warning afterwards cannot diverge.

export async function PATCH(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  // !!CPR-PD-014 build 2: THE CAPABILITY, NOT OWNERSHIP.
  //
  // This read an ownership test on the caller, which broke in both directions. A real Practice Product
  // Director -- the position this endpoint exists to serve -- was refused, because the check asked
  // whether they OWNED the platform rather than whether they held the right. And any super_admin
  // invoked it holding no HQ position at all, so the HQ plane recorded nothing and governed nothing.
  // PD-014 says it plainly: "Do not equate Product Director with Super Admin."
  //
  // !!hqApiGate, NOT requireHqCapability: this is a fetch, and a redirect is not a status a caller can
  // act on. resolveHqContext keeps the owner short-circuit, so an owner is unaffected by this change.
  const gate = await hqApiGate(["hq.practice.flags.manage"]);
  if (isHqRefusal(gate)) return gate;

  let body: { flag?: string; enabled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const flag = String(body.flag ?? "");
  if (!FLAGS[flag]) return NextResponse.json({ error: `flag must be one of: ${Object.keys(FLAGS).join(", ")}` }, { status: 400 });
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  const { data: before } = await c.admin.from("practice_platform_flags").select("enabled").eq("flag", flag).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await c.admin.from("practice_platform_flags")
    .update({ enabled: body.enabled }).eq("flag", flag);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await audit(c.admin, {
    actorId: c.userId, eventType: "practice.launch_flag_changed",
    payload: { flag, from: before.enabled, to: body.enabled }, correlationId: c.traceId,
  });

  return NextResponse.json({
    flag, enabled: body.enabled, changed: before.enabled !== body.enabled,
    consequence: body.enabled ? (FLAG_CONSEQUENCE[flag] ?? null) : null,
    correlationId: c.traceId,
  });
}
