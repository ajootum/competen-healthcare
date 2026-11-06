import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { audit } from "@/lib/practice/audit";
import { FLAG_CONSEQUENCE } from "@/lib/practice/operations";
import { HQ_RECORD_SEARCH_FLAG } from "@/lib/hq/record-search/flag";

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
  // HQ-RECORD-SEARCH-01: shows the record search in the HQ palette. It grants NO data access: every /api/hq/search route still checks its own
  // capability. Its row is not seeded (no migration), so the first flip creates it. Its own gate is below.
  hq_record_search: "HQ palette record search (policies, instruments, frameworks, positions, staff directory).",
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

  let body: { flag?: string; enabled?: boolean; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const flag = String(body.flag ?? "");
  // HQ-RECORD-SEARCH-01, the owner's default of 6 Nov 2026: "a Holdings platform administrator may activate the flag". The Practice right above is not
  // enough for this flag: it also takes the Holdings right, hq.platform.governance.manage. No position holds that by default, so today this means the
  // owner. This stays the one flag writer behind the one gate (individual-foundation 12j, 12k), so no other right reaches it.
  if (flag === HQ_RECORD_SEARCH_FLAG && !gate.isOwner && !gate.capabilities.includes("hq.platform.governance.manage"))
    return NextResponse.json({ error: "Turning this on takes a Holdings platform right." }, { status: 403 });
  if (!FLAGS[flag]) return NextResponse.json({ error: `flag must be one of: ${Object.keys(FLAGS).join(", ")}` }, { status: 400 });
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  /**
   * ⚠ A REASON IS REQUIRED FOR A CHANGE THE PUBLIC CAN SEE. CPR-PD-014 §7.2 B: "Reason/change reference
   * — Required for consequential changes."
   *
   * The two public-facing flags are the consequential ones: sign-in decides whether a stranger can reach
   * a credential form, and public signup decides whether they can create an account. Pilot provisioning
   * changes only what an operator may do, so it is not gated on prose.
   *
   * ⚠ ENFORCED HERE RATHER THAN IN THE CONSOLE. A required field in a form is a convention; a 400 is a
   * rule. The audit row is the reason this matters — without it the trail records that somebody flipped
   * the public site and not why, which is exactly the question asked afterwards.
   */
  const PUBLIC_IMPACTING = ["practice_sign_in", "practice_public_signup"];
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (PUBLIC_IMPACTING.includes(flag) && reason.length < 8) {
    return NextResponse.json({
      error: "This flag changes what the public site does, so a reason is required (at least 8 characters). "
        + "It is recorded in the audit trail with the before and after values.",
      flag,
    }, { status: 400 });
  }

  const { data: before } = await c.admin.from("practice_platform_flags").select("enabled").eq("flag", flag).maybeSingle();
  if (!before && flag !== HQ_RECORD_SEARCH_FLAG) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = before
    ? await c.admin.from("practice_platform_flags").update({ enabled: body.enabled }).eq("flag", flag)
    : await c.admin.from("practice_platform_flags").insert({ flag, enabled: body.enabled, note: FLAGS[flag] });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const audited = await audit(c.admin, {
    actorId: c.userId, eventType: "practice.launch_flag_changed",
    // §7.2 B: "Every change writes an audit event with before/after value, actor, time and reason."
    // Actor and time come from the audit helper itself; the other three are here.
    payload: { flag, from: before?.enabled ?? null, to: body.enabled, reason: reason || null },
    correlationId: c.traceId,
  });

  // HQ-RECORD-SEARCH-01: a change to this flag nobody can attribute does not stand. Absent and false both read as off.
  if (!audited && flag === HQ_RECORD_SEARCH_FLAG) {
    await c.admin.from("practice_platform_flags").update({ enabled: before?.enabled ?? false }).eq("flag", flag);
    return NextResponse.json({ error: "The change could not be recorded, so it was not kept." }, { status: 503 });
  }

  return NextResponse.json({
    flag, enabled: body.enabled, changed: (before?.enabled ?? false) !== body.enabled,
    consequence: body.enabled ? (FLAG_CONSEQUENCE[flag] ?? null) : null,
    correlationId: c.traceId,
  });
}
