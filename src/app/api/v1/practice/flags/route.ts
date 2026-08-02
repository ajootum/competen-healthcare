import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse, isSuper } from "@/lib/api-auth";
import { audit } from "@/lib/practice/provisioning";

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

const CONSEQUENCE: Record<string, string> = {
  practice_sign_in: "The public sign-in page now renders a real password field. Retire disclosure assertion 7e in scripts/public-disclosure-harness.ts in the same change, deliberately.",
  practice_public_signup: "Anyone authenticated can now create a Practice workspace for themselves. The public site's availability copy must stop saying the product is not open.",
};

export async function PATCH(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    consequence: body.enabled ? (CONSEQUENCE[flag] ?? null) : null,
    correlationId: c.traceId,
  });
}
